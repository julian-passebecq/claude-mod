# usage — « Consommation »

Read-only pane: what your agents burn (tokens and list-price cost equivalent) and when the plan's 5-hour and weekly windows run out. `/conso [aujourdhui|semaine|prevision|scenarios|plein] [refresh]`. UI in French.

## Onglets

- **Aujourd'hui / Semaine** : tokens et coût équivalent par jour, carte de chaleur par heure (7 jours), par projet, modèle, type (fil principal, sous-agent Agent, agent de Workflow, sous-conversation), surface de l'app (`entrypoint` du transcript : onglet Code, CLI, SDK, cloud), effort, skill (`attributionSkill`) et serveur MCP (`attributionMcpServer`), top 10 des sessions de la semaine.
- **Prévision** : % semaine et 5 h, reset, rythme sur les 2 dernières heures, aujourd'hui et en moyenne 7 jours ; trois projections configurables (calme / normal / intense) ; « épuisé le <jour> à <heure> » ou « il restera X % au reset ».
- **Scénarios de consommation** : débit estimé de S1-S5 du mod [`scenarios`](../scenarios) à partir de l'historique mesuré (tokens par heure active, par type d'agent et famille de modèle), et lequel tient dans le quota restant avant le reset.
- **Plein régime** : quand il restera plus de `min_left_pct` % au reset à moins de `max_hours_left` h de celui-ci, suggère S5 « Plein régime » (Opus high/xhigh partout, parallélisme au plafond du PC) et montre le texte à copier. Le mod ne lance rien.
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

Aucun fichier d'identifiants n'est lu ; seuls les `*.jsonl` sous `projects_dir` et le dossier du mod.

## Réglages

`usage.config.json` (seuils, plan `max-20x`, projections, libellés, surfaces, `plein_regime`, `scenario_estimate`, prix par id de modèle dans `prices`), surchargeable dans `~/.claude/usage-mod/usage.config.json`. Option `status_line` (`config` | `on` | `off`). S5 se règle dans `mods/scenarios/scenarios.json`.

## Module partagé (`lib/`)

- `lib/transcripts.mjs` (pur, sans I/O) : `usageOf(ligne)` → requête (tokens, modèle, heure, attributions) ; `feedLine(état, ligne, { prices, claim })` pour un parseur incrémental par fichier ; `kindOfPath`, `projectOf`, `familyOf`, `aggregate`.
- `lib/prices.json` + `priceFor(model, table)` / `costOf(vecteur, model, table)` : coût au prix public (palier Haiku > 100 K compris).
- `lib/scan-node.mjs` (Node, bibliothèque standard) : `scanProjects({ root, cache, prices })` relit seulement ce qui a été ajouté depuis le dernier passage (offset par fichier, dédoublonnage entre fichiers).
- Vecteur de chiffres : `[input, output, cache_read, cache_write_5m, cache_write_1h, requêtes, secondes actives, coût $]` (`V` donne les index, `tokensOf` la somme des tokens).
- Exemple : `import { usageOf, costOf } from '../usage/lib/transcripts.mjs'` puis `costOf(usageOf(JSON.parse(line)).v, model, prices)`.

Scanner : `node mods/usage/scanner/usage_scan.mjs report` affiche les totaux et la prévision dans le terminal (`scan` met à jour `~/.claude/usage-mod/aggregate.json`).

Le parseur incrémental et la table de prix reprennent des idées de [claude-goblin](https://github.com/data-goblin/claude-goblin) (MIT) : clé `message.id` + `requestId`, état par fichier, prix publics.
