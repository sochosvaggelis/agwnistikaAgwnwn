import { Link } from 'react-router'
import { useI18n } from '../i18n'
import {
  DEFAULT_REMINDER_DAYS, SETTING_LAST_BACKUP, SETTING_REMINDER_DAYS, useById, useGamesData, useMyTeam, useSetting, useTeams,
} from '../hooks'
import { SeasonFilter, useSeasonFilter } from '../components/SeasonFilter'
import { fmtDate } from '../format'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { ResultBadge } from '../components/ResultBadge'

export function GamesPage() {
  const { t, lang } = useI18n()
  const filter = useSeasonFilter()
  const games = useGamesData(filter.matches, [filter.key])
  const liveGames = useGamesData(g => g.status === 'live', [])
  const teams = useById(useTeams())
  const myTeam = useMyTeam()
  const comps = useById(filter.competitions)

  const name = (id: number) => teams.get(id)?.name ?? '?'

  return (
    <>
      <BackupReminder />
      {liveGames?.map(({ game }) => (
        <div key={game.id} className="banner banner-live">
          <span>{t('common.live')}: {name(game.homeTeamId)} – {name(game.awayTeamId)}</span>
          <Link className="btn btn-primary" to={`/games/${game.id}/live`}>{t('games.continueLive')}</Link>
        </div>
      ))}

      <div className="page-head">
        <h1>{t('games.title')}</h1>
        <Link className="btn btn-primary btn-lg" to="/games/new">＋ {t('games.new')}</Link>
      </div>
      <SeasonFilter filter={filter} />

      <div className="card">
        {games && games.length === 0 && <p className="empty">{t('games.empty')}</p>}
        <ul className="list">
          {games?.map(gd => (
            <li key={gd.game.id}>
              <Link className="list-row" to={gd.game.status === 'live' ? `/games/${gd.game.id}/live` : `/games/${gd.game.id}`}>
                <span className="muted" style={{ minWidth: '7em' }}>{fmtDate(gd.game.date, lang)}</span>
                <span className="grow">
                  <b>{name(gd.game.homeTeamId)}</b> – <b>{name(gd.game.awayTeamId)}</b>
                  <div className="muted">{comps.get(gd.game.competitionId)?.name}</div>
                </span>
                <span className="strong" style={{ fontSize: '1.2rem', fontVariantNumeric: 'tabular-nums' }}>
                  {gd.stats.teams.home.score} – {gd.stats.teams.away.score}
                </span>
                <ResultBadge gd={gd} myTeamId={myTeam?.id} />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

function BackupReminder() {
  const { t } = useI18n()
  const last = useSetting<number>(SETTING_LAST_BACKUP)
  const days = useSetting<number>(SETTING_REMINDER_DAYS) ?? DEFAULT_REMINDER_DAYS
  const gameCount = useLiveQuery(() => db.games.count(), [])
  if (last === undefined || !gameCount) return null
  const ageDays = last == null ? null : Math.floor((Date.now() - last) / 86_400_000)
  if (ageDays != null && ageDays < days) return null
  return (
    <div className="banner">
      <span>{ageDays == null ? t('backup.reminderNever') : t('backup.reminderDays', { days: ageDays })}</span>
      <Link className="btn" to="/settings">{t('backup.now')}</Link>
    </div>
  )
}
