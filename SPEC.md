# Statistika Agwnwn — Spec

Offline basketball statistics app for an Android tablet. One operator records full stats for both teams live during a game.

## Decisions (from Q&A, 2026-10-20)

| Topic | Decision |
|---|---|
| Device | Android tablet, landscape only (changed 2026-10-22; Android 16 ignores the manifest lock on large screens, so the tablet's rotation lock holds it) |
| Stack | PWA: Vite + React + TypeScript, IndexedDB via Dexie, vite-plugin-pwa |
| Hosting | GitHub Pages (HashRouter, base path); fully offline after first install |
| Entry | Live, single operator, both teams fully |
| Stat depth | Full box score + play-by-play + shot chart |
| Game clock | Optional per game (start/stop; events get game time when on) |
| Substitutions | Tracked per team (changed 2026-10-22): the live screen shows only the five on the court. A new game starts by picking each team's starting five; a Substitution button swaps players and stores a time, the game clock's by default and typed in (optional) without it. Minutes played (MIN) come from these times; a player's minutes are unknown ("–") when a stint has no time, and a team that never picked a five shows its whole roster with no minutes. No +/- |
| Rules | FIBA: 4×10, OT 5 min, foul-out at 5, team-foul penalty from the 5th foul in a quarter |
| Shot entry | Court spot → player → action; each team has its own half court, always shown above its roster on the live screen with the team's shots so far (made/missed, like the game report); a Heatmap button next to each court switches that court to the zone heatmap; while a player is chosen for a play, their court shows only that player's shots, with their number and FG made/attempts beside it (changed 2026-10-22) |
| Chaining | Skippable follow-up prompts (see Input flow) |
| Opponents | Saved reusable teams, or create one at game time and keep it |
| Fouls | Type: personal / shooting / offensive / technical / unsportsmanlike + fouled player |
| Extras | Coach/bench technicals, FIBA PIR (exact, via prompts) |
| Not tracked | Timeouts, team rebounds/turnovers, possession arrow |
| Organization | Season → Competition → Game; a season has at most one competition of each kind: League, Cup, Friendlies, Other (new seasons start with the first three; names are editable and unique per season) |
| Role | Coach/staff of one team ("my team"), opponents secondary |
| Views | Game box score + play-by-play, player profile, team season stats (shot chart with a 2PT/3PT filter and a zone heatmap: 11 court zones, each with made/attempts and FG%, colored hot/cold against 1 point per shot), head-to-head vs opponent |
| Export | PDF box score, via a print stylesheet and Android's "Save as PDF" (handles Greek text with no embedded font) |
| Backup | Export/import full DB as .json, plus a reminder when the last backup is older than N days |
| Language | Greek + English, switchable |

## Input flow

1. Tap the spot on a team's half court, then one of that team's players: home court and roster on the left, away on the right. Tapping the same court again moves the spot; tapping the other team's court starts the play over for that team.
   - A spot is for the player whose court it was tapped on: switching to a player of the other team drops it, and a field goal without a spot asks for one on the shooter's court only.
   - The action buttons are always shown until a play is under way, so the action can also come first: action, spot and player in any order (changed 2026-10-22). The chosen action is filled in; tapping another one replaces it.
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
   - Substitution (in place of a sixth player): tap who goes out and who comes in, with the time left in the period. Stored as SUB_OUT/SUB_IN events in one undo group; the starting five are SUB_IN events. The button turns red while a fouled-out player is still on the court.
6. Undo the last event; edit or delete any event from the play-by-play log.

## FIBA foul logic

- Player disqualified at 5 fouls, or 2 T, or 2 U, or 1 T + 1 U.
- Coach disqualified at 2 C, or 3 total (B + C).
- Team fouls reset each quarter; overtime continues the Q4 count. Bonus indicator from the 5th team foul.

## PIR

`(PTS + REB + AST + STL + BLK + FoulsDrawn) − (FGmissed + FTmissed + TOV + ShotsBlocked + FoulsCommitted)`

## Data model (event-sourced; all stats are derived from events)

- `seasons` {id, name}
- `competitions` {id, seasonId, kind?: league|cup|friendly|other, name} (kind is missing on older records and inferred from the name)
- `teams` {id, name, isMine}
- `players` {id, teamId, name, number, position?, active}
- `games` {id, competitionId, date, homeTeamId, awayTeamId, clockEnabled, status: draft|live|finished, roster: {home: playerId[], away: playerId[]}}
- `events` {id, gameId, seq, period, clockMs?, teamId, playerId?, type, made?, points?, x?, y?, foulType?, parentEventId?}
- `meta` {lastBackupAt, language, ...}

Call `navigator.storage.persist()` on startup to reduce the chance of the browser evicting the data.
