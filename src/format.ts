import type { Lang } from './i18n'

export function fmtPct(p: number | null): string {
  return p == null ? '–' : (p * 100).toFixed(1)
}

export function fmtNum(n: number, gp?: number): string {
  if (gp == null) return String(n)
  if (gp === 0) return '–'
  return (n / gp).toFixed(1)
}

/** Minutes played as m:ss */
export function fmtMinutes(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}

export function fmtDate(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtDateTime(epochMs: number, lang: Lang): string {
  return new Date(epochMs).toLocaleString(lang === 'el' ? 'el-GR' : 'en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
