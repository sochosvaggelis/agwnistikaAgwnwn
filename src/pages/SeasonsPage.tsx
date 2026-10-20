import { useState } from 'react'
import { useI18n } from '../i18n'
import { addCompetition, addSeason, deleteCompetition, deleteSeason } from '../db/repo'
import { useCompetitions, useSeasons } from '../hooks'
import type { Season } from '../db/types'

export function SeasonsPage() {
  const { t } = useI18n()
  const seasons = useSeasons()
  const [name, setName] = useState('')

  if (!seasons) return null
  return (
    <>
      <h1>{t('seasons.title')}</h1>
      <div className="card">
        <div className="form-row">
          <label className="grow">{t('seasons.new')}<input value={name} onChange={e => setName(e.target.value)} placeholder={t('seasons.namePlaceholder')} /></label>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={async () => { await addSeason(name); setName('') }}>
            {t('common.add')}
          </button>
        </div>
      </div>
      {seasons.length === 0 && <p className="empty">{t('seasons.empty')}</p>}
      {seasons.map(s => <SeasonCard key={s.id} season={s} />)}
    </>
  )
}

function SeasonCard({ season }: { season: Season }) {
  const { t } = useI18n()
  const competitions = useCompetitions()?.filter(c => c.seasonId === season.id)
  const [name, setName] = useState('')

  const guarded = async (fn: () => Promise<void>) => {
    if (!confirm(t('common.areYouSure'))) return
    try {
      await fn()
    } catch {
      alert(t('common.cannotDeleteHasGames'))
    }
  }

  return (
    <div className="card">
      <div className="page-head">
        <h2 style={{ margin: 0 }}>{season.name}</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => guarded(() => deleteSeason(season.id!))}>🗑</button>
      </div>
      <ul className="list">
        {competitions?.map(c => (
          <li key={c.id} className="list-row">
            <span className="grow">{c.name}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => guarded(() => deleteCompetition(c.id!))}>🗑</button>
          </li>
        ))}
      </ul>
      <div className="form-row" style={{ marginTop: 8 }}>
        <label className="grow">
          {t('seasons.newCompetition')}
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('seasons.competitionPlaceholder')} />
        </label>
        <button className="btn" disabled={!name.trim()} onClick={async () => { await addCompetition(season.id!, name); setName('') }}>
          {t('common.add')}
        </button>
      </div>
    </div>
  )
}
