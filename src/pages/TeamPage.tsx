import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { useI18n } from '../i18n'
import { db } from '../db/db'
import type { Player } from '../db/types'
import { addPlayer, addPlayersQuick, deleteTeam, setMyTeam, sortPlayers } from '../db/repo'

export function TeamPage() {
  const { id } = useParams()
  const teamId = Number(id)
  const { t } = useI18n()
  const navigate = useNavigate()
  const team = useLiveQuery(() => db.teams.get(teamId), [teamId])
  const players = useLiveQuery(async () => sortPlayers(await db.players.where('teamId').equals(teamId).toArray()), [teamId])
  const [quick, setQuick] = useState('')
  const [num, setNum] = useState('')
  const [name, setName] = useState('')

  if (team === undefined || players === undefined) return null
  if (!team) return <p>{t('common.noData')}</p>

  const rename = async () => {
    const n = prompt(t('teams.rename'), team.name)
    if (n?.trim()) await db.teams.update(teamId, { name: n.trim() })
  }
  const remove = async () => {
    if (!confirm(t('common.areYouSure'))) return
    try {
      await deleteTeam(teamId)
      navigate('/teams', { replace: true })
    } catch {
      alert(t('common.cannotDeleteHasGames'))
    }
  }
  const add = async () => {
    if (!num.trim() && !name.trim()) return
    await addPlayer({ teamId, number: num, name })
    setNum('')
    setName('')
  }

  return (
    <>
      <div className="page-head">
        <h1>{team.name} {team.isMine && <span className="badge">{t('teams.myTeam')}</span>}</h1>
        <div className="btn-row">
          <button className="btn" onClick={rename}>{t('teams.rename')}</button>
          {!team.isMine && <Link className="btn" to={`/h2h/${teamId}`}>{t('nav.h2h')}</Link>}
          {!team.isMine && <button className="btn" onClick={() => setMyTeam(teamId)}>{t('teams.setMine')}</button>}
          <button className="btn btn-danger" onClick={remove}>{t('common.delete')}</button>
        </div>
      </div>

      <div className="card">
        <h2>{t('teams.roster')}</h2>
        <table className="simple-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>{t('common.number')}</th>
              <th>{t('common.name')}</th>
              <th style={{ width: 110 }}>{t('common.position')}</th>
              <th style={{ width: 80 }}>{t('common.active')}</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {players.map(p => <PlayerRow key={p.id} player={p} />)}
            <tr>
              <td><input inputMode="numeric" value={num} onChange={e => setNum(e.target.value)} placeholder="#" /></td>
              <td><input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} /></td>
              <td colSpan={3}><button className="btn btn-primary" onClick={add}>＋ {t('teams.addPlayer')}</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>{t('teams.quickAdd')}</h2>
        <p className="hint">{t('teams.quickAddHint')}</p>
        <div className="form-row">
          <label className="grow"><textarea value={quick} onChange={e => setQuick(e.target.value)} /></label>
          <button className="btn" disabled={!quick.trim()} onClick={async () => { await addPlayersQuick(teamId, quick); setQuick('') }}>
            {t('common.add')}
          </button>
        </div>
      </div>
    </>
  )
}

/** Inline-editable roster row; saves on blur. */
function PlayerRow({ player }: { player: Player }) {
  const { t } = useI18n()
  const [number, setNumber] = useState(player.number)
  const [name, setName] = useState(player.name)
  const [position, setPosition] = useState(player.position ?? '')
  const save = (changes: Partial<Player>) => db.players.update(player.id!, changes)

  const remove = async () => {
    const used = await db.events.filter(e => e.playerId === player.id || e.targetPlayerId === player.id).count()
    if (used) {
      // Keep history intact: deactivate instead of deleting
      alert(t('common.cannotDeleteHasGames'))
      await save({ active: false })
      return
    }
    if (confirm(t('common.areYouSure'))) await db.players.delete(player.id!)
  }

  return (
    <tr style={player.active ? undefined : { opacity: 0.5 }}>
      <td><input inputMode="numeric" value={number} onChange={e => setNumber(e.target.value)} onBlur={() => save({ number: number.trim() })} /></td>
      <td><input value={name} onChange={e => setName(e.target.value)} onBlur={() => save({ name: name.trim() })} /></td>
      <td><input value={position} onChange={e => setPosition(e.target.value)} onBlur={() => save({ position: position.trim() || undefined })} /></td>
      <td><input type="checkbox" checked={player.active} onChange={e => save({ active: e.target.checked })} /></td>
      <td><button className="btn btn-ghost btn-sm" onClick={remove} aria-label={t('common.delete')}>🗑</button></td>
    </tr>
  )
}
