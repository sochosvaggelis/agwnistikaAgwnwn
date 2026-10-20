import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Game, GameEvent, Player, Side, Team } from '../db/types'
import {
  addPlayer, adjustClock, appendEvents, deleteGroup, getGameEvents, playerLabel, setPeriod, sortPlayers,
  startClock, stopClock, undoLastGroup, updateGame,
} from '../db/repo'
import { advance, isEligible, type ActionKey, type Draft, type FlowContext, type Input, type Step } from './flow'
import { computeGameStats, foulCounts, teamFoulsInPeriod, type GameStats, type StatLine } from '../stats/compute'
import { currentClockMs, formatClock, FOUL_TYPES, isCoachDisqualified, isPlayerDisqualified, periodLabel, TEAM_FOUL_PENALTY } from '../stats/rules'
import { useI18n } from '../i18n'
import { Court } from '../components/Court'
import { Modal } from '../components/Modal'
import { StatTable } from '../components/StatTable'
import { describeEvent, describeShort, groupEvents } from './describe'
import './live.css'

const SIDES: Side[] = ['home', 'away']
const IDLE: Step = { kind: 'idle' }

export function LiveGamePage() {
  const { id } = useParams()
  const gameId = Number(id)
  const game = useLiveQuery(() => db.games.get(gameId), [gameId])
  const events = useLiveQuery(() => getGameEvents(gameId), [gameId])
  const { t } = useI18n()

  if (game === undefined || events === undefined) return null
  if (!game) return <div className="page"><p>{t('game.notFound')}</p></div>
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

  // ---------- entry flow ----------
  const [step, setStepState] = useState<Step>(IDLE)
  const stepRef = useRef<Step>(IDLE)
  const setStep = (s: Step) => {
    stepRef.current = s
    setStepState(s)
  }

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

  const dispatch = (input: Input) => {
    const r = advance(stepRef.current, input, ctx)
    setStep(r.step)
    if (r.writes.length) {
      const drafts: Draft[] = r.writes
      enqueue(async () => {
        flowGroup.current = await appendEvents(gameId, drafts, flowGroup.current ?? 'new')
      })
    }
    if (r.step.kind === 'idle') enqueue(async () => { flowGroup.current = null })
  }

  const undo = () => {
    setStep(IDLE)
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
  const [modal, setModal] = useState<null | 'log' | 'box' | 'clock' | { addTo: Side }>(null)

  const changePeriod = (delta: 1 | -1) => {
    const p = game.period + delta
    if (p < 1) return
    const msg = delta > 0 ? 'live.confirmNextPeriod' : 'live.confirmPrevPeriod'
    if (!confirm(t(msg, { period: periodLabel(p, lang) }))) return
    setStep(IDLE)
    enqueue(() => setPeriod(game, p))
  }

  const endGame = () => {
    if (!confirm(t('live.confirmEnd'))) return
    enqueue(async () => {
      await stopClock(game)
      await updateGame(gameId, { status: 'finished' })
      navigate(`/games/${gameId}`, { replace: true })
    })
  }

  const teamName = (side: Side) => teams?.[side === 'home' ? 0 : 1]?.name ?? ''
  const groups = useMemo(() => groupEvents(events), [events])
  const lastGroupText = groups[0]?.map(e => {
    const d = describeShort(e, playerMap, t)
    return `${d.who} ${d.what}`
  }).join(' · ')

  return (
    <div className="live">
      <header className="live-top">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>‹ {t('live.exit')}</button>
        <TeamScore side="home" name={teamName('home')} stats={stats} period={game.period} />
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
        <TeamScore side="away" name={teamName('away')} stats={stats} period={game.period} />
      </header>

      <div className="live-body">
        <RosterColumn
          side="home" players={roster.home} stats={stats} step={step}
          onPlayer={p => dispatch({ t: 'player', side: 'home', playerId: p })}
          onCoach={() => dispatch({ t: 'coachFoul', side: 'home' })}
          onAdd={() => setModal({ addTo: 'home' })}
        />
        <div className="live-center">
          <CenterPanel step={step} dispatch={dispatch} playerMap={playerMap} groups={groups} ctx={ctx} />
        </div>
        <RosterColumn
          side="away" players={roster.away} stats={stats} step={step}
          onPlayer={p => dispatch({ t: 'player', side: 'away', playerId: p })}
          onCoach={() => dispatch({ t: 'coachFoul', side: 'away' })}
          onAdd={() => setModal({ addTo: 'away' })}
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
      {modal && typeof modal === 'object' && (
        <AddPlayerModal
          team={teams?.[modal.addTo === 'home' ? 0 : 1]}
          onClose={() => setModal(null)}
          onAdd={(number, name) => {
            const side = modal.addTo
            const teamId = side === 'home' ? game.homeTeamId : game.awayTeamId
            enqueue(async () => {
              const pid = await addPlayer({ teamId, number, name })
              const fresh = await db.games.get(gameId)
              if (fresh) await updateGame(gameId, { roster: { ...fresh.roster, [side]: [...fresh.roster[side], pid] } })
            })
            setModal(null)
          }}
        />
      )}
    </div>
  )
}

function TeamScore({ side, name, stats, period }: { side: Side; name: string; stats: GameStats; period: number }) {
  const { t } = useI18n()
  const team = stats.teams[side]
  const fouls = teamFoulsInPeriod(team, period)
  const penalty = fouls >= TEAM_FOUL_PENALTY
  return (
    <div className={`team-score side-${side}`}>
      <span className="team-name">{name}</span>
      <span className="score">{team.score}</span>
      <span className={`team-fouls${penalty ? ' penalty' : ''}`} title={t('live.teamFouls')}>
        {t('stat.PF')} {fouls}{penalty ? ` · ${t('live.penalty')}` : ''}
      </span>
    </div>
  )
}

interface RosterProps {
  side: Side
  players: Player[]
  stats: GameStats
  step: Step
  onPlayer: (id: number) => void
  onCoach: () => void
  onAdd: () => void
}

function RosterColumn({ side, players, stats, step, onPlayer, onCoach, onAdd }: RosterProps) {
  const { t } = useI18n()
  const picking = step.kind === 'pick'
  const selected = step.kind === 'action' || step.kind === 'foulType' ? step.actor : undefined
  const coach = stats.teams[side].coachFouls

  return (
    <div className={`roster side-${side}${picking ? ' picking' : ''}`}>
      <div className="roster-grid">
        {players.map(p => {
          const line = stats.players.get(p.id!)
          const eligible = !picking || isEligible(step, side, p.id!)
          const isSelected = selected?.side === side && selected.playerId === p.id
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
        <button className="player-btn player-add" onClick={onAdd} aria-label={t('teams.addPlayer')}>＋</button>
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

function CenterPanel({ step, dispatch, playerMap, groups, ctx }: {
  step: Step
  dispatch: (i: Input) => void
  playerMap: Map<number, Player>
  groups: GameEvent[][]
  ctx: FlowContext
}) {
  const { t, lang } = useI18n()
  const label = (id: number) => playerLabel(playerMap.get(id))
  const cancel = <button className="btn btn-ghost" onClick={() => dispatch({ t: 'cancel' })}>✕ {t('live.done')}</button>

  switch (step.kind) {
    case 'idle':
      return (
        <div className="panel panel-idle">
          <p className="panel-hint">{t('live.tapPlayer')}</p>
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
        </div>
      )

    case 'action':
      return (
        <div className="panel">
          <PanelHead title={label(step.actor.playerId)} side={step.actor.side} />
          <div className="action-grid">
            {ACTIONS.flat().map(a => (
              <button
                key={a}
                className={`btn action-btn act-${a.replace(/[+-]/, m => (m === '+' ? 'made' : 'miss'))}`}
                onClick={() => dispatch({ t: 'action', action: a })}
              >
                {t(`act.${a}`)}
              </button>
            ))}
          </div>
          <div className="panel-foot">
            <button className="btn btn-ghost" onClick={() => dispatch({ t: 'cancel' })}>✕ {t('live.cancel')}</button>
          </div>
        </div>
      )

    case 'court':
      return (
        <div className="panel panel-court">
          <PanelHead
            title={`${label(step.actor.playerId)} — ${t(`ev.${step.shot}.${step.made ? 'made' : 'missed'}`)}`}
            subtitle={t('live.shotLocation')}
            side={step.actor.side}
          />
          <Court onTap={(x, y) => dispatch({ t: 'court', x, y })} highlight={step.shot} className="court-input" />
          <div className="panel-foot">
            <button className="btn btn-lg" onClick={() => dispatch({ t: 'skip' })}>{t('live.skip')} ›</button>
            {cancel}
          </div>
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
          <div className="panel-foot">
            <button className="btn btn-ghost" onClick={() => dispatch({ t: 'cancel' })}>✕ {t('live.cancel')}</button>
          </div>
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
          <div className="panel-foot">{cancel}</div>
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
          <div className="panel-foot">{cancel}</div>
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
          <div className="panel-foot">{cancel}</div>
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
          <div className="panel-foot">{cancel}</div>
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
          <div className="panel-foot">{cancel}</div>
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

function PanelHead({ title, subtitle, side }: { title: string; subtitle?: string; side: Side }) {
  return (
    <div className={`panel-head side-${side}`}>
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
