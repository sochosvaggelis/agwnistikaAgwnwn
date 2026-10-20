# Statistika Agwnwn — Spec

Offline basketball statistics app for an Android tablet. One operator records full stats for both teams live during a game.

## Decisions (from Q&A, 2026-10-20)

| Topic | Decision |
|---|---|
| Device | Android tablet, landscape |
| Stack | PWA: Vite + React + TypeScript, IndexedDB via Dexie, vite-plugin-pwa |
| Hosting | GitHub Pages (HashRouter, base path); fully offline after first install |
| Entry | Live, single operator, both teams fully |
| Stat depth | Full box score + play-by-play + shot chart |
| Game clock | Optional per game (start/stop; events get game time when on) |
| Substitutions | Not tracked → no minutes played, no +/- |
| Rules | FIBA: 4×10, OT 5 min, foul-out at 5, team-foul penalty from the 5th foul in a quarter |
| Shot entry | Court spot → player → action; the half court is always shown in the live screen's center column (changed 2026-10-21) |
| Chaining | Skippable follow-up prompts (see Input flow) |
| Opponents | Saved reusable teams, or create one at game time and keep it |
| Fouls | Type: personal / shooting / offensive / technical / unsportsmanlike + fouled player |
| Extras | Coach/bench technicals, FIBA PIR (exact, via prompts) |
| Not tracked | Timeouts, team rebounds/turnovers, possession arrow |
| Organization | Season → Competition → Game |
| Role | Coach/staff of one team ("my team"), opponents secondary |
| Views | Game box score + play-by-play, player profile, team season stats, head-to-head vs opponent |
| Export | PDF box score, via a print stylesheet and Android's "Save as PDF" (handles Greek text with no embedded font) |
| Backup | Export/import full DB as .json, plus a reminder when the last backup is older than N days |
| Language | Greek + English, switchable |

## Input flow

1. Tap the spot on the half court (always visible above the center panel), then the player: home roster on the left, away roster on the right. Tapping the court again moves the spot.
   - Shortcut: tap a player first to skip the spot (e.g. free throws).
2. Tap an action: `2PT✓ 2PT✗ 3PT✓ 3PT✗ FT✓ FT✗ OREB DREB AST STL BLK TOV FOUL`
   - With a spot, the 2PT or 3PT buttons for that zone are outlined.
   - The spot is stored on the player's event (shot, rebound, steal, turnover, foul…), never on free throws.
3. Field goals without a spot: an optional court tap for the shot chart (Skip button).
   - A standalone block with a spot takes 2PT/3PT from the spot instead of asking.
4. Chained prompts, each with a "none/skip" option:
   - Made FG → *Assist by?* (teammates)
   - Missed FG → *Blocked by?* (opponents) → *Rebound by?* (both rosters; OREB/DREB inferred)
   - FOUL → *Type?* → *Fouled who?* (opponents) → shooting foul → *How many FTs?* → each FT made/missed → last FT missed → *Rebound by?*
   - STL → *Stolen from?* (creates that opponent's TOV)
   - Offensive foul also counts as a TOV
5. Team-level button: coach/bench technical.
6. Undo the last event; edit or delete any event from the play-by-play log.

## FIBA foul logic

- Player disqualified at 5 fouls, or 2 T, or 2 U, or 1 T + 1 U.
- Coach disqualified at 2 C, or 3 total (B + C).
- Team fouls reset each quarter; overtime continues the Q4 count. Bonus indicator from the 5th team foul.

## PIR

`(PTS + REB + AST + STL + BLK + FoulsDrawn) − (FGmissed + FTmissed + TOV + ShotsBlocked + FoulsCommitted)`

## Data model (event-sourced; all stats are derived from events)

- `seasons` {id, name}
- `competitions` {id, seasonId, name}
- `teams` {id, name, isMine}
- `players` {id, teamId, name, number, position?, active}
- `games` {id, competitionId, date, homeTeamId, awayTeamId, clockEnabled, status: draft|live|finished, roster: {home: playerId[], away: playerId[]}}
- `events` {id, gameId, seq, period, clockMs?, teamId, playerId?, type, made?, points?, x?, y?, foulType?, parentEventId?}
- `meta` {lastBackupAt, language, ...}

Call `navigator.storage.persist()` on startup to reduce the chance of the browser evicting the data.
