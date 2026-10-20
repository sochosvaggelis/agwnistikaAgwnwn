import type { CoachFoulType, FoulType, GameEvent, Side } from '../db/types'
import { defaultFreeThrows, opposite, TEAM_FOUL_PENALTY } from '../stats/rules'

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

interface PlayerRef {
  side: Side
  playerId: number
}

export type Step =
  | { kind: 'idle' }
  | { kind: 'action'; actor: PlayerRef }
  | { kind: 'court'; actor: PlayerRef; shot: 'FG2' | 'FG3'; made: boolean }
  | { kind: 'foulType'; actor: PlayerRef }
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
  | { kind: 'pick'; purpose: 'fouled'; actor: PlayerRef; foulType: FoulType }
  | { kind: 'pick'; purpose: 'ftShooter'; shooterSide: Side; total: number }
  | { kind: 'pick'; purpose: 'blockedShooter'; actor: PlayerRef }

export type Input =
  | { t: 'player'; side: Side; playerId: number }
  | { t: 'action'; action: ActionKey }
  | { t: 'court'; x: number; y: number }
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

/** Which players may be tapped in the current step. */
export function eligibility(step: Step): { sides: Side[]; exclude?: number } {
  switch (step.kind) {
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
      if (input.t === 'player') return go({ kind: 'action', actor: { side: input.side, playerId: input.playerId } })
      if (input.t === 'coachFoul') return go({ kind: 'coachFoulType', side: input.side })
      return go(step)

    case 'action':
      if (input.t === 'player') return go({ kind: 'action', actor: { side: input.side, playerId: input.playerId } })
      if (input.t === 'coachFoul') return go({ kind: 'coachFoulType', side: input.side })
      if (input.t === 'action') return onAction(step.actor, input.action)
      return go(step)

    case 'court': {
      if (input.t !== 'court' && input.t !== 'skip') return go(step)
      const shot: Draft = {
        side: step.actor.side, playerId: step.actor.playerId, type: step.shot, made: step.made,
        ...(input.t === 'court' ? { x: round2(input.x), y: round2(input.y) } : {}),
      }
      if (step.made) return go({ kind: 'pick', purpose: 'assist', shooter: step.actor }, shot)
      return go(reboundAfterMiss(step.actor, step.actor.side, true), shot)
    }

    case 'foulType':
      if (input.t === 'player') return go({ kind: 'action', actor: { side: input.side, playerId: input.playerId } })
      if (input.t !== 'foulType') return go(step)
      return go({ kind: 'pick', purpose: 'fouled', actor: step.actor, foulType: input.foulType })

    case 'coachFoulType': {
      if (input.t !== 'coachFoulType') return go(step)
      const foul: Draft = { side: step.side, type: 'COACH_FOUL', coachFoulType: input.type }
      return go({ kind: 'ftCount', shooterSide: opposite(step.side), suggested: 1 }, foul)
    }

    case 'shotKind': {
      if (input.t !== 'shotKind') return go(step)
      const shot: Draft = { side: step.shooter.side, playerId: step.shooter.playerId, type: input.shot, made: false }
      const blk: Draft = { side: step.blocker.side, playerId: step.blocker.playerId, type: 'BLK', targetPlayerId: step.shooter.playerId }
      return go(reboundAfterMiss(step.shooter, step.shooter.side, false), shot, blk)
    }

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

function onAction(actor: PlayerRef, action: ActionKey): Result {
  const base = { side: actor.side, playerId: actor.playerId }
  switch (action) {
    case 'FG2+': return go({ kind: 'court', actor, shot: 'FG2', made: true })
    case 'FG2-': return go({ kind: 'court', actor, shot: 'FG2', made: false })
    case 'FG3+': return go({ kind: 'court', actor, shot: 'FG3', made: true })
    case 'FG3-': return go({ kind: 'court', actor, shot: 'FG3', made: false })
    case 'FT+': return done({ ...base, type: 'FT', made: true })
    case 'FT-': return go(reboundAfterMiss(actor, actor.side, false), { ...base, type: 'FT', made: false })
    case 'OREB': return done({ ...base, type: 'OREB' })
    case 'DREB': return done({ ...base, type: 'DREB' })
    case 'AST': return done({ ...base, type: 'AST' })
    case 'STL': return go({ kind: 'pick', purpose: 'stolenFrom', actor }, { ...base, type: 'STL' })
    case 'TOV': return go({ kind: 'pick', purpose: 'stealBy', actor }, { ...base, type: 'TOV' })
    case 'BLK': return go({ kind: 'pick', purpose: 'blockedShooter', actor })
    case 'FOUL': return go({ kind: 'foulType', actor })
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
      if (!picked) return done({ side: step.actor.side, playerId: step.actor.playerId, type: 'BLK' })
      return go({ kind: 'shotKind', blocker: step.actor, shooter: picked })

    case 'fouled': {
      const { actor, foulType } = step
      const foul: Draft = {
        side: actor.side, playerId: actor.playerId, type: 'FOUL', foulType,
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
    const foul: Draft = { side: actor.side, playerId: actor.playerId, type: 'FOUL', foulType }
    if (foulType === 'O') return done(foul, { side: actor.side, playerId: actor.playerId, type: 'TOV' })
    return done(foul)
  }
  if (step.kind === 'pick' && step.purpose === 'blockedShooter') {
    return done({ side: step.actor.side, playerId: step.actor.playerId, type: 'BLK' })
  }
  return done()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
