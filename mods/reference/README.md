# reference — Référence

**One of the 6 entries of the band's Mods bar** (Jauge, Cockpit, Veille, À toi, Registres, Référence).

One side pane with five tabs: **Config | Guide | Scénarios | Santé | CI**. It replaces five separate panes in the Mods bar. Nothing here blocks or rewrites a tool call or a prompt, and nothing calls a model.

| Command | What it does |
|---|---|
| `/reference` | Opens the pane on the last tab (first time: `start_tab`, default Config). |
| `/reference config [scan]` | Config: everything in Claude Code, read-only, with search (control's `/config-claude` view). `scan` reruns control's scanner. |
| `/reference guide [section]` | Guide: the mods' user guide (`MODE-EMPLOI.md`) with Sommaire and live « Nos mods » cards, opened on a tab or section by name. |
| `/reference scenarios [S1..] [prompt\|agent\|workflow\|frontmatter\|env]` | Scénarios: per-role model, effort, unit and max parallel, ready-to-paste snippets, and **Appliquer ce scénario**. |
| `/reference sante [refresh]` | Santé: every mod loaded or not, versions, commands, caches, errors, scan CPU. |
| `/reference ci [diagramme [refresh] [claude\|codex\|inconnu\|tout] [hote\|app\|conv]]` | CI: Routage and Diagramme (pipelines, Gantt, ETA, Claude/Codex split). |
| `/reference close` | Closes the pane. |

**Old commands keep working.** `/config-claude`, `/control`, `/mods-guide`, `/scenarios`, `/sante` and `/ci` are registered by this mod only when no loaded mod already has them (checked with `$.command.list()` after every other mod's `session.start`). While control, guide, scenarios, sante or ci are still loaded, their own command answers; once they are unloaded, the same command opens the matching Référence tab with the same words (`/ci diagramme codex`, `/mods-guide claude plugin`, `/scenarios S2 env`). `/control` opens the Config tab (SETUP, USAGE, PRACTICES and HISTORY stay in the control mod). `/ci route` and `/ci clear` need the ci mod loaded.

## Where each tab comes from

Each tab draws with a **byte copy of its owner's pure view code** and reads the **owner's caches**; nothing is drawn twice in two styles.

| Tab | View code (synced into `lib/<mod>/`) | Data |
|---|---|---|
| Config | `control/hooks/config_draw.tsx`, `config_view.ts`, `view.ts`, `config.json` | `~/.claude/effort-board/control/config-claude.json` and its content shards, written by control's `scanner/config_scan.py` (secrets masked there, before anything is written). Rescan runs that scanner when the control mod sits beside this one. |
| Guide | `guide/hooks/draw.tsx`, `cards.ts`, `toc.ts`, `MODE-EMPLOI.md`, `mods.json` | The copy of the guide; « Nos mods » cards rebuilt live from the mods beside this one. |
| Scénarios | `scenarios/hooks/draw.tsx`, `logic.ts`, `apply.ts`, `apply_io.ts`, `scenarios.json` | The shipped scenarios plus `paths.scenarios_file`. |
| Santé | `sante/hooks/draw.tsx`, `logic.mjs`, `scanner/sante_scan.mjs` (with its `lib/core` copies), `sante.config.json` | `~/.claude/sante-mod/report.json`; ↻ (or a report older than `sante_refresh_min`) runs the copied scanner, which also writes `~/.claude/mods-health/sante.json` with its `findings`. |
| CI | `ci/hooks/draw.tsx`, `diagram.ts`, `view.ts`, core `gantt.mjs` and `estimate.mjs` | ci's `scanner/ci.py show` and `pipelines` (cache only; Refresh / Rafraîchir check like the ci pane) when the ci mod sits beside this one; else the Diagramme reads `~/.claude/ci-pipelines-cache.json` alone. |

The copies are listed in `lib/core/targets.json` (`files`) and checked by `node scripts/sync-libs.mjs --check` in CI. Never edit a copy: change the owner's file, run `node scripts/sync-libs.mjs`, commit both.

## Appliquer ce scénario

The button under each scenario writes the chosen per-role model and effort, plus the env defaults it implies, to `~/.claude/scenarios/applied.json` (the previous one is kept as `applied.prev.json`). The tab then shows, role by role, the current value next to the applied one: the lead against `~/.claude/settings.json` (`model`, `effortLevel`), each subagent or Workflow role against the frontmatter of `~/.claude/agents/<agent>.md`, and `CLAUDE_CODE_SUBAGENT_MODEL` / `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` against settings `env`. **It never edits settings.json, an agent file or the environment**: the record is a note, the diff says what to change by hand.

## Settings

`reference.config.json`: tab order (`tabs`), `start_tab`, `python` / `node`, paths (`claude_dir`, `control_out_dir`, `sante_data_dir`, `scenarios_file`, `ci_pipelines_cache`), `sante_refresh_min`, and every label (pane title, tab names). `~/.claude/reference-mod/reference.config.json` is deep-merged on top, and userConfig `config` names another override file.

## Load it

Add `<repo>/mods/reference` to `CLAUDE_CODE_PLUGIN_DIRS` (or `claude --plugin-dir mods/reference`). The owner mods (control, guide, scenarios, sante, ci) can stay loaded until they are removed: their commands then answer, and this pane shows the same views.

## Tests

```sh
node scripts/sync-libs.mjs --check
node --test mods/reference/tests/*.test.mjs
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/reference
claude plugin validate mods/reference
```

All test data is invented.
