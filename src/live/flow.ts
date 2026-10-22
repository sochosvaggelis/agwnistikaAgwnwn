import type { CoachFoulType, FoulType, GameEvent, Side } from '../db/types'
import { defaultFreeThrows, isThreeByLocation, opposite, TEAM_FOUL_PENALTY } from '../stats/rules'

/** An event as produced by the flow; the writer fills in game, ordering, period and clock. */
export type Draft = Omit<GameEvent, 'id' | 'gameId' | 'seq' | 'group' | 'period' | 'clockMs' | 'createdAt'>

export type ActionKey =
  | 'FG2+' | 'FG2-' | 'FG3+' | 'FG3-' | 'FT+' | 'FT-'
  | 'OREB' | 'DREB' | 'AST' | 'STL' | 'BLK' | 'TOV' | 'FOUL'

export type PickPurpose =
  | 'assist' // after a made FG, teammates of the shooter
  | 'rebound' // after a miss, everyone
  | 'blocker' // after a missed FG, opponents of the shooter
  | 'stolenFrom' // after a steal, opponents
  | 'stealBy' // after a turnover, opponents
  | 'fouled' // after a foul type, opponents of the fouler
  | 'ftShooter' // who shoots the free throws
  | 'blockedShooter' // after a standalone block, opponents of the blocker

export interface PlayerRef {
  side: Side
  playerId: number
}

/** Where on the half court the play happened, in meters */
export interface Spot {
  x: number
  y: number
}

export type Step =
  | { kind: 'idle' }
  // A court or an action was tapped, now choose who. side is the team whose court was tapped, set together with at.
  | { kind: 'player'; side?: Side; at?: Spot; action?: ActionKey }
  | { kind: 'action'; actor: PlayerRef; at?: Spot }
  | { kind: 'court'; actor: PlayerRef; shot: 'FG2' | 'FG3'; made: boolean }
  | { kind: 'foulType'; actor: PlayerRef; at?: Spot }
  | { kind: 'coachFoulType'; side: Side }
  | { kind: 'shotKind'; blocker: PlayerRef; shooter: PlayerRef }
  | { kind: 'ftCount'; shooterSide: Side; shooterId?: number; suggested: number }
  | { kind: 'ftResult'; shooter: PlayerRef; index: number; total: number }
  | PickStep

export type PickStep =
  | { kind: 'pick'; purpose: 'assist'; shooter: PlayerRef }
  | { kind: 'pick'; purpose: 'rebound'; missSide: Side; shooter?: PlayerRef; canBlock: boolean }
  | { kind: 'pick'; purpose: 'blocker'; shooter: PlayerRef }
  | { kind: 'pick'; purpose: 'stolenFrom'; actor: PlayerRef }
  | { kind: 'pick'; purpose: 'stealBy'; actor: PlayerRef }
  | { kind: 'pick'; purpose: 'fouled'; actor: PlayerRef; foulType: FoulType; at?: Spot }
  | { kind: 'pick'; purpose: 'ftShooter'; shooterSide: Side; total: number }
  | { kind: 'pick'; purpose: 'blockedShooter'; actor: PlayerRef; at?: Spot }

export type Input =
  | { t: 'player'; side: Side; playerId: number }
  | { t: 'action'; action: ActionKey }
  | { t: 'court'; side: Side; x: number; y: number }
  | { t: 'skip' }
  | { t: 'blocked' }
  | { t: 'foulType'; foulType: FoulType }
  | { t: 'coachFoul'; side: Side }
  | { t: 'coachFoulType'; type: CoachFoulType }
  | { t: 'shotKind'; shot: 'FG2' | 'FG3' }
  | { t: 'ftCount'; n: number }
  | { t: 'ftResult'; made: boolean }
  | { t: 'cancel' }

/** Game state the flow needs to make rule-based suggestions. */
export interface FlowContext {
  /** Team fouls in the current period, before the event being entered */
  teamFouls: Record<Side, number>
  /** Shooter of the most recently entered made field goal, for and-one detection */
  lastMadeShooter?: number
}

export interface Result {
  step: Step
  writes: Draft[]
}

