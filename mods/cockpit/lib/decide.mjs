// cockpit - the decision screens, pure (no $, no I/O, no imports; node --test mods/cockpit/tests/decide.test.mjs).
// Each screen answers one decision of Julian's:
//   Nuit     « Bilan avant la nuit »: what runs and until when, the night hours nobody uses, the quota left and what the
//            night would burn, the lanes / packets ready to start; then Nuit active / Lancer X / Rien.
//   Relais   Claude ↔ Codex: who opened, fixed, merged what, the hand-offs, dependencies, green rate per agent
//            (the ci mod's dataset ~/.claude/ci-cache/interactions.json).
//   Galerie  the Reference Gallery views the mods lacked: Équipe (lead → advisor / worker / reviewer / explorer /
//            researcher lanes, return to lead), Lanes (one per worktree of the project, its reviewer / adversary agents),
//            Séquence (one conversation as a sequence diagram: lead ⇄ agents over time), Carte (the control layers in
//            one compact map), Doux / dur (the soft-control concept map: what the model reads vs what the harness
//            enforces), Codex (approvals and cost).
// Plus the « Claude Control » to-dos (~/.claude/a-faire/claude-control.md) sorted by deadline, for a home card.
// Every label, preset and threshold is in DECIDE_DEFAULTS and can be overridden in cockpit.config.json.

const pad = (n) => String(n).padStart(2, '0')
const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const fin = (v) => Number.isFinite(v)
const clip = (s, n) => { s = String(s ?? ''); return s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + '…' }
const fill = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
const hours = (ms) => { const h = Math.max(0, ms) / 3600000; return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1).replace('.', ',')} h` }
const durText = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${pad(m % 60)}`
}

