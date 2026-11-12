# Lane report: dispatcher fixes after the independent review (2026-11-12)

Goal: fix the six mod-side findings of the independent reviewer (UX-PRINCIPLES rules 7, 8, 11-16) in `mods/cockpit`,
each proven on the live data of this MSI's local Cockpit (`http://127.0.0.1:24365`). Page-side halves of the same
findings belong to the page's lane (claude-control `herd/cockpit`); they are listed under Remaining.

## What changed (mods/cockpit only, manifest 0.8.1)
1. **Quota, one story** (blocker): the overview's quota row (old 19.0 % reading, ISO exhaust) is replaced by ONE row
   built from `data.quota` (quota.json, the Quota module's reading): used %, one exhaust time, reset, « read HH:MM ».
   Register problems whose category matches `hub.quota.category_re` (I13, `quota/claude`) fold into it (« covers I13 »),
   and the quota alert is not counted again. With the quota mode in `hub.quota.calm_modes` (Julian set « unlimited »
   until 19 Nov) the row is yellow and says « unlimited mode until Thu 19 Nov 13:00 »; normal or expired: red.
2. **The page's numbers, not recomputed**: fleet line = `fleet_view.sentence` with its time; dots = the page's tiles in
   its order and colour; Problems now = the page's `problemsNow` rows (red tiles + overview errors, every severity),
   `errors_max` then « show all N »; alerts = the page's `alertsFor` rows. Running jobs come from the machine's tile
   alone (one source with the tile): the lost job #265 the overview still lists is not shown as running.
3. **Folded rows**: `foldRelated` joins Needs-you items by `related` ids and `links` (« fleet-todo:x »); the row is the
   answerable question with its buttons and « covers I2, I4 and 1 to-do ». Problems now and the alerts count leave out
   what Needs you now covers and say « N more are under Needs you now » / « N more are listed above ».
4. **One clock**: `hub.time` (zone local|utc, hour12 false): « 19:22 » today, « Fri 13 Nov 16:02 » another day, on
   every line (built, fleet time, ETA, answered, quota). Hub-written dates inside texts are formatted by `localize`
   (ISO stamps, « 2026-11-12 18:00Z », bare dates, « 13 Nov 06:00 UTC », « 16:55 UTC »).
5. **Plain labels**: title first; a meta line in plain words with the id small at its end (`state_words`,
   `owner_words`, « priority 1 »); to-do number prefixes and `[tag]` prefixes dropped from titles.
6. **The page's shape and words**: headings from `data.page_labels` (Needs you now, Problems now), modules from
   `data.modules` (11, Dispatch plan and My messages included), This laptop from its tile (power « on », mode, the
   hotter sensor « CPU 59 °C » plus « max 95 °C in the last hour », the tile's red/yellow reasons). To-dos: `todo.max`
   (3) rows of one line, Run / Mark done on the first only, then « show all 12 ».
- `cockpit.config.json` `hub`: `todo.max`, `time`, `quota`, 11-module order; `error_severities` removed (the page's
  list is shown whole). README dispatcher section rewritten.

## How verified (MSI, 12 Nov, clock times UTC)
- `node --test --test-concurrency=1 mods/cockpit/tests/*.test.mjs`: exit 0. `tests/hub.test.mjs` 15 cases (6 new, one
  per finding, on a fixture shaped like today's data.json: `DATA2` in `scripts/fixtures/hub.mjs`).
- `claude plugin test mods/cockpit` (2.1.322): 34 pass, 0 fail. `claude plugin validate mods/cockpit`: passed.
  `node tools/validate_mods.mjs`: exit 0.
- Live (18:36Z): `node mods/cockpit/scripts/preview.mjs --hub-live --cols 50` exit 0; 18:37Z
  `MSYS_NO_PATHCONV=1 CLAUDE_CODE_PLUGIN_DIRS=<worktree>/mods/cockpit claude -p "/fleet"` exit 0, answered by
  `cockpit:`: quota row « 23 % used of the 7-day window, empties Fri 13 Nov 20:50 … read 19:29 · unlimited mode until
  Thu 19 Nov 13:00 · covers I13 »; « Fleet coding is working: 1 of 4 machines busy, utilisation 25 % (at 19:36) »;
  I90 row « covers I2, I4 and 1 to-do »; « Alerts: 14 open, 0 urgent (20 more are listed above) » (14 + 20 = the
  page's 34); no ISO stamp, no « UTC », no « not published ».

## Problems hit
- Git Bash rewrote `claude -p "/fleet"` into `C:/Program Files/Git/fleet`: the model answered instead of the mod.
  `MSYS_NO_PATHCONV=1` fixes it; earlier proofs on this MSI should be read with that in mind.

## Remaining
- Page side (claude-control `herd/cockpit`, not this lane's files; one patch each): the overview's quota row and I13
  still say 19.0 % / 07:31; `overview.running` still lists job #265 (queue state lost); the page's Needs you list does
  not fold related items yet, so its counts (items) differ from the mod's (rows); 12-hour times and the Lanes runner line.
- msiold and mbp copies of the mod do not follow main (register I145): re-copied by queue job at deploy.
- The 50-column pane is still about 100 lines when five long questions wait: their titles and option buttons are long.
