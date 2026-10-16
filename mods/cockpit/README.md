# cockpit

**Cockpit** is one side pane over all your agents, read-only, with French labels, ordered by scope: this conversation first, then its project, then every project, then Claude as a whole. Each section folds; closed, it is one summary line.

```
[Méga] › [eta] › [Galaxy finalisation…] [↻] 18:54
[▾ Cette conversation]
 opus 5.5 ▮▮▯▯ medium ctx 27 % en cours
 ● [Galaxy finalisation autonome (cette conversation)]
   └ ◇ [workflow package-wave]
     └ ● [coder · build]
 [+ 3 terminé(s)]
 PR #29 · open · CI running
[▸ Ce projet · eta] 4 conv · 1 en cours · $7.00 aujourd’hui
[▸ Tous les projets] 2 en cours · 3 au repos · 1 attend Julian · $424
[▸ Claude global] 5 h 24 % · sem 14 % · 1 alerte(s)
```

| Section | Default | Shows |
|---|---|---|
| **Cette conversation** | open, selected | status line (model · effort, ctx, state), the lead tree holding it (lead → sub-conversations → Workflows → agents, model/effort/tokens/cost), the running Workflow and current step, PR/CI. Finished agents and Workflows fold behind « + N terminé(s) ». An agent selected: its card and log. |
| **Ce projet** | closed | the project's conversations as a tree (the app's `spawnedFrom` link, even lanes launched in another repo), then factory's **Focus** and **Pipeline** for that project |
| **Tous les projets** | closed | two lines per project: name and cost today, then counters (conv, en cours, attend Julian, agents, ctx max) |
| **Claude global** | closed | Session (5 h), Semaine, Semaine Fable with bars and « reset dans … », cloud credits, this session's cost / model share / cache hit, Veille's open alerts, a `/machine` button. What the API does not give says « non lisible depuis un mod ». |

The breadcrumb (one small row) zooms out; a click on a node drills down and unfolds the section that shows it. The context gauge is not here: it is band's, above the prompt, where you look. A button at the bottom runs `/filetree`.

## Next to filetree

Both open by themselves at session start. The desktop shows **one pane at a time, the others as tabs** (docs: « With several panes open, each gets a tab that shows its title »), so Cockpit is a tab next to « Files: … » in the same right column, not stacked under it. A mod cannot draw inside another mod's pane, so the « Fichiers » button switches to filetree by running its command. Where exactly the desktop docks the column and how wide it makes it: non vérifié in the docs.

## Settings

`cockpit.config.json` (deep-merged with your own file: userConfig `config`, else `~/.claude/effort-board/cockpit.config.json`):

- `sections.order` / `sections.enabled` / `sections.open`: which sections (`breadcrumb`, `conv`, `project`, `all`, `global`, `fichiers`), in which order, which start unfolded (default `conv` only);
- `default_level`: `medium` (default: this conversation selected), `macro` or `mega`;
- `diagram.enabled`: the project tree also drawn as an SVG in « Ce projet » (off: it repeated the rows);
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

prints the four levels as text (every section unfolded) at a side-panel width from this PC's transcripts; `--defaults` prints the pane as it opens (this conversation selected, the other sections folded).

## Tests

```sh
node --test mods/cockpit/tests/nav.test.mjs   # navigation, breadcrumb, tree from fixture sessions, sections, lib drift
claude plugin test mods/cockpit               # auto-open, /cockpit, clicks, both surfaces
claude plugin validate mods/cockpit
```

Nothing here blocks, rewrites or adds to a prompt, and nothing calls a model.
