# Στατιστικά Αγώνων

An offline basketball statistics app for an Android tablet. One person records full FIBA stats for both teams live. The app is an installable PWA, and all data stays on the tablet in IndexedDB.

See [SPEC.md](SPEC.md) for what the app does and why.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # stats engine + live-entry flow tests
npm run build      # type-check + production build in dist/
npm run preview    # serve dist/ at /agwnistikaAgwnwn/ (service worker active)
```

## Deploy to GitHub Pages

1. Create a GitHub repository and push this project to its `main` branch.
2. In the repository, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml). The workflow tests, builds and publishes the app to https://sochosvaggelis.github.io/agwnistikaAgwnwn/. The base path comes from the repository name.

## Install on the tablet

1. On the tablet, open the Pages URL in Chrome.
2. Open the menu (⋮) and tap **Add to Home screen** (it may say **Install app**).
3. Open the app once while still online. After that it works fully offline.
4. When a new version is deployed, the app shows an **Update** button. It never reloads on its own, so an update can't interrupt a game.

## Data safety

- All data lives only in the tablet's browser storage. It is lost if Chrome's site data is cleared or the app is uninstalled.
- To back up, go to **Settings → Download backup** (or **Share backup…** to send it to Drive or email). The home screen reminds you when the last backup is older than the number of days you set.
- To restore, go to **Settings → Restore from backup…**. This replaces all data on the tablet.

## PDF box score

On a game's page, tap **PDF / Print**. In Android's print dialog, choose **Save as PDF**. The page has a print layout of A4 landscape with box scores, line score and shot charts.
