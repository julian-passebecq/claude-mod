# usage — « Consommation »

**Now shown inside Cockpit** (cards Qui consomme and Quota, Voir → `/conso`); `/conso` keeps working.

Read-only pane: what your agents burn (tokens and list-price cost equivalent) and when the plan's 5-hour and weekly windows run out. `/conso [aujourdhui|semaine|prevision|scenarios|plein|codex] [refresh]`. UI in French.

## Onglets

- **Aujourd'hui / Semaine** : tokens et coût équivalent par jour, carte de chaleur par heure (7 jours), par projet, modèle, type (fil principal, sous-agent Agent, agent de Workflow, sous-conversation), surface de l'app (`entrypoint` du transcript : onglet Code, CLI, SDK, cloud), effort, skill (`attributionSkill`) et serveur MCP (`attributionMcpServer`), top 10 des sessions de la semaine.
- **Prévision** : % semaine et 5 h, reset, rythme sur les 2 dernières heures, aujourd'hui et en moyenne 7 jours ; trois projections configurables (calme / normal / intense) ; « épuisé le <jour> à <heure> » ou « il restera X % au reset ».
- **Scénarios de consommation** : débit estimé de S1-S5 du mod [`scenarios`](../scenarios) à partir de l'historique mesuré (tokens par heure active, par type d'agent et famille de modèle), et lequel tient dans le quota restant avant le reset.
- **Plein régime** : quand il restera plus de `min_left_pct` % au reset à moins de `max_hours_left` h de celui-ci, suggère S5 « Plein régime » (Opus high/xhigh partout, parallélisme au plafond du PC) et montre le texte à copier. Le mod ne lance rien.
- **Classement** (`/conso classement`) : qui consomme le plus. Fenêtres en boutons (1 h · 4 h · aujourd'hui · 2 j · 7 j · 30 j, réglables dans `classement.presets`), regroupement en boutons (conversation · projet · modèle · type d'agent · fonction · Claude / Codex). Tableau des 20 premiers + « autres » : tokens (entrée, sortie, cache lu, cache écrit), équivalent prix public, part, tendance contre la fenêtre de même longueur juste avant, petite barre. Les sous-agents et agents de Workflow sont comptés dans leur conversation parente, avec la part « sous-agents ». Une ligne de conversation montre son titre et son id avec « Copier l'id » et, si le Fil de veille la connaît, « Ouvrir » (lien claude:// de l'app, même règle que le Fil ; non vérifié). Le total « aujourd'hui » est celui de l'onglet Aujourd'hui (même cache, testé). Les lignes sont par heure d'horloge : « 1 h » couvre les tranches qui touchent la dernière heure. Non disponible : la famille d'outil et les commandes de mod (les transcripts donnent les tokens par requête). Codex : par jour entier, hors total. En ligne de commande : `node scanner/usage_scan.mjs classement --preset today --group conversation --top 3 [--json]`. Le scanner écrit `classement.json` (31 jours, ~0,5 Mo) à chaque scan.
- **Codex** : tokens Codex aujourd'hui et sur 7 jours (entrée dont cache, sortie dont raisonnement), par modèle et par jour, et les % de limite que Codex écrit lui-même (« Semaine 40 % · reset … · lu à … »). Une ligne en tête du panneau met Claude et Codex côte à côte, et `/conso` l'ajoute à sa réponse. Quand rien n'est écrit : « non disponible », jamais une estimation. Option `codex` (`config` | `on` | `off`) et `codex.enabled` (`auto` par défaut : actif si le dossier existe).
- **Quotas** (ligne en tête du panneau et dans la réponse de `/conso`) : « Claude 5 h 24 % · semaine 14 % · épuisé ven 14:00 | Codex 5 h ? · semaine 18 % », lue par `lib/core/usage.mjs` (`node scanner/usage_scan.mjs quotas`) : le même lecteur que band et Cockpit, donc les mêmes chiffres partout.
- **Ligne de statut** (option, off par défaut) : « Semaine 34 % · épuisé ven 14h au rythme actuel ».

## D'où viennent les chiffres

