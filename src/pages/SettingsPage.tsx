import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { clearAllData, exportBackup, parseBackup, restoreBackup, setSetting } from '../db/repo'
import { requestPersistentStorage } from '../db/db'
import { createProfile, deleteProfile, listProfiles, switchProfile, type Profile } from '../db/profiles'
import type { Team } from '../db/types'
import { TeamName } from '../components/TeamSwatch'
import { DEFAULT_REMINDER_DAYS, SETTING_LAST_BACKUP, SETTING_REMINDER_DAYS, useMyTeam, useSetting } from '../hooks'
import { fmtDateTime, todayISO } from '../format'
import { useAppUpdate } from '../pwa'

/** The team's name in the file name tells apart the backups of each team of mine */
async function backupFile(teamName?: string): Promise<File> {
  const backup = await exportBackup()
  const team = teamName ? `-${teamName.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-')}` : ''
  return new File([JSON.stringify(backup)], `statistika-backup${team}-${todayISO()}.json`, { type: 'application/json' })
}

export function SettingsPage() {
  const { t, lang, setLang } = useI18n()
  const myTeam = useMyTeam()
  const last = useSetting<number>(SETTING_LAST_BACKUP)
  const reminderDays = useSetting<number>(SETTING_REMINDER_DAYS) ?? DEFAULT_REMINDER_DAYS
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [msg, setMsg] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const update = useAppUpdate()
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'latest' | 'failed'>('idle')

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(false))
  }, [])

  const canShare = typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] })

  const download = async () => {
    const file = await backupFile(myTeam?.name)
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
    const file = await backupFile(myTeam?.name)
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
      const backupTeam = (backup.data.teams as Team[]).find(tm => tm.isMine)?.name
      if (myTeam && backupTeam && backupTeam !== myTeam.name
        && !confirm(t('settings.otherTeamBackup', { backup: backupTeam, current: myTeam.name }))) return
      if (!confirm(t('settings.confirmRestore', { date: fmtDateTime(Date.parse(backup.exportedAt), lang) }))) return
      await restoreBackup(backup)
      await setSetting(SETTING_LAST_BACKUP, Date.now())
      setMsg(t('settings.restored'))
    } catch {
      setMsg(t('settings.invalidBackup'))
    }
  }

  const checkForUpdate = async () => {
    if (update.ready) return update.apply()
    setUpdateState('checking')
    try {
      if (await update.check()) update.apply()
      else setUpdateState('latest')
    } catch {
      setUpdateState('failed')
    }
  }

  const erase = async () => {
    if (!confirm(t('settings.confirmErase', { team: myTeam?.name ?? '—' }))) return
    if (!confirm(t('common.areYouSure'))) return
    await clearAllData()
    setMsg(t('settings.erased'))
  }

  return (
    <>
      <h1>{t('settings.title')}</h1>

      <MyTeams />

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
        <h2>{t('settings.app')}</h2>
        <p className="hint">{t('settings.version', { date: fmtDateTime(__BUILD_TIME__, lang), commit: __COMMIT__ })}</p>
        <button className="btn btn-primary" onClick={checkForUpdate} disabled={updateState === 'checking'}>
          ⟳ {t(updateState === 'checking' ? 'settings.checking' : update.ready ? 'settings.installUpdate' : 'settings.checkUpdate')}
        </button>
        {updateState === 'latest' && <p>✅ {t('settings.upToDate')}</p>}
        {updateState === 'failed' && <p>⚠️ {t('settings.updateFailed')}</p>}
      </div>

      <div className="card">
        <h2>{t('settings.danger')}</h2>
        <button className="btn btn-danger" onClick={erase}>{t('settings.eraseAll')}</button>
      </div>

    </>
  )
}

function MyTeams() {
  const { t, lang } = useI18n()
  const [profiles, setProfiles] = useState<Profile[]>()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = () => listProfiles().then(setProfiles).catch(() => setProfiles([]))
  useEffect(() => { reload() }, [])

  const add = async () => {
    if (!name.trim()) return
    setBusy(true)
    await createProfile(name)
  }

  const remove = async (p: Profile) => {
    const team = p.team?.name ?? t('profiles.noTeam')
    if (!confirm(t('profiles.confirmDelete', { team }))) return
    if (!confirm(t('common.areYouSure'))) return
    await deleteProfile(p.dbName)
    reload()
  }

  return (
    <div className="card" id="my-teams">
      <h2>{t('profiles.title')}</h2>
      <p className="hint">{t('profiles.explain')}</p>
      <ul className="list">
        {profiles?.map(p => (
          <li key={p.dbName} className="list-row">
            <span className="grow">
              {p.team ? <b><TeamName team={p.team} /></b> : <span className="muted">{t('profiles.noTeam')}</span>}
              <span className="hint" style={{ display: 'block' }}>
                {t('profiles.games', { n: p.games })} · {t('settings.lastBackup', { date: p.lastBackupAt ? fmtDateTime(p.lastBackupAt, lang) : t('settings.never') })}
              </span>
            </span>
            {p.active ? (
              <span className="badge">{t('profiles.current')}</span>
            ) : (
              <>
                <button className="btn btn-sm btn-primary" onClick={() => switchProfile(p.dbName)}>{t('profiles.open')}</button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(p)}>{t('common.delete')}</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="form-row" style={{ marginTop: 12 }}>
        <label className="grow">{t('common.name')}<input value={name} onChange={e => setName(e.target.value)} /></label>
        <button className="btn" disabled={!name.trim() || busy} onClick={add}>＋ {t('profiles.add')}</button>
      </div>
    </div>
  )
}

