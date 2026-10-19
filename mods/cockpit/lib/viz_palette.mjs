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
