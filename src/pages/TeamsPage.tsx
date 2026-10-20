import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useI18n } from '../i18n'
import { addTeam } from '../db/repo'
import { usePlayers, useTeams } from '../hooks'

export function TeamsPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const teams = useTeams()
  const players = usePlayers()
  const [name, setName] = useState('')

  if (!teams) return null
  const mine = teams.find(tm => tm.isMine)
  const opponents = teams.filter(tm => !tm.isMine)
  const count = (teamId: number) => players?.filter(p => p.teamId === teamId && p.active).length ?? 0

  const create = async (isMine: boolean) => {
    if (!name.trim()) return
    const id = await addTeam(name, isMine)
    setName('')
    navigate(`/teams/${id}`)
  }

  return (
    <>
      <h1>{t('teams.title')}</h1>

      <div className="card">
        <h2>{t('teams.myTeam')}</h2>
        {mine ? (
          <Link className="list-row" to={`/teams/${mine.id}`}>
            <b className="grow">{mine.name}</b>
            <span className="muted">{t('teams.playersCount', { n: count(mine.id!) })}</span>
            <span>›</span>
          </Link>
        ) : (
          <p className="muted">{t('teams.noMyTeam')}</p>
        )}
      </div>

      <div className="card">
        <h2>{t('teams.new')}</h2>
        <div className="form-row">
          <label className="grow">{t('common.name')}<input value={name} onChange={e => setName(e.target.value)} /></label>
          {!mine && <button className="btn btn-primary" disabled={!name.trim()} onClick={() => create(true)}>{t('teams.myTeam')}</button>}
          <button className="btn" disabled={!name.trim()} onClick={() => create(false)}>{t('common.opponent')}</button>
        </div>
      </div>

      <div className="card">
        <h2>{t('teams.opponents')}</h2>
        {opponents.length === 0 && <p className="muted">{t('common.noData')}</p>}
        <ul className="list">
          {opponents.map(o => (
            <li key={o.id}>
              <Link className="list-row" to={`/teams/${o.id}`}>
                <span className="grow">{o.name}</span>
                <span className="muted">{t('teams.playersCount', { n: count(o.id!) })}</span>
                <span>›</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
