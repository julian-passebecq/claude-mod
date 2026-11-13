# Lane report: mod-top-lines, three plain lines on top of the Cockpit mod and page (2026-11-13, evening)

Goal (Julian, 13 Nov 20:45 local: « i dont know if msi is used, if i can play or shut it off, whats going on oracle »;
20:37: « why do i need to open a todo folder »): the pane and the Cockpit page of each machine open on the same lines,
computed once on the hub, and a hot-machine card that shows the state now. Manifest: cockpit 0.8.7.

## What changed (this repo)
1. `lib/hub.mjs topLines(G, machine, base)`: reads `data.glance.top.machines[<machine>]` (hub, glance.py `top()`) as
   is; `m.top`, `m.criticalHead` (the hub's `glance.critical_head`).
2. `hooks/hub_view.mjs drawTop`: right under the views row, before everything else: « This computer: … », « You can play
   / shut it down: … » (a button: `S.act.top`), « Oracle: … », « You: N to do here · next: <title> » (opens
   `<base>/#todo-<id>`). The critical strip's heading is the hub's (« work is stopped » only when a row stops work).
3. `hooks/register.mjs hubTopClick`: the play line sends the hub's `click_text` (« Cockpit: pause <m> » or « resume »)
   with the click line through `POST /api/todo`, as the page's buttons do; the hub's actions.py runs `herdq pause|resume`.
4. `/fleet` text starts with the same four lines (the installed-mod check reads them with `claude -p "/fleet"`).

## Hub side (not in this repo, ~/fleet commits 9965970, f738e1f, 0eb1af6, 8b4d44a)
glance.py `top()` and `oracle_line()`, `hot_words` (latest temperature, episode start), `critical_head`; health.py
15-minute cool-down (`cool_s`); actions.py `Cockpit: pause|resume <machine>` (resume needs Julian's click); the page
(`#top3`, `#todo-<id>` card ids). cockpit_build.py `queue_live()` reads q.db read-only at each build: the hub's own
checks (ps/sh jobs tagged `# herd:<name>`: todo-check, quota-probe, away-presence...) are counted apart and never make
a machine « in use ». Rule for « yes »: no real job running or waiting (a waiting job on a paused machine does not
start) and no agent session (transcript written in the last 10 min, minus the agent jobs already counted). « Safe to
interrupt » is not guessed: the queue does not re-send a job cut in the middle, so any real job gives « no: N jobs
running ». The MSI paused between 02:00 and 09:00 says « paused for the night by the 02:00 timer ».

## Follow-up (0.8.8, same evening, lead's fix)
Julian's own chat on his desk counted as « 1 agent session », so his desk said « no ». Now only hub work (a real job
running or waiting) makes « in use » / « no: N jobs running ». Chats alone: « This computer: no hub job; N chats open here
(yours or an agent's) » and « You can play / shut it down: yes: nothing from the hub; N chats here would stop and can be
resumed », same click (pause). Chats = top-level Claude + Codex transcripts written in the last 10 min (fleet 0eb1af6:
subagents are helpers, not sessions; the MSI had shown 21 sessions for 2). The load probe has no finer field (active now
vs waiting for input), so every chat of the last 10 min is counted; no new probe was built. The folded « This laptop »
temperature already says the value now first, the peak in brackets: unchanged. Tests: fleet test_top_lines.py, 20 cases.

## How verified
- `node --test "tests/*.test.mjs" "mods/*/tests/*.test.mjs"`: 621 pass, 0 fail (with `python` on PATH; 5 new hub cases).
- `claude plugin test mods/cockpit` on the Linux hub: 27 pass, 7 fail; the same 7 fail on origin/main there (Windows
  paths in the Panneau / Fichiers fixtures), not caused here.
- `node tools/validate_mods.mjs`: all 20 mods validate; `tools/confidentiality_scan.py`: PASS.
- Live text render of the pane from the hub's real data.json at 42 columns: the four lines first.
- Install and on-machine checks: see the PR description.

## Remaining
- The pane opens the item in the default browser (the mod's one way to open a URL), not inside an already open
  VS Code tab.
