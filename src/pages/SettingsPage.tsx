import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { clearAllData, exportBackup, parseBackup, restoreBackup, setSetting } from '../db/repo'
import { requestPersistentStorage } from '../db/db'
import { DEFAULT_REMINDER_DAYS, SETTING_LAST_BACKUP, SETTING_REMINDER_DAYS, useSetting } from '../hooks'
import { fmtDateTime, todayISO } from '../format'

async function backupFile(): Promise<File> {
  const backup = await exportBackup()
  return new File([JSON.stringify(backup)], `statistika-backup-${todayISO()}.json`, { type: 'application/json' })
}

export function SettingsPage() {
  const { t, lang, setLang } = useI18n()
  const last = useSetting<number>(SETTING_LAST_BACKUP)
  const reminderDays = useSetting<number>(SETTING_REMINDER_DAYS) ?? DEFAULT_REMINDER_DAYS
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [msg, setMsg] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(false))
  }, [])

  const canShare = typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] })

  const download = async () => {
    const file = await backupFile()
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    await setSetting(SETTING_LAST_BACKUP, Date.now())
  }

  const share = async () => {
    const file = await backupFile()
    try {
      await navigator.share({ files: [file], title: file.name })
      await setSetting(SETTING_LAST_BACKUP, Date.now())
    } catch {
      // share sheet dismissed
    }
  }

  const restore = async (file: File) => {
    setMsg('')
    try {
      const backup = parseBackup(await file.text())
      if (!confirm(t('settings.confirmRestore', { date: fmtDateTime(Date.parse(backup.exportedAt), lang) }))) return
      await restoreBackup(backup)
      await setSetting(SETTING_LAST_BACKUP, Date.now())
      setMsg(t('settings.restored'))
    } catch {
      setMsg(t('settings.invalidBackup'))
    }
  }

  const erase = async () => {
    if (!confirm(t('settings.confirmErase'))) return
    if (!confirm(t('common.areYouSure'))) return
    await clearAllData()
    setMsg(t('settings.erased'))
  }

  return (
    <>
      <h1>{t('settings.title')}</h1>

      <div className="card">
        <h2>{t('settings.language')}</h2>
        <span className="segmented">
          <button className={lang === 'el' ? 'on' : ''} onClick={() => setLang('el')}>Ελληνικά</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
        </span>
      </div>

      <div className="card">
        <h2>{t('settings.backup')}</h2>
        <p className="hint">{t('settings.backupExplain')}</p>
        <p><b>{t('settings.lastBackup', { date: last ? fmtDateTime(last, lang) : t('settings.never') })}</b></p>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={download}>⬇ {t('settings.export')}</button>
          {canShare && <button className="btn" onClick={share}>↗ {t('settings.share')}</button>}
          <button className="btn" onClick={() => fileInput.current?.click()}>⬆ {t('settings.import')}</button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={e => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) restore(f)
            }}
          />
        </div>
        <div className="form-row" style={{ marginTop: 12 }}>
          <label>
            {t('settings.reminderDays')}
            <input
              type="number"
              min={1}
              max={90}
              value={reminderDays}
              onChange={e => setSetting(SETTING_REMINDER_DAYS, Math.max(1, Number(e.target.value) || DEFAULT_REMINDER_DAYS))}
            />
          </label>
        </div>
        {msg && <p><b>{msg}</b></p>}
      </div>

      <div className="card">
        <h2>{t('settings.storage')}</h2>
        {persisted === true && <p>✅ {t('settings.persisted')}</p>}
        {persisted === false && (
          <>
            <p>⚠️ {t('settings.notPersisted')}</p>
            <button className="btn" onClick={async () => setPersisted(await requestPersistentStorage())}>{t('common.confirm')}</button>
          </>
        )}
      </div>

      <div className="card">
        <h2>{t('settings.danger')}</h2>
        <button className="btn btn-danger" onClick={erase}>{t('settings.eraseAll')}</button>
      </div>
    </>
  )
}
