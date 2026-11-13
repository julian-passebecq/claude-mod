# Lane report: cockpit-ongoing-view, a concise pane that opens the Cockpit page (2026-11-13)

Goal (Julian, 13 Nov 16:30: « claude mod better visibility », « claude mod concise, open to cockpit »; backlog R58, R59,
R63, R70): every section of the pane is one line with a count and a colour that opens the matching part of the Cockpit
page; an Ongoing view inside the same pane; one line per machine; « you: N » above the prompt without 5 h, week and
Export conv; the false « not up to date » line fixed. Files: `mods/cockpit`, `mods/band` (config, one helper, tests).
Manifests: cockpit 0.8.6, band 0.8.1.

## What changed
1. **Folding** (`hooks/hub_view.mjs` `sectionLine`, `rowLine`): in the pane (`S.act.more` present) This laptop's Warnings,
   Working on and To do here, and Global's Machines, Needs you now and Problems now are one line each: › / ⌄ unfolds it
   in place, the label opens its part of the page. `hub.open_sections` (default `machines`, `you`) start unfolded.
   `hub.compact` (default true): each decision or problem row is one clipped line; a decision's › unfolds today's full
   row (recommended answer, more, what it does). The views row and the refresh / age line are two rows (no horizontal
   scroll at 38 columns).
2. **Machine lines (R58)** (`lib/hub.mjs globalModel`, `machineText`): « ● MSI (JULP) · normal · ▶ 22 » (▶ = the tile's
   queue jobs plus its agent processes), each opening `#tile-<id>`. `/fleet` prints the same lines with their links.
3. **Ongoing (R63, R70)**: `HUB_TABS = ['home', 'ongoing']`; `lib/panel_list.mjs ongoingOf` keeps this conversation's
   tree of the Panneau's list (parents when it is a sub-conversation, Workflows, agents, sub-conversations);
   `hooks/panel_view.mjs drawThisConv` draws it with the Panneau's own `lineEls`. Then « Elsewhere on this PC: N working »
   (opens Conversations), the repo and branch of the self row, the machines whose tile has a queue job in that repo
   (`jobRepo`: the job's `repo`, else its working directory) and « Sessions per machine: not reported » (the hub does not
   publish them). `hooks/register.mjs`: the Ongoing tab loads the Panneau's data (`wantsPanel`).
4. **you: N (R59)**: `on('ui.render', { component: 'AbovePrompt' })` in cockpit draws « you: N » (the page's Needs you
   now count; red while the critical strip has a row) that opens `#todo`; `hub.prompt_line: false` turns it off. The
   band hides what other mods draw above the prompt (`others_above_prompt: hide`), so `band.config.json` gains
   `jauge.keep_above_prompt: ["cockpit-you"]` and `hooks/logic.ts keptAbove` keeps only those keyed elements.
   `jauge.clarity.summary` is `["waiting", "context"]` (no 5 h, no week) and `export_brief.enabled` is false
   (`/export-eta brief` stays).
5. **Freshness**: a part is late only when its `due_ts` is before `glance.generated_ts` (the hub knew it); only the page
   data part is compared with this computer's clock. On the hub, intake's cron lines are commented `#OFF-2026-11-13`
   (Galaxy freeze), and the live `glance.freshness` has no intake entry now; the 04:34 line came from that stopped part.

## How verified (MSI, 13 Nov, about 15:30-16:50Z)
- `node scripts/sync-libs.mjs --check`: 173 copies current.
- `node --test --test-reporter=dot "tests/*.test.mjs" "mods/*/tests/*.test.mjs"`: all pass (one run showed a flaky
  `band/tests/health.test.mjs` window case that passed on the next run; not touched here).
- `mods/cockpit/tests/hub.test.mjs`: 6 new cases (folded sections at 38 columns and their toggle keys; compact decision
  row opens `#r-<uid>` and unfolds its answers; each line's URL: `#tile-pc2`, `#overview`, `#todo`, `#alerts`, a
  configured base; machine lines; freshness against `generated_ts`; Ongoing tree, parent of a sub-conversation, repo
  machines, « not reported », no line over 38 columns).
- `mods/band/tests`: shipped summary has no `five` / `week`, Export conv off, `keptAbove`.
- `claude plugin test mods/cockpit` (2.1.323): 34 pass, 0 fail (the dispatcher test unfolds its sections; « you: N »
  mounted and pressed opens `#todo`).
- `claude plugin test mods/band`: 57 pass, 4 fail; the same 4 fail on `origin/main` (Jauge line and clarity folded
  summary expectations), not caused here.
- `node tools/validate_mods.mjs`: all 20 mods validate. `python -I tools/confidentiality_scan.py .`: PASS.
- Preview: `--hub --cols 38`, `--ongoing --cols 38`, `--hub-live --cols 38`: no line over 38 columns; live, the folded
  dispatcher is 42 lines with Machines and Needs you now open. Screenshots (invented fixtures, rendered text at 300 px
  and 550 px): `evidence/2026-11-13-cockpit-ongoing-300px.png`, `evidence/2026-11-13-cockpit-ongoing-550px.png`.

## Not verified
- The desktop app itself at about 300 px (clicking each line and reading the browser address): needs the app reloaded
  with the merged checkout. Unit and plugin tests check the URLs.
- That the band, loaded before cockpit, really receives the keyed « you: N » element from the real engine (the plugin
  harness mounts cockpit alone).

## Problems hit
- This tool's Bash rejects some quoted heredocs; edits went through script files.

## Remaining
- R57, R62, R64 (left side, second pane, bottom strip), R60, R65 to R68 (VS Code Insiders tabs, OpenCode removal): out of
  this lane.
- Claude sessions per machine and their token use are not published by the hub: « not reported » until a worker
  reports them (dispatch: worker + hub change).
- `deploy-fleet.sh` ships `mods/cockpit` only; the band change reaches other machines through their checkouts (imac
  fast-forwards; msiold and mbp keep their band copy until updated). One patch.
