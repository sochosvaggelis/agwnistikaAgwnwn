import { useMemo, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { useI18n, type TKey } from '../i18n'
import { db } from '../db/db'
import type { Game, GameEvent, Player, Side } from '../db/types'
import { deleteEvent, deleteGame, getGameEvents, playerLabel, setSetting, sortPlayers, updateEvent, updateGame } from '../db/repo'
import { SETTING_PRINT_PARTS, useSetting } from '../hooks'
import { computeGameStats, fga, fgm, pct, shotsOf } from '../stats/compute'
import { FOUL_TYPES, formatClock, periodLabel, REGULATION_PERIODS } from '../stats/rules'
import { StatTable } from '../components/StatTable'
import { ShotChart } from '../components/ShotChart'
import { Court } from '../components/Court'
import { Modal } from '../components/Modal'
import { PrintDialog } from '../components/PrintDialog'
import { describeEvent } from '../live/describe'
import { fmtDate, fmtPct } from '../format'
import { TeamName } from '../components/TeamSwatch'
import { teamColorVars } from '../teamColors'

const SIDES: Side[] = ['home', 'away']

/** The parts of the report a PDF can have, in the report's order */
const PRINT_PARTS = ['score', 'box', 'shotChart', 'shotsByPeriod', 'boxByPeriod'] as const
type PrintPart = (typeof PRINT_PARTS)[number]
const PRINT_PART_LABEL: Record<PrintPart, TKey> = {
  score: 'game.result',
  box: 'game.boxScore',
  shotChart: 'game.shotChart',
  shotsByPeriod: 'game.shotsByPeriod',
  boxByPeriod: 'game.boxByPeriod',
}

interface PrintChoice {
  parts: PrintPart[]
  sides: Side[]
}

export function GamePage() {
  const { id } = useParams()
  const gameId = Number(id)
  const { t, lang } = useI18n()
  const navigate = useNavigate()

  const game = useLiveQuery(() => db.games.get(gameId), [gameId])
  const events = useLiveQuery(() => getGameEvents(gameId), [gameId])
  const teams = useLiveQuery(async () => game ? db.teams.bulkGet([game.homeTeamId, game.awayTeamId]) : [], [game?.homeTeamId, game?.awayTeamId])
  const competition = useLiveQuery(async () => game ? db.competitions.get(game.competitionId) : undefined, [game?.competitionId])
  const season = useLiveQuery(async () => competition ? db.seasons.get(competition.seasonId) : undefined, [competition?.seasonId])
  const teamPlayers = useLiveQuery(
    async () => game ? db.players.where('teamId').anyOf([game.homeTeamId, game.awayTeamId]).toArray() : [],
    [game?.homeTeamId, game?.awayTeamId],
  )
  const [editing, setEditing] = useState<GameEvent | null>(null)
  const savedParts = useSetting<PrintPart[]>(SETTING_PRINT_PARTS)
  // What the last PDF had; printing from the browser menu prints the same
  const [printChoice, setPrintChoice] = useState<PrintChoice>({ parts: [...PRINT_PARTS], sides: SIDES })
  const [choosingPrint, setChoosingPrint] = useState(false)
  // One player per team, or none, to narrow the play-by-play to
  const [pbpPlayer, setPbpPlayer] = useState<Partial<Record<Side, number>>>({})

  const playerMap = useMemo(() => new Map((teamPlayers ?? []).map(p => [p.id!, p])), [teamPlayers])
  const stats = useMemo(() => (game && events ? computeGameStats(events, game) : null), [game, events])
  const colorVars = useMemo(() => teamColorVars(teams?.[0], teams?.[1]), [teams])

  if (game === undefined || events === undefined) return null
  if (!game || !stats) return <p>{t('game.notFound')}</p>

  const teamName = (side: Side) => <TeamName team={teams?.[side === 'home' ? 0 : 1]} />
  const periods = Math.max(REGULATION_PERIODS, game.period, ...events.map(e => e.period))
  const sidePlayers = (side: Side) =>
    sortPlayers([...stats.playerSide].filter(([, s]) => s === side).map(([pid]) => playerMap.get(pid)).filter((p): p is Player => !!p))

  const reopen = async () => {
    await updateGame(gameId, { status: 'live' })
    navigate(`/games/${gameId}/live`)
  }
  const remove = async () => {
    if (!confirm(t('game.confirmDelete'))) return
    await deleteGame(gameId)
    navigate('/', { replace: true })
  }
  const print = (choice: PrintChoice) => {
    setSetting(SETTING_PRINT_PARTS, choice.parts)
    // The page has to show the chosen parts, without the dialog, before the browser takes it
    flushSync(() => {
      setPrintChoice(choice)
      setChoosingPrint(false)
    })
    window.print()
  }
  /** Class that leaves a part, or one team's share of it, out of the PDF */
  const unprinted = (part: PrintPart, side?: Side) =>
    printChoice.parts.includes(part) && (side == null || printChoice.sides.includes(side)) ? '' : ' no-print'
  const printed = (part: PrintPart) => printChoice.parts.includes(part)

  // The chosen players' own events, and those done to them (fouled, blocked)
  const pbpIds = SIDES.map(side => pbpPlayer[side]).filter((pid): pid is number => pid != null)
  const pbpEvents = pbpIds.length === 0 ? events : events.filter(e =>
    (e.playerId != null && pbpIds.includes(e.playerId)) || (e.targetPlayerId != null && pbpIds.includes(e.targetPlayerId)))

  return (
    <div className="team-colors" style={colorVars}>
      <div className="btn-row no-print" style={{ marginBottom: 12 }}>
        {game.status === 'live'
          ? <Link className="btn btn-primary" to={`/games/${gameId}/live`}>▶ {t('game.continue')}</Link>
          : <button className="btn" onClick={reopen}>✎ {t('game.reopen')}</button>}
        <button className="btn" onClick={() => setChoosingPrint(true)}>⎙ {t('game.print')}</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-danger" onClick={remove}>{t('game.delete')}</button>
      </div>

      <div className={`card scoreboard${unprinted('score')}`}>
        <div className="scoreline">
          <div className="side-home"><div className="team">{teamName('home')}</div><div className="pts">{stats.teams.home.score}</div></div>
          <div className="muted">–</div>
          <div className="side-away"><div className="team">{teamName('away')}</div><div className="pts">{stats.teams.away.score}</div></div>
        </div>
        <div className="meta">
          {fmtDate(game.date, lang)} · {season?.name} · {competition?.name}{game.venue ? ` · ${game.venue}` : ''}
          {game.status === 'live' && <> · <span className="badge badge-live">{t('common.live')}</span></>}
        </div>
        <table className="line-score">
          <thead>
            <tr>
              <th />
              {Array.from({ length: periods }, (_, i) => <th key={i}>{periodLabel(i + 1, lang)}</th>)}
              <th>{t('stat.PTS')}</th>
              <th title={t('game.coachFouls')}>C/B</th>
            </tr>
          </thead>
          <tbody>
            {SIDES.map(side => (
              <tr key={side}>
                <th style={{ textAlign: 'left' }}>{teamName(side)}</th>
                {Array.from({ length: periods }, (_, i) => <td key={i}>{stats.teams[side].periodScores[i] ?? 0}</td>)}
                <td><b>{stats.teams[side].score}</b></td>
                <td>{stats.teams[side].coachFouls.C}/{stats.teams[side].coachFouls.B}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {SIDES.map(side => (
        <div className={`card${unprinted('box', side)}`} key={side}>
          <h2>{teamName(side)}</h2>
          <StatTable
            firstCol={t('common.player')}
            rows={sidePlayers(side).map(p => ({
              key: p.id!,
              label: <Link to={`/players/${p.id}`}>{playerLabel(p)}</Link>,
              line: stats.players.get(p.id!)!,
            }))}
            total={{ key: 'total', label: t('common.totals'), line: stats.teams[side].totals }}
          />
        </div>
      ))}
      <p className={`legend${unprinted('box')}`}>{t('stat.legend')}</p>

      <div className={`card${unprinted('shotChart')}`}>
        <h2>{t('game.shotChart')}</h2>
        <div className="grid-2">
          {SIDES.map(side => (
            <div key={side} className={unprinted('shotChart', side)}>
              <h3>{teamName(side)}</h3>
              <ShotChart shots={shotsOf(events, e => e.side === side)} />
            </div>
          ))}
        </div>
      </div>

      <div className={`card${unprinted('shotsByPeriod')}`}>
        <h2>{t('game.shotsByPeriod')}</h2>
        {SIDES.map(side => (
          <div key={side} className={unprinted('shotsByPeriod', side)}>
            <h3>{teamName(side)}</h3>
            <PeriodShots events={events.filter(e => e.side === side)} periods={periods} side={side} />
          </div>
        ))}
      </div>

      {printed('boxByPeriod') && (
        <>
          {Array.from({ length: periods }, (_, i) => (
            <PeriodBoxScore
              key={i} events={events} game={game} period={i + 1} sides={printChoice.sides} teamName={teamName} sidePlayers={sidePlayers}
            />
          ))}
          {/* The legend otherwise comes with the game's box score */}
          {!printed('box') && <p className="legend print-only">{t('stat.legend')}</p>}
        </>
      )}

      <div className="card no-print">
        <h2>{t('game.playByPlay')}</h2>
        {events.length > 0 && (
          <div className="filter-bar">
            {SIDES.map(side => (
              <label key={side}>
                {teamName(side)}
                <select
                  value={pbpPlayer[side] ?? ''}
                  onChange={e => setPbpPlayer({ ...pbpPlayer, [side]: e.target.value ? Number(e.target.value) : undefined })}
                >
                  <option value="">{t('game.allPlayers')}</option>
                  {sidePlayers(side).map(p => <option key={p.id} value={p.id}>{playerLabel(p)}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
        {pbpEvents.length === 0 && <p className="muted">{t('common.noData')}</p>}
        {pbpEvents.map((ev, i) => (
          <div key={ev.id}>
            {(i === 0 || pbpEvents[i - 1].period !== ev.period) && <div className="pbp-period">{periodLabel(ev.period, lang)}</div>}
            <div className="pbp-row">
              <span className="log-period">{ev.clockMs != null ? formatClock(ev.clockMs) : ''}</span>
              <span className={`log-text side-${ev.side}`}>{describeEvent(ev, playerMap, t)}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(ev)} aria-label={t('common.edit')}>✎</button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EditEventModal
          ev={editing}
          periods={periods}
          players={sidePlayersAll(teamPlayers ?? [], editing.side === 'home' ? game.homeTeamId : game.awayTeamId)}
          opponents={sidePlayersAll(teamPlayers ?? [], editing.side === 'home' ? game.awayTeamId : game.homeTeamId)}
          onClose={() => setEditing(null)}
        />
      )}
      {choosingPrint && (
        <GamePrintDialog
          initial={savedParts ? PRINT_PARTS.filter(p => savedParts.includes(p)) : [...PRINT_PARTS]}
          teamName={teamName}
          onPrint={print}
          onClose={() => setChoosingPrint(false)}
        />
      )}
    </div>
  )
}

function sidePlayersAll(players: Player[], teamId: number): Player[] {
  return sortPlayers(players.filter(p => p.teamId === teamId))
}

/** A small court per period with one team's shots in it, and its field goals made/attempted (shots without a spot count too) */
function PeriodShots({ events, periods, side }: { events: GameEvent[]; periods: number; side: Side }) {
  const { t, lang } = useI18n()
  return (
    <div className="period-shots">
      {Array.from({ length: periods }, (_, i) => {
        const inPeriod = events.filter(e => e.period === i + 1)
        const line = computeGameStats(inPeriod).teams[side].totals
        return (
          <figure key={i}>
            <Court shots={shotsOf(inPeriod, () => true)} />
            <figcaption>
              <b>{periodLabel(i + 1, lang)}</b> {fgm(line)}/{fga(line)} · {fmtPct(pct(fgm(line), fga(line)))}%
              <br />
              <span className="muted">{t('stat.2PT')} {line.fg2m}/{line.fg2a} · {t('stat.3PT')} {line.fg3m}/{line.fg3a}</span>
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}

/** Choose which parts of the report, and which teams, go into the PDF */
function GamePrintDialog({ initial, teamName, onPrint, onClose }: {
  initial: PrintPart[]
  teamName: (side: Side) => ReactNode
  onPrint: (choice: PrintChoice) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [sides, setSides] = useState(SIDES)
  const sideChoices: Side[][] = [SIDES, ['home'], ['away']]

  return (
    <PrintDialog
      parts={PRINT_PARTS}
      label={part => t(PRINT_PART_LABEL[part])}
      initial={initial}
      onPrint={parts => onPrint({ parts, sides })}
      onClose={onClose}
    >
      <h3>{t('game.printTeams')}</h3>
      <div className="print-choices">
        {sideChoices.map(choice => (
          <label key={choice.join()} className="inline">
            <input type="radio" name="print-teams" checked={sides.join() === choice.join()} onChange={() => setSides(choice)} />
            {choice.length > 1 ? t('game.printBothTeams') : teamName(choice[0])}
          </label>
        ))}
      </div>
    </PrintDialog>
  )
}

/**
 * One period's box score; the screen leaves it out, as it would be a long scroll.
 * With both teams it takes a page of its own in the PDF, with one team two periods share a page.
 */
function PeriodBoxScore({ events, game, period, sides, teamName, sidePlayers }: {
  events: GameEvent[]
  game: Game
  period: number
  sides: Side[]
  teamName: (side: Side) => ReactNode
  sidePlayers: (side: Side) => Player[]
}) {
  const { t, lang } = useI18n()
  const stats = computeGameStats(events, game, period)
  // Players on court in the period, or with any stat in it
  const tookPart = (id: number) => {
    const line = stats.players.get(id)
    return !!line && (line.ms > 0 || events.some(e =>
      e.period === period && e.type !== 'SUB_IN' && e.type !== 'SUB_OUT' && (e.playerId === id || e.targetPlayerId === id)))
  }
  return (
    <div className={`card print-only${sides.length > 1 ? ' print-break' : ''}`}>
      <h2>{t('game.boxByPeriod')} · {periodLabel(period, lang)}</h2>
      {sides.map(side => (
        <div key={side}>
          <h3>{teamName(side)}</h3>
          <StatTable
            firstCol={t('common.player')}
            rows={sidePlayers(side).filter(p => tookPart(p.id!)).map(p => ({ key: p.id!, label: playerLabel(p), line: stats.players.get(p.id!)! }))}
            total={{ key: 'total', label: t('common.totals'), line: stats.teams[side].totals }}
          />
        </div>
      ))}
    </div>
  )
}

function EditEventModal({ ev, periods, players, opponents, onClose }: {
  ev: GameEvent
  periods: number
  players: Player[]
  opponents: Player[]
  onClose: () => void
}) {
  const { t, lang } = useI18n()
  const [draft, setDraft] = useState<GameEvent>(ev)
  const isShot = ev.type === 'FG2' || ev.type === 'FG3' || ev.type === 'FT'
  const hasTarget = ev.type === 'FOUL' || ev.type === 'BLK'

  const save = async () => {
    const { id, ...changes } = draft
    await updateEvent(id!, changes)
    onClose()
  }
  const remove = async () => {
    await deleteEvent(ev.id!)
    onClose()
  }

  return (
    <Modal
      title={t('game.editEvent')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-danger" onClick={remove}>{t('common.delete')}</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
        </>
      }
    >
      <div className="form-row">
        {ev.type !== 'COACH_FOUL' && (
          <label className="grow">
            {t('common.player')}
            <select value={draft.playerId} onChange={e => setDraft({ ...draft, playerId: Number(e.target.value) })}>
              {players.map(p => <option key={p.id} value={p.id}>{playerLabel(p)}</option>)}
            </select>
          </label>
        )}
        <label>
          {t('game.period')}
          <select value={draft.period} onChange={e => setDraft({ ...draft, period: Number(e.target.value) })}>
            {Array.from({ length: periods }, (_, i) => <option key={i} value={i + 1}>{periodLabel(i + 1, lang)}</option>)}
          </select>
        </label>
      </div>
      {isShot && (
        <div className="form-row" style={{ marginTop: 12 }}>
          {ev.type !== 'FT' && (
            <span className="segmented">
              <button className={draft.type === 'FG2' ? 'on' : ''} onClick={() => setDraft({ ...draft, type: 'FG2' })}>{t('stat.2PT')}</button>
              <button className={draft.type === 'FG3' ? 'on' : ''} onClick={() => setDraft({ ...draft, type: 'FG3' })}>{t('stat.3PT')}</button>
            </span>
          )}
          <span className="segmented">
            <button className={draft.made ? 'on' : ''} onClick={() => setDraft({ ...draft, made: true })}>✓ {t('live.made')}</button>
            <button className={!draft.made ? 'on' : ''} onClick={() => setDraft({ ...draft, made: false })}>✗ {t('live.missed')}</button>
          </span>
        </div>
      )}
      {(ev.type === 'OREB' || ev.type === 'DREB') && (
        <div className="form-row" style={{ marginTop: 12 }}>
          <span className="segmented">
            <button className={draft.type === 'OREB' ? 'on' : ''} onClick={() => setDraft({ ...draft, type: 'OREB' })}>{t('act.OREB')}</button>
            <button className={draft.type === 'DREB' ? 'on' : ''} onClick={() => setDraft({ ...draft, type: 'DREB' })}>{t('act.DREB')}</button>
          </span>
        </div>
      )}
      {ev.type === 'FOUL' && (
        <div className="form-row" style={{ marginTop: 12 }}>
          <label className="grow">
            {t('live.foulType')}
            <select value={draft.foulType} onChange={e => setDraft({ ...draft, foulType: e.target.value as GameEvent['foulType'] })}>
              {FOUL_TYPES.map(f => <option key={f} value={f}>{f} — {t(`foul.${f}`)}</option>)}
            </select>
          </label>
        </div>
      )}
      {ev.type === 'COACH_FOUL' && (
        <div className="form-row" style={{ marginTop: 12 }}>
          <span className="segmented">
            <button className={draft.coachFoulType === 'C' ? 'on' : ''} onClick={() => setDraft({ ...draft, coachFoulType: 'C' })}>{t('live.coach')}</button>
            <button className={draft.coachFoulType === 'B' ? 'on' : ''} onClick={() => setDraft({ ...draft, coachFoulType: 'B' })}>{t('live.bench')}</button>
          </span>
        </div>
      )}
      {hasTarget && (
        <div className="form-row" style={{ marginTop: 12 }}>
          <label className="grow">
            {ev.type === 'FOUL' ? t('live.fouledWho') : t('live.blockedShooter')}
            <select
              value={draft.targetPlayerId ?? ''}
              onChange={e => setDraft({ ...draft, targetPlayerId: e.target.value ? Number(e.target.value) : undefined })}
            >
              <option value="">—</option>
              {opponents.map(p => <option key={p.id} value={p.id}>{playerLabel(p)}</option>)}
            </select>
          </label>
        </div>
      )}
    </Modal>
  )
}
