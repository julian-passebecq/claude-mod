# cockpit

## Panneau (default view, 17 Oct)

Opening Cockpit shows **one scrolling column with no tab bar at all**, every section foldable (what you fold, open and filter is kept in `$.store`), **Fichiers folded by default**. It is drawn like Claude's own **Usage** and **Background tasks** panes (Julian, 17 Oct 18:10), with our extra figures: cards with a bold title, rows « label … grey detail **value** » over a thin full-width bar (an `Svg` on the desktop, `▰▱` text on the terminal), small stats grids, phases with `■□` dots, no box-drawing borders; at 45, 60 or 75 columns the title is cut, never the numbers. The old views are reached by their `/cockpit` command only, listed in one grey line at the very bottom. `node mods/cockpit/scripts/preview.mjs --panneau --cols 60` (or 75) draws it from invented fixtures:

```
[▸ Fichiers] proj-one · main · sélection : src/panel.ts

[▾ Cette conversation]
 Lane alpha · tableau de bord
 Opus 5.5 · medium · en cours
 Contexte 120K / 400K · relais 250K 30 %
 ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱|▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱
 Coût                Tokens              Cache hit
 $9.50               5.1M                80 %
 Sous-agents         Agents              tok/s
 40 %                1/3                 667
 Modèles : Opus 100 %
 Ce qui contribue
 fil principal ▰▰▰▰▰▱▱▱▱ 60 %
 coder ▰▰▰▱▱▱▱▱▱ 30 %
 verify ▰▱▱▱▱▱▱▱▱ 8 %

 [package-wave ⌄]
 Workflow  4 agents fin vers 18:55 40m 00s
 ■■■□
 2.0M tokens  $9.40
 Phases
 [Wave A ›] 2/2 ■■
 [Wave B ⌄] 0/1 ■
   Modèle Temps
   ● Opus 5.5 20m 00s
     coder: cockpit-claude… · medium · 1.5M tok · 1250 tok/s
 [Merge ›] 0/1 □

 [Terminés 1 ›]

 Journal de la session
 17:42  ✓ explore-fast · find the tests terminé
 17:50  ▶ verify · wait for CI démarré
 18:00  PR #42 ouverte
 18:05  ✓ verify · wait for CI terminé
 18:10  ▶ coder · build the panel démarré
 18:20  PR #41 mergée

[▾ Toutes les conversations]
 [aujourd’hui ▾] [Projet ▾] [État ▾] [Claude ▾]

 ● Lane alpha · tableau de bord 3.6M ▰▰▰▰▰▰▰▱▱▱ 71 %
 ◆ Lane beta 1.0M ▰▰▱▱▱▱▱▱▱▱ 20 %
 ○ Lane gamma 500K ▰▱▱▱▱▱▱▱▱▱ 10 %
 Total aujourd’hui 5.1M · $16.50
 Workflows actifs
 [⌄] package-wave 380K 1/2 ■■
   Modèle Temps
   ● Opus 5.5
     coder · 300K tok
   ✓ Sonnet 5.5
     verify · 80K tok

[▾ Barres]
 Session 5 h reset dans 2 h 10 21 %
 ▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱

 Semaine reset dim 20:30 85 %
 ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱

 Crédits cloud montant non lu 12 %
 ▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱

 tok/s toutes conv 852 tok/s

[▾ Graphe des conversations]
 À toi de cliquer (1)
 ◆ [Lane beta]
   Choisir la version · depuis 2 h
 ● travaille ◆ attend ✕ bloquée ✓ finie ○ inactive
 [24 h ▾] [Projet ▾] [Actives] [Archivées]
 ★ proj-one · 4
    ● [Lane alpha · tab… ★ (ici)] coord 3.6M · ctx 30 % ▰▱▱▱
      ● [Package two] coord
       ⇢ PM BETA
        ○ [Package two · verify]
      ✓ [Package one: a rather long lane title that must …]
 proj-two · 2
    ○ [PM BETA] coord
      ◆ [Lane beta] 1.0M

Autres vues : /cockpit cartes · mission · focus · arbre · p…
```

