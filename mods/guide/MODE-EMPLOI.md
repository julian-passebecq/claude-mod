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
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "<dépôt>/mods/factory;<dépôt>/mods/control;<dépôt>/mods/ci;<dépôt>/mods/scenarios;<dépôt>/mods/guide;<dépôt>/mods/usage;<dépôt>/mods/band" }
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

Factory views: per-conversation agent tree with bill, guards, log and warnings (/factory), and a dashboard of all live conversations with routing shares (/factory-all)

- **État** : stable · version 0.3.0
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.close`, `ui.render` · lit : transcripts (~/.claude/projects), fichiers de session de l'app, gh/glab pour l'état des PR · aucun blocage
- **Fonctionnalités** : commandes `/factory` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/factory` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/factory`
- **Tests** : `node --test mods/factory/tests/logic.test.mjs` · `claude plugin test mods/factory`

#### control

Claude Control panes: SETUP (everything that shapes a session, hidden rules flagged), USAGE (1/7/30-day model, effort and delegation mix with rule targets) and PRACTICES (our way of working, followed or not). /control

- **État** : stable · version 0.1.0 · métriques et pratiques encore V5, réécriture V6 prévue
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : settings, CLAUDE.md, agents, skills, hooks, mémoire, transcripts (scanner Python) · aucun blocage
- **Fonctionnalités** : commandes `/control` · affiche : panneau, toasts · options userConfig : aucune
- **Activer** : `<dépôt>/mods/control` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/control`
- **Tests** : `python -I -m unittest discover -s mods/control/tests -p "test_*.py"` · `claude plugin test mods/control`

#### ci

CI routing: which CI backends exist (from a config file), whether they are usable (token, runners, jobs), and which repo or conversation uses which. /ci, /ci route, /ci clear

- **État** : en construction · version 0.1.0 · note dans le prompt système désactivée par défaut (prompt_note: false) ; /ci close ferme le panneau
- **Fonctionnement** : événements `session.start`, `command.run`, `prompt.compose`, `ui.render` · lit : ~/.claude/ci.config.json, fichier de routage, gh/glab auth status, API GitLab (runners) · aucun blocage
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

Consommation : tokens et coût équivalent par jour, heure, projet, modèle, session, type d'agent, surface, skill et MCP ; prévision des limites 5 h et semaine ; débit des scénarios S1-S5 et suggestion Plein régime. Onglet Codex : tokens Codex du jour et de la semaine par modèle et % de limite lus dans ~/.codex/sessions. Lecture seule. /conso

- **État** : en construction · version 0.2.0 · tokens par 1 % calibrés sur ce PC seulement (non vérifié) ; % Codex lus seulement s'ils sont écrits dans les sessions (Codex 0.142+ via app-server : non vérifié), coût Codex non calculé
- **Fonctionnement** : événements `session.start`, `command.run`, `session.measure`, `ui.render` · lit : transcripts (~/.claude/projects, scanner Node incrémental), $.session.usage() et session.measure pour les % 5 h et semaine, échantillons dans ~/.claude/usage-mod, scenarios.json ; onglet Codex : ~/.codex/sessions/**/rollout-*.jsonl (token_count, turn_context), jamais auth.json ni config.toml · aucun blocage
- **Fonctionnalités** : commandes `/conso` · affiche : panneau, ligne de statut · options userConfig : status_line « Ligne de statut » (config | on | off), défaut "config" ; codex « Onglet Codex » (config | on | off), défaut "config"
- **Activer** : `<dépôt>/mods/usage` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/usage`
- **Tests** : `node --test mods/usage/tests/logic.test.mjs` · `node --test mods/usage/tests/codex.test.mjs` · `claude plugin test mods/usage`

#### guide

Mode d'emploi des mods, en français : ce qu'est un mod, événements, panneaux, commandes, userConfig, installer, activer, tester, écrire un mod pas à pas, et une fiche par mod du dépôt (lue en direct). Onglets et sommaire. /mods-guide

- **État** : en construction · version 0.1.0
- **Fonctionnement** : événements `session.start`, `command.run`, `ui.render` · lit : MODE-EMPLOI.md, mods.json et les plugin.json / hooks des mods voisins · aucun blocage
- **Fonctionnalités** : commandes `/mods-guide` · affiche : panneau · options userConfig : aucune
- **Activer** : `<dépôt>/mods/guide` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/guide`
- **Tests** : `node --test mods/guide/tests/guide.test.mjs` · `claude plugin test mods/guide`

