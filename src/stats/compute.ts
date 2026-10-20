import type { FoulType, Game, GameEvent, Side } from '../db/types'
import { opposite, shotZone, teamFoulPeriod, type FoulCounts, type Zone } from './rules'

export interface StatLine {
  pts: number
  fg2m: number
  fg2a: number
  fg3m: number
  fg3a: number
  ftm: number
  fta: number
  oreb: number
  dreb: number
  ast: number
  stl: number
  blk: number
  /** Own shots that were blocked */
  blka: number
  tov: number
  /** Fouls committed */
  pf: number
  /** Fouls drawn */
  fd: number
  fouls: Record<FoulType, number>
}

export function emptyLine(): StatLine {
  return {
    pts: 0, fg2m: 0, fg2a: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0,
    oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, blka: 0, tov: 0, pf: 0, fd: 0,
    fouls: { P: 0, S: 0, O: 0, T: 0, U: 0, D: 0 },
  }
}

export function addLines(target: StatLine, src: StatLine): StatLine {
  for (const k of Object.keys(src) as (keyof StatLine)[]) {
    if (k === 'fouls') {
      for (const f of Object.keys(src.fouls) as FoulType[]) target.fouls[f] += src.fouls[f]
    } else {
      target[k] += src[k]
    }
  }
  return target
}

export function sumLines(lines: Iterable<StatLine>): StatLine {
  const total = emptyLine()
  for (const l of lines) addLines(total, l)
  return total
}

export const fgm = (l: StatLine) => l.fg2m + l.fg3m
export const fga = (l: StatLine) => l.fg2a + l.fg3a
export const reb = (l: StatLine) => l.oreb + l.dreb

/** FIBA Performance Index Rating */
export function pir(l: StatLine): number {
  const missed = fga(l) - fgm(l) + (l.fta - l.ftm)
  return l.pts + reb(l) + l.ast + l.stl + l.blk + l.fd - (missed + l.tov + l.blka + l.pf)
}

export function pct(made: number, att: number): number | null {
  return att === 0 ? null : made / att
}

export function foulCounts(l: StatLine): FoulCounts {
  return { total: l.pf, byType: l.fouls }
}

export interface TeamGameStats {
  totals: StatLine
  score: number
  /** Points per period, index = period - 1 */
  periodScores: number[]
  /** Team fouls per period (overtime merged into the 4th), index = period - 1 */
  teamFouls: number[]
  coachFouls: { C: number; B: number }
}

export interface GameStats {
  players: Map<number, StatLine>
  /** Side each player appeared on in this game */
  playerSide: Map<number, Side>
  teams: Record<Side, TeamGameStats>
}

function emptyTeam(): TeamGameStats {
  return { totals: emptyLine(), score: 0, periodScores: [], teamFouls: [], coachFouls: { C: 0, B: 0 } }
}

function bump(arr: number[], index: number, by: number) {
  while (arr.length <= index) arr.push(0)
  arr[index] += by
}

const SHOT_KEYS = {
  FG2: [2, 'fg2a', 'fg2m'],
  FG3: [3, 'fg3a', 'fg3m'],
  FT: [1, 'fta', 'ftm'],
} as const

export function computeGameStats(events: GameEvent[], game?: Pick<Game, 'roster'>): GameStats {
  const players = new Map<number, StatLine>()
  const playerSide = new Map<number, Side>()
  const teams: Record<Side, TeamGameStats> = { home: emptyTeam(), away: emptyTeam() }

  if (game) {
    for (const side of ['home', 'away'] as Side[]) {
      for (const id of game.roster[side]) {
        players.set(id, emptyLine())
        playerSide.set(id, side)
      }
    }
  }

  const line = (id: number, side: Side) => {
    let l = players.get(id)
    if (!l) {
      l = emptyLine()
      players.set(id, l)
    }
    if (!playerSide.has(id)) playerSide.set(id, side)
    return l
  }

  for (const ev of events) {
    const team = teams[ev.side]
    if (ev.type === 'COACH_FOUL') {
      if (ev.coachFoulType) team.coachFouls[ev.coachFoulType]++
      continue
    }
    if (ev.playerId == null) continue
    const l = line(ev.playerId, ev.side)
    switch (ev.type) {
      case 'FG2':
      case 'FG3':
      case 'FT': {
        const [pts, att, made] = SHOT_KEYS[ev.type]
        l[att]++
        if (ev.made) {
          l[made]++
          l.pts += pts
          team.score += pts
          bump(team.periodScores, ev.period - 1, pts)
        } else {
          bump(team.periodScores, ev.period - 1, 0)
        }
        break
      }
      case 'OREB': l.oreb++; break
      case 'DREB': l.dreb++; break
      case 'AST': l.ast++; break
      case 'STL': l.stl++; break
      case 'TOV': l.tov++; break
      case 'BLK':
        l.blk++
        if (ev.targetPlayerId != null) line(ev.targetPlayerId, opposite(ev.side)).blka++
        break
      case 'FOUL':
        l.pf++
        if (ev.foulType) l.fouls[ev.foulType]++
        bump(team.teamFouls, teamFoulPeriod(ev.period) - 1, 1)
        if (ev.targetPlayerId != null) line(ev.targetPlayerId, opposite(ev.side)).fd++
        break
    }
  }

  for (const [id, l] of players) addLines(teams[playerSide.get(id)!].totals, l)
  return { players, playerSide, teams }
}

export function teamFoulsInPeriod(team: TeamGameStats, period: number): number {
  return team.teamFouls[teamFoulPeriod(period) - 1] ?? 0
}

export interface Shot {
  type: 'FG2' | 'FG3'
  made: boolean
  x: number
  y: number
}

export function shotsOf(events: GameEvent[], filter: (ev: GameEvent) => boolean): Shot[] {
  const out: Shot[] = []
  for (const ev of events) {
    if ((ev.type === 'FG2' || ev.type === 'FG3') && ev.x != null && ev.y != null && filter(ev)) {
      out.push({ type: ev.type, made: !!ev.made, x: ev.x, y: ev.y })
    }
  }
  return out
}

export function zoneSplits(shots: Shot[]): Record<Zone, { m: number; a: number }> {
  const z: Record<Zone, { m: number; a: number }> = {
    paint: { m: 0, a: 0 }, mid: { m: 0, a: 0 }, corner3: { m: 0, a: 0 }, above3: { m: 0, a: 0 },
  }
  for (const s of shots) {
    const zone = z[shotZone(s.type, s.x, s.y)]
    zone.a++
    if (s.made) zone.m++
  }
  return z
}
