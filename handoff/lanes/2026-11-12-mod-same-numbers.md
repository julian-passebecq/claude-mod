# Lane report: mod-same-numbers, the mod reads the page's own numbers (2026-11-12, I150)

Goal: the Cockpit page (http://127.0.0.1:24365) and the Cockpit mod show the same counts and words at the same minute.
Files: `mods/cockpit` only. Reference patch: branch `cockpit-ui-fix-mod-reference` (f8824e2, written against the older
base before #86; its ideas were re-applied on top of #86, not cherry-picked).

## What changed (manifest 0.8.2)
1. **Two paths, said in the output.** When `data.json` carries `glance` (claude-control `herd/cockpit/glance.py`) the
   Global block prints the page's own reading; without it (older hub data) the #86 rules compute the rows as before.
   The last line of `/fleet` says which: « (numbers: the page's own (data.glance of 21:22)) » or « (numbers: computed
   here (this hub data has no glance)) ».
2. **Needs you now = the page's `youList`**: items with `covered_by` are left out, the row that stands for them shows
   its own `covers` (« covers I2, I4 and 1 to-do »), the count is the page's sentence « 14 need you now (at 21:22) »,
   the meta line is the page's sub-line (application · urgency · covers · id).
3. **Quota row** = `glance.quota.text` in the one clock, under the fleet sentence as on the page, yellow in unlimited
   mode, « covers I13 ». **Problems now** = `glance.problems` minus the quota (« At 21:22. »; sub-line « problem ·
   urgent · owner lead · I1 »), then « 37 to look at when you have time » (`glance.later`). **Alerts** = the Alerts
   module's count (`glance.alerts.shown` minus acked). **Working on** = `glance.jobs` in the page's words (« ps job on
   MSI (JULP) (job 419) · started 21:22 »). **Not up to date** = `glance.freshness` late parts, the page's sentence.
   Problems now shows in every workspace on this path (the page does).
4. **Short pane**: Global shows about `global_max` (5) rows (Needs you now first, at least one Problems now row), then
   « show all N »; titles cut to `title_lines` (1) line, meta lines to one line; a question's options fold to its
   recommended answer plus « more (n) » (unfolds in place, « less » folds back; `H.more` in register.mjs); the Send
   row is one line. Live at 50 columns: 64 lines for the whole pane (103 before), Global box 31 lines.
5. **Clock**: `hub.time.zone` accepts an IANA zone; the config sets `Europe/Paris`, 24-hour (or the page's
   `glance.time.hour12`).

## How verified (MSI, 12 Nov, times UTC)
- `node --test --test-concurrency=1 --test-reporter=dot mods/cockpit/tests/<each>.test.mjs`, one file at a time: all 11
  exit 0. `tests/hub.test.mjs` 19 cases (4 new: glance path, fallback path, five rows + more, Europe/Paris), on the
  new `DATA3` fixture (DATA2 + glance + covers).
- `claude plugin test mods/cockpit` (2.1.322): 34 pass, 0 fail, exit 0. `claude plugin validate mods/cockpit`:
  « Validation passed », exit 0 (one existing note: no marketplace install line in the README). `node
  tools/validate_mods.mjs`: exit 0.
- Live, 20:23Z: `MSYS_NO_PATHCONV=1 CLAUDE_CODE_PLUGIN_DIRS=<worktree>/mods/cockpit claude -p "/fleet"` exit 0, answered by
  `cockpit:`, path glance. Same minute, the page's Overview (browser pane, workspace All): « Fleet coding is working: 1
  of 4 machines busy, utilisation 25 % (at 21:22) », the same quota sentence with « unlimited mode until Fri 13 Nov
  00:00 (read 20:29) · covers I13 », « 14 need you now (at 21:22) », the same five rows in the same order, Problems now
  I1 only, « 37 to look at when you have time », Alerts module « 24 open about machines, quota and jobs » = mod
  « Alerts: 24 open, 1 urgent ». Ghanty workspace: both « 1 needs you now (at 21:18) ».

## Problems hit
- Bash heredocs with an unmatched quote inside failed in this tool; files were written with the Write tool instead.

## Remaining
- VS Code extension (claude-control `herd/vsix`, not edited here), renames for one later patch, listed in the PR.
- The pane omits the page's organization label in the meta line (the workspace switch shows it) and strips `[tag]`
  prefixes from to-do titles; the page keeps both. One patch if wanted.
- msiold / mbp copies of the mod follow main only when re-copied by the deploy job (I145).
