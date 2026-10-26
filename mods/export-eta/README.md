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

## Brief pour une autre IA

The band's **Export conv** / **Export + enfants +N** buttons (and `/export-eta brief [enfants]`) write ONE Markdown file
meant to be pasted into another AI (ChatGPT, Codex, another Claude) so it knows where a conversation stands. Local and
clipboard only: no model call, no eta-repo PR. File: `~/.claude/export-eta/briefs/<date>-<titre>.md` (`-avec-enfants`
with children), copied to the clipboard (PowerShell `Set-Clipboard` on Windows); a toast gives the path and « copié ».

Each conversation, in this order:

1. **Ce qu'est cette conversation**: title, project, folder, branch, model · effort, start, last activity, state
   (travaille / au repos / attend une réponse when an AskUserQuestion has no answer / attend Julian), parent, children.
2. **Où on en est / suite**: the last end-of-turn recap and question (`wrap_up`), the app's status line, the latest task
   list (`update_plan` with advance / done / start applied, or `TodoWrite`), Claude's last reply.
3. **ETA en direct**: open PRs / MRs with their checks (and `fin ~HH:MM` of a running check from its workflow's last
   successful runs, `lib/core/estimate.mjs`), running Workflows (phase i/n, agents done / running / failed, `fin ~HH:MM`
   from past runs of the same Workflow) and agents, read by `lib/core/running.mjs`.
4. **Git**: branch, ahead / behind `origin/main` (no fetch), uncommitted files, last 10 commits.
5. **GitHub / GitLab**: PRs / MRs this conversation opened (`gh pr create` / `glab mr create` output, its agents'
   results, the app's linked PRs): number, title, state, checks, read with `gh` / `glab` (skipped when missing).
6. **Conversation**: every message of Julian in full, every text of Claude, one line per tool call
   « `Tool` short arg → ok / erreur : first line », AskUserQuestion with its options and answer, compactions and
   background results as one line. Tool outputs and file contents are never copied.

With children, the file starts with a contents list, then one section per sub-conversation (recursive, `max_depth`),
each with the same six parts. Past `max_chars_per_conv` (60 000) a conversation keeps its head and its most recent
messages and says how many older ones were cut. The whole file goes through `lib/mask.mjs` before it is written; a
secret the mask cannot fix stays in the local file and the clipboard is left alone (the toast says so).

Script: `node mods/export-eta/exporter/brief.mjs run --session <cli id> [--children] [--cwd <dir>] [--no-clip] [--out <file>] [--json]`
(`--sid local_…` works too; `info --session <id>` prints the child count the band shows). The app's session files are
read once and cached by mtime (`briefs/.sessions-cache.json`). git and gh calls run side by side; a brief takes ~10 s,
a lead with 6 children ~35 s on Windows. Settings: the `brief` block of `export-eta.config.json` (labels: every heading
and word, `BRIEF_LABELS` in `lib/brief.mjs`).

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

`exporter/` (the script; `tout.mjs` for Exporter tout; `brief.mjs` for the brief), `lib/` (masking, layout, render, eta git flow, `snapshot.mjs` sections; `lib/core/` synced copies, never edited by hand),
`hooks/` (pane), `export-eta.config.json`. The eta path lives in `~/.claude/export-eta/config.json`, never in this repo.
Tests: `node --test mods/export-eta/tests/*.test.mjs` (tout.test.mjs: snapshot on invented fixtures and a temp fake eta repo; brief.test.mjs: the brief on fixture session files), `claude plugin test mods/export-eta`.
