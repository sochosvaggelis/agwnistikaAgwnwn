import type { Side } from '../db/types'
import type { GameData } from '../hooks'
import { addLines, emptyLine, type StatLine } from './compute'
import { opposite } from './rules'

export interface PlayerAgg {
  playerId: number
  gp: number
  line: StatLine
}

/** Sum player lines over games; `sideOf` picks which side's players to include per game. */
export function aggregatePlayers(games: GameData[], sideOf: (gd: GameData) => Side | null): PlayerAgg[] {
  const out = new Map<number, PlayerAgg>()
  for (const gd of games) {
    const side = sideOf(gd)
    if (!side) continue
    for (const [pid, s] of gd.stats.playerSide) {
      if (s !== side) continue
      let agg = out.get(pid)
      if (!agg) out.set(pid, (agg = { playerId: pid, gp: 0, line: emptyLine() }))
      agg.gp++
      addLines(agg.line, gd.stats.players.get(pid)!)
    }
  }
  return [...out.values()]
}

export interface TeamAgg {
  gp: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  us: StatLine
  them: StatLine
}

export function aggregateTeam(games: GameData[], sideOf: (gd: GameData) => Side | null): TeamAgg {
  const agg: TeamAgg = { gp: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, us: emptyLine(), them: emptyLine() }
  for (const gd of games) {
    const side = sideOf(gd)
    if (!side) continue
    const us = gd.stats.teams[side]
    const them = gd.stats.teams[opposite(side)]
    agg.gp++
    agg.pointsFor += us.score
    agg.pointsAgainst += them.score
    if (us.score > them.score) agg.wins++
    else if (us.score < them.score) agg.losses++
    addLines(agg.us, us.totals)
    addLines(agg.them, them.totals)
  }
  return agg
}
