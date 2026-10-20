import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from './db/db'
import type { Competition, Game, GameEvent, Player, Season, Side, Team } from './db/types'
import { computeGameStats, type GameStats } from './stats/compute'

export function useTeams(): Team[] | undefined {
  return useLiveQuery(() => db.teams.orderBy('name').toArray(), [])
}

export function useMyTeam(): Team | null | undefined {
  return useLiveQuery(async () => (await db.teams.filter(t => t.isMine).first()) ?? null, [])
}

export function useSeasons(): Season[] | undefined {
  return useLiveQuery(() => db.seasons.reverse().toArray(), [])
}

export function useCompetitions(): Competition[] | undefined {
  return useLiveQuery(() => db.competitions.toArray(), [])
}

export function usePlayers(): Player[] | undefined {
  return useLiveQuery(() => db.players.toArray(), [])
}

/** A stored setting; undefined while loading, null when unset. */
export function useSetting<T>(key: string): T | null | undefined {
  return useLiveQuery(async () => ((await db.settings.get(key))?.value as T | undefined) ?? null, [key])
}

export const SETTING_LAST_BACKUP = 'lastBackupAt'
export const SETTING_REMINDER_DAYS = 'backupReminderDays'
export const DEFAULT_REMINDER_DAYS = 7

export function useById<T extends { id?: number }>(items: T[] | undefined): Map<number, T> {
  return useMemo(() => new Map((items ?? []).map(i => [i.id!, i])), [items])
}

export function mySideOf(game: Pick<Game, 'homeTeamId' | 'awayTeamId'>, myTeamId?: number): Side | null {
  if (myTeamId == null) return null
  if (game.homeTeamId === myTeamId) return 'home'
  if (game.awayTeamId === myTeamId) return 'away'
  return null
}

export interface GameData {
  game: Game
  events: GameEvent[]
  stats: GameStats
}

/** Games matching a filter, with their events and computed stats, newest first. */
export function useGamesData(filter: (g: Game) => boolean, deps: unknown[]): GameData[] | undefined {
  return useLiveQuery(async () => {
    const games = (await db.games.toArray()).filter(filter)
    const events = await db.events.where('gameId').anyOf(games.map(g => g.id!)).toArray()
    const byGame = new Map<number, GameEvent[]>()
    for (const e of events) {
      let list = byGame.get(e.gameId)
      if (!list) byGame.set(e.gameId, (list = []))
      list.push(e)
    }
    return games
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .map(game => {
        const evs = (byGame.get(game.id!) ?? []).sort((a, b) => a.seq - b.seq)
        return { game, events: evs, stats: computeGameStats(evs, game) }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
