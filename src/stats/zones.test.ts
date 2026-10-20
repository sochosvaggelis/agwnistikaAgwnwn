import { describe, expect, it } from 'vitest'
import { courtZone, courtZoneSplits, zoneGroup, zoneHeat } from './zones'
import { COURT, shotZone } from './rules'

const two = (x: number, y: number) => ({ type: 'FG2' as const, x, y })
const three = (x: number, y: number) => ({ type: 'FG3' as const, x, y })

describe('courtZone', () => {
  it('places twos in the paint and the five mid-range areas', () => {
    expect(courtZone(two(COURT.basketX, 2))).toBe('paint')
    expect(courtZone(two(2.5, 1.5))).toBe('midBaseL')
    expect(courtZone(two(12.5, 1.5))).toBe('midBaseR')
    expect(courtZone(two(3.5, 5.5))).toBe('midWingL')
    expect(courtZone(two(11.5, 5.5))).toBe('midWingR')
    expect(courtZone(two(7.5, 7.5))).toBe('midTop')
  })

  it('places threes in the corners, wings and top', () => {
    expect(courtZone(three(0.4, 1.5))).toBe('corner3L')
    expect(courtZone(three(14.6, 1.5))).toBe('corner3R')
    expect(courtZone(three(1.5, 7))).toBe('wing3L')
    expect(courtZone(three(13.5, 7))).toBe('wing3R')
    expect(courtZone(three(7.5, 10))).toBe('top3')
  })

  it('agrees with the zone table for every shot', () => {
    for (let i = 0; i < 300; i++) {
      const s = { type: i % 2 ? 'FG3' as const : 'FG2' as const, x: (i * 7.31) % 15, y: (i * 3.17) % 14 }
      expect(zoneGroup(courtZone(s))).toBe(shotZone(s.type, s.x, s.y))
    }
  })

  it('counts made and attempted shots per zone', () => {
    const splits = courtZoneSplits([{ ...two(7.5, 2), made: true }, { ...two(7.4, 2.2), made: false }])
    expect(splits.paint).toEqual({ m: 1, a: 2 })
    expect(splits.top3).toEqual({ m: 0, a: 0 })
  })
})

describe('zoneHeat', () => {
  it('is neutral at one point per shot, for twos and threes alike', () => {
    expect(zoneHeat('paint', 5, 10)).toBe(0)
    expect(zoneHeat('top3', 1, 3)).toBe(0)
  })

  it('runs hot above it and cold below it', () => {
    expect(zoneHeat('paint', 8, 10)).toBe(3)
    expect(zoneHeat('wing3L', 4, 10)).toBe(1)
    expect(zoneHeat('midTop', 3, 10)).toBe(-2)
    expect(zoneHeat('corner3R', 0, 7)).toBe(-3)
  })
})
