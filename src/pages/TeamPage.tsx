import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { useI18n } from '../i18n'
import { db } from '../db/db'
import type { Player, Team } from '../db/types'
import { deleteTeam, mergePlayers, playerLabel, setMyTeam, setTeamColors, sortPlayers } from '../db/repo'
import { playersNamed, sameNameGroups } from '../db/players'
import { addPlayerChecked, addPlayersQuickChecked } from '../addPlayers'
import { Modal } from '../components/Modal'
import { PRESET_COLORS, teamColors, teamColorVars } from '../teamColors'
import { TeamName, TeamSwatch } from '../components/TeamSwatch'

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
  /** The two players being merged, `from` into `into` */
  const [merging, setMerging] = useState<{ from: number; into?: number } | null>(null)

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
    if ((await addPlayerChecked(teamId, num, name, t)) == null) return
    setNum('')
    setName('')
  }

  return (
    <>
      <div className="page-head">
        <h1><TeamSwatch team={team} />{team.name} {team.isMine && <span className="badge">{t('teams.myTeam')}</span>}</h1>
        <div className="btn-row">
          <button className="btn" onClick={rename}>{t('teams.rename')}</button>
          {!team.isMine && <Link className="btn" to={`/h2h/${teamId}`}>{t('nav.h2h')}</Link>}
          {!team.isMine && <button className="btn" onClick={() => setMyTeam(teamId)}>{t('teams.setMine')}</button>}
          <button className="btn btn-danger" onClick={remove}>{t('common.delete')}</button>
        </div>
      </div>

      <div className="card">
        <h2>{t('teams.roster')}</h2>
        {/* One person entered twice, the later one most likely the duplicate */}
        {sameNameGroups(players).map(group => {
          const [first, ...rest] = [...group].sort((a, b) => a.createdAt - b.createdAt)
          return (
            <div key={first.id} className="banner same-name">
              <span>{t('teams.sameNameFound')} <b>{group.map(playerLabel).join(', ')}</b></span>
              <button className="btn btn-sm" onClick={() => setMerging({ from: rest[rest.length - 1].id!, into: first.id })}>{t('teams.merge')}</button>
            </div>
          )
        })}
        <table className="simple-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>{t('common.number')}</th>
              <th>{t('common.name')}</th>
              <th style={{ width: 110 }}>{t('common.position')}</th>
              <th style={{ width: 80 }}>{t('common.active')}</th>
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {players.map(p => <PlayerRow key={p.id} player={p} canMerge={players.length > 1} onMerge={() => setMerging({ from: p.id! })} />)}
            <tr>
              <td><input inputMode="numeric" value={num} onChange={e => setNum(e.target.value)} placeholder="#" /></td>
              <td><input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} /></td>
              <td colSpan={3}><button className="btn btn-primary" onClick={add}>＋ {t('teams.addPlayer')}</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <TeamColors team={team} />

      <div className="card">
        <h2>{t('teams.quickAdd')}</h2>
        <p className="hint">{t('teams.quickAddHint')}</p>
        <div className="form-row">
          <label className="grow"><textarea value={quick} onChange={e => setQuick(e.target.value)} /></label>
          <button className="btn" disabled={!quick.trim()} onClick={async () => { if (await addPlayersQuickChecked(teamId, quick, t)) setQuick('') }}>
            {t('common.add')}
          </button>
        </div>
      </div>
      {merging && <MergeModal players={players} initial={merging} onClose={() => setMerging(null)} />}
    </>
  )
}

