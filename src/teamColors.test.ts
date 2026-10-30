import { describe, expect, it } from 'vitest'
import {
  contrast, DARK_BG, DEFAULT_SIDE_COLORS, distance, LIGHT_BG, MIN_DISTANCE, MIN_INK, PENALTY_RED, PRESET_COLORS, sideColors,
  swatchBackground, teamColors, type SideColors,
} from './teamColors'

const team = (...colors: string[]) => ({ colors, isMine: false })
const mine = (...colors: string[]) => ({ colors, isMine: true })
const home = (t: ReturnType<typeof team>) => sideColors(t, undefined).home

/** Every color pair a team could pick from the presets, plus some odd custom ones */
const PAIRS = [
  ...PRESET_COLORS.flatMap(a => [[a], ...PRESET_COLORS.filter(b => b !== a).map(b => [a, b])]),
  ['#000000'], ['#7f7f7f'], ['#00ff00', '#ff00ff'], ['#ffff00'], ['#0000ff'], ['#1b347f'], ['#eef1f6'],
]

describe('teamColors', () => {
  it('keeps up to two valid colors, lowercased', () => {
    expect(teamColors({ colors: ['#FF0000', 'red', '#00ff00', '#0000ff'] })).toEqual(['#ff0000', '#00ff00'])
    expect(teamColors({})).toEqual([])
    expect(teamColors(undefined)).toEqual([])
  })

  it('splits the swatch only for two colors', () => {
    expect(swatchBackground({ colors: ['#d71920'] })).toBe('#d71920')
    expect(swatchBackground({ colors: ['#d71920', '#ffffff'] })).toContain('linear-gradient')
    expect(swatchBackground({})).toBeUndefined()
  })
})

describe('side inks', () => {
  it('read on their background for every pair of colors', () => {
    for (const colors of PAIRS) {
      const c = home(team(...colors))
      expect(contrast(c.light.ink, LIGHT_BG), `${colors} light`).toBeGreaterThanOrEqual(MIN_INK)
      expect(contrast(c.dark.ink, DARK_BG), `${colors} dark`).toBeGreaterThanOrEqual(MIN_INK)
      expect(contrast(c.light.on, c.light.ink), `${colors} light text`).toBeGreaterThanOrEqual(MIN_INK)
      expect(contrast(c.dark.on, c.dark.ink), `${colors} dark text`).toBeGreaterThanOrEqual(MIN_INK)
    }
  })

  it('keep a color that already reads', () => {
    expect(home(team('#d71920', '#ffffff')).light.ink).toBe('#d71920')
    expect(home(team('#ffffff', '#00843d')).dark.ink).toBe('#ffffff')
  })

  it('put the other color on top when it reads on the ink', () => {
    expect(home(team('#14213d', '#fdd20e')).light).toEqual({ ink: '#14213d', on: '#fdd20e' })
  })

  it('use the other color where a white main color does not read', () => {
    expect(home(team('#ffffff', '#00843d')).light).toEqual({ ink: '#00843d', on: '#ffffff' })
  })

  it('make a colored main color lighter or darker instead of swapping it, keeping its hue', () => {
    const navy = home(team('#14213d', '#ffffff')).dark.ink
    expect(navy).not.toBe('#ffffff')
    const [r, g, b] = [1, 3, 5].map(i => parseInt(navy.slice(i, i + 2), 16))
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
  })

  it('make a white team without another color gray on light backgrounds', () => {
    const ink = home(team('#ffffff')).light.ink
    const [r, g, b] = [1, 3, 5].map(i => parseInt(ink.slice(i, i + 2), 16))
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1)
  })
})

describe('sideColors', () => {
  const apart = (s: Record<'home' | 'away', SideColors>) =>
    distance(s.home.light.ink, s.away.light.ink) >= MIN_DISTANCE && distance(s.home.dark.ink, s.away.dark.ink) >= MIN_DISTANCE

  it('gives teams without colors the default colors', () => {
    expect(sideColors(undefined, team())).toEqual(DEFAULT_SIDE_COLORS)
  })

  it('tells the two teams apart, whatever they picked', () => {
    for (const a of PAIRS) {
      for (const b of [...PAIRS.slice(0, 40), []]) expect(apart(sideColors(team(...a), team(...b))), `${a} vs ${b}`).toBe(true)
    }
  })

  it('lets my team keep its colors, else the home team', () => {
    const red = home(team('#d71920', '#ffffff'))
    expect(sideColors(team('#d71920', '#ffffff'), team('#d71920', '#ffffff')).home).toEqual(red)
    expect(sideColors(team('#d71920', '#ffffff'), mine('#d71920', '#ffffff')).away).toEqual(red)
  })

  it('switches the other team to its second color before a default one', () => {
    const s = sideColors(mine('#d71920'), team('#d71920', '#1f4fb4'))
    expect(s.away.light.ink).toBe('#1f4fb4')
  })

  it('keeps team-foul lights unlike the penalty light', () => {
    for (const colors of PAIRS) expect(distance(home(team(...colors)).foul, PENALTY_RED), `${colors}`).toBeGreaterThanOrEqual(MIN_DISTANCE)
  })
})