export const DECIDE_DEFAULTS = {
  nuit: {
    wake: '07:30',
    max_ready: 8,
    per_repo: 3,
    // what counts as « ready to start » in a repo's handoff/ROADMAP.md (regex, case-insensitive), and packet files
    ready_match: '^\\s*[-*]\\s*\\[ \\]\\s+|\\b(prêt|prête|prêts|ready|à lancer|next up)\\b',
    skip_sections: 'idées de julian|done|fait|terminé|shipped',
    packet_match: '^(packet|paquet|go|lane|brief)[-_ .].*\\.md$',
    packet_dirs: ['handoff', 'handoff/packets'],
    // what « Lancer » shows (it never starts anything): a fresh session in the repo, the rules' coder model and effort
    launch: 'cd "{repo}" ; claude --model {model} --effort {effort} "{prompt}"',
    launch_prompt: 'Lis {source} et lance : {item}',
    launch_model: 'opus',
    launch_effort: 'medium',
    labels: {
      title: 'Bilan avant la nuit',
      running: 'Ce qui tourne',
      running_none: 'rien ne tourne',
      ends: 'fin vers {time}',
      ends_unknown: 'fin inconnue (pas assez d’historique)',
      hours_left: 'reste {left}',
      night: 'Nuit',
      night_line: 'jusqu’à {wake} : {total} de nuit · {used} occupées par ce qui tourne · {free} inutilisées',
      night_unknown: '{n} élément(s) sans heure de fin : les heures inutilisées sont au mieux {free}',
      quota: 'Quota',
      quota_line: '5 h {five} · semaine {week} (reste {left} %)',
      quota_burn: 'la nuit consommerait ~{burn} % de la semaine au rythme actuel ({rate} %/h)',
      quota_burn_unknown: 'rythme de la semaine inconnu : ce que la nuit consommerait n’est pas lisible',
      quota_none: 'quotas non lus (le mod usage écrit samples.jsonl)',
      quota_out: 'semaine épuisée vers {at} à ce rythme',
      ready: 'Prêt à lancer',
      ready_none: 'aucune lane ni paquet prêt lu dans les ROADMAP.md et handoff/ des repos récents',
      choose: 'Que fait la nuit ?',
      night_active: 'Nuit active (/veille nuit)',
      launch: 'Lancer',
      nothing: 'Rien',
      day: 'Jour (/veille jour)',
      launch_title: 'Pour lancer (rien n’est lancé d’ici) :',
      launch_hint: 'Colle cette commande dans un terminal, ou ouvre une conversation dans ce dossier avec ce texte.',
      nothing_done: 'Rien lancé : la nuit reste en mode actuel.',
      source_roadmap: 'ROADMAP',
      source_packet: 'paquet',
    },
  },
  relais: {
    max_repos: 8,
    max_prs: 8,
    labels: {
      title: 'Claude ↔ Codex',
      none: 'pas encore de données : /ci relais refresh (le mod ci écrit ~/.claude/ci-cache/interactions.json)',
      generated: 'données du {time} · {days} derniers jours · {prs} PR/MR',
      agents: 'Qui fait quoi',
      agent_row: '{agent} : {opened} ouvertes · {fixed} corrigées · {merged} mergées · CI des PR {pr_rate} · pipelines {run_rate}',
      handoffs: 'Passages de relais',
      handoffs_row: '{n} relais ({kinds}) dans {prs} PR · {deps} PR avec dépendance',
      repos: 'Par repo',
      repo_row: '{repo} : {parts}',
      prs: 'PR ouvertes ou avec relais',
      pr_row: '#{number} {repo} · {who} · CI {ci}{handoff}{deps}',
      unknown: 'inconnu',
      errors: '{n} repo(s) illisible(s)',
    },
  },
  galerie: {
    views: ['equipe', 'lanes', 'sequence', 'carte', 'concept', 'codex'],
    roles: {
      advisor: ['advisor', 'architect', 'plan'],
      worker: ['coder', 'general-purpose', 'worker', 'tester', 'debug', 'docs-writer'],
      // the adversary / reviewer role of the Agent-teams view: whoever checks the workers' output
      reviewer: ['reviewer', 'review', 'verify', 'verifier', 'auditor', 'adversary', 'code-reviewer', 'critic'],
      explorer: ['explore', 'explore-fast'],
      researcher: ['research', 'researcher', 'deep-research', 'web'],
    },
    // Codex list prices per million tokens (API equivalent; cached input not deducted), by model id prefix. Empty or
    // unknown model: « tarif inconnu ». Sources: scenarios/versus.json (pages read 16 Oct 2026).
    codex_prices: { 'gpt-6-astra': { in: 10, out: 50 }, 'gpt-5-6-sol': { in: 4, out: 20 } },
    codex_days: 7,
    // Lanes: conversations of the selected one's project active in the last lanes_days days, one lane per worktree;
    // a conversation whose title matches lane_reviewer_match is itself a reviewer lane.
    lanes_days: 3,
    lanes_max: 8,
    lane_reviewer_match: '\\b(verify|vérif|review|relecture|relecteur|adversa|audit)',
    // Séquence: at most seq_agents agent lifelines (the most recent), seq_events events (the latest)
    seq_agents: 5,
    seq_events: 24,
    // Doux / dur: each layer, the Carte field it counts (rules, memory, skills, agents, workflows, mods, mode, hooks, env)
    concept: {
      soft: [
        { label: 'Règles (CLAUDE.md)', from: 'rules' }, { label: 'Mémoire', from: 'memory' },
        { label: 'Skills', from: 'skills' }, { label: 'Agents (prompts)', from: 'agents' },
      ],
      hard: [
        { label: 'Mode de permission', from: 'mode' }, { label: 'Hooks', from: 'hooks' }, { label: 'Réglages env', from: 'env' },
        { label: 'Workflows (script)', from: 'workflows' }, { label: 'Mods (montrent, avertissent)', from: 'mods' },
      ],
    },
    labels: {
      title: 'Galerie',
      views: { equipe: 'Équipe', lanes: 'Lanes', sequence: 'Séquence', carte: 'Carte', concept: 'Doux / dur', codex: 'Codex' },
      lead: 'Lead · {title} · {model} · {effort}',
      lanes: { advisor: 'Conseil (advisor)', worker: 'Workers', reviewer: 'Relecteurs (adversaire)', explorer: 'Explorateurs', researcher: 'Chercheurs', other: 'Autres' },
      advisor_calls: '/advisor consulté {n} fois{at}',
      lane_empty: 'aucun',
      returned: '↩ rendu au lead {time}',
      running: 'en cours depuis {dur}',
      failed: '✕ échec',
      stopped: 'arrêté',
      no_conv: 'aucune conversation sélectionnée (Cockpit › une conversation)',
      map: 'Carte du contrôle',
      map_rows: { rules: 'Règles', settings: 'Réglages', agents: 'Agents', skills: 'Skills', workflows: 'Workflows', mods: 'Mods', memory: 'Mémoire' },
      map_none: 'non lu',
      codex: 'Codex : approbations et coût',
      codex_none: 'Codex non lu (~/.codex/sessions absent, ou le mod usage n’a pas encore écrit codex.json)',
      codex_policy: 'politique d’approbation : {list}',
      codex_requests: '{n} demande(s) d’approbation · {sessions} session(s) sur {days} j',
      codex_row: '{model} : {tokens} tokens · {cost}',
      codex_total: 'Total {days} j : {tokens} tokens · {cost}',
      price_unknown: 'tarif inconnu',
      identity: 'Connexion',
      wt_title: 'Lanes de {repo} : une par worktree, {days} derniers jours',
      wt_main: 'checkout principal',
      wt_none: 'aucune conversation de ce projet active sur {days} j',
      wt_no_repo: 'aucune conversation sélectionnée (Cockpit › une conversation)',
      wt_lane: '{folder}{branch}',
      wt_conv: '{title} · {state}{agents}',
      wt_pr: 'PR #{number} · {state} · CI {ci}',
      wt_reviewers: 'relecture : {list}',
      wt_no_reviewer: 'aucun relecteur (adversaire) lancé',
      wt_is_reviewer: 'lane de relecture',
      wt_more: '+ {n} lane(s)',
      seq_title: 'Séquence · {title}',
      seq_none: 'aucun agent dans cette conversation : rien à dessiner',
      seq_lead: 'Lead',
      seq_call: '{type} · {desc}',
      seq_done: '{type} ↩ rendu au lead',
      seq_failed: '{type} ✕ échec',
      seq_advisor: '/advisor consulté',
      seq_hidden: '+ {n} agent(s) plus anciens hors du diagramme',
      seq_older: '+ {n} événement(s) plus anciens',
      concept_title: 'Contrôle doux / dur (modèle ⇄ harness)',
      concept_soft: 'Doux : le modèle les lit et peut s’en écarter',
      concept_hard: 'Dur : le harness les applique, le modèle ne peut pas passer outre',
      concept_flow: 'consigne → modèle (choisit) → appel d’outil → harness (permet, refuse) → effet',
      concept_note: 'Ce qui doit tenir à coup sûr va côté dur ; ici aucun hook ne bloque sans le oui de Julian (§6).',
      concept_default: 'défaut',
    },
  },
  controle: {
    file: '~/.claude/a-faire/claude-control.md',
    max: 3,
    warn_days: 7,
    bad_days: 1,
  },
}

