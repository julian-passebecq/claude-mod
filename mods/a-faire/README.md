# a-faire (« À toi »)

« À toi », one entry of the Mods bar: every action only Julian can do, by category (Configuration, Décisions,
Connexions / 2FA, Secrets à ranger, Tests manuels, Questions des conversations), each with why it blocks, the exact
steps (**Copier**), since when, its source, **Fait** and **Plus tard**. Read-only except its own `~/.claude/a-faire`.

**Claude Control** (category `claude_control`): Julian's own list in `~/.claude/a-faire/claude-control.md` (`sources.claude_control.file`; empty = that file in the a-faire home), one line per task `- [ ] échéance · priorité · quoi · pourquoi · comment` (échéance `YYYY-MM-DD` or `—`, priorité haute / moyenne / basse mapped by `sources.claude_control.prios`; `[x]` or struck = done). Sorted by deadline first (« échéance 2026-11-05 (J-19) »), then priority.

Commands: `/afaire [refresh | close]`, and `/a-toi` (same) registered only when the session has no `/a-toi` yet
(checked with `$.command.list()` 2 s after the session starts).

## summary.json (stable shape)

The scanner writes `~/.claude/a-faire/summary.json`, counts only (no title, no text):

| Key | Meaning |
|---|---|
| `total` | open items: the « À toi : N » counter |
| `high` | open items that block a conversation (priority `now`) |
| `updatedAt` | when the scanner wrote it (ms) |
| `open`, `at` | the same as `total` and `updatedAt`, kept for older readers (`lib/core/veille.mjs` `aToi()` reads `open`, the band too) |
| `v`, `by_cat`, `by_prio`, `snoozed`, `errors` | detail: version 2, counts per category and priority, snoozed count, unread sources count |

## Mods installed but not loaded

`lib/mods-check.mjs` lists the mod folders with `lib/core/mods.mjs` (`listMods`) and compares them with
`CLAUDE_CODE_PLUGIN_DIRS` (`splitDirs`, `loadedState`), the same reader as Santé, Ménage and the Guide. A mod also counts
as loaded when a listed folder has its name. Node only: the hooks module never imports it.

## Health record

`scanner/afaire_scan.mjs scan` writes `~/.claude/mods-health/a-faire.json` through `lib/core/health.mjs`.

Tests: `node --test mods/a-faire/tests/*.test.mjs`, `claude plugin test mods/a-faire`.
