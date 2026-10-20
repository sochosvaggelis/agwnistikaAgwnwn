import { useState } from 'react'
import { Link } from 'react-router'
import { useI18n, type TKey } from '../i18n'
import { mySideOf, useById, useGamesData, useMyTeam, usePlayers } from '../hooks'
import { SeasonFilter, useSeasonFilter } from '../components/SeasonFilter'
import { StatTable } from '../components/StatTable'
import { ShotChart } from '../components/ShotChart'
import { ModeToggle } from '../components/ModeToggle'
import { aggregatePlayers, aggregateTeam, type PlayerAgg } from '../stats/aggregate'
import { pir, reb, shotsOf, type StatLine } from '../stats/compute'
import { playerLabel } from '../db/repo'
import type { Player } from '../db/types'

export function StatsPage() {
  const { t } = useI18n()
  const myTeam = useMyTeam()
  const filter = useSeasonFilter()
  const myId = myTeam?.id
  const games = useGamesData(
    g => g.status === 'finished' && filter.matches(g) && (g.homeTeamId === myId || g.awayTeamId === myId),
    [filter.key, myId],
  )
  const players = useById(usePlayers())
  const [mode, setMode] = useState<'avg' | 'total'>('avg')

  if (myTeam === undefined) return null
  if (myTeam === null) return <p className="empty">{t('stats.needMyTeam')} <Link to="/teams">{t('nav.teams')}</Link></p>

  const sideOf = (gd: NonNullable<typeof games>[number]) => mySideOf(gd.game, myId)
  const team = games ? aggregateTeam(games, sideOf) : null
  const aggs = games ? aggregatePlayers(games, sideOf) : []
  const shots = games ? games.flatMap(gd => shotsOf(gd.events, e => e.side === sideOf(gd))) : []

  return (
    <>
      <div className="page-head">
        <h1>{t('stats.title')} — {myTeam.name}</h1>
      </div>
      <SeasonFilter filter={filter} />

      {team && team.gp === 0 && <p className="empty">{t('common.noData')}</p>}
      {team && team.gp > 0 && (
        <>
          <div className="grid-2">
            <div className="card">
              <h2>{t('common.record')}</h2>
              <div className="scoreline">
                <div><div className="pts">{team.wins}–{team.losses}</div><div className="muted">{t('common.win')}–{t('common.loss')}</div></div>
                <div><div className="pts">{(team.pointsFor / team.gp).toFixed(1)}</div><div className="muted">{t('stats.pointsFor')}</div></div>
                <div><div className="pts">{(team.pointsAgainst / team.gp).toFixed(1)}</div><div className="muted">{t('stats.pointsAgainst')}</div></div>
              </div>
            </div>
            <Leaders aggs={aggs} players={players} />
          </div>

          <div className="card">
            <StatTable
              firstCol={t('common.team')}
              mode="avg"
              showGp
              rows={[
                { key: 'us', label: t('stats.teamAverages'), line: team.us, gp: team.gp },
                { key: 'them', label: t('stats.opponentAverages'), line: team.them, gp: team.gp },
              ]}
            />
          </div>

          <div className="card">
            <div className="page-head">
              <h2 style={{ margin: 0 }}>{t('common.players')}</h2>
              <ModeToggle mode={mode} setMode={setMode} />
            </div>
            <StatTable
              firstCol={t('common.player')}
              mode={mode}
              showGp
              sortable
              rows={aggs
                .sort((a, b) => b.line.pts / b.gp - a.line.pts / a.gp)
                .map(a => ({
                  key: a.playerId,
                  label: <Link to={`/players/${a.playerId}`}>{playerLabel(players.get(a.playerId))}</Link>,
                  line: a.line,
                  gp: a.gp,
                }))}
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

const LEADER_STATS: { label: TKey; get: (l: StatLine) => number }[] = [
  { label: 'stat.PTS', get: l => l.pts },
  { label: 'stat.REB', get: reb },
  { label: 'stat.AST', get: l => l.ast },
  { label: 'stat.PIR', get: pir },
]

function Leaders({ aggs, players }: { aggs: PlayerAgg[]; players: Map<number, Player> }) {
  const { t } = useI18n()
  return (
    <div className="card">
      <h2>{t('stats.leaders')}</h2>
      <table className="simple-table">
        <tbody>
          {LEADER_STATS.map(s => {
            const best = [...aggs].sort((a, b) => s.get(b.line) / b.gp - s.get(a.line) / a.gp)[0]
            return (
              <tr key={s.label}>
                <th>{t(s.label)}</th>
                <td>{best ? <Link to={`/players/${best.playerId}`}>{playerLabel(players.get(best.playerId))}</Link> : '–'}</td>
                <td className="num"><b>{best ? (s.get(best.line) / best.gp).toFixed(1) : ''}</b></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
