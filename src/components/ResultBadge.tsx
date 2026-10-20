import { useI18n } from '../i18n'
import { mySideOf, type GameData } from '../hooks'
import { opposite } from '../stats/rules'

export function ResultBadge({ gd, myTeamId }: { gd: GameData; myTeamId?: number }) {
  const { t } = useI18n()
  if (gd.game.status === 'live') return <span className="badge badge-live">{t('common.live')}</span>
  const side = mySideOf(gd.game, myTeamId)
  if (!side) return <span className="badge">{t('common.final')}</span>
  const us = gd.stats.teams[side].score
  const them = gd.stats.teams[opposite(side)].score
  if (us === them) return <span className="badge">{t('common.final')}</span>
  return us > them
    ? <span className="badge badge-win">{t('common.win')}</span>
    : <span className="badge badge-loss">{t('common.loss')}</span>
}