- **Fichiers**: data-goblin's file tree, embedded (two mods' panes in one column become tabs, so it can only sit *above* the rest if Cockpit draws it). The tree's own logic is filetree's code, byte copies in `lib/filetree/` (`tree.ts`, `icons.ts`, `types/`, `LICENSE`, `NOTICE`), synced by `scripts/sync-libs.mjs` from `vendor/filetree`. Kept: folders on demand, git letters and branch, selection named to Claude (`panel.fichiers.attach_selection`, on by default, same words as filetree). Not here: search, preview, activity flashes, sizes, opening files: filetree's own pane (`/filetree`) still has them.
- **Cette conversation** (`lib/panel_conv.mjs`, drawn by `hooks/panel_view.mjs`): a Usage-like card for the lead (title, model · effort · state, the context row « Contexte  120K / 400K · relais 250K  30 % » over a bar with the hand-off mark at `panel.contexte.handoff_tokens`, a stats grid Coût / Tokens / Cache hit / Sous-agents / Agents / tok/s, the model share, « Ce qui contribue » with short bars), then one Background-tasks-like card per Workflow, folded by default as Claude's mini card: « package-wave › », grey « Workflow  4 agents  fin vers 18:55  40m 00s », one dot per agent (grey ■ done, amber ■ running, □ pending); unfolded: « 2.0M tokens  $9.40 » and **Phases** (each « Wave A › 2/2 ■■ », from factory's Workflow screen when it has the run, else one phase), each unfolding to Claude's table: a grey « Modèle … Temps » header, one row per agent « ✓ Sonnet 5.5 … 15m 00s » (amber ● while it runs) and a grey line under it with our extras (label, never « general-purpose », effort, tokens, tok/s); one card for the background agents; finished cards folded into « Terminés N › » like Claude's « Finished N › »; then the session log (the last `log_max` events: agents started / finished, PR opened, PR merged).
  A running Workflow (or agent) whose agents wrote nothing for `panel.conv.stall_min` (30) minutes shows an amber « à l’arrêt ? rien d’écrit depuis 1h 10m » and its conversation « bloquée ? »; written recently, the conversation « travaille » (never « au repos » next to a running phase), the same in Toutes les conversations. The cost uses the same price table as every other row (then the row's own figure, then the engine's), « — » when unknown, never $0.00 for tokens spent. Every context bar is measured against one window: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` when set, else the engine's, else factory's `context_window`. A conversation with no Workflow nor agent and under `panel.conv.compact_tokens` draws two lines (model · effort · state, the context inline) until « détails › ». The stats grid has fixed equal columns; « Ce qui contribue » uses the thin bars of Barres; a row past the hand-off threshold gets a red ⚠ while folded.
- **Toutes les conversations**: one filter row of cycling buttons (« aujourd’hui ▾ » « Projet ▾ » « État ▾ » « Claude ▾ »), then one line per conversation (state mark, title cut, tokens, the thin bar of Barres (Svg on the desktop), the share of the period), the usage mod's `classement.json` (tokens and list-price $ of the period), the state from factory's scan (en cours / t'attend / terminée), tok/s averaged over the last hour, the last line (the app's status or the last tool). Codex has no per-conversation figures: with « Codex » the table is one line from `codex.json`, by whole days. Under it: Workflows actifs (every Workflow of the PC: its name as plain text, the agent dots on the right, only the › arrow is a button; each unfolds to its agents) and the bars (5 h, Semaine, Codex semaine while « Codex » is on, tok/s of all conversations).
- **Barres**: Claude's Usage rows: Session 5 h and Semaine with their reset in grey, Codex semaine while Codex is toggled, Crédits cloud when the engine reads a spend limit (« 249 $ sur 250 $ » and « expire le 5 nov 08:59 » under the bar when the engine gives the amounts; the engine's `SessionRateLimit` has only kind / percentUsed / resetsAt today, so the row shows the % and « montant non lu »), tok/s of all conversations.
- **Débit** (Julian, 18 Oct, after Codex's « tokens per second » table; right after Barres, unfolded by default, the fold kept in `$.store`): one card per model in use, « Modèle : opus 5.5 » (Codex models only while « Codex » is toggled in Toutes les conversations), a row per window 30 min / 1 j / 7 j / 30 j with Réponses · Tokens · Temps · TPS pondéré (sum of tokens ÷ sum of time) · Médiane · Plage (min–max), numbers right-aligned in fixed columns; under the pane's width Plage then Temps are left out (then the headers get short), numbers are never cut. Then « 10 derniers flux »: « 18:29:48  opus 5.5 medium : 59.2 TPS (171 tok en 2.89 s) », TPS green at or above the model's 1 j median, grey under. **How time is measured** (the grey footnote says it too): the usage mod's scanner (`lib/core/transcripts.mjs`) times every API response once (message.id + requestId) from the last transcript line that sent it (the prompt or the tool result) to its last content block, so it includes the wait for the first token (the transcripts have no streaming events); tokens = output tokens, thinking included; under 50 tokens or over 30 min left out; effort per stream from the transcript line. It writes `debit.json`: TPS rows per `hour|model|effort` over the 31 kept days and every stream of the last hour, so **30 min** is exact and **1 j / 7 j / 30 j** are whole clock hours, medians and ranges read in x1.15 buckets (±7 %). Codex: `codex.json`, the same rule from Codex's own rollout files (task_started or a tool output → token_usage_record), by whole local days; « Codex : non lu » when it has no timings. Cached: `debit.json` is re-read only when its mtime changes, the model computed again only when a file, the minute or the Codex toggle changes. Code: `lib/debit.mjs` (pure), `drawDebit` in `hooks/panel_view.mjs`; settings `panel.debit` (windows, ref_window, recent, cards_max, aliases).
- **Every conversation's factory under its row** (Julian, 18 Oct): in Toutes les conversations and in the graph, a conversation unfolds UNDER itself to its live factory, drawn exactly as Cette conversation (model · effort · state, context bar, stats, its Workflow cards with phases and agent dots, background agents, Terminés N ›), one step in behind a thin grey « │ » rule; its Workflows one step further, their agents one more (the engine draws a Box border on all four sides only, so the rule is text). The data is factory's scan the cockpit already reads: every session row carries its sub-agents (workflow, status, models), and the Workflow screen's runs carry each run's `cli`; nothing new is read. Active conversations (travaille, attend, a running Workflow or agent) start unfolded with their Workflow cards open, at most `panel.convs.unfold_max` (6) of them; finie, inactive and archived start folded; this conversation's own row starts folded (it is the section above); your folds win and are kept in `$.store` (key `cv:<cli>`, shared by both lists). An empty line and a thin grey rule separate the sections and the unfolded conversations; section titles are bold, heading size where the surface has sizes. The engine has no line limit for a pane (it scrolls) but draws only the first 100,000 characters of a tree's texts: `unfold_max` keeps a busy evening well under it (a test draws 6 busy conversations in both lists).
- **Graphe des conversations** answers « who is active, who consumes, who coordinates, who is blocked or idle, what must I click » (Julian, 17 Oct). On top, **À toi de cliquer**: the conversations waiting for you (the app's `interruptedAwaitingPerson`, or the open question factory's scan detects), oldest first, with a short reason. Then one short legend line of coloured marks (● travaille green, ◆ attend amber, ✕ bloquée red, ✓ finie and ○ inactive grey: `panel.marks`, theme tones, the same in Toutes les conversations; folded behind « Légende › » when the pane is too narrow), one filter row (« 24 h ▾ » cycles 24 h / 7 j / tout, « Projet ▾ », Actives, Archivées; default: last 24 h, archived hidden; kept in `$.store` with the Panneau's) and one group per project like the app's sidebar (folder name of `originCwd`, worktrees folded into their repo; starred first). A group of 2+ has a small grey header and its rows indented, the children (`spawnedFrom`) under their parent; a group of one has no header, its project name is grey on the row. Each conversation is ONE line (Julian, 18 Oct): state mark, title (cut), grey « coord » for a coordinator, tokens today · ctx % and a tiny context bar on the right; a second grey line only for a « ↖ lancée par » / « ⇢ message » relation; a conversation waiting for you is a ◆ line there, its detail only in À toi de cliquer. State: travaille when the latest of the app's `lastActivityAt` and the transcript's mtime is under `panel.graphe.working_min` (2 min), or a Workflow / background agent of it runs; t'attend; bloquée; finie only after `panel.graphe.done_min` (10 min) idle with nothing running and a PR merged; else inactive; archivée. Role (coordinateur = spawned ≥ 1 session or a title matching `panel.graphe.coord_match` PM|COORD|VEILLE|ARCHI|MODS; lane = spawned by another; agent), tokens today (usage's `classement.json`, as section 4) and context % (factory's scan). **A title (› / ⌄) unfolds that conversation's own factory under its row; « ouvrir ↗ » at the right opens it in the desktop app** (the `claude://claude.ai/epitaxy/<id>` link « Depuis » already uses; À toi de cliquer still opens on a click). Data: `scanner/cards.mjs` part `graphe` over `lib/core/sessions.mjs` `graphRow`, which keeps a fixed list of session-file fields (ids, title, folders, archived/starred, times, model, effort, spawnedFrom.sessionId, peerReceipts target + sentAt, interruptedAwaitingPerson, prs, branch) and never the prompts or settings; read at most every `panel.graphe.refresh_s` (60 s) while the section is open. Code: `lib/graphe.mjs` (pure model), `hooks/graphe_view.mjs` (drawing).
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
