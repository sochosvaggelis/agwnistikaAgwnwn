import type { CSSProperties } from 'react'
import type { Side, Team } from './db/types'
import { opposite } from './stats/rules'

/**
 * A team has up to two colors, its main one first. In a game each side gets an ink from them that reads on light
 * surfaces and one that reads on dark ones (the dark theme and the navy scoreboards), each with a text color to put on it.
 */

/** Offered on the team page, roughly the usual jersey colors */
export const PRESET_COLORS = [
  '#ffffff', '#111111', '#8a8d91', '#d71920', '#7a1f2b', '#f36f21', '#fdd20e',
  '#c9a227', '#00843d', '#5bb4e5', '#1f4fb4', '#14213d', '#5b2a86',
]
export const MAX_TEAM_COLORS = 2

export const isHexColor = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)

/** The team's usable colors, main one first */
export function teamColors(team?: Pick<Team, 'colors'>): string[] {
  return (team?.colors ?? []).filter(isHexColor).map(c => c.toLowerCase()).slice(0, MAX_TEAM_COLORS)
}

/** CSS background for the team's swatch: split diagonally when it has two colors */
export function swatchBackground(team?: Pick<Team, 'colors'>): string | undefined {
  const [main, second] = teamColors(team)
  if (!main) return undefined
  return second ? `linear-gradient(135deg, ${main} 50%, ${second} 50%)` : main
}

// ---------- color math: sRGB channels 0..1, WCAG contrast, OKLab for lightness and likeness ----------

type RGB = [number, number, number]

