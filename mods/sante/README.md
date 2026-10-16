# sante — Santé des mods

**Now also inside Référence** (`mods/reference`, tab Santé, `/reference sante`): same drawing (`hooks/draw.tsx`) and the same scanner, both synced there. `/sante` keeps working while this mod is loaded; once it is unloaded, Référence answers it.

`/sante [refresh] | close`: a read-only self-check of every mod, in French. One line on top, green / orange / red:

```
● vert · 10 mods actifs : 10 OK, 0 orange, 0 rouge · 2 non chargés · Claude Code 2.1.293
```

Then one block per mod loaded through `CLAUDE_CODE_PLUGIN_DIRS` (or registering commands in this session), and a short list of mods found but not loaded:

- **loaded or not**: a mod is « chargé » when at least one of its slash commands is in this session (`$.command.list()`, matched on `plugin`, [api](https://code.claude.com/docs/en/plugins/mods/api)); a folder in `CLAUDE_CODE_PLUGIN_DIRS` whose commands are missing is orange (session opened before the folder was added, or its `session.start` hook failed: `claude --debug` says which).
- **version** (its `plugin.json`), **commands** registered vs the ones its hooks module registers (`$.command.register({ name })` read from `hooks/*`).
- **last refresh**: the newest change among its cache files and folders, or its health record's `lastOk`; `stale_min` per mod turns it orange.
- **errors**: a health record's `error` (red while younger than `health_error_hours`), error lines in the logs named in the config, and error lists inside its outputs (`error_fields`, e.g. `metrics.json` → `meta.errors`).
- **scan duration and approximate CPU**: from health records (below): last run, its duration and CPU, and over the last 24 h the runs, runs per hour and CPU time as a share of one core.
- **cache size on disk** (sum of file sizes, capped at `size_max_files`); above `cache_warn_mb` it is orange and the pane shows a cleanup command with a **Copier** button. The mod never runs it: Julian or an agent does.
- **config files**: `plugin.json`, `hooks/hooks.json`, every JSON at the mod's root (except names matching `skip_json`) and the user config files listed per mod; invalid JSON is red with the parser's message.
- **Claude Code version vs the mod's minimum**: `$.session.version()` against `min_version` per mod, else `default_min_version` (2.1.287, the minimum for function-hook mods, [overview](https://code.claude.com/docs/en/plugins/mods/overview)). `plugin.json` has no documented minimum-version field; a `claudeCode.minVersion` or `engines["claude-code"]` entry is read if a mod declares one (non vérifié: not in the docs).

Also listed: mod folders under `extra_dirs` (default `~/.claude/mods`) and beside this mod, plugins in `installed_plugins_file` (`~/.claude/plugins/installed_plugins.json`; name and format non vérifié), and health records whose mod is not found.

## How it runs

- `/sante` opens the pane and returns no text: nothing reaches the model. When the last report is older than `refresh_min` (10 min) or with `refresh`, `scanner/sante_scan.mjs` (Node 22.18+, standard library) runs in the background through `$.process.run` with the folder list on stdin; ↻ in the pane runs it again. Nothing runs while the pane is not asked for.
- The scanner only reads, except its own report (`~/.claude/sante-mod/report.json`) and its own health record (`~/.claude/mods-health/sante.json`). It never deletes anything.
- The folder lists come from `lib/core/mods.mjs` (`splitDirs`, `listMods`; a folder whose `plugin.json` does not parse is kept, to show red), the health record from `lib/core/health.mjs`.
- **Findings for the Problèmes register**: the hook sends the session's commands and Claude Code version with the request, the scanner runs the same `evaluate()` as the pane and adds every red and orange line to its health record as `findings: [{ level: "error" | "warn", mod, text }]` (at most 200). `error` stays the scanner's own failure, so sante does not flag itself.
- From a shell: `node mods/sante/scanner/sante_scan.mjs` (folders from `CLAUDE_CODE_PLUGIN_DIRS`, or `--dirs "a;b"`) prints the same report as JSON.
- Everything is in `sante.config.json`: paths, per-mod caches / configs / logs / error fields / `stale_min` / `min_version`, thresholds, the cleanup command template, colours, icons and labels. `~/.claude/sante-mod/sante.config.json` is deep-merged on top, and userConfig `config` names another override file.

## Shared convention: `~/.claude/mods-health/<mod>.json`

Any mod with a scanner can tell `sante` how its runs go by writing one small JSON file after each run, best effort (a failure to write must never break the scan):

```json
{
  "mod": "usage",
  "lastRun": "2026-10-16T12:00:00.000Z",
  "durationMs": 840,
  "cpuMs": 610,
  "error": null,
  "lastOk": "2026-10-16T12:00:00.000Z",
  "window": { "start": "2026-10-16T08:00:00.000Z", "runs": 48, "cpuMs": 29000, "durationMs": 40000, "errors": 0 }
}
```

- `lastRun`: ISO time of this run. `durationMs`: the scanner process's wall time (Node `process.uptime()`, Python since import). `cpuMs`: its CPU time (user + system; Node `process.cpuUsage()`, Python `time.process_time()`).
- `error`: `null`, or a short message (≤ 500 characters) when the run failed. `lastOk`: the last run without error (kept from the previous record on failure).
- `window`: totals since `start`, reset once `start` is 24 h old; `sante` divides `window.cpuMs` by the elapsed time for « ≈ x % d'un cœur ».
- Write to `<file>.<pid>.tmp`, then rename. `MODS_HEALTH_DIR` moves the folder (tests); `MODS_HEALTH=0` turns writing off.
- Reference code: `writeHealth()` in `lib/core/health.mjs` (repo root; copies in each mod's `lib/core`), `nextHealth()` in `hooks/logic.mjs` (same rule, pure), and `write_health()` in `mods/ci/scanner/ci.py` and `mods/machine/scanner/machine.py` (Python). Mods without a scanner (`scenarios`, `guide`) have nothing to report.
- Optional `findings` (sante writes it): the red and orange lines of a check, for the Problèmes register.

Who writes it today: `band`, `usage`, `metrics`, `ci`, `machine`. Not yet `factory` and `control` (to add when those mods are next changed).

## Tests

```sh
node --test mods/sante/tests/*.test.mjs
claude plugin test mods/sante
claude plugin validate mods/sante
```

Non vérifié: that `$.command.list()` names the plugin of every mod command (`plugin` is optional in the types; without it a command counts for the mod whose hooks register that name); the format of `installed_plugins.json`; CPU figures for mods whose scanner is a long-lived process (none here).
