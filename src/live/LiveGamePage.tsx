import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Game, GameEvent, Player, Side, Team } from '../db/types'
import {
  addPlayer, adjustClock, appendEvents, deleteEvents, deleteGroup, getGameEvents, playerLabel, prependEvents, setPeriod,
  sortPlayers, startClock, stopClock, undoLastGroup, updateGame,
} from '../db/repo'
import {
  acceptsSpot, advance, chosenPlayer, isEligible, markedSpot, type ActionKey, type Draft, type FlowContext, type Input, type Step,
} from './flow'
import {
  computeGameStats, foulCounts, shotsOf, teamFoulsInPeriod, type GameStats, type Shot, type StatLine,
} from '../stats/compute'
import {
  currentClockMs, formatClock, FOUL_TYPES, isCoachDisqualified, isOvertime, isPlayerDisqualified, isThreeByLocation, opposite,
  parseClock, periodLabel, periodLengthMs, REGULATION_PERIODS, TEAM_FOUL_PENALTY,
} from '../stats/rules'
import { lineups } from '../stats/lineup'
import { useI18n } from '../i18n'
import { Court } from '../components/Court'
import { ZoneLayer } from '../components/ZoneLayer'
import { courtZoneSplits } from '../stats/zones'
import { Modal } from '../components/Modal'
import { StatTable } from '../components/StatTable'
import { describeEvent, describeShort, groupEvents } from './describe'
import './live.css'

const SIDES: Side[] = ['home', 'away']
const IDLE: Step = { kind: 'idle' }

/** Which shots a court shows: the whole game, one quarter, or the overtimes together (any overtime period) */
type PeriodFilter = 'all' | number
const OVERTIMES = REGULATION_PERIODS + 1
const inPeriod = (f: PeriodFilter, period: number) => f === 'all' || (isOvertime(f) ? isOvertime(period) : period === f)

/** A step to return to, and the events stored when leaving it */
interface BackEntry {
  step: Step
  ids: number[]
}

export function LiveGamePage() {
  const { id } = useParams()
  const gameId = Number(id)
  const game = useLiveQuery(() => db.games.get(gameId), [gameId])
  const events = useLiveQuery(() => getGameEvents(gameId), [gameId])
  const { t } = useI18n()

  if (game === undefined || events === undefined) return null
  if (!game) return <div className="page"><p>{t('game.notFound')}</p></div>
  if (game.status === 'finished') return <Navigate to={`/games/${game.id}`} replace />
  return <LiveGame game={game} events={events} />
}

