# cockpit

## Panneau (default view; macro view since 19 Oct)

Opening Cockpit shows **one scrolling column with no tab bar at all**. Since 19 Oct it opens on a **macro view** (Julian: « all the good info but hard to read: a macro view where I see everything quickly, a micro view when I click »): **the conversations drawn as a project-structure tree** (since 19 Oct, after Julian's « Claude Code Project Structure » poster: conversation → the sub-conversations it spawned → its Workflows → their agents, `├────` / `└────` / `│` connectors in grey, a node line with the title and a grey metrics line under it, an empty `│` line between siblings), and **one line each** for the quotas, the tokens per second and the graph. Every detail of the earlier cards is still there, one click away on the title or its `›` (`⌄` folds it back), and what you unfold is kept in `$.store`. Section headers are small bold one-liners with their summary on the same line (« CONVERSATIONS · 3 travaillent · 1 t’attend · 5 au repos »), no big chips. Colours: one state colour per line (its mark), numbers bold and coloured only when alarming (context at `panel.style.ctx_warn_pct` 62.5 % amber, past the hand-off threshold red with ⚠, a quota at 80 % amber and 90 % red, a stalled Workflow amber ⚠ « à l’arrêt 1 h 09 »); the rest grey or plain. At 45, 60 or 75 columns a node line cuts its title; its metrics line drops the model breakdown, then the phase, then the ETA (kept at 75 columns), then the bar, then the words (« 1 agent en cours » becomes « 1 ag. » only when the width forces it): a number is never cut, and the line wraps nowhere. **Indentation** (Julian, 20 Oct after PR #65: « ajoute de l'indentation »): 6 columns per level (`├──── ` `└──── ` and the `│` rule under them), 4 under `panel.style.wide_cols` (60) columns, so conversation → sub-conversation → Workflow → agent are clearly stepped; `panel.tree.indent` sets it (a number of columns, or `"auto"`). The metrics line starts exactly under the title's first letter (after the state mark); a blank `│` line separates sibling conversations, none between the agents of one Workflow. The old views are reached by their `/cockpit` command only, listed in one grey line at the very bottom. **What runs right now** (Julian, 21 Oct after PR #66, narrow pane: « good, but I don't see what is running right now, which agent, which workflow; use more indentation, bullets »): every node has a **typed bullet** whose colour is its state (green running, amber waiting or stalled, red failed, grey done) and a grey type word after its title (dropped rather than cutting the title): ● conversation (`conv`), ↳ sous-conversation, ◇ workflow, ▸ phase, • agent of a Workflow, ◦ agent d'arrière-plan (the Agent tool outside a Workflow); `panel.bullets` and `panel.labels.type_*` set them. **Running agents are always drawn** under their Workflow, without unfolding it: the running phase only (« ▸ Wave B phase 0/1 », its `›` adds its finished agents), then one line per running agent « • coder · p44-migration  opus · 1 h 10 · 180K » (short of room the model goes, then the tokens; the time stays), at most `panel.conv.running_max` (8) then « +N agents en cours »; a Workflow without named phases lists them directly; the running background agents are ◦ lines right under their conversation. A Workflow unfolded (⌄) shows every phase and every agent. **EN COURS › « voir › »** unfolds « En ce moment »: every running agent of every conversation, flat, longest first, its model and time, and under it in grey its path « Conv › workflow › phase » (the conversation's title is cut first); a conversation working with no agent is « ● fil principal »; with nothing running the line says « rien ne tourne · dernier fini il y a 12 min (name) ». **« Terminés N › »** unfolds to one line per finished Workflow or agent, newest first, at most `panel.conv.finished_max` (10): its bullet, its name, ✓ / ✕, its duration and « il y a … » (a finished Workflow's title unfolds its agents). **Detection** (factory's scanner, `factory_scan.py`): an agent whose transcript has not moved for `--live-s` still counts as running while it waits on a long tool call, up to `--bg-stale-h` hours, when its Workflow run has no record yet, when its background Agent call has no completion notice (also when only its meta says background), or when its foreground Agent call has no result yet (« Agents 0/1 » with nothing listed came from these). **Sankey**: a label is drawn only where it fits whole before the next column, and under `style.wide_cols` (60) columns the picture has no text in it and a legend sits under it (one line per source and per model). Indentation stays at least 4 columns per level at 45 columns; titles are cut first.

`node mods/cockpit/scripts/preview.mjs --panneau --cols 60` (or 45, 75) draws it from invented fixtures (`--indent 3` tries another `panel.tree.indent`; `--busy` the fixture with 2 running Workflows, 1 background agent, 1 working sub-conversation and 1 CI pipeline; `--main` only this conversation's main thread works (Julian's 21 Oct screenshot); `--idle` nothing runs (the green « ✓ Rien ne tourne » line); `--ci idle|busy|stale` the ci mod's cache; `--open encours,pdetails` unfolds sections or nodes). `--panneau --busy --cols 60 --open encours`:

```
EN COURS
● [3 conversations travaillent] (2 fil principal)
● [2 wf] · ● [2 ag.] · ● [1 s-ag.] · ● [1 CI] [voir ⌄]
  En ce moment (6)
  ◦ coder · p44-migration opus · 1 h 10
    Lane alpha · tableau de bord
  • coder: cockpit-claude-style opus · 20 min
    Lane alpha · tableau de bord › package-wave › Wave B
  • coder · write the docs sonnet · 12 min
    Lane delta › wf_2
  ● fil principal opus
    Lane alpha · tableau de bord
  ● fil principal opus
    Package four
  ◆ proj-one · claude/panel tests · 6 min

◆ À toi de cliquer : [Lane beta] Choisir la version · depu…
[▸ Fichiers] proj-one · main · sélection : src/panel.ts

CETTE CONVERSATION
│
└──── ● [Lane alpha · tableau de bord] conv [⌄]
      │ 30 % · $11.21 · 1 wf · 2 ag. [détails ›]
      │
      ├──── ◇ [package-wave] workflow [›]
      │     │ 2/4 ■■●□ · 1 agent en cours · 40 min
      │     └──── ▸ Wave B phase 0/1
      │           └──── • coder: cockpit-cla… 20 min · 1.5M
      │
      ├──── ◦ coder · p44-migration opus · 1 h 10 · 918K
      │
      └──── ✓ [Terminés 1] [›]

CONVERSATIONS · 3 trav. · 1 att. · 5 repos [filtres ›]
proj-one · 6
│
├──── ● [Lane alpha · tableau de bord] conv [⌄]
│     │ ctx 30 % · 3.6M · 1 wf · 2 agents en cours
│     │
│     ├──── ↳ [Package four] sous-conv [›]
│     │       ctx ▰▱▱▱▱▱|▱▱▱ 10 % · 200K [détails ›]
│     │
│     ├──── ↳ [Package two] sous-conv 1 sous-conv · —
│     │
│     └──── ↳ [Package one: a rather long lane title th…] —
│
└──── ● [Lane delta] conv [⌄]
      │ 15 % · 800K · 1 wf · 1 agent en cours [détails ›]
      │
      └──── ◇ [wf_2] workflow [›]
            │ 1/2 ■● · 1 agent en cours (sonnet) · 15 min
            └──── • coder · write t… sonnet · 12 min · 459K
proj-two · 2
│
└──── ● [PM BETA] conv [⌄]
      │ — · opus·med · 1 sous-conv · terminée [détails ›]
      │
      └──── ↳ [Lane beta] sous-conv 1.0M
proj-three · 1
│
└──── ● [Lane gamma] conv 500K
[Aujourd’hui ⌄] 17h → 19h · 2 conv.
Lane alpha · ta… ▕      ███████████████████████▓░░░░░░░░░ ▏
Lane delta       ▕                         ████▓│         ▏
                  17h       17h30     18h       18h30

[QUOTAS] 5 h ▰▱▱▱▱▱ 21 % sem ▰▰▰▰▰▱ 85 % 852 tok/s [›]
[DÉBIT] opus 56 · sonnet 88 · haiku 164 TPS (30 min) [›]
[GRAPHE] 8 conv · 3 coord · 1 t’attend(ent) [›]

Autres vues : /cockpit cartes · mission · focus · arbre · p…
```

