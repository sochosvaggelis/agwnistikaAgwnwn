import { describe, expect, it } from 'vitest'
import { advance, type FlowContext, type Input, type Step } from './flow'

const ctx: FlowContext = { teamFouls: { home: 0, away: 0 } }

/** Run a sequence of inputs from idle and collect all writes. */
function run(inputs: Input[], c: FlowContext = ctx) {
  let step: Step = { kind: 'idle' }
  const writes = []
  for (const input of inputs) {
    const r = advance(step, input, c)
    step = r.step
    writes.push(...r.writes)
  }
  return { step, writes }
}

const home = (playerId: number): Input => ({ t: 'player', side: 'home', playerId })
const away = (playerId: number): Input => ({ t: 'player', side: 'away', playerId })

describe('shot flow', () => {
  it('records a made 2 with location and assist', () => {
    const { step, writes } = run([home(1), { t: 'action', action: 'FG2+' }, { t: 'court', x: 7.512, y: 2 }, home(2)])
    expect(step.kind).toBe('idle')
    expect(writes).toEqual([
      { side: 'home', playerId: 1, type: 'FG2', made: true, x: 7.51, y: 2 },
      { side: 'home', playerId: 2, type: 'AST' },
    ])
  })

  it('does not let the shooter assist himself or an opponent assist', () => {
    const { step, writes } = run([home(1), { t: 'action', action: 'FG3+' }, { t: 'skip' }, home(1), away(9)])
    expect(step).toMatchObject({ kind: 'pick', purpose: 'assist' })
    expect(writes).toHaveLength(1)
  })

  it('records a miss and an offensive rebound', () => {
    const { writes } = run([home(1), { t: 'action', action: 'FG3-' }, { t: 'skip' }, home(3)])
    expect(writes.map(w => w.type)).toEqual(['FG3', 'OREB'])
  })

  it('records a blocked miss and a defensive rebound', () => {
    const { writes } = run([home(1), { t: 'action', action: 'FG2-' }, { t: 'skip' }, { t: 'blocked' }, away(9), away(8)])
    expect(writes).toEqual([
      { side: 'home', playerId: 1, type: 'FG2', made: false },
      { side: 'away', playerId: 9, type: 'BLK', targetPlayerId: 1 },
      { side: 'away', playerId: 8, type: 'DREB' },
    ])
  })

  it('stores the shot when the flow is cancelled on the court step', () => {
    const { step, writes } = run([home(1), { t: 'action', action: 'FG2+' }, { t: 'cancel' }])
    expect(step.kind).toBe('idle')
    expect(writes).toEqual([{ side: 'home', playerId: 1, type: 'FG2', made: true }])
  })
})

describe('standalone block', () => {
  it('creates the missed shot for the blocked player', () => {
    const { writes } = run([away(9), { t: 'action', action: 'BLK' }, home(1), { t: 'shotKind', shot: 'FG3' }, { t: 'skip' }])
    expect(writes).toEqual([
      { side: 'home', playerId: 1, type: 'FG3', made: false },
      { side: 'away', playerId: 9, type: 'BLK', targetPlayerId: 1 },
    ])
  })
})

describe('steals and turnovers', () => {
  it('a steal creates the opponent turnover', () => {
    const { writes } = run([home(1), { t: 'action', action: 'STL' }, away(9)])
    expect(writes).toEqual([
      { side: 'home', playerId: 1, type: 'STL' },
      { side: 'away', playerId: 9, type: 'TOV' },
    ])
  })
  it('a turnover can credit the stealer', () => {
    const { writes } = run([home(1), { t: 'action', action: 'TOV' }, away(9)])
    expect(writes.map(w => w.type)).toEqual(['TOV', 'STL'])
  })
})

