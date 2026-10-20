import { useI18n } from '../i18n'

export function ModeToggle({ mode, setMode }: { mode: 'avg' | 'total'; setMode: (m: 'avg' | 'total') => void }) {
  const { t } = useI18n()
  return (
    <span className="segmented">
      <button className={mode === 'avg' ? 'on' : ''} onClick={() => setMode('avg')}>{t('common.averages')}</button>
      <button className={mode === 'total' ? 'on' : ''} onClick={() => setMode('total')}>{t('common.totals')}</button>
    </span>
  )
}
