# Lane report: Cockpit mod trimmed to one narrow dispatcher pane (2026-11-12)

Goal (Julian, 12 Nov ~16:50Z, UX-PRINCIPLES rule 7): the Cockpit mod is ONE narrow pane, a dispatcher; the Cockpit
page is the full workplace. Block 1 « This laptop », block 2 « Global », « Open in Cockpit » for anything bigger. This
corrects the « all tabs in the mod » brief of #82/#83, which shipped nine hub tabs.

## What changed (mods/cockpit only)
- `lib/hub.mjs`: one hub view (`hub-home`); the nine old tab ids and `/cockpit` words open it, so configs and habits of
  #82/#83 keep working. New model: `laptop` (to-dos here urgent first, marked done last; state, mode, CPU, RAM,
  temperature, agent processes, warnings for heat, disk under 10 %, battery, reboot; jobs with since / ETA or « past
  its ETA », lanes this machine owns) and `global` (fleet line and dots, the page's own `youList` of the workspace with
  `answerButtons` / `answerText`, critical and urgent errors, urgent to-dos elsewhere). Health (`data.health`) and modes
  (`data.modes`) are read when a hub lane publishes them; absent today, the pane says « mode not published » and shows
  the GPU sensor of the load sample. Quota, Alerts, Journal, Watch, Lanes and the answer-sheet models are gone (the page
  has them). Words: the page's `inbox.labels` first.
- `hooks/hub_view.mjs`: the dispatcher drawing; « Dispatcher » and « Conversations » buttons above every view.
- `hooks/register.mjs`: one-click answer (POST `/api/todo` « Answer I90: a » to `inbox.answer_machine`, the page's own
  send; confirmed on screen, kept in `$.store` `hub`), quick actions fill the prompt with `/dispatch ` or `/todo `
  (`$.prompt.fill`, nothing sent by itself), « Open in Cockpit » buttons open `base/#<module>` in the browser
  (rundll32 URL handler / open / xdg-open as an argv, only the configured loopback base). A `Link` was tried first: the
  engine draws a non-https Link as plain text on the desktop surface, so the page link would not be clickable there.
  `/fleet [module]` answers both blocks as text plus the module's page link.
- `cockpit.config.json` `hub`: `start: home`, `modules`, `max_rows: 5`, `errors_max`, `error_severities`, `temp`,
  `disk_warn_pct`. README section rewritten; manifest 0.8.0.
- The 4 stale « Panneau by default » tests: kept and fixed, not deleted. They failed since #78 made `panel.detail:
  normal` the shipped preset (the 5 h figure left the folded Quotas line); they now pin the `compact` preset they test,
  and are renamed « Panneau (compact preset) ». The `normal` rows stay covered by other cases.

## How verified (MSI, 12 Nov, clock times UTC)
- `node --test --test-concurrency=1 mods/cockpit/tests/*.test.mjs`: exit 0 (hub.test.mjs 9 cases rewritten).
- `claude plugin test mods/cockpit` (2.1.322): 34 pass, 0 fail (was 30/4 on origin/main).
- `claude plugin validate mods/cockpit` with 2.1.322 and with CI's pinned 2.1.293: passed; `node tools/validate_mods.mjs`:
  all 20 mods validate.
- Headless load with live data (17:29Z): `CLAUDE_CODE_PLUGIN_DIRS=<worktree>/mods/cockpit claude -p "/fleet"` exit 0,
  answered by `cockpit:` with both blocks (MSI: 12 to-dos here, 2 urgent first, temperature GPU 49 °C, 26 agent
  processes, disk C: 9 % and D: 7 % warnings; Global: 0 of 4 workers busy, 7 alerts, You list 17 with I90's recommended
  answer, 5 errors now). `node mods/cockpit/scripts/preview.mjs --hub-live --cols 56` drew the pane from the same data.
  (Private output, not committed.)

## Problems hit
- `Link` to `http://127.0.0.1` is drawn as plain text without key on the desktop surface: replaced by Buttons.
- A read-only probe on the mbp (`find $HOME -maxdepth 4`) hung (likely a macOS privacy prompt); it times out by itself
  at 600 s. Next probes on macOS avoid walking `$HOME`.

## Installed (12 Nov, after #84 merged as c20ce50)
- msi: main checkout fast-forwarded to c20ce50 (as earlier lanes deployed); `claude -p "/fleet fleet"` 17:33Z exit 0,
  answered by band+cockpit with both blocks and the Fleet page link.
- imac (queue job 318): `C:\PROJ\claude-mod` 6ba355b -> c20ce50 (ff-only; the untracked engine `tsconfig.json` kept),
  old Fleet 0.1.0 replaced by the redirect 0.2.0 (backup in `~/.claude/mods-backup/`), validate passed, `/fleet`
  answered by cockpit.
- msiold (jobs 319, 320) and mbp (jobs 326, 327): no claude-mod checkout, only `~/.claude/mods/fleet` (Fleet 0.1.0).
  The merged `mods/cockpit` and `mods/fleet` came from a hub tarball (sha256 8c6e6069…, checked on arrival) into
  `~/.claude/mods/cockpit`; Fleet replaced by the redirect; `~/.claude/mods/cockpit` added first to
  `CLAUDE_CODE_PLUGIN_DIRS` (`settings.json.bak-mod-dispatcher` kept); validate passed and `/fleet` answered by cockpit
  on both. These copies do not follow main (register I145).
- Problem hit: macOS separates `CLAUDE_CODE_PLUGIN_DIRS` with `:`, not `;` (job 326 wrote `;`, job 327 fixed it).
  The first msiold settings edit failed on PowerShell quoting of `node -e` (nothing written; redone from a file).

## Remaining
- msiold and mbp copies: a claude-mod checkout there (or a re-copy per release) to follow main: dispatch.
- Not seen in the desktop app by a person: the external reviewer pass Julian asked for judges it.
- `mods/fleet/README.md` still says « hub tabs » (not this lane's file): one patch.
- Mode and CPU temperature appear when the hub publishes `health` / `modes` in `data.json` (lane health-modes or the
  Fleet view): nothing to change here, the model reads both keys.
