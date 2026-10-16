# registres (« Registres »)

One side pane with four tabs: **Problèmes | Tests réels | Règles | Ménage**. It replaces four separate panes in the band's Mods bar; each tab shows exactly what its owner mod shows (`problemes`, `tests-reels`, `metrics`, `menage`), from the same files in `~/.claude`.

## Commands

| Command | What it does |
|---|---|
| `/registres` | opens the pane on the last tab (first time: `default_tab`, Problèmes) |
| `/registres problemes [refresh [--force] \| P-NNN \| export]` | Problèmes tab, with the owner's arguments (`P-012` opens that problem) |
| `/registres tests` | Tests réels tab |
| `/registres regles [V5.8] [refresh]` | Règles tab (« Les règles marchent ? ») |
| `/registres menage [refresh]` | Ménage tab |
| `/registres close` | closes the pane |
| `/problemes`, `/tests`, `/regles`, `/menage` | aliases of the lines above, registered by Registres **only when no other mod serves that name in this session**: while the old mods are loaded they keep their own commands and panes, so habits don't break either way |

The command returns no text, so nothing reaches the model. No model call. Nothing blocks, rewrites or delays a tool call or a prompt.

## How it works

A mod cannot draw in another mod's pane nor import a file outside its folder. So each owner keeps its drawing in a pure module (no `$`: element table, facts, callbacks in, tree out) and Registres draws its tabs with byte-for-byte copies of them:

| Tab | Owner | Copied into `lib/` (never edit a copy) |
|---|---|---|
| Problèmes | `mods/problemes` | `hooks/view.mjs`, `lib/core.mjs`, `lib/export.mjs`, `lib/eta/*` (from export-eta), `scanner/problemes_scan.mjs`, `problemes.config.json` |
| Tests réels | `mods/tests-reels` | `hooks/view.mjs`, `lib/registry.mjs`, `lib/secrets.mjs`, `lib/recover.mjs`, `lib/io.mjs`, `scanner/recover.mjs`, `tests-reels.config.json` |
| Règles | `mods/metrics` | `hooks/pane.mjs`, `hooks/view.mjs`, `lib/collect.mjs`, `scanner/metrics_scan.mjs`, `metrics.config.json` (+ `lib/usage/lib/transcripts.mjs`, `prices.json` from `lib/core`) |
| Ménage | `mods/menage` | `hooks/view.mjs`, `lib/classify.mjs`, `scanner/menage_scan.mjs`, `scanner/sizes.ps1`, `menage.config.json` |

The pairs are listed in `lib/core/targets.json`; `node scripts/sync-libs.mjs` writes them and `node scripts/sync-libs.mjs --check` (CI) fails when a copy drifts. Change the owner, run the sync, commit both.

- **Data**: the owners' own folders (`~/.claude/problemes`, `~/.claude/tests-reels`, `~/.claude/metrics-mod`, `~/.claude/menage-mod`) and their override files there. Registres writes nothing of its own.
- **Scanners**: the owner's scanner (the copy in `lib/<owner>/scanner/`) runs in the background only on ↻ (or « Lancer la récupération » for Tests réels) or when the tab's file is older than the owner's `refresh_min` (on opening or switching to that tab). It writes only into the owner's data folder, as the owner would.
- **Secrets** (Tests réels): logins masked until « voir » is pressed one by one; secret values are never stored, read or shown, only where they live.
- **Santé and Veille errors** reach the Problèmes tab through the problemes collector (category Mods, source santé / veille).

## Settings

`registres.config.json`, deep-merged with `~/.claude/registres/registres.config.json`: `tabs` (order), `hidden_tabs`, `default_tab`, `aliases`, `alias_delay_ms`, `labels` (pane title, tab names, hint, notes). Each tab's own labels, colors and limits stay in its owner's config.

## Tests

```
node --test mods/registres/tests/*.test.mjs
claude plugin validate mods/registres
claude plugin test mods/registres
```

Invented problems, apps, accounts and folders only.
