# claude-mod

Mods for Claude Code: small panes that **show** what your agents do. They never block or rewrite a tool call; at most they warn.

Needs **Claude Code 2.1.287 or later** (function-hook mods, panes, `Svg` element).

## The mods

| Mod | Command | What it shows |
|---|---|---|
| [`factory`](mods/factory) | `/factory`, `/factory <title or id>` | **Ça t'attend** strip on top: PRs/MRs green but not merged for N min (gh/glab), sessions waiting on you (pending question, blocked wrap-up), lanes with no turn while their PR is red, conflicting or its pipeline skipped, and each lead's sub-conversations; one native notification per new row (`$.ui.notify`, else a toast), all thresholds and French labels in `factory.config.json` → `waiting`. Then the dashboard of every conversation (model, effort, context %, cost today, running subagents, PR/MR and CI, waiting on you). Click one for its agent tree: main thread, each subagent and Workflow node with model, effort, tokens and estimated cost, the bill per model and per turn, refused tool calls, the session log and warnings (subagent without an explicit model, Opus doing read-only search, big context without `handoff/RESUME.md`, timer tools). |
| [`control`](mods/control) | `/control [setup\|usage\|practices\|history] [scan]` | Read live at each scan, so it never goes stale with a rules version. SETUP: « Règles actives » (the title line and version of `~/.claude/CLAUDE.md`, e.g. V5.8), blockers (hook, deny rule, mod deny path), « Mods chargés » (each mod folder: loaded by `CLAUDE_CODE_PLUGIN_DIRS`, installed not loaded, or a copy of a mod loaded elsewhere), hidden rules, then settings (env **names only**, a value only for an allow-list), settings hooks, permissions, repo `CLAUDE.md`, agents, skills, workflows, hook scripts, scheduled tasks, MCP servers, plugins, memory. USAGE: 1/7/30-day model, effort and delegation mix, each metric against the live rule line it measures. PRACTICES: one section per heading of the live `CLAUDE.md`, each line with the evidence it cites (dates, PRs, audits, `PRACTICES` ids) and its measured state, plus a « V6 en attente » panel (kept / changed / dropped) when the rules repo has `docs/V6-CHANGES.md` on main. HISTORY: the rules' version history. |
| [`ci`](mods/ci) | `/ci [refresh]`, `/ci route <repo\|session\|here> <backend-id>`, `/ci clear <target>` | CI routing: the CI backends from your config (GitHub Actions, GitLab.com shared runners, a self-hosted runner, VM runners still coming), whether each is usable now (token present yes/no, runners online, running/pending jobs, Actions per routed repo), and which repo or conversation uses which. A lead conversation or you set the route; each conversation sees its route in the status line and as a short note in its system prompt. |
| [`scenarios`](mods/scenarios) | `/scenarios [S1..] [prompt\|agent\|workflow\|frontmatter\|env]` | Scénarios d'agents: presets of roles -> model, effort, unit (session, sub-conversation, Workflow `agent()`, Agent subagent) and max parallel (S1 Standard V6, S2 Économe, S3 Qualité max, S4 Nuit, S5 Plein régime, plus yours from a JSON file). For each role, the exact settings (Agent call, `agent()` opts, agent-file frontmatter, env vars) and the documented limits, each with its doc URL and "non vérifié" where the docs say nothing; a Copy button for a ready-to-paste snippet. Warn-only toast when an Agent call names no model. |
| [`usage`](mods/usage) | `/conso [aujourdhui\|semaine\|prevision\|scenarios\|plein\|codex] [refresh]` | Consommation, in French: tokens and list-price cost equivalent today and over the week, per hour (heatmap), project, model, kind (main thread, Agent subagent, Workflow agent, sub-conversation), app surface, effort, skill and MCP server, top 10 sessions. Forecast of the 5-hour and weekly limits from the official % (`$.session.usage()`) and the measured pace (last 2 h, today, 7 days) with calme / normal / intense projections; which scenario (S1-S5) fits the quota left before the reset; suggests S5 "Plein régime" when much of the week would be left. Optional status-line entry. **Codex** tab: Codex tokens today and over 7 days, per model, and the plan % Codex writes in its local session files (`~/.codex/sessions/**/rollout-*.jsonl`, the files the codex-hud plugin reads), next to Claude's on one line; « non disponible » when nothing is written (option `codex`: config/on/off). Its parser and price table are a shared module (`mods/usage/lib`). |
| [`band`](mods/band) | `/jauge [refresh]` | Jauge, always visible above the prompt (French labels): this conversation's context in tokens and % of the window, where auto-compact sits and how far it is (with « compactage dans ~N min » at the current context growth), markers when it nears the RESUME hand-off threshold (250 K) or a compaction at rest, the burn rate in tok/s at the scopes you pick (this conversation, + its subagents, its Workflow agents, the project with its worktrees, the whole PC) and « semaine X % » when the account reports its 7-day limit. `/jauge` adds the per-scope table (tok/s, /min, /h, list-price $/h, over 60 s and 10 min), the 5 hottest sessions with their compactions, projects, 30-minute sparklines with compaction markers, and each conversation's compactions (time, auto / `/compact` / at rest, context before → after). Optional status-line entry. |
| [`machine`](mods/machine) | `/machine [refresh\|ci]` | Machine, a live view of this PC (French labels): CPU total and per core, RAM, free space per fixed drive, GPU (nvidia-smi, else a Windows performance counter, else « non disponible »), top 5 processes by CPU and by memory with `claude`, `node`, `python` and `git` coloured and totalled, and the local GitLab runner's load (runners online, jobs running / pending) through the `ci` mod's own scanner and config. From these, « agents en parallèle conseillés maintenant : N » with the rules that fired (CPU, RAM, disk, pending jobs) and the caps (4 CI pipelines minus running jobs, 3 `npm ci` / `tsc`). Samples only while its pane is open (every 5 s) or its optional band entry is on (every 15 s, off by default). |
| [`guide`](mods/guide) | `/mods-guide [onglet ou section]` | Mode d'emploi des mods, in French: tabs (Sommaire, Bases, Événements, Interface, Configuration, Installer et activer, Tester, Écrire un mod pas à pas, Référence API, Nos mods, FAQ), foldable categories, and one card per mod of this repo built live from its `plugin.json` and hooks module. Same content in [`MODE-EMPLOI.md`](mods/guide/MODE-EMPLOI.md). |
| [`filetree`](vendor/filetree) (external, MIT, [data-goblin](https://github.com/data-goblin/claude-code-filetree)) | `/filetree [path]` | Vendored unchanged at release v0.2.26 (see its [`NOTICE`](vendor/filetree/NOTICE)). File tree of the session's folder in the right pane: git status per file with lines added/removed, branch and ahead/behind, files Claude reads (purple), writes (orange) and commits (green) shimmer, search, sizes, double-click to open. It sends one context line to the model only while you have a file selected (click a file; the ⊘ button clears it). English labels (the author's). |

`factory` and `control` read local files only (transcripts under `~/.claude/projects`, the desktop app's session files, your settings) through a Python scanner (standard library) and draw the result. Dollar figures are **estimates** from token counts and the rate table in each mod's config.

## Catalog

What was kept from the earlier mods when this repo was set up (V6, Oct 2026). Only the **keep** rows are in this repo.

| Mod | Verdict | Why |
|---|---|---|
| factory | **keep** | The only view of the agent tree with models, efforts and cost. Next: feed it from hook events (`agent.spawn`, `turn.start`) instead of scanning files. |
| control | **keep** | The "nothing hidden" proof: every rule source, env variable and blocker in one place. Since Oct 2026 it reads the live rules (version, sections, evidence) instead of a V5 list, and shows pending V6 changes. |
| coordinator | merge into factory | Linked sub-conversations remove most lane collisions; only the "green PR not merged" and "waiting on you" rows are worth keeping, as a strip in factory. |
| context band (cc-control band, context-meter) | merged into **band** (built, Oct 2026) | Small and correct: context size against the hand-off threshold, read-only. Now `band` (Jauge), with burn rates and compactions. |
| cc-control guards | drop | They refused and rewrote tool calls (send caps, spawn caps, rewrites). Blocking hooks are out. |
| ci | **new** (Oct 2026) | Which CI backend a repo or conversation should use, and whether it works right now, in one place instead of in rules text. |
| scenarios | **new** (Oct 2026) | Which model, effort and unit each role uses, with the doc that says so, instead of rules text that drifts. |
| usage | **new** (Oct 2026) | Where the tokens go and when the plan runs out, from the transcripts and the official %, instead of guessing; tokens per 1 % calibrated locally. |
| guide | **new** (Oct 2026) | How mods work and how to write one, plus a card per mod that reads the mod itself. |
| filetree (data-goblin, MIT) | **vendored** (Oct 2026) | An IDE-style file tree with live git status and Claude's reads/writes, better than writing our own. Copied unchanged from a release into `vendor/filetree`; checked: no blocking, prompt context only for a file you selected. |
| machine | **new** (Oct 2026) | How loaded this PC is right now and how many agents to run in parallel, from measured CPU, RAM, disks, GPU and the runner, instead of guessing. |
| cost-tracker, activity-pane, launchpad, night | drop | Wrong numbers for new model ids, superseded by factory, or built on timer wake-ups. |
| V4 pages and watcher | drop | Dead since early Oct, replaced by factory and the app's own agent view. |

## Install

Copy or symlink a mod folder to `~/.claude/mods/<name>`:

```sh
git clone https://github.com/julian-passebecq/claude-mod.git
# copy
cp -r claude-mod/mods/factory ~/.claude/mods/factory
# or symlink (Windows: mklink /D, as admin or with developer mode)
ln -s "$PWD/claude-mod/mods/factory" ~/.claude/mods/factory
```

Then load it, either for every session with the environment (in `~/.claude/settings.json` under `env`, folders separated by `;` on Windows, `:` elsewhere):

```json
"CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/factory;~/.claude/mods/control;~/.claude/mods/ci;~/.claude/mods/scenarios;~/.claude/mods/guide;~/.claude/mods/usage;~/.claude/mods/band;~/.claude/mods/machine"
```

or straight from a clone, with absolute paths (Windows example):

```json
"CLAUDE_CODE_PLUGIN_DIRS": "D:/code/claude-mod/mods/band;D:/code/claude-mod/mods/factory;D:/code/claude-mod/mods/usage;D:/code/claude-mod/mods/scenarios;D:/code/claude-mod/mods/ci;D:/code/claude-mod/mods/control;D:/code/claude-mod/mods/guide;D:/code/claude-mod/mods/machine"
```

Every mod here is safe to load by default: none adds text to your prompts or to the system prompt, none blocks or rewrites anything, none calls a model. The one prompt note (`ci`'s route) is off until you set `prompt_note: true`. The external `filetree` (in `vendor/filetree`, not under `mods/`) is the exception you opt into by loading it: while you have a file selected in its tree (you clicked it), each prompt carries one context line with that file's path; the ⊘ button clears it.

To load `filetree`, add `<repo>/vendor/filetree` to the same list, or run `claude --plugin-dir vendor/filetree`.

Or load one as a dev-mod in the desktop app for one session. Python 3 must be on `PATH` (the scanners); `gh` / `glab` are used, when present, for PR/MR and CI state.

Each mod has a config file next to it (`factory.config.json`, `config.json`): rates, thresholds, colors, labels and paths are set there, nothing is hard-coded. `factory` also deep-merges `~/.claude/effort-board/factory.config.json` if you have one, and `control` deep-merges `~/.claude/effort-board/control.config.json` (`paths.user_config`): set `paths.projects_root` (the folder that holds your repos), the optional doc paths and `v6.repo` (the repo whose `main` may hold `docs/V6-CHANGES.md`) there.

### ci

```sh
cp claude-mod/mods/ci/ci.config.example.json ~/.claude/ci.config.json   # then fill the <PLACEHOLDERS>
python -I ~/.claude/mods/ci/scanner/ci.py show --check                  # same data as /ci, from any shell
python -I ~/.claude/mods/ci/scanner/ci.py route ~/code/my-repo gitlab-local --by lead
```

- Config: `--config`, then `$CI_MOD_CONFIG`, then `~/.claude/ci.config.json`, then `ci.config.json` next to the mod, then the shipped example. Each backend has `id`, `label`, `kind` (`github` | `gitlab`), `host`, `runner_tag`, `status` (`active` | `coming-soon` | `disabled`) and `notes`; optional `group`, `concurrent`, `minutes_month`, `public_only`, `check_runners`, `pending_projects`. A value still in `<angle brackets>` counts as unset. Labels and colors are in `labels`.
- Status check: token **presence** only (`gh auth status`, `glab auth status`, or the env variable names listed under `hosts`); a token value is never printed or stored. With a GitLab token: runners with the backend's tag online/offline and their running jobs (pending jobs for the projects in `pending_projects`). With `gh`: Actions availability for the repos routed to a GitHub backend. Missing tools or tokens show as `unknown`. Results are cached (`status_cache`, `cache_minutes`); `/ci refresh` checks now.
- Routing file: `routing_file` (default `~/.claude/ci-routing.json`), one entry per repo path or session id with backend, who set it and when. A session route wins over a repo route; a worktree inside a routed repo follows the repo. `status_line` (default on) turns the status-line entry off; `prompt_note` (default **off**: it adds a line to every request) turns on a system-prompt note naming the route.
- Needs Python 3 on `PATH`; `gh` and `glab` are optional.

### band

- Context, auto-compact threshold and the 7-day limit come from the engine (`$.session.usage()`, `session.measure`: the status line's figures, [statusline](https://code.claude.com/docs/en/statusline)). The threshold is the breakdown's `autoCompactThreshold` (a local `summary` breakdown, no request); without it the band uses `context.autocompact_pct_fallback` and the pane says « non vérifié ».
- Rates come from `scanner/scan.mjs` (Node 22.18+, no dependency), run every `refresh_s`: it reads only the bytes appended to `~/.claude/projects/**/*.jsonl` since its last run (main transcripts, `subagents/`, `subagents/workflows/`), counts each API response once, and keeps its offsets and the last 30 minutes in `cache_file`. `count: fresh` (default) counts input + cache write + output; `all` adds cache reads. A worktree under `.claude/worktrees/` (or a git worktree) counts as its repo.
- Compactions: the transcripts' `system` / `compact_boundary` entries (`compactMetadata.trigger`, `preTokens`, `postTokens`). « au repos » is deduced from the inactivity before an auto compaction, and the at-rest rule (> 200 K, ~54 min idle, 2.1.299) is « non vérifié » in the docs; both are settings.
- **Mods bar** (under the band, and in the `/jauge` pane): one button per mod listed in `launcher.items` of `band.config.json` (default Usine=factory, Conso=usage, Scénarios=scenarios, CI=ci, Control=control, Guide=guide; each item is `label`, `mod`, `command`). A press runs the mod's slash command (`/factory`, `/conso`, ...), which opens that mod's own pane; the button then reads `Conso ✕`, and a second press runs `/conso close`, which every mod here accepts and which closes its pane. A mod whose command is not in the session is greyed out; pressing it says « non chargé : ajouter mods/<x> à CLAUDE_CODE_PLUGIN_DIRS » (Button has no tooltip prop in the mods API, so a toast and the pane line say it). Why a command and not a direct open: `$.ui.open` / `$.ui.close` act only on the calling mod's own panes and `$.ui.panes()` lists only them ([types for 2.1.299](https://code.claude.com/docs/en/plugins/mods/reference)), while `$.command.run` runs any slash command "as if the person typed" it ([mods API](https://code.claude.com/docs/en/plugins/mods/api)). It queues until Claude's turn ends, so while Claude works the press waits (a toast says so); the opened mod's short command reply lands in the transcript. The open state follows the presses and the commands you type; a pane closed with its own ✕ shows as open until the next press (non vérifié: no event tells one mod that another's pane closed). `launcher.enabled: false` hides the bar.
- Everything is in `band.config.json`: windows, scopes and items of the band and of the status line, thresholds (warn 200 K, hand-off 250 K), colors (theme names), labels, rates. userConfig `config` points to your override file; `band` and `status_line` switch the band and the status-line entry.

### machine

- Sampler: `scanner/machine.py` (Python 3, standard library), one short run per sample. Windows: `NtQuerySystemInformation` per core, `GlobalMemoryStatusEx`, `GetDiskFreeSpace` through `shutil.disk_usage`, a Toolhelp process snapshot with `GetProcessTimes` and the working set; Linux: `/proc`. CPU % are deltas since the previous sample (the mod passes the counters back), so nothing runs between samples. GPU: `nvidia-smi` if on `PATH`, else `typeperf` on `gpu.perf_counter` (an English counter name; on a non-English Windows « non vérifié »), read every `gpu.refresh_s`.
- Runner: `machine.py runner` imports the `ci` mod's `scanner/ci.py` (sibling folder, or `ci.scanner`) and calls its `status()`: same config file, same status cache and `cache_minutes`, same token rules (presence only); only counts come back. `ci.backends` picks the backends (default `gitlab-local`). Children of the local `gitlab-runner` process are shown as a rough count of local jobs (« non vérifié »).
- Advice: `advice.base`, then the first matching rule per metric (`cpu`, `ram`, `gpu`, `disk_free_gb`, `ci_running`, `ci_pending`, `runner_children`), then each cap (`ci_pipelines` 4 minus running jobs, `npm_tsc` 3), clamped to `[floor, ceiling]`. All in `machine.config.json`, with intervals (`interval_s` 5, `band.interval_s` 15, floor `min_interval_s`), colours, levels and labels; userConfig `config` points to your override file and `band` turns the band entry on.

## Rules for every mod here

- Show and warn, never block: no `deny`, no rewriting of tool calls or prompts.
- No model tokens by default: nothing added to prompts or to the system prompt unless a setting turns it on (`ci` `prompt_note`, off), no `$.model` call.
- Every pane command accepts `close` (`/factory close`, `/conso close`, ...), used by the Jauge's Mods bar.
- Read-only on your files; each mod writes only its own cache and output folder (`ci` also writes its routing file, on `/ci route` and `/ci clear`).
- No network except `gh` / `glab` for PR state and the GitLab API for runner status (`ci`, and `machine` through `ci`'s scanner).
- Configurable legends, labels, colors and thresholds.
- Tests next to the code.

## Tests

```sh
python -I -m unittest discover -s mods/control/tests -p "test_*.py"
python -I -m unittest discover -s mods/ci/tests -p "test_*.py"
python -I -m unittest discover -s mods/machine/tests -p "test_*.py"
node --test mods/factory/tests/logic.test.mjs mods/scenarios/tests/logic.test.mjs mods/guide/tests/guide.test.mjs mods/usage/tests/logic.test.mjs mods/band/tests/logic.test.mjs mods/machine/tests/logic.test.mjs
node mods/guide/scripts/build.mjs   # regenerate MODE-EMPLOI.md (table of contents, Nos mods cards)
# hook and pane tests, with the Claude Code test kit:
claude plugin test mods/factory
claude plugin test mods/control
claude plugin test mods/ci
claude plugin test mods/scenarios
claude plugin test mods/guide
claude plugin test mods/usage
claude plugin test mods/band
claude plugin validate vendor/filetree/.claude-plugin/plugin.json
claude plugin test vendor/filetree
claude plugin test mods/machine
# before every push (public repo): no private paths, tokens, e-mails or transcripts
python -I tools/confidentiality_scan.py .
```

`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is ignored since Claude Code 2.1.287 (mods are on by default, [overview](https://code.claude.com/docs/en/plugins/mods/overview)). GitHub Actions (`.github/workflows/tests.yml`) runs the Python and node tests and the confidentiality scan; the test-kit suites need the `claude` CLI and run locally.

`control`'s reference-window test replays the author's own transcripts and only runs with `CONTROL_REFERENCE=1`.

## License

MIT
