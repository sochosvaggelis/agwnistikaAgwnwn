import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { useCompetitions, useSeasons } from '../hooks'
import type { Game } from '../db/types'

export interface SeasonFilterValue {
  /** undefined = latest season */
  seasonId?: number | 'all'
  competitionId: number | 'all'
}

/** Season + competition selection, defaulting to the latest season. */
export function useSeasonFilter() {
  const seasons = useSeasons()
  const competitions = useCompetitions()
  const [value, setValue] = useState<SeasonFilterValue>({ competitionId: 'all' })

  const seasonId = value.seasonId ?? seasons?.[0]?.id ?? 'all'
  const compIds = useMemo(() => {
    if (!competitions) return null
    return new Set(
      competitions
        .filter(c => (seasonId === 'all' || c.seasonId === seasonId) && (value.competitionId === 'all' || c.id === value.competitionId))
        .map(c => c.id!),
    )
  }, [competitions, seasonId, value.competitionId])

  const matches = (g: Game) => compIds?.has(g.competitionId) ?? false
  /** Stable key so data hooks re-run when the filter changes */
  const key = `${seasonId}|${value.competitionId}|${compIds ? [...compIds].join(',') : ''}`

  return { seasons, competitions, seasonId, value, setValue, matches, key, ready: compIds != null }
}

export function SeasonFilter({ filter }: { filter: ReturnType<typeof useSeasonFilter> }) {
  const { t } = useI18n()
  const { seasons, competitions, seasonId, value, setValue } = filter
  const comps = (competitions ?? []).filter(c => seasonId === 'all' || c.seasonId === seasonId)

  return (
    <div className="filter-bar">
      <label>
        {t('common.season')}
        <select
          value={String(seasonId)}
          onChange={e => setValue({ seasonId: e.target.value === 'all' ? 'all' : Number(e.target.value), competitionId: 'all' })}
        >
          <option value="all">{t('common.all')}</option>
          {seasons?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label>
        {t('common.competition')}
        <select
          value={String(value.competitionId)}
          onChange={e => setValue({ ...value, seasonId, competitionId: e.target.value === 'all' ? 'all' : Number(e.target.value) })}
        >
          <option value="all">{t('common.allCompetitions')}</option>
          {comps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
    </div>
  )
}
