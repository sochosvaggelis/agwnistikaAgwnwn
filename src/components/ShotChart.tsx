import { useI18n } from '../i18n'
import { Court } from './Court'
import { pct, zoneSplits, type Shot } from '../stats/compute'
import { fmtPct } from '../format'
import type { Zone } from '../stats/rules'

const ZONES: Zone[] = ['paint', 'mid', 'corner3', 'above3']

export function ShotChart({ shots }: { shots: Shot[] }) {
  const { t } = useI18n()
  const zones = zoneSplits(shots)
  return (
    <div className="shot-chart-wrap">
      <Court shots={shots} />
      {shots.length === 0 ? (
        <p className="muted">{t('game.noShots')}</p>
      ) : (
        <table className="simple-table zone-table">
          <tbody>
            {ZONES.map(z => (
              <tr key={z}>
                <td>{t(`zone.${z}`)}</td>
                <td className="num">{zones[z].m}/{zones[z].a}</td>
                <td className="num">{fmtPct(pct(zones[z].m, zones[z].a))}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
