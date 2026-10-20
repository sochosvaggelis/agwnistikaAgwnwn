import { useState } from 'react'
import { Link } from 'react-router'
import { useI18n, type TKey } from '../i18n'
import { mySideOf, useById, useGamesData, useMyTeam, usePlayers, useTeams } from '../hooks'
import { SeasonFilter, useSeasonFilter } from '../components/SeasonFilter'
import { StatTable } from '../components/StatTable'
import { ShotChart } from '../components/ShotChart'
import { ModeToggle } from '../components/ModeToggle'
import { aggregatePlayers, aggregateTeam, type PlayerAgg } from '../stats/aggregate'
import { pir, reb, shotsOf, type StatLine } from '../stats/compute'
import { playerLabel } from '../db/repo'
import { fmtDate } from '../format'
import { opposite } from '../stats/rules'
import type { Player } from '../db/types'

export function StatsPage() {
  const { t, lang } = useI18n()
  const myTeam = useMyTeam()
  const filter = useSeasonFilter()
  const myId = myTeam?.id
  const games = useGamesData(
    g => g.status === 'finished' && filter.matches(g) && (g.homeTeamId === myId || g.awayTeamId === myId),
    [filter.key, myId],
  )
  const players = useById(usePlayers())
  const teams = useById(useTeams())
  const [mode, setMode] = useState<'avg' | 'total'>('avg')
  /** The picked game, tied to the season/competition filter it was picked under */
  const [gamePick, setGamePick] = useState<{ key: string; id: number } | null>(null)

  if (myTeam === undefined) return null
  if (myTeam === null) return <p className="empty">{t('stats.needMyTeam')} <Link to="/teams">{t('nav.teams')}</Link></p>

  const sideOf = (gd: NonNullable<typeof games>[number]) => mySideOf(gd.game, myId)
  const gameId = gamePick && gamePick.key === filter.key && games?.some(gd => gd.game.id === gamePick.id) ? gamePick.id : null
  const scoped = games && gameId != null ? games.filter(gd => gd.game.id === gameId) : games
  const team = scoped ? aggregateTeam(scoped, sideOf) : null
  const aggs = scoped ? aggregatePlayers(scoped, sideOf) : []
  const shots = scoped ? scoped.flatMap(gd => shotsOf(gd.events, e => e.side === sideOf(gd))) : []

  const gameLabel = (gd: NonNullable<typeof games>[number]) => {
    const side = sideOf(gd) ?? 'home'
    const oppId = side === 'home' ? gd.game.awayTeamId : gd.game.homeTeamId
    const score = `${gd.stats.teams[side].score}–${gd.stats.teams[opposite(side)].score}`
    return `${fmtDate(gd.game.date, lang)} ${side === 'home' ? t('common.vs') : t('common.at')} ${teams.get(oppId)?.name ?? ''} ${score}`
  }

  return (
    <>
      <div className="page-head">
        <h1>{t('stats.title')} — {myTeam.name}</h1>
      </div>
      <SeasonFilter filter={filter}>
        <label>
          {t('common.game')}
          <select
            value={gameId ?? 'all'}
            onChange={e => setGamePick(e.target.value === 'all' ? null : { key: filter.key, id: Number(e.target.value) })}
            disabled={!games?.length}
          >
            <option value="all">{t('stats.allGames')}</option>
            {[...(games ?? [])]
              .sort((a, b) => b.game.date.localeCompare(a.game.date))
              .map(gd => <option key={gd.game.id} value={gd.game.id}>{gameLabel(gd)}</option>)}
          </select>
        </label>
      </SeasonFilter>

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
            <ShotChart shots={shots} controls />
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
