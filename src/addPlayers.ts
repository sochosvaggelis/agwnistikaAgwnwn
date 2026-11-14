import { db } from './db/db'
import { addPlayer, parseQuickPlayers, playerLabel } from './db/repo'
import { playersNamed } from './db/players'
import type { TFunction } from './i18n'

/**
 * Adding players by hand, warning first about names the team already has:
 * a player who wore another number in one game is still the same player.
 */

/** True to go on: no name is on the team yet, or the user wants new players anyway */
async function confirmNewNames(teamId: number, names: string[], t: TFunction): Promise<boolean> {
  const team = await db.players.where('teamId').equals(teamId).toArray()
  const same = [...new Set(names.flatMap(name => playersNamed(team, name)))]
  return same.length === 0 || confirm(t('teams.sameNameConfirm', { who: same.map(playerLabel).join(', ') }))
}

/** The new player's id, or null when the user stopped */
export async function addPlayerChecked(teamId: number, number: string, name: string, t: TFunction): Promise<number | null> {
  if (!(await confirmNewNames(teamId, [name], t))) return null
  return addPlayer({ teamId, number, name })
}

/** The new players' ids, or null when the user stopped */
export async function addPlayersQuickChecked(teamId: number, text: string, t: TFunction): Promise<number[] | null> {
  const entries = parseQuickPlayers(text)
  if (!(await confirmNewNames(teamId, entries.map(e => e.name), t))) return null
  const ids: number[] = []
  for (const e of entries) ids.push(await addPlayer({ teamId, ...e }))
  return ids
}
