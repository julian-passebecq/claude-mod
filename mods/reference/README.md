# reference — Référence

**One of the 6 entries of the band's Mods bar** (Jauge, Cockpit, Veille, À toi, Registres, Référence).

One side pane with eight tabs: **Config | Guide | Scénarios | Santé | CI | À essayer | R&D | Repos**. It replaces five separate panes in the Mods bar and adds the research, audit and repo views. Nothing here blocks or rewrites a tool call or a prompt, and nothing calls a model; the buttons act only when Julian clicks them.

| Command | What it does |
|---|---|
| `/reference` | Opens the pane on the last tab (first time: `start_tab`, default Config). |
| `/reference config [scan]` | Config: everything in Claude Code, read-only, with search (control's `/config-claude` view). `scan` reruns control's scanner. |
| `/reference guide [section]` | Guide: the mods' user guide (`MODE-EMPLOI.md`) with Sommaire and live « Nos mods » cards, opened on a tab or section by name. |
| `/reference scenarios [S1..] [prompt\|agent\|workflow\|frontmatter\|env]` | Scénarios: per-role model, effort, unit and max parallel, ready-to-paste snippets, and **Appliquer ce scénario**. |
| `/reference sante [refresh]` | Santé: every mod loaded or not, versions, commands, caches, errors, scan CPU. |
| `/reference ci [diagramme [refresh] [claude\|codex\|inconnu\|tout] [hote\|app\|conv]]` | CI: Routage and Diagramme (pipelines, Gantt, ETA, Claude/Codex split). |
| `/reference essais [refresh]` | À essayer: every feature or idea of the research documents (one per table row), by state, with the test proposed, cost, risk and interest; « Ce qu'on doit tester » underneath. |
| `/reference rd [refresh\|audit]` | R&D: index of the research folders (date, subject, 3-line summary, sources, idea states, Ouvrir), with **Exporter vers eta** and **Exporter pour audit**. `audit` runs the audit export at once. |
| `/reference repos [refresh]` | Repos: « Mes repos » cards (branch, behind/ahead, last commit, open PRs) with **Mettre à jour**, **Exporter**, **Ouvrir sur GitHub**, **Dossier**. `refresh` asks gh again. |
| `/audit-export` | Exporter pour audit (registered only when no loaded mod has that name): writes the dated zip and prints its path and counts. |
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

## À essayer, R&D, Repos, Exporter pour audit

The hooks module cannot read folders or run git, so these tabs run `scanner/rd_scan.mjs` (Node) with the merged config on stdin and draw its JSON answer (pure parts in `lib/rd/`, drawing in `hooks/rd_draw.tsx`).

| Tab / button | Reads | Writes (on click only) |
|---|---|---|
| **À essayer** | Markdown tables of `essais.sources` (default: claude-control's `docs/v6-research`, files `features-a-essayer`, `jev-et-galerie`, `veille-web-*`, `data-goblin-idees`). A table counts when it has a name column and a test, interest or « on l'utilise ? » column (header names in `essais.columns`). Default state from `essais.state_rules` (« oui » → adopté, « partiel » → en test, « non par choix » / « ne pas tester » → écarté, else jamais), then `presets`, then Julian's choice. Cost and risk: the column, else the words matching `essais.infer`. `essais.extra` adds items no table has (shipped: JEV, écarté, `/advisor` instead). « Ce qu'on doit tester »: open lines of `manual-checks.md` and tests-reels procedures never run / open manual checks. | The state button cycles jamais → en test → adopté → écarté and writes `~/.claude/reference-mod/essais.json`. |
| **R&D** | `rd.dirs` (claude-control `docs/v6-research`, `docs/audits`, `~/.claude/effort-board/audits`): date (file name, title, else mtime), subject (first heading or `<title>`), `summary_lines` lines, links, and the À essayer states of the ideas from that document. | **Ouvrir** opens the file (`open_command`, default explorer / xdg-open). **Exporter vers eta**: the documents, masked, into the eta repo under `rd.eta.dest_dir` with an `INDEX.md`, by PR, with export-eta's git flow (`lib/eta/`, synced copy) and its `eta.repo` from `~/.claude/export-eta/config.json`. |
| **Repos** | `repos` (claude-control, claude-mod, datapass-claude-eta by default; the folders in `repo_paths`, kept in `~/.claude/reference-mod/reference.config.json`, `@self` = this repo): `git branch`, `rev-list HEAD...@{u}` (no fetch), `log -1`, `status`, and `gh pr list` cached `repos_prs_ttl_min` minutes. | **Mettre à jour**: `git pull --ff-only` only on the main checkout, on its `main` branch and clean, then `post_update` in the repo (claude-control: `python tools/deploy.py`). **Exporter**: `export: audit` the audit zip, `eta` the R&D export. **Ouvrir sur GitHub** is a link, **Dossier** opens the folder. |
| **Exporter pour audit** (R&D, Repos, `/audit-export`) | Every mod beside this one (tracked files, `MANIFEST.md` with version, commit and loaded state), `~/.claude/*.config.json` and the `config.json` / `*.config.json` of `audit.config_dirs`, `CLAUDE_CODE_PLUGIN_DIRS`, settings `env` (secret-looking keys replaced), `CLAUDE.md`, agents, skills, workflows, `RULES-INVENTORY.md`, Veille `state.json` / `config.json` / `heartbeat.json`. | `~/.claude/audit-exports/audit-<date>-<time>.zip`. Every file is masked with export-eta's rules then checked again: a secret left holds the file back (named in the manifest). Never smtp.json, `.credentials.json`, token files, transcripts (`*.jsonl`, `projects/`) or raw data folders; `audit.deny` adds patterns. |

## Appliquer ce scénario

The button under each scenario writes the chosen per-role model and effort, plus the env defaults it implies, to `~/.claude/scenarios/applied.json` (the previous one is kept as `applied.prev.json`). The tab then shows, role by role, the current value next to the applied one: the lead against `~/.claude/settings.json` (`model`, `effortLevel`), each subagent or Workflow role against the frontmatter of `~/.claude/agents/<agent>.md`, and `CLAUDE_CODE_SUBAGENT_MODEL` / `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` against settings `env`. **It never edits settings.json, an agent file or the environment**: the record is a note, the diff says what to change by hand.

## Settings

`reference.config.json`: tab order (`tabs`), `start_tab`, `python` / `node`, paths (`claude_dir`, `control_out_dir`, `sante_data_dir`, `scenarios_file`, `ci_pipelines_cache`, `reference_dir`), `sante_refresh_min`, `repos` / `repo_paths` / `repos_prs_ttl_min`, `open_command`, `essais`, `rd`, `audit`, and every label (pane title, tab names, states, sections, buttons). `~/.claude/reference-mod/reference.config.json` is deep-merged on top, and userConfig `config` names another override file.

## Load it

Add `<repo>/mods/reference` to `CLAUDE_CODE_PLUGIN_DIRS` (or `claude --plugin-dir mods/reference`). The owner mods (control, guide, scenarios, sante, ci) can stay loaded until they are removed: their commands then answer, and this pane shows the same views.

## Tests

```sh
node scripts/sync-libs.mjs --check
node --test mods/reference/tests/*.test.mjs   # nav + rd (À essayer, R&D, Repos, audit zip on an invented home)
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/reference
claude plugin validate mods/reference
```

All test data is invented.
