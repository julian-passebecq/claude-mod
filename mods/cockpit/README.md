# cockpit

**Cockpit** is one side pane that zooms through all your agents, read-only, with French labels.

```
Méga › datapass-claude-eta › Galaxy finalisation autonome › coder · release-commit
```

| Level | The tree shows | The detail under it |
|---|---|---|
| **Méga** | every project on this PC, with counters (conversations, working, waiting on Julian, blocked, agents, cost today) | factory's **Mission** screen |
| **Projet** | one project: each lead conversation and the conversations it spawned (the app's `spawnedFrom` link), even lanes it launched in another repo, with a state dot like the sidebar | factory's **Focus** and **Pipeline**, filtered to that project |
| **Conversation** | the same tree, with the selected conversation opened into its Agent subagents and its Workflows → agents | factory's **Arbre** (lead, sub-conversations, agents, architect, bill, log) |
| **Agent** | the same tree, the agent selected | an agent card (model, effort, state, tokens, cost, tools, task) and the agent's own log |

Click a node to zoom in; click a breadcrumb item to zoom out. On the desktop the tree is also drawn (an SVG: dots coloured by state, elbows to the parent, the selection highlighted); the terminal has no `Svg`, so it shows the clickable rows only.

Under the detail, small foldable strips:

- **Jauge**: band's context gauge (a thin bar with the hand-off and auto-compact marks, then « compactage dans ~N min · tok/s · semaine %»). The rates come from band's scanner when band sits beside cockpit and the strip is open.
- **Usage**: Session (5 h), Semaine tous modèles, Semaine Fable with bars and « reset dans … »; cloud credits; this session's cost, Opus / Sonnet / Haiku share, cache hit and the top 3 contributors. What the API does not give says « non lisible depuis un mod ».
- **Veille**: the mode, the watcher's last tour and the open alerts, from veille's files.
- **Fichiers**: a button that runs `/filetree`.

## Next to filetree

Both open by themselves at session start. The desktop shows **one pane at a time, the others as tabs** (docs: « With several panes open, each gets a tab that shows its title »), so Cockpit is a tab next to « Files: … » in the same right column, not stacked under it. A mod cannot draw inside another mod's pane, so the « Fichiers » button switches to filetree by running its command. Where exactly the desktop docks the column and how wide it makes it: non vérifié in the docs.

## Settings

`cockpit.config.json` (deep-merged with your own file: userConfig `config`, else `~/.claude/effort-board/cockpit.config.json`):

- `sections.order` / `sections.enabled` / `sections.open`: which sections, in which order, which strips start unfolded;
- `default_level`: `mega`, `macro` (default: this conversation's project, the conversation selected) or `medium`;
- `auto_open` (and userConfig `start`): open at session start;
- `refresh_s`, `strips_refresh_s`: refresh only while the pane is the one shown;
- `diagram`, `tree`, `colors`, `term_colors`, `labels`.

Prices, thresholds and the detail screens' labels are factory's (`lib/factory/factory.config.json` + `~/.claude/effort-board/factory.config.json`).

## Shared libs

A mod may import only files inside its own folder (`claude plugin validate`: « cannot import … it is outside the plugin's folder »). So `lib/` holds byte copies of factory's view models, renderers and scanner, band's gauge and veille's view model; the owners stay the source of truth:

```sh
node mods/cockpit/scripts/sync-libs.mjs          # after changing factory, band's gauge or veille's view
node mods/cockpit/scripts/sync-libs.mjs --check  # what CI checks (tests/nav.test.mjs too)
```

## Preview

```sh
node mods/cockpit/scripts/preview.mjs --cols 75 --project datapass-claude-eta --conv "Galaxy finalisation autonome"
```

prints the four levels as text at a side-panel width from this PC's transcripts.

## Tests

```sh
node --test mods/cockpit/tests/nav.test.mjs   # navigation, breadcrumb, tree from fixture sessions, sections, lib drift
claude plugin test mods/cockpit               # auto-open, /cockpit, clicks, both surfaces
claude plugin validate mods/cockpit
```

Nothing here blocks, rewrites or adds to a prompt, and nothing calls a model.
