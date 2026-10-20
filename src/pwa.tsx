import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

interface AppUpdate {
  /** A newer version has been downloaded and waits for a reload */
  ready: boolean
  /** Ask the server for a newer version and download it; resolves whether one is ready */
  check: () => Promise<boolean>
  /** Switch to the waiting version, reloading the page */
  apply: () => void
}

const AppUpdateContext = createContext<AppUpdate | null>(null)

/** New app versions wait for the user, so an update never reloads the page mid-game. */
export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const { needRefresh: [ready, setReady] } = useRegisterSW({
    onRegisteredSW: (_url, r) => { registration.current = r },
  })

  const check = useCallback(async () => {
    const r = registration.current
    if (!r) throw new Error('No service worker')
    await r.update()
    const sw = r.installing ?? r.waiting
    if (!sw) return false
    if (sw.state === 'installing') {
      await new Promise<void>(resolve => sw.addEventListener('statechange', () => resolve(), { once: true }))
    }
    if (r.waiting !== sw) throw new Error('Update failed to install')
    setReady(true)
    return true
  }, [setReady])

  const apply = useCallback(() => {
    const waiting = registration.current?.waiting
    if (!waiting) return
    // Wait for activation rather than controllerchange, which a page opened before the first install never gets
    waiting.addEventListener('statechange', () => { if (waiting.state === 'activated') window.location.reload() })
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }, [])

  const value = useMemo(() => ({ ready, check, apply }), [ready, check, apply])
  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>
}

export function useAppUpdate(): AppUpdate {
  const ctx = useContext(AppUpdateContext)
  if (!ctx) throw new Error('useAppUpdate needs AppUpdateProvider')
  return ctx
}