| Chiffre | Source | Statut |
|---|---|---|
| Tokens par requête (input, output, cache read, cache write 5 min / 1 h), modèle, heure, cwd, session, effort, skill, MCP | `~/.claude/projects/**/*.jsonl`, sous-agents (`<session>/subagents/agent-*.jsonl`) et agents de Workflow (`<session>/subagents/workflows/wf_*/agent-*.jsonl`) ; une requête = `message.id` + `requestId`, comptée une fois | lu sur ce PC |
| % 5 h et semaine, reset | `$.session.usage().rateLimits` et l'événement `session.measure` du mod (`kind` `five_hour` / `seven_day`, `percentUsed`, `resetsAt`) ; ce sont les champs `rate_limits.five_hour` / `seven_day` de la [ligne de statut](https://code.claude.com/docs/en/statusline) (abonnés Pro et Max, après la première réponse de la session). [claude-hud](https://github.com/jarrodwatts/claude-hud) les lit de la même façon (stdin de la ligne de statut). `/usage` les montre aussi ([costs](https://code.claude.com/docs/en/costs), [aide](https://support.claude.com/en/articles/11145838)) | officiel |
| Tokens par 1 % | Anthropic ne publie aucun volume de tokens pour Max. Chaque lecture (heure, %, reset) est gardée dans `~/.claude/usage-mod/samples.jsonl` ; tokens par 1 % = tokens comptés localement depuis le début de la fenêtre (reset − 7 j) / %, médiane des échantillons | **non vérifié** : seuls les transcripts de ce PC comptent (une session cloud ou un autre PC fait monter le % sans tokens locaux), et le poids réel de chaque type de token et de chaque modèle dans la limite n'est pas publié. `basis` = `cost` (défaut, pondère par le prix public) ou `tokens` |
| Coût | prix publics [claude.com/pricing](https://claude.com/pricing) dans `lib/prices.json` (écriture cache 1 h = 2 × input, non vérifié pour les modèles 5.x) | estimation, un plan Max ne facture pas au token |
| Sous-conversation | transcript principal dont le premier prompt vient d'une autre session (`origin.kind` = `peer`) | **non vérifié** |
| Débit d'un scénario | débit mesuré par heure active × `max_parallel` × occupation × facteur d'effort (`scenario_estimate`) | **non vérifié** (occupation et facteurs sont des estimations réglables) |

| Tokens Codex (par jour et modèle) | `~/.codex/sessions/AAAA/MM/JJ/rollout-*.jsonl` (`codex.sessions_dir`) : `event_msg` / `token_count` donne `info.total_token_usage` cumulé par session (différence entre deux événements = tokens de l'événement, rangés au jour et au modèle courant) ; `turn_context.payload.model` donne le modèle. Même source que le plugin codex-hud (`src/local-logs.ts`) | lu sur ce PC ; format interne de Codex, pas documenté publiquement (**non vérifié**) |
| % de limite Codex | `token_count.rate_limits` (`primary` / `secondary` : `used_percent`, `window_minutes` 300 = 5 h, 10080 = semaine, `resets_at`), lecture la plus récente | lu sur ce PC ; une fenêtre absente est affichée « non disponible ». Codex 0.142+ lancé par l'app-server n'écrirait plus ces % sur disque d'après codex-hud (**non vérifié**) : le mod ne lance pas Codex et n'appelle pas son RPC |
| Coût Codex | non calculé (pas de tarif fiable par abonnement) | — |

Aucun fichier d'identifiants n'est lu ; seuls les `*.jsonl` sous `projects_dir`, les `rollout-*.jsonl` sous `codex.sessions_dir` et le dossier du mod (jamais `~/.codex/auth.json`, `config.toml`, `.env` ni les bases sqlite).

## Réglages

`usage.config.json` (seuils, plan `max-20x`, projections, libellés, surfaces, `plein_regime`, `scenario_estimate`, prix par id de modèle dans `prices`), surchargeable dans `~/.claude/usage-mod/usage.config.json`. Option `status_line` (`config` | `on` | `off`). S5 se règle dans `mods/scenarios/scenarios.json`.

## Module partagé (`lib/`)

- `lib/transcripts.mjs` (pur, sans I/O) : `usageOf(ligne)` → requête (tokens, modèle, heure, attributions) ; `feedLine(état, ligne, { prices, claim })` pour un parseur incrémental par fichier ; `kindOfPath`, `projectOf`, `familyOf`, `aggregate`.
- `lib/prices.json` + `priceFor(model, table)` / `costOf(vecteur, model, table)` : coût au prix public (palier Haiku > 100 K compris).
- `lib/scan-node.mjs` (Node, bibliothèque standard) : `scanProjects({ root, cache, prices })` relit seulement ce qui a été ajouté depuis le dernier passage (offset par fichier, dédoublonnage entre fichiers).
- Vecteur de chiffres : `[input, output, cache_read, cache_write_5m, cache_write_1h, requêtes, secondes actives, coût $]` (`V` donne les index, `tokensOf` la somme des tokens).
- Exemple : `import { usageOf, costOf } from '../usage/lib/transcripts.mjs'` puis `costOf(usageOf(JSON.parse(line)).v, model, prices)`.

Scanner : `node mods/usage/scanner/usage_scan.mjs report` affiche les totaux, Codex et la prévision dans le terminal (`scan` met à jour `~/.claude/usage-mod/aggregate.json` et `codex.json` ; `codex` ne fait que la partie Codex, lecture incrémentale par fichier).

Le parseur incrémental et la table de prix reprennent des idées de [claude-goblin](https://github.com/data-goblin/claude-goblin) (MIT) : clé `message.id` + `requestId`, état par fichier, prix publics.
