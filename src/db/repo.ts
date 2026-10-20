import Dexie from 'dexie'
import { db, TABLES } from './db'
import type { Game, GameEvent, Player, Side } from './types'
import type { Draft } from '../live/flow'
import { currentClockMs, DEFAULT_OT_MIN, DEFAULT_PERIOD_MIN, periodLengthMs } from '../stats/rules'

const now = () => Date.now()

// ---------- seasons & competitions ----------

export async function addSeason(name: string): Promise<number> {
  return db.seasons.add({ name: name.trim(), createdAt: now() }) as Promise<number>
}

export async function addCompetition(seasonId: number, name: string): Promise<number> {
  return db.competitions.add({ seasonId, name: name.trim(), createdAt: now() }) as Promise<number>
}

export async function deleteSeason(id: number) {
  const comps = await db.competitions.where('seasonId').equals(id).primaryKeys()
  if (await db.games.where('competitionId').anyOf(comps as number[]).count()) throw new Error('has-games')
  await db.transaction('rw', db.seasons, db.competitions, async () => {
    await db.competitions.bulkDelete(comps)
    await db.seasons.delete(id)
  })
}

export async function deleteCompetition(id: number) {
  if (await db.games.where('competitionId').equals(id).count()) throw new Error('has-games')
  await db.competitions.delete(id)
}

// ---------- teams & players ----------

export async function addTeam(name: string, isMine = false): Promise<number> {
  return db.transaction('rw', db.teams, async () => {
    if (isMine) await clearMyTeam()
    return db.teams.add({ name: name.trim(), isMine, createdAt: now() }) as Promise<number>
  })
}

async function clearMyTeam() {
  await db.teams.filter(t => t.isMine).modify({ isMine: false })
}

export async function setMyTeam(id: number) {
  await db.transaction('rw', db.teams, async () => {
    await clearMyTeam()
    await db.teams.update(id, { isMine: true })
  })
}

export async function deleteTeam(id: number) {
  const used = await db.games.where('homeTeamId').equals(id).or('awayTeamId').equals(id).count()
  if (used) throw new Error('has-games')
  await db.transaction('rw', db.teams, db.players, async () => {
    await db.players.where('teamId').equals(id).delete()
    await db.teams.delete(id)
  })
}

export async function addPlayer(p: Omit<Player, 'id' | 'createdAt' | 'active'> & { active?: boolean }): Promise<number> {
  return db.players.add({ active: true, ...p, name: p.name.trim(), number: p.number.trim(), createdAt: now() }) as Promise<number>
}

/** Quick roster entry: "4 7 Papadopoulos, 10 Nikolaou" → players. Returns created ids. */
export async function addPlayersQuick(teamId: number, text: string): Promise<number[]> {
  const entries = text.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean).flatMap(chunk => {
    // A chunk is either "12 Name Surname" or a run of bare numbers "4 5 7"
    if (/^\d+(\s+\d+)*$/.test(chunk)) return chunk.split(/\s+/).map(number => ({ number, name: '' }))
    const m = chunk.match(/^(\d+)\s+(.+)$/)
    return m ? [{ number: m[1], name: m[2] }] : [{ number: '', name: chunk }]
  })
  const ids: number[] = []
  for (const e of entries) ids.push(await addPlayer({ teamId, ...e }))
  return ids
}

export function playerLabel(p: Pick<Player, 'name' | 'number'> | undefined): string {
  if (!p) return '?'
  if (p.number && p.name) return `#${p.number} ${p.name}`
  return p.number ? `#${p.number}` : p.name
}

export function sortPlayers<T extends Pick<Player, 'number' | 'name'>>(players: T[]): T[] {
  return [...players].sort((a, b) => {
    const na = parseInt(a.number, 10)
    const nb = parseInt(b.number, 10)
    if (Number.isNaN(na) !== Number.isNaN(nb)) return Number.isNaN(na) ? 1 : -1
    if (na !== nb && !Number.isNaN(na)) return na - nb
    return a.name.localeCompare(b.name)
  })
}

// ---------- games ----------

export interface NewGame {
  competitionId: number
  date: string
  homeTeamId: number
  awayTeamId: number
  venue?: string
  roster: Record<Side, number[]>
  clockEnabled: boolean
  periodLengthMin?: number
  otLengthMin?: number
}

export async function createGame(g: NewGame): Promise<number> {
  const periodLengthMin = g.periodLengthMin ?? DEFAULT_PERIOD_MIN
  const game: Game = {
    ...g,
    periodLengthMin,
    otLengthMin: g.otLengthMin ?? DEFAULT_OT_MIN,
    status: 'live',
    period: 1,
    clockMs: periodLengthMin * 60_000,
    clockRunningSince: null,
    lastGroup: 0,
    createdAt: now(),
    updatedAt: now(),
  }
  return db.games.add(game) as Promise<number>
}

export async function updateGame(id: number, changes: Partial<Game>) {
  await db.games.update(id, { ...changes, updatedAt: now() })
}

