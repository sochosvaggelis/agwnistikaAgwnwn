import type { Game, GameEvent, Side } from '../db/types'
import { currentClockMs, gameElapsedMs } from './rules'

export type GameTiming = Pick<Game, 'periodLengthMin' | 'otLengthMin' | 'status' | 'period' | 'clockEnabled' | 'clockMs' | 'clockRunningSince'>

const isSub = (ev: GameEvent) => (ev.type === 'SUB_IN' || ev.type === 'SUB_OUT') && ev.playerId != null

/** Players on the court for each team, from the substitutions so far; null for a team with none (not tracked). */
export function lineups(events: GameEvent[]): Record<Side, number[] | null> {
  const on: Record<Side, Set<number> | null> = { home: null, away: null }
  for (const ev of events) {
    if (!isSub(ev)) continue
    const set = (on[ev.side] ??= new Set())
    if (ev.type === 'SUB_IN') set.add(ev.playerId!)
    else set.delete(ev.playerId!)
  }
  return { home: on.home && [...on.home], away: on.away && [...on.away] }
}

/**
 * Time on court for each player who entered the game. A stint whose start or end has no time makes
 * the player's total unknown (null). Players still on court count until the end of the last period
 * once the game is over, or until the clock now while it is live; without a clock that end is unknown.
 */
export function minutesPlayed(events: GameEvent[], game: GameTiming, now = Date.now()): Map<number, number | null> {
  const total = new Map<number, number | null>()
  const since = new Map<number, number | null>()
  const add = (id: number, from: number | null, to: number | null) => {
    const prev = total.has(id) ? total.get(id)! : 0
    total.set(id, prev == null || from == null || to == null ? null : prev + Math.max(0, to - from))
  }

  for (const ev of events) {
    if (!isSub(ev)) continue
    const id = ev.playerId!
    const at = ev.clockMs != null ? gameElapsedMs(game, ev.period, ev.clockMs) : null
    if (ev.type === 'SUB_IN') {
      if (!total.has(id)) total.set(id, 0)
      since.set(id, at)
    } else if (since.has(id)) {
      add(id, since.get(id)!, at)
      since.delete(id)
    }
  }

  const end = game.status === 'finished'
    ? gameElapsedMs(game, game.period, 0)
    : game.clockEnabled ? gameElapsedMs(game, game.period, currentClockMs(game, now)) : null
  for (const [id, from] of since) add(id, from, end)
  return total
}
