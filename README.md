# claude-mod

Mods for Claude Code: small panes that **show** what your agents do. They never block or rewrite a tool call; at most they warn.

Needs **Claude Code 2.1.287 or later** (function-hook mods, panes, `Svg` element).

## The mods

| Mod | Command | What it shows |
|---|---|---|
| [`factory`](mods/factory) | `/factory`, `/factory <title or id>` | Dashboard of every conversation (model, effort, context %, cost today, running subagents, PR/MR and CI, waiting on you). Click one for its agent tree: main thread, each subagent and Workflow node with model, effort, tokens and estimated cost, the bill per model and per turn, refused tool calls, the session log and warnings (subagent without an explicit model, Opus doing read-only search, big context without `handoff/RESUME.md`, timer tools). |
| [`control`](mods/control) | `/control [setup\|usage\|practices\|history] [scan]` | SETUP: everything that shapes a session (settings, env, permissions, global and repo `CLAUDE.md`, agents, skills, hook scripts, mods, scheduled tasks, MCP servers, plugins, memory), with hidden rules and any blocker (hook, deny rule, mod deny path) at the top. USAGE: 1/7/30-day model, effort and delegation mix from the transcripts, each metric against a target. PRACTICES and HISTORY: your rules file, followed or not, and its version history. |
| [`ci`](mods/ci) | `/ci [refresh]`, `/ci route <repo\|session\|here> <backend-id>`, `/ci clear <target>` | CI routing: the CI backends from your config (GitHub Actions, GitLab.com shared runners, a self-hosted runner, VM runners still coming), whether each is usable now (token present yes/no, runners online, running/pending jobs, Actions per routed repo), and which repo or conversation uses which. A lead conversation or you set the route; each conversation sees its route in the status line and as a short note in its system prompt. |
| [`scenarios`](mods/scenarios) | `/scenarios [S1..] [prompt\|agent\|workflow\|frontmatter\|env]` | Scénarios d'agents: presets of roles -> model, effort, unit (session, sub-conversation, Workflow `agent()`, Agent subagent) and max parallel (S1 Standard V6, S2 Économe, S3 Qualité max, S4 Nuit, plus yours from a JSON file). For each role, the exact settings (Agent call, `agent()` opts, agent-file frontmatter, env vars) and the documented limits, each with its doc URL and "non vérifié" where the docs say nothing; a Copy button for a ready-to-paste snippet. Warn-only toast when an Agent call names no model. |
| [`guide`](mods/guide) | `/mods-guide [onglet ou section]` | Mode d'emploi des mods, in French: tabs (Sommaire, Bases, Événements, Interface, Configuration, Installer et activer, Tester, Écrire un mod pas à pas, Référence API, Nos mods, FAQ), foldable categories, and one card per mod of this repo built live from its `plugin.json` and hooks module. Same content in [`MODE-EMPLOI.md`](mods/guide/MODE-EMPLOI.md). |

