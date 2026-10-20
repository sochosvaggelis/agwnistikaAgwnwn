import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { useI18n } from '../i18n'
import { db } from '../db/db'
import { playerLabel } from '../db/repo'
import { useById, useGamesData, useTeams } from '../hooks'
import { SeasonFilter, useSeasonFilter } from '../components/SeasonFilter'
import { StatTable } from '../components/StatTable'
import { ShotChart } from '../components/ShotChart'
import { ModeToggle } from '../components/ModeToggle'
import { shotsOf, sumLines } from '../stats/compute'
import { opposite } from '../stats/rules'
import { fmtDate } from '../format'

export function PlayerPage() {
  const { id } = useParams()
  const playerId = Number(id)
  const { t, lang } = useI18n()
  const player = useLiveQuery(() => db.players.get(playerId), [playerId])
  const team = useLiveQuery(async () => (player ? db.teams.get(player.teamId) : undefined), [player?.teamId])
  const teams = useById(useTeams())
  const filter = useSeasonFilter()
  const games = useGamesData(
    g => g.status === 'finished' && filter.matches(g) && (g.roster.home.includes(playerId) || g.roster.away.includes(playerId)),
    [filter.key, playerId],
  )
  const [mode, setMode] = useState<'avg' | 'total'>('avg')

  if (player === undefined) return null
  if (!player) return <p>{t('player.notFound')}</p>

  const played = (games ?? []).filter(gd => gd.stats.players.has(playerId))
  const total = sumLines(played.map(gd => gd.stats.players.get(playerId)!))
  const shots = played.flatMap(gd => shotsOf(gd.events, e => e.playerId === playerId))

  return (
    <>
      <div className="page-head">
        <h1>
          {playerLabel(player)}
          {player.position && <span className="muted"> · {player.position}</span>}
        </h1>
        {team && <Link className="btn" to={`/teams/${team.id}`}>{team.name}</Link>}
      </div>
      <SeasonFilter filter={filter} />

      {played.length === 0 ? (
        <p className="empty">{t('common.noData')}</p>
      ) : (
        <>
          <div className="card">
            <div className="page-head">
              <h2 style={{ margin: 0 }}>{mode === 'avg' ? t('common.averages') : t('common.totals')}</h2>
              <ModeToggle mode={mode} setMode={setMode} />
            </div>
            <StatTable
              firstCol=""
              mode={mode}
              showGp
              rows={[{ key: 'sum', label: player.name || playerLabel(player), line: total, gp: played.length }]}
            />
          </div>

          <div className="card">
            <h2>{t('player.gameLog')}</h2>
            <StatTable
              firstCol={t('common.date')}
              rows={played.map(gd => {
                const side = gd.stats.playerSide.get(playerId)!
                const oppId = opposite(side) === 'home' ? gd.game.homeTeamId : gd.game.awayTeamId
                const us = gd.stats.teams[side].score
                const them = gd.stats.teams[opposite(side)].score
                return {
                  key: gd.game.id!,
                  label: (
                    <Link to={`/games/${gd.game.id}`}>
                      {fmtDate(gd.game.date, lang)} {side === 'home' ? t('common.vs') : t('common.at')} {teams.get(oppId)?.name}{' '}
                      <span className="muted">{us}–{them}</span>
                    </Link>
                  ),
                  line: gd.stats.players.get(playerId)!,
                }
              })}
            />
            <p className="legend">{t('stat.legend')}</p>
          </div>

          <div className="card">
            <h2>{t('game.shotChart')}</h2>
            <ShotChart shots={shots} />
          </div>
        </>
      )}
    </>
  )
}
