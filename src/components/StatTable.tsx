import { useState, type ReactNode } from 'react'
import { useI18n, type TKey } from '../i18n'
import { fga, fgm, pct, pir, reb, type StatLine } from '../stats/compute'
import { fmtMinutes, fmtNum, fmtPct } from '../format'

type Col =
  | { label: TKey; kind: 'n'; get: (l: StatLine) => number }
  | { label: TKey; kind: 'ma'; get: (l: StatLine) => [number, number] }
  | { label: TKey; kind: 'pct'; get: (l: StatLine) => [number, number] }
  // Time on court, averaged over the games where it is known
  | { label: TKey; kind: 'min' }

// Points, then each kind of shot with its percentage (free throws, twos, threes, all field goals), then the rest
const COLS: Col[] = [
  { label: 'stat.PTS', kind: 'n', get: l => l.pts },
  { label: 'stat.FT', kind: 'ma', get: l => [l.ftm, l.fta] },
  { label: 'stat.FT%', kind: 'pct', get: l => [l.ftm, l.fta] },
  { label: 'stat.2PT', kind: 'ma', get: l => [l.fg2m, l.fg2a] },
  { label: 'stat.2P%', kind: 'pct', get: l => [l.fg2m, l.fg2a] },
  { label: 'stat.3PT', kind: 'ma', get: l => [l.fg3m, l.fg3a] },
  { label: 'stat.3P%', kind: 'pct', get: l => [l.fg3m, l.fg3a] },
  { label: 'stat.FG', kind: 'ma', get: l => [fgm(l), fga(l)] },
  { label: 'stat.FG%', kind: 'pct', get: l => [fgm(l), fga(l)] },
  { label: 'stat.MIN', kind: 'min' },
  { label: 'stat.OREB', kind: 'n', get: l => l.oreb },
  { label: 'stat.DREB', kind: 'n', get: l => l.dreb },
  { label: 'stat.REB', kind: 'n', get: reb },
  { label: 'stat.AST', kind: 'n', get: l => l.ast },
  { label: 'stat.STL', kind: 'n', get: l => l.stl },
  { label: 'stat.BLK', kind: 'n', get: l => l.blk },
  { label: 'stat.BLKA', kind: 'n', get: l => l.blka },
  { label: 'stat.TOV', kind: 'n', get: l => l.tov },
  { label: 'stat.PF', kind: 'n', get: l => l.pf },
  { label: 'stat.FD', kind: 'n', get: l => l.fd },
  { label: 'stat.PIR', kind: 'n', get: pir },
]

export interface StatRow {
  key: string | number
  label: ReactNode
  line: StatLine
  /** Games played; when set and mode is 'avg', values are shown per game */
  gp?: number
  className?: string
}

interface Props {
  rows: StatRow[]
  total?: StatRow
  mode?: 'total' | 'avg'
  showGp?: boolean
  firstCol: ReactNode
  sortable?: boolean
}

function sortValue(col: Col, row: StatRow, mode: 'total' | 'avg'): number {
  const { ms, msGames } = row.line
  if (col.kind === 'min') return msGames === 0 ? -1 : mode === 'avg' ? ms / msGames : ms
  if (col.kind === 'n') {
    const v = col.get(row.line)
    return mode === 'avg' && row.gp ? v / row.gp : v
  }
  const [m, a] = col.get(row.line)
  if (col.kind === 'pct') return pct(m, a) ?? -1
  return mode === 'avg' && row.gp ? m / row.gp : m
}

function cell(col: Col, row: StatRow, mode: 'total' | 'avg'): string {
  const gp = mode === 'avg' ? row.gp : undefined
  if (col.kind === 'min') {
    const { ms, msGames } = row.line
    return msGames === 0 ? '–' : fmtMinutes(mode === 'avg' ? ms / msGames : ms)
  }
  if (col.kind === 'n') return fmtNum(col.get(row.line), gp)
  const [m, a] = col.get(row.line)
  if (col.kind === 'pct') return fmtPct(pct(m, a))
  return `${fmtNum(m, gp)}/${fmtNum(a, gp)}`
}

export function StatTable({ rows, total, mode = 'total', showGp, firstCol, sortable }: Props) {
  const { t } = useI18n()
  const [sortCol, setSortCol] = useState<number | null>(null)

  const sorted = sortCol == null ? rows : [...rows].sort((a, b) => sortValue(COLS[sortCol], b, mode) - sortValue(COLS[sortCol], a, mode))

  const renderRow = (row: StatRow, isTotal = false) => (
    <tr key={row.key} className={[row.className, isTotal ? 'total-row' : ''].filter(Boolean).join(' ')}>
      <td className="name-cell">{row.label}</td>
      {showGp && <td>{row.gp ?? ''}</td>}
      {COLS.map((c, i) => <td key={i} className={c.label === 'stat.PTS' ? 'strong' : undefined}>{cell(c, row, mode)}</td>)}
    </tr>
  )

  return (
    <div className="table-scroll">
      <table className="stat-table">
        <thead>
          <tr>
            <th className="name-cell">{firstCol}</th>
            {showGp && <th>{t('stat.GP')}</th>}
            {COLS.map((c, i) => (
              <th
                key={i}
                className={sortable ? `sortable${sortCol === i ? ' sorted' : ''}` : undefined}
                onClick={sortable ? () => setSortCol(sortCol === i ? null : i) : undefined}
              >
                {t(c.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => renderRow(r))}
          {total && renderRow(total, true)}
        </tbody>
      </table>
    </div>
  )
}
