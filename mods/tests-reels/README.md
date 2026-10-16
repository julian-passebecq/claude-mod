# tests-reels (« Tests réels »)

The registry of **real (non-CI) tests** per application: live runs on a test tenant, Cloudflare Access / Workers checks, Power BI Desktop / SSAS / Docker runs on this PC, UI automation, manual checks. So the team remembers what was tested, how, in which test environment and with which test account, and never loses it again.

`/tests` opens the pane (`/tests close` closes it). French labels, top to bottom, every block folded to a one-line summary:

1. Header: apps, environments, accounts, procedures, runs, apps « jamais testé en réel »; buttons « ↻ relire » and « Lancer la récupération ».
2. **À ranger**: test accounts whose secret is not stored anywhere known, environments with a missing id (`required_ids` per kind), and secrets seen in clear in the history (« mot de passe vu dans la session « … » le … : à ranger dans le Gestionnaire d'identification »), with how to store them.
3. **Applications**, one foldable block each: environments (kind tenant / cloud / local / docker, URLs, ids shortened, owner, created, status), test accounts (login **masked** until « voir », and where the secret lives), procedures (steps, commands, expected result, evidence, last run green / red / never), last runs, manual checks, and « Trouvé dans l'historique » (sessions, commands with their error count, ids, URLs, workspaces, passages).

## Security rules

- **No secret value is ever stored, printed or committed.** An account keeps only its login (a dedicated test account), its display name and a **reference**: `secret_ref: { store: "wincred", target: "<generic credential address>" }` (Windows Credential Manager), or `password-manager`, `env` (a variable name), `other`. The CLI refuses `--password`, `--token`, `--secret`, `--key`, `--cookie` and any value that reads like one (exit 2).
- Tenant ids, workspace ids and URLs of private apps live **only** in the local data folder `~/.claude/tests-reels/` (outside every repo). This repository ships code and invented fixtures only.
- The recovery scan never copies a secret value: it records its kind, the session title and the date, and counts it. Every passage and command it keeps is redacted first; URLs lose their query string and fragment.

## Data (local only)

| File | Written by | What |
|---|---|---|
| `~/.claude/tests-reels/registry.json` | `cli.mjs add …` | apps → environments → test accounts (references) → procedures → manual checks |
| `~/.claude/tests-reels/runs.jsonl` | `cli.mjs run-log …` | one line per real test run (append-only, safe for parallel agents) |
| `~/.claude/tests-reels/recovered.json` | `scanner/recover.mjs` | what the history says (rewritten on each scan) and `recover-cache.json` (per-file cache) |
| `~/.claude/tests-reels/config.json` | you | deep-merged over `tests-reels.config.json`: source paths, aliases, labels |

`TESTS_REELS_HOME` or `--data-dir` moves the folder (tests use a temporary one).

## After any real test: `cli.mjs run-log`

So that rules can require it, every agent that runs a real test appends one line:

```sh
node mods/tests-reels/cli.mjs run-log --app "<appli>" --env "<env>" --procedure "<nom>" --result pass|fail|partial \
  --evidence reports/<preuve>.md [--note "<une ligne>"] [--session "<titre ou id>"] [--by "<agent>"]
```

Declare things once with `add`:

```sh
node mods/tests-reels/cli.mjs add app --name "<appli>" --repo "<dépôt>"
node mods/tests-reels/cli.mjs add env --app "<appli>" --name "TEST tenant" --kind tenant --id tenant=<guid> --id workspace=<guid> --url <url> --owner Julian
node mods/tests-reels/cli.mjs add account --app "<appli>" --env "TEST tenant" --login <compte de test> --secret-store wincred --secret-target <adresse>
node mods/tests-reels/cli.mjs add procedure --app "<appli>" --name "Lecture live" --env "TEST tenant" --kind live --step "…" --command "…" --expected "…" --evidence reports/x.md
node mods/tests-reels/cli.mjs add check --app "<appli>" --what "…" --how "…"
node mods/tests-reels/cli.mjs show [--app "<appli>"]      # counts and masked logins
node mods/tests-reels/cli.mjs recover [--force]           # the recovery scan
```

Store a secret in the Windows Credential Manager: Control Panel › Credential Manager › Windows Credentials › Add a generic credential (the address is the `--secret-target`).

## Recovery scan

`node mods/tests-reels/scanner/recover.mjs [--force]` (Node 22+, standard library), or the pane button. Sources come from `recovery.sources` (set your paths in `~/.claude/tests-reels/config.json`; the shipped `repo_roots` is a placeholder):

- transcripts `~/.claude/projects/**/*.jsonl` (main sessions and subagents; app = the session's repo, a worktree counts as its repo; `app_aliases` reassigns by text),
- `manual-checks.md` lines `date · project · what · how` (struck lines keep their tail as status, `DONE` = fait),
- each repo's `handoff/*.md` and `reports/*` under `repo_roots`,
- `extra_roots` (e.g. an audit bundle): `.jsonl` read as transcripts, documents line by line.

It keeps, per app and per category (`categories`: Fabric / Power BI service, Entra tenant, Cloudflare, Power BI Desktop / SSAS, Docker, UI automation): sessions with their title, commands that match `command_pattern` (with errors from `is_error` tool results), GUIDs next to a context word (`id_context`), URLs on `url_hosts`, logins next to a test word (`account_context`, minus `ignore_accounts`), workspace names, short passages with a real-test marker (`real_markers`). A file whose size and date did not change is read from the cache. It prints counts only.

Non vérifié: the transcript format (not documented; the fields used are `cwd`, `sessionId`, `timestamp`, `message.content`, `custom-title`, `ai-title`, `tool_use`, `tool_result.is_error`); secret detection is heuristic (strong formats such as JWT, GitHub / GitLab / Anthropic tokens, private keys, plus `password=…`-style pairs whose value looks random), so a secret in another shape can be missed.

## Tests

```sh
node --test mods/tests-reels/tests/logic.test.mjs
claude plugin test mods/tests-reels
claude plugin validate mods/tests-reels
```
