import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, type TKey } from './en'
import { el } from './el'

export type Lang = 'el' | 'en'
export type { TKey }

const dicts: Record<Lang, Record<TKey, string>> = { el, en }
const STORAGE_KEY = 'lang'

export type TFunction = (key: TKey, params?: Record<string, string | number>) => string

interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: TFunction
}

const I18nContext = createContext<I18n | null>(null)

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'el' || saved === 'en') return saved
  } catch {
    // storage unavailable
  }
  return 'el'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // storage unavailable
    }
  }, [])

  const t = useCallback<TFunction>((key, params) => {
    let s = dicts[lang][key] ?? key
    if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
    return s
  }, [lang])

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n outside I18nProvider')
  return ctx
}