function LiveGame({ game, events }: { game: Game; events: GameEvent[] }) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const gameId = game.id!

  const rosterIds = useMemo(() => [...game.roster.home, ...game.roster.away], [game.roster])
  const players = useLiveQuery(() => db.players.bulkGet(rosterIds), [rosterIds])
  const teams = useLiveQuery(() => db.teams.bulkGet([game.homeTeamId, game.awayTeamId]), [game.homeTeamId, game.awayTeamId])

  const playerMap = useMemo(() => {
    const m = new Map<number, Player>()
    for (const p of players ?? []) if (p) m.set(p.id!, p)
    return m
  }, [players])
  const roster = useMemo(() => ({
    home: sortPlayers(game.roster.home.map(i => playerMap.get(i)).filter((p): p is Player => !!p)),
    away: sortPlayers(game.roster.away.map(i => playerMap.get(i)).filter((p): p is Player => !!p)),
  }), [game.roster, playerMap])

  const stats = useMemo(() => computeGameStats(events, game), [events, game])
  // Who is on the court for each team; null until the team's starting five are picked
  const lineup = useMemo(() => lineups(events), [events])

  // ---------- entry flow ----------
  const [step, setStepState] = useState<Step>(IDLE)
  const stepRef = useRef<Step>(IDLE)
  const setStep = (s: Step) => {
    stepRef.current = s
    setStepState(s)
  }

  // Each team's court shows its shots so far, like the game report; only the chosen player's while a play is about them,
  // and only one quarter's when its filter is set
  const [courtPeriods, setCourtPeriods] = useState<Record<Side, PeriodFilter>>({ home: 'all', away: 'all' })
  const chosen = chosenPlayer(step)
  const chosenSide = chosen?.side
  const chosenId = chosen?.playerId
  const shots = useMemo(() => {
    const of = (side: Side) => shotsOf(events, e =>
      e.side === side && inPeriod(courtPeriods[side], e.period) && (chosenSide !== side || e.playerId === chosenId))
    return { home: of('home'), away: of('away') }
  }, [events, chosenSide, chosenId, courtPeriods])
  // The chosen player's field goals in the same quarter, including those without a spot
  const chosenFg = useMemo(() => {
    const fg = { m: 0, a: 0 }
    if (!chosenSide) return fg
    for (const e of events) {
      if ((e.type === 'FG2' || e.type === 'FG3') && e.playerId === chosenId && inPeriod(courtPeriods[chosenSide], e.period)) {
        fg.a++
        if (e.made) fg.m++
      }
    }
    return fg
  }, [events, chosenSide, chosenId, courtPeriods])

  const queue = useRef<Promise<void>>(Promise.resolve())
  const flowGroup = useRef<number | null>(null)
  const enqueue = useCallback((fn: () => Promise<unknown>) => {
    queue.current = queue.current.then(fn).then(() => undefined, err => {
      console.error(err)
      alert(String(err))
    })
  }, [])

  const ctx: FlowContext = useMemo(() => {
    const lastGroup = events.length ? events[events.length - 1].group : null
    const lastMade = events.filter(e => e.group === lastGroup).find(e => (e.type === 'FG2' || e.type === 'FG3') && e.made)
    return {
      teamFouls: { home: teamFoulsInPeriod(stats.teams.home, game.period), away: teamFoulsInPeriod(stats.teams.away, game.period) },
      lastMadeShooter: lastMade?.playerId,
    }
  }, [events, stats, game.period])

  /** Steps of the current play, so Back can return to the previous one and remove what it stored */
  const backStack = useRef<BackEntry[]>([])

  const dispatch = (input: Input) => {
    const prev = stepRef.current
    const r = advance(prev, input, ctx)
    if (r.step === prev && !r.writes.length) return
    const entry: BackEntry = { step: prev, ids: [] }
    // Picking the spot or the player (again) restarts the play, so Back only retraces those
    if (r.step.kind === 'idle') backStack.current = []
    else if (r.step.kind === 'player') backStack.current = [{ step: IDLE, ids: [] }]
    else if (r.step.kind === 'action') {
      backStack.current = [{ step: IDLE, ids: [] }]
      if (r.step.at) backStack.current.push({ step: { kind: 'player', side: r.step.actor.side, at: r.step.at }, ids: [] })
    } else backStack.current.push(entry)
    setStep(r.step)
    if (r.writes.length) {
      const drafts: Draft[] = r.writes
      enqueue(async () => {
        const res = await appendEvents(gameId, drafts, flowGroup.current ?? 'new')
        flowGroup.current = res.group
        entry.ids.push(...res.ids)
      })
    }
    if (r.step.kind === 'idle') enqueue(async () => { flowGroup.current = null })
  }

  const goBack = () => {
    const entry = backStack.current.pop()
    const target = entry?.step ?? IDLE
    setStep(target)
    if (entry) enqueue(async () => { if (entry.ids.length) await deleteEvents(entry.ids) })
    if (target.kind === 'idle') {
      backStack.current = []
      enqueue(async () => { flowGroup.current = null })
    }
  }

  const resetFlow = () => {
    backStack.current = []
    setStep(IDLE)
  }

  const undo = () => {
    resetFlow()
    enqueue(async () => {
      flowGroup.current = null
      await undoLastGroup(gameId)
    })
  }

  // ---------- clock ----------
  const [, setTick] = useState(0)
  const running = game.clockEnabled && game.clockRunningSince != null
  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => setTick(n => n + 1), 250)
    return () => clearInterval(iv)
  }, [running])
  const clockMs = currentClockMs(game)
  const stopping = useRef(false)
  useEffect(() => {
    if (running && clockMs <= 0 && !stopping.current) {
      stopping.current = true
      stopClock(game).finally(() => { stopping.current = false })
    }
  })

  useWakeLock()

  // ---------- modals ----------
  type ModalState = null | 'log' | 'box' | 'clock' | { sub: Side } | { addTo: Side; thenSub?: boolean }
  const [opened, setModal] = useState<ModalState>(null)
  // A new game starts by picking the starting fives, until that window is saved or closed
  const [startersAsked, setStartersAsked] = useState(false)
  const startersSide = !startersAsked && players && !events.length ? SIDES.find(s => roster[s].length >= 5) : undefined
  const modal: ModalState = opened ?? (startersSide ? { sub: startersSide } : null)
  const closeModal = () => {
    setStartersAsked(true)
    setModal(null)
  }

  /** Store a substitution as one undo group; a starting five goes to the start of the game, however late it is picked */
  const substitute = (side: Side, ins: number[], outs: number[], clockMs: number | undefined) => {
    setStartersAsked(true)
    resetFlow()
    const drafts: Draft[] = [
      ...outs.map(playerId => ({ side, playerId, type: 'SUB_OUT' as const })),
      ...ins.map(playerId => ({ side, playerId, type: 'SUB_IN' as const })),
    ]
    const starting = !lineup[side]
    enqueue(async () => {
      flowGroup.current = null
      if (starting) await prependEvents(gameId, drafts)
      else await appendEvents(gameId, drafts, 'new', { clockMs })
    })
    // After one team's starting five, go on to the other's
    const other = opposite(side)
    setModal(!lineup[side] && !lineup[other] && roster[other].length >= 5 ? { sub: other } : null)
  }

  /** Set when we navigate away ourselves, so the back-gesture guard stops intercepting */
  const leaving = useRef(false)
  const exitGame = () => {
    leaving.current = true
    navigate('/')
  }

  const changePeriod = (delta: 1 | -1) => {
    const p = game.period + delta
    if (p < 1) return
    const msg = delta > 0 ? 'live.confirmNextPeriod' : 'live.confirmPrevPeriod'
    if (!confirm(t(msg, { period: periodLabel(p, lang) }))) return
    resetFlow()
    enqueue(() => setPeriod(game, p))
  }

  const endGame = () => {
    if (!confirm(t('live.confirmEnd'))) return
    enqueue(async () => {
      await stopClock(game)
      await updateGame(gameId, { status: 'finished' })
      leaving.current = true
      navigate(`/games/${gameId}`, { replace: true })
    })
  }

  // Android back gesture: close a window, else go back one step, else ask before leaving the game
  const onSystemBack = useRef(() => {})
  useEffect(() => {
    onSystemBack.current = () => {
      if (modal) closeModal()
      else if (stepRef.current.kind !== 'idle') goBack()
      else if (confirm(t('live.confirmExit'))) exitGame()
    }
  })
  useEffect(() => {
    const guard = () => window.history.pushState({ ...window.history.state, liveGuard: true }, '')
    guard()
    const onPop = () => {
      if (leaving.current) return
      onSystemBack.current()
      if (!leaving.current) guard()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const teamName = (side: Side) => teams?.[side === 'home' ? 0 : 1]?.name ?? ''
  const groups = useMemo(() => groupEvents(events), [events])
  const lastGroupText = groups[0]?.map(e => {
    const d = describeShort(e, playerMap, t)
    return `${d.who} ${d.what}`
  }).join(' · ')

  return (
    <div className="live">
      <header className="live-top">
        <button className="btn btn-ghost" onClick={exitGame}>‹ {t('live.exit')}</button>
        <TeamScore side="home" stats={stats} period={game.period} />
        <div className="live-mid">
          <div className="live-period">
            <button className="btn btn-ghost btn-sm" onClick={() => changePeriod(-1)} disabled={game.period <= 1} aria-label={t('live.prevPeriod')}>◀</button>
            <span className="period-label">{periodLabel(game.period, lang)}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => changePeriod(1)} aria-label={t('live.nextPeriod')}>▶</button>
          </div>
          {game.clockEnabled && (
            <div className="live-clock">
              <button className={`clock-time${running ? ' running' : ''}`} onClick={() => setModal('clock')}>{formatClock(clockMs)}</button>
              <button
                className={`btn btn-clock ${running ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => enqueue(() => (running ? stopClock(game) : startClock(game)))}
                disabled={!running && clockMs <= 0}
              >
                {running ? '❚❚' : '▶'}
              </button>
            </div>
          )}
        </div>
        <TeamScore side="away" stats={stats} period={game.period} />
      </header>

      <div className="live-body">
        <RosterColumn
          side="home" name={teamName('home')} players={roster.home} lineup={lineup.home} stats={stats} shots={shots.home} step={step}
          period={game.period} shown={courtPeriods.home} chosenFg={chosenFg}
          onShown={f => setCourtPeriods(p => ({ ...p, home: f }))}
          onCourt={(x, y) => dispatch({ t: 'court', side: 'home', x, y })}
          onPlayer={p => dispatch({ t: 'player', side: 'home', playerId: p })}
          onCoach={() => dispatch({ t: 'coachFoul', side: 'home' })}
          onAdd={() => setModal({ addTo: 'home' })}
          onSub={() => setModal({ sub: 'home' })}
        />
        <CenterPanel step={step} dispatch={dispatch} onBack={goBack} playerMap={playerMap} groups={groups} ctx={ctx} />
        <RosterColumn
          side="away" name={teamName('away')} players={roster.away} lineup={lineup.away} stats={stats} shots={shots.away} step={step}
          period={game.period} shown={courtPeriods.away} chosenFg={chosenFg}
          onShown={f => setCourtPeriods(p => ({ ...p, away: f }))}
          onCourt={(x, y) => dispatch({ t: 'court', side: 'away', x, y })}
          onPlayer={p => dispatch({ t: 'player', side: 'away', playerId: p })}
          onCoach={() => dispatch({ t: 'coachFoul', side: 'away' })}
          onAdd={() => setModal({ addTo: 'away' })}
          onSub={() => setModal({ sub: 'away' })}
        />
      </div>

      <footer className="live-bottom">
        <button className="btn btn-undo" onClick={undo} disabled={!groups.length}>
          <span className="undo-label">↶ {t('live.undo')}</span>
          <span className="undo-desc">{lastGroupText ?? t('live.nothingToUndo')}</span>
        </button>
        <button className="btn" onClick={() => setModal('log')}>{t('live.log')}</button>
        <button className="btn" onClick={() => setModal('box')}>{t('live.boxScore')}</button>
        <button className="btn" onClick={() => changePeriod(1)}>{t('live.nextPeriod')}</button>
        <button className="btn btn-danger" onClick={endGame}>{t('live.endGame')}</button>
      </footer>

      {modal === 'log' && (
        <Modal title={t('live.log')} onClose={() => setModal(null)} wide>
          <ul className="log-list">
            {groups.map(g => (
              <li key={g[0].group}>
                <span className="log-period">{periodLabel(g[0].period, lang)}{g[0].clockMs != null ? ` ${formatClock(g[0].clockMs)}` : ''}</span>
                <span className={`log-text side-${g[0].side}`}>{g.map(e => describeEvent(e, playerMap, t)).join(' · ')}</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => confirm(t('common.areYouSure')) && enqueue(() => deleteGroup(gameId, g[0].group))}
                  aria-label={t('common.delete')}
                >🗑</button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {modal === 'box' && (
        <Modal title={t('live.boxScore')} onClose={() => setModal(null)} wide>
          {SIDES.map(side => (
            <section key={side}>
              <h3>{teamName(side)} — {stats.teams[side].score}</h3>
              <StatTable
                firstCol={t('common.player')}
                rows={roster[side].map(p => ({ key: p.id!, label: playerLabel(p), line: stats.players.get(p.id!)! }))}
                total={{ key: 'total', label: t('common.totals'), line: stats.teams[side].totals }}
              />
            </section>
          ))}
        </Modal>
      )}
      {modal === 'clock' && <ClockModal game={game} onClose={() => setModal(null)} enqueue={enqueue} />}
      {modal && typeof modal === 'object' && 'sub' in modal && (
        <SubModal
          key={modal.sub}
          game={game}
          events={events}
          team={teams?.[modal.sub === 'home' ? 0 : 1]}
          players={roster[modal.sub]}
          lineup={lineup[modal.sub] ?? []}
          stats={stats}
          onSave={(ins, outs, ms) => substitute(modal.sub, ins, outs, ms)}
          onAddPlayer={() => setModal({ addTo: modal.sub, thenSub: true })}
          onClose={closeModal}
        />
      )}
      {modal && typeof modal === 'object' && 'addTo' in modal && (
        <AddPlayerModal
          team={teams?.[modal.addTo === 'home' ? 0 : 1]}
          onClose={() => setModal(modal.thenSub ? { sub: modal.addTo } : null)}
          onAdd={(number, name) => {
            const side = modal.addTo
            const teamId = side === 'home' ? game.homeTeamId : game.awayTeamId
            enqueue(async () => {
              const pid = await addPlayer({ teamId, number, name })
              const fresh = await db.games.get(gameId)
              if (fresh) await updateGame(gameId, { roster: { ...fresh.roster, [side]: [...fresh.roster[side], pid] } })
            })
            // Back to the substitution the player was added from, where they now sit on the bench
            setModal(modal.thenSub ? { sub: side } : null)
          }}
        />
      )}
    </div>
  )
}

/** Boxes for the team fouls of a period, like a scoreboard, with the count beside them for fouls past the boxes */
const TEAM_FOUL_BOXES = 5

function TeamScore({ side, stats, period }: { side: Side; stats: GameStats; period: number }) {
  const { t } = useI18n()
  const team = stats.teams[side]
  const fouls = teamFoulsInPeriod(team, period)
  const label = `${t('live.teamFouls')}: ${fouls}`
  return (
    <div className={`team-score side-${side}`}>
      <span className="score">{team.score}</span>
      <span className="team-fouls" title={label} aria-label={label}>
        {Array.from({ length: TEAM_FOUL_BOXES }, (_, i) => <i key={i} className={`foul-box${i < fouls ? ' on' : ''}`} />)}
        <b className="foul-count">{fouls}</b>
      </span>
    </div>
  )
}

interface RosterProps {
  side: Side
  name: string
  players: Player[]
  /** Players on the court, or null while the team has no starting five */
  lineup: number[] | null
  stats: GameStats
  shots: Shot[]
  step: Step
  /** The game's current period, and which quarter the court shows */
  period: number
  shown: PeriodFilter
  chosenFg: { m: number; a: number }
  onShown: (f: PeriodFilter) => void
  onCourt: (x: number, y: number) => void
  onPlayer: (id: number) => void
  onCoach: () => void
  onAdd: () => void
  onSub: () => void
}

function RosterColumn({
  side, name, players: roster, lineup, stats, shots, step, period, shown, chosenFg, onShown, onCourt, onPlayer, onCoach, onAdd, onSub,
}: RosterProps) {
  const { t, lang } = useI18n()
  // Once the team has a lineup, only the players on the court are shown
  const players = lineup ? roster.filter(p => lineup.includes(p.id!)) : roster
  const fouledOutOnCourt = !!lineup && players.some(p => {
    const l = stats.players.get(p.id!)
    return !!l && isPlayerDisqualified(foulCounts(l))
  })
  const picking = step.kind === 'pick' || step.kind === 'player'
  const chosen = chosenPlayer(step)
  const selected = chosen?.side === side ? players.find(p => p.id === chosen.playerId) : undefined
  const coach = stats.teams[side].coachFouls
  const courtOn = acceptsSpot(step, side)
  const spot = markedSpot(step)
  // The heatmap replaces the shot marks, like on the team stats page
  const [heat, setHeat] = useState(false)
  const zones = useMemo(() => (heat ? courtZoneSplits(shots) : undefined), [heat, shots])
  // The four quarters, then one button for all the overtimes once there are any; quarters still to come can't be picked
  const periodFilters: PeriodFilter[] = ['all', 1, 2, 3, 4, ...(isOvertime(period) ? [OVERTIMES] : [])]
  const filterLabel = (f: PeriodFilter) => (f === 'all' ? t('common.all') : isOvertime(f) ? t('live.overtimes') : periodLabel(f, lang))

  return (
    <div className={`roster side-${side}${picking ? ' picking' : ''}`}>
      <div className="roster-name">{name}</div>
      <div className="live-court-area">
        {/* The court shows only this player's shots */}
        {selected && (
          <div className="court-focus">
            <span className="court-focus-num">#{selected.number || '–'}</span>
            <span>{t('shots.viewShots')} {chosenFg.m}/{chosenFg.a}</span>
          </div>
        )}
        <div className={`live-court${courtOn ? '' : ' off'}`}>
          <Court
            shots={zones ? undefined : shots}
            layer={zones && <ZoneLayer splits={zones} shown={() => true} />}
            onTap={courtOn ? onCourt : undefined}
            highlight={step.kind === 'court' && step.actor.side === side ? step.shot : undefined}
            marker={spot?.side === side ? spot.at : undefined}
          />
        </div>
        <div className="court-tools">
          <button className={`btn btn-sm heat-toggle${heat ? ' on' : ''}`} onClick={() => setHeat(h => !h)} aria-pressed={heat}>
            {t('shots.viewHeat')}
          </button>
          <div className="court-periods" role="group" aria-label={t('live.courtPeriods')}>
            {periodFilters.map(f => (
              <button
                key={f}
                className={f === shown ? 'on' : ''}
                onClick={() => onShown(f)}
                disabled={f !== 'all' && f > period}
                aria-pressed={f === shown}
              >
                {filterLabel(f)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={`roster-grid${lineup ? ' on-court' : ''}`}>
        {!lineup && <button className="player-btn player-sub" onClick={onSub}>{t('live.startingFive')}</button>}
        {players.map(p => {
          const line = stats.players.get(p.id!)
          const eligible = !picking || isEligible(step, side, p.id!)
          const isSelected = selected?.id === p.id
          return (
            <PlayerButton
              key={p.id}
              player={p}
              line={line}
              eligible={eligible}
              highlight={picking && eligible}
              selected={isSelected}
              onClick={() => onPlayer(p.id!)}
            />
          )
        })}
        {lineup ? (
          // Stands out while a fouled-out player is still on the court
          <button className={`player-btn player-sub${fouledOutOnCourt ? ' attention' : ''}`} onClick={onSub}>⇄ {t('live.sub')}</button>
        ) : (
          <button className="player-btn player-add" onClick={onAdd} aria-label={t('teams.addPlayer')}>＋</button>
        )}
      </div>
      <button
        className={`btn btn-sm btn-coach${isCoachDisqualified(coach) ? ' dq' : ''}`}
        onClick={onCoach}
      >
        {t('live.coachFoul')}{coach.C + coach.B > 0 ? ` (${coach.C}C ${coach.B}B)` : ''}
      </button>
    </div>
  )
}

function PlayerButton({ player, line, eligible, highlight, selected, onClick }: {
  player: Player
  line?: StatLine
  eligible: boolean
  highlight: boolean
  selected: boolean
  onClick: () => void
}) {
  const { t } = useI18n()
  const pf = line?.pf ?? 0
  const dq = line ? isPlayerDisqualified(foulCounts(line)) : false
  const cls = ['player-btn', selected && 'selected', highlight && 'eligible', !eligible && 'ineligible', dq && 'dq']
    .filter(Boolean).join(' ')
  return (
    <button className={cls} onClick={onClick} disabled={!eligible}>
      <span className="pnum">{player.number || '–'}</span>
      <span className="pname">{player.name}</span>
      <span className="pline">
        <span>{line?.pts ?? 0} {t('stat.PTS')}</span>
        <span className={`pfouls f${Math.min(pf, 5)}`}>{dq ? t('live.fouledOut') : pf > 0 ? `${t('stat.PF')} ${pf}` : ''}</span>
      </span>
    </button>
  )
}

const ACTIONS: ActionKey[][] = [
  ['FG2+', 'FG2-', 'FG3+', 'FG3-'],
  ['FT+', 'FT-', 'OREB', 'DREB'],
  ['AST', 'STL', 'BLK', 'TOV'],
  ['FOUL'],
]

function CenterPanel({ step, dispatch, onBack, playerMap, groups, ctx }: {
  step: Step
  dispatch: (i: Input) => void
  onBack: () => void
  playerMap: Map<number, Player>
  groups: GameEvent[][]
  ctx: FlowContext
}) {
  const { t, lang } = useI18n()
  const label = (id: number) => playerLabel(playerMap.get(id))
  const foot = (extra?: ReactNode) => (
    <div className="panel-foot">
      <button className="btn btn-lg btn-back" onClick={onBack}>‹ {t('live.back')}</button>
      {extra}
      <span className="grow" />
      <button className="btn btn-ghost" onClick={() => dispatch({ t: 'cancel' })}>✕ {t('live.done')}</button>
    </div>
  )

  switch (step.kind) {
    // Until a play is under way the action buttons stay up, so the action can come before or after the player
    case 'idle':
    case 'player':
    case 'action': {
      const at = step.kind === 'idle' ? undefined : step.at
      // The spot already tells a 2 from a 3, so point out those shot buttons
      const zone = at && (isThreeByLocation(at.x, at.y) ? 'FG3' : 'FG2')
      const chosen = step.kind === 'player' ? step.action : undefined
      return (
        <div className={`panel${step.kind === 'idle' ? ' panel-idle' : ''}`}>
          {step.kind === 'idle' && <p className="panel-hint">{t('live.tapCourt')}<small>{t('live.orTapPlayer')}</small></p>}
          {step.kind === 'player' && (
            <PanelHead
              title={chosen ? t(`act.${chosen}`) : t('live.tapPlayer')}
              subtitle={chosen ? t('live.tapPlayer') : t('live.moveSpot')}
              side={step.side}
            />
          )}
          {step.kind === 'action' && <PanelHead title={label(step.actor.playerId)} side={step.actor.side} />}
          <div className="action-grid">
            {ACTIONS.flat().map(a => (
              <button
                key={a}
                className={`btn action-btn act-${a.replace(/[+-]/, m => (m === '+' ? 'made' : 'miss'))}${zone && a.startsWith(zone) ? ' suggested' : ''}${a === chosen ? ' chosen' : ''}`}
                onClick={() => dispatch({ t: 'action', action: a })}
              >
                {t(`act.${a}`)}
              </button>
            ))}
          </div>
          {step.kind === 'idle' ? (
            <>
              <h4>{t('live.recent')}</h4>
              <ul className="recent-list">
                {groups.slice(0, 12).map(g => (
                  <li key={g[0].group} className={`side-${g[0].side}`}>
                    <span className="log-period">{periodLabel(g[0].period, lang)}</span>
                    {g.map(e => {
                      const d = describeShort(e, playerMap, t)
                      return (
                        <span key={e.id} className={`ev-chip side-${e.side}`}>
                          <b>{d.who}</b> {d.what}
                        </span>
                      )
                    })}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="panel-foot">
              <button className="btn btn-ghost" onClick={() => dispatch({ t: 'cancel' })}>✕ {t('live.cancel')}</button>
            </div>
          )}
        </div>
      )
    }

    case 'court':
      return (
        <div className="panel">
          <PanelHead
            title={`${label(step.actor.playerId)} — ${t(`ev.${step.shot}.${step.made ? 'made' : 'missed'}`)}`}
            side={step.actor.side}
          />
          {/* Points at the shooter's court */}
          <p className="panel-hint">
            {step.actor.side === 'home' ? `← ${t('live.shotLocation')}` : `${t('live.shotLocation')} →`}
          </p>
          {foot(<button className="btn btn-lg" onClick={() => dispatch({ t: 'skip' })}>{t('live.skip')} ›</button>)}
        </div>
      )

    case 'foulType':
      return (
        <div className="panel">
          <PanelHead title={`${label(step.actor.playerId)} — ${t('act.FOUL')}`} subtitle={t('live.foulType')} side={step.actor.side} />
          <div className="choice-grid">
            {FOUL_TYPES.map(f => (
              <button key={f} className="btn btn-lg" onClick={() => dispatch({ t: 'foulType', foulType: f })}>
                <b>{f}</b> {t(`foul.${f}`)}
              </button>
            ))}
          </div>
          {foot()}
        </div>
      )

    case 'coachFoulType':
      return (
        <div className="panel">
          <PanelHead title={t('live.coachFoul')} side={step.side} />
          <div className="choice-grid">
            <button className="btn btn-lg" onClick={() => dispatch({ t: 'coachFoulType', type: 'C' })}>{t('live.coach')}</button>
            <button className="btn btn-lg" onClick={() => dispatch({ t: 'coachFoulType', type: 'B' })}>{t('live.bench')}</button>
          </div>
          {foot()}
        </div>
      )

    case 'shotKind':
      return (
        <div className="panel">
          <PanelHead title={`${label(step.blocker.playerId)} — ${t('ev.BLK')}`} subtitle={t('live.shotKind')} side={step.blocker.side} />
          <div className="choice-grid">
            <button className="btn btn-lg" onClick={() => dispatch({ t: 'shotKind', shot: 'FG2' })}>{t('stat.2PT')}</button>
            <button className="btn btn-lg" onClick={() => dispatch({ t: 'shotKind', shot: 'FG3' })}>{t('stat.3PT')}</button>
          </div>
          {foot()}
        </div>
      )

    case 'ftCount':
      return (
        <div className="panel">
          <PanelHead
            title={t('live.freeThrows')}
            subtitle={step.shooterId != null ? label(step.shooterId) : undefined}
            side={step.shooterSide}
          />
          <div className="choice-grid choice-4">
            {[0, 1, 2, 3].map(n => (
              <button
                key={n}
                className={`btn btn-xl${n === step.suggested ? ' btn-primary' : ''}`}
                onClick={() => dispatch({ t: 'ftCount', n })}
              >
                {n}
              </button>
            ))}
          </div>
          {foot()}
        </div>
      )

    case 'ftResult':
      return (
        <div className="panel">
          <PanelHead
            title={label(step.shooter.playerId)}
            subtitle={t('live.ftOf', { i: step.index, n: step.total })}
            side={step.shooter.side}
          />
          <div className="choice-grid">
            <button className="btn btn-xl btn-made" onClick={() => dispatch({ t: 'ftResult', made: true })}>✓ {t('live.made')}</button>
            <button className="btn btn-xl btn-miss" onClick={() => dispatch({ t: 'ftResult', made: false })}>✗ {t('live.missed')}</button>
          </div>
          {foot()}
        </div>
      )

    case 'pick': {
      const { title, subtitle, side } = pickText(step, label, t)
      return (
        <div className="panel panel-pick">
          <PanelHead title={title} subtitle={subtitle} side={side} />
          <div className="choice-grid">
            <button className="btn btn-lg" onClick={() => dispatch({ t: 'skip' })}>
              {step.purpose === 'ftShooter' || step.purpose === 'blockedShooter' ? t('live.skip') : t('live.nobody')}
            </button>
            {step.purpose === 'rebound' && step.canBlock && (
              <button className="btn btn-lg" onClick={() => dispatch({ t: 'blocked' })}>{t('live.wasBlocked')}</button>
            )}
          </div>
          {step.purpose === 'fouled' && ctx.teamFouls[step.actor.side] + 1 > TEAM_FOUL_PENALTY && (
            <p className="panel-note">{t('live.penalty')}</p>
          )}
          {foot()}
        </div>
      )
    }
  }
}

function pickText(step: Extract<Step, { kind: 'pick' }>, label: (id: number) => string, t: ReturnType<typeof useI18n>['t']) {
  switch (step.purpose) {
    case 'assist':
      return { title: t('live.assistBy'), subtitle: label(step.shooter.playerId), side: step.shooter.side }
    case 'rebound':
      return { title: t('live.reboundBy'), subtitle: step.shooter ? label(step.shooter.playerId) : undefined, side: step.missSide }
    case 'blocker':
      return { title: t('live.blockedBy'), subtitle: label(step.shooter.playerId), side: step.shooter.side }
    case 'stolenFrom':
      return { title: t('live.stolenFrom'), subtitle: `${label(step.actor.playerId)} — ${t('act.STL')}`, side: step.actor.side }
    case 'stealBy':
      return { title: t('live.stealBy'), subtitle: `${label(step.actor.playerId)} — ${t('act.TOV')}`, side: step.actor.side }
    case 'fouled':
      return { title: t('live.fouledWho'), subtitle: `${label(step.actor.playerId)} — ${t(`foul.${step.foulType}`)}`, side: step.actor.side }
    case 'ftShooter':
      return { title: t('live.ftShooter'), subtitle: `${step.total} × ${t('stat.FT')}`, side: step.shooterSide }
    case 'blockedShooter':
      return { title: t('live.blockedShooter'), subtitle: `${label(step.actor.playerId)} — ${t('act.BLK')}`, side: step.actor.side }
  }
}

function PanelHead({ title, subtitle, side }: { title: string; subtitle?: string; side?: Side }) {
  return (
    <div className={`panel-head${side ? ` side-${side}` : ''}`}>
      <div className="panel-title">{title}</div>
      {subtitle && <div className="panel-subtitle">{subtitle}</div>}
    </div>
  )
}

function ClockModal({ game, onClose, enqueue }: { game: Game; onClose: () => void; enqueue: (fn: () => Promise<unknown>) => void }) {
  const { t } = useI18n()
  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick(n => n + 1), 250)
    return () => clearInterval(iv)
  }, [])
  const adjust = (ms: number) => enqueue(async () => {
    const fresh = await db.games.get(game.id!)
    if (fresh) await adjustClock(fresh, ms)
  })
  return (
    <Modal title={t('live.clockAdjust')} onClose={onClose}>
      <div className="clock-adjust">
        <div className="clock-big">{formatClock(currentClockMs(game))}</div>
        <div className="choice-grid choice-4">
          {[-60_000, -10_000, -1_000, 1_000, 10_000, 60_000].map(ms => (
            <button key={ms} className="btn btn-lg" onClick={() => adjust(ms)}>
              {ms > 0 ? '+' : '−'}{Math.abs(ms) >= 60_000 ? `${Math.abs(ms) / 60_000}′` : `${Math.abs(ms) / 1000}″`}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function AddPlayerModal({ team, onClose, onAdd }: { team?: Team; onClose: () => void; onAdd: (number: string, name: string) => void }) {
  const { t } = useI18n()
  const [number, setNumber] = useState('')
  const [name, setName] = useState('')
  return (
    <Modal
      title={`${t('teams.addPlayer')}${team ? ` — ${team.name}` : ''}`}
      onClose={onClose}
      footer={<button className="btn btn-primary" disabled={!number && !name} onClick={() => onAdd(number, name)}>{t('common.add')}</button>}
    >
      <div className="form-row">
        <label>{t('common.number')}<input inputMode="numeric" value={number} onChange={e => setNumber(e.target.value)} autoFocus /></label>
        <label className="grow">{t('common.name')}<input value={name} onChange={e => setName(e.target.value)} /></label>
      </div>
    </Modal>
  )
}

/** Pick who goes out and who comes in, or the starting five when nobody is on the court yet. */
function SubModal({ game, events, team, players, lineup, stats, onSave, onAddPlayer, onClose }: {
  game: Game
  events: GameEvent[]
  team?: Team
  players: Player[]
  lineup: number[]
  stats: GameStats
  onSave: (ins: number[], outs: number[], clockMs: number | undefined) => void
  onAddPlayer: () => void
  onClose: () => void
}) {
  const { t, lang } = useI18n()
  const [outs, setOuts] = useState<number[]>([])
  const [ins, setIns] = useState<number[]>([])
  const periodMs = periodLengthMs(game, game.period)
  // The game clock when it is used; without it, the start of the period until something happens in it
  const [time, setTime] = useState(() =>
    game.clockEnabled ? formatClock(currentClockMs(game))
      : events.some(e => e.period === game.period) ? '' : formatClock(periodMs))

  // A starting five always goes in at the tip-off, so only substitutions take a time
  const starting = lineup.length === 0
  const clockMs = time.trim() ? parseClock(time) : undefined
  const badTime = !starting && (clockMs === null || (clockMs != null && clockMs > periodMs))
  const fouledOut = (id: number) => {
    const l = stats.players.get(id)
    return !!l && isPlayerDisqualified(foulCounts(l))
  }
  const onCourt = players.filter(p => lineup.includes(p.id!))
  const bench = players.filter(p => !lineup.includes(p.id!))
  const count = lineup.length - outs.length + ins.length
  // Five on the court, or fewer once nobody else can come in
  const nobodyLeft = bench.every(p => fouledOut(p.id!) || ins.includes(p.id!))
  const valid = outs.length + ins.length > 0 && count <= 5 && (count === 5 || nobodyLeft) && !badTime

  const toggle = (list: number[], set: (l: number[]) => void, id: number) =>
    set(list.includes(id) ? list.filter(i => i !== id) : [...list, id])
  const chip = (p: Player, on: boolean, onClick: () => void, cls: string) => (
    <button key={p.id} className={`sub-chip ${cls}${on ? ' on' : ''}`} onClick={onClick} disabled={!on && cls === 'in' && fouledOut(p.id!)}>
      <span className="pnum">{p.number || '–'}</span>
      <span className="pname">{p.name}</span>
    </button>
  )

  return (
    <Modal
      title={`${t(starting ? 'live.startingFive' : 'live.sub')}${team ? ` — ${team.name}` : ''}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onAddPlayer}>＋ {t('teams.addPlayer')}</button>
          <span className={`sub-count${count > 5 ? ' over' : ''}`}>{t('live.lineupCount', { n: count })}</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onSave(ins, outs, clockMs ?? undefined)}>{t('common.save')}</button>
        </>
      }
    >
      {!starting && (
        <>
          <h3 className="sub-head">{t('live.onCourtOut')}</h3>
          <div className="sub-chips">{onCourt.map(p => chip(p, outs.includes(p.id!), () => toggle(outs, setOuts, p.id!), 'out'))}</div>
        </>
      )}
      <h3 className="sub-head">{t(starting ? 'live.pickStarters' : 'live.benchIn')}</h3>
      <div className="sub-chips">{bench.map(p => chip(p, ins.includes(p.id!), () => toggle(ins, setIns, p.id!), 'in'))}</div>
      {starting && events.length > 0 && (
        <p className="hint">{t('live.startersNote', { time: `${periodLabel(1, lang)} ${formatClock(periodLengthMs(game, 1))}` })}</p>
      )}
      {!starting && <div className="form-row sub-time">
        <label>
          {t('live.subTime', { period: periodLabel(game.period, lang) })}
          <input inputMode="numeric" value={time} onChange={e => setTime(e.target.value)} placeholder="5:32" />
        </label>
        <p className={badTime ? 'error' : 'hint'}>
          {badTime ? t('live.badTime', { max: formatClock(periodMs) }) : (
            <>{clockMs != null && <b>= {formatClock(clockMs)} · </b>}{t('live.subTimeHint')}</>
          )}
        </p>
      </div>}
    </Modal>
  )
}

/** Keep the screen awake while entering a game. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const request = async () => {
      try {
        if (document.visibilityState === 'visible' && 'wakeLock' in navigator) {
          lock = await navigator.wakeLock.request('screen')
          if (cancelled) lock.release()
        }
      } catch {
        // not allowed (e.g. battery saver); nothing to do
      }
    }
    request()
    document.addEventListener('visibilitychange', request)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', request)
      lock?.release()
    }
  }, [])
}
