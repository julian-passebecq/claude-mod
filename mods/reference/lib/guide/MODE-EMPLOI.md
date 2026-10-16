# Mode d'emploi des mods

Tout ce qu'il faut pour comprendre, installer, tester et écrire un mod Claude Code, et rien d'autre. Chaque fait renvoie à la doc officielle ; ce qui n'y est pas est marqué **non vérifié**. Ce fichier est aussi le contenu du panneau `/mods-guide` : un `##` = un onglet, un `###` = une catégorie, un `####` = une sous-section.

Doc officielle : [vue d'ensemble](https://code.claude.com/docs/en/plugins/mods/overview) · [référence](https://code.claude.com/docs/en/plugins/mods/reference) · [événements](https://code.claude.com/docs/en/plugins/mods/events) · [interface](https://code.claude.com/docs/en/plugins/mods/interface) · [API](https://code.claude.com/docs/en/plugins/mods/api) · [créer](https://code.claude.com/docs/en/plugins/mods/create) · [tester](https://code.claude.com/docs/en/plugins/mods/test) · [admin](https://code.claude.com/docs/en/plugins/mods/admin)

<!-- toc:start -->
- [Bases](#bases)
  - [Ce qu'est un mod](#ce-quest-un-mod)
    - [Un mod en une phrase](#un-mod-en-une-phrase)
    - [Mod ou plugin](#mod-ou-plugin)
    - [Ce que fait un hook](#ce-que-fait-un-hook)
  - [Où vivent les mods](#où-vivent-les-mods)
    - [Les trois fichiers](#les-trois-fichiers)
    - [Où ils sont installés](#où-ils-sont-installés)
    - [Où ils tournent](#où-ils-tournent)
- [Événements](#événements)
  - [Le trio $, e, next](#le-trio--e-next)
    - [Observer](#observer)
    - [Réécrire](#réécrire)
    - [Répondre](#répondre)
  - [Les familles d'événements](#les-familles-dévénements)
    - [Outils](#outils)
    - [Prompt](#prompt)
    - [Tours et sessions](#tours-et-sessions)
    - [Agents](#agents)
    - [Dessin et clics](#dessin-et-clics)
  - [Pourquoi on ne bloque jamais](#pourquoi-on-ne-bloque-jamais)
    - [La règle](#la-règle)
    - [Prévenir sans bloquer](#prévenir-sans-bloquer)
- [Interface](#interface)
  - [Panneaux](#panneaux)
    - [Ouvrir un panneau](#ouvrir-un-panneau)
    - [Ouvrir le panneau d'un autre mod](#ouvrir-le-panneau-dun-autre-mod)
    - [Plusieurs panneaux dans une colonne](#plusieurs-panneaux-dans-une-colonne)
    - [Dessiner un panneau](#dessiner-un-panneau)
    - [Les éléments](#les-éléments)
  - [Commandes slash](#commandes-slash)
    - [Enregistrer une commande](#enregistrer-une-commande)
    - [Répondre à une commande](#répondre-à-une-commande)
  - [Notifications](#notifications)
    - [Toast](#toast)
    - [Ligne de statut](#ligne-de-statut)
    - [Ligne de journal](#ligne-de-journal)
- [Configuration](#configuration)
  - [userConfig](#userconfig)
    - [Déclarer une option](#déclarer-une-option)
    - [Lire les options](#lire-les-options)
    - [Changer une valeur](#changer-une-valeur)
  - [Fichiers de config du mod](#fichiers-de-config-du-mod)
    - [Pas de valeur en dur](#pas-de-valeur-en-dur)
- [Installer et activer](#installer-et-activer)
  - [Charger un dossier](#charger-un-dossier)
    - [Avec --plugin-dir](#avec---plugin-dir)
    - [Avec CLAUDE_CODE_PLUGIN_DIRS](#avec-claude_code_plugin_dirs)
  - [Depuis une marketplace](#depuis-une-marketplace)
    - [Installer avec /plugin](#installer-avec-plugin)
    - [Mettre à jour](#mettre-à-jour)
  - [Dans l'app Desktop](#dans-lapp-desktop)
    - [Les dev-mods](#les-dev-mods)
  - [Éteindre les mods](#éteindre-les-mods)
    - [Interrupteurs](#interrupteurs)
- [Tester](#tester)
  - [Valider](#valider)
    - [claude plugin validate](#claude-plugin-validate)
  - [Tests du kit](#tests-du-kit)
    - [claude plugin test](#claude-plugin-test)
    - [Monter un panneau](#monter-un-panneau)
  - [Tests de logique pure](#tests-de-logique-pure)
    - [node --test](#node---test)
    - [Avant de pousser](#avant-de-pousser)
- [Écrire un mod pas à pas](#écrire-un-mod-pas-à-pas)
  - [Exemple : scenarios](#exemple--scenarios)
    - [1. Le besoin](#1-le-besoin)
    - [2. Les fichiers](#2-les-fichiers)
    - [3. Les données en JSON](#3-les-données-en-json)
    - [4. La commande et le panneau](#4-la-commande-et-le-panneau)
    - [5. Prévenir sans bloquer](#5-prévenir-sans-bloquer)
    - [6. Les tests](#6-les-tests)
    - [7. Activer et partager](#7-activer-et-partager)
- [Référence API](#référence-api)
  - [Les noms de $](#les-noms-de-)
    - [$.ui](#ui)
    - [$.command](#command)
    - [$.agent et $.session](#agent-et-session)
    - [$.fs, $.process, $.store](#fs-process-store)
  - [Limites](#limites)
    - [Temps et tailles](#temps-et-tailles)
- [Nos mods](#nos-mods)
  - [Fiches](#fiches)
    - [factory](#factory)
    - [control](#control)
    - [ci](#ci)
    - [scenarios](#scenarios)
    - [usage](#usage)
    - [guide](#guide)
    - [band](#band)
    - [filetree](#filetree)
    - [machine](#machine)
    - [metrics](#metrics)
    - [sante](#sante)
    - [veille](#veille)
    - [menage](#menage)
    - [cockpit](#cockpit)
    - [a-faire](#a-faire)
    - [problemes](#problemes)
    - [export-eta](#export-eta)
    - [tests-reels](#tests-reels)
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
    - [Ouvrir un autre mod depuis la Jauge](#ouvrir-un-autre-mod-depuis-la-jauge)
    - [Passer le relais depuis la Jauge](#passer-le-relais-depuis-la-jauge)
<!-- toc:end -->

## Bases

Un mod, c'est un petit bout de code que Claude Code appelle quand il se passe quelque chose. Il peut regarder, prévenir, dessiner. Chez nous, il ne bloque jamais.

### Ce qu'est un mod

#### Un mod en une phrase

Un mod est un plugin fait de gestionnaires d'événements JavaScript ou TypeScript (des *hooks*) que Claude Code appelle à chaque événement ; un hook peut observer l'événement, le réécrire ou y répondre lui-même. ([overview](https://code.claude.com/docs/en/plugins/mods/overview))

#### Mod ou plugin

Un mod **est** un plugin : même dossier `.claude-plugin/plugin.json`, mêmes marketplaces. La doc appelle ses hooks « hooks » et ceux du fichier settings « settings hooks ». Un `hooks/hooks.json` peut contenir les deux. ([overview](https://code.claude.com/docs/en/plugins/mods/overview), [reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Ce que fait un hook

Il reçoit trois choses : `$` (l'API du moteur), `e` (l'événement, figé) et `next` (la suite de la chaîne). Il **observe** en appelant `next(e)`, **réécrit** avec `next({ ...e, x })`, ou **répond** sans appeler `next`. ([events](https://code.claude.com/docs/en/plugins/mods/events))

### Où vivent les mods

#### Les trois fichiers

- `.claude-plugin/plugin.json` : nom, version, description (aucun autre champ obligatoire).
- `hooks/hooks.json` : `{ "modules": ["./register.tsx"] }`, un seul chemin.
- `hooks/register.tsx` (ou `.ts`, `.js`, `.mjs`…) : un module ES qui exporte `register(on, options)`.
- En plus, `types/index.d.ts` seulement si le mod garde des valeurs dans `$.state`.

([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Où ils sont installés

- Un mod installé depuis une marketplace est copié dans le cache des plugins, par version : il faut monter `version` pour publier une mise à jour. ([create](https://code.claude.com/docs/en/plugins/mods/create))
- Un mod chargé par dossier (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`) tourne depuis ce dossier, rechargé à chaque sauvegarde. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))
- Un mod écrit par Claude dans l'app Desktop vit dans `~/.claude/dev-mods/<session-id>/<nom>/`, effacé après `cleanupPeriodDays` : copie-le ailleurs pour le garder. ([create](https://code.claude.com/docs/en/plugins/mods/create))

#### Où ils tournent

CLI, onglet Code de l'app Desktop (pas en WSL), panneau de chat VS Code (extension 2.1.299+). Sous `claude -p`, le SDK et le cloud, les hooks tournent mais rien ne s'affiche. Minimum : CLI 2.1.287. ([overview](https://code.claude.com/docs/en/plugins/mods/overview))

## Événements

Un événement = un moment où Claude Code demande « quelqu'un veut-il dire quelque chose ? ». Ton hook répond, ou laisse passer.

### Le trio $, e, next

#### Observer

`return next(e)` : tu regardes, tu notes, tu dessines, et tout continue comme avant. C'est le seul mode qu'on utilise sur les appels d'outils et d'agents. ([events](https://code.claude.com/docs/en/plugins/mods/events))

#### Réécrire

`return next({ ...e, champ })` : la suite de la chaîne voit ta version. Utile pour ajouter une note au prompt système (`prompt.compose`), jamais pour changer en douce un appel d'outil. ([events](https://code.claude.com/docs/en/plugins/mods/events))

#### Répondre

Ne pas appeler `next` et rendre un résultat : c'est ainsi qu'un mod répond à **sa propre** commande (`command.run`) ou dessine **son** panneau (`ui.render`). Sur `tool.call` ou `agent.spawn`, répondre `{ deny }` refuse : on ne le fait pas. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

### Les familles d'événements

#### Outils

`tool.call` (avant et après l'outil : `next(e)`, `{ deny }` ou `{ result }`), `tool.check` (permission : allow, ask, deny), `tool.describe` (description de l'outil). ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Prompt

`prompt.submit` (le texte envoyé), `prompt.compose` (sections du prompt système), plus `prompt.fill`, `prompt.suggest`, `prompt.edit`, `prompt.autocomplete`, `prompt.context`, `prompt.mention`… ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Tours et sessions

`turn.start`, `turn.step` (chaque requête au modèle, aussi pour les sous-agents, avec `result.usage`), `turn.complete` ; `session.start`, `session.end`, `session.compact`, `session.append`… ([reference](https://code.claude.com/docs/en/plugins/mods/reference), [events](https://code.claude.com/docs/en/plugins/mods/events))

#### Agents

`agent.spawn` arrive juste avant qu'un sous-agent, un agent de Workflow ou un coéquipier démarre ; `e.model` est le `model` de l'appel (vide s'il n'en nomme aucun). Il ne se redéclenche pas quand un sous-agent est repris par `SendMessage`. `agent.offer` peut cacher un type d'agent. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Dessin et clics

`ui.render` (dessiner un composant : `Pane`, `AbovePrompt`, `ToolUse`…), `ui.press`, `ui.input`, `ui.close`… et `command.run` pour les commandes slash. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

### Pourquoi on ne bloque jamais

#### La règle

Un mod peut refuser un appel d'outil, un prompt ou un sous-agent, et l'utilisateur ne voit souvent qu'une erreur sans savoir d'où elle vient. Nos anciens gardes (cc-control) faisaient exactement ça : plafonds d'envois, réécritures, chaos. Depuis V6, **aucun mod de ce dépôt ne bloque ni ne réécrit un appel d'outil** ; au pire il prévient. La doc ne marque aucun événement comme « observation seulement » : c'est notre code qui choisit de toujours appeler `next(e)`. ([events](https://code.claude.com/docs/en/plugins/mods/events))

#### Prévenir sans bloquer

Le motif : `const r = await next(e)` puis, si besoin, `$.ui.toast(...)`, et `return r`. Ajoute `.catch(($, e, next) => next(e))` à l'enregistrement : si ton hook plante, l'appel passe quand même (un hook qui plante ou dépasse 10 s est sauté). ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

## Interface

Ce que l'on voit : panneaux, commandes, petits messages.

### Panneaux

#### Ouvrir un panneau

`$.ui.open({ id, title })` ; il répond `{ isPlaced }`. Un panneau ouvert sans geste de l'utilisateur n'est placé qu'à partir de 144 colonnes de terminal ; dans Desktop il se range à droite dès 800 px, sinon il s'affiche dans le fil (12 lignes). ([interface](https://code.claude.com/docs/en/plugins/mods/interface), [reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Ouvrir le panneau d'un autre mod

Un mod n'ouvre ni ne ferme le panneau d'un autre : `$.ui.open` et `$.ui.close` n'agissent que sur les panneaux du mod qui appelle, et `$.ui.panes()` ne liste que les siens. Il peut en revanche lancer la commande slash de l'autre avec `$.command.run({ command, args })`, « comme si la personne l'avait tapée » ; elle attend la fin du tour en cours. C'est ce que fait la barre Mods de la Jauge : `/conso` ouvre, `/conso close` ferme. ([api](https://code.claude.com/docs/en/plugins/mods/api), [interface](https://code.claude.com/docs/en/plugins/mods/interface))

#### Plusieurs panneaux dans une colonne

Quand plusieurs panneaux sont ouverts, un seul est affiché et chacun a un onglet avec son titre : ils ne s'empilent pas. Un panneau peut s'ouvrir seul au démarrage (`$.ui.open` dans `session.start`), comme filetree et cockpit ; dans un terminal il attend 144 colonnes (110 si on l'a déjà ouvert). Un mod ne dessine pas dans le panneau d'un autre et n'importe aucun fichier hors de son dossier : pour composer plusieurs mods dans un panneau, cockpit copie leurs libs pures (`scripts/sync-libs.mjs`, test de dérive). Où Desktop range exactement la colonne et quelle largeur il donne : non vérifié dans la doc. ([interface](https://code.claude.com/docs/en/plugins/mods/interface), [create](https://code.claude.com/docs/en/plugins/mods/create))

#### Dessiner un panneau

Un hook `on('ui.render', { component: 'Pane', requestId: '<id>' }, …)` rend un arbre JSX. Les éléments viennent de `$.ui.resolve(e)`, pas de globals. Les valeurs lues avec `read($, atom)` redessinent le panneau quand elles changent ; 10 redessins par seconde au plus. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Les éléments

`Box`, `Text`, `Button`, `Link`, `Code`, `Markdown`, `Input`, `Select`, `Svg` (Desktop et VS Code), `Raster` et `Image` (terminal). ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

### Commandes slash

#### Enregistrer une commande

Dans un hook `session.start` : `await $.command.register({ name, description, argumentHint })`. Un nom réservé par Claude Code fait échouer l'appel. Lettres, chiffres, `_`, `-`, 64 caractères max. ([api](https://code.claude.com/docs/en/plugins/mods/api))

#### Répondre à une commande

`on('command.run', { command: 'nom' }, async ($, e) => ({ text }))` ; `e.args` contient le reste de la ligne. ([api](https://code.claude.com/docs/en/plugins/mods/api))

### Notifications

#### Toast

`$.ui.toast(texte)` : une bulle de 4 s par défaut. ([api](https://code.claude.com/docs/en/plugins/mods/api))

#### Ligne de statut

`$.ui.status(texte)` : une ligne fixe sous le prompt ; `undefined` l'efface. ([api](https://code.claude.com/docs/en/plugins/mods/api))

#### Ligne de journal

`$.ui.log(texte)` : une ligne grise dans le fil, que Claude ne lit pas. ([api](https://code.claude.com/docs/en/plugins/mods/api))

## Configuration

Les réglages d'un mod ne sont jamais écrits en dur.

### userConfig

#### Déclarer une option

Dans `plugin.json`, un objet `userConfig` : une entrée par option avec `type`, `title`, `description`, `default`, et `options` pour une liste de choix. `"sensitive": true` masque la saisie et range la valeur dans le stockage sécurisé. ([components](https://code.claude.com/docs/en/plugins/components)) La liste complète des types et des champs `min` / `max` / `required` : **non vérifié**.

#### Lire les options

Elles arrivent dans `register(on, options)`, valeurs par défaut remplies. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Changer une valeur

Les valeurs vivent dans le réglage `pluginConfigs`, clé `nom@marketplace` (ou `nom@inline` pour `--plugin-dir`). Chaque option non secrète est aussi une ligne du menu `/config`. En ligne de commande : `claude plugin install … --config CLE=VALEUR` ou `claude plugin configure --values-stdin`. ([reference](https://code.claude.com/docs/en/plugins/mods/reference), [components](https://code.claude.com/docs/en/plugins/components))

### Fichiers de config du mod

#### Pas de valeur en dur

Libellés, couleurs, seuils, tarifs : dans un JSON à côté du mod (`config.json`, `scenarios.json`…), lu avec `$.fs.read`. L'utilisateur peut y ajouter ses propres entrées sans toucher au code. (règle du dépôt)

## Installer et activer

Trois chemins : un dossier, une marketplace, ou l'app Desktop.

### Charger un dossier

#### Avec --plugin-dir

`claude --plugin-dir <dossier>` charge un mod pour une session et le recharge à chaque sauvegarde ; le drapeau peut se répéter. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### Avec CLAUDE_CODE_PLUGIN_DIRS

Pour les sessions qu'on ne lance pas soi-même (app Desktop, SDK) : chemins absolus séparés par `;` sous Windows (`:` ailleurs), dans l'environnement ou dans le bloc `env` de `~/.claude/settings.json`. Exemple pour ce dépôt :

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "<dépôt>/mods/factory;<dépôt>/mods/control;<dépôt>/mods/ci;<dépôt>/mods/scenarios;<dépôt>/mods/guide;<dépôt>/mods/usage;<dépôt>/mods/band;<dépôt>/mods/machine;<dépôt>/mods/metrics;<dépôt>/mods/sante" }
```

Une session longue non interactive recharge aussi à la sauvegarde avec `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

### Depuis une marketplace

#### Installer avec /plugin

`/plugin install nom@marketplace` (ou `claude plugin install nom@marketplace` dans un shell), puis `/reload-plugins` pour l'avoir dans la session ouverte. Les mods sont actifs par défaut. ([overview](https://code.claude.com/docs/en/plugins/mods/overview))

#### Mettre à jour

Les plugins installés sont mis en cache par version : monte `version` dans `plugin.json` pour livrer une mise à jour. ([create](https://code.claude.com/docs/en/plugins/mods/create))

### Dans l'app Desktop

#### Les dev-mods

Quand Claude écrit un mod pendant une session Desktop, il le range dans `~/.claude/dev-mods/<session>/<nom>/` ; l'app demande une fois d'activer le rechargement à chaud, puis le mod se recharge à la fin de chaque tour qui le modifie. ([create](https://code.claude.com/docs/en/plugins/mods/create))

### Éteindre les mods

#### Interrupteurs

`--safe-mode`, `disableAllHooks` ou `--bare` coupent les mods ; un admin peut aussi limiter aux mods gérés. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` est ignoré depuis 2.1.287 : le mettre à 0 n'éteint rien. ([admin](https://code.claude.com/docs/en/plugins/mods/admin), [overview](https://code.claude.com/docs/en/plugins/mods/overview))

## Tester

On teste avant de montrer. Trois niveaux.

### Valider

#### claude plugin validate

`claude plugin validate <dossier>` lit le manifeste et le source comme le moteur : il liste les événements accrochés, les appels à `$`, les variables d'environnement lues, l'état lu et écrit, et chaque hook « gating » (qui pourrait refuser). `--strict` et `--json` existent. Il refuse aussi un nom qui ressemble à ceux d'Anthropic (`claude-…`). ([reference](https://code.claude.com/docs/en/plugins/mods/reference), [create](https://code.claude.com/docs/en/plugins/mods/create))

### Tests du kit

#### claude plugin test

`claude plugin test <dossier>` lance les fichiers `*.test.ts` / `*.test.tsx` avec `import { test, expect, mock } from 'claude-code/testing'` ; sort en 1 si un test échoue, 5 s par test par défaut. Sous le mod il n'y a rien : chaque test répond lui-même à `fs.read`, `ui.open`, `session.start`… avec `on(...)`. ([test](https://code.claude.com/docs/en/plugins/mods/test))

#### Monter un panneau

`$.ui.mount({ plugin, component: 'Pane', requestId, surface, props })` dessine le panneau ; `find`, `press({ key })`, `input`, `unmount` agissent dessus. Écris le test une fois et boucle sur `['terminal', 'desktop']`. ([test](https://code.claude.com/docs/en/plugins/mods/test))

### Tests de logique pure

#### node --test

Mets la logique (calculs, validation, génération de texte) dans un fichier sans `$` : `node --test` le teste directement (Node 22.18+ lit le TypeScript). C'est ce que lance la CI GitHub du dépôt. (pratique du dépôt)

#### Avant de pousser

`python -I tools/confidentiality_scan.py .` : aucun chemin privé, jeton ou e-mail ne part sur le dépôt public. (règle du dépôt)

## Écrire un mod pas à pas

L'exemple : `mods/scenarios`, le mod « Scénarios d'agents ».

### Exemple : scenarios

#### 1. Le besoin

Savoir, pour chaque rôle (lead, codeurs, revue, tests, recherche), quel modèle, quel effort, quelle unité (session, sous-conversation, agent de Workflow, sous-agent) et combien en parallèle, avec la doc qui le prouve. Un guide en lecture seule, rien qui bloque.

#### 2. Les fichiers

`.claude-plugin/plugin.json` (avec `types` et `userConfig`), `hooks/hooks.json`, `hooks/register.tsx` (Claude Code), `hooks/logic.ts` (logique pure), `scenarios.json` (les données), `types/index.d.ts` (les valeurs de `$.state`), `tests/`.

#### 3. Les données en JSON

Les scénarios S1 à S4, les modèles, les efforts, les unités et les limites documentées (chacune avec sa source et `verified`) sont dans `scenarios.json`. L'option `file` ajoute ton propre fichier : S5, S6… ou un S2 remplacé.

#### 4. La commande et le panneau

`session.start` enregistre `/scenarios` ; `command.run` ouvre le panneau et, avec `/scenarios S2 env`, rend directement l'extrait. Le panneau lit les deux fichiers, montre les erreurs de validation, un bouton par scénario, les réglages exacts par rôle avec leur lien, et un bouton **Copier** (`$.ui.copy`).

#### 5. Prévenir sans bloquer

Un hook `agent.spawn` appelle d'abord `next(e)` (l'agent démarre comme prévu), puis, si l'appel ne nommait aucun modèle, affiche un toast (une fois par minute au plus). `.catch(($, e, next) => next(e))` garantit qu'une erreur ne gêne jamais le lancement. L'option `warn_no_model` l'éteint.

#### 6. Les tests

`tests/logic.test.mjs` (node) : validation du JSON, fusion avec un fichier utilisateur, chaque type d'extrait. `tests/mod.test.tsx` (kit) : le panneau sur terminal et desktop, les boutons, la copie, la commande, le toast. Puis `claude plugin validate mods/scenarios`.

#### 7. Activer et partager

Ajoute `<dépôt>/mods/scenarios` à `CLAUDE_CODE_PLUGIN_DIRS`, ouvre une nouvelle session, tape `/scenarios`. Pour un nouveau mod : copie ce dossier, renomme, garde la structure, et ajoute sa fiche dans `mods/guide/mods.json`.

## Référence API

Les noms de `$` qu'on utilise le plus. La référence complète est dans les déclarations TypeScript que Claude Code écrit dans `.claude-plugin/types/`.

### Les noms de $

#### $.ui

`resolve`, `open`, `close`, `panes`, `focus`, `scroll`, `toast`, `status`, `log`, `notice`, `ask`, `copy`, `selection`. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### $.command

`register({ name, description, argumentHint, immediate? })`, dans `session.start`. ([api](https://code.claude.com/docs/en/plugins/mods/api))

#### $.agent et $.session

`$.agent.register`, `spawn`, `list` (statuts : pending, running, waiting, idle, completed, failed, killed) ; `$.session.usage()` (contexte, limites, coût), `messages`, `send`. ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

#### $.fs, $.process, $.store

`$.fs` lit et écrit des fichiers (4 Mio par fichier) ; `$.process.run([argv])` lance un programme sans shell (30 s par défaut, 10 min max) ; `$.store` est un magasin clé-valeur partagé par toutes les sessions de la machine (4 Mio). ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

### Limites

#### Temps et tailles

Un hook a 10 s (50 ms pour `prompt.edit`), un `.catch` 1 s ; un hook qui plante ou dépasse est sauté. Les noms d'événements s'écrivent en littéraux, les appels à `$` en entier (pas de déstructuration), les imports en chemins relatifs. Les mods ne sont pas isolés : ils tournent avec tes droits. ([reference](https://code.claude.com/docs/en/plugins/mods/reference), [create](https://code.claude.com/docs/en/plugins/mods/create), [overview](https://code.claude.com/docs/en/plugins/mods/overview))

## Nos mods

Une fiche par mod de ce dépôt. Dans le panneau, les fiches sont lues en direct depuis le `plugin.json` et le module de chaque mod ; ici, elles sont régénérées par `node mods/guide/scripts/build.mjs`. État, données lues et tests viennent de `mods/guide/mods.json`.

<!-- mods:start -->
### Fiches

#### factory

Factory v2, side panel of all your agents, read-only, French labels, stacked top to bottom to the pane's width: Mission (counters, one card per project, model share vs targets, conversation list), Focus (Ça t'attend with notifications, fleet pulse, live timeline, progress today), Arbre (a conversation's lead, sub-conversations, Workflows and agents with model and effort, architect on call, bill, guards, log, status line), Pipeline, Quotas, Système, Journal. /factory [onglet]

- **État** : stable · version 0.5.0 · v2 : sept écrans en onglets (Mission, Focus, Arbre, Pipeline, Quotas, Système, Journal), empilés de haut en bas à la largeur du panneau, sans dessin à taille fixe ni zoom. « Ça t'attend » est dans Focus (PR/MR verte non mergée, question ou action qui attend Julian, lane à l'arrêt sur une PR rouge, en conflit ou skipped, sous-conversations de chaque lead), une notification native par nouvelle ligne ($.ui.notify, sinon un toast). Quotas et Système affichent « module non chargé » sans les mods usage et machine. Étape du Pipeline déduite des sessions, PR et CI (non vérifié) ; effort d'un agent de Workflow lu dans son propre transcript (non vérifié) ; sous-conversation reliée par spawnedFrom (non vérifié) ; $.ui.notify est dans les types du build 2.1.299, pas encore sur les pages de doc ; lien de session claude://… non vérifié
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.close`, `ui.render` · lit : transcripts (~/.claude/projects), fichiers de session de l'app (postTurnSummary, spawnedFrom, prs), gh search / glab api pour tes PR et MR ouvertes et leur CI (jetons gardés par gh et glab, jamais lus) ; onglet Quotas : logique et fichiers du mod usage (~/.claude/usage-mod) et $.session.usage() ; onglet Système : échantillonneur du mod machine · aucun blocage
- **Fonctionnalités** : commandes `/factory` · affiche : panneau, toasts · options userConfig : aucune
- **Activer** : `<dépôt>/mods/factory` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/factory`
- **Tests** : `node --test mods/factory/tests/logic.test.mjs` · `node --test mods/factory/tests/screens.test.mjs` · `claude plugin test mods/factory`

#### control

Claude Control, read live: SETUP (rules version from ~/.claude/CLAUDE.md, settings env names and hooks, agents, skills, workflows, mods loaded or not, blockers and hidden rules), USAGE (model, effort and delegation mix against the live rule lines), PRACTICES (one section per CLAUDE.md heading with the evidence it cites, plus pending V6 changes), CONFIG (everything in Claude Code as a searchable tree with full contents, settings by precedence, documented defaults, secrets masked). /control, /config-claude

- **État** : stable · version 0.3.0 · CONFIG (/config-claude, onglet de /control) : arbre catégorie → sous-catégorie → élément avec chemin, date, taille et contenu complet (rendu ou brut), recherche partout, Changements des 7 derniers jours. Secrets masqués avant écriture (clés token, secret, passw, key, auth, credential, cookie ; valeurs ANTHROPIC_* ; chaînes qui ressemblent à un jeton). Non vérifié : compaction au repos, canal de mise à jour par défaut, outils de statusline-setup et claude-code-guide ; drapeaux --settings de la ligne de commande, préfixe des branches, Remote Control par défaut : non lisibles depuis un mod. Plus rien d'écrit en dur pour V5 : version et règles lues en direct. Qu'une nouvelle session Desktop prenne CLAUDE_CODE_PLUGIN_DIRS de settings.json au démarrage : documenté pour l'env de settings, non vérifié pour les sessions déjà ouvertes.
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : règles actives lues à chaque scan (~/.claude/CLAUDE.md : ligne de titre et version, sections, preuves citées), settings.json (noms des variables env seulement, hooks), agents, skills, workflows, mods de CLAUDE_CODE_PLUGIN_DIRS (chargé / installé non chargé), mémoire, transcripts (scanner Python), docs/V6-CHANGES.md sur la branche main du dépôt des règles (git show) ; CONFIG : CLAUDE.md / CLAUDE.local.md / AGENTS.md et .claude/ des dépôts sous projects_root, ~/.claude (agents, skills, commandes, workflows, styles, mémoire, mods, plugins), les fichiers settings (managed, local, project, user), ~/.claude.json et .mcp.json (noms des serveurs, jamais leurs env), les préférences de l'app Desktop (liste de clés), le dépôt Claude Control (config/, deploy.py, sauvegardes, RULES-INVENTORY.md) · aucun blocage
- **Fonctionnalités** : commandes `/control`, `/config-claude` · affiche : panneau, toasts · options userConfig : aucune
- **Activer** : `<dépôt>/mods/control` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/control`
- **Tests** : `python -I -m unittest discover -s mods/control/tests -p "test_*.py"` · `claude plugin test mods/control`

#### ci

CI routing and pipeline diagram: which CI backends exist (from a config file), whether they are usable, which repo or conversation uses which, and a Diagramme tab (repo -> CI host -> stages/jobs -> result, Gantt, ETA, filters Claude Code / Codex / app / conversation). /ci, /ci diagramme, /ci route, /ci clear

- **État** : en construction · version 0.2.0 · note dans le prompt système désactivée par défaut (prompt_note: false) ; /ci close ferme le panneau ; Diagramme : une phrase en tête (pipelines en cours, rouges avec leur job, runner local N/concurrent), filtres en boutons Tout · Claude Code · Codex · inconnu et groupes par hôte · par app · par conversation, sections repliables, Gantt texte par pipeline (file ░, exécution █, fin estimée ┄, maintenant │), heure de fin estimée = médiane d'au moins 3 runs réussis du même job (sinon médiane des pipelines, sinon « pas assez d'historique »), commande de log par job rouge (montrée, jamais lancée) ; rouge seulement pour un vrai échec (allow_failure en orange) ; attribution Claude / Codex par branche, trailer ou auteur, « inconnu » sinon ; lecture gh/glab seulement sur Rafraîchir ou cache plus vieux que cache_minutes ; titre de conversation lu dans custom-title (ai-title non vérifié)
- **Fonctionnement** : événements `session.start`, `command.run`, `prompt.compose`, `ui.render` · lit : ~/.claude/ci.config.json, fichier de routage, gh/glab auth status, API GitLab (runners) ; onglet Diagramme (/ci diagramme) : gh run list / gh run view --json jobs, glab api en GET (pipelines et jobs des projets et miroirs GitLab), git log -1 du clone local (trailer Co-Authored-By), transcripts ~/.claude/projects/*/*.jsonl (sortie de gh pr create / glab mr create, titre de la conversation), caches ~/.claude/ci-pipelines-cache.json et ci-conversations-cache.json · aucun blocage
- **Fonctionnalités** : commandes `/ci` · affiche : panneau, ligne de statut, note dans le prompt système · options userConfig : aucune
- **Activer** : `<dépôt>/mods/ci` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/ci`
- **Tests** : `python -I -m unittest discover -s mods/ci/tests -p "test_*.py"` · `claude plugin test mods/ci`

#### scenarios

Scénarios d'agents: read-only guide and editable presets of roles -> model, effort, unit and max parallel, with ready-to-paste snippets. /scenarios

- **État** : en construction · version 0.1.0
- **Fonctionnement** : événements `session.start`, `command.run`, `agent.spawn`, `ui.render` · lit : scenarios.json du mod + ton fichier (userConfig file) · aucun blocage
- **Fonctionnalités** : commandes `/scenarios` · affiche : panneau, toasts · options userConfig : file « Extra scenarios file », défaut "" ; warn_no_model « Warn when an Agent call names no model » (on | off), défaut "on"
- **Activer** : `<dépôt>/mods/scenarios` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/scenarios`
- **Tests** : `node --test mods/scenarios/tests/logic.test.mjs` · `claude plugin test mods/scenarios`

#### usage

Consommation : tokens et coût équivalent par jour, heure, projet, modèle, session, type d'agent, surface, skill et MCP ; prévision des limites 5 h et semaine ; débit des scénarios S1-S5 et suggestion Plein régime. Onglet Classement : qui consomme le plus sur 1 h, 4 h, aujourd'hui, 2 j, 7 j ou 30 j, par conversation, projet, modèle, type d'agent, fonction ou Claude/Codex, avec tendance et part. Onglet Codex : tokens Codex du jour et de la semaine par modèle et % de limite lus dans ~/.codex/sessions. Lecture seule. /conso

- **État** : en construction · version 0.3.0 · tokens par 1 % calibrés sur ce PC seulement (non vérifié) ; % Codex lus seulement s'ils sont écrits dans les sessions (Codex 0.142+ via app-server : non vérifié), coût Codex non calculé ; Classement : lignes par heure d'horloge (« 1 h » = tranches qui touchent la dernière heure), sous-agents comptés dans leur conversation parente, famille d'outil non disponible, Codex par jour entier ; ouverture par lien claude:// non vérifiée
- **Fonctionnement** : événements `session.start`, `command.run`, `session.measure`, `ui.render` · lit : transcripts (~/.claude/projects, scanner Node incrémental), $.session.usage() et session.measure pour les % 5 h et semaine, échantillons dans ~/.claude/usage-mod, scenarios.json ; onglet Codex : ~/.codex/sessions/**/rollout-*.jsonl (token_count, turn_context), jamais auth.json ni config.toml ; classement.json (même cache incrémental, 31 j) et fil.json de veille pour le bouton Ouvrir · aucun blocage
- **Fonctionnalités** : commandes `/conso` · affiche : panneau, ligne de statut · options userConfig : status_line « Ligne de statut » (config | on | off), défaut "config" ; codex « Onglet Codex » (config | on | off), défaut "config"
- **Activer** : `<dépôt>/mods/usage` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/usage`
- **Tests** : `node --test mods/usage/tests/logic.test.mjs` · `node --test mods/usage/tests/health.test.mjs` · `node --test mods/usage/tests/codex.test.mjs` · `node --test mods/usage/tests/classement.test.mjs` · `claude plugin test mods/usage`

#### guide

Mode d'emploi des mods, en français : ce qu'est un mod, événements, panneaux, commandes, userConfig, installer, activer, tester, écrire un mod pas à pas, et une fiche par mod du dépôt (lue en direct). Onglets et sommaire. /mods-guide

- **État** : en construction · version 0.1.0
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : MODE-EMPLOI.md, mods.json et les plugin.json / hooks des mods voisins · aucun blocage
- **Fonctionnalités** : commandes `/mods-guide` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/guide` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/guide`
- **Tests** : `node --test mods/guide/tests/guide.test.mjs` · `claude plugin test mods/guide`

#### band

Jauge : bandeau au-dessus du prompt, en lecture seule. Une seule ligne toujours visible : barre fine du contexte (repères relais 250 K et auto-compact, seul le plus proche nommé, vert → orange → rouge) puis « ctx 8 % · compact ~16 min · 434 tok/s · 5 h 24 % · sem 14 % » et un ▸ qui déplie les sections repliables (Cette conversation, Usage, Veille ; résumé d'une ligne quand fermées, état gardé d'une session à l'autre). Ligne orange « Passation conseillée » (Préparer RESUME, Ouvrir RESUME, rien ne se lance seul) et barre Mods qui ouvre et ferme les autres mods. /jauge

- **État** : en construction · version 0.2.0 · bandeau V6 prévu dans ce guide : construit. Seuil d'auto-compact lu dans le breakdown du moteur ; compaction au repos (2.1.299) et son délai non vérifiés dans la doc. Lien « ouvrir le fichier » (file://) vers RESUME : ouverture par la surface non vérifiée ; « relais lancés » = /handoff vus dans cette session seulement. Effort lu dans CLAUDE_EFFORT (non vérifié pour un mod ; absent, seul le modèle s'affiche) ; « agents en cours » = agents qui ont écrit dans les 120 dernières secondes ; état des sections gardé par $.store (documenté « kept between sessions »), non vérifié à la main dans Desktop.
- **Fonctionnement** : événements `session.start`, `command.run`, `session.measure`, `ui.render` · lit : $.session.usage() et session.measure (chiffres de la status line), transcripts ~/.claude/projects lus en incrémental par scanner/scan.mjs (Node 22.18+), cache ~/.claude/band/scan-cache.json · aucun blocage
- **Fonctionnalités** : commandes `/jauge` · affiche : panneau, bandeau, ligne de statut, toasts · options userConfig : config « Settings file », défaut "" ; band « Band above the prompt » (on | off), défaut "on" ; status_line « Status line entry » (on | off), défaut "off"
- **Activer** : `<dépôt>/mods/band` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/band`
- **Tests** : `node --test mods/band/tests/logic.test.mjs` · `node --test mods/band/tests/health.test.mjs` · `claude plugin test mods/band`

#### filetree

An IDE-style file tree for Claude Code that shows what Claude is doing and where in files

- **État** : stable · version 0.2.26 · externe, MIT, data-goblin (Kurt Buhler), copié à la release v0.2.26 sans changement de comportement, libellés en anglais ; contexte envoyé au modèle seulement quand tu cliques un fichier (une ligne « selected » avec son chemin, à chaque prompt tant que la sélection reste ; bouton ⊘ pour l'enlever) ; avant un git commit, un git rev-parse HEAD (≤ 5 s) retarde l'appel ; aucune option de config ajoutée par nous ; détails dans vendor/filetree/NOTICE
- **Fonctionnement** : événements `session.start`, `config.set`, `command.run`, `tool.call`, `ui.message`, `classic.SessionStart`, `classic.CwdChanged`, `classic.FileChanged`, `ui.focus`, `ui.scroll`, `prompt.submit`, `prompt.attachment`, `ui.render` · lit : dossier de travail de la session ($.fs.list), git status / diff / ls-files / rev-parse, état du mod ($.state) ; sous Windows powershell seulement pour ouvrir un fichier au double-clic · aucun blocage
- **Fonctionnalités** : commandes `/filetree` · affiche : panneau, toasts · options userConfig : activity « Claude activity » (reads and writes | writes | reads | none), défaut "reads and writes" ; glyphs « Glyphs » (auto | nerd | plain), défaut "auto" ; follow « Follow Claude » (on | off), défaut "on" ; start « Open at start » (on | off), défaut "on" ; column « Right column » (date | age | size), défaut "date" ; hints « Hints » (on | off), défaut "on" ; open « Open with », défaut ""
- **Activer** : `<dépôt>/vendor/filetree` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir vendor/filetree`
- **Tests** : `claude plugin validate vendor/filetree/.claude-plugin/plugin.json` · `claude plugin test vendor/filetree`

#### machine

Machine : vue en direct de ce PC, en lecture seule. CPU (total et par cœur), RAM, disques, GPU, top 5 processus CPU et mémoire (claude, node, python, git en couleur), charge du runner GitLab local (via le mod ci) et « agents en parallèle conseillés maintenant : N ». /machine

- **État** : en construction · version 0.1.0 · règle « agents conseillés » et plafonds 4 pipelines / 3 npm ci-tsc dans machine.config.json. Non vérifié : enfants du processus runner = jobs locaux ; compteur GPU sur un Windows non anglais ; ordre des mods dans le bandeau : l'entrée garde le dessin des mods suivants, mais band (Jauge) ne garde pas le sien, donc elle n'apparaît que si machine passe avant band.
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.close`, `ui.render` · lit : compteurs système (Windows : ntdll/kernel32 par ctypes ; Linux : /proc), nvidia-smi ou compteur de performance Windows (typeperf) pour le GPU, scanner et config du mod ci pour le runner GitLab (compteurs seulement, jamais de jeton) ; échantillons seulement pendant que le panneau est ouvert (5 s) ou que l'entrée du bandeau est allumée (15 s) · aucun blocage
- **Fonctionnalités** : commandes `/machine` · affiche : panneau, bandeau · options userConfig : config « Settings file », défaut "" ; band « Band entry above the prompt » (on | off), défaut "off"
- **Activer** : `<dépôt>/mods/machine` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/machine`
- **Tests** : `python -I -m unittest discover -s mods/machine/tests -p "test_*.py"` · `node --test mods/machine/tests/logic.test.mjs` · `claude plugin test mods/machine`

#### metrics

Les règles marchent ? PR/MR mergées par jour, tokens par PR, part Opus / Sonnet / Haiku, agents avec modèle nommé, arrêts, refus, gardes de l'app, creux CI, arrêts BLOCKED, avec les versions des règles en repères et un tableau avant / après. Lecture seule. /regles

- **État** : en construction · version 0.1.0 · aucun texte envoyé au modèle (la commande ouvre un panneau). Non vérifié : les attentes de permission (seuls les refus sont comptés), le modèle des agent() de Workflow (lu dans le script), les creux CI (le travail démarrable n'est pas connu).
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : transcripts ~/.claude/projects (lecture incrémentale, parseur de mods/usage/lib), git remote de tes repos, gh search prs / gh run list et glab mr list / glab ci list (lecture seule, au plus toutes les 30 min), git log du fichier de règles ; caches dans ~/.claude/metrics-mod · aucun blocage
- **Fonctionnalités** : commandes `/regles` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/metrics` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/metrics`
- **Tests** : `node --test mods/metrics/tests/logic.test.mjs` · `node --test mods/metrics/tests/health.test.mjs` · `claude plugin test mods/metrics`

#### sante

Santé des mods : une ligne verte / orange / rouge en haut, puis chaque mod chargé par CLAUDE_CODE_PLUGIN_DIRS ou installé : chargé ou non, version, commandes enregistrées, dernier rafraîchissement de ses caches, erreurs, durée et CPU de ses scans (fiches ~/.claude/mods-health), taille des caches, JSON de config invalides, version de Claude Code face au minimum. Lecture seule. /sante

- **État** : en construction · version 0.1.0 · rien n'est supprimé : les commandes de nettoyage sont affichées avec un bouton Copier. Convention proposée : ~/.claude/mods-health/<mod>.json (lastRun, durationMs, cpuMs, error, lastOk, fenêtre 24 h), écrite par band, usage, metrics, ci et machine. Non vérifié : champ de version minimale dans plugin.json (absent de la doc), format de installed_plugins.json, plugin toujours renseigné par $.command.list().
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : CLAUDE_CODE_PLUGIN_DIRS, $.command.list() et $.session.version() ; pour chaque mod : plugin.json, hooks.json, JSON de config, caches (taille, dernière modification), journaux, fiches ~/.claude/mods-health/<mod>.json ; ~/.claude/mods et ~/.claude/plugins/installed_plugins.json ; rapport dans ~/.claude/sante-mod (scanner Node, seulement quand le panneau est demandé) · aucun blocage
- **Fonctionnalités** : commandes `/sante` · affiche : panneau · options userConfig : config « Settings file », défaut ""
- **Activer** : `<dépôt>/mods/sante` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/sante`
- **Tests** : `node --test mods/sante/tests/logic.test.mjs` · `claude plugin test mods/sante` · `claude plugin validate mods/sante`

#### veille

Veille : un script sans tokens (tâche Windows ClaudeVeille) fait le tour des conversations, PR/MR et CI selon un mode (rien, légère, active, nuit-active, nuit-test-légère) et écrit des alertes que ce panneau montre : gravité, depuis quand, conversation ou PR, lien, Ack ; dernier tour (rouge si deux tours manqués), actions avec leur raison. Fil : le dernier message de chaque conversation, par projet puis lead → sous-conversations, sans token (/veille fil). À archiver : les conversations finies, listées pour la conversation VEILLE (/veille archiver). « Attend Julian » (question ouverte, wrap_up, question finale, incohérence entre consignes) : notification Windows et e-mail tout de suite, compteur rouge. /veille [fil|archiver|mode <x>|ack <clé>|coordinateur|tour]

- **État** : en construction · version 0.2.0 · réveil d'une conversation par claude -p --resume <id> (documenté ; vérifié ici sur une session jetable : même transcript, même modèle ; non vérifié : effort, mode de permission différent du défaut, affichage dans l'app Desktop) ; désactivé par défaut (wake.enabled false). Push téléphone : aucun moyen documenté pour un script (PushNotification est un outil de Claude) ; option push.claude (claude -p, coûte des tokens, non vérifié) désactivée ; l'e-mail arrive sur le téléphone par l'app mail. Fil : « Ouvrir la conversation » passe claude://claude.ai/epitaxy/<id> au système (gestionnaire claude: de l'app, route epitaxy vue dans l'app 2.42304) car un Link de panneau n'ouvre que https: ; arrivée sur la session non vérifiée, « Copier l'id » en secours. « Attend Julian » à chaque passage de la tâche (5 min, même en légère) : AskUserQuestion en attente, wrap_up avec ask ou blocked, needs_action, question en fin de dernier message (heuristique), carte d'approbation probable (non vérifié), incohérence entre consignes (mots clés FR/EN) ; notification Windows, e-mail si smtp.json, compteur rouge « attend Julian : N ».
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.close`, `ui.render` · lit : mêmes sources que « Ça t'attend » du mod factory (son scanner et waiting.mjs importés, pas copiés) : fichiers de session de l'app, transcripts, gh search / glab api (jetons gardés par gh et glab, jamais lus) ; état dans ~/.claude/veille (state.json, heartbeat.json, events.jsonl, acks.jsonl, config.json) ; smtp.json créé par toi ; Fil : fichiers de session de l'app (titre, modèle, effort, spawnedFrom, postTurnSummary, PR) et la fin de chaque transcript (dernier texte, wrap_up, AskUserQuestion en attente), écrit par la tâche dans ~/.claude/veille/fil.json ; marques « lu » dans $.store · aucun blocage
- **Fonctionnalités** : commandes `/veille` · affiche : panneau, bandeau · options userConfig : band « Band entry above the prompt » (on | off), défaut "on"
- **Activer** : `<dépôt>/mods/veille` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/veille`
- **Tests** : `node --test mods/veille/tests/logic.test.mjs` · `node --test mods/veille/tests/mail.test.mjs` · `node --test mods/veille/tests/fil.test.mjs` · `claude plugin test mods/veille`

#### menage

Ménage : ce que le travail de Claude laisse traîner sur ce PC, en lecture seule. Worktrees (branche, mergée ou non, propre ou modifié, âge, taille), dossiers de worktree orphelins, branches locales et distantes déjà mergées, copies de mods, sauvegardes de deploy, transcripts par projet, dossiers temporaires, sessions archivables. Pour chaque ligne la commande sûre à lancer, jamais lancée ; en rouge « ne pas supprimer ». /menage

- **État** : en construction · version 0.1.0 · ne supprime rien et ne lance aucune commande : il les montre (bouton Copier). Aucun texte envoyé au modèle. « mergée » = atteignable depuis origin/main au dernier fetch, ou contenu identique / même patch-id dans main (squash), ou PR mergée selon les fichiers de session. Non vérifié : archiver une session hors de l'app (pas de commande documentée) ; format des fichiers de session de l'app (non documenté).
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : git en lecture seule dans chaque dépôt sous repos.roots (worktree list, status, branch --merged, for-each-ref, merge-base, diff --quiet, patch-id ; GIT_OPTIONAL_LOCKS=0, jamais de fetch), tailles des dossiers (pwsh sous Windows, cache 12 h), ~/.claude/mods et CLAUDE_CODE_PLUGIN_DIRS de settings.json, ~/.claude/effort-board/_deploy_backups, ~/.claude/projects (taille, cwd), TEMP/claude, ~/.claude/dev-mods, APPDATA/Claude/scratch-workspaces, fichiers de session de l'app (titre, isArchived, lastActivityAt, prs) ; résultat dans ~/.claude/menage-mod · aucun blocage
- **Fonctionnalités** : commandes `/menage` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/menage` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/menage`
- **Tests** : `node --test mods/menage/tests/logic.test.mjs` · `claude plugin test mods/menage`

#### cockpit

Cockpit, un seul panneau latéral en lecture seule, rangé par périmètre, chaque section repliable avec un résumé d'une ligne : Cette conversation (ouverte et sélectionnée : modèle, effort, ctx, état, arbre lead › sous-conversations › Workflows › agents, étape, PR/CI), Ce projet (arbre, Focus et Pipeline), Tous les projets (une ou deux lignes par projet), Qui consomme (top 3 conversations et projet en tête sur 1 h, aujourd'hui ou 7 j, bouton vers le Classement complet de /conso), Claude global (quotas, Veille, /machine). Petit fil d'Ariane, un clic sur un nœud descend. S'ouvre seul au démarrage, à côté de filetree. /cockpit [niveau] [projet ou conversation]

- **État** : en construction · version 0.1.0 · Un seul panneau rangé par périmètre, de haut en bas : Cette conversation (ouverte, sélectionnée au démarrage ; agents et Workflows terminés repliés derrière un bouton « + N terminé(s) »), Ce projet (lead et sous-conversations par spawnedFrom, y compris les lanes lancées dans un autre dépôt ; Focus + Pipeline de factory), Tous les projets (deux lignes par projet), Claude global (quotas, Veille, bouton /machine). Fermée, chaque section tient sur une ligne de résumé. Un clic sur un nœud descend (Agent : modèle, effort, tokens, coût, journal) et ouvre la section qui le montre ; le fil d'Ariane remonte. Un mod ne peut pas dessiner dans le panneau d'un autre ni importer un fichier hors de son dossier (claude plugin validate le refuse) : les libs de factory, band et veille sont copiées octet pour octet par scripts/sync-libs.mjs et un test échoue si la copie est en retard. Desktop montre un panneau à la fois, les autres en onglets : Cockpit est un onglet à côté de Fichiers (filetree), le bouton « Ouvrir Fichiers » lance /filetree. Placement exact dans Desktop (colonne de droite, largeur) : non vérifié dans la doc. Crédits cloud et semaine Fable : non lisibles depuis un mod quand l'API ne les donne pas.
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.close`, `ui.render` · lit : le scanner de factory (copié dans lib/, mêmes transcripts et fichiers de session de l'app : titres, spawnedFrom, PR) ; $.session.usage() pour les quotas de « Claude global » ; les fichiers de veille (~/.claude/veille). La jauge de contexte n'est plus dans le cockpit : elle est dans band, au-dessus du prompt. Rien n'est lu quand le panneau est fermé ou que l'onglet filetree est celui affiché. ; classement.json du mod usage pour « Qui consomme » (lance le scanner incrémental de usage s'il a plus de 10 min et que la section est ouverte) · aucun blocage
- **Fonctionnalités** : commandes `/cockpit` · affiche : panneau, toasts · options userConfig : start « Open at start » (on | off), défaut "on" ; config « Settings file », défaut ""
- **Activer** : `<dépôt>/mods/cockpit` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/cockpit`
- **Tests** : `node --test mods/cockpit/tests/nav.test.mjs` · `claude plugin test mods/cockpit` · `claude plugin validate mods/cockpit`

#### a-faire

À faire par Julian : tout ce qui attend une action que seul toi peux faire, pour que rien ne se perde. Configuration (smtp.json de la veille, mods installés pas chargés, tâche ClaudeVeille), décisions (DECISIONS-PENDING, PR qui attendent ton accord, questions.md), connexions et 2FA, secrets de tests réels à ranger, tests manuels (manual-checks.md), questions des conversations (alertes « attend Julian » de la veille). Pour chacune : pourquoi elle bloque, les étapes exactes avec Copier, depuis quand, la source ; Fait (revérifie quand c'est possible), Plus tard (1 jour). Lecture seule, sans tokens. /afaire

- **État** : en construction · version 0.1.0 · lecture seule sauf son propre état (Fait, Plus tard) ; aucune source n'est modifiée, aucune commande montrée n'est lancée, aucun texte envoyé au modèle. Fait sur une ligne mesurée (smtp.json, mods, tâche, secrets) revérifie et refuse tant que la cause est là. Non vérifié : format de ~/.claude/tests-reels/registry.json (le mod tests-reels est en construction : un tableau ou {items|secrets|entries} dont status/state/category contient « ranger »). La copie installée de la veille (~/.claude/veille/bin) ne prend le flux qu'après node veille.mjs install.
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : ~/.claude/effort-board/manual-checks.md et questions.md, les fichiers de décisions listés dans sources.decisions.files, gh search prs --author @me (titre, corps, étiquettes ; cache 30 min, jetons gardés par gh), ~/.claude/veille (state.json, acks.jsonl, heartbeat.json, smtp.json : présence et champs, jamais le mot de passe), schtasks /Query ClaudeVeille, CLAUDE_CODE_PLUGIN_DIRS de ~/.claude/settings.json et les dossiers de mods à côté, ~/.claude/tests-reels/registry.json (comptes « à ranger ») ; écrit seulement ~/.claude/a-faire (state.json, items.json, summary.json, notified.json, prs-cache.json) · aucun blocage
- **Fonctionnalités** : commandes `/afaire` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/a-faire` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/a-faire`
- **Tests** : `node --test mods/a-faire/tests/logic.test.mjs` · `claude plugin test mods/a-faire` · `claude plugin validate mods/a-faire`

#### problemes

Problèmes : registre persistant de chaque erreur et problème du travail de Claude, compris une fois et jamais redécouvert. Collecte sans tokens (questions à Julian, fins de tour qui attendent, refus de permission, gardes de l'app et des worktrees, fins BLOCKED, Workflows en échec, CI en échec), dédoublonnée par signature ; arbre de catégories repliables (Blocages manuels, Workflow, Règles, App, CI, Par application, Mods), symptôme, cause, correctif, preuves et chronologie ; filtres ; notes écrites dans le registre local. /problemes

- **État** : en construction · version 0.1.0 · Bouton « Exporter vers eta » et /problemes export : le registre en Markdown masqué vers le dépôt eta (sources/problemes/REGISTRE.md, un fichier par catégorie au-delà de 300 Ko), même masquage et même flux git que le mod export-eta (copiés dans lib/eta/, test de synchro), fichiers non masquables retenus et listés ; chemin du dépôt eta lu dans ~/.claude/export-eta/config.json. Repère AskUserQuestion, fins de tour qui finissent par une question, needs_action de l'app, refus de permission, dossiers et règles accordés, gardes de l'app et des worktrees, rm sur chemin protégé, fins BLOCKED, Workflows avec agents_error, sorties gh / glab en échec ou skipped, erreurs API ; classe par règles du JSON (première qui correspond), dédoublonne par signature (règle + application ou clé), monte compte et dernière vue, rouvre un problème corrigé qui revient. « Par application » est une vue croisée. Le panneau n'écrit que « Ajouter une note » (dans le registre local) ; statut et correctif par la ligne de commande (set). Aucun texte envoyé au modèle. Non vérifié : les demandes de permission acceptées ne sont pas dans les transcripts (seuls les refus et les dossiers ou règles accordés sont comptés) ; format des fichiers de session de l'app (non documenté) ; la Veille installée n'appelle le collecteur qu'après un nouveau veille.mjs install (copie des fichiers).
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : collecteur Node sans tokens (scanner/problemes_scan.mjs collect, lancé par le panneau quand le registre a plus de 30 min, par ↻, ou par la Veille à chaque tour) : octets ajoutés aux transcripts ~/.claude/projects (sessions, sous-agents, agents de Workflow) depuis le dernier passage, fichiers de session de l'app (postTurnSummary.needs_action, sessionPermissionUpdates) ; imports une fois par ligne depuis tes registres (tableaux Markdown, incidents.json, findings.json, fichier ou git show) listés dans ~/.claude/problemes/problemes.config.json ; registre ~/.claude/problemes/register.jsonl (ajout seulement), instantané problems.json lu par le panneau · aucun blocage
- **Fonctionnalités** : commandes `/problemes` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/problemes` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/problemes`
- **Tests** : `node --test mods/problemes/tests/export.test.mjs` · `node --test mods/problemes/tests/logic.test.mjs` · `claude plugin test mods/problemes` · `claude plugin validate mods/problemes`

#### export-eta

Export eta : exporte des conversations Claude Code en Markdown vers le dépôt eta, sans tokens. En cours (instantané de toutes les conversations en cours), Sélection (cases à cocher par projet), Lot terminé (la Veille compte les conversations terminées depuis le dernier export et propose un bouton « Exporter vers eta »). Passe de confidentialité avant écriture (jetons, clés, mots de passe, cookies, chaînes de connexion, JWT, clés privées, e-mails), fichiers non masquables retenus et listés ; worktree neuf du dépôt eta, branche, PR, merge squash. /export, /export-eta

- **État** : en construction · version 0.1.0 · Trois modes : En cours (instantané de toutes les conversations en cours), Sélection (cases à cocher par projet, repliables), Lot terminé (la Veille compte à chaque tour les conversations terminées depuis le dernier export ; à partir de batch_min, défaut 3, ou quand un lead et toutes ses sous-conversations sont terminés, elle affiche « 4 conversations terminées — Exporter vers eta » avec un bouton, dans son onglet Alertes et Fil ; la même ligne et le même bouton apparaissent au-dessus du prompt). auto: true exporte le lot sans clic. Chaque conversation devient un Markdown : en-tête (projet, dossier, branche, modèle · effort, début, dernière activité, état, parent, sous-conversations, PR), puis les messages dans l'ordre, un appel d'outil par ligne, sorties d'outils et fichiers omis, résultats d'agents en une ligne ; découpé en parties au-delà de max_kb (300 Ko). Passe de confidentialité avant écriture (jetons GitHub/GitLab/Anthropic/OpenAI/AWS/Slack, mots de passe, cookies, chaînes de connexion, JWT, clés privées, e-mails sauf les tiens, motifs en plus par config ou fichier) puis une vérification : un fichier avec un secret non masquable est retenu et listé, jamais écrit. Chemin : sources/conversations/<projet>/<date>-<titre>-<id>.md, INDEX.md par projet et global ; un ré-export réécrit son propre fichier (retrouvé par l'id), jamais un autre. Git : worktree neuf du dépôt eta, branche export/conversations-<date-heure>, commit, push, PR, merge squash (checks verts s'il y en a, sinon après la passe de confidentialité), branche distante supprimée, worktree retiré ; jamais de push sur main ni de force-push. /export peut être pris par la commande intégrée de Claude Code : /export-eta marche toujours. La copie du veilleur installée (~/.claude/veille/bin) ne prend l'export qu'après un nouveau « veille install ».
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : les fichiers de session de l'app Desktop (titre, modèle, effort, état de fin de tour, spawnedFrom, PR) et les transcripts de ~/.claude/projects, lus par un script Node sans dépendance ; ~/.claude/export-eta (config.json, state.json, sessions.json, pending.json) ; le dépôt eta (chemin dans config.json, jamais dans le dépôt public), où le mod crée un worktree neuf. Aucun appel de modèle. · aucun blocage
- **Fonctionnalités** : commandes aucune · affiche : panneau, bandeau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/export-eta` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/export-eta`
- **Tests** : `node --test mods/export-eta/tests/logic.test.mjs` · `node --test mods/veille/tests/export.test.mjs` · `claude plugin test mods/export-eta` · `claude plugin validate mods/export-eta`

#### tests-reels

Tests réels : le registre des tests hors CI par application (tenant de test, Cloudflare Access et Workers, Power BI Desktop / SSAS / Docker en local, automatisation d'interface, vérifications manuelles), en lecture seule. Par appli : environnements, comptes de test masqués (seulement l'endroit où le secret est rangé, jamais sa valeur), procédures et derniers essais (vert, rouge, jamais), « jamais testé en réel », et la liste « À ranger ». Données locales dans ~/.claude/tests-reels. /tests

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

Lance `claude plugin validate` puis `claude --debug` : un hook qui plante est sauté et la raison est dans le journal (et dans une ligne grise du fil quand le dossier est rechargé à chaud). ([reference](https://code.claude.com/docs/en/plugins/mods/reference)) Avant ça, `/sante` dit en une ligne quels mods sont chargés, lesquels n'ont enregistré aucune commande, quels JSON sont invalides et quel scan est en erreur.

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

#### Ouvrir un autre mod depuis la Jauge

La ligne « Mods : » sous la Jauge a un bouton par mod (`launcher` dans `band.config.json`). Un clic lance sa commande et ouvre son panneau, le bouton devient « Conso ✕ » ; un second clic le ferme. Un bouton grisé = mod non chargé : ajouter `<dépôt>/mods/<x>` à `CLAUDE_CODE_PLUGIN_DIRS` et ouvrir une nouvelle session.

#### Passer le relais depuis la Jauge

Quand le contexte de la conversation atteint 250 K (règle RESUME) ou que l'auto-compact est prévu dans moins de 20 min, une ligne orange « Passation conseillée » apparaît sous la Jauge. « Préparer RESUME » lance `/handoff` (le skill `~/.claude/skills/handoff`) ; grisé si ce skill n'est pas dans la session. « Ouvrir RESUME » affiche `handoff/RESUME.md` du dossier de la session (puis de la racine du dépôt) dans le panneau /jauge, avec son âge (« mis à jour il y a 3 h » ou « absent »). Rien ne se lance tout seul : seulement sur clic. Le panneau liste aussi les 3 derniers relais et compactages de la conversation. Seuils, commande, fichiers et libellés : `handoff` dans `band.config.json`.
