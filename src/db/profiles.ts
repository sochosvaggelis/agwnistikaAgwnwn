import Dexie from 'dexie'
import { activeDbName, db, DEFAULT_DB, isStatsDbName, openStatsDb, setActiveDbName, type StatsDb } from './db'
import type { Team } from './types'

/**
 * Each of my teams lives in its own database, with its own seasons, opponents, games and backups:
 * the teams can be in unrelated leagues, so nothing is shared between them.
 */
export interface Profile {
  dbName: string
  /** The team marked as mine in that database; missing when none is marked yet */
  team?: Pick<Team, 'name' | 'colors'>
  games: number
  lastBackupAt?: number
  active: boolean
}

async function describe(d: StatsDb, dbName: string): Promise<Profile> {
  const [mine, games, backup] = await Promise.all([
    d.teams.filter(t => t.isMine).first(),
    d.games.count(),
    d.settings.get('lastBackupAt'),
  ])
  return {
    dbName,
    team: mine && { name: mine.name, colors: mine.colors },
    games,
    lastBackupAt: backup?.value as number | undefined,
    active: dbName === db.name,
  }
}

export async function listProfiles(): Promise<Profile[]> {
  const names = (await Dexie.getDatabaseNames()).filter(isStatsDbName)
  if (!names.includes(db.name)) names.push(db.name)
  const profiles = await Promise.all(names.map(async name => {
    if (name === db.name) return describe(db, name)
    const other = openStatsDb(name)
    try {
      return await describe(other, name)
    } finally {
      other.close()
    }
  }))
  // The first team stays first, the rest in the order they were added (their names carry the time)
  return profiles.sort((a, b) => (a.dbName === DEFAULT_DB ? -1 : b.dbName === DEFAULT_DB ? 1 : a.dbName.localeCompare(b.dbName)))
}

/** Open another team's database: the app reloads on the games list, since ids mean nothing across databases. */
export function switchProfile(dbName: string) {
  if (dbName === activeDbName()) return
  setActiveDbName(dbName)
  location.hash = '#/'
  location.reload()
}

/** Create an empty database whose only team is the new team of mine, and open it. */
export async function createProfile(teamName: string) {
  const dbName = `${DEFAULT_DB}-${Date.now().toString(36)}`
  const d = openStatsDb(dbName)
  try {
    await d.teams.add({ name: teamName.trim(), isMine: true, createdAt: Date.now() })
  } finally {
    d.close()
  }
  switchProfile(dbName)
}

/** Delete another team's whole database. The open one can't be deleted; erase its data instead. */
export async function deleteProfile(dbName: string) {
  if (dbName === db.name) throw new Error('active-profile')
  await Dexie.delete(dbName)
}
