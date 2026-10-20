import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { useI18n } from '../i18n'
import { db } from '../db/db'
import type { Player, Side } from '../db/types'
import { addCompetition, addPlayersQuick, addSeason, addTeam, createGame, playerLabel, sortPlayers } from '../db/repo'
import { useCompetitions, useMyTeam, useSeasons, useTeams } from '../hooks'
import { todayISO } from '../format'
import { DEFAULT_PERIOD_MIN } from '../stats/rules'

const NEW = 'new'

export function NewGamePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const myTeam = useMyTeam()
  const teams = useTeams()
  const seasons = useSeasons()
  const competitions = useCompetitions()

  const [seasonSel, setSeasonSel] = useState<string>('')
  const [newSeason, setNewSeason] = useState('')
  const [compSel, setCompSel] = useState<string>('')
  const [newComp, setNewComp] = useState('')
  const [date, setDate] = useState(todayISO())
  const [venue, setVenue] = useState('')
  const [mySide, setMySide] = useState<Side>('home')
  const [oppSel, setOppSel] = useState<string>('')
  const [newOppName, setNewOppName] = useState('')
  const [newOppPlayers, setNewOppPlayers] = useState('')
  const [clockEnabled, setClockEnabled] = useState(false)
  const [periodLength, setPeriodLength] = useState(DEFAULT_PERIOD_MIN)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Defaults once data has loaded
  const seasonId = seasonSel || (seasons?.length ? String(seasons[0].id) : NEW)
  const seasonComps = useMemo(
    () => (competitions ?? []).filter(c => seasonId !== NEW && c.seasonId === Number(seasonId)),
    [competitions, seasonId],
  )
  const compId = compSel && (compSel === NEW || seasonComps.some(c => String(c.id) === compSel))
    ? compSel
    : seasonComps.length ? String(seasonComps[seasonComps.length - 1].id) : NEW
  const opponents = (teams ?? []).filter(tm => !tm.isMine)
  const oppId = oppSel || (opponents.length ? String(opponents[0].id) : NEW)

  const myPlayers = useLiveQuery(
    async () => (myTeam ? sortPlayers(await db.players.where('teamId').equals(myTeam.id!).filter(p => p.active).toArray()) : []),
    [myTeam?.id],
  )
  const oppPlayers = useLiveQuery(
    async () => (oppId !== NEW ? sortPlayers(await db.players.where('teamId').equals(Number(oppId)).filter(p => p.active).toArray()) : []),
    [oppId],
  )

  const [myRoster, setMyRoster] = useDefaultSelection(myPlayers)
  const [oppRoster, setOppRoster] = useDefaultSelection(oppPlayers)

  if (myTeam === undefined || teams === undefined || seasons === undefined) return null
  if (myTeam === null) {
    return (
      <div className="card">
        <h1>{t('newGame.title')}</h1>
        <p>{t('newGame.needMyTeam')}</p>
        <Link className="btn btn-primary" to="/teams">{t('nav.teams')}</Link>
      </div>
    )
  }

  async function start() {
    setError('')
    if (!myRoster?.size) return setError(t('newGame.needPlayers'))
    if (seasonId === NEW && !newSeason.trim()) return setError(t('newGame.needSeason'))
    if (compId === NEW && !newComp.trim()) return setError(t('newGame.needSeason'))
    if (oppId === NEW && !newOppName.trim()) return setError(t('newGame.newOpponentName'))
    setBusy(true)
    try {
      const sId = seasonId === NEW ? await addSeason(newSeason) : Number(seasonId)
      const cId = compId === NEW ? await addCompetition(sId, newComp) : Number(compId)
      let opponentId: number
      let oppIds: number[]
      if (oppId === NEW) {
        opponentId = await addTeam(newOppName)
        oppIds = newOppPlayers.trim() ? await addPlayersQuick(opponentId, newOppPlayers) : []
      } else {
        opponentId = Number(oppId)
        oppIds = [...(oppRoster ?? [])]
      }
      const mine = [...myRoster]
      const gameId = await createGame({
        competitionId: cId,
        date,
        venue: venue.trim() || undefined,
        homeTeamId: mySide === 'home' ? myTeam!.id! : opponentId,
        awayTeamId: mySide === 'home' ? opponentId : myTeam!.id!,
        roster: mySide === 'home' ? { home: mine, away: oppIds } : { home: oppIds, away: mine },
        clockEnabled,
        periodLengthMin: periodLength,
      })
      navigate(`/games/${gameId}/live`, { replace: true })
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <>
      <h1>{t('newGame.title')}</h1>

      <div className="card">
        <div className="form-row">
          <label>
            {t('common.season')}
            <select value={seasonId} onChange={e => { setSeasonSel(e.target.value); setCompSel('') }}>
              {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value={NEW}>＋ {t('seasons.new')}</option>
            </select>
          </label>
          {seasonId === NEW && (
            <label>{t('seasons.new')}<input value={newSeason} onChange={e => setNewSeason(e.target.value)} placeholder={t('seasons.namePlaceholder')} /></label>
          )}
          <label>
            {t('common.competition')}
            <select value={compId} onChange={e => setCompSel(e.target.value)}>
              {seasonComps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={NEW}>＋ {t('seasons.newCompetition')}</option>
            </select>
          </label>
          {compId === NEW && (
            <label>{t('seasons.newCompetition')}<input value={newComp} onChange={e => setNewComp(e.target.value)} placeholder={t('seasons.competitionPlaceholder')} /></label>
          )}
          <label>{t('common.date')}<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label className="grow">{t('common.venue')}<input value={venue} onChange={e => setVenue(e.target.value)} /></label>
        </div>
      </div>

      <div className="card">
        <div className="form-row">
          <label>
            {t('newGame.myTeamPlays')}
            <span className="segmented">
              <button className={mySide === 'home' ? 'on' : ''} onClick={() => setMySide('home')}>{t('common.home')}</button>
              <button className={mySide === 'away' ? 'on' : ''} onClick={() => setMySide('away')}>{t('common.away')}</button>
            </span>
          </label>
          <label className="grow">
            {t('common.opponent')}
            <select value={oppId} onChange={e => setOppSel(e.target.value)}>
              {opponents.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              <option value={NEW}>＋ {t('newGame.newOpponent')}</option>
            </select>
          </label>
        </div>
        {oppId === NEW && (
          <div className="form-row" style={{ marginTop: 12 }}>
            <label className="grow">{t('newGame.newOpponentName')}<input value={newOppName} onChange={e => setNewOppName(e.target.value)} /></label>
            <label className="grow">
              {t('newGame.newOpponentPlayers')}
              <input value={newOppPlayers} onChange={e => setNewOppPlayers(e.target.value)} placeholder="4 5 7 9 10 12" />
            </label>
            <p className="hint" style={{ flexBasis: '100%' }}>{t('teams.quickAddHint')}</p>
          </div>
        )}
      </div>

      <div className="grid-2">
        <RosterPicker title={myTeam.name} players={myPlayers} selected={myRoster} onChange={setMyRoster} teamId={myTeam.id!} />
        {oppId !== NEW && (
          <RosterPicker
            title={opponents.find(o => String(o.id) === oppId)?.name ?? ''}
            players={oppPlayers}
            selected={oppRoster}
            onChange={setOppRoster}
            teamId={Number(oppId)}
          />
        )}
      </div>

      <div className="card">
        <div className="form-row">
          <label className="inline">
            <input type="checkbox" checked={clockEnabled} onChange={e => setClockEnabled(e.target.checked)} />
            {t('newGame.useClock')}
          </label>
          <label>
            {t('newGame.periodLength')}
            <input type="number" min={1} max={20} value={periodLength} onChange={e => setPeriodLength(Math.max(1, Number(e.target.value) || DEFAULT_PERIOD_MIN))} />
          </label>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-xl" style={{ width: '100%' }} onClick={start} disabled={busy}>
        ▶ {t('newGame.start')}
      </button>
    </>
  )
}

/** Every active player is dressed by default; players added later get selected too. */
function useDefaultSelection(players: Player[] | undefined) {
  const [selected, setSelected] = useState<Set<number> | null>(null)
  const seen = useRef(new Set<number>())
  useEffect(() => {
    if (!players) return
    const fresh = players.filter(p => !seen.current.has(p.id!)).map(p => p.id!)
    seen.current = new Set(players.map(p => p.id!))
    setSelected(prev => {
      const next = new Set(prev ?? [])
      for (const id of fresh) next.add(id)
      return next
    })
  }, [players])
  return [selected, setSelected] as const
}

function RosterPicker({ title, players, selected, onChange, teamId }: {
  title: string
  players: Player[] | undefined
  selected: Set<number> | null
  onChange: (s: Set<number>) => void
  teamId: number
}) {
  const { t } = useI18n()
  if (!players || !selected) return <div className="card" />
  const toggle = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  return (
    <div className="card">
      <div className="page-head">
        <h2 style={{ margin: 0 }}>{title} <span className="muted">({selected.size})</span></h2>
        <div className="btn-row">
          <button className="btn btn-sm" onClick={() => onChange(new Set(players.map(p => p.id!)))}>{t('newGame.selectAll')}</button>
          <button className="btn btn-sm" onClick={() => onChange(new Set())}>{t('newGame.selectNone')}</button>
        </div>
      </div>
      {players.length === 0 && <p className="muted">{t('newGame.noPlayers')}</p>}
      <div className="roster-check">
        {players.map(p => (
          <label key={p.id} className="inline">
            <input type="checkbox" checked={selected.has(p.id!)} onChange={() => toggle(p.id!)} />
            {playerLabel(p)}
          </label>
        ))}
      </div>
      <QuickAdd teamId={teamId} />
    </div>
  )
}

function QuickAdd({ teamId }: { teamId: number }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  return (
    <div className="form-row" style={{ marginTop: 12 }}>
      <label className="grow">
        {t('teams.quickAdd')}
        <input value={text} onChange={e => setText(e.target.value)} placeholder="4 5 7 9" />
      </label>
      <button className="btn" disabled={!text.trim()} onClick={async () => { await addPlayersQuick(teamId, text); setText('') }}>
        {t('common.add')}
      </button>
    </div>
  )
}