describe('foul flow', () => {
  it('shooting foul: 2 free throws by the fouled player, last miss goes to rebound', () => {
    const { step, writes } = run([
      away(9), { t: 'action', action: 'FOUL' }, { t: 'foulType', foulType: 'S' }, home(1),
    ])
    expect(step).toEqual({ kind: 'ftCount', shooterSide: 'home', shooterId: 1, suggested: 2 })
    expect(writes).toEqual([{ side: 'away', playerId: 9, type: 'FOUL', foulType: 'S', targetPlayerId: 1 }])

    let s: Step = step
    const more = []
    for (const input of [{ t: 'ftCount', n: 2 }, { t: 'ftResult', made: true }, { t: 'ftResult', made: false }, away(8)] as Input[]) {
      const r = advance(s, input, ctx)
      s = r.step
      more.push(...r.writes)
    }
    expect(more).toEqual([
      { side: 'home', playerId: 1, type: 'FT', made: true },
      { side: 'home', playerId: 1, type: 'FT', made: false },
      { side: 'away', playerId: 8, type: 'DREB' },
    ])
  })

  it('suggests one free throw for an and-one', () => {
    const { step } = run([away(9), { t: 'action', action: 'FOUL' }, { t: 'foulType', foulType: 'S' }, home(1)],
      { ...ctx, lastMadeShooter: 1 })
    expect(step).toMatchObject({ kind: 'ftCount', suggested: 1 })
  })

  it('personal foul outside the penalty ends the flow', () => {
    const { step, writes } = run([away(9), { t: 'action', action: 'FOUL' }, { t: 'foulType', foulType: 'P' }, home(1)])
    expect(step.kind).toBe('idle')
    expect(writes).toHaveLength(1)
  })

  it('personal foul in the penalty suggests 2 free throws', () => {
    const { step } = run([away(9), { t: 'action', action: 'FOUL' }, { t: 'foulType', foulType: 'P' }, home(1)],
      { teamFouls: { home: 0, away: 4 } })
    expect(step).toMatchObject({ kind: 'ftCount', suggested: 2, shooterId: 1 })
  })

  it('offensive foul adds a turnover and no free throws', () => {
    const { step, writes } = run([home(1), { t: 'action', action: 'FOUL' }, { t: 'foulType', foulType: 'O' }, away(9)])
    expect(step.kind).toBe('idle')
    expect(writes).toEqual([
      { side: 'home', playerId: 1, type: 'FOUL', foulType: 'O', targetPlayerId: 9 },
      { side: 'home', playerId: 1, type: 'TOV' },
    ])
  })

  it('technical foul asks who shoots', () => {
    const { step } = run([home(1), { t: 'action', action: 'FOUL' }, { t: 'foulType', foulType: 'T' }, { t: 'skip' }, { t: 'ftCount', n: 1 }])
    expect(step).toEqual({ kind: 'pick', purpose: 'ftShooter', shooterSide: 'away', total: 1 })
  })

  it('coach technical gives the opponent a free throw', () => {
    const { step, writes } = run([
      { t: 'coachFoul', side: 'home' }, { t: 'coachFoulType', type: 'C' }, { t: 'ftCount', n: 1 }, away(9), { t: 'ftResult', made: true },
    ])
    expect(step.kind).toBe('idle')
    expect(writes).toEqual([
      { side: 'home', type: 'COACH_FOUL', coachFoulType: 'C' },
      { side: 'away', playerId: 9, type: 'FT', made: true },
    ])
  })

  it('cancelling the fouled prompt still stores the foul', () => {
    const { writes } = run([home(1), { t: 'action', action: 'FOUL' }, { t: 'foulType', foulType: 'P' }, { t: 'cancel' }])
    expect(writes).toEqual([{ side: 'home', playerId: 1, type: 'FOUL', foulType: 'P' }])
  })
})

describe('court-first flow', () => {
  const spot = (x: number, y: number): Input => ({ t: 'court', x, y })

  it('asks for the player after a court tap, then stores the shot with that spot', () => {
    const first = run([spot(7.512, 9)])
    expect(first.step).toEqual({ kind: 'player', at: { x: 7.51, y: 9 } })
    expect(first.writes).toHaveLength(0)

    const { step, writes } = run([spot(7.512, 9), home(1), { t: 'action', action: 'FG3+' }])
    expect(step).toMatchObject({ kind: 'pick', purpose: 'assist' })
    expect(writes).toEqual([{ side: 'home', playerId: 1, type: 'FG3', made: true, x: 7.51, y: 9 }])
  })

  it('moves the spot when the court is tapped again', () => {
    const { step } = run([spot(2, 2), spot(8, 3), home(1), spot(9, 4), away(9)])
    expect(step).toEqual({ kind: 'action', actor: { side: 'away', playerId: 9 }, at: { x: 9, y: 4 } })
  })

  it('keeps the spot on fouls but not on free throws', () => {
    const foul = run([spot(4, 5), away(9), { t: 'action', action: 'FOUL' }, { t: 'foulType', foulType: 'P' }, home(1)])
    expect(foul.writes).toEqual([{ side: 'away', playerId: 9, type: 'FOUL', foulType: 'P', x: 4, y: 5, targetPlayerId: 1 }])

    const ft = run([spot(4, 5), home(1), { t: 'action', action: 'FT+' }])
    expect(ft.writes).toEqual([{ side: 'home', playerId: 1, type: 'FT', made: true }])
  })

  it('tells a blocked 3 from the spot without asking', () => {
    const { step, writes } = run([spot(7.5, 10), away(9), { t: 'action', action: 'BLK' }, home(1)])
    expect(step).toMatchObject({ kind: 'pick', purpose: 'rebound' })
    expect(writes).toEqual([
      { side: 'home', playerId: 1, type: 'FG3', made: false, x: 7.5, y: 10 },
      { side: 'away', playerId: 9, type: 'BLK', targetPlayerId: 1 },
    ])
  })

  it('ignores court taps while a follow-up prompt is open', () => {
    const { step, writes } = run([spot(7.5, 3), home(1), { t: 'action', action: 'FG2+' }, spot(1, 1)])
    expect(step).toMatchObject({ kind: 'pick', purpose: 'assist' })
    expect(writes).toHaveLength(1)
  })

  it('cancelling before choosing a player stores nothing', () => {
    const { step, writes } = run([spot(7.5, 3), { t: 'cancel' }])
    expect(step.kind).toBe('idle')
    expect(writes).toHaveLength(0)
  })
})
