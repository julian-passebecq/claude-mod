# export-eta

Exports Claude Code conversations to the eta repo as masked Markdown through a PR, with no model call.
`/export-eta [en-cours | lot | close]` (and `/export` when the built-in leaves it free) opens its pane: **Lot terminé**,
**En cours**, **Sélection**, **Exports**.

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

`exporter/` (the script), `lib/` (masking, layout, render, eta git flow; `lib/core/` synced copies, never edited by hand),
`hooks/` (pane), `export-eta.config.json`. The eta path lives in `~/.claude/export-eta/config.json`, never in this repo.
Tests: `node --test mods/export-eta/tests/*.test.mjs`, `claude plugin test mods/export-eta`.