const IDLE: Step = { kind: 'idle' }

function done(...writes: Draft[]): Result {
  return { step: IDLE, writes }
}

function go(step: Step, ...writes: Draft[]): Result {
  return { step, writes }
}

function reboundAfterMiss(shooter: PlayerRef | undefined, missSide: Side, canBlock: boolean): Step {
  return { kind: 'pick', purpose: 'rebound', missSide, shooter, canBlock }
}

function spotOf(input: { x: number; y: number }): Spot {
  return { x: round2(input.x), y: round2(input.y) }
}

/** Whether a tap on a team's court means something in the current step. */
export function acceptsSpot(step: Step, side: Side): boolean {
  if (step.kind === 'court') return step.actor.side === side
  return step.kind === 'idle' || step.kind === 'player' || step.kind === 'action'
}

/** The player tapped for the play being entered, while the play is still about them. */
export function chosenPlayer(step: Step): PlayerRef | undefined {
  return step.kind === 'action' || step.kind === 'foulType' || step.kind === 'court' ? step.actor : undefined
}

/** The spot of the play being entered, and the team whose court shows it. */
export function markedSpot(step: Step): { side: Side; at: Spot } | undefined {
  if (!('at' in step) || !step.at) return undefined
  const side = step.kind === 'player' ? step.side : step.actor.side
  return side && { side, at: step.at }
}

/** Which players may be tapped in the current step. */
export function eligibility(step: Step): { sides: Side[]; exclude?: number } {
  switch (step.kind) {
    case 'player':
      return { sides: step.side ? [step.side] : ['home', 'away'] }
    case 'idle':
    case 'action':
      return { sides: ['home', 'away'] }
    case 'pick':
      switch (step.purpose) {
        case 'assist':
          return { sides: [step.shooter.side], exclude: step.shooter.playerId }
        case 'rebound':
          return { sides: ['home', 'away'] }
        case 'blocker':
          return { sides: [opposite(step.shooter.side)] }
        case 'stolenFrom':
        case 'stealBy':
        case 'fouled':
        case 'blockedShooter':
          return { sides: [opposite(step.actor.side)] }
        case 'ftShooter':
          return { sides: [step.shooterSide] }
      }
      break
  }
  return { sides: [] }
}

export function isEligible(step: Step, side: Side, playerId: number): boolean {
  const e = eligibility(step)
  return e.sides.includes(side) && e.exclude !== playerId
}

/** Advance the entry flow. Pure: returns the next step and the events to store. */
export function advance(step: Step, input: Input, ctx: FlowContext): Result {
  if (input.t === 'cancel') return finish(step)

  switch (step.kind) {
    case 'idle':
    case 'player': {
      // The spot and the action can come in any order before the player
      const sofar: { side?: Side; at?: Spot; action?: ActionKey } = step.kind === 'player' ? step : {}
      if (input.t === 'court') return go({ kind: 'player', ...sofar, side: input.side, at: spotOf(input) })
      if (input.t === 'action') return go({ kind: 'player', ...sofar, action: input.action })
      if (input.t === 'player' && isEligible(step, input.side, input.playerId)) {
        const actor = { side: input.side, playerId: input.playerId }
        if (sofar.action) return onAction(actor, sofar.action, sofar.at)
        return go({ kind: 'action', actor, at: sofar.at })
      }
      if (input.t === 'coachFoul') return go({ kind: 'coachFoulType', side: input.side })
      return go(step)
    }

    case 'action':
      if (input.t === 'court') {
        // The other team's court starts the play over for that team
        if (input.side !== step.actor.side) return go({ kind: 'player', side: input.side, at: spotOf(input) })
        return go({ ...step, at: spotOf(input) })
      }
      if (input.t === 'player') return switchActor(step, input)
      if (input.t === 'coachFoul') return go({ kind: 'coachFoulType', side: input.side })
      if (input.t === 'action') return onAction(step.actor, input.action, step.at)
      return go(step)

    case 'court':
      if (input.t === 'skip') return shotTaken(step.actor, step.shot, step.made)
      if (input.t !== 'court' || input.side !== step.actor.side) return go(step)
      return shotTaken(step.actor, step.shot, step.made, spotOf(input))

    case 'foulType':
      if (input.t === 'player') return switchActor(step, input)
      if (input.t !== 'foulType') return go(step)
      return go({ kind: 'pick', purpose: 'fouled', actor: step.actor, foulType: input.foulType, at: step.at })

    case 'coachFoulType': {
      if (input.t !== 'coachFoulType') return go(step)
      const foul: Draft = { side: step.side, type: 'COACH_FOUL', coachFoulType: input.type }
      return go({ kind: 'ftCount', shooterSide: opposite(step.side), suggested: 1 }, foul)
    }

    case 'shotKind':
      if (input.t !== 'shotKind') return go(step)
      return blockedShot(step.blocker, step.shooter, input.shot)

    case 'ftCount': {
      if (input.t !== 'ftCount') return go(step)
      if (input.n <= 0) return done()
      if (step.shooterId != null) {
        return go({ kind: 'ftResult', shooter: { side: step.shooterSide, playerId: step.shooterId }, index: 1, total: input.n })
      }
      return go({ kind: 'pick', purpose: 'ftShooter', shooterSide: step.shooterSide, total: input.n })
    }

    case 'ftResult': {
      if (input.t !== 'ftResult') return go(step)
      const ft: Draft = { side: step.shooter.side, playerId: step.shooter.playerId, type: 'FT', made: input.made }
      if (step.index < step.total) return go({ ...step, index: step.index + 1 }, ft)
      if (!input.made) return go(reboundAfterMiss(step.shooter, step.shooter.side, false), ft)
      return done(ft)
    }

    case 'pick':
      return onPick(step, input, ctx)
  }
}

