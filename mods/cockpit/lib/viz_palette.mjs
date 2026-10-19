// cockpit - ONE palette for every diagram of the Panneau (Gantt, Sankey, progression…), pure. Models: opus orange,
// sonnet blue, haiku green, fable violet, codex grey; states: ok green, warn amber, bad red, dim grey. Mid-tone hues
// that read on the app's dark and light themes alike (an Svg is a picture: it cannot read the theme). Text fallbacks
// use `tone` (ok / warn / bad / dim / running), which the kit maps to the engine's theme tokens (success, warning,
// error, inactive, claude), so they follow the theme. Override any colour in cockpit.config.json `colors`.

export const MODEL_COLORS = { opus: '#e8833a', sonnet: '#4c8ff0', haiku: '#3fb950', fable: '#a371f7', codex: '#8b949e', other: '#8b949e' }
export const STATE_COLORS = { ok: '#3fb950', warn: '#d29922', bad: '#f85149', dim: '#8b949e', running: '#e8833a' }
/** Lines, ticks and labels: grey at half opacity reads on both themes. */
export const INK = { text: '#808890', line: '#8b949e88', grid: '#8b949e40', track: '#8b949e26', now: '#d29922' }

const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable']

/** A model id or name -> its family: opus, sonnet, haiku, fable, codex (gpt / codex / o-series), other. */
export function modelFamily(model) {
  const m = String(model || '').toLowerCase()
  const f = FAMILIES.find((x) => m.includes(x))
  if (f) return f
  if (/codex|gpt|\bo\d/.test(m)) return 'codex'
  return 'other'
}

/** The palette, with the config's `colors` laid over it (state keys and `model_<family>` keys). */
export function palette(colors = {}) {
  const c = colors || {}
  const models = Object.fromEntries(Object.entries(MODEL_COLORS).map(([k, v]) => [k, c['model_' + k] || v]))
  const states = Object.fromEntries(Object.entries(STATE_COLORS).map(([k, v]) => [k, c[k] || v]))
  return { models, states, ink: { ...INK, text: c.text || INK.text, line: c.line || INK.line, now: c.now || INK.now } }
}

/** The colour of a model (by family), from a palette() or the defaults. */
export function modelColor(model, pal) {
  const p = pal || palette()
  return p.models[modelFamily(model)] || p.models.other
}

// ---- the Sankey / curves / graph additions (PR #63) --------------------------------------------------------------

/** The engine's theme key of each model family, for a text fallback (a Text's color follows the person's theme). */
export const MODEL_TONES = { opus: 'claude', sonnet: 'suggestion', haiku: 'success', fable: 'merged', codex: 'inactive', other: 'inactive' }
export const modelTone = (model) => MODEL_TONES[modelFamily(model)] || MODEL_TONES.other
/** « opus », « sonnet »… « autre ». */
export const familyLabel = (f) => (f === 'other' ? 'autre' : f)
/** The colour of a state tone (ok / warn / bad / dim / running), grey for anything else. */
export const stateHex = (tone) => STATE_COLORS[tone] || STATE_COLORS.dim

/**
 * The <style> the Sankey, curves and graph put first: class `ink` for texts (dark grey on a light page, light grey on
 * a dark one, by prefers-color-scheme), `mut` for secondary texts. o: { light, dark } overrides the two inks.
 */
export function svgStyle(o = {}) {
  const light = o.light || '#3d444d'
  const dark = o.dark || '#c9d1d9'
  return `<style>.ink{fill:${light}}.mut{fill:${INK.text}}text{font-family:sans-serif}@media (prefers-color-scheme: dark){.ink{fill:${dark}}}</style>`
}

/** Escapes a text for an Svg. */
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Cuts a label to `px` pixels at ~charPx per character. */
export function clipPx(s, px, charPx = 6) {
  const a = [...String(s ?? '')]
  const n = Math.max(2, Math.floor(px / charPx))
  return a.length <= n ? a.join('') : a.slice(0, n - 1).join('') + '…'
}

export const VIZ_DEFAULTS = {
  // px per column of the pane (the bars' style.bar_px): a diagram is as wide as the text around it
  bar_px: 7,
  graph_max: 20,
  labels: { sankey: 'Tokens : fils → modèles', spark: 'TPS sur 24 h,', graph: 'Graphe dessiné' },
}

/** panel.viz of cockpit.config.json, defaults filled; px(cells) = the width in px of `cells` columns. */
export function vizConfig(cfg) {
  const v = (cfg && cfg.panel && cfg.panel.viz) || {}
  const bp = Number((cfg && cfg.panel && cfg.panel.style && cfg.panel.style.bar_px) || v.bar_px) || VIZ_DEFAULTS.bar_px
  const c = { ...VIZ_DEFAULTS, ...v, labels: { ...VIZ_DEFAULTS.labels, ...(v.labels || {}) } }
  return { ...c, px: (cells) => Math.max(60, Math.round(Math.max(1, cells) * bp)) }
}