- **EN COURS** (Julian, 20-21 Oct: « hard to see what is really running… » then « how do I know no work is in process? make it more visible: 0 workflow, 0 agent, 0 sub-agent, 0 CI »): a block at the **very top** of the Panneau, above À toi de cliquer. Line 1 « ● 2 conversations travaillent (1 fil principal) · fin ~18:55 · 1 bloquée »: the conversations at work, i.e. whose **main thread has a turn in progress** (its transcript written less than `panel.encours.busy_min` (2) minutes ago and the last assistant message did not end the turn: `mainThreadBusy` in `lib/core/activity.mjs`; the engine's own busy flag wins when a row has one) or whose Workflow / agent runs; how many of them by their main thread; the latest ETA; the blocked ones (« bloquée » / « bloquée ? » or a Workflow « à l’arrêt »; red, a click filters CONVERSATIONS on « t’attend »; a click on the conversations filters on « en cours »). Line 2 « ○ 0 workflow · ● 2 agents · ○ 0 sous-agent · ● 1 CI   voir › »: the live Workflows, the agents of a Workflow, the sous-agents (Agent tool outside a Workflow, foreground or background), the running / queued pipelines of the ci mod's cache `~/.claude/ci-pipelines-cache.json` (GitHub Actions and GitLab; `ciNow` in `lib/core/activity.mjs`, read again only when the file changes). **Zeros are shown, grey ○**; a non-zero count is green ●, amber when stalled, red when failed, and a click on it unfolds « En ce moment ». A cache older than `panel.encours.ci_stale_min` (15) minutes says « CI : non lu depuis 40 min » in grey instead of a 0. **Everything zero**: one green line « ✓ Rien ne tourne · tout est au repos · dernier fini il y a 12 min (name) » (and the grey CI line under it when the cache is stale). Counted over **every** conversation of the window, not only the top `panel.convs.top` (15) shown (`synthesis().every`; `enCours` in `lib/panel_conv.mjs`). Short of room the words get short (« 2 wf · 2 ag. · 1 s-ag. »), then the « · » go, then the buttons: a number, the CI one included, is never dropped. « En ce moment » also lists the running pipelines « ◆ repo · branch  job · 6 min ». **In the tree** each conversation states its activity in words: « travaille · fil principal », « travaille · 2 agents », « travaille · 1 wf », or « au repos depuis 12 min » (`convActivity`), dropped before its title is cut.
- **À toi de cliquer**: one amber line at the very top while a conversation waits for you (the app's `interruptedAwaitingPerson`, or the open question factory's scan detects), oldest first, with its reason and age; a click on its title opens it in the app. Nothing at all when nobody waits.
- **Fichiers**: data-goblin's file tree, embedded, folded by default (two mods' panes in one column become tabs, so it can only sit *above* the rest if Cockpit draws it). The tree's own logic is filetree's code, byte copies in `lib/filetree/` (`tree.ts`, `icons.ts`, `types/`, `LICENSE`, `NOTICE`), synced by `scripts/sync-libs.mjs` from `vendor/filetree`. Kept: folders on demand, git letters and branch, selection named to Claude (`panel.fichiers.attach_selection`, on by default, same words as filetree). Not here: search, preview, activity flashes, sizes, opening files: filetree's own pane (`/filetree`) still has them.
- **Compact tree** (Julian, 20 Oct: « make it clearer, more compact… too much info, needs more collapsible stuff »): a conversation's `›` / `⌄` now unfolds **only its children** (sub-conversations, running Workflows, running background agents, then « Terminés N › » for the finished ones, folded); it is unfolded by default while a Workflow, an agent or a sub-conversation of it runs (at most `panel.convs.tree_max`). Its micro details (context card, stats grid, model share, Ce qui contribue / Sankey, journal) are behind « détails › » at the right of its metrics line, **folded by default for every conversation, this one included**; the journal inside is folded too (« journal (6) › »). The metrics line counts what hangs under it: « ctx ▰▰▱ 42 % · 76M · opus·med · 2 wf · 5 agents en cours · 1 sous-conv   détails › »; no « Opus 5.5 · medium · travaille » line under it any more, and the hand-off warning is the red ⚠ on the row only. A conversation with nothing running and folded is **one line**, « ● title  conv  42 % · 507K », its bullet grey; running nodes are bold, finished ones grey. A Workflow's line says « 2 agents en cours (opus) » (« 3 agents en cours (2 opus, 1 sonnet) »; short of room « 2 agents en cours », then « 2 ag. », the same wording as the conversation lines and EN COURS). The shipped `cockpit.config.json` sets `panel.convs.unfold_max` to 0 again (it was 6, which unfolded six active conversations' full cards).
- **CETTE CONVERSATION** (`lib/panel_conv.mjs`, drawn by `hooks/panel_view.mjs`). Macro: one tree root, « └──── ● title  › » and under the title « ctx ▰▰▰▱ 30 % · $9.50 · 1 wf · 1 agent en cours » (the context bar with the hand-off mark at `panel.contexte.handoff_tokens`, the cost, model · effort, the state; past the hand-off a red ⚠ on the node line), then one child per running Workflow (or the background agents): « └──── ◇ package-wave  workflow  › » (then its running phase and agents, see « What runs right now » above) and « 2/4 ■■●□ · Wave B · 1 agent en cours (opus) · 40 min · fin ~18:55 » = done / count and one dot per agent (grey ■ done, ● running, grey □ pending, red ✕ failed), the running phase(s), how many agents run on which model, the elapsed time (or « à l’arrêt 1 h 10 » in amber when its agents wrote nothing for `panel.conv.stall_min` minutes), the ETA. Micro, on the conversation's `›`, inside the tree under its metrics line with the tree rule on its left: the Usage-like card (model · effort · state, the context row « Contexte  120K / 400K · relais 250K  30 % » over a full bar, the stats grid Coût / Tokens / Cache hit / Sous-agents / Agents / tok/s with fixed equal columns, the model share, « Ce qui contribue » on thin bars), « Terminés N › » (finished cards, Claude's mini cards), the session log (the last `log_max` events: agents started / finished, PR opened, PR merged). On a Workflow's `›` (⌄ once open): its tokens, cost, exact time and ETA, its Gantt, then its agents as dense children (no spacer between them), grouped by phase, one line each « • verify  sonnet · 15 min · 408K » (label, never « general-purpose », model family, time, tokens). A finished card under « Terminés N › » keeps Claude's mini card with its **Phases** and « Modèle … Temps » tables.
  The cost uses the same price table as every other row (then the row's own figure, then the engine's), « — » when unknown, never $0.00 for tokens spent. Every context bar is measured against one window: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` when set, else the engine's, else factory's `context_window`. A conversation with no Workflow nor agent and under `panel.conv.compact_tokens` unfolds to two lines (model · effort · state, the context inline) until « détails › ».
- **CONVERSATIONS · 6 travaillent · 2 t’attendent · 9 au repos** (Julian, 22 Oct 01:17: « it doesn't work, I don't see all ongoing conversations »: EN COURS said 6 conversations worked, GRAPHE 17, the list showed 2 rows « · 1 actives » because it was built from the usage mod's `classement.json` alone, the conversations that spent tokens since local midnight in a usage scan up to `rescan_min` old): built by `lib/panel_list.mjs` from **the same sessions as GRAPHE** (the app's session files, not archived, plus factory's scan), with **the activity of EN COURS** (`enCours().byCli`, the same factories: the header's « N travaillent » is EN COURS's figure) and the tokens of usage when it has them (« — » otherwise, never a reason to hide a row; a stale `classement.json` hides nothing). Listed: every conversation that works or waits, and the others active within the period (`panel.convs.period`, 24 h by default; « 1 h », « aujourd’hui », « 7 j » in the filter row; a row with tokens in the period counts as active in it). **Grouped like the app's sidebar**: one grey « proj-one · 6 » line per project (none when there is one group), the sub-conversations under their parent (`spawnedFrom`, wherever its project) with the tree glyphs, working ones first, then waiting, then by last activity; a parent unfolds by itself while a child works or waits. Each row: a node line (state mark, title, ⚠ past the hand-off, `›`) and a grey metrics line (context bar and %, tokens or « — », model · effort, its activity « travaille · fil principal » / « au repos depuis 12 min »), then its running Workflows, drawn as under Cette conversation. Its `›` unfolds « ouvrir ↗ » and its card, as Cette conversation's micro. Your folds are kept in `$.store` (key `cv:<cli>`, shared with the graph). « filtres › » unfolds the filter row (« 24 h ▾ » « Projet ▾ » « État ▾ » « Claude ▾ ») and the total; **a filter never hides a working conversation**: it stays listed and a grey « filtre : Projet x · État terminée (réinitialiser) » line says so, the button resets every filter (saves before 22 Oct drop their period, the old default). Short of room the header says « 6 trav. · 2 att. · 9 repos », then « 6● 2◆ 9○ ». Codex has no per-conversation figures: with « Codex » the list is one line from `codex.json`, by whole days. A conversation the scan has not read is « au repos » here even when GRAPHE guesses « travaille » from the app's last activity: whether it works is said by its transcript. **CETTE CONVERSATION** without a factory for this session (the scan has not read it yet) draws its row of the list with its activity line instead of « aucun agent ».
- **Aujourd’hui** (Gantt, Julian 19 Oct: « judicious visual diagrams… gantt »): right under the CONVERSATIONS rows, one track per active conversation (at most `panel.gantt.max_tracks`, 6), one bar per Workflow (or the background agents) over today's time axis with hour ticks: the colour of its dominant model (one palette for every diagram, `lib/viz_palette.mjs`: opus orange, sonnet blue, haiku green, fable violet, codex grey; overridable with `colors.model_<family>`), a lighter end while it runs, amber hatched when « à l’arrêt », red when failed, the estimated end as a dashed continuation, an amber « maintenant » line, a tiny legend. « Aujourd’hui ⌄ » folds it (kept in `$.store`, unfolded by default). A Workflow row unfolded (`›`) shows its own Gantt above Phases: one bar per agent grouped by phase, its ETA dashed. The Svg is a picture only: the clickable rows stay above it. Without Svg (terminal, text preview) the same bars are `▕███▓░░▏` rows (█ ran, ▓ running end, ▒ stalled or failed, ░ estimated, │ now) with an hour line under them. Code: `lib/viz_gantt.mjs` (pure model, `tests/viz_gantt.test.mjs`), `hooks/viz_gantt.mjs` (drawing); labels in `panel.gantt.labels`.
- **QUOTAS**: one line « 5 h ▰▰▱ 21 % · reset 2 h 10  sem ▰▰▰▰ 85 %  852 tok/s ›» (the reset goes first when short of room, then the bars get short, then they go). `›`: Claude's Usage rows: Session 5 h and Semaine with their reset in grey, Codex semaine while Codex is toggled, Crédits cloud when the engine reads a spend limit (« 249 $ sur 250 $ » and « expire le 5 nov 08:59 » under the bar when the engine gives the amounts; the engine's `SessionRateLimit` has only kind / percentUsed / resetsAt today, so the row shows the % and « montant non lu »), tok/s of all conversations.
- **DÉBIT** (Julian, 18 Oct, after Codex's « tokens per second » table): one line « opus 85 · sonnet 76 TPS (30 min) › » = the weighted TPS of each model in use over the shortest window that has replies (30 min, else 1 j…). `›` (« tableau »): one card per model **with a reply in the last 7 days** (`panel.debit.active_hours`), « Modèle : opus 5.5 » (Codex models only while « Codex » is toggled), a row per window 30 min / 1 j / 7 j / 30 j with Réponses · Tokens · Temps · TPS pondéré (sum of tokens ÷ sum of time) · Médiane · Plage (min–max), numbers right-aligned in fixed columns; under the pane's width Plage then Temps are left out (then the headers get short), numbers are never cut. The models with no reply in 7 days (only 30 j figures) are behind « anciens (N) › ». Then « 10 derniers flux »: « 18:29:48  opus 5.5 medium : 59.2 TPS (171 tok en 2.89 s) », TPS green at or above the model's 1 j median, grey under. The footnote is behind « comment c’est mesuré › »: the usage mod's scanner (`lib/core/transcripts.mjs`) times every API response once (message.id + requestId) from the last transcript line that sent it (the prompt or the tool result) to its last content block, so it includes the wait for the first token (the transcripts have no streaming events); tokens = output tokens, thinking included; under 50 tokens or over 30 min left out; effort per stream from the transcript line. It writes `debit.json`: TPS rows per `hour|model|effort` over the 31 kept days and every stream of the last hour, so **30 min** is exact and **1 j / 7 j / 30 j** are whole clock hours, medians and ranges read in x1.15 buckets (±7 %). Codex: `codex.json`, the same rule from Codex's own rollout files (task_started or a tool output → token_usage_record), by whole local days; « Codex : non lu » when it has no timings. Cached: `debit.json` is re-read only when its mtime changes, the model computed again only when a file, the minute or the Codex toggle changes. Code: `lib/debit.mjs` (pure), `drawDebit` in `hooks/panel_view.mjs`; settings `panel.debit` (windows, ref_window, recent, cards_max, active_hours, aliases).
- **GRAPHE** answers « who is active, who consumes, who coordinates, who is blocked or idle » (Julian, 17 Oct): one line « 6 conv · 1 coord · rien ne t’attend › ». `›`: one short legend line of coloured marks (● travaille green, ◆ attend amber, ✕ bloquée red, ✓ finie and ○ inactive grey: `panel.marks`, theme tones, the same everywhere; folded behind « Légende › » when the pane is too narrow), one filter row (« 24 h ▾ » cycles 24 h / 7 j / tout, « Projet ▾ », Actives, Archivées; default: last 24 h, archived hidden; kept in `$.store`) and one group per project like the app's sidebar (folder name of `originCwd`, worktrees folded into their repo; starred first). A group of 2+ has a small grey header and its rows indented, the children (`spawnedFrom`) under their parent; a group of one has no header, its project name is grey on the row. Each conversation is ONE line: state mark, title (cut), grey « coord » for a coordinator, tokens today · ctx % and a tiny context bar on the right; a second grey line only for a « ↖ lancée par » / « ⇢ message » relation. State: travaille when the latest of the app's `lastActivityAt`, the scan's activity and the transcript's mtime is under `panel.graphe.working_min` (2 min), or a Workflow / background agent of it runs; t'attend; bloquée; finie only after `panel.graphe.done_min` (10 min) idle with nothing running and a PR merged; else inactive; archivée. **The 24 h / 7 j filter tests the same latest sign of life, and a conversation that works, waits or is blocked is always listed** (19 Oct fix: the filter read the app's `lastActivityAt` alone, which hid conversations working for hours in one long turn, and the graph said « aucune conversation avec ces filtres » while 3 worked); a project filter kept in `$.store` for a project with no conversation left is ignored; a conversation factory's scan reads but whose session file was not read is drawn from the scan. A title (› / ⌄) unfolds that conversation's own factory under its row; « ouvrir ↗ » at the right opens it in the desktop app (the `claude://claude.ai/epitaxy/<id>` link « Depuis » already uses). Data: `scanner/cards.mjs` part `graphe` over `lib/core/sessions.mjs` `graphRow`, which keeps a fixed list of session-file fields (ids, title, folders, archived/starred, times, model, effort, spawnedFrom.sessionId, peerReceipts target + sentAt, interruptedAwaitingPerson, prs, branch) and never the prompts or settings; read at most every `panel.graphe.refresh_s` (60 s), whatever the folds (its line and À toi de cliquer are always drawn). Code: `lib/graphe.mjs` (pure model), `hooks/graphe_view.mjs` (drawing).
- **Diagrams** (Julian, 19 Oct: « judicious visual diagrams, colours, progression, sankey »), drawn as Svg on the desktop (a picture: the clickable rows stay next to it), a text fallback elsewhere, one palette (`lib/viz_palette.mjs`: opus orange, sonnet blue, haiku green, fable violet, codex grey; states green / amber / red / grey; theme keys for the texts, `prefers-color-scheme` inks inside the Svg). **Cette conversation** micro: a Sankey of its tokens, conversation → fil principal / each Workflow / background agents → models, width = tokens, colour = model (`lib/viz_sankey.mjs`), in place of « Ce qui contribue », which stays the text fallback. **QUOTAS** unfolded: under the 5 h and week bars, the curve of the window's readings (usage's `samples.jsonl`, `lib/core/usage.mjs` `claudeSeries`) with a dashed projection to the reset at the rate of the last hour (week: last day), red past 100 % with « à ce rythme : 100 % vers HH:MM » (`lib/viz_quota.mjs`; the sentence shows on every surface). **DÉBIT** unfolded: a 24 h TPS sparkline per model next to each table's title, one weighted point per hour (`lib/viz_spark.mjs`; ▁▇ characters as fallback). **GRAPHE** unfolded: the graph drawn above the list, a box per project, conversations in layers under their parent, arrows parent → child, dashed arrows for peer messages, colour = state, coordinators bigger, at most `panel.viz.graph_max` (20, the active first) and « +N » (`lib/viz_graph.mjs`). Drawing: `hooks/viz_*.mjs`; labels in `panel.viz.labels`.
- The engine has no line limit for a pane (it scrolls) but draws only the first 100,000 characters of a tree's texts: the macro view keeps a busy evening far under it (a test draws 6 busy conversations unfolded in both lists).
- The old views (Cockpit cards, Mission, Focus, Arbre, Pipeline, Workflow, Journal, Machine, Claude ↔ Codex, Galerie, Depuis, Nuit) open with `/cockpit <word>` (`/cockpit cartes` for the cards); on any of them the tab row shows, « Panneau » first, so the way back is one press. The left menu is not drawn on the Panneau (the band's buttons above the prompt do that job). `/cockpit panneau` opens it; `panel.enabled: false` makes the Cockpit tab the default again. Labels, order, limits: `panel` in `cockpit.config.json`.

**One of the 6 entries of the band's Mods bar** (Jauge, Cockpit, Veille, À toi, Registres, Référence).

**Cockpit** is the one zoomable view over all your agents (méga › projet › conversation › agent), read-only, French labels. It absorbs **Usine** (factory's screens) and **Machine** (PC and runner load) as tabs of the same pane, and adds the screens that serve one decision each: **Bilan avant la nuit** (behind the Nuit button), **Claude ↔ Codex** and **Galerie**. A vertical menu at the left runs the band's 6 entries:

```
[Jauge]     [Cockpit] [Mission] [Focus] [Arbre] [Pipeline] [Workflow] [Journal]
[Cockpit]   [Machine] [Claude ↔ Codex] [Galerie]
[Veille]    [Nuit] [Jour] [Codex]
[À toi]     [Méga] › [eta] › [Galaxy finalisation…] [↻] 18:54
[Registres]
[Référence]
╭ Qui consomme                                                   [Voir] ╮
│ aujourd’hui $461 · MODS 1 41 % · projet claude-control 52 %           │
│ T’attend  attend Julian : 2 · Ça t’attend : 1 · Fabric handoff [Voir] │
│ À toi     À toi : 5                                            [Voir] │
│ CI        2 pipelines en cours (Claude 1 · Codex 1), 1 rouge dans     │
│           app-c (job lint), runner local à 3/18                [Voir] │
│ Quota     Claude 5 h 24 % · semaine 14 % | Codex 5 h 10 % · semaine ? │
│ Problèmes du jour  2 vu(s) aujourd’hui · 1 ouvert(s) · en tête : …    │
│ En cours  • Workflow package-wave : fin vers 19:40                    │
│           • Pipeline app-b (codex/y) · Codex, depuis 2 min : vert ou  │
│             rouge vers 18:58                                          │
╰──────────────────────────────────────────────────────────────────────╯
[▾ Cette conversation] …
[▸ Ce projet · eta] 4 conv · 1 en cours · $7.00 aujourd’hui
[▸ Tous les projets] 2 en cours · 3 au repos · 1 attend Julian · $424
[▸ Qui consomme] aujourd’hui $461 · MODS 1 41 % · claude-control 52 %
[▸ Claude global] 5 h 24 % · sem 14 % · 1 alerte(s)
```

## Left menu

The band's 6 entries (Jauge, Cockpit, Veille, À toi, Registres, Référence) as a column at the left of every tab. A press runs that hub's command (`$.command.run`: a mod cannot open another mod's pane; band's « one hub open at a time » closes the others); a hub whose mod is not loaded gives a toast and runs nothing; « Cockpit » goes back to the Cockpit tab. Under `menu.min_columns` (50) it is one row on top. `menu.position` left | top | off, `menu.width`, `menu.items` (label, command, args, or self).

## Depuis ton dernier message (tab « Cockpit »)

Julian (17 Oct): « I wake up and want the summary of the night: problems, blockages, progress ». A primary button at the top of the Cockpit tab, or `/cockpit depuis [8h|24h|nuit|HH:MM]` (also `matin`, `since`), opens the « Depuis » screen. Zero tokens, read-only.

- **Since when**: by default Julian's **last real message in any conversation**: a user line with plain-string content in `~/.claude/projects/*/<id>.jsonl` (read from the end, newest file first), never a tool result, system reminder, task notification, ci-monitor event, a mod's slash command, meta / compact summary, or a message another session sent (`origin.kind` peer). A message younger than `skip_recent_min` (10) is skipped, so a « bonjour » typed before pressing the button does not cut the night; nothing in `lookback_days` (14): 24 h. Presets (`depuis.presets`): Ton dernier message, 8 h, 24 h, Nuit (the most recent 22:00); any « Nh », « Nmin » or « HH:MM » works as an argument.
- **Headline**: one French sentence, « Depuis 23:12 (8 h) : 9 PR mergées, 2 CI rouges, 3 conversations t'attendent, 14 $ dépensés », then when and where the last message was.
- **Per project** (foldable, most important first by `depuis.weights`, the first `open_groups` unfolded): T'attend (`lib/core/waiting.mjs` rows: question, wrap-up that needs an action, interrupted turn), CI rouge (the ci cache: lanes whose newest run is red and ran inside the window, plus `red_branches` main / master; since when, red jobs, « nouveau » when the streak started inside the window), Bloquée, Workflow en échec, Problème (new entries of the problemes register), À toi (a-faire `items.json`: added inside the window or due within `due_soon_days`), Mergée (`gh search prs --author @me --merged-at` and `glab api merge_requests?scope=created_by_me&state=merged`, read-only, cached `prs_ttl_s` in `~/.claude/effort-board/cockpit_depuis_prs.json`), Terminée (app session files: title and the first line of the last assistant message, « Ouvrir » (claude:// link, as Veille's Fil) and « Copier l'id »), Workflow terminé (factory's Workflow scan), and tokens / list-price $ since (every transcript line since, main, subagents and Workflow agents, deduped on message.id + requestId, `lib/core/transcripts.mjs`). What has no project goes to « Général ». Forge repos map to folder names through the ci cache's apps.
- **Nuit de la Veille**: `night-summary.json` (`/veille jour`) when it covers the window.
- **Demander un résumé à VEILLE**: shows the text to paste into the VEILLE conversation, with a Copier button; never sends it.
- Code: `lib/depuis.mjs` (pure model, every label and default in `DEPUIS_DEFAULTS`), `scanner/depuis.mjs` (the I/O, part `depuis` of `scanner/cards.mjs`), `hooks/depuis_view.mjs`. A busy night reads in a few seconds; nothing is read unless the screen is open.

