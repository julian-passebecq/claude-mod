// fleet 0.2.0 - a thin redirect. The Fleet mod (claude-control mods/fleet 0.1) is now part of the Cockpit mod: its
// To-do and Fleet tabs are Cockpit's hub tabs and Cockpit registers /fleet, /dispatch and /todo when no loaded mod has
// them. This module registers nothing, so those names fall to Cockpit; it exists only so an install that still lists
// this folder in CLAUDE_CODE_PLUGIN_DIRS loads no second pane. It never blocks, rewrites or adds to anything.
export const register = (on) => {
  on('session.start', async ($, e, next) => next(e))
}