function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a || {}) }
  for (const [k, v] of Object.entries(b)) {
    if (k.startsWith('_')) continue
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v
  }
  return out
}

export const decideConfig = (cfg) => merge(DECIDE_DEFAULTS, {
  nuit: (cfg && cfg.nuit) || {}, relais: (cfg && cfg.relais) || {}, galerie: (cfg && cfg.galerie) || {}, controle: (cfg && cfg.controle) || {},
})

const rx = (src, flags = 'i') => { try { return src ? new RegExp(src, flags) : null } catch { return null } }

// ---- « Claude Control » to-dos: `- [ ] YYYY-MM-DD · prio · quoi · pourquoi · comment` (date « — » = none) ---------

const TODO_RE = /^\s*-\s*\[ \]\s*(\d{4}-\d{2}-\d{2}|—|-)\s*·\s*([^·]*?)\s*·\s*([^·]+?)\s*(?:·|$)/
const PRIO = { haute: 0, high: 0, moyenne: 1, medium: 1, basse: 2, low: 2 }

/** Open items sorted by deadline (dated first, soonest first), then priority. days_left in local days. */
export function parseTodos(text, nowMs) {
  const d = new Date(nowMs)
  const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = TODO_RE.exec(line)
    if (!m) continue
    const dated = /^\d{4}-/.test(m[1])
    const day = dated ? Date.UTC(+m[1].slice(0, 4), +m[1].slice(5, 7) - 1, +m[1].slice(8, 10)) : null
    out.push({ date: dated ? m[1] : null, days_left: dated ? Math.round((day - today) / 86400000) : null, prio: m[2].trim(), what: m[3].trim() })
  }
  const p = (x) => PRIO[x.prio.toLowerCase()] ?? 3
  return out.sort((a, b) => (a.date === null) - (b.date === null) || (a.days_left ?? 0) - (b.days_left ?? 0) || p(a) - p(b))
}

const whenText = (n) => (n < 0 ? `en retard de ${-n} j` : n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : `dans ${n} j`)

/** The home card « Claude Control »: count, the next deadline, the top items. */
export function controleCard(todos, cfg) {
  const c = decideConfig(cfg).controle
  if (!todos) return { line: 'aucun fichier ~/.claude/a-faire/claude-control.md', tone: 'dim', items: [] }
  if (!todos.length) return { line: 'rien à faire pour Claude Control', tone: 'ok', items: [] }
  const next = todos.find((t) => t.date)
  const line = `${todos.length} à faire${next ? ` · prochaine échéance ${next.date.slice(8, 10)}/${next.date.slice(5, 7)} (${whenText(next.days_left)})` : ' · aucune échéance datée'}`
  const tone = next && next.days_left <= c.bad_days ? 'bad' : next && next.days_left <= c.warn_days ? 'warn' : null
  const items = todos.slice(0, c.max).map((t) => ({ text: `${t.date ? `${t.date.slice(8, 10)}/${t.date.slice(5, 7)} · ` : ''}${clip(t.what, 70)}${t.prio ? ` (${t.prio})` : ''}` }))
  return { line, tone, items, more: Math.max(0, todos.length - c.max), count: todos.length }
}

// ---- Nuit: « Bilan avant la nuit » ----------------------------------------------------------------------------------

/** Next wake time (epoch ms) after nowMs for « HH:MM » (local). */
export function nextWake(wake, nowMs) {
  const [h, m] = String(wake || '07:30').split(':').map((x) => Number(x) || 0)
  const d = new Date(nowMs)
  let t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime()
  if (t <= nowMs) t += 86400000
  return t
}

