import type { Competition, CompetitionKind } from './types'

export const COMPETITION_KINDS: CompetitionKind[] = ['league', 'cup', 'friendly', 'other']

/** The competitions every new season starts with */
export const DEFAULT_KINDS: CompetitionKind[] = ['league', 'cup', 'friendly']

/** Names that identify a kind on competitions created before kinds were stored */
const KNOWN_NAMES: Record<Exclude<CompetitionKind, 'other'>, string[]> = {
  league: ['Πρωτάθλημα', 'League'],
  cup: ['Κύπελλο', 'Κύπελο', 'Cup'],
  friendly: ['Φιλικά', 'Φιλικό', 'Friendlies', 'Friendly'],
}

/** Names match regardless of case, accents and surrounding spaces. */
export function sameName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), 'el', { sensitivity: 'base' }) === 0
}

export function competitionKind(c: Pick<Competition, 'kind' | 'name'>): CompetitionKind {
  if (c.kind) return c.kind
  const known = (Object.keys(KNOWN_NAMES) as (keyof typeof KNOWN_NAMES)[])
    .find(k => KNOWN_NAMES[k].some(n => sameName(n, c.name)))
  return known ?? 'other'
}

/** Kinds a season can still add, given its competitions. */
export function availableKinds(competitions: Pick<Competition, 'kind' | 'name'>[]): CompetitionKind[] {
  if (competitions.length >= COMPETITION_KINDS.length) return []
  const taken = new Set(competitions.map(competitionKind))
  return COMPETITION_KINDS.filter(k => !taken.has(k))
}