/** Choose another player for the play. The spot was tapped on the actor's court, so it only stays within that team. */
function switchActor(step: { actor: PlayerRef; at?: Spot }, input: { side: Side; playerId: number }): Result {
  const at = input.side === step.actor.side ? step.at : undefined
  return go({ kind: 'action', actor: { side: input.side, playerId: input.playerId }, at })
}

/** A field goal; without a spot yet, ask for one first. */
function fieldGoal(actor: PlayerRef, shot: 'FG2' | 'FG3', made: boolean, at?: Spot): Result {
  if (!at) return go({ kind: 'court', actor, shot, made })
  return shotTaken(actor, shot, made, at)
}

function shotTaken(actor: PlayerRef, shot: 'FG2' | 'FG3', made: boolean, at?: Spot): Result {
  const ev: Draft = { side: actor.side, playerId: actor.playerId, type: shot, made, ...at }
  if (made) return go({ kind: 'pick', purpose: 'assist', shooter: actor }, ev)
  return go(reboundAfterMiss(actor, actor.side, true), ev)
}

function blockedShot(blocker: PlayerRef, shooter: PlayerRef, shot: 'FG2' | 'FG3', at?: Spot): Result {
  const miss: Draft = { side: shooter.side, playerId: shooter.playerId, type: shot, made: false, ...at }
  const blk: Draft = { side: blocker.side, playerId: blocker.playerId, type: 'BLK', targetPlayerId: shooter.playerId }
  return go(reboundAfterMiss(shooter, shooter.side, false), miss, blk)
}

function onAction(actor: PlayerRef, action: ActionKey, at?: Spot): Result {
  const base = { side: actor.side, playerId: actor.playerId }
  // Free throws are always taken from the line, so only other events keep the spot
  const placed = { ...base, ...at }
  switch (action) {
    case 'FG2+': return fieldGoal(actor, 'FG2', true, at)
    case 'FG2-': return fieldGoal(actor, 'FG2', false, at)
    case 'FG3+': return fieldGoal(actor, 'FG3', true, at)
    case 'FG3-': return fieldGoal(actor, 'FG3', false, at)
    case 'FT+': return done({ ...base, type: 'FT', made: true })
    case 'FT-': return go(reboundAfterMiss(actor, actor.side, false), { ...base, type: 'FT', made: false })
    case 'OREB': return done({ ...placed, type: 'OREB' })
    case 'DREB': return done({ ...placed, type: 'DREB' })
    case 'AST': return done({ ...placed, type: 'AST' })
    case 'STL': return go({ kind: 'pick', purpose: 'stolenFrom', actor }, { ...placed, type: 'STL' })
    case 'TOV': return go({ kind: 'pick', purpose: 'stealBy', actor }, { ...placed, type: 'TOV' })
    case 'BLK': return go({ kind: 'pick', purpose: 'blockedShooter', actor, at })
    case 'FOUL': return go({ kind: 'foulType', actor, at })
  }
}