export async function deleteGame(id: number) {
  await db.transaction('rw', db.games, db.events, async () => {
    await db.events.where('gameId').equals(id).delete()
    await db.games.delete(id)
  })
}

export async function getGameEvents(gameId: number): Promise<GameEvent[]> {
  return db.events.where('[gameId+seq]').between([gameId, Dexie.minKey], [gameId, Dexie.maxKey]).toArray()
}

/**
 * Store events produced by one step of the entry flow.
 * group 'new' starts a new undo group; returns the group used and the new event ids.
 */
export async function appendEvents(gameId: number, drafts: Draft[], group: number | 'new'): Promise<{ group: number; ids: number[] }> {
  return db.transaction('rw', db.games, db.events, async () => {
    const game = await db.games.get(gameId)
    if (!game) throw new Error('game not found')
    const g = group === 'new' ? game.lastGroup + 1 : group
    if (drafts.length === 0) return { group: g, ids: [] }
    const last = await db.events.where('[gameId+seq]').between([gameId, Dexie.minKey], [gameId, Dexie.maxKey]).last()
    let seq = last?.seq ?? 0
    const t = now()
    const clockMs = game.clockEnabled ? currentClockMs(game, t) : undefined
    const ids = await db.events.bulkAdd(drafts.map(d => ({
      ...d, gameId, seq: ++seq, group: g, period: game.period, createdAt: t,
      ...(clockMs != null ? { clockMs } : {}),
    })), { allKeys: true })
    await db.games.update(gameId, { lastGroup: Math.max(game.lastGroup, g), updatedAt: t })
    return { group: g, ids: ids as number[] }
  })
}

/** Remove the most recent group of events. Returns the removed events. */
export async function undoLastGroup(gameId: number): Promise<GameEvent[]> {
  return db.transaction('rw', db.events, async () => {
    const last = await db.events.where('[gameId+seq]').between([gameId, Dexie.minKey], [gameId, Dexie.maxKey]).last()
    if (!last) return []
    const removed = await db.events.where('[gameId+group]').equals([gameId, last.group]).toArray()
    await db.events.bulkDelete(removed.map(e => e.id!))
    return removed
  })
}

export async function deleteEvents(ids: number[]) {
  await db.events.bulkDelete(ids)
}

export async function deleteEvent(id: number) {
  await db.events.delete(id)
}

export async function deleteGroup(gameId: number, group: number) {
  await db.events.where('[gameId+group]').equals([gameId, group]).delete()
}

export async function updateEvent(id: number, changes: Partial<GameEvent>) {
  await db.events.update(id, changes)
}

// ---------- clock & periods ----------

export async function startClock(game: Game) {
  if (game.clockRunningSince != null || game.clockMs <= 0) return
  await updateGame(game.id!, { clockRunningSince: now() })
}

export async function stopClock(game: Game) {
  if (game.clockRunningSince == null) return
  await updateGame(game.id!, { clockMs: currentClockMs(game), clockRunningSince: null })
}

export async function adjustClock(game: Game, deltaMs: number) {
  const max = periodLengthMs(game, game.period)
  if (game.clockRunningSince == null) {
    await updateGame(game.id!, { clockMs: clamp(game.clockMs + deltaMs, 0, max) })
  } else {
    // While running, shift the base so the displayed time moves by delta
    const shown = currentClockMs(game)
    const target = clamp(shown + deltaMs, 0, max)
    await updateGame(game.id!, { clockMs: game.clockMs + (target - shown) })
  }
}

export async function setPeriod(game: Game, period: number) {
  await updateGame(game.id!, { period, clockMs: periodLengthMs(game, period), clockRunningSince: null })
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

// ---------- settings ----------

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value })
}

// ---------- backup ----------

export const BACKUP_APP_ID = 'statistika-agwnwn'

export interface BackupFile {
  app: typeof BACKUP_APP_ID
  version: 1
  exportedAt: string
  data: Record<(typeof TABLES)[number], unknown[]>
}

export async function exportBackup(): Promise<BackupFile> {
  const data = {} as BackupFile['data']
  await db.transaction('r', TABLES.map(t => db.table(t)), async () => {
    for (const t of TABLES) data[t] = await db.table(t).toArray()
  })
  return { app: BACKUP_APP_ID, version: 1, exportedAt: new Date().toISOString(), data }
}

export function parseBackup(text: string): BackupFile {
  const parsed = JSON.parse(text) as Partial<BackupFile>
  if (parsed.app !== BACKUP_APP_ID || parsed.version !== 1 || typeof parsed.data !== 'object' || !parsed.data) {
    throw new Error('not-a-backup')
  }
  for (const t of TABLES) {
    if (!Array.isArray(parsed.data[t])) throw new Error('not-a-backup')
  }
  return parsed as BackupFile
}

/** Replace the whole database with the backup contents. */
export async function restoreBackup(backup: BackupFile) {
  await db.transaction('rw', TABLES.map(t => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
      await db.table(t).bulkAdd(backup.data[t])
    }
  })
}

export async function clearAllData() {
  await db.transaction('rw', TABLES.map(t => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear()
  })
}
