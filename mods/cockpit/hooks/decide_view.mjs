// cockpit - draws the decision screens (Nuit, Claude ↔ Codex, Galerie) from the pure models of lib/decide.mjs.
// h = view.mjs's kit (T, row, col, box, btn, lr). Pure except for the callbacks in V.act. Nothing here starts a lane:
// « Lancer » only shows the command; « Nuit active » and « Jour » run /veille nuit and /veille jour (buttons Julian
// clicks), « Rien » goes back to the Cockpit tab.
import { nuitModel, relaisView, teamView, controlMap, codexPanel, decideConfig, lanesView, sequenceView, conceptMap } from '../lib/decide.mjs'

// ---- Nuit: « Bilan avant la nuit » ----------------------------------------------------------------------------------

export function drawNuit(h, V) {
  const m = nuitModel(V.nuitData || {}, V.cfg, V.now)
  const L = m.labels
  const out = [h.T(m.title, { bold: true, key: 'n-title' })]
  // 1. what runs, with its end time and the hours left
  out.push(h.box(`${L.running} (${m.running.length})`, m.running.length
    ? m.running.map((x, i) => h.col([h.T(`● ${x.line}`, { tone: 'running', wrap: 'wrap' }), h.T(x.left, { dim: true })], { key: 'n-run-' + i }))
    : [h.T(L.running_none, { dim: true })], { key: 'n-running' }))
  // 2. the night
  out.push(h.box(L.night, [h.T(m.night.line, { key: 'n-night' }), m.night.unknown ? h.T(m.night.unknown, { tone: 'warn', key: 'n-unk' }) : null], { key: 'n-nightbox' }))
  // 3. the quota
  out.push(h.box(L.quota, [h.T(m.quota.line, { key: 'n-q' }), m.quota.burn ? h.T(m.quota.burn, { tone: m.quota.tone || undefined, key: 'n-burn' }) : null], { key: 'n-quota', tone: m.quota.tone || undefined }))
  // 4. ready lanes and packets, each with « Lancer » (shows the command)
  out.push(h.box(`${L.ready} (${m.ready.length})`, m.ready.length
    ? m.ready.map((r) => h.row([h.T(r.label, { wrap: 'wrap' }), h.btn(L.launch, () => V.act.launch(r.i), V.launch === r.i, 'n-launch-' + r.i)],
      { key: 'n-ready-' + r.i, justifyContent: 'space-between', alignItems: 'center' }))
    : [h.T(V.nuitBusy ? '…' : L.ready_none, { dim: true })], { key: 'n-ready' }))
  const pick = m.ready.find((r) => r.i === V.launch)
  if (pick) out.push(h.box(L.launch_title, [h.T(pick.command, { bold: true, key: 'n-cmd' }), h.T(L.launch_hint, { dim: true, key: 'n-hint' })], { key: 'n-launchbox', tone: 'running' }))
  if (V.nuitMsg) out.push(h.T(V.nuitMsg, { dim: true, key: 'n-msg' }))
  // 5. the decision
  out.push(h.T(L.choose, { bold: true, key: 'n-choose' }))
  out.push(h.row([
    h.btn(L.night_active, () => V.act.nightOn(), true, 'n-on'),
    h.btn(L.nothing, () => V.act.nothing(), false, 'n-nothing'),
    h.btn(L.day, () => V.act.day(), false, 'n-day'),
  ], { key: 'n-actions' }))
  return out
}

// ---- Claude ↔ Codex ---------------------------------------------------------------------------------------------------

export function drawRelais(h, V) {
  const r = relaisView(V.relaisData, V.cfg)
  if (!r.available) return [h.T(V.relaisBusy ? '…' : r.none, { dim: true, key: 'r-none' })]
  const L = r.labels
  return [
    h.T(L.title, { bold: true, key: 'r-title' }),
    h.T(r.head, { dim: true, key: 'r-head' }),
    h.box(L.agents, r.agents.map((a) => h.T(a.text, { key: 'r-a-' + a.agent, tone: a.rate !== null && a.rate < 70 ? 'warn' : undefined })), { key: 'r-agents' }),
    h.box(L.handoffs, [h.T(r.handoffs, { key: 'r-h' })], { key: 'r-handoffs' }),
    h.box(L.repos, r.repos.length ? r.repos.map((x, i) => h.T(x.text, { key: 'r-repo-' + i, wrap: 'truncate-end' })) : [h.T('—', { dim: true })], { key: 'r-repos' }),
    h.box(L.prs, r.prs.length ? r.prs.map((p, i) => h.T(p.text, { key: 'r-pr-' + i, tone: p.tone || undefined, wrap: 'truncate-end' })) : [h.T('—', { dim: true })], { key: 'r-prs' }),
    r.errors ? h.T(r.errors, { dim: true, key: 'r-err' }) : null,
  ].filter(Boolean)
}

// ---- Galerie: Équipe · Lanes · Séquence · Carte · Doux / dur · Codex ----------------------------------------------------------------------------------

