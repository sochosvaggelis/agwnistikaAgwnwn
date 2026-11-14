import { useState } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router'
import { useI18n, type TKey } from '../i18n'
import { mySideOf, SETTING_STATS_PRINT_PARTS, useById, useGamesData, useMyTeam, usePlayers, useSetting, useTeams } from '../hooks'
import { setSetting } from '../db/repo'
import { PrintDialog } from '../components/PrintDialog'
import { SeasonFilter, useSeasonFilter } from '../components/SeasonFilter'
import { StatTable } from '../components/StatTable'
import { ShotChart } from '../components/ShotChart'
import { ModeToggle } from '../components/ModeToggle'
import { TeamName } from '../components/TeamSwatch'
import { aggregatePlayers, aggregateTeam, type PlayerAgg } from '../stats/aggregate'
import { pir, reb, shotsOf, type StatLine } from '../stats/compute'
import { playerLabel } from '../db/repo'
import { fmtDate } from '../format'
import { isOvertime, opposite, periodLabel, REGULATION_PERIODS } from '../stats/rules'
import type { Player } from '../db/types'

/** Stands for all the overtimes together in the shots by quarter */
const OVERTIMES = REGULATION_PERIODS + 1

/** The page's sections a PDF can have, in the page's order */
const PRINT_PARTS = ['record', 'leaders', 'team', 'players', 'shotChart', 'shotsByPeriod'] as const
type PrintPart = (typeof PRINT_PARTS)[number]
const PRINT_PART_LABEL: Record<PrintPart, TKey> = {
  record: 'common.record',
  leaders: 'stats.leaders',
  team: 'stats.teamVsOpponents',
  players: 'common.players',
  shotChart: 'game.shotChart',
  shotsByPeriod: 'game.shotsByPeriod',
}

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
  const savedParts = useSetting<PrintPart[]>(SETTING_STATS_PRINT_PARTS)
  // What the last PDF had; printing from the browser menu prints the same
  const [printParts, setPrintParts] = useState<PrintPart[]>([...PRINT_PARTS])
  const [choosingPrint, setChoosingPrint] = useState(false)

  if (myTeam === undefined) return null
  if (myTeam === null) return <p className="empty">{t('stats.needMyTeam')} <Link to="/teams">{t('nav.teams')}</Link></p>

  const sideOf = (gd: NonNullable<typeof games>[number]) => mySideOf(gd.game, myId)
  const gameId = gamePick && gamePick.key === filter.key && games?.some(gd => gd.game.id === gamePick.id) ? gamePick.id : null
  const scoped = games && gameId != null ? games.filter(gd => gd.game.id === gameId) : games
  const team = scoped ? aggregateTeam(scoped, sideOf) : null
  const aggs = scoped ? aggregatePlayers(scoped, sideOf) : []
  const shotsIn = (inPeriod: (period: number) => boolean) =>
    (scoped ?? []).flatMap(gd => shotsOf(gd.events, e => e.side === sideOf(gd) && inPeriod(e.period)))
  const shots = shotsIn(() => true)

  const gameLabel = (gd: NonNullable<typeof games>[number]) => {
    const side = sideOf(gd) ?? 'home'
    const oppId = side === 'home' ? gd.game.awayTeamId : gd.game.homeTeamId
    const score = `${gd.stats.teams[side].score}–${gd.stats.teams[opposite(side)].score}`
    return `${fmtDate(gd.game.date, lang)} ${side === 'home' ? t('common.vs') : t('common.at')} ${teams.get(oppId)?.name ?? ''} ${score}`
  }

  // On paper the filter's dropdowns are replaced by a line saying what was picked
  const seasonName = filter.seasonId === 'all' ? t('common.all') : filter.seasons?.find(s => s.id === filter.seasonId)?.name
  const compName = filter.value.competitionId === 'all'
    ? t('common.allCompetitions')
    : filter.competitions?.find(c => c.id === filter.value.competitionId)?.name
  const pickedGame = gameId != null ? games?.find(gd => gd.game.id === gameId) : undefined

  const print = (parts: PrintPart[]) => {
    setSetting(SETTING_STATS_PRINT_PARTS, parts)
    // The page has to show the chosen sections, without the dialog, before the browser takes it
    flushSync(() => {
      setPrintParts(parts)
      setChoosingPrint(false)
    })
    window.print()
  }
  /** Class that leaves a section out of the PDF */
  const unprinted = (part: PrintPart) => (printParts.includes(part) ? '' : ' no-print')

  return (
    <>
      <div className="page-head">
        <h1>{t('stats.title')} — <TeamName team={myTeam} /></h1>
        <button className="btn no-print" onClick={() => setChoosingPrint(true)} disabled={!team?.gp}>⎙ {t('game.print')}</button>
      </div>
      <p className="print-only print-filters">
        {t('common.season')}: <b>{seasonName}</b> · {t('common.competition')}: <b>{compName}</b> · {t('common.game')}:{' '}
        <b>{pickedGame ? gameLabel(pickedGame) : t('stats.allGames')}</b>
      </p>
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
          <div className={`grid-2${printParts.includes('record') || printParts.includes('leaders') ? '' : ' no-print'}`}>
            <div className={`card${unprinted('record')}`}>
              <h2>{t('common.record')}</h2>
              <div className="scoreline">
                <div><div className="pts">{team.wins}–{team.losses}</div><div className="muted">{t('common.win')}–{t('common.loss')}</div></div>
                <div><div className="pts">{(team.pointsFor / team.gp).toFixed(1)}</div><div className="muted">{t('stats.pointsFor')}</div></div>
                <div><div className="pts">{(team.pointsAgainst / team.gp).toFixed(1)}</div><div className="muted">{t('stats.pointsAgainst')}</div></div>
              </div>
            </div>
            <Leaders aggs={aggs} players={players} className={unprinted('leaders')} />
          </div>

          <div className={`card${unprinted('team')}`}>
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

          <div className={`card${unprinted('players')}`}>
            <div className="page-head">
              <h2 style={{ margin: 0 }}>
                {t('common.players')}
                <span className="print-only-inline muted"> — {t(mode === 'avg' ? 'common.averages' : 'common.totals')}</span>
              </h2>
              <span className="no-print"><ModeToggle mode={mode} setMode={setMode} /></span>
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

          <div className={`card${unprinted('shotChart')}`}>
            <h2>{t('game.shotChart')}</h2>
            <ShotChart shots={shots} controls />
          </div>

          {/* The same chart per quarter, each with its own controls; the overtimes share one */}
          <div className={`card${unprinted('shotsByPeriod')}`}>
            <h2>{t('game.shotsByPeriod')}</h2>
            <div className="quarter-charts">
              {[1, 2, 3, 4, ...((scoped ?? []).some(gd => gd.events.some(e => isOvertime(e.period))) ? [OVERTIMES] : [])].map(period => (
                <section key={period}>
                  <h3>{period === OVERTIMES ? t('stats.overtimes') : periodLabel(period, lang)}</h3>
                  <ShotChart shots={shotsIn(p => (period === OVERTIMES ? isOvertime(p) : p === period))} controls />
                </section>
              ))}
            </div>
          </div>
        </>
      )}

      {choosingPrint && (
        <PrintDialog
          parts={PRINT_PARTS}
          label={part => t(PRINT_PART_LABEL[part])}
          initial={savedParts ? PRINT_PARTS.filter(p => savedParts.includes(p)) : [...PRINT_PARTS]}
          onPrint={print}
          onClose={() => setChoosingPrint(false)}
        />
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

function Leaders({ aggs, players, className = '' }: { aggs: PlayerAgg[]; players: Map<number, Player>; className?: string }) {
  const { t } = useI18n()
  return (
    <div className={`card${className}`}>
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