## Nuit · Jour · Codex (tab « Cockpit »)

- **Nuit** opens **« Bilan avant la nuit »**, a decision screen: (1) what runs (Workflows, Agent-tool agents launched outside a Workflow, pipelines of Claude and Codex) with its end time and the hours left; (2) the night until `nuit.wake` (07:30): its hours, the hours used by what runs, the hours nobody uses (and how many items have no end time); (3) the quota: 5 h and week, what is left, and what the night would burn at the current week pace (`lib/core/usage.mjs` rate %/h × night hours; « inconnu » without a pace); (4) **Prêt à lancer**: lines of each recent repo's `handoff/ROADMAP.md` that match `nuit.ready_match` (unchecked boxes, « prêt », « ready »…) outside « Idées de Julian » and done sections, and packet files (`handoff/packets/*.md`, `handoff/PACKET-*.md`, `GO-*`, `LANE-*`, `BRIEF-*`). The repos are the folders of the conversations active in the last `day_night.recent_days` days (worktrees folded onto their repo) plus `day_night.repos`. Then the choice: **Nuit active** runs `/veille nuit`; **Lancer** on a ready item only *shows* the command that would start it (`cd "<repo>" ; claude --model opus --effort medium "Lis <source> et lance : <item>"`, `nuit.launch*`), it never starts a lane; **Rien** goes back to the Cockpit tab; **Jour** runs `/veille jour`.
- **Jour** runs `/veille jour` (mode légère + the night summary, Veille's).
- **Codex**: the cards are **Claude only by default** (`cards.who` = claude: CI, Quota and En cours count Claude's pipelines and quota); the button adds Codex for the session (« Codex ✓ »).

## Cards (tab « Cockpit »)

One line per topic, and a **Voir** button that runs the detail's command (`$.command.run`: a mod cannot open another mod's pane). The first target loaded in this session wins (`$.command.list()`, the same check band uses to grey a button); none loaded: a toast says which mod to add.

| Card | Line | Source | Voir |
|---|---|---|---|
| Qui consomme | top conversation and project of the window | usage's `classement.json` (same ranking code, `lib/usage`) | `/conso classement` |
| T’attend | « attend Julian : N » (veille) · « Ça t’attend : N » (factory's rows) · top of the Fil | `lib/core/veille.mjs`, `lib/core/waiting.mjs` | `/veille fil` |
| À toi | « À toi : N » | `lib/core/veille.mjs` (a-faire's `summary.json`) | `/afaire` |
| Claude Control | « N à faire · prochaine échéance 05/11 (dans 19 j) » and the 3 soonest; orange under 7 days, red under 1 | `~/.claude/a-faire/claude-control.md` (`- [ ] YYYY-MM-DD · priorité · quoi · …`, « — » = no date; `controle.*`) | `/afaire` |
| CI | the ci Diagramme's sentence: pipelines running (Claude / Codex split), red lanes with their red jobs, runner N/concurrent | ci's `~/.claude/ci-pipelines-cache.json`, `lib/core/runner.mjs` | `/reference ci diagramme`, else `/ci diagramme` |
| Quota | 5 h, semaine, run-out date, Claude and Codex | `lib/core/usage.mjs` (the same numbers as band and usage) | `/conso` |
| Problèmes du jour | how many seen today, open, the top one | problemes' `register.jsonl` (read-only) | `/registres problemes`, else `/problemes` |
| En cours | each running Workflow, Agent-tool agent launched outside a Workflow (background or not), and pipeline as a plain sentence + ETA | factory's Workflow scanner + estimates, factory's scan rows for the lone agents (ETA from finished agents of the same type), ci's ETA, else `lib/core/estimate.mjs` (≥ 3 past successes, else « pas assez d’historique ») | the Workflow tab |

The card data comes from `scanner/cards.mjs`, run with Node because the hooks module has no Node: it imports `lib/core` (usage, veille, runner, estimate). `lib/cards.mjs` holds the pure helpers `lib/core` lacks (the ci sentence from the cache, per agent, live pipelines, problems of the day). The same scanner reads the decision screens' data on demand (`parts`: nuit, relais, galerie), only while their tab is shown; `lib/decide.mjs` holds their pure models and every label (`DECIDE_DEFAULTS`).

## Tabs

- **Mission · Focus · Arbre · Pipeline · Journal**: factory's screens, drawn by the synced copies in `lib/factory` (a click on a conversation opens it in Arbre).
- **Workflow**: factory's Workflow screen (phases, agents, estimates, Gantt and Vitesse), then **Agents hors workflow**: the running Agent-tool agents launched outside a Workflow, background or not, with their ETA. Its Gantt is `lib/core/gantt.mjs`, the same renderer and symbols as the ci mod's Diagramme.
- **Claude ↔ Codex** (`/cockpit relais`): the ci mod's dataset `~/.claude/ci-cache/interactions.json` (`/ci relais refresh` writes it): per agent opened / fixed / merged PRs, CI green rate of their PRs and of their pipelines; the hand-offs (claude→codex…) and PRs with a dependency; per repo who opened how many PRs; the open PRs and those with a hand-off or a dependency (« #7 app · Codex +Claude · CI failed · relais codex→claude · dépend de #5 »).
- **Galerie** (`/cockpit galerie`): the Reference Gallery views the mods lacked (`docs/v6-research/jev-et-galerie.md` in claude-control). **Équipe**: the selected conversation as a team, lead (model · effort) then one lane per role (`galerie.roles`: Conseil = architect / Plan agents and the `/advisor` calls counted in the transcript; Workers; Relecteurs (adversaire) = verify / reviewer / auditor / adversary agents; Explorateurs; Chercheurs; Autres), each agent with « ↩ rendu au lead HH:MM », « en cours depuis … » or « ✕ échec ». **Lanes** (Agent-teams view): the selected conversation's project, one lane per worktree active in the last `galerie.lanes_days` days (the main checkout is one lane), each with its branch, conversations, PR and CI, and its reviewer / adversary agents with how they ended, or « aucun relecteur (adversaire) lancé » in orange; a conversation titled like a verify / review lane makes its lane a reviewer lane. **Séquence** (Visual explainer): the selected conversation as a text sequence diagram, a lifeline for the lead and each agent (`seq_agents` most recent), one arrow per call (lead ▶ agent) and per return (agent ◀ lead, ✕ on failure), the `/advisor` calls as ◆, the `seq_events` latest. **Doux / dur** (soft-control concept map): what the model reads and may stray from (rules, memory, skills, agent prompts) above what the harness enforces (permission mode, hooks, env, Workflow scripts, mods), each with this PC's count from the Carte (`galerie.concept`). **Carte**: the control layers in one map (rules title, settings env keys / hooks / permission mode, agents, skills, workflows, mods in CLAUDE_CODE_PLUGIN_DIRS, memory files): names and counts only, never values; plus « Connexion » (claude.ai, console…) when `$.session.identity()` answers (engine 2.1.299+, and only for a mod that managed settings install; otherwise the row is absent). **Codex**: approval policy per session and approval requests over `galerie.codex_days` (rollouts in `~/.codex/sessions`, read from a cached offset, only lines with « approval »), tokens per model (the usage mod's `codex.json`) and their API-equivalent cost (`galerie.codex_prices`, cached input not deducted; « tarif inconnu » otherwise).
- **Machine**: this PC (CPU, RAM, disks, GPU, process families) from the machine mod's sampler (`lib/machine/scanner/machine.py`, a synced copy) and the runner load from `lib/core/runner.mjs`.
- factory's **Quotas** and **Système** are not here: the Quota card and Machine replace them.

## Commands

`/cockpit [conv|projet|mega|agent] [projet ou conversation]` zooms the « Cockpit » tab; `/cockpit mission|focus|arbre|pipeline|journal|machine|relais|galerie|nuit` opens that tab (`codex` = relais, `bilan` = nuit); `/cockpit depuis [8h|24h|nuit|HH:MM]` opens « Depuis ton dernier message »; `/cockpit workflow [all]` the Workflow tab (this conversation, or every Workflow of the PC); `/cockpit close`.

**/factory** and **/machine** keep working. While their own mod is loaded it answers. When it is not, cockpit registers the name as an alias a few seconds after the session starts (`aliases.delay_s`, so the other mods have registered theirs): `/factory [onglet]` opens that tab (`quotas` → Cockpit, `systeme` → Machine), `/factory workflow [all]` the Workflow tab, `/machine` the Machine tab.

## Sections

| Section | Default | Shows |
|---|---|---|
| **Cette conversation** | open, selected | status line (model · effort, ctx, state), the lead tree holding it (lead → sub-conversations → Workflows → agents, model/effort/tokens/cost), the running Workflow and current step, PR/CI. Finished agents and Workflows fold behind « + N terminé(s) ». An agent selected: its card and log. |
| **Ce projet** | closed | the project's conversations as a tree (the app's `spawnedFrom` link, even lanes launched in another repo), then factory's **Focus** and **Pipeline** for that project |
| **Tous les projets** | closed | two lines per project: name and cost today, then counters (conv, en cours, attend Julian, agents, ctx max) |
| **Qui consomme** | closed | Toggle 1 h / aujourd’hui / 7 j (`qui_consomme.presets`), the top 3 conversations with cost and share, the top project, and **Classement complet** which runs `/conso classement` (the full ranking in the usage mod). Reads usage's `classement.json`; when it is older than `rescan_min` (10 min) and the section is open, runs usage's incremental scanner once. Same ranking code as usage (`lib/usage/lib/classement.mjs`, a synced copy). |
| **Claude global** | closed | Session (5 h), Semaine, Semaine Fable with bars and « reset dans … », cloud credits, this session's cost / model share / cache hit, Veille's open alerts, a button to the Machine tab. What the API does not give says « non lisible depuis un mod ». |

**Ouvrir l’agent**: on the card of a running agent of this very conversation, a button shows that agent's transcript in the main view (`$.ui.view({ agentId })`, engine 2.1.300+; a button press is the person-initiated call the engine requires), and « ← Conversation » goes back (`$.ui.view({})`) while an agent is in view. factory's Arbre (also the Cockpit's Arbre tab) has the same button on its running agents. On an older engine (`$.session.version()` below 2.1.300) neither button is drawn: a mod may not test `$.ui.view` as a value, so the version decides.

The breadcrumb (one small row) zooms out; a click on a node drills down and unfolds the section that shows it. The context gauge is not here: it is band's, above the prompt, where you look. A button at the bottom runs `/filetree`.

## Next to filetree

Both open by themselves at session start. The desktop shows **one pane at a time, the others as tabs** (docs: « With several panes open, each gets a tab that shows its title »), so Cockpit is a tab next to « Files: … » in the same right column, not stacked under it. A mod cannot draw inside another mod's pane, so the « Fichiers » button switches to filetree by running its command. Where exactly the desktop docks the column and how wide it makes it: non vérifié in the docs.

## Settings

`cockpit.config.json` (deep-merged with your own file: userConfig `config`, else `~/.claude/effort-board/cockpit.config.json`):

- `tabs.order` / `tabs.enabled` / `tabs.labels`: the tabs (`home` always first; `nuit` is enabled but not in the bar, its button opens it);
- `menu`: the left menu (position, min_columns, width, items);
- `depuis`: « Depuis ton dernier message » (presets, default, skip_recent_min, lookback_days, due_soon_days, red_branches, open_groups, weights, gh / glab, prs_ttl_s, labels; `enabled: false` removes the button and the tab);
- `day_night`: the Nuit · Jour row and the extra repos read for « Prêt à lancer »; `nuit`, `relais`, `galerie`, `controle`: the decision screens' and the Claude Control card's settings (every default and label in `lib/decide.mjs`);
- `cards.order` / `cards.enabled` / `cards.buttons` / `cards.max_encours` / `cards.who`: the cards, the targets their button tries in order, Claude only (`claude`) or Claude and Codex (`all`);
- `aliases`: `/factory` and `/machine` as aliases when their mod is not loaded (`delay_s`, `names`);
- `machine_refresh_s`, `gpu_every`: the Machine tab's sampling;
- `sections.order` / `sections.enabled` / `sections.open`: which sections (`breadcrumb`, `conv`, `project`, `all`, `global`, `fichiers`), in which order, which start unfolded (default `conv` only);
- `default_level`: `medium` (default: this conversation selected), `macro` or `mega`;
- `diagram.enabled`: the project tree also drawn as an SVG in « Ce projet » (off: it repeated the rows);
- `auto_open` (and userConfig `start`): open at session start;
- `refresh_s`, `strips_refresh_s`: refresh only while the pane is the one shown;
- `diagram`, `tree`, `colors`, `term_colors`, `labels`.

Prices, thresholds and the detail screens' labels are factory's (`lib/factory/factory.config.json` + `~/.claude/effort-board/factory.config.json`).

## Shared libs

A mod may import only files inside its own folder (`claude plugin validate`: « cannot import … it is outside the plugin's folder »). So `lib/` holds byte copies, listed in the repo's `lib/core/targets.json`: `lib/core` (the canonical shared readers), factory's view models, renderers and scanners (Workflow included, with its own `lib/factory/lib/core` estimate and Gantt), machine's sampler, band's gauge, veille's view model and usage's ranking. The owners stay the source of truth; never edit a copy:

```sh
node scripts/sync-libs.mjs          # after changing a source
node scripts/sync-libs.mjs --check  # what CI checks
```

## Preview

```sh
node mods/cockpit/scripts/preview.mjs --cols 75 --project datapass-claude-eta --conv "Galaxy finalisation autonome"
```

prints the four levels as text (every section unfolded) at a side-panel width from this PC's transcripts; `--defaults` prints the pane as it opens (this conversation selected, the other sections folded).

## Tests

```sh
node --test mods/cockpit/tests/nav.test.mjs     # navigation, breadcrumb, tree from fixture sessions, sections, lib drift
node --test mods/cockpit/tests/cards.test.mjs   # cards, tabs, aliases, scanner/cards.mjs over invented files
node --test mods/cockpit/tests/depuis.test.mjs  # Depuis ton dernier message: real-message filter, presets, red lanes, model, scanner over invented files
node --test mods/cockpit/tests/decide.test.mjs  # Nuit, Claude ↔ Codex, Galerie, Claude Control, the menu, the scanner parts
claude plugin test mods/cockpit               # auto-open, /cockpit, clicks, card buttons, tabs, menu, Nuit/Jour/Codex, /factory and /machine aliases, both surfaces
claude plugin validate mods/cockpit
```

Nothing here blocks, rewrites or adds to a prompt, and nothing calls a model. The only actions are buttons Julian clicks: another hub's command, `/veille nuit`, `/veille jour`, a card's detail, « Ouvrir » / « Copier » in Depuis; « Lancer » and « Demander un résumé à VEILLE » show text and never run or send it. Depuis calls `gh` and `glab` read-only (search and list), at most every `prs_ttl_s`.