function parse(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
function hex(c: RGB): string {
  return '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

function luminance(c: RGB): number {
  const [r, g, b] = c.map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string | RGB, b: string | RGB): number {
  const [la, lb] = [a, b].map(c => luminance(typeof c === 'string' ? parse(c) : c))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function oklab(c: RGB): RGB {
  const [r, g, b] = c.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
/** Linear sRGB, which falls outside 0..1 for colors the screen can't show */
function oklabToLinear([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** The color at OKLab lightness L with the hue of (a, b), losing as little chroma as the screen needs; 8-bit channels */
function atLightness(L: number, a: number, b: number): RGB {
  const fits = (k: number) => oklabToLinear([L, a * k, b * k]).every(v => v >= -1e-4 && v <= 1 + 1e-4)
  let k = 1
  if (!fits(1)) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
    k = lo
  }
  return oklabToLinear([L, a * k, b * k]).map(v => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255) / 255) as RGB
}

function chroma(c: RGB): number {
  const [, a, b] = oklab(c)
  return Math.hypot(a, b)
}
/** How unlike two colors look; 0 for the same color, about 0.3 for the default blue and orange */
export function distance(a: string, b: string): number {
  const [x, y] = [oklab(parse(a)), oklab(parse(b))]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

// ---------- side colors ----------

/** The darkest light background and the lightest dark one (the light end of the scoreboards' navy) a side color sits on */
export const LIGHT_BG = '#eef1f6'
export const DARK_BG = '#1b347f'
/** Ink against its background, and text on the ink */
export const MIN_INK = 3.5
export const MIN_ON = 4.5
/** Below this two inks are too alike to tell the teams apart at a glance */
export const MIN_DISTANCE = 0.1
/** The 5th team-foul light, which team-foul lights must not look like */
export const PENALTY_RED = '#ff4d4d'
const WHITE: RGB = [1, 1, 1]
const NAVY = parse('#0b1533')
/** Below this chroma a color is white, gray or black, and keeps no hue when made lighter or darker */
const GRAY_CHROMA = 0.03

export interface Shade {
  ink: string
  /** Text on the ink */
  on: string
}
export interface SideColors {
  light: Shade
  dark: Shade
  /** Team-foul lights on the scoreboard */
  foul: string
}

/** The color, made darker on a light background or lighter on a dark one, as little as it takes to read */
function readable(c: RGB, bg: RGB): RGB {
  if (contrast(c, bg) >= MIN_INK) return c
  const [L, a, b] = oklab(c)
  let lo = L
  let hi = luminance(bg) > 0.5 ? 0 : 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (contrast(atLightness(mid, a, b), bg) >= MIN_INK) hi = mid
    else lo = mid
  }
  return atLightness(hi, a, b)
}

const textOn = (ink: RGB) => (contrast(WHITE, ink) >= contrast(NAVY, ink) ? WHITE : NAVY)

function shade(main: RGB, other: RGB | undefined, bg: RGB): Shade {
  // A white, gray or black main color that doesn't read here gives way to the team's other color
  const swap = !!other && contrast(main, bg) < MIN_INK && chroma(main) < GRAY_CHROMA
  const [base, rest] = swap ? [other!, main] : [main, other]
  const ink = readable(base, bg)
  return { ink: hex(ink), on: hex(rest && contrast(rest, ink) >= MIN_ON ? rest : textOn(ink)) }
}

/** The first of the candidates that doesn't look like the penalty light, else a neutral light */
const foulLight = (candidates: string[]) => [...candidates, '#e6eaf2'].find(c => distance(c, PENALTY_RED) >= MIN_DISTANCE)!

const fixed = (light: string, dark: string): SideColors => ({
  light: { ink: light, on: hex(textOn(parse(light))) },
  dark: { ink: dark, on: hex(textOn(parse(dark))) },
  foul: dark,
})
/** For a team without colors, and when both teams' colors look alike */
export const DEFAULT_SIDE_COLORS: Record<Side, SideColors> = {
  home: fixed('#1d4ed8', '#8ab8ff'),
  away: fixed('#c2410c', '#ffab70'),
}

const optionsCache = new Map<string, SideColors[]>()

/** The ways a team can be shown: led by its main color, then by its other one */
function teamOptions(team?: Pick<Team, 'colors'>): SideColors[] {
  const colors = teamColors(team)
  const key = colors.join()
  let options = optionsCache.get(key)
  if (!options) optionsCache.set(key, (options = buildOptions(colors)))
  return options
}

function buildOptions(colors: string[]): SideColors[] {
  const [main, second] = colors.map(parse)
  if (!main) return []
  const build = (lead: RGB, other?: RGB): SideColors => {
    const dark = shade(lead, other, parse(DARK_BG))
    return {
      light: shade(lead, other, parse(LIGHT_BG)),
      dark,
      foul: foulLight([dark.ink, ...(other ? [shade(other, lead, parse(DARK_BG)).ink] : [])]),
    }
  }
  return second ? [build(main, second), build(second, main)] : [build(main)]
}

const apart = (a: SideColors, b: SideColors) =>
  distance(a.light.ink, b.light.ink) >= MIN_DISTANCE && distance(a.dark.ink, b.dark.ink) >= MIN_DISTANCE

/**
 * Each side's colors. My team, else the home team, keeps its own; the other team takes its main color, its other one,
 * or a default, whichever is the first that doesn't look like the first team's.
 */
export function sideColors(home?: Pick<Team, 'colors' | 'isMine'>, away?: Pick<Team, 'colors' | 'isMine'>): Record<Side, SideColors> {
  const teams = { home, away }
  const first: Side = away?.isMine && !home?.isMine ? 'away' : 'home'
  const second = opposite(first)
  const kept = teamOptions(teams[first])[0] ?? DEFAULT_SIDE_COLORS[first]
  const options = [...teamOptions(teams[second]), DEFAULT_SIDE_COLORS[second], DEFAULT_SIDE_COLORS[first]]
  const other = options.find(o => apart(o, kept)) ?? DEFAULT_SIDE_COLORS[second]
  return first === 'home' ? { home: kept, away: other } : { home: other, away: kept }
}

/** The custom properties the `team-colors` class turns into --home, --away and their -on and -soft colors */
export function teamColorVars(home?: Pick<Team, 'colors' | 'isMine'>, away?: Pick<Team, 'colors' | 'isMine'>): CSSProperties {
  const sides = sideColors(home, away)
  const vars: Record<string, string> = {}
  for (const side of ['home', 'away'] as const) {
    const c = sides[side]
    vars[`--${side}-l`] = c.light.ink
    vars[`--${side}-l-on`] = c.light.on
    vars[`--${side}-d`] = c.dark.ink
    vars[`--${side}-d-on`] = c.dark.on
    vars[`--${side}-foul`] = c.foul
  }
  return vars as CSSProperties
}