`factory` and `control` read local files only (transcripts under `~/.claude/projects`, the desktop app's session files, your settings) through a Python scanner (standard library) and draw the result. Dollar figures are **estimates** from token counts and the rate table in each mod's config.

## Catalog

What was kept from the earlier mods when this repo was set up (V6, Oct 2026). Only the **keep** rows are in this repo.

| Mod | Verdict | Why |
|---|---|---|
| factory | **keep** | The only view of the agent tree with models, efforts and cost. Next: feed it from hook events (`agent.spawn`, `turn.start`) instead of scanning files. |
| control | **keep** | The "nothing hidden" proof: every rule source, env variable and blocker in one place. Its metrics and practices still follow the V5 rules and are being rewritten for V6. |
| coordinator | merge into factory | Linked sub-conversations remove most lane collisions; only the "green PR not merged" and "waiting on you" rows are worth keeping, as a strip in factory. |
| context band (cc-control band, context-meter) | merge into a V6 band | Small and correct: context size against the hand-off threshold, read-only. Not written yet. |
| cc-control guards | drop | They refused and rewrote tool calls (send caps, spawn caps, rewrites). Blocking hooks are out. |
| ci | **new** (Oct 2026) | Which CI backend a repo or conversation should use, and whether it works right now, in one place instead of in rules text. |
| scenarios | **new** (Oct 2026) | Which model, effort and unit each role uses, with the doc that says so, instead of rules text that drifts. |
| guide | **new** (Oct 2026) | How mods work and how to write one, plus a card per mod that reads the mod itself. |
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
"CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/factory;~/.claude/mods/control;~/.claude/mods/ci;~/.claude/mods/scenarios;~/.claude/mods/guide"
```

or as a dev-mod in the desktop app for one session. Python 3 must be on `PATH` (the scanners); `gh` / `glab` are used, when present, for PR/MR and CI state.

Each mod has a config file next to it (`factory.config.json`, `config.json`): rates, thresholds, colors, labels and paths are set there, nothing is hard-coded. `factory` also deep-merges `~/.claude/effort-board/factory.config.json` if you have one. In `control/config.json`, set `paths.projects_root` (the folder that holds your repos) and the optional doc paths.

### ci

```sh
cp claude-mod/mods/ci/ci.config.example.json ~/.claude/ci.config.json   # then fill the <PLACEHOLDERS>
python -I ~/.claude/mods/ci/scanner/ci.py show --check                  # same data as /ci, from any shell
python -I ~/.claude/mods/ci/scanner/ci.py route ~/code/my-repo gitlab-local --by lead
```

- Config: `--config`, then `$CI_MOD_CONFIG`, then `~/.claude/ci.config.json`, then `ci.config.json` next to the mod, then the shipped example. Each backend has `id`, `label`, `kind` (`github` | `gitlab`), `host`, `runner_tag`, `status` (`active` | `coming-soon` | `disabled`) and `notes`; optional `group`, `concurrent`, `minutes_month`, `public_only`, `check_runners`, `pending_projects`. A value still in `<angle brackets>` counts as unset. Labels and colors are in `labels`.
- Status check: token **presence** only (`gh auth status`, `glab auth status`, or the env variable names listed under `hosts`); a token value is never printed or stored. With a GitLab token: runners with the backend's tag online/offline and their running jobs (pending jobs for the projects in `pending_projects`). With `gh`: Actions availability for the repos routed to a GitHub backend. Missing tools or tokens show as `unknown`. Results are cached (`status_cache`, `cache_minutes`); `/ci refresh` checks now.
- Routing file: `routing_file` (default `~/.claude/ci-routing.json`), one entry per repo path or session id with backend, who set it and when. A session route wins over a repo route; a worktree inside a routed repo follows the repo. `status_line` and `prompt_note` in the config turn the status-line entry and the system-prompt note off.
- Needs Python 3 on `PATH`; `gh` and `glab` are optional.

## Rules for every mod here

- Show and warn, never block: no `deny`, no rewriting of tool calls or prompts.
- Read-only on your files; each mod writes only its own cache and output folder (`ci` also writes its routing file, on `/ci route` and `/ci clear`).
- No network except `gh` / `glab` for PR state and the GitLab API for runner status (`ci`).
- Configurable legends, labels, colors and thresholds.
- Tests next to the code.

## Tests

```sh
python -I -m unittest discover -s mods/control/tests -p "test_*.py"
python -I -m unittest discover -s mods/ci/tests -p "test_*.py"
node --test mods/factory/tests/logic.test.mjs mods/scenarios/tests/logic.test.mjs mods/guide/tests/guide.test.mjs
node mods/guide/scripts/build.mjs   # regenerate MODE-EMPLOI.md (table of contents, Nos mods cards)
# hook and pane tests, with the Claude Code test kit:
claude plugin test mods/factory
claude plugin test mods/control
claude plugin test mods/ci
claude plugin test mods/scenarios
claude plugin test mods/guide
# before every push (public repo): no private paths, tokens, e-mails or transcripts
python -I tools/confidentiality_scan.py .
```

`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is ignored since Claude Code 2.1.287 (mods are on by default, [overview](https://code.claude.com/docs/en/plugins/mods/overview)). GitHub Actions (`.github/workflows/tests.yml`) runs the Python and node tests and the confidentiality scan; the test-kit suites need the `claude` CLI and run locally.

`control`'s reference-window test replays the author's own transcripts and only runs with `CONTROL_REFERENCE=1`.

## License

MIT
