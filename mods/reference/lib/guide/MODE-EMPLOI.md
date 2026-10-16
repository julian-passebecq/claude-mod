# Mode d'emploi des mods

Le mode d'emploi de nos mods tels qu'ils sont sur `main` : les 6 entrées de la barre Mods et chacun de leurs onglets (ce qu'il montre, ce qu'on peut y faire, comment, d'où viennent les données, ses limites), ta journée, la nuit, ce qu'un mod peut ou ne peut pas faire, puis comment écrire un mod. Chaque fait sur Claude Code renvoie à la doc officielle ; ce qui n'y est pas est marqué **non vérifié**, et « non vérifié dans l'app » veut dire que seul le kit de test (`claude plugin test`) l'a fait tourner. Ce fichier est aussi le contenu de l'onglet Guide de Référence et du panneau `/mods-guide` : un `##` = un onglet, un `###` = une catégorie, un `####` = une sous-section.

Doc officielle : [vue d'ensemble](https://code.claude.com/docs/en/plugins/mods/overview) · [référence](https://code.claude.com/docs/en/plugins/mods/reference) · [événements](https://code.claude.com/docs/en/plugins/mods/events) · [interface](https://code.claude.com/docs/en/plugins/mods/interface) · [API](https://code.claude.com/docs/en/plugins/mods/api) · [créer](https://code.claude.com/docs/en/plugins/mods/create) · [tester](https://code.claude.com/docs/en/plugins/mods/test) · [admin](https://code.claude.com/docs/en/plugins/mods/admin)

<!-- toc:start -->
- [Démarrer](#démarrer)
  - [La barre Mods](#la-barre-mods)
    - [Les 6 entrées](#les-6-entrées)
    - [Ouvrir et fermer](#ouvrir-et-fermer)
    - [Un bouton grisé](#un-bouton-grisé)
  - [Ma journée](#ma-journée)
    - [1. Regarder la Jauge](#1-regarder-la-jauge)
    - [2. Ouvrir le Cockpit](#2-ouvrir-le-cockpit)
    - [3. Parler à la conversation VEILLE](#3-parler-à-la-conversation-veille)
  - [Anciennes commandes](#anciennes-commandes)
    - [Elles marchent toujours](#elles-marchent-toujours)
    - [Où elles vont](#où-elles-vont)
  - [Tes données](#tes-données)
    - [Où elles vivent](#où-elles-vivent)
    - [Ce qui n'en sort pas](#ce-qui-nen-sort-pas)
  - [Mettre à jour](#mettre-à-jour)
    - [Depuis Mes repos](#depuis-mes-repos)
    - [Après la mise à jour](#après-la-mise-à-jour)
- [Jauge](#jauge)
  - [La ligne au-dessus du prompt](#la-ligne-au-dessus-du-prompt)
    - [Ce que montre la Jauge](#ce-que-montre-la-jauge)
    - [D'où viennent les chiffres](#doù-viennent-les-chiffres)
    - [Limites de la Jauge](#limites-de-la-jauge)
  - [Passation](#passation)
    - [Passation conseillée](#passation-conseillée)
  - [Le panneau /jauge](#le-panneau-jauge)
    - [Le détail](#le-détail)
- [Cockpit](#cockpit)
  - [Onglet Cockpit](#onglet-cockpit)
    - [Les cartes](#les-cartes)
    - [Les sections](#les-sections)
    - [Ouvrir l'agent](#ouvrir-lagent)
    - [Nuit · Jour · Codex](#nuit--jour--codex)
    - [Données du Cockpit](#données-du-cockpit)
  - [Onglets de l'Usine](#onglets-de-lusine)
    - [Mission, Focus, Arbre, Pipeline, Journal](#mission-focus-arbre-pipeline-journal)
    - [Workflow](#workflow)
  - [Machine](#machine)
    - [Charge du PC et du runner](#charge-du-pc-et-du-runner)
  - [Claude ↔ Codex](#claude--codex)
    - [Qui passe la main à qui](#qui-passe-la-main-à-qui)
  - [Galerie](#galerie)
    - [Équipe, Lanes, Séquence](#équipe-lanes-séquence)
    - [Doux / dur, Carte, Codex](#doux--dur-carte-codex)
  - [Commandes et réglages du Cockpit](#commandes-et-réglages-du-cockpit)
    - [Commandes](#commandes)
    - [Réglages](#réglages)
- [Veille](#veille)
  - [Alertes](#alertes)
    - [Ce que montre Alertes](#ce-que-montre-alertes)
    - [Ack et modes](#ack-et-modes)
    - [Échéances et mods copiés](#échéances-et-mods-copiés)
  - [Fil](#fil)
    - [Ce que montre le Fil](#ce-que-montre-le-fil)
  - [À archiver](#à-archiver)
    - [Archiver en un lot](#archiver-en-un-lot)
  - [Export eta](#export-eta)
    - [Exporter vers eta](#exporter-vers-eta)
  - [Le veilleur](#le-veilleur)
    - [Réveil sûr](#réveil-sûr)
    - [Prévenir Julian](#prévenir-julian)
- [À toi](#à-toi)
  - [Les catégories](#les-catégories)
    - [Ce que montre À toi](#ce-que-montre-à-toi)
    - [D'où viennent les lignes](#doù-viennent-les-lignes)
  - [Agir sur une ligne](#agir-sur-une-ligne)
    - [Copier, Fait, Plus tard](#copier-fait-plus-tard)
    - [Limites d'À toi](#limites-dà-toi)
- [Registres](#registres)
  - [Problèmes](#problèmes)
    - [Ce que montre Problèmes](#ce-que-montre-problèmes)
    - [Agir sur Problèmes](#agir-sur-problèmes)
  - [Tests réels](#tests-réels)
    - [Ce que montre Tests réels](#ce-que-montre-tests-réels)
  - [Règles](#règles)
    - [Les règles marchent](#les-règles-marchent)
  - [Ménage](#ménage)
    - [Ce qu'il y a à nettoyer](#ce-quil-y-a-à-nettoyer)
  - [Réglages des Registres](#réglages-des-registres)
    - [Ordre et libellés](#ordre-et-libellés)
- [Référence](#référence)
  - [Config](#config)
    - [Toute la config](#toute-la-config)
  - [Guide](#guide)
    - [Ce mode d'emploi](#ce-mode-demploi)
  - [Scénarios](#scénarios)
    - [Modèle et effort par rôle](#modèle-et-effort-par-rôle)
    - [Appliquer ce scénario](#appliquer-ce-scénario)
  - [Santé](#santé)
    - [Les mods chargés](#les-mods-chargés)
  - [CI](#ci)
    - [Routage et Diagramme](#routage-et-diagramme)
  - [Onglet À essayer](#onglet-à-essayer)
    - [Les idées et leur état](#les-idées-et-leur-état)
  - [R&D](#rd)
    - [Les recherches](#les-recherches)
  - [Repos](#repos)
    - [Mes repos](#mes-repos)
- [La nuit](#la-nuit)
  - [Bilan avant la nuit](#bilan-avant-la-nuit)
    - [Ce que montre le Bilan](#ce-que-montre-le-bilan)
    - [Décider](#décider)
  - [Nuit et Jour](#nuit-et-jour)
    - [/veille nuit](#veille-nuit)
    - [/veille jour](#veille-jour)
  - [Ce qui tourne la nuit](#ce-qui-tourne-la-nuit)
    - [La tâche ClaudeVeille](#la-tâche-claudeveille)
  - [Ce qui ne tourne pas](#ce-qui-ne-tourne-pas)
    - [Ce que la nuit ne fait pas](#ce-que-la-nuit-ne-fait-pas)
- [Possible ou pas avec les mods](#possible-ou-pas-avec-les-mods)
  - [Ce qu'un mod peut faire](#ce-quun-mod-peut-faire)
    - [Montrer](#montrer)
    - [Agir sur clic](#agir-sur-clic)
    - [Nouveau en 2.1.299-301](#nouveau-en-21299-301)
  - [Ce qu'un mod ne peut pas faire](#ce-quun-mod-ne-peut-pas-faire)
    - [Le panneau d'un autre](#le-panneau-dun-autre)
    - [Importer hors de son dossier](#importer-hors-de-son-dossier)
    - [Lire le disque depuis les hooks](#lire-le-disque-depuis-les-hooks)
    - [Dessiner une image cliquable](#dessiner-une-image-cliquable)
    - [Ce qu'on s'interdit](#ce-quon-sinterdit)
- [À essayer](#à-essayer)
  - [Les cinq premiers](#les-cinq-premiers)
    - [Projects](#projects)
    - [claude agents](#claude-agents)
    - [/advisor](#advisor)
    - [/skill-doctor](#skill-doctor)
    - [Auto-continue](#auto-continue)
- [Écrire un mod](#écrire-un-mod)
  - [Bases](#bases)
    - [Un mod en une phrase](#un-mod-en-une-phrase)
    - [Les trois fichiers](#les-trois-fichiers)
    - [Où ils tournent](#où-ils-tournent)
  - [Événements](#événements)
    - [Observer, réécrire, répondre](#observer-réécrire-répondre)
    - [Les familles](#les-familles)
    - [Pourquoi on ne bloque jamais](#pourquoi-on-ne-bloque-jamais)
  - [Interface](#interface)
    - [Panneaux](#panneaux)
    - [Commandes slash](#commandes-slash)
    - [Notifications](#notifications)
  - [Configuration](#configuration)
    - [userConfig](#userconfig)
    - [Pas de valeur en dur](#pas-de-valeur-en-dur)
  - [Installer et activer](#installer-et-activer)
    - [Avec --plugin-dir](#avec---plugin-dir)
    - [Avec CLAUDE_CODE_PLUGIN_DIRS](#avec-claude_code_plugin_dirs)
    - [Depuis une marketplace](#depuis-une-marketplace)
    - [Éteindre les mods](#éteindre-les-mods)
  - [Tester](#tester)
    - [claude plugin validate](#claude-plugin-validate)
    - [claude plugin test](#claude-plugin-test)
    - [node --test et avant de pousser](#node---test-et-avant-de-pousser)
  - [Pas à pas : scenarios](#pas-à-pas--scenarios)
    - [Le besoin et les fichiers](#le-besoin-et-les-fichiers)
    - [Commande, panneau, avertissement](#commande-panneau-avertissement)
  - [Référence API](#référence-api)
    - [Les noms de $](#les-noms-de-)
    - [Temps et tailles](#temps-et-tailles)
- [Nos mods](#nos-mods)
  - [Fiches](#fiches)
    - [Fiche band](#fiche-band)
    - [Fiche cockpit](#fiche-cockpit)
    - [Fiche veille](#fiche-veille)
    - [Fiche a-faire](#fiche-a-faire)
    - [Fiche registres](#fiche-registres)
    - [Fiche reference](#fiche-reference)
    - [Fiche factory](#fiche-factory)
    - [Fiche control](#fiche-control)
    - [Fiche ci](#fiche-ci)
    - [Fiche scenarios](#fiche-scenarios)
    - [Fiche usage](#fiche-usage)
    - [Fiche guide](#fiche-guide)
    - [Fiche filetree](#fiche-filetree)
    - [Fiche machine](#fiche-machine)
    - [Fiche metrics](#fiche-metrics)
    - [Fiche sante](#fiche-sante)
    - [Fiche menage](#fiche-menage)
    - [Fiche problemes](#fiche-problemes)
    - [Fiche export-eta](#fiche-export-eta)
    - [Fiche tests-reels](#fiche-tests-reels)
  - [Archivés / rejetés](#archivés--rejetés)
- [FAQ et pièges](#faq-et-pièges)
  - [Pièges](#pièges)
    - [Mon mod ne fait rien](#mon-mod-ne-fait-rien)
    - [Un bouton refusé](#un-bouton-refusé)
    - [Lire une variable d'environnement](#lire-une-variable-denvironnement)
    - [La variable FUNCTION_HOOKS](#la-variable-function_hooks)
    - [Un panneau qui ne s'ouvre pas](#un-panneau-qui-ne-souvre-pas)
  - [Questions](#questions)
    - [Un mod est-il isolé](#un-mod-est-il-isolé)
    - [Un mod consomme-t-il des jetons](#un-mod-consomme-t-il-des-jetons)
<!-- toc:end -->

## Démarrer

Six boutons sous la Jauge, un par entrée. Tout est en lecture seule : un mod montre, il n'agit que sur un bouton que tu cliques.

### La barre Mods

#### Les 6 entrées

**Jauge** (`/jauge`, mod `band`) : la ligne au-dessus du prompt. **Cockpit** (`/cockpit`) : tous tes agents, zoomables. **Veille** (`/veille`) : alertes, fil des conversations, archivage, export. **À toi** (`/afaire`) : ce que toi seul peux faire. **Registres** (`/registres`) : problèmes, tests réels, règles, ménage. **Référence** (`/reference`) : config, ce guide, scénarios, santé, CI, à essayer, R&D, repos.

#### Ouvrir et fermer

Un clic lance la commande de l'entrée (`$.command.run`) et ouvre son panneau ; le bouton devient « Cockpit ✕ », un second clic ferme (`/cockpit close`). Une seule entrée ouverte à la fois (`launcher.single`). Pendant que Claude travaille, le bouton dit « en file : s'ouvre quand Claude a fini son tour » : une commande attend la fin du tour. ([api](https://code.claude.com/docs/en/plugins/mods/api))

#### Un bouton grisé

« non chargé : ajouter mods/<x> à CLAUDE_CODE_PLUGIN_DIRS » : ajoute `<dépôt>/mods/<x>` à la variable (bloc `env` de `~/.claude/settings.json`) et ouvre une nouvelle session. `launcher.preset: "all"` dans ton fichier de réglages de band remet les 15 anciens boutons. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

### Ma journée

#### 1. Regarder la Jauge

En arrivant : « ● N t'attendent » (rouge si N > 0) et « N à toi ». Zéro partout : rien ne t'attend. Le contexte et le relais disent si la conversation doit passer la main.

#### 2. Ouvrir le Cockpit

Les cartes en une ligne : qui consomme, qui t'attend, la CI, le quota, les problèmes du jour, ce qui tourne et quand ça finit. **Voir** ouvre le détail. Un nombre dans « T'attend » ou « À toi » : clique Voir, ou passe par l'entrée À toi.

#### 3. Parler à la conversation VEILLE

La conversation coordinatrice (titre « VEILLE 1 », démarrée avec `mods/veille/COORDINATEUR.md`, enregistrée par `/veille coordinateur`) lit l'état de la veille, merge ce qui est vert et à jour, relance une lane ou un Workflow arrêté, archive en un lot. Tu lui poses tes questions sur « qu'est-ce qui se passe » ; l'onglet Fil de Veille montre la même chose sans tokens.

### Anciennes commandes

#### Elles marchent toujours

Tant que l'ancien mod est chargé, sa commande et son panneau répondent comme avant. Une fois retiré de `CLAUDE_CODE_PLUGIN_DIRS`, la même commande, avec les mêmes mots, ouvre l'onglet de sa nouvelle entrée : l'entrée enregistre l'alias seulement quand personne d'autre ne sert ce nom (`$.command.list()` quelques secondes après le démarrage).

#### Où elles vont

| Ancienne | Nouvelle place |
|---|---|
| `/factory [onglet]`, `/machine` | Cockpit (Mission… Journal, Machine ; `quotas` → carte Quota, `systeme` → Machine) |
| `/conso` | mod usage (la carte Qui consomme et son bouton Classement complet y mènent) |
| `/problemes`, `/tests`, `/regles`, `/menage` | Registres |
| `/config-claude`, `/control`, `/mods-guide`, `/scenarios`, `/sante`, `/ci` | Référence (`/control` → Config) |
| `/export-eta` | Veille › Export eta |
| `/a-toi` | `/afaire` |

`/ci route` et `/ci clear` demandent le mod ci chargé.

### Tes données

#### Où elles vivent

Tout ce qui te concerne reste dans `~/.claude`, jamais dans le dépôt : `band/` (cache du scanner), `veille/` (état, alertes, fil, archives, nuit), `a-faire/` (résumé, état Fait / Plus tard, `claude-control.md`), `problemes/`, `tests-reels/`, `metrics-mod/`, `menage-mod/`, `reference-mod/`, `scenarios/`, `sante-mod/`, `mods-health/`, `usage-mod/`, `export-eta/`, `audit-exports/`, `effort-board/` (réglages perso, config de control), `ci-pipelines-cache.json`. Les transcripts lus sont ceux de `~/.claude/projects`.

#### Ce qui n'en sort pas

Le dépôt est public : ses tests n'utilisent que des données inventées. Aucun secret n'est affiché ni écrit : Config les masque avant d'écrire, Tests réels ne garde que l'endroit où vit un secret. Ce qui part vers eta ou dans un zip d'audit passe d'abord par le masquage d'export-eta ; un fichier où il reste un secret est retenu. (règle du dépôt)

### Mettre à jour

#### Depuis Mes repos

Référence › Repos : une carte par dépôt (branche, en retard / en avance, dernier commit, PR ouvertes). **Mettre à jour** fait `git pull --ff-only` seulement sur le checkout principal, sur `main` et propre, puis la commande d'après (claude-control : `python tools/deploy.py`, qui copie les règles dans `~/.claude`). Rien d'autre n'est touché.

#### Après la mise à jour

Les mods chargés par dossier tournent depuis ce dossier : une nouvelle session les prend à coup sûr, `/reload-plugins` dans la session ouverte. Le rechargement à chaud d'une session Desktop déjà ouverte : non vérifié dans l'app. ([reference](https://code.claude.com/docs/en/plugins/mods/reference), [overview](https://code.claude.com/docs/en/plugins/mods/overview))

## Jauge

Le mod `band`, au-dessus du prompt, toujours visible. Commande : `/jauge`.

### La ligne au-dessus du prompt

#### Ce que montre la Jauge

Par défaut deux lignes (`gauge.style: two_lines`) : « ● N t'attendent · N à toi │ contexte N % (relais 250 K) », puis « 5 h N % · sem N % · Codex N % │ N agents · N conv actives │ tok/s tout · ce projet · cette conv │ CPU · GPU », et les boutons des entrées. Le style `compact` en fait une ligne avec une barre fine du contexte (repères relais et auto-compact) et un ▸ qui déplie « Cette conversation » (modèle · effort, agents, Workflow, PR).

#### D'où viennent les chiffres

Contexte et limites : `$.session.usage()` et `session.measure`. Débit et agents : les transcripts de `~/.claude/projects`, lus en incrémental par `scanner/scan.mjs` (Node). « t'attendent » et « à toi » : `lib/core/veille.mjs`, le même compte que Cockpit et Veille (`~/.claude/veille`, `~/.claude/a-faire/summary.json`). Quota Codex : `~/.claude/usage-mod`. CPU et GPU : échantillon de `machine`.

#### Limites de la Jauge

Un chiffre absent laisse son champ vide ; une ligne trop large perd ses champs dans l'ordre `drop_order`. Effort lu dans `CLAUDE_EFFORT` : non vérifié pour un mod. Compaction au repos (2.1.299, ~54 min) : non vérifiée dans la doc. Tout se règle dans `band.config.json` (champs, ordre, libellés).

### Passation

#### Passation conseillée

Ligne orange quand le contexte atteint 250 K (règle RESUME) ou que l'auto-compact est prévu dans 20 min. **Préparer RESUME** lance `/handoff` (grisé si le skill n'est pas dans la session) ; **Ouvrir RESUME** affiche `handoff/RESUME.md` dans le panneau /jauge avec son âge. Rien ne se lance seul. Seuils et libellés : bloc `handoff`.

### Le panneau /jauge

#### Le détail

Contexte face à l'auto-compact et au seuil de relais, débit en tok/s par périmètre (cette conv, conv + agents, projet, tout le PC), sessions les plus actives, compactages des 24 dernières heures, les 3 derniers relais. Le seuil d'auto-compact vient du moteur ; sinon 92 % (`autocompact_pct_fallback`).

## Cockpit

Une seule vue zoomable sur tous tes agents : méga › projet › conversation › agent. Commande : `/cockpit [onglet]`. À gauche, le menu des 6 entrées (en haut sous 50 colonnes).

### Onglet Cockpit

#### Les cartes

Une ligne par sujet et un bouton **Voir** : **Qui consomme** (conversation et projet en tête ; `/conso classement`), **T'attend** (attend Julian, Ça t'attend, tête du Fil ; `/veille fil`), **À toi** (`/afaire`), **Claude Control** (tes échéances de `~/.claude/a-faire/claude-control.md`, orange sous 7 j, rouge sous 1 j), **CI** (pipelines, rouges avec leur job, runner N/concurrent ; `/reference ci diagramme`), **Quota** (5 h, semaine, date d'épuisement ; `/conso`), **Problèmes du jour** (`/registres problemes`), **En cours** (chaque Workflow, agent hors Workflow et pipeline en phrase simple avec son heure de fin estimée). Voir prend la première cible chargée ; aucune : un toast dit quel mod ajouter.

#### Les sections

**Cette conversation** (ouverte : modèle · effort, contexte, arbre lead → sous-conversations → Workflows → agents, PR / CI), **Ce projet** (conversations en arbre, Focus et Pipeline), **Tous les projets** (deux lignes par projet), **Qui consomme** (1 h / aujourd'hui / 7 j), **Claude global** (5 h, semaine, crédits, alertes). Un clic sur un nœud descend, le fil d'Ariane remonte. Ce que l'API ne donne pas dit « non lisible depuis un mod ».

#### Ouvrir l'agent

Sur la carte d'un agent en cours de cette conversation, le bouton montre son transcript dans la vue principale (`$.ui.view({ agentId })`, moteur 2.1.300+), « ← Conversation » revient. Sur un moteur plus ancien, le bouton n'est pas dessiné. Non vérifié dans l'app.

#### Nuit · Jour · Codex

**Nuit** ouvre « Bilan avant la nuit » (voir l'onglet La nuit), **Jour** lance `/veille jour`. **Codex** ajoute Codex aux cartes CI, Quota et En cours pour la session (« Codex ✓ ») ; par défaut elles ne comptent que Claude (`cards.who`).

#### Données du Cockpit

`scanner/cards.mjs` (Node) lit `lib/core` (usage, veille, runner, estimate), le `classement.json` d'usage, le cache de ci, le registre de problemes et les scans de factory. Heure de fin : médiane d'au moins 3 succès passés, sinon « pas assez d'historique ». Rafraîchi seulement quand le panneau est celui qu'on voit.

### Onglets de l'Usine

#### Mission, Focus, Arbre, Pipeline, Journal

Les écrans de factory, dessinés par leurs copies : Mission (la vue d'ensemble), Focus (« Ça t'attend » : PR verte non mergée, question, lane arrêtée), Arbre (un clic sur une conversation l'y ouvre), Pipeline (étape déduite des sessions, PR et CI : non vérifié), Journal. Quotas et Système de factory sont remplacés par la carte Quota et Machine.

#### Workflow

Phases, agents, estimations, Gantt et Vitesse du Workflow de cette conversation (`/cockpit workflow all` : ceux du PC), puis « Agents hors workflow » avec leur heure de fin.

### Machine

#### Charge du PC et du runner

CPU, RAM, disques, GPU et familles de processus, échantillonnés par le sampler de machine (copie dans cockpit), et la charge du runner local (`lib/core/runner.mjs`). `/cockpit machine` ou `/machine`. Enfants du runner = jobs locaux : non vérifié.

### Claude ↔ Codex

#### Qui passe la main à qui

`/cockpit relais`. Par agent : PR ouvertes, corrigées, mergées, taux de vert de la CI ; les passages de main (claude→codex…), les PR qui dépendent d'une autre, qui a ouvert combien de PR par dépôt. Données : `~/.claude/ci-cache/interactions.json`, écrit par `/ci relais refresh` (rien n'est lu sans).

### Galerie

#### Équipe, Lanes, Séquence

`/cockpit galerie`. **Équipe** : la conversation choisie en équipe, lead puis une ligne par rôle (Conseil, Workers, Relecteurs, Explorateurs, Chercheurs), chaque agent avec « rendu au lead HH:MM », « en cours » ou « échec ». **Lanes** : une ligne par worktree actif du projet (branche, PR, CI, relecteur ou « aucun relecteur lancé » en orange). **Séquence** : le lead et ses agents en diagramme de séquence texte, `/advisor` en ◆.

#### Doux / dur, Carte, Codex

**Doux / dur** : ce que le modèle lit et peut ignorer (règles, mémoire, skills) au-dessus de ce que le moteur impose (permissions, hooks, env, Workflows, mods). **Carte** : les couches de contrôle en noms et nombres, jamais les valeurs ; « Connexion » seulement si `$.session.identity()` répond (2.1.299+, mod installé par les réglages gérés). **Codex** : politique d'approbation et tokens par modèle. Non vérifié dans l'app.

### Commandes et réglages du Cockpit

#### Commandes

`/cockpit [conv|projet|mega|agent] [nom]` zoome ; `/cockpit mission|focus|arbre|pipeline|journal|machine|relais|galerie|nuit` ouvre l'onglet ; `/cockpit workflow [all]` ; `/cockpit close`. Le Cockpit s'ouvre seul au démarrage (`auto_open`), à côté de filetree, en onglet de la même colonne.

#### Réglages

`cockpit.config.json`, fusionné avec `~/.claude/effort-board/cockpit.config.json` : onglets (ordre, libellés), menu, cartes (ordre, boutons, `who`), sections ouvertes, niveau de départ, Nuit, Galerie, couleurs, libellés. Prix et seuils des écrans de l'Usine : ceux de factory.

## Veille

Un script sans tokens (tâche Windows `ClaudeVeille`) fait le tour des conversations, PR et CI ; le panneau montre ce qu'il a vu. Quatre onglets, `/veille [onglet]`.

### Alertes

#### Ce que montre Alertes

Le mode du veilleur et ses boutons, les alertes (gravité, depuis quand, lien), le dernier tour (rouge s'il en manque deux), les actions faites avec leur raison, et le bilan de nuit pendant 16 h après `/veille jour`. « attend Julian : N » une fois, dans la barre d'onglets. Données : `~/.claude/veille/state.json`, `heartbeat.json`, `acks.jsonl`.

#### Ack et modes

**Ack** (ou `/veille ack <clé|all>`) range une alerte vue. `/veille mode <x>` : **Rien** (éteinte), **Légère** (un tour / 30 min, prévient seulement, zéro token), **Active** (5 min, réveille la lane ou le coordinateur), **Nuit active** (10 min, merge le vert à jour, réveille, ne notifie que ce qui t'attend). `/veille tour` lance un tour tout de suite.

#### Échéances et mods copiés

Chaque tour lit tes échéances (`~/.claude/a-faire/claude-control.md`) : alerte à J-7, nouvelle alerte à J-1. Tous les 7 jours, il compare la version des mods copiés (filetree) à leur dernière release ; une plus récente est une alerte info.

### Fil

#### Ce que montre le Fil

`/veille fil` : le dernier message de chaque conversation, par projet, lead → sous-conversations, et en tête les réveils (conforme / écart / erreur). « Ouvrir la conversation » passe un lien `claude://` au système : arrivée sur la session non vérifiée, « Copier l'id » en secours. Données : `~/.claude/veille/fil.json`.

### À archiver

#### Archiver en un lot

`/veille archiver` : les conversations terminées que la conversation VEILLE peut archiver en un lot, « Copier la liste des ids ». Sont exclues : les épinglées, celles qui t'attendent, la plus récente de chaque projet, les rôles, tout ce qui a bougé récemment. Le panneau n'archive rien lui-même (pas d'API pour un mod). Données : `~/.claude/veille/archive.json`.

### Export eta

#### Exporter vers eta

`/veille export` : le lot de conversations terminées prêt, pourquoi il est prêt, ses conversations, les derniers exports. **Exporter vers eta** lance l'exporteur d'export-eta : masquage, worktree neuf du dépôt eta, PR, merge squash. **Rafraîchir** recompte. Données : `~/.claude/export-eta/pending.json`, `state.json`.

### Le veilleur

#### Réveil sûr

Un réveil démarre un `claude -p` neuf (jamais `--resume`) avec le modèle, l'effort et le mode de permission lus dans le fichier de session de la cible, dans son dossier, avec un brief de 10 lignes au plus. Chaque réveil est vérifié dans le transcript ; un écart devient un problème. Seulement dans les modes qui réveillent, dans leur budget de tokens.

#### Prévenir Julian

Pas de push téléphone documenté pour un script : l'e-mail (si `smtp.json` est rangé) arrive par l'app mail. Le veilleur écrit aussi son état de santé dans `~/.claude/mods-health/veille.json`, que Registres › Problèmes reprend.

## À toi

Tout ce que toi seul peux faire, au même endroit. `/afaire [refresh|close]` (alias `/a-toi`).

### Les catégories

#### Ce que montre À toi

Par catégorie : **Configuration**, **Claude Control** (tes échéances), **Décisions**, **Connexions / 2FA**, **Secrets à ranger**, **Tests manuels**, **Questions des conversations**. Chaque ligne : pourquoi elle bloque, les étapes exactes, depuis quand, sa source.

#### D'où viennent les lignes

`manual-checks.md` et `questions.md` de `~/.claude/effort-board` (seulement les questions qui t'attendent), les décisions en attente des backlogs, `~/.claude/a-faire/claude-control.md` (une ligne `- [ ] AAAA-MM-JJ · priorité · quoi · pourquoi · comment`), tes PR ouvertes qui te nomment, la Veille, `smtp.json`, la tâche Windows, les mods présents mais non chargés, les secrets du registre Tests réels. Le scanner écrit `~/.claude/a-faire/summary.json` (des nombres seulement), lu par la Jauge et le Cockpit.

### Agir sur une ligne

#### Copier, Fait, Plus tard

**Copier** copie les étapes. **Fait** la range ; sur une ligne mesurée (smtp.json, mods, tâche, secrets), Fait revérifie et refuse tant que la cause est là. **Plus tard** la cache un jour (`snooze_days`). C'est le seul état écrit, dans `~/.claude/a-faire` ; aucune source n'est modifiée, aucune commande montrée n'est lancée.

#### Limites d'À toi

Format du registre Tests réels : non vérifié. La copie installée de la veille ne prend le flux qu'après `node veille.mjs install`.

## Registres

Quatre registres dans un panneau : Problèmes, Tests réels, Règles, Ménage. `/registres [onglet]`. Chaque onglet dessine exactement ce que dessine son mod d'origine, depuis les mêmes fichiers ; Registres n'écrit rien à lui.

### Problèmes

#### Ce que montre Problèmes

Le registre des problèmes repérés dans les transcripts et les mods : questions en attente, refus de permission, gardes de l'app, fins BLOCKED, Workflows en erreur, `gh` / `glab` en échec, erreurs API, erreurs de Santé et de Veille (catégorie Mods). Dédoublonné par signature, avec compte, dernière vue, et réouvert s'il revient.

#### Agir sur Problèmes

`/registres problemes P-012` ouvre un problème, `refresh [--force]` relance le scan, **Exporter vers eta** (ou `export`) envoie le registre masqué vers le dépôt eta par PR. Données : `~/.claude/problemes`.

### Tests réels

#### Ce que montre Tests réels

Par application : environnements (tenant, cloud, local, docker), comptes de test, procédures et derniers essais (vert, rouge, jamais), « jamais testé en réel », et en haut « À ranger » (secrets vus en clair, non enregistrés). Les identifiants restent masqués jusqu'à « voir », un par un ; un secret n'est jamais stocké ni montré, seulement où il vit (Gestionnaire d'identification Windows). **Lancer la récupération** relit les transcripts. Données : `~/.claude/tests-reels`. Détection des secrets heuristique.

### Règles

#### Les règles marchent

`/registres regles [V5.8]` : pour une version des règles, par jour, PR mergées, tokens et coût par PR, part Opus / Sonnet / Haiku, agents lancés avec un modèle nommé, tours ≥ 250 K, refus de permission, gardes, creux CI, BLOCKED, réveils, compactages ; courbes avec les versions en repères, tableau avant / après. Les attentes de permission non comptées (seuls les refus), le modèle des agents de Workflow lu dans le script : non vérifié. Données : `~/.claude/metrics-mod`.

### Ménage

#### Ce qu'il y a à nettoyer

Worktrees (mergé ou non, propre ou modifié, âge, taille), branches déjà mergées, copies de mods non chargées, sauvegardes de deploy, dossiers temporaires, sessions archivables, avec les totaux récupérables (« mergée » = dans `origin/main` au dernier fetch, ou même contenu en squash). Rien n'est supprimé ni lancé : chaque ligne a sa commande sûre (`git worktree remove` sans `--force`, `git branch -d`) et un bouton **Copier** ; « ne pas supprimer » en rouge. Données : `~/.claude/menage-mod`.

### Réglages des Registres

#### Ordre et libellés

`registres.config.json`, fusionné avec `~/.claude/registres/registres.config.json` : ordre des onglets, onglets cachés, onglet de départ, alias, libellés. Les scanners tournent sur ↻ ou quand le fichier de l'onglet est plus vieux que le `refresh_min` du mod d'origine.

## Référence

Ce qu'on consulte : config, guide, scénarios, santé, CI, idées, recherche, repos. `/reference [onglet]`, huit onglets.

### Config

#### Toute la config

`/reference config [scan]` : toute la config de Claude Code en arbre catégorie → élément (chemin, date, taille, contenu), recherche partout, changements des 7 derniers jours, secrets masqués avant d'être écrits. Données : `~/.claude/effort-board/control/config-claude.json`, écrit par le scanner de control. Drapeaux `--settings`, Remote Control par défaut : non lisibles depuis un mod.

### Guide

#### Ce mode d'emploi

`/reference guide [section]` (ou `/mods-guide`) : ce fichier, avec Sommaire, onglets, catégories dépliables et les fiches « Nos mods » relues en direct depuis les mods voisins. Un lien du Sommaire ouvre l'onglet et déplie sa catégorie.

### Scénarios

#### Modèle et effort par rôle

`/reference scenarios [S1..] [prompt|agent|workflow|frontmatter|env]` : pour chaque rôle (lead, codeurs, revue, tests, recherche), modèle, effort, unité et parallélisme, avec la doc qui le prouve et un extrait à copier.

#### Appliquer ce scénario

Écrit le choix dans `~/.claude/scenarios/applied.json` (l'ancien gardé) et montre, rôle par rôle, l'écart avec `settings.json`, les agents et l'env. Il ne modifie **jamais** les réglages : l'écart dit quoi changer à la main.

### Santé

#### Les mods chargés

`/reference sante [refresh]` : chaque mod chargé ou non, versions, commandes, caches, erreurs, CPU des scans. Les commandes de nettoyage sont montrées avec Copier. Données : `~/.claude/sante-mod/report.json` et `~/.claude/mods-health/*.json`.

### CI

#### Routage et Diagramme

`/reference ci [diagramme] [claude|codex|inconnu|tout] [hote|app|conv]` : où tourne la CI de chaque dépôt, et le Diagramme (phrase en tête, Gantt texte par pipeline, heure de fin estimée, part Claude / Codex). Lecture `gh` / `glab` seulement sur Rafraîchir ou cache trop vieux ; une commande de log par job rouge, montrée, jamais lancée.

### Onglet À essayer

#### Les idées et leur état

`/reference essais` : chaque fonction ou idée des documents de recherche (une par ligne de tableau), avec le test proposé, coût, risque, intérêt. Le bouton d'état tourne jamais → en test → adopté → écarté et l'écrit dans `~/.claude/reference-mod/essais.json`. Dessous, « Ce qu'on doit tester » (vérifications manuelles ouvertes). Résumé dans l'onglet À essayer de ce guide.

### R&D

#### Les recherches

`/reference rd` : index des dossiers de recherche (date, sujet, résumé en 3 lignes, sources, état des idées), **Ouvrir**, **Exporter vers eta** (masqué, par PR) et **Exporter pour audit** (`/audit-export` : un zip daté dans `~/.claude/audit-exports`, chaque fichier masqué puis revérifié ; jamais de transcripts ni de jetons).

### Repos

#### Mes repos

`/reference repos [refresh]` : une carte par dépôt avec **Mettre à jour**, **Exporter**, **Ouvrir sur GitHub**, **Dossier** (voir Démarrer › Mettre à jour). `git` sans fetch, PR de `gh` en cache. Dépôts listés dans `~/.claude/reference-mod/reference.config.json`.

## La nuit

Avant de dormir : un écran pour décider, un bouton pour passer en mode nuit, un bilan le matin.

### Bilan avant la nuit

#### Ce que montre le Bilan

Cockpit › **Nuit** (ou `/cockpit nuit`) : (1) ce qui tourne (Workflows, agents, pipelines) avec son heure de fin et les heures restantes ; (2) la nuit jusqu'à 07:30 (`nuit.wake`) : heures utilisées, heures que personne n'utilise ; (3) le quota 5 h et semaine, et ce que la nuit brûlerait au rythme de la semaine (« inconnu » sans rythme) ; (4) **Prêt à lancer** : les lignes prêtes des `handoff/ROADMAP.md` et les paquets (`handoff/packets/*.md`, `GO-*`, `LANE-*`…) des dépôts actifs.

#### Décider

**Nuit active** lance `/veille nuit`. **Lancer** sur un élément prêt **montre** seulement la commande qui le démarrerait (`claude --model opus --effort medium "Lis … et lance : …"`) : il ne lance jamais de lane. **Rien** revient au Cockpit.

### Nuit et Jour

#### /veille nuit

Passe la veille en **Nuit active** et note l'heure de début dans `~/.claude/veille/config.json`. Bouton « Nuit » de l'onglet Alertes ou du Cockpit.

#### /veille jour

Repasse en **Légère** et écrit le bilan de la nuit (merges, échecs, ce qui t'a attendu, réveils) dans `~/.claude/veille/night-summary.json` ; la commande le répond et Alertes le montre 16 h.

### Ce qui tourne la nuit

#### La tâche ClaudeVeille

La tâche Windows `ClaudeVeille` tourne toutes les 5 min, un tour toutes les 10 min en Nuit active : alertes, e-mail, merge des PR/MR dont chaque check est vert et la branche à jour, réveil sûr d'une lane ou d'un Workflow arrêté, dans un budget de 600 K tokens/h. Les Workflows et pipelines déjà lancés continuent.

### Ce qui ne tourne pas

#### Ce que la nuit ne fait pas

Aucune lane nouvelle ne démarre seule (Lancer ne fait que montrer). Les mods eux-mêmes ne tournent que dans une session ouverte et n'appellent aucun modèle. PC en veille : rien ne tourne. Pas de push téléphone. Reprise après limite de quota : seulement si « Auto-continue when limits reset » est coché (non confirmé, voir À essayer).

## Possible ou pas avec les mods

Ce que l'API des mods permet, et ce qui explique la forme de nos entrées. ([api](https://code.claude.com/docs/en/plugins/mods/api), [interface](https://code.claude.com/docs/en/plugins/mods/interface))

### Ce qu'un mod peut faire

#### Montrer

Dessiner ses propres panneaux, une zone au-dessus du prompt, une ligne de statut, des toasts ; enregistrer des commandes slash ; lire des fichiers (`$.fs`), lancer un programme sans shell (`$.process.run`, 10 min max), garder un état partagé par les sessions (`$.store`). ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Agir sur clic

Un bouton lance une commande slash (`$.command.run`), « comme si la personne l'avait tapée », après le tour en cours : c'est ainsi qu'une entrée en ouvre une autre. Copier (`$.ui.copy`), ouvrir un lien. ([api](https://code.claude.com/docs/en/plugins/mods/api))

#### Nouveau en 2.1.299-301

`$.session.identity()` (le compte connecté : utilisé par la Carte de la Galerie, réponse seulement pour un mod installé par les réglages gérés), `$.ui.view({ agentId })` (montrer le transcript d'un agent : bouton « Ouvrir l'agent », 2.1.300+, sur un geste de la personne), l'événement `prompt.change` (non utilisé). Les pages de doc ne les décrivent pas toutes : non vérifié dans la doc. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

### Ce qu'un mod ne peut pas faire

#### Le panneau d'un autre

Un mod ne dessine pas dans le panneau d'un autre et n'ouvre ni ne ferme que les siens (`$.ui.open`, `$.ui.close`, `$.ui.panes()`). D'où les entrées : chacune redessine ses onglets avec une copie exacte du code de dessin du mod d'origine. ([interface](https://code.claude.com/docs/en/plugins/mods/interface))

#### Importer hors de son dossier

Un mod n'importe que des fichiers de son dossier (`claude plugin validate` refuse le reste) : les libs partagées vivent dans `lib/core` à la racine et sont copiées octet pour octet par `node scripts/sync-libs.mjs` ; `--check` échoue en CI si une copie dérive. Jamais éditer une copie. ([create](https://code.claude.com/docs/en/plugins/mods/create))

#### Lire le disque depuis les hooks

Le module de hooks ne peut pas importer `node:fs` : tout ce qui lit des dossiers, git ou les transcripts passe par un script Node (`scanner/*.mjs`) lancé par `$.process.run`, qui rend du JSON. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Dessiner une image cliquable

Un `Svg` est une image : pas de clic dedans. Les zones cliquables sont des `Button`. Le terminal ne dessine pas de `Svg`. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Ce qu'on s'interdit

Bloquer ou réécrire un appel d'outil, un prompt ou un agent ; appeler un modèle ; ajouter du texte au prompt par défaut ; agir sans clic. La doc le permet, notre règle non (voir Écrire un mod › Pourquoi on ne bloque jamais).

## À essayer

Les fonctions de Claude Code que nos mods n'utilisent pas encore. Liste complète et état : Référence › À essayer. Source : `docs/v6-research/features-a-essayer.md` de claude-control.

### Les cinq premiers

#### Projects

Un coordinateur et des fils cloud, en bêta publique Pro et Max, déploiement progressif. Test en 10 s : « Projects » apparaît-il dans la barre latérale de l'onglet Code ? ([claude-projects](https://code.claude.com/docs/en/claude-projects))

#### claude agents

Vue des sessions en arrière-plan (`claude agents`, `claude --bg`, `/bg`), worktree automatique ; le plus proche de nos lanes. Essai : deux tâches `--bg` dans un dépôt de test. Sous Windows natif : non vérifié. ([agent-view](https://code.claude.com/docs/en/agent-view))

#### /advisor

Un modèle plus fort consulté aux moments clés (expérimental, 2.1.260+) : `/advisor opus` sur une session Sonnet, coût en plus. Pourrait remplacer certains appels à `architect`. La Galerie compte déjà les appels. ([advisor](https://code.claude.com/docs/en/advisor))

#### /skill-doctor

Coût de contexte et usage de chaque skill, en lecture seule : taper `/skill-doctor`. Zéro risque.

#### Auto-continue

« Auto-continue when limits reset » reprend le tour quand la limite se réinitialise : utile la nuit, zéro coût. Non confirmé.

## Écrire un mod

Pour qui veut changer un mod ou en écrire un. Un mod est un petit bout de code que Claude Code appelle quand il se passe quelque chose ; chez nous, il regarde et prévient, il ne bloque jamais.

### Bases

#### Un mod en une phrase

Un mod est un plugin fait de gestionnaires d'événements JavaScript ou TypeScript (des *hooks*) que Claude Code appelle à chaque événement ; un hook peut observer l'événement, le réécrire ou y répondre lui-même. Même dossier `.claude-plugin/plugin.json` et mêmes marketplaces qu'un plugin. ([overview](https://code.claude.com/docs/en/plugins/mods/overview))

#### Les trois fichiers

`.claude-plugin/plugin.json` (nom, version, description), `hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`), `hooks/register.tsx` (ou `.ts`, `.mjs`…) qui exporte `register(on, options)` ; `types/index.d.ts` seulement si le mod garde des valeurs dans `$.state`. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Où ils tournent

CLI, onglet Code de l'app Desktop (pas en WSL), panneau de chat VS Code (2.1.299+). Sous `claude -p`, le SDK et le cloud, les hooks tournent mais rien ne s'affiche. Minimum : CLI 2.1.287. Un mod écrit par Claude dans Desktop vit dans `~/.claude/dev-mods/<session>/<nom>/`, effacé après `cleanupPeriodDays`. ([overview](https://code.claude.com/docs/en/plugins/mods/overview), [create](https://code.claude.com/docs/en/plugins/mods/create))

### Événements

#### Observer, réécrire, répondre

Un hook reçoit `$` (l'API), `e` (l'événement, figé) et `next`. Il **observe** avec `return next(e)`, **réécrit** avec `next({ ...e, champ })`, **répond** sans appeler `next` (sa propre commande, son propre panneau). ([events](https://code.claude.com/docs/en/plugins/mods/events))

#### Les familles

Outils (`tool.call`, `tool.check`, `tool.describe`), prompt (`prompt.submit`, `prompt.compose`, `prompt.change`…), tours et sessions (`turn.start`, `turn.step` avec `result.usage`, `session.start`, `session.compact`…), agents (`agent.spawn` juste avant un sous-agent, `e.model` vide si l'appel n'en nomme aucun), dessin et clics (`ui.render`, `ui.press`, `command.run`). ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Pourquoi on ne bloque jamais

Un refus (`{ deny }`) ne montre souvent qu'une erreur sans dire d'où elle vient ; nos anciens gardes (cc-control) faisaient ça. Depuis V6, aucun mod de ce dépôt ne bloque ni ne réécrit un appel. Motif : `const r = await next(e)`, puis un toast si besoin, `return r`, et `.catch(($, e, next) => next(e))` à l'enregistrement (un hook qui plante ou dépasse 10 s est sauté). ([events](https://code.claude.com/docs/en/plugins/mods/events), [reference](https://code.claude.com/docs/en/plugins/mods/reference))

### Interface

#### Panneaux

`$.ui.open({ id, title })` répond `{ isPlaced }` ; sans geste de la personne, placé seulement à partir de 144 colonnes (110 une fois ouvert). Plusieurs panneaux : un seul affiché, un onglet chacun. On dessine avec `on('ui.render', { component: 'Pane', requestId }, …)` et les éléments de `$.ui.resolve(e)` (`Box`, `Text`, `Button`, `Link`, `Markdown`, `Input`, `Select`, `Svg`…) ; 10 redessins par seconde au plus. ([interface](https://code.claude.com/docs/en/plugins/mods/interface), [reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Commandes slash

Dans `session.start` : `await $.command.register({ name, description, argumentHint })` (nom réservé : échec ; 64 caractères). Puis `on('command.run', { command: 'nom' }, async ($, e) => ({ text }))`, `e.args` = le reste de la ligne. ([api](https://code.claude.com/docs/en/plugins/mods/api))

#### Notifications

`$.ui.toast(texte)` (4 s), `$.ui.status(texte)` (ligne fixe sous le prompt, `undefined` l'efface), `$.ui.log(texte)` (ligne grise que Claude ne lit pas). ([api](https://code.claude.com/docs/en/plugins/mods/api))

### Configuration

#### userConfig

Dans `plugin.json`, une entrée par option (`type`, `title`, `description`, `default`, `options`) ; `"sensitive": true` masque la saisie. Les valeurs arrivent dans `register(on, options)` et vivent dans le réglage `pluginConfigs` (clé `nom@marketplace`, ou `nom@inline`) ; chaque option non secrète est une ligne de `/config`. Types et champs `min` / `max` : **non vérifié**. ([components](https://code.claude.com/docs/en/plugins/components), [reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Pas de valeur en dur

Libellés, couleurs, seuils, presets, tarifs : dans un JSON à côté du mod (`cockpit.config.json`, `band.config.json`…), fusionné avec ton propre fichier dans `~/.claude`. (règle du dépôt)

### Installer et activer

#### Avec --plugin-dir

`claude --plugin-dir <dossier>` charge un mod pour une session et le recharge à chaque sauvegarde ; le drapeau peut se répéter. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Avec CLAUDE_CODE_PLUGIN_DIRS

Pour Desktop et les sessions qu'on ne lance pas soi-même : chemins absolus séparés par `;` sous Windows (`:` ailleurs), dans le bloc `env` de `~/.claude/settings.json`. Pour la barre à 6 entrées :

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "<dépôt>/mods/band;<dépôt>/mods/cockpit;<dépôt>/mods/veille;<dépôt>/mods/a-faire;<dépôt>/mods/registres;<dépôt>/mods/reference" }
```

([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Depuis une marketplace

`/plugin install nom@marketplace`, puis `/reload-plugins`. Cache par version : monte `version` pour livrer une mise à jour. ([overview](https://code.claude.com/docs/en/plugins/mods/overview), [create](https://code.claude.com/docs/en/plugins/mods/create))

#### Éteindre les mods

`--safe-mode`, `disableAllHooks` ou `--bare` ; un admin peut limiter aux mods gérés. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` est ignoré depuis 2.1.287. ([admin](https://code.claude.com/docs/en/plugins/mods/admin))

### Tester

#### claude plugin validate

Lit le manifeste et le source comme le moteur : événements, appels à `$`, variables lues, hooks qui pourraient refuser ; refuse un import hors du dossier. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### claude plugin test

Lance les `*.test.tsx` avec `import { test, expect, mock } from 'claude-code/testing'` ; rien sous le mod, chaque test répond lui-même à `fs.read`, `ui.open`… `$.ui.mount(...)` dessine un panneau, `press`, `input`, `find` agissent dessus ; boucle sur `['terminal', 'desktop']`. ([test](https://code.claude.com/docs/en/plugins/mods/test))

#### node --test et avant de pousser

La logique pure (sans `$`) se teste avec `node --test` (Node 22.18+ lit le TypeScript). Avant de pousser : `node scripts/sync-libs.mjs --check`, `node tools/validate_mods.mjs`, `python -I tools/confidentiality_scan.py .`. (pratique du dépôt)

### Pas à pas : scenarios

#### Le besoin et les fichiers

`mods/scenarios` : pour chaque rôle, modèle, effort, unité et parallélisme, avec la doc qui le prouve. Fichiers : `plugin.json` (avec `userConfig`), `hooks/register.tsx`, `hooks/logic.ts` (pur), `scenarios.json` (les données), `tests/`.

#### Commande, panneau, avertissement

`session.start` enregistre `/scenarios` ; `command.run` ouvre le panneau. Un hook `agent.spawn` appelle d'abord `next(e)`, puis montre un toast si l'appel ne nommait aucun modèle (option `warn_no_model`). Tests : `tests/logic.test.mjs` (node) et `tests/mod.test.tsx` (kit), puis `claude plugin validate mods/scenarios`. Nouveau mod : copie ce dossier et ajoute sa fiche dans `mods/guide/mods.json`.

### Référence API

#### Les noms de $

`$.ui` (`resolve`, `open`, `close`, `panes`, `toast`, `status`, `log`, `copy`, `view`), `$.command` (`register`, `run`, `list`), `$.agent` (`list`, `spawn`), `$.session` (`usage`, `messages`, `version`, `identity`), `$.fs` (4 Mio par fichier), `$.process.run([argv])` (30 s par défaut, 10 min max), `$.store` (clé-valeur partagé, 4 Mio). ([reference](https://code.claude.com/docs/en/plugins/mods/reference), [api](https://code.claude.com/docs/en/plugins/mods/api))

#### Temps et tailles

Un hook a 10 s (50 ms pour `prompt.edit`), un `.catch` 1 s. Noms d'événements en littéraux, appels à `$` en entier, imports en chemins relatifs. Les mods ne sont pas isolés : ils tournent avec tes droits. ([reference](https://code.claude.com/docs/en/plugins/mods/reference), [overview](https://code.claude.com/docs/en/plugins/mods/overview))

## Nos mods

Une fiche par mod de ce dépôt. Dans le panneau, les fiches sont lues en direct depuis le `plugin.json` et le module de chaque mod ; ici, elles sont régénérées par `node mods/guide/scripts/build.mjs`. État, où le trouver, données lues et tests viennent de `mods/guide/mods.json`.

<!-- mods:start -->
### Fiches

#### Fiche band

Jauge : bandeau au-dessus du prompt, en lecture seule, sur deux lignes qui ne débordent jamais (ajustées à la largeur : libellés courts puis champs retirés dans l'ordre de jauge.drop_order). Ligne 1 en gras : « ● N t'attendent · N à toi │ contexte N % (relais 250 k) », rouge seulement si au moins un t'attend. Ligne 2 en gris : « 5 h N % · sem N % · Codex N % │ N agents · N conv actives │ N tok/s tout · N ce projet · N cette conv │ CPU N % · GPU N % ». Puis les boutons Cockpit · Veille · À toi · Registres · Référence · ▾ (un seul hub ouvert à la fois, réglage launcher.single) ; ▾ déplie Jauge (le détail) et « Cette conversation ». Ligne orange « Passation conseillée » au seuil RESUME. Champs, ordre et libellés dans band.config.json (jauge) ; gauge.style compact garde l'ancienne ligne. /jauge

- **Où** : hub « Jauge » de la barre Mods (/jauge) : la Jauge elle-même, au-dessus du prompt, avec la barre des 6 hubs
- **État** : en construction · version 0.4.0 · Seuil d'auto-compact lu dans le breakdown du moteur ; compaction au repos (2.1.299) et son délai non vérifiés dans la doc. Le bouton Jauge ouvre le panneau du mod lui-même (un $.command.run de sa propre commande ne passe pas par ses hooks). Lien « ouvrir le fichier » (file://) vers RESUME : ouverture par la surface non vérifiée. Effort lu dans CLAUDE_EFFORT (non vérifié pour un mod) ; « agents en cours » = agents qui ont écrit dans les 120 dernières secondes ; état des sections gardé par $.store, non vérifié à la main dans Desktop.
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.close`, `session.measure`, `ui.render` · lit : $.session.usage() et session.measure (chiffres de la status line), transcripts ~/.claude/projects lus en incrémental par scanner/scan.mjs (Node 22.18+) avec le parseur et les prix de lib/core (copie synchronisée dans mods/band/lib/core), cache ~/.claude/band/scan-cache.json ; compteurs : ~/.claude/veille (state.json, acks.jsonl) et ~/.claude/a-faire/summary.json par lib/core/veille.mjs · aucun blocage
- **Fonctionnalités** : commandes `/jauge` · affiche : panneau, bandeau, ligne de statut, toasts · options userConfig : config « Settings file », défaut "" ; band « Band above the prompt » (on | off), défaut "on" ; status_line « Status line entry » (on | off), défaut "off"
- **Activer** : `<dépôt>/mods/band` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/band`
- **Tests** : `node --test mods/band/tests/logic.test.mjs` · `node --test mods/band/tests/health.test.mjs` · `claude plugin test mods/band`

#### Fiche cockpit

Cockpit, le seul panneau zoomable (Méga › Projet › Conversation › Agent), en lecture seule, qui regroupe Usine (factory) et Machine, avec un menu vertical à gauche vers les 6 entrées (Jauge, Cockpit, Veille, À toi, Registres, Référence). Onglet Cockpit : boutons Nuit (écran « Bilan avant la nuit » : ce qui tourne et sa fin, heures de nuit inutilisées, quota restant et ce que la nuit consommerait, lanes et paquets prêts ; Nuit active = /veille nuit, Lancer affiche la commande sans rien lancer, Rien), Jour (/veille jour) et Codex (Claude seul par défaut) ; cartes d'une ligne avec un bouton vers le détail (Qui consomme, T'attend, À toi, Claude Control et ses échéances, CI, Quota, Problèmes du jour, En cours : Workflows, agents hors workflow et pipelines avec ETA), puis les sections repliables. Onglets Mission, Focus, Arbre, Pipeline, Workflow (Gantt, Vitesse, agents hors workflow), Journal, Machine, Claude ↔ Codex (qui ouvre, corrige, merge, relais, dépendances, taux de vert) et Galerie (Équipe par rôle avec retour au lead, Carte du contrôle, Codex : approbations et coût). /cockpit [conv|projet|mega|agent|workflow|machine|relais|galerie|nuit|close] ; /factory et /machine restent des alias quand leur mod n'est pas chargé.

- **Où** : hub « Cockpit » de la barre Mods (/cockpit) : cartes Qui consomme, T’attend, À toi, CI, Quota, Problèmes du jour, En cours ; onglets de Usine et Machine
- **État** : en construction · version 0.3.0 · Un seul panneau rangé par périmètre, de haut en bas : Cette conversation (ouverte, sélectionnée au démarrage ; agents et Workflows terminés repliés derrière un bouton « + N terminé(s) »), Ce projet (lead et sous-conversations par spawnedFrom, y compris les lanes lancées dans un autre dépôt ; Focus + Pipeline de factory), Tous les projets (deux lignes par projet), Claude global (quotas, Veille, bouton /machine). Fermée, chaque section tient sur une ligne de résumé. Un clic sur un nœud descend (Agent : modèle, effort, tokens, coût, journal) et ouvre la section qui le montre ; le fil d'Ariane remonte. Un mod ne peut pas dessiner dans le panneau d'un autre ni importer un fichier hors de son dossier (claude plugin validate le refuse) : les libs de factory, band et veille sont copiées octet pour octet par scripts/sync-libs.mjs et un test échoue si la copie est en retard. Desktop montre un panneau à la fois, les autres en onglets : Cockpit est un onglet à côté de Fichiers (filetree), le bouton « Ouvrir Fichiers » lance /filetree. Placement exact dans Desktop (colonne de droite, largeur) : non vérifié dans la doc. Crédits cloud et semaine Fable : non lisibles depuis un mod quand l'API ne les donne pas.
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.close`, `ui.render` · lit : le scanner de factory (copié dans lib/, mêmes transcripts et fichiers de session de l'app : titres, spawnedFrom, PR) ; $.session.usage() pour les quotas de « Claude global » ; les fichiers de veille (~/.claude/veille). La jauge de contexte n'est plus dans le cockpit : elle est dans band, au-dessus du prompt. Rien n'est lu quand le panneau est fermé ou que l'onglet filetree est celui affiché. ; classement.json du mod usage pour « Qui consomme » (lance le scanner incrémental de usage s'il a plus de 10 min et que la section est ouverte) · aucun blocage
- **Fonctionnalités** : commandes `/cockpit` · affiche : panneau, toasts · options userConfig : start « Open at start » (on | off), défaut "on" ; config « Settings file », défaut ""
- **Activer** : `<dépôt>/mods/cockpit` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/cockpit`
- **Tests** : `node --test mods/cockpit/tests/nav.test.mjs` · `claude plugin test mods/cockpit` · `claude plugin validate mods/cockpit`

#### Fiche veille

Veille : un panneau, quatre onglets. Alertes : un script sans tokens (tâche Windows ClaudeVeille) fait le tour des conversations, PR/MR et CI selon un mode (rien, légère, active, nuit-active, nuit-test-légère) et écrit des alertes (gravité, depuis quand, conversation ou PR, lien, Ack), dernier tour (rouge si deux tours manqués), actions avec leur raison. Fil : le dernier message de chaque conversation, par projet puis lead → sous-conversations. À archiver : les conversations finies, listées pour la conversation VEILLE. Export eta : le lot de conversations terminées d'export-eta et son bouton « Exporter vers eta ». « Attend Julian » : notification Windows et e-mail tout de suite, un seul compteur (la règle de lib/core/veille.mjs). Erreurs du veilleur dans ~/.claude/mods-health/veille.json. Nuit / Jour : /veille nuit passe en nuit-active, /veille jour revient en légère avec le bilan de la nuit (merges, échecs, attentes). Réveil sûr : une session claude -p neuve avec le modèle, l'effort et le mode de permission de la conversation cible (jamais --resume), résultat et contrôle dans le Fil. Alertes d'échéance J-7 et J-1 (À toi · Claude Control) et contrôle hebdo de la version vendored de filetree. /veille [alertes|fil|archiver|export|nuit|jour|mode <x>|ack <clé>|coordinateur|tour|close] ; /export-eta en alias quand le mod export-eta n'est pas chargé.

- **Où** : hub « Veille » de la barre Mods (/veille) : onglets Alertes, Fil, À archiver, Export eta
- **État** : en construction · version 0.4.0 · réveil d'une conversation par claude -p --resume <id> (documenté ; vérifié ici sur une session jetable : même transcript, même modèle ; non vérifié : effort, mode de permission différent du défaut, affichage dans l'app Desktop) ; désactivé par défaut (wake.enabled false). Push téléphone : aucun moyen documenté pour un script (PushNotification est un outil de Claude) ; option push.claude (claude -p, coûte des tokens, non vérifié) désactivée ; l'e-mail arrive sur le téléphone par l'app mail. Fil : « Ouvrir la conversation » passe claude://claude.ai/epitaxy/<id> au système (gestionnaire claude: de l'app, route epitaxy vue dans l'app 2.42304) car un Link de panneau n'ouvre que https: ; arrivée sur la session non vérifiée, « Copier l'id » en secours. « Attend Julian » à chaque passage de la tâche (5 min, même en légère) : AskUserQuestion en attente, wrap_up avec ask ou blocked, needs_action, question en fin de dernier message (heuristique), carte d'approbation probable (non vérifié), incohérence entre consignes (mots clés FR/EN) ; notification Windows, e-mail si smtp.json, compteur rouge « attend Julian : N ».
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.close`, `ui.render` · lit : mêmes sources que « Ça t'attend » du mod factory (son scanner et waiting.mjs importés, pas copiés) : fichiers de session de l'app, transcripts, gh search / glab api (jetons gardés par gh et glab, jamais lus) ; état dans ~/.claude/veille (state.json, heartbeat.json, events.jsonl, acks.jsonl, config.json) ; smtp.json créé par toi ; Fil : fichiers de session de l'app (titre, modèle, effort, spawnedFrom, postTurnSummary, PR) et la fin de chaque transcript (dernier texte, wrap_up, AskUserQuestion en attente), écrit par la tâche dans ~/.claude/veille/fil.json ; marques « lu » dans $.store · aucun blocage
- **Fonctionnalités** : commandes `/veille`, `/export-eta` · affiche : panneau, bandeau · options userConfig : band « Band entry above the prompt » (on | off), défaut "off"
- **Activer** : `<dépôt>/mods/veille` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/veille`
- **Tests** : `node --test mods/veille/tests/logic.test.mjs` · `node --test mods/veille/tests/mail.test.mjs` · `node --test mods/veille/tests/fil.test.mjs` · `claude plugin test mods/veille`

#### Fiche a-faire

À toi : tout ce qui attend une action que seul toi peux faire, pour que rien ne se perde. Configuration (smtp.json de la veille, mods installés pas chargés lus par lib/core/mods.mjs, tâche ClaudeVeille), décisions (DECISIONS-PENDING, PR qui attendent ton accord, questions.md), connexions et 2FA, secrets de tests réels à ranger, tests manuels (manual-checks.md), questions des conversations (alertes « attend Julian » de la veille). Pour chacune : pourquoi elle bloque, les étapes exactes avec Copier, depuis quand, la source ; Fait (revérifie quand c'est possible), Plus tard (1 jour). summary.json { total, high, updatedAt } pour le compteur « À toi : N ». Lecture seule, sans tokens. /afaire (alias /a-toi)

- **Où** : hub « À toi » de la barre Mods (/afaire, alias /a-toi)
- **État** : en construction · version 0.3.0 · lecture seule sauf son propre état (Fait, Plus tard) ; aucune source n'est modifiée, aucune commande montrée n'est lancée, aucun texte envoyé au modèle. Fait sur une ligne mesurée (smtp.json, mods, tâche, secrets) revérifie et refuse tant que la cause est là. Non vérifié : format de ~/.claude/tests-reels/registry.json (le mod tests-reels est en construction : un tableau ou {items|secrets|entries} dont status/state/category contient « ranger »). La copie installée de la veille (~/.claude/veille/bin) ne prend le flux qu'après node veille.mjs install.
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : ~/.claude/effort-board/manual-checks.md et questions.md, les fichiers de décisions listés dans sources.decisions.files, gh search prs --author @me (titre, corps, étiquettes ; cache 30 min, jetons gardés par gh), ~/.claude/veille (state.json, acks.jsonl, heartbeat.json, smtp.json : présence et champs, jamais le mot de passe), schtasks /Query ClaudeVeille, CLAUDE_CODE_PLUGIN_DIRS de ~/.claude/settings.json et les dossiers de mods à côté, ~/.claude/tests-reels/registry.json (comptes « à ranger ») ; écrit seulement ~/.claude/a-faire (state.json, items.json, summary.json, notified.json, prs-cache.json) · aucun blocage
- **Fonctionnalités** : commandes `/afaire`, `/a-toi` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/a-faire` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/a-faire`
- **Tests** : `node --test mods/a-faire/tests/logic.test.mjs` · `claude plugin test mods/a-faire` · `claude plugin validate mods/a-faire`

#### Fiche registres

Registres : un seul panneau à onglets Problèmes | Tests réels | Règles | Ménage, en lecture seule. Chaque onglet est dessiné par une copie exacte du code de son mod (lib/, synchronisée par scripts/sync-libs.mjs) sur les mêmes fichiers dans ~/.claude ; son scanner ne tourne que sur ↻ ou quand les données sont plus vieilles que refresh_min. /registres [problemes|tests|regles|menage] ; alias /problemes, /tests, /regles, /menage quand les anciens mods ne sont pas chargés.

- **Où** : hub « Registres » de la barre Mods (/registres) : onglets Problèmes, Tests réels, Règles, Ménage
- **État** : en construction · version 0.1.0 · un seul panneau à onglets Problèmes | Tests réels | Règles | Ménage ; /problemes, /tests, /regles, /menage enregistrés comme alias seulement quand aucun autre mod ne sert ce nom (les anciens mods chargés gardent leurs commandes). Erreurs de Santé et de Veille versées au registre Problèmes (catégorie Mods). Aucun texte envoyé au modèle.
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : les dossiers des mods d'origine (~/.claude/problemes, ~/.claude/tests-reels, ~/.claude/metrics-mod, ~/.claude/menage-mod) ; chaque onglet dessiné par une copie exacte du code de son mod (lib/, scripts/sync-libs.mjs), son scanner lancé seulement sur ↻ ou quand les données ont plus de refresh_min · aucun blocage
- **Fonctionnalités** : commandes `/registres` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/registres` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/registres`
- **Tests** : `node --test mods/registres/tests/*.test.mjs` · `claude plugin test mods/registres` · `claude plugin validate mods/registres`

#### Fiche reference

Référence : un seul panneau en lecture seule, onglets Config (toute la config de Claude Code, secrets masqués), Guide (mode d'emploi des mods), Scénarios (modèle et effort par rôle, « Appliquer ce scénario » note le choix dans ~/.claude/scenarios/applied.json et montre l'écart, sans jamais toucher settings ni agents), Santé (mods chargés, erreurs, CPU), CI (routage et Diagramme avec Gantt et ETA), À essayer (fonctions et idées des recherches, état jamais/en test/adopté/écarté, test, coût, risque, ce qu'on doit tester), R&D (index des recherches, Exporter vers eta), Repos (état, PR, Mettre à jour sur clic) et Exporter pour audit (/audit-export, zip masqué). Les anciennes commandes /config-claude, /control, /mods-guide, /scenarios, /sante, /ci restent quand leur mod n'est pas chargé. /reference

- **Où** : hub « Référence » de la barre Mods (/reference) : onglets Config, Guide, Scénarios, Santé, CI
- **État** : en construction · version 0.2.0 · un seul panneau à onglets Config | Guide | Scénarios | Santé | CI ; chaque onglet dessiné par une copie exacte du code de son mod. « Appliquer ce scénario » note le modèle et l'effort par rôle et montre l'écart avec settings.json et les agents, sans jamais les modifier. /config-claude, /control, /mods-guide, /scenarios, /sante, /ci enregistrés comme alias seulement quand leur mod n'est pas chargé.
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : les caches des mods d'origine : config-claude.json de control (secrets masqués avant écriture), MODE-EMPLOI.md et mods.json du guide (copies), scenarios.json, ~/.claude/sante-mod/report.json, ~/.claude/ci-pipelines-cache.json ; « Appliquer ce scénario » écrit seulement ~/.claude/scenarios/applied.json · aucun blocage
- **Fonctionnalités** : commandes `/reference` · affiche : panneau · options userConfig : config « Settings file », défaut ""
- **Activer** : `<dépôt>/mods/reference` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/reference`
- **Tests** : `node --test mods/reference/tests/*.test.mjs` · `claude plugin test mods/reference` · `claude plugin validate mods/reference`

#### Fiche factory

Maintenant dans Cockpit (/cockpit mission|focus|arbre|pipeline|workflow|journal) : ce mod reste utilisable seul, et quand il n'est pas chargé Cockpit répond à /factory. Factory v2, side panel of all your agents, read-only, French labels, stacked top to bottom to the pane's width: Mission (counters, one card per project, model share vs targets, conversation list), Focus (Ça t'attend with notifications, fleet pulse, live timeline, progress today), Arbre (a conversation's lead, sub-conversations, Workflows and agents with model and effort, architect on call, bill, guards, log, status line), Workflow (running and recent workflows: phases timeline, agents, estimates and ETA from past runs, Gantt, Vitesse, stuck or failed agents, parallel limits; /factory workflow [all]), Pipeline, Quotas (lib/core/usage.mjs, Claude et Codex), Système (runner via lib/core/runner.mjs), Journal ; Gantt et estimations de lib/core (même rendu que le Diagramme du mod ci). /factory [onglet]

- **Où** : dans Cockpit (onglets Mission, Focus, Arbre, Pipeline, Workflow, Journal) ; /factory reste une commande
- **État** : stable · version 0.7.0 · v2 : sept écrans en onglets (Mission, Focus, Arbre, Pipeline, Quotas, Système, Journal), empilés de haut en bas à la largeur du panneau, sans dessin à taille fixe ni zoom. « Ça t'attend » est dans Focus (PR/MR verte non mergée, question ou action qui attend Julian, lane à l'arrêt sur une PR rouge, en conflit ou skipped, sous-conversations de chaque lead), une notification native par nouvelle ligne ($.ui.notify, sinon un toast). Quotas et Système affichent « module non chargé » sans les mods usage et machine. Étape du Pipeline déduite des sessions, PR et CI (non vérifié) ; effort d'un agent de Workflow lu dans son propre transcript (non vérifié) ; sous-conversation reliée par spawnedFrom (non vérifié) ; $.ui.notify est dans les types du build 2.1.299, pas encore sur les pages de doc ; lien de session claude://… non vérifié
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.close`, `ui.render` · lit : transcripts (~/.claude/projects), fichiers de session de l'app (postTurnSummary, spawnedFrom, prs), gh search / glab api pour tes PR et MR ouvertes et leur CI (jetons gardés par gh et glab, jamais lus) ; onglet Quotas : logique et fichiers du mod usage (~/.claude/usage-mod) et $.session.usage() ; onglet Système : échantillonneur du mod machine · aucun blocage
- **Fonctionnalités** : commandes `/factory` · affiche : panneau, toasts · options userConfig : aucune
- **Activer** : `<dépôt>/mods/factory` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/factory`
- **Tests** : `node --test mods/factory/tests/logic.test.mjs` · `node --test mods/factory/tests/screens.test.mjs` · `claude plugin test mods/factory`

#### Fiche control

Claude Control, read live: SETUP (rules version from ~/.claude/CLAUDE.md, settings env names and hooks, agents, skills, workflows, mods loaded or not, blockers and hidden rules), USAGE (model, effort and delegation mix against the live rule lines), PRACTICES (one section per CLAUDE.md heading with the evidence it cites, plus pending V6 changes), CONFIG (everything in Claude Code as a searchable tree with full contents, settings by precedence, documented defaults, secrets masked). /control, /config-claude

- **Où** : dans Référence (onglet Config) ; /control et /config-claude restent des commandes (alias de Référence quand control n’est pas chargé)
- **État** : stable · version 0.3.0 · CONFIG (/config-claude, onglet de /control) : arbre catégorie → sous-catégorie → élément avec chemin, date, taille et contenu complet (rendu ou brut), recherche partout, Changements des 7 derniers jours. Secrets masqués avant écriture (clés token, secret, passw, key, auth, credential, cookie ; valeurs ANTHROPIC_* ; chaînes qui ressemblent à un jeton). Non vérifié : compaction au repos, canal de mise à jour par défaut, outils de statusline-setup et claude-code-guide ; drapeaux --settings de la ligne de commande, préfixe des branches, Remote Control par défaut : non lisibles depuis un mod. Plus rien d'écrit en dur pour V5 : version et règles lues en direct. Qu'une nouvelle session Desktop prenne CLAUDE_CODE_PLUGIN_DIRS de settings.json au démarrage : documenté pour l'env de settings, non vérifié pour les sessions déjà ouvertes.
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : règles actives lues à chaque scan (~/.claude/CLAUDE.md : ligne de titre et version, sections, preuves citées), settings.json (noms des variables env seulement, hooks), agents, skills, workflows, mods de CLAUDE_CODE_PLUGIN_DIRS (chargé / installé non chargé), mémoire, transcripts (scanner Python), docs/V6-CHANGES.md sur la branche main du dépôt des règles (git show) ; CONFIG : CLAUDE.md / CLAUDE.local.md / AGENTS.md et .claude/ des dépôts sous projects_root, ~/.claude (agents, skills, commandes, workflows, styles, mémoire, mods, plugins), les fichiers settings (managed, local, project, user), ~/.claude.json et .mcp.json (noms des serveurs, jamais leurs env), les préférences de l'app Desktop (liste de clés), le dépôt Claude Control (config/, deploy.py, sauvegardes, RULES-INVENTORY.md) · aucun blocage
- **Fonctionnalités** : commandes `/control`, `/config-claude` · affiche : panneau, toasts · options userConfig : aucune
- **Activer** : `<dépôt>/mods/control` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/control`
- **Tests** : `python -I -m unittest discover -s mods/control/tests -p "test_*.py"` · `claude plugin test mods/control`

#### Fiche ci

CI routing and pipeline diagram: which CI backends exist (from a config file), whether they are usable, which repo or conversation uses which, and a Diagramme tab (repo -> CI host -> stages/jobs -> result, Gantt, ETA, filters Claude Code / Codex / app / conversation). /ci, /ci diagramme, /ci route, /ci clear

- **Où** : dans Référence (onglet CI avec le Diagramme) et la carte CI de Cockpit ; /ci reste une commande (alias)
- **État** : en construction · version 0.2.0 · note dans le prompt système désactivée par défaut (prompt_note: false) ; /ci close ferme le panneau ; Diagramme : une phrase en tête (pipelines en cours, rouges avec leur job, runner local N/concurrent), filtres en boutons Tout · Claude Code · Codex · inconnu et groupes par hôte · par app · par conversation, sections repliables, Gantt texte par pipeline (file ░, exécution █, fin estimée ┄, maintenant │), heure de fin estimée = médiane d'au moins 3 runs réussis du même job (sinon médiane des pipelines, sinon « pas assez d'historique »), commande de log par job rouge (montrée, jamais lancée) ; rouge seulement pour un vrai échec (allow_failure en orange) ; attribution Claude / Codex par branche, trailer ou auteur, « inconnu » sinon ; lecture gh/glab seulement sur Rafraîchir ou cache plus vieux que cache_minutes ; titre de conversation lu dans custom-title (ai-title non vérifié)
- **Fonctionnement** : événements `session.start`, `command.run`, `prompt.compose`, `ui.render` · lit : ~/.claude/ci.config.json, fichier de routage, gh/glab auth status, API GitLab (runners) ; onglet Diagramme (/ci diagramme) : gh run list / gh run view --json jobs, glab api en GET (pipelines et jobs des projets et miroirs GitLab), git log -1 du clone local (trailer Co-Authored-By), transcripts ~/.claude/projects/*/*.jsonl (sortie de gh pr create / glab mr create, titre de la conversation), caches ~/.claude/ci-pipelines-cache.json et ci-conversations-cache.json · aucun blocage
- **Fonctionnalités** : commandes `/ci` · affiche : panneau, ligne de statut, toasts, note dans le prompt système · options userConfig : aucune
- **Activer** : `<dépôt>/mods/ci` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/ci`
- **Tests** : `python -I -m unittest discover -s mods/ci/tests -p "test_*.py"` · `claude plugin test mods/ci`

#### Fiche scenarios

Scénarios d'agents: read-only guide and editable presets of roles -> model, effort, unit and max parallel, with ready-to-paste snippets, and a « Claude vs GPT » tab (accuracy vs cost from dated sources). /scenarios, /scenarios vs

- **Où** : dans Référence (onglet Scénarios, bouton « Appliquer ce scénario ») ; /scenarios reste une commande (alias)
- **État** : en construction · version 0.1.0
- **Fonctionnement** : événements `session.start`, `command.run`, `agent.spawn`, `ui.render` · lit : scenarios.json du mod + ton fichier (userConfig file) · aucun blocage
- **Fonctionnalités** : commandes `/scenarios` · affiche : panneau, toasts · options userConfig : file « Extra scenarios file », défaut "" ; warn_no_model « Warn when an Agent call names no model » (on | off), défaut "on" ; versus_file « Claude vs GPT data file », défaut ""
- **Activer** : `<dépôt>/mods/scenarios` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/scenarios`
- **Tests** : `node --test mods/scenarios/tests/logic.test.mjs` · `claude plugin test mods/scenarios`

#### Fiche usage

Consommation : tokens et coût équivalent par jour, heure, projet, modèle, session, type d'agent, surface, skill et MCP ; prévision des limites 5 h et semaine ; débit des scénarios S1-S5 et suggestion Plein régime. Onglet Classement : qui consomme le plus sur 1 h, 4 h, aujourd'hui, 2 j, 7 j ou 30 j, par conversation, projet, modèle, type d'agent, fonction ou Claude/Codex, avec tendance et part. Onglet Codex : tokens Codex du jour et de la semaine par modèle et % de limite lus dans ~/.codex/sessions. Ligne Quotas en tête et dans la réponse de /conso : 5 h et semaine de Claude et de Codex, date d'épuisement, lues par lib/core/usage.mjs comme band et Cockpit (mêmes chiffres). Onglet Historique : un total par jour gardé dans history.json au-delà des 30 jours de transcripts. Onglet Débit : tokens/s par modèle (pondéré, médiane, plage) et derniers flux, Claude et Codex. Claude seul par défaut, bouton « + Codex ». Chaque réponse comptée une fois (message.id + requestId). Lecture seule. /conso

- **Où** : dans Cockpit (cartes Qui consomme et Quota, bouton Voir → /conso) ; /conso reste une commande
- **État** : en construction · version 0.5.0 · tokens par 1 % calibrés sur ce PC seulement (non vérifié) ; % Codex lus seulement s'ils sont écrits dans les sessions (Codex 0.142+ via app-server : non vérifié), coût Codex non calculé ; Classement : lignes par heure d'horloge (« 1 h » = tranches qui touchent la dernière heure), sous-agents comptés dans leur conversation parente, famille d'outil non disponible, Codex par jour entier ; ouverture par lien claude:// non vérifiée
- **Fonctionnement** : événements `session.start`, `command.run`, `session.measure`, `ui.render` · lit : transcripts (~/.claude/projects, scanner Node incrémental), $.session.usage() et session.measure pour les % 5 h et semaine, échantillons dans ~/.claude/usage-mod, scenarios.json ; onglet Codex : ~/.codex/sessions/**/rollout-*.jsonl (token_count, turn_context), jamais auth.json ni config.toml ; classement.json (même cache incrémental, 31 j) et fil.json de veille pour le bouton Ouvrir · aucun blocage
- **Fonctionnalités** : commandes `/conso` · affiche : panneau, ligne de statut · options userConfig : status_line « Ligne de statut » (config | on | off), défaut "config" ; codex « Onglet Codex » (config | on | off), défaut "config"
- **Activer** : `<dépôt>/mods/usage` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/usage`
- **Tests** : `node --test mods/usage/tests/logic.test.mjs` · `node --test mods/usage/tests/health.test.mjs` · `node --test mods/usage/tests/codex.test.mjs` · `node --test mods/usage/tests/classement.test.mjs` · `claude plugin test mods/usage`

#### Fiche guide

Mode d'emploi des mods, en français : les 6 entrées de la barre Mods et chacun de leurs onglets, ma journée, la nuit, ce qu'un mod peut ou ne peut pas faire, à essayer, anciennes commandes, tes données, mises à jour, écrire un mod, et une fiche par mod du dépôt (lue en direct). Onglets et sommaire. /mods-guide

- **Où** : dans Référence (onglet Guide) ; /mods-guide reste une commande (alias de Référence quand guide n’est pas chargé)
- **État** : en construction · version 0.1.0
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : MODE-EMPLOI.md, mods.json et les plugin.json / hooks des mods voisins · aucun blocage
- **Fonctionnalités** : commandes `/mods-guide` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/guide` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/guide`
- **Tests** : `node --test mods/guide/tests/guide.test.mjs` · `claude plugin test mods/guide`

#### Fiche filetree

An IDE-style file tree for Claude Code that shows what Claude is doing and where in files

- **Où** : à part, hors barre Mods : son onglet Fichiers à côté de Cockpit (/filetree)
- **État** : stable · version 0.2.26 · externe, MIT, data-goblin (Kurt Buhler), copié à la release v0.2.26 sans changement de comportement, libellés en anglais ; contexte envoyé au modèle seulement quand tu cliques un fichier (une ligne « selected » avec son chemin, à chaque prompt tant que la sélection reste ; bouton ⊘ pour l'enlever) ; avant un git commit, un git rev-parse HEAD (≤ 5 s) retarde l'appel ; aucune option de config ajoutée par nous ; détails dans vendor/filetree/NOTICE
- **Fonctionnement** : événements `session.start`, `config.set`, `command.run`, `tool.call`, `ui.message`, `classic.SessionStart`, `classic.CwdChanged`, `classic.FileChanged`, `ui.focus`, `ui.scroll`, `prompt.submit`, `prompt.attachment`, `ui.render` · lit : dossier de travail de la session ($.fs.list), git status / diff / ls-files / rev-parse, état du mod ($.state) ; sous Windows powershell seulement pour ouvrir un fichier au double-clic · aucun blocage
- **Fonctionnalités** : commandes `/filetree` · affiche : panneau, toasts · options userConfig : activity « Claude activity » (reads and writes | writes | reads | none), défaut "reads and writes" ; glyphs « Glyphs » (auto | nerd | plain), défaut "auto" ; follow « Follow Claude » (on | off), défaut "on" ; start « Open at start » (on | off), défaut "on" ; column « Right column » (date | age | size), défaut "date" ; hints « Hints » (on | off), défaut "on" ; open « Open with », défaut ""
- **Activer** : `<dépôt>/vendor/filetree` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir vendor/filetree`
- **Tests** : `claude plugin validate vendor/filetree/.claude-plugin/plugin.json` · `claude plugin test vendor/filetree`

#### Fiche machine

Maintenant dans Cockpit (onglet Machine, /cockpit machine : charge du PC par ce même échantillonneur, charge du runner par lib/core/runner.mjs) ; ce mod reste utilisable seul, et quand il n'est pas chargé Cockpit répond à /machine. Machine : vue en direct de ce PC, en lecture seule. CPU (total et par cœur), RAM, disques, GPU, top 5 processus CPU et mémoire (claude, node, python, git en couleur), charge du runner GitLab local (via le mod ci) et « agents en parallèle conseillés maintenant : N ». /machine

- **Où** : dans Cockpit (onglet Machine, charge du runner dans la carte CI) ; /machine reste une commande
- **État** : en construction · version 0.1.1 · règle « agents conseillés » et plafonds 4 pipelines / 3 npm ci-tsc dans machine.config.json. Non vérifié : enfants du processus runner = jobs locaux ; compteur GPU sur un Windows non anglais ; ordre des mods dans le bandeau : l'entrée garde le dessin des mods suivants, mais band (Jauge) ne garde pas le sien, donc elle n'apparaît que si machine passe avant band.
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.close`, `ui.render` · lit : compteurs système (Windows : ntdll/kernel32 par ctypes ; Linux : /proc), nvidia-smi ou compteur de performance Windows (typeperf) pour le GPU, scanner et config du mod ci pour le runner GitLab (compteurs seulement, jamais de jeton) ; échantillons seulement pendant que le panneau est ouvert (5 s) ou que l'entrée du bandeau est allumée (15 s) · aucun blocage
- **Fonctionnalités** : commandes `/machine` · affiche : panneau, bandeau · options userConfig : config « Settings file », défaut "" ; band « Band entry above the prompt » (on | off), défaut "off"
- **Activer** : `<dépôt>/mods/machine` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/machine`
- **Tests** : `python -I -m unittest discover -s mods/machine/tests -p "test_*.py"` · `node --test mods/machine/tests/logic.test.mjs` · `claude plugin test mods/machine`

#### Fiche metrics

Les règles marchent ? PR/MR mergées par jour, tokens par PR, part Opus / Sonnet / Haiku, agents avec modèle nommé, arrêts, refus, gardes de l'app, creux CI, arrêts BLOCKED, avec les versions des règles en repères et un tableau avant / après. Lecture seule. /regles

- **Où** : dans Registres (onglet Règles) ; /regles reste une commande (alias de Registres quand metrics n’est pas chargé)
- **État** : en construction · version 0.1.0 · aucun texte envoyé au modèle (la commande ouvre un panneau). Non vérifié : les attentes de permission (seuls les refus sont comptés), le modèle des agent() de Workflow (lu dans le script), les creux CI (le travail démarrable n'est pas connu).
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : transcripts ~/.claude/projects (lecture incrémentale, parseur de mods/usage/lib), git remote de tes repos, gh search prs / gh run list et glab mr list / glab ci list (lecture seule, au plus toutes les 30 min), git log du fichier de règles ; caches dans ~/.claude/metrics-mod · aucun blocage
- **Fonctionnalités** : commandes `/regles` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/metrics` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/metrics`
- **Tests** : `node --test mods/metrics/tests/logic.test.mjs` · `node --test mods/metrics/tests/health.test.mjs` · `claude plugin test mods/metrics`

#### Fiche sante

Santé des mods : une ligne verte / orange / rouge en haut, puis chaque mod chargé par CLAUDE_CODE_PLUGIN_DIRS ou installé : chargé ou non, version, commandes enregistrées, dernier rafraîchissement de ses caches, erreurs, durée et CPU de ses scans (fiches ~/.claude/mods-health), taille des caches, JSON de config invalides, version de Claude Code face au minimum. Lecture seule. /sante

- **Où** : dans Référence (onglet Santé ; ses erreurs vont aussi au registre Problèmes) ; /sante reste une commande (alias)
- **État** : en construction · version 0.1.0 · rien n'est supprimé : les commandes de nettoyage sont affichées avec un bouton Copier. Convention proposée : ~/.claude/mods-health/<mod>.json (lastRun, durationMs, cpuMs, error, lastOk, fenêtre 24 h), écrite par band, usage, metrics, ci et machine. Non vérifié : champ de version minimale dans plugin.json (absent de la doc), format de installed_plugins.json, plugin toujours renseigné par $.command.list().
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : CLAUDE_CODE_PLUGIN_DIRS, $.command.list() et $.session.version() ; pour chaque mod : plugin.json, hooks.json, JSON de config, caches (taille, dernière modification), journaux, fiches ~/.claude/mods-health/<mod>.json ; ~/.claude/mods et ~/.claude/plugins/installed_plugins.json ; rapport dans ~/.claude/sante-mod (scanner Node, seulement quand le panneau est demandé) · aucun blocage
- **Fonctionnalités** : commandes `/sante` · affiche : panneau · options userConfig : config « Settings file », défaut ""
- **Activer** : `<dépôt>/mods/sante` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/sante`
- **Tests** : `node --test mods/sante/tests/logic.test.mjs` · `claude plugin test mods/sante` · `claude plugin validate mods/sante`

#### Fiche menage

Ménage : ce que le travail de Claude laisse traîner sur ce PC, en lecture seule. Worktrees (branche, mergée ou non, propre ou modifié, âge, taille), dossiers de worktree orphelins, branches locales et distantes déjà mergées, copies de mods, sauvegardes de deploy, transcripts par projet, dossiers temporaires, sessions archivables. Pour chaque ligne la commande sûre à lancer, jamais lancée ; en rouge « ne pas supprimer ». /menage

- **Où** : dans Registres (onglet Ménage) ; /menage reste une commande (alias)
- **État** : en construction · version 0.1.0 · ne supprime rien et ne lance aucune commande : il les montre (bouton Copier). Aucun texte envoyé au modèle. « mergée » = atteignable depuis origin/main au dernier fetch, ou contenu identique / même patch-id dans main (squash), ou PR mergée selon les fichiers de session. Non vérifié : archiver une session hors de l'app (pas de commande documentée) ; format des fichiers de session de l'app (non documenté).
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : git en lecture seule dans chaque dépôt sous repos.roots (worktree list, status, branch --merged, for-each-ref, merge-base, diff --quiet, patch-id ; GIT_OPTIONAL_LOCKS=0, jamais de fetch), tailles des dossiers (pwsh sous Windows, cache 12 h), ~/.claude/mods et CLAUDE_CODE_PLUGIN_DIRS de settings.json, ~/.claude/effort-board/_deploy_backups, ~/.claude/projects (taille, cwd), TEMP/claude, ~/.claude/dev-mods, APPDATA/Claude/scratch-workspaces, fichiers de session de l'app (titre, isArchived, lastActivityAt, prs) ; résultat dans ~/.claude/menage-mod · aucun blocage
- **Fonctionnalités** : commandes `/menage` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/menage` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/menage`
- **Tests** : `node --test mods/menage/tests/logic.test.mjs` · `claude plugin test mods/menage`

#### Fiche problemes

Problèmes : registre persistant de chaque erreur et problème du travail de Claude, compris une fois et jamais redécouvert. Collecte sans tokens (questions à Julian, fins de tour qui attendent, refus de permission, gardes de l'app et des worktrees, fins BLOCKED, Workflows en échec, CI en échec), dédoublonnée par signature ; arbre de catégories repliables (Blocages manuels, Workflow, Règles, App, CI, Par application, Mods), symptôme, cause, correctif, preuves et chronologie ; filtres ; notes écrites dans le registre local. /problemes

- **Où** : dans Registres (onglet Problèmes) et la carte Problèmes du jour de Cockpit ; /problemes reste une commande (alias)
- **État** : en construction · version 0.1.0 · Bouton « Exporter vers eta » et /problemes export : le registre en Markdown masqué vers le dépôt eta (sources/problemes/REGISTRE.md, un fichier par catégorie au-delà de 300 Ko), même masquage et même flux git que le mod export-eta (copiés dans lib/eta/, test de synchro), fichiers non masquables retenus et listés ; chemin du dépôt eta lu dans ~/.claude/export-eta/config.json. Repère AskUserQuestion, fins de tour qui finissent par une question, needs_action de l'app, refus de permission, dossiers et règles accordés, gardes de l'app et des worktrees, rm sur chemin protégé, fins BLOCKED, Workflows avec agents_error, sorties gh / glab en échec ou skipped, erreurs API ; classe par règles du JSON (première qui correspond), dédoublonne par signature (règle + application ou clé), monte compte et dernière vue, rouvre un problème corrigé qui revient. « Par application » est une vue croisée. Le panneau n'écrit que « Ajouter une note » (dans le registre local) ; statut et correctif par la ligne de commande (set). Aucun texte envoyé au modèle. Non vérifié : les demandes de permission acceptées ne sont pas dans les transcripts (seuls les refus et les dossiers ou règles accordés sont comptés) ; format des fichiers de session de l'app (non documenté) ; la Veille installée n'appelle le collecteur qu'après un nouveau veille.mjs install (copie des fichiers).
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : collecteur Node sans tokens (scanner/problemes_scan.mjs collect, lancé par le panneau quand le registre a plus de 30 min, par ↻, ou par la Veille à chaque tour) : octets ajoutés aux transcripts ~/.claude/projects (sessions, sous-agents, agents de Workflow) depuis le dernier passage, fichiers de session de l'app (postTurnSummary.needs_action, sessionPermissionUpdates) ; imports une fois par ligne depuis tes registres (tableaux Markdown, incidents.json, findings.json, fichier ou git show) listés dans ~/.claude/problemes/problemes.config.json ; registre ~/.claude/problemes/register.jsonl (ajout seulement), instantané problems.json lu par le panneau · aucun blocage
- **Fonctionnalités** : commandes `/problemes` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/problemes` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/problemes`
- **Tests** : `node --test mods/problemes/tests/export.test.mjs` · `node --test mods/problemes/tests/logic.test.mjs` · `claude plugin test mods/problemes` · `claude plugin validate mods/problemes`

#### Fiche export-eta

Export eta : exporte des conversations Claude Code en Markdown vers le dépôt eta, sans tokens. En cours (instantané de toutes les conversations en cours), Sélection (cases à cocher par projet), Lot terminé (la Veille compte les conversations terminées depuis le dernier export et propose un bouton « Exporter vers eta »). Passe de confidentialité avant écriture (jetons, clés, mots de passe, cookies, chaînes de connexion, JWT, clés privées, e-mails), fichiers non masquables retenus et listés ; worktree neuf du dépôt eta, branche, PR, merge squash. Le lot terminé est aussi l'onglet « Export eta » du panneau Veille (/veille export), qui lance le même exporteur. Erreurs dans ~/.claude/mods-health/export-eta.json (Santé, Problèmes). /export, /export-eta

- **Où** : dans Veille (onglet Export eta, bouton « Exporter vers eta ») ; /export-eta reste une commande (alias de Veille quand export-eta n’est pas chargé)
- **État** : en construction · version 0.2.0 · Trois modes : En cours (instantané de toutes les conversations en cours), Sélection (cases à cocher par projet, repliables), Lot terminé (la Veille compte à chaque tour les conversations terminées depuis le dernier export ; à partir de batch_min, défaut 3, ou quand un lead et toutes ses sous-conversations sont terminés, elle affiche « 4 conversations terminées — Exporter vers eta » avec un bouton, dans son onglet Alertes et Fil ; la même ligne et le même bouton apparaissent au-dessus du prompt). auto: true exporte le lot sans clic. Chaque conversation devient un Markdown : en-tête (projet, dossier, branche, modèle · effort, début, dernière activité, état, parent, sous-conversations, PR), puis les messages dans l'ordre, un appel d'outil par ligne, sorties d'outils et fichiers omis, résultats d'agents en une ligne ; découpé en parties au-delà de max_kb (300 Ko). Passe de confidentialité avant écriture (jetons GitHub/GitLab/Anthropic/OpenAI/AWS/Slack, mots de passe, cookies, chaînes de connexion, JWT, clés privées, e-mails sauf les tiens, motifs en plus par config ou fichier) puis une vérification : un fichier avec un secret non masquable est retenu et listé, jamais écrit. Chemin : sources/conversations/<projet>/<date>-<titre>-<id>.md, INDEX.md par projet et global ; un ré-export réécrit son propre fichier (retrouvé par l'id), jamais un autre. Git : worktree neuf du dépôt eta, branche export/conversations-<date-heure>, commit, push, PR, merge squash (checks verts s'il y en a, sinon après la passe de confidentialité), branche distante supprimée, worktree retiré ; jamais de push sur main ni de force-push. /export peut être pris par la commande intégrée de Claude Code : /export-eta marche toujours. La copie du veilleur installée (~/.claude/veille/bin) ne prend l'export qu'après un nouveau « veille install ».
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : les fichiers de session de l'app Desktop (titre, modèle, effort, état de fin de tour, spawnedFrom, PR) et les transcripts de ~/.claude/projects, lus par un script Node sans dépendance ; ~/.claude/export-eta (config.json, state.json, sessions.json, pending.json) ; le dépôt eta (chemin dans config.json, jamais dans le dépôt public), où le mod crée un worktree neuf. Aucun appel de modèle. · aucun blocage
- **Fonctionnalités** : commandes aucune · affiche : panneau, bandeau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/export-eta` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/export-eta`
- **Tests** : `node --test mods/export-eta/tests/logic.test.mjs` · `node --test mods/veille/tests/export.test.mjs` · `claude plugin test mods/export-eta` · `claude plugin validate mods/export-eta`

#### Fiche tests-reels

Tests réels : le registre des tests hors CI par application (tenant de test, Cloudflare Access et Workers, Power BI Desktop / SSAS / Docker en local, automatisation d'interface, vérifications manuelles), en lecture seule. Par appli : environnements, comptes de test masqués (seulement l'endroit où le secret est rangé, jamais sa valeur), procédures et derniers essais (vert, rouge, jamais), « jamais testé en réel », et la liste « À ranger ». Données locales dans ~/.claude/tests-reels. /tests

- **Où** : dans Registres (onglet Tests réels) ; /tests reste une commande (alias)
- **État** : en construction · version 0.1.0 · aucun mot de passe, jeton, clé ni cookie stocké ni affiché : seulement une référence (Gestionnaire d'identification Windows : cible). Ids de tenant, de workspace et URL privées seulement dans le dossier local, jamais dans le dépôt. Aucun texte envoyé au modèle. Non vérifié : format des transcripts (non documenté) ; détection des secrets heuristique (formats forts et paires mot de passe=… dont la valeur a l'air aléatoire).
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : ~/.claude/tests-reels (registry.json écrit par cli.mjs add, runs.jsonl par cli.mjs run-log, recovered.json par le scan de récupération) ; le scan lit les transcripts ~/.claude/projects, effort-board/manual-checks.md, handoff/*.md et reports/* des dépôts sous repo_roots, et les dossiers extra_roots · aucun blocage
- **Fonctionnalités** : commandes `/tests` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/tests-reels` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/tests-reels`
- **Tests** : `node --test mods/tests-reels/tests/logic.test.mjs` · `claude plugin test mods/tests-reels` · `claude plugin validate mods/tests-reels`

### Archivés / rejetés

| Mod | Verdict | Pourquoi |
|---|---|---|
| cc-control (gardes) | rejeté | Refusait et réécrivait des appels d'outils (plafonds d'envois et de lancements, réécritures) : le bloqueur caché. Éteint le 9 oct. |
| cc-control (bandeau), context-meter | fusionné → band (Jauge) | Petits et justes : seul le bandeau de contexte en lecture seule est repris. |
| coordinator | fusionné → factory | Les sous-conversations liées suppriment la plupart des collisions ; on garde seulement « PR verte non mergée » et « attend Julian ». |
| cost-tracker | rejeté | Affichait 0,00 $ pour les nouveaux ids de modèle ; factory fait la facture. |
| activity-pane | rejeté | Remplacé par factory et la vue Agents de l'app. |
| launchpad, night | rejeté | Réveils sur minuterie, contraires à la règle « pas de réveils ». |
<!-- mods:end -->

## FAQ et pièges

### Pièges

#### Mon mod ne fait rien

Lance `claude plugin validate` puis `claude --debug` : un hook qui plante est sauté et la raison est dans le journal (et dans une ligne grise du fil quand le dossier est rechargé à chaud). ([reference](https://code.claude.com/docs/en/plugins/mods/reference)) Avant ça, Référence › Santé (`/reference sante`) dit en une ligne quels mods sont chargés, lesquels n'ont enregistré aucune commande, quels JSON sont invalides et quel scan est en erreur.

#### Un bouton refusé

Dans `$.ui.open`, `focus`, `closeOnEscape` et `holdToasts` n'acceptent que `true` : omets-les plutôt que d'écrire `false` ([interface](https://code.claude.com/docs/en/plugins/mods/interface)). Même chose pour `plain` sur un `Button` : `plain={false}` fait refuser l'arbre et le moteur dessine le sien (constaté avec le kit de test).

#### Lire une variable d'environnement

`$.env.get('NOM')` veut un nom **littéral** pour que `validate` liste ce que le mod lit : pas de boucle sur une variable. (constaté avec `claude plugin validate`)

#### La variable FUNCTION_HOOKS

`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` ne sert plus depuis 2.1.287 : les mods sont actifs par défaut. ([overview](https://code.claude.com/docs/en/plugins/mods/overview))

#### Un panneau qui ne s'ouvre pas

Ouvert sans geste de l'utilisateur, il faut 144 colonnes (110 une fois que l'utilisateur l'a ouvert une fois). Ouvre-le depuis une commande. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

### Questions

#### Un mod est-il isolé

Non : il tourne avec les droits de l'utilisateur. Lis le code d'un mod avant de l'installer. ([overview](https://code.claude.com/docs/en/plugins/mods/overview))

#### Un mod consomme-t-il des jetons

Pas par lui-même. Seulement s'il appelle `$.model.complete`, lance un agent, ou ajoute du texte au prompt système (`prompt.compose`). ([api](https://code.claude.com/docs/en/plugins/mods/api)) Dans ce dépôt, aucun mod n'en ajoute par défaut : la note de route de `ci` ne s'active qu'avec `prompt_note: true`. Une commande lancée (à la main ou par la barre Mods) laisse sa courte réponse dans le fil, que Claude lit au tour suivant.
