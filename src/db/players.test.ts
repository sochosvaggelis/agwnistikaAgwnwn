import { describe, expect, it } from 'vitest'
import { asInGame, mergedGame, playersNamed, sameNameGroups, samePlayerName, withGameNumber } from './players'
import { parseQuickPlayers } from './repo'
import type { Player } from './types'

const player = (id: number, number: string, name: string): Player => ({ id, teamId: 1, number, name, active: true, createdAt: 0 })

describe('players', () => {
  it('matches names ignoring accents, case, final sigma and word order', () => {
    expect(samePlayerName('Νάνος Γιάννης', 'ΓΙΑΝΝΗΣ ΝΑΝΟΣ')).toBe(true)
    expect(samePlayerName('Τσαρούχας Ηρακλής', ' τσαρουχας  ηρακλης ')).toBe(true)
    expect(samePlayerName('Νάνος Γιάννης', 'Νάνος Ιωάννης')).toBe(false)
  })

  it('never matches players known only by number', () => {
    expect(samePlayerName('', '')).toBe(false)
    expect(playersNamed([player(1, '4', ''), player(2, '5', '')], '')).toEqual([])
  })

  it('groups the players entered twice', () => {
    const groups = sameNameGroups([player(1, '7', 'Τσαρούχας Ηρακλής'), player(2, '24', 'ΤΣΑΡΟΥΧΑΣ ΗΡΑΚΛΗΣ'), player(3, '8', 'Παρμακλής Μάριος'), player(4, '9', '')])
    expect(groups.map(g => g.map(p => p.id))).toEqual([[1, 2]])
  })

  it('shows a player with the number worn in a game', () => {
    const p = player(1, '7', 'Τσαρούχας')
    expect(asInGame(p, { numbers: { 1: '24' } }).number).toBe('24')
    expect(asInGame(p, {}).number).toBe('7')
  })

  it('keeps only the numbers that differ from the players own', () => {
    const p = player(1, '7', 'Τσαρούχας')
    expect(withGameNumber({}, p, ' 24 ')).toEqual({ 1: '24' })
    expect(withGameNumber({ numbers: { 1: '24' } }, p, '7')).toEqual({})
    expect(withGameNumber({ numbers: { 1: '24', 2: '5' } }, p, '')).toEqual({ 2: '5' })
  })

  it('merges a player into another, keeping the number worn in each game', () => {
    const into = player(1, '7', 'Τσαρούχας')
    const from = player(2, '24', 'Τσαρούχας')
    const game = { roster: { home: [5, 2], away: [9] }, numbers: {} }
    expect(mergedGame(game, from, into)).toEqual({ roster: { home: [5, 1], away: [9] }, numbers: { 1: '24' } })
    // A number `from` wore only in that game wins over their own
    expect(mergedGame({ ...game, numbers: { 2: '7' } }, from, into)).toEqual({ roster: { home: [5, 1], away: [9] }, numbers: {} })
    expect(mergedGame({ roster: { home: [5], away: [9] } }, from, into)).toBeNull()
  })

  it('refuses to merge two players who played in the same game', () => {
    expect(() => mergedGame({ roster: { home: [1, 2], away: [] } }, player(2, '24', 'A'), player(1, '7', 'A'))).toThrow('both-in-game')
  })

  it('reads a quick roster entry', () => {
    expect(parseQuickPlayers('4 5, 7 Παπαδόπουλος, Ιωάννου')).toEqual([
      { number: '4', name: '' }, { number: '5', name: '' }, { number: '7', name: 'Παπαδόπουλος' }, { number: '', name: 'Ιωάννου' },
    ])
  })
})
