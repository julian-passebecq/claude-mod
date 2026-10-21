# band — « Jauge »

Read-only band above the prompt, and `/jauge` for the detail pane. UI in French. Settings: `band.config.json` (your own JSON via the mod's userConfig `config`, deep-merged).

## La ligne

One line when it fits the band's width, else two rows, then the five buttons (Usage · Règles · Réf · Cockpit · Exporter):

```
▶ 1 conv · 0 wf · 0 ag · 0 CI │ ◆ 2 │ ctx ▰▰▱▱▱ 19 % │ 5 h ▱▱▱▱▱ 0 % │ sem ▰▰▰▰▱ 74 % │ 4.4k tok/s
✓ au repos │ ctx ▰▱▱▱▱ 19 % │ 5 h ▱▱▱▱▱ 0 % │ sem ▰▰▱▱▱ 41 % │ 380 tok/s
```

- Activity status first (field `activity`, Julian 21 Oct: « how do I know no work is in process? »), for the whole PC, counted by `lib/core/busy.mjs` in the scanner:
  - `conv`: conversations whose **main thread** has a turn in progress (last user/assistant entry not a final answer, written within `jauge.activity.busy_s`, 120 s); this conversation also counts while the engine says it is working (`isWorking`).
  - `wf` / `ag`: Workflows and agents (Workflow agents, Agent-tool agents foreground or background) that wrote within `sections.running_s`; this conversation's own « en cours » data raises them and colours them (amber stalled, red failed).
  - `CI`: running or queued pipelines in the ci mod's cache (`jauge.activity.ci_cache`, `~/.claude/ci-pipelines-cache.json`, GitHub Actions + GitLab), red when a run failed within `ci_stale_min`. A cache older than `ci_stale_min` (15) minutes, or missing, shows a grey `CI ?`, never `0 CI`. `ci_cache: ""` turns CI off.
  - Zeros grey, non-zero green. Nothing runs: one green `✓ au repos` instead (with `CI ?` when the CI cannot be read). Never dropped when narrow.
- `◆ N`: conversations waiting on you (Veille alerts marked julian), amber, hidden at 0.
- Context, 5 h and semaine carry a mini bar: `▰▱` (5 cells, `jauge.bar_cells`) in the terminal, a thin Svg bar on the desktop.
- Traffic light on the bar and the % (the label words stay grey), thresholds in `jauge.levels`:

| Figure | Green | Orange | Red |
|---|---|---|---|
| ctx | < 50 % | 50 % to the relay | ≥ the relay (`context.handoff_tokens`, 250 K, as a % of the effective window) |
| 5 h, semaine | < 60 % | 60–85 %, or projected 90–100 % at reset | ≥ 85 %, or projected > 100 % at reset |

  The projection is the usage mod's samples' pace (`lib/core/usage.mjs` `runOut`) carried to the window's reset, worked out in `scanner/scan.mjs` (`claude.fiveProj` / `weekProj`); without samples only the % counts.
- **A field is never cut** (Julian, 22 Oct, narrow chat column: « ▶ 7 c… .1… .3… » was unreadable). Each field (`▶ 7 conv`, `1 wf`, `3 ag`, `CI ?`, `ctx ▰▰▰▱▱ 63 %`, `5 h ▱▱▱▱▱ 2 %`, `sem ▰▰▰▰▱ 77 %`, `2.1k tok/s`) is drawn as one block that never shrinks. Too wide for one row (full labels, then short ones):
  1. it **wraps** before `jauge.wrap_at` (`context`): row 1 the status counts, row 2 ctx · 5 h · sem · tok/s, each row with full labels, else short ones;
  2. only then whole fields of `jauge.drop_order` are left out one by one: `tps_all`, `five`, `act_ci`, `act_ag`, `act_wf` (conv, ctx and sem stay).
  If the engine's width is off (a desktop font wider than its cells), the row moves whole fields to the next row; it never truncates one.

```
50 colonnes, past the relay:
▶ 7 conv · 1 wf · 3 ag · CI ? ● [ RESUME ]
ctx ▰▰▰▱▱ 63 % │ 5 h ▱▱▱▱▱ 2 % │ sem ▰▰▰▰▱ 77 %
```

- Past the hand-off threshold, on row 1: a red chip « relais conseillé » (`labels.relay_hint`) next to a **RESUME** button; narrower a red `●` (`labels.relay_mark`, no words) before RESUME; narrowest RESUME alone.

## En cours (cette conversation)

Only while something runs in **this** conversation, rows appear under the line and above the buttons (none when idle, so the Jauge stays one line):

```
◇ cockpit-preview-g2 ▰▰▰▱▱ 3/5 · ▸ Verify · 2 agents opus · 47 min · fin ~01:58
   • coder p43-rag-identity · opus · 47 min    • coder p44-migration · opus · 47 min
◦ agent d'arrière-plan · auditor · sonnet · 3 min
```

- One row per running Workflow: name, a mini bar of phases done/total (else agents done/total), the current phase, running agents and their model, elapsed time, and `fin ~HH:MM` when this PC has at least `min_samples` past completed runs of the same Workflow (median, `lib/core/estimate.mjs`).
- One indented row of its running agents (`agent_lines` rows, then `+N`).
- One row per Agent-tool agent outside Workflows: `◦` background, `•` foreground (the current turn's subagents).
- Bullet and bar colour: green while it writes, orange after `warn_min` (15) minutes without a write, red after `bad_min` (30) or failed (kept `failed_keep_min`). Type words are grey. Same bullets as the cockpit.
- A row wider than the band cuts the names first (`datapass-facto…`), then the phase name, then leaves out `fin ~HH:MM`, then the agents and models (`fin` comes back when it then fits). The bullet, bar, count, elapsed time and state are kept; tested at 60 and 90 columns.
- At most `jauge.en_cours_rows` rows (default 5, 0 = off), then « +N de plus · Cockpit › ».

Source: `scanner/encours.mjs`, a thin wrapper over `lib/core/running.mjs` (this mod's synced copy of the repo's `lib/core`, same file rules as factory's `workflow_scan.py`): the conversation's `subagents/workflows/<runId>/journal.jsonl`, `agent-<id>.meta.json`, the Workflow script's `meta`, and the run record written when a run ends. Only files whose size or mtime changed are re-read, transcripts from the last offset. It runs every `refresh_s` (≥ 5 s) while something runs; when idle the band only stats the conversation's folders and starts it when they change or after `idle_poll_s`. Settings: `jauge.en_cours_rows` and `jauge.en_cours` in `band.config.json`.

## Preview

`node mods/band/scripts/preview.mjs --cols 40,50,60,80` (or bare widths: `60 90`) prints the Jauge as the terminal draws it (ANSI colours; `--plain` without) for an idle (`✓ au repos`), a busy-with-stale-CI (`CI ?`), a running and a busy-past-the-relay conversation (7 conv · 1 wf · 3 ag, ctx 63 %) at each width given (default 80), with each row's width. Invented fixtures.

## Tests

`node --test mods/band/tests/*.test.mjs` (invented fixtures in a temp folder) and `claude plugin test mods/band`.
