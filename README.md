# claude-mod

Mods for Claude Code: small panes that **show** what your agents do. They never block or rewrite a tool call; at most they warn.

Needs **Claude Code 2.1.287 or later** (function-hook mods, panes, `Svg` element).

## The mods

| Mod | Command | What it shows |
|---|---|---|
| [`factory`](mods/factory) | `/factory`, `/factory <title or id>` | Dashboard of every conversation (model, effort, context %, cost today, running subagents, PR/MR and CI, waiting on you). Click one for its agent tree: main thread, each subagent and Workflow node with model, effort, tokens and estimated cost, the bill per model and per turn, refused tool calls, the session log and warnings (subagent without an explicit model, Opus doing read-only search, big context without `handoff/RESUME.md`, timer tools). |
| [`control`](mods/control) | `/control [setup\|usage\|practices\|history] [scan]` | SETUP: everything that shapes a session (settings, env, permissions, global and repo `CLAUDE.md`, agents, skills, hook scripts, mods, scheduled tasks, MCP servers, plugins, memory), with hidden rules and any blocker (hook, deny rule, mod deny path) at the top. USAGE: 1/7/30-day model, effort and delegation mix from the transcripts, each metric against a target. PRACTICES and HISTORY: your rules file, followed or not, and its version history. |

Both mods read local files only (transcripts under `~/.claude/projects`, the desktop app's session files, your settings) through a Python scanner (standard library) and draw the result. Dollar figures are **estimates** from token counts and the rate table in each mod's config.

## Catalog

What was kept from the earlier mods when this repo was set up (V6, Oct 2026). Only the **keep** rows are in this repo.

| Mod | Verdict | Why |
|---|---|---|
| factory | **keep** | The only view of the agent tree with models, efforts and cost. Next: feed it from hook events (`agent.spawn`, `turn.start`) instead of scanning files. |
| control | **keep** | The "nothing hidden" proof: every rule source, env variable and blocker in one place. Its metrics and practices still follow the V5 rules and are being rewritten for V6. |
| coordinator | merge into factory | Linked sub-conversations remove most lane collisions; only the "green PR not merged" and "waiting on you" rows are worth keeping, as a strip in factory. |
| context band (cc-control band, context-meter) | merge into a V6 band | Small and correct: context size against the hand-off threshold, read-only. Not written yet. |
| cc-control guards | drop | They refused and rewrote tool calls (send caps, spawn caps, rewrites). Blocking hooks are out. |
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
"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
"CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/factory;~/.claude/mods/control"
```

or as a dev-mod in the desktop app for one session. Python 3 must be on `PATH` (the scanners); `gh` / `glab` are used, when present, for PR/MR and CI state.

Each mod has a config file next to it (`factory.config.json`, `config.json`): rates, thresholds, colors, labels and paths are set there, nothing is hard-coded. `factory` also deep-merges `~/.claude/effort-board/factory.config.json` if you have one. In `control/config.json`, set `paths.projects_root` (the folder that holds your repos) and the optional doc paths.

## Rules for every mod here

- Show and warn, never block: no `deny`, no rewriting of tool calls or prompts.
- Read-only on your files; each mod writes only its own cache and output folder.
- No network except `gh` / `glab` for PR state.
- Configurable legends, labels, colors and thresholds.
- Tests next to the code.

## Tests

```sh
python -I -m unittest discover -s mods/control/tests -p "test_*.py"
node --test mods/factory/tests/logic.test.mjs
# hook and pane tests, with the Claude Code test kit:
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/factory
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/control
```

## License

MIT
