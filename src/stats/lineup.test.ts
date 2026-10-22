import { describe, expect, it } from 'vitest'
import type { Game, GameEvent, Side } from '../db/types'
import { lineups, minutesPlayed } from './lineup'
import { computeGameStats } from './compute'
import { gameElapsedMs, parseClock } from './rules'

let seq = 0
const MIN = 60_000

/** A substitution event; clock is the time left in the period, in minutes */
function sub(type: 'SUB_IN' | 'SUB_OUT', playerId: number, period: number, clock?: number, side: Side = 'home'): GameEvent {
  seq++
  return { gameId: 1, seq, group: seq, period, side, playerId, type, createdAt: 0, ...(clock != null ? { clockMs: clock * MIN } : {}) }
}

function game(changes: Partial<Game> = {}): Game {
  return {
    competitionId: 1, date: '2026-10-22', homeTeamId: 1, awayTeamId: 2, roster: { home: [1, 2, 3, 4, 5, 6], away: [9] },
    status: 'finished', period: 4, clockEnabled: true, periodLengthMin: 10, otLengthMin: 5, clockMs: 0, clockRunningSince: null,
    lastGroup: 0, createdAt: 0, updatedAt: 0, ...changes,
  }
}

const starters = [1, 2, 3, 4, 5].map(id => sub('SUB_IN', id, 1, 10))

describe('lineups', () => {
  it('follows the substitutions, and leaves a team without any untracked', () => {
    const on = lineups([...starters, sub('SUB_OUT', 5, 2, 4), sub('SUB_IN', 6, 2, 4)])
    expect(on.home?.sort()).toEqual([1, 2, 3, 4, 6])
    expect(on.away).toBeNull()
  })
})

describe('minutesPlayed', () => {
  it('counts each stint across periods until the end of the game', () => {
    const m = minutesPlayed([...starters, sub('SUB_OUT', 5, 2, 4), sub('SUB_IN', 6, 2, 4), sub('SUB_OUT', 6, 3, 10), sub('SUB_IN', 5, 3, 10)], game())
    expect(m.get(1)).toBe(40 * MIN)
    // 10 + 6 in the first two quarters, then the whole second half
    expect(m.get(5)).toBe(36 * MIN)
    expect(m.get(6)).toBe(4 * MIN)
  })

  it('counts to the clock now while the game is live', () => {
    const live = game({ status: 'live', period: 2, clockMs: 7 * MIN })
    expect(minutesPlayed(starters, live).get(1)).toBe(13 * MIN)
  })

  it('is unknown when a stint has no time, or without a clock while live', () => {
    const noTime = [...starters, sub('SUB_OUT', 5, 1), sub('SUB_IN', 6, 1)]
    const m = minutesPlayed(noTime, game())
    expect(m.get(5)).toBeNull()
    expect(m.get(6)).toBeNull()
    expect(m.get(1)).toBe(40 * MIN)
    expect(minutesPlayed(starters, game({ status: 'live', clockEnabled: false })).get(1)).toBeNull()
  })

  it('times overtime with its own length', () => {
    expect(minutesPlayed(starters, game({ period: 5 })).get(1)).toBe(45 * MIN)
  })
})

describe('computeGameStats minutes', () => {
  it('gives minutes to a team with a lineup, including players who never entered', () => {
    const s = computeGameStats(starters, game())
    expect(s.players.get(1)).toMatchObject({ ms: 40 * MIN, msGames: 1 })
    expect(s.players.get(6)).toMatchObject({ ms: 0, msGames: 1 })
    // The other team has no lineup, and team totals leave minutes out
    expect(s.players.get(9)).toMatchObject({ ms: 0, msGames: 0 })
    expect(s.teams.home.totals).toMatchObject({ ms: 0, msGames: 0 })
  })

  it('leaves minutes out without the whole game', () => {
    expect(computeGameStats(starters, { roster: { home: [1], away: [] } }).players.get(1)?.msGames).toBe(0)
  })
})

describe('clock times', () => {
  it('reads typed times', () => {
    expect(parseClock('5:32')).toBe(332_000)
    expect(parseClock('5.32')).toBe(332_000)
    expect(parseClock('532')).toBe(332_000)
    expect(parseClock('1000')).toBe(600_000)
    expect(parseClock('45')).toBe(45_000)
    expect(parseClock('5:75')).toBeNull()
    expect(parseClock('abc')).toBeNull()
  })

  it('places a moment in the game', () => {
    expect(gameElapsedMs(game(), 2, 4 * MIN)).toBe(16 * MIN)
    expect(gameElapsedMs(game(), 5, 5 * MIN)).toBe(40 * MIN)
  })
})
