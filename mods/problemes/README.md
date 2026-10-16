# problemes (« Problèmes »)

**Now shown inside Registres** (tab Problèmes, `/registres problemes`) and Cockpit's « Problèmes du jour » card; `/problemes` keeps working (this mod while loaded, else Registres' alias).

Julian's persistent register of every error and problem with Claude work: questions to Julian, end-of-turn waits, permission refusals, worktree and app guards, failed Workflows and CI, API errors, and the errors of the mods themselves (Santé and Veille). Problems are grouped by category and by application, deduped by signature, with symptom, cause, fix, evidence, timeline and notes.

**Now also a tab of Registres**: `/registres problemes` (or `/problemes` when this mod is not loaded) shows the same register in the Registres pane, drawn by a copy of `hooks/view.mjs`. This mod keeps working on its own while it is loaded.

## Commands

- `/problemes [refresh [--force] | P-NNN | export] | close`: the pane; `P-012` opens that problem; `export` (and the « Exporter vers eta » button) sends the masked register to the eta repo by PR.
- From a shell: `node mods/problemes/scanner/problemes_scan.mjs collect | fold | import | note P-NNN "…" | set P-NNN status corrigé --fix "…" | export`.

## Data and collection

`~/.claude/problemes/`: `register.jsonl` (append-only ledger), `problems.json` (snapshot the pane reads), `cursor.json`, and your overrides in `problemes.config.json`. The collector reads only new transcript bytes and the app's session files, with no tokens. It also reads:

- `~/.claude/mods-health/*.json` (the shared health records, `veille.json` and `sante.json` included): a record whose last run failed becomes a hit, once per failed run; `veille.json` is source **veille**, the others source **santé**;
- Santé's report (`~/.claude/sante-mod/report.json`): plugin.json, hooks.json or config files that do not load, error lines in logs, errors listed in output files, once per message.

- the « Pièges » sections of claude-control's `docs/v6-research/veille-web-*.md` (shipped source `seed.builtin.veille-web`, read from `main` by git in the first `collect.roots` folder that holds `claude-control`; run by `import`): each pitfall goes to **Quota et limites** (sous-agents, Projects, limites), **Workflow › Succès rapporté à tort** or **App › Écarts de version**, titled « non confirmé · … » when the doc says so; the same line in two weekly files is imported once. `enabled: false` or another `git.repo` in your override changes it.

Health records and Santé's report are classified by the `mod-error` rule under **Mods**, one problem per mod and normalised message (`collect.health`, `health_dir`, `sante_report` in the config; `MODS_HEALTH_DIR` moves the folder).

## Code layout

- `lib/core.mjs`: detection, classification, ledger fold, seeds, view helpers (pure).
- `hooks/view.mjs`: the pane's drawing, pure (element table in, tree out); also copied into `mods/registres`.
- `hooks/register.tsx`: reads the files, runs the scanner, hands the facts to the view.

## Tests

```
node --test mods/problemes/tests/*.test.mjs
claude plugin validate mods/problemes
claude plugin test mods/problemes
```
