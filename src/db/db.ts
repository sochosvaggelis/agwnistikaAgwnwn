import Dexie, { type EntityTable } from 'dexie'
import type { Competition, Game, GameEvent, Player, Season, Setting, Team } from './types'

export type StatsDb = Dexie & {
  seasons: EntityTable<Season, 'id'>
  competitions: EntityTable<Competition, 'id'>
  teams: EntityTable<Team, 'id'>
  players: EntityTable<Player, 'id'>
  games: EntityTable<Game, 'id'>
  events: EntityTable<GameEvent, 'id'>
  settings: EntityTable<Setting, 'key'>
}

/** The database of the first team, and the prefix of every other team's: each of my teams has its own database */
export const DEFAULT_DB = 'statistika'
const ACTIVE_DB_KEY = 'activeDb'

export function isStatsDbName(name: string): boolean {
  return name === DEFAULT_DB || name.startsWith(`${DEFAULT_DB}-`)
}

/** The database the app opens; switching team stores another name here and reloads the app */
export function activeDbName(): string {
  try {
    const saved = localStorage.getItem(ACTIVE_DB_KEY)
    if (saved && isStatsDbName(saved)) return saved
  } catch {
    // storage unavailable (tests, private mode)
  }
  return DEFAULT_DB
}

export function setActiveDbName(name: string) {
  localStorage.setItem(ACTIVE_DB_KEY, name)
}

export function openStatsDb(name: string): StatsDb {
  const d = new Dexie(name) as StatsDb
  d.version(1).stores({
    seasons: '++id, name',
    competitions: '++id, seasonId',
    teams: '++id, name',
    players: '++id, teamId',
    games: '++id, competitionId, date, homeTeamId, awayTeamId, status',
    events: '++id, gameId, [gameId+seq], [gameId+group]',
    settings: 'key',
  })
  return d
}

export const db = openStatsDb(activeDbName())

export const TABLES = ['seasons', 'competitions', 'teams', 'players', 'games', 'events', 'settings'] as const

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
