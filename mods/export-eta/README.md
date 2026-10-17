# export-eta

**Now shown inside Veille** (tab Export eta, button « Exporter vers eta », `/veille export`); `/export-eta` keeps working (this mod while loaded, else Veille's alias).

Exports Claude Code conversations to the eta repo as masked Markdown through a PR, with no model call.
`/export-eta [en-cours | lot | close]` (and `/export` when the built-in leaves it free) opens its pane: **Lot terminé**,
**En cours**, **Sélection**, **Exports**.

## Exporter tout (/export-tout)

`/export-tout` (or `/export-eta tout`) is the one-click export Julian asked for on 17 Oct: no pane, no token, a toast
when it is done: « Exporté : N fichiers, PR #x mergée ». It writes a dated snapshot into the eta repo under
`sources/claude-control/snapshots/<YYYY-MM-DD-HHMM>/` and lands it with the conversations through one merged PR
(same git flow, same masking and final confidentiality check as the other exports):

| File | From |
|---|---|
| `INDEX.md` | written for an AI analyst: what each file is, how to read it, what to look for, held-back files |
| `status/sessions.md` + `.json` | the desktop app's sessions: state, model, effort, branch, PRs, parent, end-of-turn summary |
| `status/workflows.md` | `~/.claude/projects/*/*/subagents/workflows/*/journal.jsonl`: every agent, phase, done / failed / running |
| `status/ci.md` | the ci mod's cache: today and week, runner queue, running pipelines with an ETA (lib/core/estimate), failures |
| `status/usage.md` | usage mod: top conversations / projects / models over 24 h and 7 days, tok/s, quotas (lib/core/usage) |
| `problemes.md` + `.json` | the Problèmes register: every open problem, fixed this week |
| `veille.md` | veille heartbeat, open alerts, the Fil (conversations waiting), night summary (PRs merged since) |
| `a-faire.md` | À faire items with why and steps |
| `outputs/` | mods-health, latest audits, manual-checks, the tail of questions.md, tests-reels counts (never accounts or URLs) |
| `rules/` | global CLAUDE.md, `tout.rules_files` (e.g. RULES-INVENTORY.md), settings env (secret-looking values masked), mods loaded with versions |
| `conversations.md` | the conversations exported with it (ongoing, finished since the last export) in `sources/conversations/` |

Never read, whatever the config says: `smtp.json`, `.credentials.json`, `auth.json`, `.netrc`, keys (`lib/snapshot.mjs`
`forbidden()`). A file still holding a secret after masking is held back and listed in INDEX.md. Settings: the `tout`
block of `export-eta.config.json` (override in `~/.claude/export-eta/config.json`); labels `tout_*`. The jauge's Export
button runs `/export-tout`.

## In the Veille hub

The finished batch is also the **Export eta** tab of the Veille pane (`/veille export`). That tab reads this mod's
`~/.claude/export-eta/pending.json` and `state.json` and its button runs this mod's exporter
(`exporter/export.mjs run --mode batch`): one code path. When this mod is not loaded, veille registers `/export-eta` as an
alias of its tab, so the command keeps working; while it is loaded, this mod serves `/export-eta` itself.

## Health record

`exporter/export.mjs list | pending | run` (not `--dry-run`) writes `~/.claude/mods-health/export-eta.json` through
`lib/core/health.mjs`: `error` null when the command succeeded, else `<command>_failed: <last line>`, with credentials in
URLs and token-like words masked (`healthText`). Santé and the Problèmes register read it.

## Files

`exporter/` (the script; `tout.mjs` for Exporter tout), `lib/` (masking, layout, render, eta git flow, `snapshot.mjs` sections; `lib/core/` synced copies, never edited by hand),
`hooks/` (pane), `export-eta.config.json`. The eta path lives in `~/.claude/export-eta/config.json`, never in this repo.
Tests: `node --test mods/export-eta/tests/*.test.mjs` (tout.test.mjs: snapshot on invented fixtures and a temp fake eta repo), `claude plugin test mods/export-eta`.
