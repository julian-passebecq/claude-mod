# Lane report: Cockpit hub tabs, Fleet folded in (2026-11-12)

Goal: one Claude Code mod and one window. The separate Fleet mod and the to-do, alerts, quota and questions views
become tabs of the Cockpit mod, read from the SAME data as the local Cockpit page and the VS Code extension.
PR: julian-passebecq/claude-mod#82.

## What changed
- `mods/cockpit/lib/hub.mjs` (pure model of herd-worker's `/local.json` + `/data.json`), `hooks/hub_view.mjs` (drawing),
  engine glue in `hooks/register.mjs` (GETs every `hub.refresh_s`, POSTs with the page's Origin + per-start token).
- Tabs, one bar above every view: Overview (data.overview), To do (Urgent >= `todo.urgent_prio`, Ongoing, this
  computer, elsewhere; `[tag]`, machine and priority tags; Run / Mark done; count = the page's), Questions and checks,
  Fleet, Quota (`data.quota` when the hub adds it + quota warnings + this computer's windows), Alerts (hub, machines,
  local veille), Journal (`data.journal` or derived events), Watch (digest), Lanes, Conversations (the Panneau).
  The pane opens on Overview (`hub.start`).
- Workspace switch per organization when `data.organizations` exists (absent today: no row).
- `/fleet [tab]`, `/dispatch <machine> <text>`, `/todo <machine> <text>`: registered by Cockpit when no loaded mod has
  the name (at session start and again after `aliases.delay_s`); status line `Fleet: N to do`.
- `mods/fleet`: thin redirect (registers nothing, opens nothing); `scripts/install-fleet-redirect.mjs` replaces an old
  installed copy (backup in `~/.claude/mods-backup/`).
- Time-rotted usage test fixed (retention counted from the later of fixture time and today).
- Config: `hub` in `cockpit.config.json`; every label in `lib/hub.mjs` `HUB_DEFAULTS.labels`.

## How verified
- `node --test "tests/*.test.mjs" "mods/*/tests/*.test.mjs"`: all pass (hub model, drawing at 45 and 90 columns,
  organizations, sending, redirect installer).
- `claude plugin test mods/cockpit`: 30 pass, 4 fail. The 4 are the « Panneau by default » cases, which fail the same
  on origin/main (they expect the `compact` Quotas line; the shipped preset is `normal`). The 5 new hub cases pass on
  terminal and desktop (tab switch, Mark done POST with token and Origin, /fleet /dispatch /todo, a loaded Fleet mod
  keeps /fleet, cockpit down).
- `claude plugin validate` with 2.1.322 and with CI's pinned 2.1.293: passed (2.1.293 refuses `$` passed across an
  import, so the glue lives in register.mjs).
- Live on the MSI, `claude -p "/fleet"` with this branch's mods: `/fleet`, `/dispatch`, `/todo` listed,
  `GET /local.json 200`, `GET /data.json 200`, `Fleet: 8 to do` (the page's count); `/dispatch` and `/todo` with an
  unknown machine answer the known list. The worker answers 400 (not 404) to an empty `/api/dispatch` and `/api/todo`:
  the endpoints exist. `node mods/cockpit/scripts/preview.mjs --hub-live <tab>` dumps all nine tabs from live data.

## Follow-up the same evening (PR 2)
- The hub started publishing `inbox` (orgs, items, `todo_org`, confidential orgs), `quota.providers` as a list,
  `journal` as the daily journal text and `lanes` as a block: the model reads all four. Workspace row now live (DataPass,
  FOIL, Fleet and tooling, Unsorted repos, one confidential org hidden under All); Questions adds the inbox questions.

## Problems hit
- Git Bash turns `claude -p "/fleet"` into a path: use `MSYS_NO_PATHCONV=1`.
- A headless prompt runs before the 4 s alias delay: hub commands now register at session start too.

## Remaining
- Pane not yet seen in the desktop app (running sessions load the new code after a restart): one patch if anything is off.
- a-faire, veille, usage, problemes stay loaded (watcher, scanners, local registers); their readings show in the hub tabs.
- Other machines: the old Fleet copy was only bundled for them; run `scripts/install-fleet-redirect.mjs` there with
  the claude-mod checkout (dispatch).
- claude-control still carries `mods/fleet` 0.1 and its installer: archive it and drop the path from
  `config/claude/settings-env.json` (one patch, claude-control lane).
- The 4 old « Panneau by default » hook tests (one patch).
