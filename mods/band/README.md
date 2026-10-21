# band — « Jauge »

Read-only band above the prompt, and `/jauge` for the detail pane. UI in French. Settings: `band.config.json` (your own JSON via the mod's userConfig `config`, deep-merged).

## La ligne

One line fitted to the band's width: `● N t'attendent │ contexte N % │ 5 h N % · sem N % │ N tok/s tout`, then the five buttons (Usage · Règles · Réf · Cockpit · Exporter). Past the hand-off threshold, « relais conseillé » and a **RESUME** button join the line.

## En cours (cette conversation)

Only while something runs in **this** conversation, rows appear under the line and above the buttons (none when idle, so the Jauge stays one line):

```
◇ cockpit-preview-g2 · ▸ Preview release 1/2 · 2 agents opus · 47 min · fin ~01:58
   • coder p43-rag-identity · opus · 47 min    • coder p44-migration · opus · 47 min
◦ agent d'arrière-plan · auditor · sonnet · 3 min
```

- One row per running Workflow: name, current phase `i/n`, running agents and their model, elapsed time, and `fin ~HH:MM` when this PC has at least `min_samples` past completed runs of the same Workflow (median, `lib/core/estimate.mjs`).
- One indented row of its running agents (`agent_lines` rows, then `+N`).
- One row per Agent-tool agent outside Workflows: `◦` background, `•` foreground (the current turn's subagents).
- Bullet colour: green running, amber when nothing was written for `stall_min` (30) minutes, red failed (kept `failed_keep_min`). Type words are grey. Same bullets as the cockpit.
- At most `jauge.en_cours_rows` rows (default 5, 0 = off), then « +N de plus · Cockpit › ».

Source: `scanner/encours.mjs`, a thin wrapper over `lib/core/running.mjs` (this mod's synced copy of the repo's `lib/core`, same file rules as factory's `workflow_scan.py`): the conversation's `subagents/workflows/<runId>/journal.jsonl`, `agent-<id>.meta.json`, the Workflow script's `meta`, and the run record written when a run ends. Only files whose size or mtime changed are re-read, transcripts from the last offset. It runs every `refresh_s` (≥ 5 s) while something runs; when idle the band only stats the conversation's folders and starts it when they change or after `idle_poll_s`. Settings: `jauge.en_cours_rows` and `jauge.en_cours` in `band.config.json`.

## Tests

`node --test mods/band/tests/*.test.mjs` (invented fixtures in a temp folder) and `claude plugin test mods/band`.
