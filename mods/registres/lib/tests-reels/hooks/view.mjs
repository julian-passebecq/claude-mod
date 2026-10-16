// tests-reels mod - the « Tests réels » pane's drawing, pure: no `$`. `el` is the element table from $.ui.resolve(e),
// `M` the facts the hook read, `act` the callbacks it hands in. register.tsx draws /tests with it, and the registres
// mod draws its « Tests réels » tab with a byte-for-byte copy (lib/core/targets.json): change it here only.
// Secrets: logins are masked unless revealed one by one; secret values are never in the view (only where they live).
import { appSummary, fill, fmtAge, mask, resultOf, shortId, todoLine } from '../lib/registry.mjs'

/** h-like factory over the element table: mk(el)('Text', { dimColor: true }, 'x'). */
export const mk = (el) => (type, props, ...kids) =>
  el[type]({ ...(props || {}), children: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) })

/**
 * M = { cfg, view, now, openList, reveal, status, busy, error }; act = { toggle(id), reveal(key), reload(), recover() }.
 * Returns the pane's tree.
 */
export function drawTestsReels(el, M, act) {
  const h = mk(el)
  const { cfg, view, now, openList, reveal, status } = M
  const L = cfg.labels ?? {}
  const C = cfg.colors ?? {}
  const max = cfg.max_rows ?? 12
  const isOpen = (id) => openList.includes(id)
  const k = (s) => s.replace(/[^A-Za-z0-9_-]/g, '_')
  const col = (r) => (C[r] ? { color: C[r] } : {})
  const resLabel = (r) => L[`result_${r}`] ?? r
  const more = (n) => (n > max ? h('Text', { dimColor: true }, fill(L.more, { n: n - max })) : null)
  const t = view.totals
  const head = h('Box', { flexDirection: 'column' },
    h('Text', { dimColor: true }, fill(L.subtitle, { apps: t.apps, reg: view.registryAt ? fmtAge(view.registryAt, now) : L.never_scanned, rec: view.recoveredAt ? fmtAge(view.recoveredAt, now) : L.never_scanned })),
    h('Text', {}, fill(L.totals, t)),
    h('Box', { flexDirection: 'row', gap: 1, flexWrap: 'wrap' },
      h('Button', { key: 'refresh', plain: true, onPress: () => act.reload() }, L.refresh ?? '↻'),
      h('Button', { key: 'recover', plain: true, onPress: () => act.recover() }, L.recover)),
    M.busy ? h('Text', { dimColor: true }, L.recovering) : null,
    M.error ? h('Text', { color: 'error' }, `récupération : ${M.error}`) : null,
    cfg._local_error ? h('Text', { color: 'error' }, cfg._local_error) : null,
    status ? h('Text', { dimColor: true }, status) : null)
  if (!view.apps.length && !view.todo.length) {
    return h('Box', { flexDirection: 'column', gap: 1 }, head, h('Text', {}, L.empty))
  }

  const fold = (id, title, summary, body, warn = false) => h('Box', { key: `b-${k(id)}`, flexDirection: 'column' },
    h('Box', { flexDirection: 'row', gap: 1, flexWrap: 'wrap' },
      h('Button', { key: `t-${k(id)}`, plain: true, onPress: () => act.toggle(id) }, `${isOpen(id) ? '▾' : '▸'} ${title}`),
      h('Text', { ...(warn ? col('warn') : { dimColor: true }), wrap: 'truncate' }, summary)),
    isOpen(id) ? h('Box', { flexDirection: 'column', paddingLeft: 2 }, body()) : null)
  const part = (title, rows, line) => h('Box', { flexDirection: 'column' },
    h('Text', { bold: true }, `${title} (${rows.length})`),
    !rows.length ? h('Text', { dimColor: true }, `  ${L.none}`) : null,
    rows.slice(0, max).map(line),
    more(rows.length))

  const todoBlock = fold(
    'todo',
    L.todo_title,
    view.todo.length ? fill(L.todo_summary, { n: view.todo.length, secrets: t.secrets_seen }) : L.todo_none,
    () => h('Box', { flexDirection: 'column' },
      view.todo.slice(0, max).map((x, i) => h('Text', { key: `td-${i}`, ...col('todo') }, `● ${todoLine(x, L)}`)),
      more(view.todo.length),
      view.todo.length ? h('Text', { dimColor: true, wrap: 'wrap' }, cfg.store_instruction) : null),
    view.todo.length > 0,
  )

  const appBlock = (a) => {
    const id = `app:${a.name}`
    return fold(id, a.name, appSummary(a, L), () => {
      const rec = a.recovered
      return h('Box', { flexDirection: 'column', gap: 1 },
        a.notes ? h('Text', { dimColor: true }, a.notes) : null,
        a.neverReal ? h('Text', col('warn'), `⚠ ${L.never_real}`) : null,
        part(L.envs, a.environments, (e, i) => h('Box', { key: `e-${i}`, flexDirection: 'column', paddingLeft: 1 },
          h('Text', {}, `● ${e.name}${e.kind ? ` · ${L[`kind_${e.kind}`] ?? e.kind}` : ''}${e.status ? ` · ${e.status}` : ''}${e.owner ? ` · ${e.owner}` : ''}${e.created ? ` · ${e.created}` : ''}`),
          (e.urls ?? []).map((u, j) => h('Text', { key: `eu-${i}-${j}`, dimColor: true }, `  ${u}`)),
          Object.keys(e.ids ?? {}).length ? h('Text', { dimColor: true }, `  ${Object.entries(e.ids).map(([kk, v]) => `${kk} ${shortId(v)}`).join(' · ')}`) : null)),
        part(L.accounts, a.accounts, (ac, i) => {
          const rk = `${a.name}|${ac.login || ac.display}`
          const shown = reveal.includes(rk)
          return h('Box', { key: `a-${i}`, flexDirection: 'column', paddingLeft: 1 },
            h('Box', { flexDirection: 'row', gap: 1 },
              h('Text', {}, `● ${shown ? ac.login || ac.display : mask(ac.login || ac.display)}${ac.env ? ` · ${ac.env}` : ''}${ac.purpose ? ` · ${ac.purpose}` : ''}`),
              h('Button', { key: `rv-${k(rk)}`, plain: true, onPress: () => act.reveal(rk) }, shown ? L.hide : L.show)),
            ac.secret_ref?.target
              ? h('Text', { dimColor: true }, `  ${fill(L.secret_at, { store: cfg.secret_stores?.[ac.secret_ref.store] ?? ac.secret_ref.store, target: ac.secret_ref.target })}`)
              : h('Text', col('todo'), `  ${L.secret_none}`))
        }),
        part(L.procedures, a.procedures, (p, i) => h('Box', { key: `p-${i}`, flexDirection: 'column', paddingLeft: 1 },
          h('Text', col(p.status), `● ${p.name}${p.env ? ` · ${p.env}` : ''}${p.kind ? ` · ${p.kind}` : ''} · ${resLabel(p.status)}${p.last?.date ? ` ${String(p.last.date).slice(0, 10)}` : ''}${p.undeclared ? ` · ${L.undeclared}` : ''}`),
          p.steps?.length ? h('Text', { dimColor: true, wrap: 'wrap' }, `  ${fill(L.steps, { n: p.steps.length })} : ${p.steps.join(' → ')}`) : null,
          (p.commands ?? []).map((c, j) => h('Text', { key: `pc-${i}-${j}`, dimColor: true, wrap: 'wrap' }, `  $ ${c}`)),
          p.expected ? h('Text', { dimColor: true, wrap: 'wrap' }, `  ${fill(L.expected, { text: p.expected })}`) : null,
          p.evidence?.length ? h('Text', { dimColor: true, wrap: 'wrap' }, `  ${fill(L.evidence, { list: p.evidence.join(', ') })}`) : null)),
        part(L.runs, a.runs, (r, i) => h('Box', { key: `r-${i}`, flexDirection: 'column', paddingLeft: 1 },
          h('Text', col(resultOf(r)), `● ${String(r.date).slice(0, 16).replace('T', ' ')} · ${r.procedure}${r.env ? ` · ${r.env}` : ''} · ${resLabel(resultOf(r))}${r.by ? ` · ${r.by}` : ''}`),
          r.note ? h('Text', { dimColor: true, wrap: 'wrap' }, `  ${r.note}`) : null,
          r.evidence?.length ? h('Text', { dimColor: true, wrap: 'wrap' }, `  ${fill(L.evidence, { list: r.evidence.join(', ') })}`) : null)),
        part(L.checks, a.checks, (c, i) => h('Box', { key: `c-${i}`, flexDirection: 'column', paddingLeft: 1 },
          h('Text', {}, `● ${c.date ?? ''} · ${c.what}${c.status ? ` · ${c.status}` : ''}`),
          c.how ? h('Text', { dimColor: true, wrap: 'wrap' }, `  ${c.how}`) : null)),
        rec
          ? fold(`${id}:rec`, L.recovered, fill(L.sum_recovered, { s: (rec.sessions ?? []).length, c: (rec.commands ?? []).length }), () => h('Box', { flexDirection: 'column', gap: 1 },
            part(L.rec_sessions, rec.sessions ?? [], (s, i) => h('Text', { key: `rs-${i}`, dimColor: true }, `● ${String(s.date).slice(0, 10)} · ${s.title} · ${(s.cats ?? []).join(', ')} · ${s.hits}`)),
            part(L.rec_commands, a.recCommands ?? [], (c, i) => h('Text', { key: `rc-${i}`, ...(c.errors ? col('fail') : { dimColor: true }), wrap: 'wrap' }, `● ${String(c.date).slice(0, 10)} · ${c.count}×${c.errors ? ` · ${fill(L.errors, { n: c.errors })}` : ''} · ${c.cmd}`)),
            part(L.rec_ids, rec.ids ?? [], (x, i) => h('Text', { key: `ri-${i}`, dimColor: true }, `● ${x.kind} ${shortId(x.value)} · ${x.count}×`)),
            part(L.rec_urls, rec.urls ?? [], (x, i) => h('Text', { key: `ru-${i}`, dimColor: true, wrap: 'wrap' }, `● ${x.url} · ${x.count}×`)),
            part(L.rec_accounts, rec.accounts ?? [], (x, i) => h('Text', { key: `ra-${i}`, dimColor: true }, `● ${mask(x.login)} · ${x.count}×`)),
            part(L.rec_workspaces, rec.workspaces ?? [], (x, i) => h('Text', { key: `rw-${i}`, dimColor: true }, `● ${x.name} · ${x.count}×`)),
            part(L.rec_mentions, rec.mentions ?? [], (x, i) => h('Text', { key: `rm-${i}`, dimColor: true, wrap: 'wrap' }, `● ${String(x.date).slice(0, 10)} · ${x.title ?? ''} : ${x.text}`))))
          : null)
    }, a.neverReal)
  }

  return h('Box', { flexDirection: 'column', gap: 1 },
    head,
    todoBlock,
    h('Box', { flexDirection: 'column' },
      h('Text', { bold: true }, `${L.apps_title} (${view.apps.length})`),
      view.apps.slice(0, cfg.max_apps ?? 60).map(appBlock),
      view.apps.length > (cfg.max_apps ?? 60) ? h('Text', { dimColor: true }, fill(L.more, { n: view.apps.length - (cfg.max_apps ?? 60) })) : null),
    h('Box', { flexDirection: 'column' },
      (L.notes ?? []).map((x, i) => h('Text', { key: `n-${i}`, dimColor: true, wrap: 'wrap' }, `· ${x}`))))
}
