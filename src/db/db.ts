import Dexie, { type EntityTable } from 'dexie'
import type { Competition, Game, GameEvent, Player, Season, Setting, Team } from './types'

export const db = new Dexie('statistika') as Dexie & {
  seasons: EntityTable<Season, 'id'>
  competitions: EntityTable<Competition, 'id'>
  teams: EntityTable<Team, 'id'>
  players: EntityTable<Player, 'id'>
  games: EntityTable<Game, 'id'>
  events: EntityTable<GameEvent, 'id'>
  settings: EntityTable<Setting, 'key'>
}

db.version(1).stores({
  seasons: '++id, name',
  competitions: '++id, seasonId',
  teams: '++id, name',
  players: '++id, teamId',
  games: '++id, competitionId, date, homeTeamId, awayTeamId, status',
  events: '++id, gameId, [gameId+seq], [gameId+group]',
  settings: 'key',
})

export const TABLES = ['seasons', 'competitions', 'teams', 'players', 'games', 'events', 'settings'] as const

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
