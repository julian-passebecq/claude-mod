# veille

« Veille », one entry of the Mods bar: **one pane, four tabs**. Read-only, no model call, nothing added to a prompt.

| Tab | Command | What it shows | Reads |
|---|---|---|---|
| Alertes | `/veille` or `/veille alertes` | the watcher's mode and its buttons, alerts (severity, since when, link, **Ack**), last tour (red when two fires were missed), actions with their reason | `~/.claude/veille/state.json`, `heartbeat.json`, `acks.jsonl` |
| Fil | `/veille fil` | every conversation's last message, by project, lead → sub-conversations | `~/.claude/veille/fil.json` |
| À archiver | `/veille archiver` | finished conversations the VEILLE conversation may archive in one batch, « Copier la liste des ids »; the command also prints the list | `~/.claude/veille/archive.json` |
| Export eta | `/veille export` | export-eta's finished batch, why it is ready, its conversations, **Exporter vers eta**, the last exports | `~/.claude/export-eta/pending.json`, `state.json` |

`/veille close` closes the pane. `/veille mode <x>`, `/veille ack <clé|all>`, `/veille coordinateur`, `/veille tour`,
`/veille nuit`, `/veille jour` run the watcher's own commands.

## Night and day

`/veille nuit` (or the « Nuit » button of the Alertes tab) sets the mode `night.mode` (nuit-active) and records
`night_started` in `~/.claude/veille/config.json`. `/veille jour` (« Jour ») sets `night.day_mode` (légère) and writes
the night summary to `~/.claude/veille/night-summary.json` from `events.jsonl`: merges, failures, what waited on Julian
(once per alert), wakes, since the night started (else the last `fallback_h` hours). The command answers with it and
the Alertes tab shows it for `show_h` hours. The Cockpit's « Bilan avant la nuit » screen can read the same files.

## Safe wake

Never `claude -p --resume` (16 Oct 22:45: it turned effort low into medium and acceptEdits into bypass). A wake starts
a **fresh** `claude -p` with `--model`, `--effort` and `--permission-mode` read from the target's session file
(`%APPDATA%/Claude/claude-code-sessions/**/local_*.json`, `wake.sessions_dir` moves it), in the target's folder, with
the ≤ 10-line brief and `CLAUDE_CODE_SUBAGENT_MODEL` set to the same model (16 Oct: `--model haiku` with that variable
set to Sonnet ran on Sonnet). Missing or unknown settings: no wake. Its stream-json output goes to
`~/.claude/veille/wakes/`; every fire reads the result and checks, in the new session's transcript, the model, effort
and permission mode it really ran with (`wakes.json`, shown at the top of the Fil: conforme / écart / erreur). A gap
is a `wake_failed` (health record, so Problèmes). `node watcher/veille.mjs wake-test [--model m --effort e
--permission-mode p]` runs the same wake on a throwaway target and exits 0 only when all three match; it passed on
16 Oct (haiku low plan, haiku low acceptEdits, sonnet medium acceptEdits), so `wake.enabled` is true. Wakes still
happen only in the modes that list `wake` (active, nuit-active), within their token budget.

## Deadlines and vendored mods

Each tour reads `deadlines.file` (`~/.claude/a-faire/claude-control.md`): an open line
`- [ ] YYYY-MM-DD · prio · quoi · …` due within 7 days is an alert (J-7), within 1 day a new alert (J-1, notifies
again); overdue stays at J-1. Every `vendor_check.every_days` (7) the tour compares each vendored mod's plugin.json
version (repo checkout recorded by `veille install`) with its upstream latest release (`gh api`, read only); a newer
release is an info alert until the copy is updated.

## Export eta tab

« Exporter vers eta » runs export-eta's exporter (`export-eta/exporter/export.mjs run --mode batch`, beside this mod),
the same argv as the watcher's export alert (`lib/export-view.mjs` `EXPORT_RUN`): masking, fresh worktree of the eta
repo, PR, squash merge. The Veille pushes nothing else. « Rafraîchir » runs its `pending` command. « Ouvrir Export
eta » runs `/export-eta` for its selection and history tabs.

`/export-eta` keeps working: the export-eta mod registers it while loaded. When it is not loaded, veille registers
`/export-eta [lot|close]` as an alias of this tab (checked with `$.command.list()` 3 s after the session starts).

## One « attend Julian » count

The rule is `lib/core/veille.mjs` `attendJulian`: open alerts marked `julian`, not acked (`*` acks all). The watcher
(`status`) imports it. A hooks module may import only its own files and `claude-code` (`claude plugin validate`
refuses `node:fs`, which `lib/core/veille.mjs` imports for `readVeille`), so the pane uses the same rule in
`hooks/view.mjs` `julianCount`, and `tests/hub.test.mjs` checks both give the same number on every fixture. The Fil's
own `julian` field equals `filWaiting` of the same core file. The pane shows the count once, in the tab bar; the Fil
header uses the same number. The line above the prompt is off by default (option `band`: the Jauge shows the count).

`lib/core.mjs` takes « Ça t'attend » from `lib/core/waiting.mjs` (synced by `scripts/sync-libs.mjs`), no longer from
factory's folder.

## Health record

Every watcher run that looks at the world (`fire`, `tour`, `julian`, `fil`, `archiver`, `test-mail`) writes
`~/.claude/mods-health/veille.json` through `lib/core/health.mjs` (`writeHealth`): `error` is null on a clean run, else
one line joining this run's failures (`tour_failed`, `fil_failed`, `export_failed`, `mail_failed`, `merge_failed`,
`archive_failed`, `problemes_failed`, `toast_failed`, `wake_failed`, a crash), secrets scrubbed. Santé and the Problèmes register read it:
the problemes collector runs at the end of every tour, failed tours included (before 16 Oct a failed tour skipped it,
so a scanner that kept failing never reached Problèmes). The record of a run is written when it exits, so it reaches
Problèmes at the next tour.

## Files

`hooks/register.mjs` (pane, commands), `hooks/view.mjs` (Alertes view model, copied into cockpit), `hooks/fil-view.mjs`
(Fil and À archiver), `lib/export-view.mjs` (Export eta view model), `watcher/` (the scheduled script and its copies to
`~/.claude/veille/bin`), `lib/night.mjs` (safe wake, night summary, deadlines, vendored versions), `veille.config.json` (modes, labels, `export`, `night`, `deadlines`, `vendor_check` blocks). Tests: `node --test mods/veille/tests/*.test.mjs`,
`claude plugin test mods/veille`.
