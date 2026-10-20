import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useI18n } from '../i18n'
import { mySideOf, useById, useGamesData, useMyTeam, usePlayers, useTeams, type GameData } from '../hooks'
import { SeasonFilter, useSeasonFilter } from '../components/SeasonFilter'
import { StatTable } from '../components/StatTable'
import { ModeToggle } from '../components/ModeToggle'
import { ResultBadge } from '../components/ResultBadge'
import { aggregatePlayers, aggregateTeam } from '../stats/aggregate'
import { opposite } from '../stats/rules'
import { playerLabel } from '../db/repo'
import { fmtDate } from '../format'

export function HeadToHeadPage() {
  const { teamId } = useParams()
  const { t } = useI18n()
  const myTeam = useMyTeam()
  const teams = useTeams()
  const filter = useSeasonFilter()
  const myId = myTeam?.id
  const games = useGamesData(
    g => g.status === 'finished' && filter.matches(g) && (g.homeTeamId === myId || g.awayTeamId === myId),
    [filter.key, myId],
  )

  if (myTeam === undefined || !teams) return null
  if (myTeam === null) return <p className="empty">{t('stats.needMyTeam')} <Link to="/teams">{t('nav.teams')}</Link></p>

  const oppOf = (gd: GameData) => (gd.game.homeTeamId === myId ? gd.game.awayTeamId : gd.game.homeTeamId)
  const sideOf = (gd: GameData) => mySideOf(gd.game, myId)

  if (teamId) {
    const opp = teams.find(tm => tm.id === Number(teamId))
    const vs = (games ?? []).filter(gd => oppOf(gd) === Number(teamId))
    return (
      <>
        <div className="page-head">
          <h1>{myTeam.name} {t('common.vs')} {opp?.name}</h1>
          <Link className="btn" to="/h2h">‹ {t('h2h.title')}</Link>
        </div>
        <SeasonFilter filter={filter} />
        <Matchup games={vs} myId={myId!} sideOf={sideOf} oppName={opp?.name ?? ''} myName={myTeam.name} />
      </>
    )
  }

  const opponents = teams.filter(tm => !tm.isMine)
  return (
    <>
      <h1>{t('h2h.title')}</h1>
      <SeasonFilter filter={filter} />
      <div className="card">
        <h2>{t('h2h.pick')}</h2>
        <ul className="list">
          {opponents.map(o => {
            const vs = (games ?? []).filter(gd => oppOf(gd) === o.id)
            const rec = aggregateTeam(vs, sideOf)
            return (
              <li key={o.id}>
                <Link className="list-row" to={`/h2h/${o.id}`}>
                  <span className="grow">{o.name}</span>
                  <span className="muted">{t('h2h.games')}: {rec.gp}</span>
                  <b>{rec.wins}–{rec.losses}</b>
                  <span>›</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

function Matchup({ games, myId, sideOf, oppName, myName }: {
  games: GameData[]
  myId: number
  sideOf: (gd: GameData) => 'home' | 'away' | null
  oppName: string
  myName: string
}) {
  const { t, lang } = useI18n()
  const players = useById(usePlayers())
  const [mode, setMode] = useState<'avg' | 'total'>('avg')

  if (games.length === 0) return <p className="empty">{t('common.noData')}</p>

  const team = aggregateTeam(games, sideOf)
  const ours = aggregatePlayers(games, sideOf)
  const theirs = aggregatePlayers(games, gd => {
    const s = sideOf(gd)
    return s && opposite(s)
  })
  const playerRows = (aggs: typeof ours) =>
    aggs
      .sort((a, b) => b.line.pts / b.gp - a.line.pts / a.gp)
      .map(a => ({
        key: a.playerId,
        label: <Link to={`/players/${a.playerId}`}>{playerLabel(players.get(a.playerId))}</Link>,
        line: a.line,
        gp: a.gp,
      }))

  return (
    <>
      <div className="card">
        <div className="scoreline">
          <div><div className="pts">{team.wins}–{team.losses}</div><div className="muted">{t('common.record')}</div></div>
          <div><div className="pts">{(team.pointsFor / team.gp).toFixed(1)}</div><div className="muted">{t('stats.pointsFor')}</div></div>
          <div><div className="pts">{(team.pointsAgainst / team.gp).toFixed(1)}</div><div className="muted">{t('stats.pointsAgainst')}</div></div>
        </div>
        <ul className="list" style={{ marginTop: 12 }}>
          {games.map(gd => {
            const side = sideOf(gd)!
            return (
              <li key={gd.game.id}>
                <Link className="list-row" to={`/games/${gd.game.id}`}>
                  <span className="muted" style={{ minWidth: '7em' }}>{fmtDate(gd.game.date, lang)}</span>
                  <span className="grow">{side === 'home' ? t('common.home') : t('common.away')}</span>
                  <b>{gd.stats.teams[side].score} – {gd.stats.teams[opposite(side)].score}</b>
                  <ResultBadge gd={gd} myTeamId={myId} />
                </Link>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="card">
        <StatTable
          firstCol={t('common.team')}
          mode="avg"
          showGp
          rows={[
            { key: 'us', label: myName, line: team.us, gp: team.gp },
            { key: 'them', label: oppName, line: team.them, gp: team.gp },
          ]}
        />
      </div>

      <div className="card">
        <div className="page-head">
          <h2 style={{ margin: 0 }}>{t('h2h.ourPlayers')}</h2>
          <ModeToggle mode={mode} setMode={setMode} />
        </div>
        <StatTable firstCol={t('common.player')} mode={mode} showGp sortable rows={playerRows(ours)} />
      </div>

      <div className="card">
        <h2>{t('h2h.theirPlayers')}</h2>
        <StatTable firstCol={t('common.player')} mode={mode} showGp sortable rows={playerRows(theirs)} />
        <p className="legend">{t('stat.legend')}</p>
      </div>
    </>
  )
}
