import { describe, expect, it } from 'vitest'
import type { GameEvent } from '../db/types'
import { computeGameStats, pir, teamFoulsInPeriod } from './compute'
import { isCoachDisqualified, isPlayerDisqualified, isThreeByLocation, shotZone } from './rules'
import { foulCounts } from './compute'

let seq = 0
function ev(e: Partial<GameEvent> & Pick<GameEvent, 'type' | 'side'>): GameEvent {
  seq++
  return { gameId: 1, seq, group: seq, period: 1, createdAt: 0, ...e }
}

describe('computeGameStats', () => {
  it('scores shots and splits them by period', () => {
    const s = computeGameStats([
      ev({ side: 'home', playerId: 1, type: 'FG2', made: true }),
      ev({ side: 'home', playerId: 1, type: 'FG3', made: true, period: 2 }),
      ev({ side: 'home', playerId: 1, type: 'FT', made: false, period: 2 }),
      ev({ side: 'away', playerId: 9, type: 'FT', made: true, period: 3 }),
    ])
    expect(s.teams.home.score).toBe(5)
    expect(s.teams.home.periodScores).toEqual([2, 3])
    expect(s.teams.away.score).toBe(1)
    expect(s.teams.away.periodScores).toEqual([0, 0, 1])
    const p1 = s.players.get(1)!
    expect([p1.fg2m, p1.fg2a, p1.fg3m, p1.fg3a, p1.ftm, p1.fta]).toEqual([1, 1, 1, 1, 0, 1])
  })

  it('credits blocks received and fouls drawn to the opposing player', () => {
    const s = computeGameStats([
      ev({ side: 'home', playerId: 1, type: 'FG2', made: false }),
      ev({ side: 'away', playerId: 9, type: 'BLK', targetPlayerId: 1 }),
      ev({ side: 'away', playerId: 9, type: 'FOUL', foulType: 'S', targetPlayerId: 1 }),
    ])
    expect(s.players.get(1)!.blka).toBe(1)
    expect(s.players.get(1)!.fd).toBe(1)
    expect(s.playerSide.get(1)).toBe('home')
    expect(s.teams.home.totals.fd).toBe(1)
    expect(s.teams.away.totals.blk).toBe(1)
  })

  it('merges overtime team fouls into the 4th period', () => {
    const fouls = [4, 4, 5, 5].map(period => ev({ side: 'away', playerId: 9, type: 'FOUL', foulType: 'P', period }))
    const s = computeGameStats(fouls)
    expect(teamFoulsInPeriod(s.teams.away, 5)).toBe(4)
    expect(teamFoulsInPeriod(s.teams.away, 3)).toBe(0)
  })

  it('keeps coach fouls out of team fouls and player lines', () => {
    const s = computeGameStats([ev({ side: 'home', type: 'COACH_FOUL', coachFoulType: 'C' })])
    expect(s.teams.home.coachFouls).toEqual({ C: 1, B: 0 })
    expect(teamFoulsInPeriod(s.teams.home, 1)).toBe(0)
    expect(s.players.size).toBe(0)
  })

  it('includes rostered players with no events', () => {
    const s = computeGameStats([], { roster: { home: [1, 2], away: [9] } })
    expect(s.players.size).toBe(3)
    expect(s.playerSide.get(9)).toBe('away')
  })
})

describe('pir', () => {
  it('follows the FIBA formula', () => {
    const s = computeGameStats([
      ev({ side: 'home', playerId: 1, type: 'FG2', made: true }), // +2
      ev({ side: 'home', playerId: 1, type: 'FG3', made: false }), // -1
      ev({ side: 'home', playerId: 1, type: 'FT', made: false }), // -1
      ev({ side: 'home', playerId: 1, type: 'DREB' }), // +1
      ev({ side: 'home', playerId: 1, type: 'AST' }), // +1
      ev({ side: 'home', playerId: 1, type: 'TOV' }), // -1
      ev({ side: 'home', playerId: 1, type: 'FOUL', foulType: 'P' }), // -1
      ev({ side: 'away', playerId: 9, type: 'FOUL', foulType: 'P', targetPlayerId: 1 }), // +1
      ev({ side: 'away', playerId: 9, type: 'BLK', targetPlayerId: 1 }), // -1
    ])
    expect(pir(s.players.get(1)!)).toBe(0)
  })
})

describe('disqualification', () => {
  const counts = (total: number, t: Partial<Record<'P' | 'S' | 'O' | 'T' | 'U' | 'D', number>>) => ({
    total, byType: { P: 0, S: 0, O: 0, T: 0, U: 0, D: 0, ...t },
  })
  it('applies FIBA player limits', () => {
    expect(isPlayerDisqualified(counts(4, { P: 4 }))).toBe(false)
    expect(isPlayerDisqualified(counts(5, { P: 5 }))).toBe(true)
    expect(isPlayerDisqualified(counts(2, { T: 2 }))).toBe(true)
    expect(isPlayerDisqualified(counts(2, { U: 2 }))).toBe(true)
    expect(isPlayerDisqualified(counts(2, { T: 1, U: 1 }))).toBe(true)
    expect(isPlayerDisqualified(counts(1, { D: 1 }))).toBe(true)
  })
  it('applies FIBA coach limits', () => {
    expect(isCoachDisqualified({ C: 1, B: 1 })).toBe(false)
    expect(isCoachDisqualified({ C: 2, B: 0 })).toBe(true)
    expect(isCoachDisqualified({ C: 0, B: 3 })).toBe(true)
  })
  it('reads fouls from a stat line', () => {
    const s = computeGameStats([1, 2].map(() => ev({ side: 'home', playerId: 1, type: 'FOUL', foulType: 'T' })))
    expect(isPlayerDisqualified(foulCounts(s.players.get(1)!))).toBe(true)
  })
})

describe('court geometry', () => {
  it('classifies locations', () => {
    expect(isThreeByLocation(7.5, 3)).toBe(false)
    expect(isThreeByLocation(7.5, 9)).toBe(true)
    expect(isThreeByLocation(0.5, 1)).toBe(true)
    expect(isThreeByLocation(1.2, 1)).toBe(false)
    expect(shotZone('FG2', 7.5, 2)).toBe('paint')
    expect(shotZone('FG2', 2, 5)).toBe('mid')
    expect(shotZone('FG3', 0.4, 1)).toBe('corner3')
    expect(shotZone('FG3', 7.5, 9)).toBe('above3')
  })
})