/**
 * Ready lanes and packets from the repos' files. repos: [{repo, path, roadmap: text|null, packets: [{file, title}]}].
 * A ROADMAP line is ready when it matches ready_match outside a skipped section (« Idées de Julian », done…).
 */
export function readyItems(repos, cfg) {
  const c = decideConfig(cfg).nuit
  const ready = rx(c.ready_match)
  const skip = rx(c.skip_sections)
  const out = []
  for (const r of repos || []) {
    const mine = []
    let skipping = false
    for (const raw of String(r.roadmap || '').split(/\r?\n/)) {
      const head = /^#{1,6}\s+(.*)$/.exec(raw)
      if (head) { skipping = Boolean(skip && skip.test(head[1])); continue }
      if (skipping || !ready || !ready.test(raw)) continue
      const text = raw.replace(/^\s*[-*]\s*(\[ \]\s*)?/, '').replace(/\*\*/g, '').trim()
      if (text) mine.push({ repo: r.repo, path: r.path, source: 'handoff/ROADMAP.md', kind: 'roadmap', text: clip(text, 120) })
    }
    for (const p of r.packets || []) mine.push({ repo: r.repo, path: r.path, source: p.file, kind: 'packet', text: clip(p.title || p.file, 120) })
    out.push(...mine.slice(0, c.per_repo))
  }
  return out.slice(0, c.max_ready)
}

/** The command « Lancer » shows for one ready item (never run from here). */
export function launchCommand(item, cfg) {
  const c = decideConfig(cfg).nuit
  const prompt = fill(c.launch_prompt, { source: item.source, item: item.text }).replace(/"/g, '\'')
  return fill(c.launch, { repo: item.path || item.repo, model: c.launch_model, effort: c.launch_effort, prompt })
}

/**
 * The whole screen. data = {running: [{kind, text, eta: {mid}|null}], quotas (lib/core readQuotas), ready: readyItems}.
 */
export function nuitModel(data, cfg, nowMs) {
  const c = decideConfig(cfg).nuit
  const L = c.labels
  const d = data || {}
  const wake = nextWake(c.wake, nowMs)
  const night = wake - nowMs
  const running = (d.running || []).map((x) => {
    const end = x.eta && fin(x.eta.mid) ? x.eta.mid : null
    return { ...x, end, line: x.text, left: end ? fill(L.hours_left, { left: durText(end - nowMs) }) : L.ends_unknown }
  })
  const ends = running.map((x) => x.end).filter(fin)
  const lastEnd = ends.length ? Math.min(wake, Math.max(...ends)) : nowMs
  const used = Math.max(0, lastEnd - nowMs)
  const free = Math.max(0, wake - lastEnd)
  const unknown = running.filter((x) => !x.end).length
  const nightLine = fill(L.night_line, { wake: hm(wake), total: hours(night), used: hours(used), free: hours(free) })
  // quota: Claude's week pace (lib/core/usage.mjs runOut ratePerH) over the night hours
  const q = d.quotas && d.quotas.claude
  let quota = { line: L.quota_none, burn: '', tone: 'dim' }
  if (q && (q.five || q.week)) {
    const pct = (w) => (w ? `${Math.round(w.pct)} %` : '?')
    const left = q.week ? Math.max(0, Math.round(100 - q.week.pct)) : '?'
    const rate = q.week && fin(q.week.ratePerH) ? q.week.ratePerH : null
    const burn = rate !== null ? Math.min(100, rate * (night / 3600000)) : null
    let burnText = burn !== null ? fill(L.quota_burn, { burn: Math.round(burn), rate: rate.toFixed(1).replace('.', ',') }) : L.quota_burn_unknown
    if (burn !== null && q.week && q.week.pct + burn >= 100 && q.week.runOutAt) burnText += ' · ' + fill(L.quota_out, { at: hm(q.week.runOutAt) })
    quota = { line: fill(L.quota_line, { five: pct(q.five), week: pct(q.week), left }), burn: burnText,
      tone: burn !== null && q.week && q.week.pct + burn >= 100 ? 'bad' : burn !== null && q.week && q.week.pct + burn >= 80 ? 'warn' : null }
  }
  const ready = (d.ready || []).map((r, i) => ({ ...r, i, label: `${r.repo} · ${r.kind === 'packet' ? L.source_packet : L.source_roadmap} · ${r.text}`, command: launchCommand(r, cfg) }))
  return {
    title: L.title, wake, running, night: { line: nightLine, unknown: unknown ? fill(L.night_unknown, { n: unknown, free: hours(free) }) : '', free, used, total: night },
    quota, ready, labels: L,
  }
}

// ---- Relais: Claude ↔ Codex --------------------------------------------------------------------------------------

const AGENT_NAME = { claude: 'Claude', codex: 'Codex', unknown: 'inconnu' }
const rate = (x) => (x && fin(x.rate) ? `${Math.round(x.rate)} % vert (${x.success}/${x.success + x.failed})` : '—')

/** The Claude ↔ Codex screen from interactions.json (ci mod). null data: {available: false}. */
export function relaisView(data, cfg) {
  const c = decideConfig(cfg).relais
  const L = c.labels
  if (!data || !Array.isArray(data.repos)) return { available: false, none: L.none }
  const t = data.totals || {}
  const by = t.by_agent || {}
  const agents = ['claude', 'codex'].map((a) => {
    const x = by[a] || {}
    return { agent: a, text: fill(L.agent_row, { agent: AGENT_NAME[a], opened: x.opened || 0, fixed: x.fixed || 0, merged: x.merged || 0, pr_rate: rate(x.pr_ci), run_rate: rate(x.runs) }),
      rate: x.pr_ci && fin(x.pr_ci.rate) ? x.pr_ci.rate : null }
  })
  const kinds = Object.entries(t.handoffs_by_kind || {}).map(([k, n]) => `${k} ${n}`).join(', ') || '—'
  const handoffs = fill(L.handoffs_row, { n: t.handoffs || 0, kinds, prs: t.prs_with_handoff || 0, deps: t.with_dependencies || 0 })
  const repos = data.repos.filter((r) => (r.totals && r.totals.prs) > 0)
    .sort((a, b) => b.totals.prs - a.totals.prs).slice(0, c.max_repos)
    .map((r) => {
      const ba = r.totals.by_agent || {}
      const parts = ['claude', 'codex'].map((a) => (ba[a] && ba[a].opened ? `${AGENT_NAME[a]} ${ba[a].opened} PR${ba[a].pr_ci && fin(ba[a].pr_ci.rate) ? ` (${Math.round(ba[a].pr_ci.rate)} % vert)` : ''}` : null)).filter(Boolean)
      if (r.totals.prs_with_handoff) parts.push(`${r.totals.prs_with_handoff} relais`)
      return { repo: r.name, text: fill(L.repo_row, { repo: r.name, parts: parts.join(' · ') || `${r.totals.prs} PR` }) }
    })
  const prs = data.repos.flatMap((r) => (r.prs || []).map((p) => ({ ...p, repo: r.name })))
    .filter((p) => p.state === 'open' || (p.handoffs && p.handoffs.length) || (p.depends_on && p.depends_on.length))
    .sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))).slice(0, c.max_prs)
    .map((p) => ({ url: p.url, number: p.number, tone: p.ci === 'failed' ? 'bad' : p.ci === 'success' ? 'ok' : null,
      text: fill(L.pr_row, { number: p.number, repo: p.repo, who: [AGENT_NAME[p.opened_by] || p.opened_by, ...(p.fixed_by || []).filter((x) => x !== p.opened_by).map((x) => `+${AGENT_NAME[x] || x}`)].join(' '),
        ci: p.ci || '?', handoff: p.handoffs && p.handoffs.length ? ` · relais ${p.handoffs.join(', ')}` : '', deps: p.depends_on && p.depends_on.length ? ` · dépend de ${p.depends_on.map((n) => '#' + n).join(', ')}` : '' }) }))
  return {
    available: true, head: fill(L.generated, { time: data.generated ? hm(Date.parse(data.generated)) : '?', days: data.days || '?', prs: t.prs || 0 }),
    agents, handoffs, repos, prs, errors: (data.errors || []).length ? fill(L.errors, { n: data.errors.length }) : '', labels: L,
  }
}

