# menage (« Ménage »)

Read-only inventory of what Claude work leaves lying on this PC: worktrees (branch, merged or not, clean or modified, age, size), orphan worktree folders, local and remote branches already merged, mod copies, deploy backups, transcripts per project, temporary folders, archivable sessions. Each row shows the exact safe command to run; the mod never runs it and never deletes anything. Rows in red are « ne pas supprimer ».

**Now also a tab of Registres**: `/registres menage` (or `/menage` when this mod is not loaded) shows the same inventory in the Registres pane, drawn by a copy of `hooks/view.mjs`. This mod keeps working on its own while it is loaded.

## Commands

- `/menage [refresh] | close`: the pane. Buttons: filters (Tout, Récupérable, Ne pas supprimer), ↻, « Tout copier » and « Copier » per section or row (copies the commands, runs nothing).

## How it runs

`scanner/menage_scan.mjs scan` (Node, read-only git commands, folder sizes through `scanner/sizes.ps1` on Windows) runs in the background when `~/.claude/menage-mod/menage.json` is older than `refresh_min` or on ↻. Settings: `menage.config.json`, deep-merged with `~/.claude/menage-mod/menage.config.json`.

## Code layout

- `lib/classify.mjs`: levels, filters, commands (pure).
- `hooks/view.mjs`: the pane's drawing, pure (element table in, tree out); also copied into `mods/registres`.
- `hooks/register.tsx`: reads the files, runs the scanner, hands the facts to the view.

## Tests

```
node --test mods/menage/tests/*.test.mjs
claude plugin validate mods/menage
claude plugin test mods/menage
```