#### band

Jauge : bandeau toujours visible au-dessus du prompt, en lecture seule. Contexte de cette conversation face à l'auto-compact et au seuil de relais RESUME, débit en tok/s (cette conversation, ses agents, le projet, tout le PC) et compactages, plus une barre Mods qui ouvre et ferme les autres mods. /jauge

- **État** : en construction · version 0.1.0 · bandeau V6 prévu dans ce guide : construit. Seuil d'auto-compact lu dans le breakdown du moteur ; compaction au repos (2.1.299) et son délai non vérifiés dans la doc.
- **Fonctionnement** : événements `session.start`, `command.run`, `session.measure`, `ui.render` · lit : $.session.usage() et session.measure (chiffres de la status line), transcripts ~/.claude/projects lus en incrémental par scanner/scan.mjs (Node 22.18+), cache ~/.claude/band/scan-cache.json · aucun blocage
- **Fonctionnalités** : commandes `/jauge` · affiche : panneau, bandeau, ligne de statut, toasts · options userConfig : config « Settings file », défaut "" ; band « Band above the prompt » (on | off), défaut "on" ; status_line « Status line entry » (on | off), défaut "off"
- **Activer** : `<dépôt>/mods/band` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir mods/band`
- **Tests** : `node --test mods/band/tests/logic.test.mjs` · `claude plugin test mods/band`

#### filetree

An IDE-style file tree for Claude Code that shows what Claude is doing and where in files

- **État** : stable · version 0.2.26 · externe, MIT, data-goblin (Kurt Buhler), copié à la release v0.2.26 sans changement de comportement, libellés en anglais ; contexte envoyé au modèle seulement quand tu cliques un fichier (une ligne « selected » avec son chemin, à chaque prompt tant que la sélection reste ; bouton ⊘ pour l'enlever) ; avant un git commit, un git rev-parse HEAD (≤ 5 s) retarde l'appel ; aucune option de config ajoutée par nous ; détails dans vendor/filetree/NOTICE
- **Fonctionnement** : événements `session.start`, `config.set`, `command.run`, `tool.call`, `ui.message`, `classic.SessionStart`, `classic.CwdChanged`, `classic.FileChanged`, `ui.focus`, `ui.scroll`, `prompt.submit`, `prompt.attachment`, `ui.render` · lit : dossier de travail de la session ($.fs.list), git status / diff / ls-files / rev-parse, état du mod ($.state) ; sous Windows powershell seulement pour ouvrir un fichier au double-clic · aucun blocage
- **Fonctionnalités** : commandes `/filetree` · affiche : panneau, toasts · options userConfig : activity « Claude activity » (reads and writes | writes | reads | none), défaut "reads and writes" ; glyphs « Glyphs » (auto | nerd | plain), défaut "auto" ; follow « Follow Claude » (on | off), défaut "on" ; start « Open at start » (on | off), défaut "on" ; column « Right column » (date | age | size), défaut "date" ; hints « Hints » (on | off), défaut "on" ; open « Open with », défaut ""
- **Activer** : `<dépôt>/vendor/filetree` dans `CLAUDE_CODE_PLUGIN_DIRS`, ou `claude --plugin-dir vendor/filetree`
- **Tests** : `claude plugin validate vendor/filetree/.claude-plugin/plugin.json` · `claude plugin test vendor/filetree`

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

Lance `claude plugin validate` puis `claude --debug` : un hook qui plante est sauté et la raison est dans le journal (et dans une ligne grise du fil quand le dossier est rechargé à chaud). ([reference](https://code.claude.com/docs/en/plugins/mods/reference))

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