// ---- Galerie: Équipe (agent tree by role) -------------------------------------------------------------------------

/** The lane of an agent type (roles in config; case-insensitive), else « other ». */
export function roleOf(type, cfg) {
  const roles = decideConfig(cfg).galerie.roles
  const t = String(type || '').toLowerCase()
  for (const [lane, types] of Object.entries(roles)) if ((types || []).some((x) => t === String(x).toLowerCase())) return lane
  return 'other'
}

const msOf = (v) => (!v ? 0 : typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(v) || 0)

/**
 * The selected conversation as a team: the lead, then one lane per role with its agents and whether each returned to
 * the lead (done: its last line time). session: factory's scan row (subs, advisor, model, effort); title: its title.
 */
export function teamView(session, title, cfg, nowMs) {
  const g = decideConfig(cfg).galerie
  const L = g.labels
  if (!session) return { available: false, none: L.no_conv }
  const lanes = {}
  for (const k of [...Object.keys(g.roles), 'other']) lanes[k] = []
  for (const x of session.subs || []) {
    const lane = roleOf(x.type, cfg)
    const st = x.status
    const state = st === 'done' ? fill(L.returned, { time: x.last_ts ? hm(msOf(x.last_ts)) : '?' })
      : st === 'running' ? fill(L.running, { dur: durText(nowMs - (msOf(x.ts) || nowMs)) }) : st === 'failed' ? L.failed : L.stopped
    lanes[lane].push({ id: x.id, text: `${x.type}${x.desc ? ' · ' + clip(x.desc, 50) : ''}${x.workflow ? ' (workflow)' : ''}`, model: x.model || '', state, status: st,
      tone: st === 'running' ? 'running' : st === 'failed' ? 'bad' : st === 'done' ? 'ok' : 'dim' })
  }
  const adv = Number(session.advisor) || 0
  const out = Object.entries(lanes).filter(([k, v]) => v.length || (k === 'advisor' && adv) || k !== 'other')
    .map(([k, v]) => ({ id: k, title: `${L.lanes[k] || k} (${v.length})`, agents: v,
      note: k === 'advisor' && adv ? fill(L.advisor_calls, { n: adv, at: session.advisor_ts ? ` · dernier ${hm(msOf(session.advisor_ts))}` : '' }) : '' }))
  return { available: true, lead: fill(L.lead, { title: clip(title || session.cli, 40), model: session.app_model || session.model || '?', effort: session.app_effort || session.effort || '?' }), lanes: out }
}

