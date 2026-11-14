import type { Game, Player, Side } from './types'

/** A name reduced to what tells people apart: no accents, no case, words in any order ("Νάνος Γιάννης" = "ΓΙΑΝΝΗΣ ΝΑΝΟΣ") */
function nameKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('el').replace(/ς/g, 'σ')
    .split(/\s+/).filter(Boolean).sort().join(' ')
}

/** Whether two names are the same person's; players known only by number never match */
export function samePlayerName(a: string, b: string): boolean {
  const ka = nameKey(a)
  return ka !== '' && ka === nameKey(b)
}

/** The team's players with the same name as `name` */
export function playersNamed<T extends Pick<Player, 'name'>>(players: T[], name: string): T[] {
  return players.filter(p => samePlayerName(p.name, name))
}

/** Groups of two or more players of a team who have the same name, likely one person entered twice */
export function sameNameGroups<T extends Pick<Player, 'name'>>(players: T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const p of players) {
    const key = nameKey(p.name)
    if (key) groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups.values()].filter(g => g.length > 1)
}

/** The number a player wore in a game: their own, unless they wore another in that game */
export function numberInGame(p: Pick<Player, 'id' | 'number'>, game: Pick<Game, 'numbers'>): string {
  return game.numbers?.[p.id!] ?? p.number
}

/** The player as they were in a game, with the number they wore in it */
export function asInGame<T extends Player>(p: T, game: Pick<Game, 'numbers'>): T {
  const n = game.numbers?.[p.id!]
  return n == null ? p : { ...p, number: n }
}

/** A game's numbers after one player's number in it is set; their own number, or none, clears it */
export function withGameNumber(game: Pick<Game, 'numbers'>, p: Pick<Player, 'id' | 'number'>, number: string): Game['numbers'] {
  const numbers = { ...game.numbers }
  const n = number.trim()
  if (n && n !== p.number) numbers[p.id!] = n
  else delete numbers[p.id!]
  return numbers
}

/**
 * A game after `from` is merged into `into`: `into` takes `from`'s place in the roster,
 * and keeps the number `from` wore there when it isn't `into`'s own. Null when `from` wasn't in the game.
 */
export function mergedGame(game: Pick<Game, 'roster' | 'numbers'>, from: Player, into: Player): Pick<Game, 'roster' | 'numbers'> | null {
  const side = (['home', 'away'] as Side[]).find(s => game.roster[s].includes(from.id!))
  if (!side) return null
  if (game.roster.home.includes(into.id!) || game.roster.away.includes(into.id!)) throw new Error('both-in-game')
  const worn = numberInGame(from, game)
  const numbers = { ...game.numbers }
  delete numbers[from.id!]
  return {
    roster: { ...game.roster, [side]: game.roster[side].map(id => (id === from.id ? into.id! : id)) },
    numbers: withGameNumber({ numbers }, into, worn),
  }
}
