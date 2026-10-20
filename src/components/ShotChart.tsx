import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { Court } from './Court'
import { ZoneLayer } from './ZoneLayer'
import { pct, zoneSplits, type Shot } from '../stats/compute'
import { courtZoneSplits, zoneShotType } from '../stats/zones'
import { fmtPct } from '../format'
import type { Zone } from '../stats/rules'

const ZONES: Zone[] = ['paint', 'mid', 'corner3', 'above3']
const ZONE_TYPE: Record<Zone, 'FG2' | 'FG3'> = { paint: 'FG2', mid: 'FG2', corner3: 'FG3', above3: 'FG3' }
/** Steps of the hot/cold scale, coldest first */
const HEAT_STEPS = ['n3', 'n2', 'n1', '0', 'p1', 'p2', 'p3']

type View = 'shots' | 'zones'
type Filter = 'all' | 'FG2' | 'FG3'
const FILTERS: Filter[] = ['all', 'FG2', 'FG3']

/** Shot chart with a zone table; `controls` adds a zone heatmap and a 2PT/3PT filter. */
export function ShotChart({ shots, controls = false }: { shots: Shot[]; controls?: boolean }) {
  const { t } = useI18n()
  const [view, setView] = useState<View>('shots')
  const [filter, setFilter] = useState<Filter>('all')

  const shown = useMemo(() => (filter === 'all' ? shots : shots.filter(s => s.type === filter)), [shots, filter])
  const courtZones = useMemo(() => courtZoneSplits(shown), [shown])
  const zones = zoneSplits(shown)
  const zoneList = ZONES.filter(z => filter === 'all' || ZONE_TYPE[z] === filter)
  const total = zoneList.reduce((sum, z) => ({ m: sum.m + zones[z].m, a: sum.a + zones[z].a }), { m: 0, a: 0 })
  const filterLabel = (f: Filter) => (f === 'all' ? t('common.all') : t(f === 'FG2' ? 'stat.2PT' : 'stat.3PT'))

  return (
    <div className="shot-chart-wrap">
      {controls && (
        <div className="shot-controls">
          <span className="segmented">
            <button className={view === 'shots' ? 'on' : ''} onClick={() => setView('shots')}>{t('shots.viewShots')}</button>
            <button className={view === 'zones' ? 'on' : ''} onClick={() => setView('zones')}>{t('shots.viewHeat')}</button>
          </span>
          <span className="segmented">
            {FILTERS.map(f => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{filterLabel(f)}</button>
            ))}
          </span>
        </div>
      )}
      <div className="shot-chart">
        <div>
          {view === 'zones'
            ? <Court layer={<ZoneLayer splits={courtZones} shown={z => filter === 'all' || zoneShotType(z) === filter} />} />
            : <Court shots={shown} />}
          {view === 'zones' && (
            <div className="heat-legend">
              <span className="heat-scale">
                <span>{t('shots.cold')}</span>
                {HEAT_STEPS.map(s => <i key={s} style={{ background: `var(--zone-${s})` }} />)}
                <span>{t('shots.hot')}</span>
              </span>
              <span className="muted">{t('shots.heatNote')}</span>
            </div>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="muted">{t('game.noShots')}</p>
        ) : (
          <table className="simple-table zone-table">
            <tbody>
              {zoneList.map(z => (
                <tr key={z}>
                  <td>{t(`zone.${z}`)}</td>
                  <td className="num">{zones[z].m}/{zones[z].a}</td>
                  <td className="num">{fmtPct(pct(zones[z].m, zones[z].a))}%</td>
                </tr>
              ))}
              {controls && (
                <tr className="total-row">
                  <td>{t('common.totals')}</td>
                  <td className="num">{total.m}/{total.a}</td>
                  <td className="num">{fmtPct(pct(total.m, total.a))}%</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