// ---- Galerie: Carte du contrôle --------------------------------------------------------------------------------------

/** map = scanner's {rules: {title}, settings: {env, hooks}, agents: [names], skills: [names], workflows: [names], mods: n, memory: n}. */
// identity: what $.session.identity() answered (engine 2.1.299+; a mod outside managed settings gets { deny }): its
// `kind` (claude.ai, console, api-key…) as one more row, only when known.
export function controlMap(map, cfg, identity) {
  const L = decideConfig(cfg).galerie.labels
  const R = L.map_rows
  const id = identity && typeof identity.kind === 'string' && identity.kind ? [{ id: 'identity', label: L.identity, text: identity.kind }] : []
  if (!map) return [{ id: 'none', label: L.map, text: L.map_none }, ...id]
  const list = (xs) => (Array.isArray(xs) ? `${xs.length}${xs.length ? ' · ' + clip(xs.join(', '), 60) : ''}` : L.map_none)
  return [
    { id: 'rules', label: R.rules, text: map.rules ? clip(map.rules.title || 'CLAUDE.md', 60) : L.map_none },
    { id: 'settings', label: R.settings, text: map.settings ? `env ${map.settings.env} · hooks ${map.settings.hooks}${map.settings.mode ? ' · ' + map.settings.mode : ''}` : L.map_none },
    { id: 'agents', label: R.agents, text: list(map.agents) },
    { id: 'skills', label: R.skills, text: list(map.skills) },
    { id: 'workflows', label: R.workflows, text: list(map.workflows) },
    { id: 'mods', label: R.mods, text: fin(map.mods) ? String(map.mods) : L.map_none },
    { id: 'memory', label: R.memory, text: fin(map.memory) ? `${map.memory} fichier(s)` : L.map_none },
    ...id,
  ]
}

// ---- Galerie: Codex approvals and cost -----------------------------------------------------------------------------

