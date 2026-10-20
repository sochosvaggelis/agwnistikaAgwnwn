import { describe, expect, it } from 'vitest'
import { availableKinds, competitionKind, sameName } from './competitions'

describe('competitions', () => {
  it('compares names ignoring case, accents and spaces', () => {
    expect(sameName('Κύπελλο', ' κυπελλο ')).toBe(true)
    expect(sameName('Φιλικά', 'Φιλικό')).toBe(false)
  })

  it('keeps a stored kind even after a rename', () => {
    expect(competitionKind({ kind: 'league', name: 'Πρωτάθλημα ΕΣΚΑ' })).toBe('league')
  })

  it('infers the kind of older competitions from their name', () => {
    expect(competitionKind({ name: 'Κύπελο' })).toBe('cup')
    expect(competitionKind({ name: 'Friendly' })).toBe('friendly')
    expect(competitionKind({ name: 'Πρωτάθλημα ΕΣΚΑ' })).toBe('other')
  })

  it('offers only the kinds a season does not have yet', () => {
    expect(availableKinds([{ kind: 'league', name: 'A' }, { kind: 'friendly', name: 'B' }])).toEqual(['cup', 'other'])
  })

  it('offers nothing once a season has four competitions', () => {
    const four = ['a', 'b', 'c', 'd'].map(name => ({ name }))
    expect(availableKinds(four)).toEqual([])
  })
})
