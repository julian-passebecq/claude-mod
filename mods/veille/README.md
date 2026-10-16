# veille

« Veille », one entry of the Mods bar: **one pane, four tabs**. Read-only, no model call, nothing added to a prompt.

| Tab | Command | What it shows | Reads |
|---|---|---|---|
| Alertes | `/veille` or `/veille alertes` | the watcher's mode and its buttons, alerts (severity, since when, link, **Ack**), last tour (red when two fires were missed), actions with their reason | `~/.claude/veille/state.json`, `heartbeat.json`, `acks.jsonl` |
| Fil | `/veille fil` | every conversation's last message, by project, lead → sub-conversations | `~/.claude/veille/fil.json` |
| À archiver | `/veille archiver` | finished conversations the VEILLE conversation may archive in one batch, « Copier la liste des ids »; the command also prints the list | `~/.claude/veille/archive.json` |
| Export eta | `/veille export` | export-eta's finished batch, why it is ready, its conversations, **Exporter vers eta**, the last exports | `~/.claude/export-eta/pending.json`, `state.json` |

`/veille close` closes the pane. `/veille mode <x>`, `/veille ack <clé|all>`, `/veille coordinateur`, `/veille tour` run the
watcher's own commands.

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
`archive_failed`, `problemes_failed`, `toast_failed`, a crash), secrets scrubbed. Santé and the Problèmes register read it.

## Files

`hooks/register.mjs` (pane, commands), `hooks/view.mjs` (Alertes view model, copied into cockpit), `hooks/fil-view.mjs`
(Fil and À archiver), `lib/export-view.mjs` (Export eta view model), `watcher/` (the scheduled script and its copies to
`~/.claude/veille/bin`), `veille.config.json` (modes, labels, `export` block). Tests: `node --test mods/veille/tests/*.test.mjs`,
`claude plugin test mods/veille`.