const tok = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1).replace('.', ',')} G` : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1e3 ? `${Math.round(n / 1e3)} K` : String(Math.round(n || 0)))
const usd = (x) => (x >= 100 ? `${Math.round(x)} $` : `${x.toFixed(2).replace('.', ',')} $`)

/** Price of one Codex model per million tokens: the longest matching prefix in codex_prices (dots and dashes alike). */
export function codexPrice(model, cfg) {
  const prices = decideConfig(cfg).galerie.codex_prices || {}
  const m = String(model || '').toLowerCase().replace(/\./g, '-')
  const key = Object.keys(prices).filter((k) => m.startsWith(k.toLowerCase().replace(/\./g, '-'))).sort((a, b) => b.length - a.length)[0]
  return key ? prices[key] : null
}

/**
 * codex = {byModel: {model: [input, cached, output, reasoning, total]}, days, approvals: {policies: {never: n}, requests,
 * sessions}} from the scanner (usage's codex.json + rollouts). Cost = (input − cached) × in + output × out, API equivalent.
 */
export function codexPanel(codex, cfg) {
  const g = decideConfig(cfg).galerie
  const L = g.labels
  if (!codex || !codex.available) return { available: false, none: L.codex_none }
  let all = 0
  let cost = 0
  let priced = true
  const rows = Object.entries(codex.byModel || {}).sort((a, b) => (b[1][4] || 0) - (a[1][4] || 0)).map(([model, v]) => {
    const p = codexPrice(model, cfg)
    const c = p ? (((v[0] || 0) - (v[1] || 0)) * p.in + (v[2] || 0) * p.out) / 1e6 : null
    all += v[4] || 0
    if (c === null) priced = false
    else cost += c
    return { model, text: fill(L.codex_row, { model, tokens: tok(v[4] || 0), cost: c === null ? L.price_unknown : usd(c) }) }
  })
  const a = codex.approvals || {}
  const pol = Object.entries(a.policies || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '—'
  return {
    available: true, rows,
    total: fill(L.codex_total, { days: codex.days || g.codex_days, tokens: tok(all), cost: rows.length ? (priced ? usd(cost) : `${usd(cost)} + ${L.price_unknown}`) : '—' }),
    policy: fill(L.codex_policy, { list: pol }),
    requests: fill(L.codex_requests, { n: a.requests || 0, sessions: a.sessions || 0, days: codex.days || g.codex_days }),
    tone: a.requests ? 'warn' : null,
  }
}

// ---- Galerie: Lanes (Agent-teams: one lane per worktree, with its reviewer / adversary) -----------------------------

/** The worktree folder of a working directory: <repo>/.claude/worktrees/<x> gives x; anything else is the main checkout. */
export function worktreeOf(cwd) {
  const m = /\/\.claude\/worktrees\/([^/]+)/.exec(String(cwd || '').replace(/\\/g, '/'))
  return m ? m[1] : null
}

const subState = (x, L) => (x.status === 'done' ? `✓ ${x.last_ts ? hm(msOf(x.last_ts)) : ''}`.trim() : x.status === 'running' ? '◐' : x.status === 'failed' ? L.failed : L.stopped)

/**
 * rows: the project's conversations [{cli, title, cwd, branch, pr: {number, state, ci}|null, state, live, last (ms), subs}].
 * One lane per worktree (the main checkout is one lane), the active ones first; each lane its conversations, its PR,
 * and its reviewer agents (role « reviewer ») with how they ended, or that none was launched.
 */
export function lanesView(rows, repo, cfg, nowMs) {
  const g = decideConfig(cfg).galerie
  const L = g.labels
  if (!repo) return { available: false, none: L.wt_no_repo }
  const since = nowMs - g.lanes_days * 86400000
  const revRx = rx(g.lane_reviewer_match)
  const by = new Map()
  for (const r of rows || []) {
    if (!r || (r.last && r.last < since && !r.live)) continue
    const key = worktreeOf(r.cwd) || ''
    if (!by.has(key)) by.set(key, { folder: key, convs: [], last: 0, live: false, branch: '', pr: null })
    const lane = by.get(key)
    lane.convs.push(r)
    lane.last = Math.max(lane.last, r.last || 0)
    lane.live = lane.live || Boolean(r.live)
    if (!lane.branch && r.branch) lane.branch = r.branch
    if (!lane.pr && r.pr && r.pr.number) lane.pr = r.pr
  }
  const lanes = [...by.values()].sort((a, b) => (b.live - a.live) || (b.last - a.last))
  const shown = lanes.slice(0, g.lanes_max).map((lane) => {
    const subs = lane.convs.flatMap((c) => c.subs || [])
    const reviewers = subs.filter((x) => roleOf(x.type, cfg) === 'reviewer')
    const isReviewer = lane.convs.some((c) => revRx && revRx.test(String(c.title || '')))
    const tone = lane.pr && lane.pr.ci === 'failed' ? 'bad' : lane.live ? 'running' : lane.pr && lane.pr.ci === 'success' ? 'ok' : null
    return {
      id: lane.folder || 'main', tone, live: lane.live, isReviewer,
      title: fill(L.wt_lane, { folder: lane.folder || L.wt_main, branch: lane.branch ? ` · ${lane.branch}` : '' }),
      convs: lane.convs.map((c) => fill(L.wt_conv, { title: clip(c.title || c.cli, 40), state: c.state || '?', agents: (c.subs || []).length ? ` · ${(c.subs || []).length} agent(s)` : '' })),
      pr: lane.pr ? fill(L.wt_pr, { number: lane.pr.number, state: lane.pr.state || '?', ci: lane.pr.ci || '?' }) : '',
      reviewers: reviewers.length ? fill(L.wt_reviewers, { list: reviewers.map((x) => `${x.type} ${subState(x, L)}`).join(', ') }) : isReviewer ? L.wt_is_reviewer : L.wt_no_reviewer,
      reviewerTone: reviewers.some((x) => x.status === 'failed') ? 'bad' : reviewers.length || isReviewer ? 'ok' : 'warn',
    }
  })
  return {
    available: true, title: fill(L.wt_title, { repo, days: g.lanes_days }), lanes: shown,
    none: shown.length ? '' : fill(L.wt_none, { days: g.lanes_days }), more: lanes.length > shown.length ? fill(L.wt_more, { n: lanes.length - shown.length }) : '',
  }
}

// ---- Galerie: Séquence (one conversation as a sequence diagram) -----------------------------------------------------

/**
 * The selected conversation as a text sequence diagram: a lifeline for the lead and each agent (the seq_agents most
 * recent), one arrow per call (lead → agent) and per return (agent ↩ lead), oldest first, the seq_events latest.
 * width: the columns the diagram may use. Returns {available, title, header, rows: [{line, text, tone}], hidden, older}.
 */
export function sequenceView(session, title, cfg, nowMs, width) {
  const g = decideConfig(cfg).galerie
  const L = g.labels
  if (!session) return { available: false, none: L.no_conv }
  const all = (session.subs || []).filter((x) => msOf(x.ts)).sort((a, b) => msOf(a.ts) - msOf(b.ts))
  if (!all.length && !session.advisor_ts) return { available: false, none: L.seq_none, title: fill(L.seq_title, { title: clip(title || session.cli, 40) }) }
  const agents = all.slice(-Math.max(1, g.seq_agents))
  const P = agents.length + 1
  const lead = 6
  const cell = Math.max(4, Math.min(18, Math.floor((Math.max(24, width || 60) - lead) / P)))
  const center = (k) => lead + k * cell + Math.floor(cell / 2)
  const span = agents.map((x) => ({ from: msOf(x.ts), to: x.status === 'running' ? nowMs : msOf(x.last_ts) || msOf(x.ts) }))
  const events = []
  agents.forEach((x, i) => {
    events.push({ at: msOf(x.ts), k: i + 1, kind: 'call', text: fill(L.seq_call, { type: x.type, desc: clip(x.desc || x.prompt || '', 40) }).replace(/ · $/, ''), tone: null })
    if (x.status === 'done' || x.status === 'failed') {
      events.push({ at: msOf(x.last_ts) || msOf(x.ts), k: i + 1, kind: 'return', text: fill(x.status === 'done' ? L.seq_done : L.seq_failed, { type: x.type }), tone: x.status === 'done' ? 'ok' : 'bad' })
    }
  })
  if (session.advisor_ts) events.push({ at: msOf(session.advisor_ts), k: 0, kind: 'self', text: L.seq_advisor, tone: 'dim' })
  events.sort((a, b) => a.at - b.at || (a.kind === 'return') - (b.kind === 'return'))
  const kept = events.slice(-Math.max(1, g.seq_events))
  const blank = () => Array(lead + P * cell).fill(' ')
  const header = blank()
  ;[L.seq_lead, ...agents.map((x) => x.type)].forEach((name, k) => {
    const n = clip(name, cell - 1)
    const start = Math.max(lead + k * cell, Math.min(center(k) - Math.floor(n.length / 2), lead + (k + 1) * cell - n.length))
    for (let i = 0; i < n.length; i++) header[start + i] = n[i]
  })
  const rows = kept.map((e) => {
    const a = blank()
    const t = hm(e.at)
    for (let i = 0; i < t.length; i++) a[i] = t[i]
    a[center(0)] = '│'
    agents.forEach((_, i) => { const s = span[i]; if (e.at >= s.from && e.at <= s.to) a[center(i + 1)] = '│' })
    if (e.kind === 'self') a[center(0)] = '◆'
    else {
      const from = center(0)
      const to = center(e.k)
      for (let i = from + 1; i < to; i++) a[i] = '─'
      if (e.kind === 'call') { a[from] = '├'; a[to - 1] = '▶'; a[to] = '┐' } else { a[from] = '├'; a[from + 1] = '◀'; a[to] = '┘' }
    }
    return { line: a.join('').replace(/\s+$/, ''), text: `${' '.repeat(lead)}${e.text}`, tone: e.tone }
  })
  return {
    available: true, title: fill(L.seq_title, { title: clip(title || session.cli, 40) }), header: header.join('').replace(/\s+$/, ''), rows,
    hidden: all.length > agents.length ? fill(L.seq_hidden, { n: all.length - agents.length }) : '',
    older: events.length > kept.length ? fill(L.seq_older, { n: events.length - kept.length }) : '',
  }
}

// ---- Galerie: Doux / dur (the soft-control concept map) -------------------------------------------------------------

/** One layer's figure from the Carte's map (names and counts only). */
function layerValue(map, from, L) {
  if (!map) return L.map_none
  const list = (xs) => (Array.isArray(xs) ? String(xs.length) : L.map_none)
  switch (from) {
    case 'rules': return map.rules ? clip(map.rules.title || 'CLAUDE.md', 40) : L.map_none
    case 'memory': return fin(map.memory) ? `${map.memory} fichier(s)` : L.map_none
    case 'skills': case 'agents': case 'workflows': return list(map[from])
    case 'mods': return fin(map.mods) ? String(map.mods) : L.map_none
    case 'mode': return map.settings ? map.settings.mode || L.concept_default : L.map_none
    case 'hooks': return map.settings ? String(map.settings.hooks) : L.map_none
    case 'env': return map.settings ? `${map.settings.env} clé(s)` : L.map_none
    default: return L.map_none
  }
}

/** The concept map: the soft layers (the model reads them), the hard ones (the harness enforces them), with our counts. */
export function conceptMap(map, cfg) {
  const g = decideConfig(cfg).galerie
  const L = g.labels
  const side = (list) => (list || []).map((x, i) => ({ id: `${x.from}-${i}`, label: x.label, text: layerValue(map, x.from, L) }))
  return { title: L.concept_title, soft: { title: L.concept_soft, rows: side(g.concept.soft) }, hard: { title: L.concept_hard, rows: side(g.concept.hard) }, flow: L.concept_flow, note: L.concept_note }
}

export { hm, clip, fill, durText }