/** Make two players of the team one, as one person was entered twice */
function MergeModal({ players, initial, onClose }: { players: Player[]; initial: { from: number; into?: number }; onClose: () => void }) {
  const { t } = useI18n()
  const from0 = players.find(p => p.id === initial.from)
  // Without a choice yet, someone with the same name, else the first other player
  const into0 = initial.into ?? (from0 && playersNamed(players, from0.name).find(p => p.id !== from0.id)?.id) ?? players.find(p => p.id !== initial.from)?.id
  const [from, setFrom] = useState(initial.from)
  const [into, setInto] = useState(into0 ?? initial.from)
  const merge = async () => {
    try {
      await mergePlayers(from, into)
      onClose()
    } catch (e) {
      alert(e instanceof Error && e.message === 'both-in-game' ? t('teams.mergeBothInGame') : String(e))
    }
  }
  const select = (value: number, onChange: (id: number) => void) => (
    <select value={value} onChange={e => onChange(Number(e.target.value))}>
      {players.map(p => <option key={p.id} value={p.id}>{playerLabel(p)}</option>)}
    </select>
  )
  return (
    <Modal
      title={t('teams.mergeTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={from === into} onClick={merge}>{t('teams.merge')}</button>
        </>
      }
    >
      <p className="hint">{t('teams.mergeHint')}</p>
      <div className="form-row">
        <label className="grow">{t('teams.mergeKeep')}{select(into, setInto)}</label>
        <label className="grow">{t('teams.mergeFrom')}{select(from, setFrom)}</label>
      </div>
    </Modal>
  )
}

/** The team's two colors, each optional; clearing the main color moves the second one up */
function TeamColors({ team }: { team: Team }) {
  const { t } = useI18n()
  const [main, second] = teamColors(team)
  const save = (colors: (string | undefined)[]) => setTeamColors(team.id!, colors)

  return (
    <div className="card">
      <h2>{t('teams.colors')}</h2>
      <p className="hint">{t('teams.colorsHint')}</p>
      <ColorPicker label={t('teams.color1')} value={main} onChange={c => save([c, second])} />
      <ColorPicker label={t('teams.color2')} value={second} disabled={!main} onChange={c => save([main, c])} />
      {main && (
        <div className="color-row">
          <span className="color-row-label">{t('teams.colorsPreview')}</span>
          {/* The team as the home side of a game, on a light card and on the scoreboard */}
          <div className="colors-preview team-colors" style={teamColorVars(team)}>
            <span className="colors-preview-card">
              <b className="colors-preview-name"><TeamName team={team} /></b>
              <span className="colors-preview-chip">#7</span>
            </span>
            <span className="colors-preview-bar"><b>72</b></span>
          </div>
        </div>
      )}
    </div>
  )
}

function ColorPicker({ label, value, disabled, onChange }: {
  label: string
  value?: string
  disabled?: boolean
  onChange: (color: string | undefined) => void
}) {
  const { t } = useI18n()
  const custom = useRef<HTMLInputElement>(null)
  // The native change event fires once the picker closes; React's onChange would save every step of a drag
  useEffect(() => {
    const el = custom.current
    if (!el) return
    const commit = () => onChange(el.value)
    el.addEventListener('change', commit)
    return () => el.removeEventListener('change', commit)
  }, [onChange])
  useEffect(() => {
    if (custom.current && value) custom.current.value = value
  }, [value])
  const isCustom = !!value && !PRESET_COLORS.includes(value)

  return (
    <div className="color-row">
      <span className="color-row-label">{label}</span>
      <div className="color-choices" role="group" aria-label={label}>
        {PRESET_COLORS.map(c => (
          <button
            key={c}
            className={`color-choice${c === value ? ' on' : ''}`}
            style={{ background: c }}
            disabled={disabled}
            aria-label={c}
            aria-pressed={c === value}
            onClick={() => onChange(c)}
          />
        ))}
        <label className={`color-choice color-custom${isCustom ? ' on' : ''}`} style={isCustom ? { background: value } : undefined}>
          <input ref={custom} type="color" defaultValue={value ?? '#808080'} disabled={disabled} aria-label={t('teams.colorCustom')} />
        </label>
        <button className="btn btn-sm" disabled={disabled || !value} onClick={() => onChange(undefined)}>{t('common.none')}</button>
      </div>
    </div>
  )
}

/** Inline-editable roster row; saves on blur. */
function PlayerRow({ player, canMerge, onMerge }: { player: Player; canMerge: boolean; onMerge: () => void }) {
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
      <td className="row-actions">
        {canMerge && <button className="btn btn-ghost btn-sm" onClick={onMerge} title={t('teams.merge')} aria-label={t('teams.merge')}>⇄</button>}
        <button className="btn btn-ghost btn-sm" onClick={remove} aria-label={t('common.delete')}>🗑</button>
      </td>
    </tr>
  )
}
