# metrics — « Les règles marchent ? »

Read-only pane (`/regles`) that shows, per day and per rules version, whether the rules that steer your agents help.

**Now also a tab of Registres**: `/registres regles [V5.8] [refresh]` (or `/regles` when this mod is not loaded) shows the same view in the Registres pane, drawn by a copy of `hooks/pane.mjs` (the pane's pure drawing; `hooks/register.tsx` only reads the files and hands them over). This mod keeps working on its own while it is loaded.

## What it measures

| Metric (config id) | How | Source |
|---|---|---|
| PR/MR mergées par jour (`prs`) | merged PRs (GitHub) and MRs (GitLab) of the tracked repos | `gh search prs --merged --author @me`, `glab mr list -M` |
| M8 Tokens / coût par PR (`tok_per_pr`, `usd_per_pr`) | tokens (input + output + cache) and list-price cost of the sessions whose folder belongs to a tracked repo ÷ merged PRs/MRs | transcripts, parsed with `mods/usage/lib` |
| Tours Opus / Sonnet / Haiku (`*_share`) | share of assistant turns per model family, all agents | transcripts |
| M1 Appels d'agent avec modèle (`m1_named`) | Agent calls with `model` set, plus Workflow `agent()` calls with `model:` (approximation) | transcripts |
| M2 Tours principaux ≥ 250 K (`m2_big`) | main-thread turns whose context (input + cache) is at or above `detect.context_threshold` | transcripts |
| Arrêts manuels (`stops`) | `[Request interrupted by user…]` messages | transcripts |
| M10 Refus de permission (`perm`) | tool results "The user doesn't want to proceed…" | transcripts |
| Gardes de l'app (`guard`) | tool errors from the app's guards (isolated worktree, protected path, PreToolUse hook) | transcripts, patterns in config |
| Creux CI (`stall_h`) | inside each day's CI span, gaps ≥ `stall.min_gap_min` with no pipeline running | `gh run list`, `glab ci list` |
| Arrêts BLOCKED (`blocked`) | assistant texts starting with BLOCKED or saying red twice | transcripts |
| M6 Réveils (`wake`) | Monitor / CronCreate / ScheduleWakeup calls | transcripts |
| Compactages (`compact`) | `compact_boundary` entries | transcripts |

M1, M2, M6, M8 and M10 reuse the names of claude-control's `docs/PRACTICES.md` (section 7). Rules versions come from the git log of the rules file (`rules.repo`, `rules.file`): a version starts at the first commit whose subject carries it (`V5.8`, later `V6`) and is drawn as a `│` marker under the sparklines. The « avant / après » table compares a version's window with the previous one (rates per day, shares in %); arrows are green when the change goes the way the metric's `better` says.

**Non vérifié** (approximations, written in the pane too): permission *waits* leave no reliable trace in the transcripts (only refusals are counted); Workflow `agent()` model detection reads the script text; « creux » cannot know what work was startable, it only sees CI gaps; transcripts kept on this PC bound how far back the transcript metrics go.

## How it runs

- `/regles [V5.8] [refresh]` opens the pane, `/regles close` closes it. In the band's Mods bar, Règles lives in the « Registres » entry (`{ "label": "Registres", "mod": "registres", "command": "registres" }`). The command returns no text, so nothing reaches the model ([mods overview](https://code.claude.com/docs/en/plugins/mods/overview), [reference](https://code.claude.com/docs/en/plugins/mods/reference)). No hook blocks, rewrites or delays a tool call or a prompt.
- When the data is older than `refresh_min` (30 min), the pane starts `scanner/metrics_scan.mjs` in the background (`$.process.run`): it reads only the bytes appended to `~/.claude/projects/**/*.jsonl` since its last run (first run: ~3 GB in ~35 s on the author's PC), lists the repos (git remotes), and calls `gh` / `glab` (read-only list calls) at most once per `refresh_min`. Results: `~/.claude/metrics-mod/` (`scan-cache.json`, `forge-cache.json`, `metrics.json`).
- From a shell: `node mods/metrics/scanner/metrics_scan.mjs report` prints the latest before/after table.
- Needs Node 22.18+ and the `usage` mod folder beside it (`../usage/lib`, shared parser and prices). `gh` and `glab` are optional (logged in for the forges you use).

## Settings

Everything is in `metrics.config.json`; override any key in `~/.claude/metrics-mod/metrics.config.json` (deep merge). Set at least:

```json
{
  "repos": { "roots": ["<folder that holds your repos>"], "gitlab_groups": ["<your GitLab group, for CI mirrors>"] },
  "rules": { "repo": "<repo that versions your rules file>", "file": "config/claude/CLAUDE.md" }
}
```

Labels, targets, which metrics show (`show: false`), the summary columns, detection patterns, the stall gap, history length and refresh period are all settings.

## Tests

```sh
node --test mods/metrics/tests/logic.test.mjs
claude plugin test mods/metrics
claude plugin validate mods/metrics
```