export function drawGalerie(h, V) {
  const g = decideConfig(V.cfg).galerie
  const L = g.labels
  const views = (g.views || []).filter((x) => L.views[x])
  const cur = views.includes(V.galView) ? V.galView : views[0]
  const out = [h.row(views.map((x) => h.btn(L.views[x], () => V.act.galView(x), x === cur, 'g-v-' + x)), { key: 'g-views', marginBottom: 1 })]
  const data = V.galerieData || {}
  if (cur === 'equipe') {
    const t = teamView(V.teamSession, V.teamTitle, V.cfg, V.now)
    if (!t.available) return [...out, h.T(t.none, { dim: true, key: 'g-none' })]
    out.push(h.T(t.lead, { bold: true, key: 'g-lead' }))
    for (const lane of t.lanes) {
      out.push(h.col([
        h.T(`├ ${lane.title}`, { bold: true }),
        lane.note ? h.T(`│   ${lane.note}`, { dim: true }) : null,
        ...(lane.agents.length ? lane.agents.map((a, i) => h.col([
          h.T(`│   ● ${a.text}`, { tone: a.tone, wrap: 'truncate-end' }),
          h.T(`│     ${a.model ? a.model.replace(/^claude-/, '') + ' · ' : ''}${a.state}`, { dim: true, wrap: 'truncate-end' }),
        ], { key: `g-${lane.id}-${i}` })) : [h.T(`│   ${L.lane_empty}`, { dim: true })]),
      ], { key: 'g-lane-' + lane.id }))
    }
    return out
  }
  if (cur === 'lanes') {
    const w = lanesView(V.laneRows, V.laneRepo, V.cfg, V.now)
    if (!w.available) return [...out, h.T(w.none, { dim: true, key: 'g-wt-none' })]
    out.push(h.T(w.title, { bold: true, key: 'g-wt-title', wrap: 'wrap' }))
    if (w.none) out.push(h.T(w.none, { dim: true, key: 'g-wt-empty' }))
    for (const lane of w.lanes) {
      out.push(h.box(`${lane.live ? '● ' : ''}${lane.title}`, [
        ...lane.convs.map((c, i) => h.T(c, { key: 'c' + i, wrap: 'truncate-end' })),
        lane.pr ? h.T(lane.pr, { dim: true, key: 'pr', wrap: 'truncate-end' }) : null,
        h.T(lane.reviewers, { tone: lane.reviewerTone, key: 'rev', wrap: 'wrap' }),
      ], { key: 'g-wt-' + lane.id, tone: lane.tone || undefined }))
    }
    if (w.more) out.push(h.T(w.more, { dim: true, key: 'g-wt-more' }))
    return out
  }
  if (cur === 'sequence') {
    const s = sequenceView(V.teamSession, V.teamTitle, V.cfg, V.now, Math.max(30, (V.columns || 60) - 2))
    if (!s.available) return [...out, ...(s.title ? [h.T(s.title, { bold: true, key: 'g-sq-title' })] : []), h.T(s.none, { dim: true, key: 'g-sq-none' })]
    out.push(h.T(s.title, { bold: true, key: 'g-sq-title', wrap: 'truncate-end' }))
    if (s.hidden) out.push(h.T(s.hidden, { dim: true, key: 'g-sq-hidden' }))
    if (s.older) out.push(h.T(s.older, { dim: true, key: 'g-sq-older' }))
    out.push(h.T(s.header, { bold: true, key: 'g-sq-head', wrap: 'truncate-end' }))
    s.rows.forEach((r, i) => {
      out.push(h.T(r.line, { key: 'g-sq-l' + i, wrap: 'truncate-end' }))
      out.push(h.T(r.text, { key: 'g-sq-t' + i, dim: !r.tone, tone: r.tone && r.tone !== 'dim' ? r.tone : undefined, wrap: 'truncate-end' }))
    })
    return out
  }
  if (cur === 'carte') {
    const rows = controlMap(data.map, V.cfg, V.identity)
    out.push(h.box(L.map, rows.map((r) => h.lr(r.label, r.text, { key: 'g-m-' + r.id, bold: true })), { key: 'g-map' }))
    return out
  }
  if (cur === 'concept') {
    const c = conceptMap(data.map, V.cfg)
    out.push(h.T(c.title, { bold: true, key: 'g-cc-title' }))
    out.push(h.box(c.soft.title, c.soft.rows.map((r) => h.lr(r.label, r.text, { key: 'g-cs-' + r.id })), { key: 'g-cc-soft' }))
    out.push(h.T(`   ↓ ${c.flow}`, { dim: true, key: 'g-cc-flow', wrap: 'wrap' }))
    out.push(h.box(c.hard.title, c.hard.rows.map((r) => h.lr(r.label, r.text, { key: 'g-ch-' + r.id })), { key: 'g-cc-hard', tone: 'ok' }))
    out.push(h.T(c.note, { dim: true, key: 'g-cc-note', wrap: 'wrap' }))
    return out
  }
  const c = codexPanel(data.codex, V.cfg)
  if (!c.available) return [...out, h.T(V.galerieBusy ? '…' : c.none, { dim: true, key: 'g-cx-none' })]
  out.push(h.box(L.codex, [
    h.T(c.policy, { key: 'g-cx-pol' }),
    h.T(c.requests, { key: 'g-cx-req', tone: c.tone || undefined }),
    ...c.rows.map((r, i) => h.T(r.text, { key: 'g-cx-' + i, wrap: 'truncate-end' })),
    h.T(c.total, { bold: true, key: 'g-cx-total' }),
  ], { key: 'g-codex' }))
  return out
}