function onPick(step: PickStep, input: Input, ctx: FlowContext): Result {
  const picked = input.t === 'player' && isEligible(step, input.side, input.playerId)
    ? { side: input.side, playerId: input.playerId }
    : undefined
  const skipped = input.t === 'skip'

  if (step.purpose === 'rebound' && input.t === 'blocked' && step.canBlock && step.shooter) {
    return go({ kind: 'pick', purpose: 'blocker', shooter: step.shooter })
  }
  if (!picked && !skipped) return go(step)

  switch (step.purpose) {
    case 'assist':
      return picked ? done({ ...picked, type: 'AST' }) : done()

    case 'rebound':
      if (!picked) return done()
      return done({ ...picked, type: picked.side === step.missSide ? 'OREB' : 'DREB' })

    case 'blocker': {
      const next = reboundAfterMiss(step.shooter, step.shooter.side, false)
      if (!picked) return go(next)
      return go(next, { ...picked, type: 'BLK', targetPlayerId: step.shooter.playerId })
    }

    case 'stolenFrom':
      return picked ? done({ ...picked, type: 'TOV' }) : done()

    case 'stealBy':
      return picked ? done({ ...picked, type: 'STL' }) : done()

    case 'blockedShooter':
      if (!picked) return done({ side: step.actor.side, playerId: step.actor.playerId, type: 'BLK', ...step.at })
      // The spot tells a 2 from a 3, so only ask when there is none
      if (step.at) return blockedShot(step.actor, picked, isThreeByLocation(step.at.x, step.at.y) ? 'FG3' : 'FG2', step.at)
      return go({ kind: 'shotKind', blocker: step.actor, shooter: picked })

    case 'fouled': {
      const { actor, foulType } = step
      const foul: Draft = {
        side: actor.side, playerId: actor.playerId, type: 'FOUL', foulType, ...step.at,
        ...(picked ? { targetPlayerId: picked.playerId } : {}),
      }
      if (foulType === 'O') return done(foul, { side: actor.side, playerId: actor.playerId, type: 'TOV' })
      const inPenalty = ctx.teamFouls[actor.side] + 1 > TEAM_FOUL_PENALTY
      const andOne = foulType === 'S' && picked != null && picked.playerId === ctx.lastMadeShooter
      const suggested = defaultFreeThrows(foulType, { inPenalty, andOne })
      if (foulType === 'P' && suggested === 0) return done(foul)
      // Technical free throws can be taken by any opponent, so always ask who shoots
      const shooterId = foulType === 'T' ? undefined : picked?.playerId
      return go({ kind: 'ftCount', shooterSide: opposite(actor.side), shooterId, suggested }, foul)
    }

    case 'ftShooter':
      if (!picked) return done()
      return go({ kind: 'ftResult', shooter: picked, index: 1, total: step.total })
  }
}

/** Leave the flow early, still storing anything that was waiting on an optional answer. */
function finish(step: Step): Result {
  if (step.kind === 'court') {
    return done({ side: step.actor.side, playerId: step.actor.playerId, type: step.shot, made: step.made })
  }
  if (step.kind === 'pick' && step.purpose === 'fouled') {
    const { actor, foulType } = step
    const foul: Draft = { side: actor.side, playerId: actor.playerId, type: 'FOUL', foulType, ...step.at }
    if (foulType === 'O') return done(foul, { side: actor.side, playerId: actor.playerId, type: 'TOV' })
    return done(foul)
  }
  if (step.kind === 'pick' && step.purpose === 'blockedShooter') {
    return done({ side: step.actor.side, playerId: step.actor.playerId, type: 'BLK', ...step.at })
  }
  return done()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
