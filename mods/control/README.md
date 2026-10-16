# control — Claude Control

**The CONFIG pane is now also inside Référence** (`mods/reference`, tab Config, `/reference config`): same drawing (`hooks/config_draw.tsx`, synced there) over the same scanner output. `/control` and `/config-claude` keep working while this mod is loaded; once it is unloaded, Référence answers both (on its Config tab).

| Command | What it opens |
|---|---|
| `/control [setup\|usage\|practices\|history\|config] [scan]` | SETUP (live rules, blockers, hidden rules, mods loaded or not, agents, skills, workflows), USAGE (1/7/30-day model, effort and delegation mix against the rule lines), PRACTICES (one section per heading of the live CLAUDE.md with its evidence), HISTORY, CONFIG. `scan` rescans first. |
| `/config-claude [scan] \| close` | CONFIG alone: everything in Claude Code, read-only, by category → sub-category → item, with search, Markdown rendered or raw, long texts paged. |

- Data: `scanner/control_scan.py` (usage, setup, practices) and `scanner/config_scan.py` (config) write JSON under `paths.out_dir` (`~/.claude/effort-board/control`). Every value that looks like a secret is masked by the scanner before anything is written; MCP env and headers are never read beyond their names.
- Drawing never runs a scanner: scans start from a command or a Rescan button.
- Read-only: no tool call is touched and no text is added to prompts.

## « Mods chargés » and lib/core

The SETUP list of mods is computed in Python (`mod_states` in `scanner/control_scan.py`). Every other mod reads mods through `lib/core/mods.mjs`; `tests/test_mods_core.py` runs both on an invented folder and checks they agree (plugin dirs split, names, versions, loaded and missing). It needs `node` on PATH.

## Tests

```sh
python -I -m unittest discover -s mods/control/tests -p "test_*.py"
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/control
claude plugin validate mods/control
```
