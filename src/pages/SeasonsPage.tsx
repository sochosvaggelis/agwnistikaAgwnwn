import { useState } from 'react'
import { useI18n } from '../i18n'
import { addCompetition, addSeason, deleteCompetition, deleteSeason, renameCompetition } from '../db/repo'
import { availableKinds, competitionKind, sameName } from '../db/competitions'
import { useCompetitions, useDefaultCompetitions, useKindName, useSeasons } from '../hooks'
import type { Competition, CompetitionKind, Season } from '../db/types'

export function SeasonsPage() {
  const { t } = useI18n()
  const seasons = useSeasons()
  const defaultComps = useDefaultCompetitions()
  const [name, setName] = useState('')

  if (!seasons) return null
  return (
    <>
      <h1>{t('seasons.title')}</h1>
      <div className="card">
        <div className="form-row">
          <label className="grow">{t('seasons.new')}<input value={name} onChange={e => setName(e.target.value)} placeholder={t('seasons.namePlaceholder')} /></label>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={async () => { await addSeason(name, defaultComps); setName('') }}>
            {t('common.add')}
          </button>
        </div>
      </div>
      {seasons.length === 0 && <p className="empty">{t('seasons.empty')}</p>}
      {seasons.map(s => <SeasonCard key={s.id} season={s} />)}
    </>
  )
}

/** Message for an error thrown by the competition functions in repo */
function competitionError(e: unknown, t: ReturnType<typeof useI18n>['t']): string {
  const code = e instanceof Error ? e.message : ''
  if (code === 'duplicate-name') return t('seasons.duplicateName')
  if (code === 'kind-taken') return t('seasons.kindTaken')
  return String(e)
}

function SeasonCard({ season }: { season: Season }) {
  const { t } = useI18n()
  const kindName = useKindName()
  const competitions = useCompetitions()?.filter(c => c.seasonId === season.id)
  const kinds = availableKinds(competitions ?? [])
  const [kindSel, setKindSel] = useState<CompetitionKind | null>(null)
  const kind = kindSel && kinds.includes(kindSel) ? kindSel : kinds[0]
  const [error, setError] = useState('')

  const guarded = async (fn: () => Promise<void>) => {
    if (!confirm(t('common.areYouSure'))) return
    try {
      await fn()
    } catch {
      alert(t('common.cannotDeleteHasGames'))
    }
  }

  const add = async () => {
    setError('')
    try {
      await addCompetition(season.id!, { kind, name: kindName(kind) })
    } catch (e) {
      setError(competitionError(e, t))
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
          <CompetitionRow key={c.id} competition={c} onDelete={() => guarded(() => deleteCompetition(c.id!))} />
        ))}
      </ul>
      {kinds.length > 0 ? (
        <div className="form-row" style={{ marginTop: 8 }}>
          <label className="grow">
            {t('seasons.newCompetition')}
            <select value={kind} onChange={e => setKindSel(e.target.value as CompetitionKind)}>
              {kinds.map(k => <option key={k} value={k}>{kindName(k)}</option>)}
            </select>
          </label>
          <button className="btn" onClick={add}>{t('common.add')}</button>
        </div>
      ) : (
        <p className="hint">{t('seasons.allCompetitions')}</p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

function CompetitionRow({ competition, onDelete }: { competition: Competition; onDelete: () => void }) {
  const { t } = useI18n()
  const kindName = useKindName()
  const kind = competitionKind(competition)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState('')

  const cancel = () => {
    setDraft(null)
    setError('')
  }
  const save = async () => {
    if (!draft?.trim()) return
    try {
      await renameCompetition(competition.id!, draft)
      cancel()
    } catch (e) {
      setError(competitionError(e, t))
    }
  }

  if (draft != null) {
    return (
      <li>
        <div className="list-row">
          <input
            className="grow"
            value={draft}
            onChange={e => { setDraft(e.target.value); setError('') }}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
            autoFocus
          />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={!draft.trim()}>{t('common.save')}</button>
          <button className="btn btn-ghost btn-sm" onClick={cancel}>{t('common.cancel')}</button>
        </div>
        {error && <p className="error">{error}</p>}
      </li>
    )
  }
  return (
    <li className="list-row">
      <span className="grow">
        {competition.name}
        {/* Once renamed, the name may no longer say which kind it is */}
        {!sameName(competition.name, kindName(kind)) && <> <span className="badge">{kindName(kind)}</span></>}
      </span>
      <button className="btn btn-ghost btn-sm" onClick={() => setDraft(competition.name)} aria-label={t('common.edit')}>✎</button>
      <button className="btn btn-ghost btn-sm" onClick={onDelete} aria-label={t('common.delete')}>🗑</button>
    </li>
  )
}
