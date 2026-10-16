# ci

**Now also inside Référence** (`mods/reference`, tab CI, `/reference ci [diagramme …]`): same drawing (`hooks/draw.tsx`, `diagram.ts`, `view.ts`, synced there), same caches through `scanner/ci.py`. `/ci` keeps working while this mod is loaded; once it is unloaded, Référence answers it (route and clear need this mod).

Two tabs in one side pane, **Routage** and **Diagramme**. Nothing here blocks or rewrites a tool call, and nothing calls a model.

| Command | What it does |
|---|---|
| `/ci` | Opens **Routage**: the CI backends from your config, whether each one is usable now, and which repo or conversation uses which. |
| `/ci refresh` | Same, after a fresh status check (tokens present yes/no, runners online, running and pending jobs). |
| `/ci route <repo-path\|session-id\|here\|session> <backend-id>`, `/ci clear <target>` | Write or clear a route in `~/.claude/ci-routing.json`. |
| `/ci diagramme` | Opens **Diagramme**, the pipeline view. |
| `/ci diagramme refresh` | Same, and reads `gh` / `glab` again now (1 to 3 minutes for about a hundred repos). |
| `/ci diagramme claude\|codex\|inconnu\|tout` and `hote\|app\|conv` | Same, with that filter and grouping already set. |
| `/ci close` | Closes the pane. |

## Diagramme

From top to bottom:

1. **One sentence** describes the current state, for example « 2 pipelines en cours, 1 rouge dans datapass-react (job lint), runner local à 6/18, attente runner ~45s (médiane de 12 jobs) ».
2. **Filters** are real buttons: Tout · Claude Code · Codex · inconnu.
3. **Résumé** (folded at start): runs today and over 7 days, pass rate, minutes per CI host, the local runner's queue (jobs running and pending, runners online, median queue wait), and the same figures per author and per app. On desktop it also shows a static picture (authors → CI hosts → results). The picture cannot be clicked; the buttons stay buttons.
4. **En cours**: one entry per running pipeline. Each shows « vert ou rouge vers HH:MM » and a text Gantt, one bar per job grouped by stage, drawn by `lib/core/gantt.mjs`, the same renderer and legend as factory's Workflow screen: ░ file, █ fini, ▓ en cours, ▒ échoué, ┄ estimation, │ maintenant. The Gantt is 24 cells wide, so it stays readable at side-panel width.
5. **Rouges**: the latest run of each lane that really failed. Each red job comes with the command that prints its log, for example `gh run view <id> -R owner/repo --log-failed` or `glab ci trace <job-id> -R group/repo`, plus its link. The mod shows these commands and never runs them. A job with `allow_failure` is orange, never red, and a cancelled or skipped run is grey.
6. **Pipelines par hôte / par app / par conversation**: one lane per repo × CI host:
   `app ──▶ CI host ──▶ [stage: job ✔ 1m02, …] ▶ [stage …] ──▶ ✔ vert 1m20 · il y a 2 h`, followed by the lane's last runs (`✔✔✘●…`), who made them, the branch or MR, and the conversation. The **Gantt ▸** button opens that lane's newest run as a Gantt. Each group can be folded.

### Where the data comes from

- **Repos**: every git clone under `pipelines.roots` (`max_depth` deep), the paths in `pipelines.repos`, and every repo that has a route. A GitHub remote and a GitLab remote of the same clone (a CI mirror on GitLab) count as one app.
- **Runs**: `gh run list` plus `gh run view --json jobs` (jobs of the newest `jobs_runs` runs only) for GitHub, and `glab api` in GET for GitLab pipelines and jobs. The CI host comes from the jobs' runner tag (`local-windows` → the local runner) or from a shared runner (→ GitLab SaaS). A GitLab pipeline whose jobs were not read gets the host of the same project's recent pipelines and is marked `*`.
- **Who made the run**:
  - **Claude Code**: a `Co-Authored-By: Claude` trailer in the commit (read with `git log -1` in the local clone), a `claude/*` or `worktree-agent-*` branch, or a PR/MR opened by a Claude Code conversation.
  - **Codex**: a `codex/*` branch, a Codex trailer, or a Codex author.
  - **inconnu** for anything else. The mod never guesses. The patterns are in `pipelines.attribution`.
- **Conversation**: the mod reads `~/.claude/projects/*/*.jsonl` read-only and looks for the output of `gh pr create` and `glab mr create` (the PR/MR URL, and the branch from `--head` / `--source-branch` or the line's `gitBranch`). The conversation title comes from the transcript's `custom-title` entry. Results are cached per file (size and mtime) in `~/.claude/ci-conversations-cache.json`.
- **Estimates**:
  - **Per job**: the median of the last successful runs of the same job, which needs at least 3 of them. The history of those runs is kept across refreshes in the pipelines cache.
  - **Later stages**: a job in a later stage starts when the previous stage ends, plus the runner's median queue wait.
  - **Fallback**: when the job history is too short, the median duration of the lane's last successful pipelines (at least 3). When that is also too short, the view says « pas assez d'historique » and gives the sample size.
- **One estimate rule**: the scanner sends its samples (`samples_s` per job, `durations_s` per pipeline) and the view recomputes the median and the end with `lib/core/estimate.mjs`, the rule factory's Workflow ETA uses (at least 3 samples, never an end in the past). The runner line reads like `runnerLine()` of `lib/core/runner.mjs` (`tests/core.test.mjs` checks both on invented runs); a hooks module cannot import `runner.mjs` itself (it reads files with `node:fs`).
- **Refresh**: on Rafraîchir, `/ci diagramme refresh`, or when the cache (`~/.claude/ci-pipelines-cache.json`) is older than `cache_minutes`. There is no timer.

Labels, colours and limits are in `ci.config.example.json` → `pipelines`. Copy it to `~/.claude/ci.config.json` and set `pipelines.roots`.

## Tests

```sh
python -I -m unittest discover -s mods/ci/tests -p "test_*.py"
node --test mods/ci/tests/core.test.mjs
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/ci
```

All test data is invented: repos, runs, job history and transcripts.
