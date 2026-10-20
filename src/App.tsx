import { HashRouter, NavLink, Outlet, Route, Routes } from 'react-router'
import { I18nProvider, useI18n } from './i18n'
import { AppUpdateProvider, useAppUpdate } from './pwa'
import { LiveGamePage } from './live/LiveGamePage'
import { GamesPage } from './pages/GamesPage'
import { NewGamePage } from './pages/NewGamePage'
import { GamePage } from './pages/GamePage'
import { TeamsPage } from './pages/TeamsPage'
import { TeamPage } from './pages/TeamPage'
import { SeasonsPage } from './pages/SeasonsPage'
import { StatsPage } from './pages/StatsPage'
import { PlayerPage } from './pages/PlayerPage'
import { HeadToHeadPage } from './pages/HeadToHeadPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <I18nProvider>
      <AppUpdateProvider>
        <HashRouter>
          <Routes>
            <Route path="/games/:id/live" element={<LiveGamePage />} />
            <Route element={<Layout />}>
              <Route index element={<GamesPage />} />
              <Route path="games/new" element={<NewGamePage />} />
              <Route path="games/:id" element={<GamePage />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="players/:id" element={<PlayerPage />} />
              <Route path="h2h" element={<HeadToHeadPage />} />
              <Route path="h2h/:teamId" element={<HeadToHeadPage />} />
              <Route path="teams" element={<TeamsPage />} />
              <Route path="teams/:id" element={<TeamPage />} />
              <Route path="seasons" element={<SeasonsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
          <UpdatePrompt />
        </HashRouter>
      </AppUpdateProvider>
    </I18nProvider>
  )
}

function Layout() {
  const { t } = useI18n()
  return (
    <>
      <nav className="app-nav">
        <span className="brand"><img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />{t('app.title')}</span>
        <NavLink to="/" end>{t('nav.games')}</NavLink>
        <NavLink to="/stats">{t('nav.stats')}</NavLink>
        <NavLink to="/h2h">{t('nav.h2h')}</NavLink>
        <NavLink to="/teams">{t('nav.teams')}</NavLink>
        <NavLink to="/seasons">{t('nav.seasons')}</NavLink>
        <NavLink to="/settings">{t('nav.settings')}</NavLink>
      </nav>
      <main className="page">
        <Outlet />
      </main>
    </>
  )
}

function UpdatePrompt() {
  const { t } = useI18n()
  const { ready, apply } = useAppUpdate()
  if (!ready) return null
  return (
    <div className="toast">
      {t('pwa.updateReady')}
      <button className="btn btn-sm btn-primary" onClick={apply}>{t('pwa.reload')}</button>
    </div>
  )
}
