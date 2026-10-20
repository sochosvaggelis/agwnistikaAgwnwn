import type { FoulType, Game, Side } from '../db/types'

/** FIBA rules */
export const REGULATION_PERIODS = 4
export const PLAYER_FOUL_LIMIT = 5
/** A team is in the penalty once it has committed this many fouls in a period */
export const TEAM_FOUL_PENALTY = 4
export const DEFAULT_PERIOD_MIN = 10
export const DEFAULT_OT_MIN = 5

export const FOUL_TYPES: FoulType[] = ['P', 'S', 'O', 'T', 'U', 'D']

export function opposite(side: Side): Side {
  return side === 'home' ? 'away' : 'home'
}

export function isOvertime(period: number): boolean {
  return period > REGULATION_PERIODS
}

/** Overtime periods count as an extension of the 4th quarter for team fouls. */
export function teamFoulPeriod(period: number): number {
  return Math.min(period, REGULATION_PERIODS)
}

export function periodLengthMs(game: Pick<Game, 'periodLengthMin' | 'otLengthMin'>, period: number): number {
  return (isOvertime(period) ? game.otLengthMin : game.periodLengthMin) * 60_000
}

export function currentClockMs(game: Pick<Game, 'clockMs' | 'clockRunningSince'>, now = Date.now()): number {
  if (game.clockRunningSince == null) return game.clockMs
  return Math.max(0, game.clockMs - (now - game.clockRunningSince))
}

export function formatClock(ms: number): string {
  const totalSec = Math.ceil(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface FoulCounts {
  total: number
  byType: Record<FoulType, number>
}

export function isPlayerDisqualified(f: FoulCounts): boolean {
  const { T, U, D } = f.byType
  return f.total >= PLAYER_FOUL_LIMIT || D > 0 || T >= 2 || U >= 2 || (T >= 1 && U >= 1)
}

export function isCoachDisqualified(c: { C: number; B: number }): boolean {
  return c.C >= 2 || c.C + c.B >= 3
}

/** Free throws normally awarded for a foul type; P depends on the team-foul penalty. */
export function defaultFreeThrows(type: FoulType, opts: { inPenalty: boolean; andOne: boolean }): number {
  switch (type) {
    case 'S':
      return opts.andOne ? 1 : 2
    case 'U':
    case 'D':
      return 2
    case 'T':
      return 1
    case 'P':
      return opts.inPenalty ? 2 : 0
    case 'O':
      return 0
  }
}

/** FIBA half court geometry in meters, basket at the baseline (y = 0). */
export const COURT = {
  width: 15,
  length: 14,
  basketX: 7.5,
  basketY: 1.575,
  threeRadius: 6.75,
  cornerThreeX: 0.9,
  /** y where the corner straight lines meet the arc */
  cornerThreeY: 1.575 + Math.sqrt(6.75 ** 2 - 6.6 ** 2),
  laneHalfWidth: 2.45,
  laneLength: 5.8,
  ftCircleRadius: 1.8,
  restrictedRadius: 1.25,
}

export function isThreeByLocation(x: number, y: number): boolean {
  if (y <= COURT.cornerThreeY) return x < COURT.cornerThreeX || x > COURT.width - COURT.cornerThreeX
  return Math.hypot(x - COURT.basketX, y - COURT.basketY) > COURT.threeRadius
}

export type Zone = 'paint' | 'mid' | 'corner3' | 'above3'

export function shotZone(type: 'FG2' | 'FG3', x: number, y: number): Zone {
  if (type === 'FG3') return y <= COURT.cornerThreeY ? 'corner3' : 'above3'
  const inPaint = Math.abs(x - COURT.basketX) <= COURT.laneHalfWidth && y <= COURT.laneLength
  return inPaint ? 'paint' : 'mid'
}

export function periodLabel(period: number, lang: 'el' | 'en'): string {
  if (isOvertime(period)) {
    const n = period - REGULATION_PERIODS
    return lang === 'el' ? `Παρ${n}` : `OT${n}`
  }
  return lang === 'el' ? `${period}η` : `Q${period}`
}
