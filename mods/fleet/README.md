# fleet (redirect)

The Fleet mod moved into [Cockpit](../cockpit) on 12 Nov 2026: its To-do and Fleet tabs are two of Cockpit's hub tabs
(Overview, To do, Questions and checks, Fleet, Quota, Alerts, Journal, Watch, Lanes), read from the same local
Cockpit data (`http://127.0.0.1:24365`). `/fleet`, `/dispatch <machine> <text>` and `/todo <machine> <text>` are
Cockpit's commands now.

This folder is a thin redirect: it registers no command and opens no pane, so a machine whose
`CLAUDE_CODE_PLUGIN_DIRS` still names an installed copy (`~/.claude/mods/fleet`) loads nothing old. Install it over
the old copy with `node scripts/install-fleet-redirect.mjs` (backup kept next to it), or drop the folder from
`CLAUDE_CODE_PLUGIN_DIRS`.
