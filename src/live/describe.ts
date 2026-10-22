import type { GameEvent, Player } from '../db/types'
import { playerLabel } from '../db/repo'
import type { TFunction } from '../i18n'

export function describeEvent(ev: GameEvent, players: Map<number, Player>, t: TFunction): string {
  const who = ev.playerId != null ? playerLabel(players.get(ev.playerId)) : ''
  const target = ev.targetPlayerId != null ? ` ${t('ev.on')} ${playerLabel(players.get(ev.targetPlayerId))}` : ''
  switch (ev.type) {
    case 'FG2':
    case 'FG3':
    case 'FT':
      return `${who} ${t(`ev.${ev.type}.${ev.made ? 'made' : 'missed'}`)}`
    case 'BLK':
      return `${who} ${t('ev.BLK')}${target}`
    case 'FOUL':
      return `${who} ${t('ev.FOUL')} (${t(`foul.${ev.foulType ?? 'P'}`)})${target}`
    case 'COACH_FOUL':
      return `${t('ev.coach')}: ${t(`foul.${ev.coachFoulType ?? 'C'}`)}`
    default:
      return `${who} ${t(`ev.${ev.type}`)}`
  }
}

/** Compact form for the live screen, using the action button labels: "#3 2Π ✗", "#9 Κόψιμο". */
export function describeShort(ev: GameEvent, players: Map<number, Player>, t: TFunction): { who: string; what: string } {
  const p = ev.playerId != null ? players.get(ev.playerId) : undefined
  const who = ev.playerId == null ? t('ev.coach') : p?.number ? `#${p.number}` : (p?.name ?? '?')
  switch (ev.type) {
    case 'FG2':
    case 'FG3':
    case 'FT':
      return { who, what: t(`act.${ev.type}${ev.made ? '+' : '-'}`) }
    case 'FOUL':
      return { who, what: `${t('act.FOUL')} (${t(`foul.${ev.foulType ?? 'P'}`)})` }
    case 'COACH_FOUL':
      return { who, what: t(`foul.${ev.coachFoulType ?? 'C'}`) }
    case 'SUB_IN':
    case 'SUB_OUT':
      return { who, what: t(`ev.${ev.type}`) }
    default:
      return { who, what: t(`act.${ev.type}`) }
  }
}

/** Group consecutive events by their undo group, newest group first. */
export function groupEvents(events: GameEvent[]): GameEvent[][] {
  const groups: GameEvent[][] = []
  for (const ev of events) {
    const last = groups[groups.length - 1]
    if (last && last[0].group === ev.group) last.push(ev)
    else groups.push([ev])
  }
  return groups.reverse()
}
