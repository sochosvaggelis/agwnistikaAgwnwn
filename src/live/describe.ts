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
