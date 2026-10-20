import { COURT, type Zone } from './rules'
import type { Shot } from './compute'

/** The court split into areas for the zone heatmap. L and R are as drawn, with the basket at the top. */
export type CourtZone =
  | 'paint'
  | 'midBaseL' | 'midWingL' | 'midTop' | 'midWingR' | 'midBaseR'
  | 'corner3L' | 'wing3L' | 'top3' | 'wing3R' | 'corner3R'

export const COURT_ZONES: CourtZone[] = [
  'paint', 'midBaseL', 'midWingL', 'midTop', 'midWingR', 'midBaseR', 'corner3L', 'wing3L', 'top3', 'wing3R', 'corner3R',
]

/** Directions (degrees from the basket, see angleFromBasket) where the baseline, wing and top areas meet */
export const BASE_WING = 30
export const WING_TOP = 70

/** Direction of a point from the basket: 0 along the baseline to the right, 90 straight out, 180 to the left, up to 270. */
export function angleFromBasket(x: number, y: number): number {
  const a = (Math.atan2(y - COURT.basketY, x - COURT.basketX) * 180) / Math.PI
  return a < -90 ? a + 360 : a
}

/** The zone of a shot. Twos and threes go by how the shot was recorded, like the zone table. */
export function courtZone(s: Pick<Shot, 'type' | 'x' | 'y'>): CourtZone {
  const a = angleFromBasket(s.x, s.y)
  if (s.type === 'FG3') {
    if (s.y <= COURT.cornerThreeY) return s.x < COURT.basketX ? 'corner3L' : 'corner3R'
    return a < WING_TOP ? 'wing3R' : a > 180 - WING_TOP ? 'wing3L' : 'top3'
  }
  if (Math.abs(s.x - COURT.basketX) <= COURT.laneHalfWidth && s.y <= COURT.laneLength) return 'paint'
  if (a < BASE_WING) return 'midBaseR'
  if (a < WING_TOP) return 'midWingR'
  if (a <= 180 - WING_TOP) return 'midTop'
  if (a <= 180 - BASE_WING) return 'midWingL'
  return 'midBaseL'
}

export function zoneShotType(z: CourtZone): 'FG2' | 'FG3' {
  return z === 'corner3L' || z === 'wing3L' || z === 'top3' || z === 'wing3R' || z === 'corner3R' ? 'FG3' : 'FG2'
}

/** The row of the zone table a court zone belongs to */
export function zoneGroup(z: CourtZone): Zone {
  if (z === 'paint') return 'paint'
  if (z === 'corner3L' || z === 'corner3R') return 'corner3'
  return zoneShotType(z) === 'FG3' ? 'above3' : 'mid'
}

export function courtZoneSplits(shots: Shot[]): Record<CourtZone, { m: number; a: number }> {
  const out = Object.fromEntries(COURT_ZONES.map(z => [z, { m: 0, a: 0 }])) as Record<CourtZone, { m: number; a: number }>
  for (const s of shots) {
    const z = out[courtZone(s)]
    z.a++
    if (s.made) z.m++
  }
  return out
}

/**
 * How hot a zone is, from -3 (cold) to 3 (hot): its points per shot against 1,
 * which is 50% on twos and 33.3% on threes, so both read on the same scale.
 */
export function zoneHeat(z: CourtZone, made: number, attempts: number): number {
  const diff = ((zoneShotType(z) === 'FG3' ? 3 : 2) * made) / attempts - 1
  const size = Math.abs(diff)
  const step = size < 0.1 ? 0 : size < 0.25 ? 1 : size < 0.45 ? 2 : 3
  return Math.sign(diff) * step
}
