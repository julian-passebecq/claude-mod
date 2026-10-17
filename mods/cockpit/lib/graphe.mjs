// cockpit Panneau, section 5 « Graphe des conversations » - RESERVED SLOT (17 Oct): the next package fills it.
// Contract: grapheModel(scan, self, cfg, nowMs) is pure (no $, no I/O) and returns the model the view draws, or
// { ready: false } while nothing is built. register.mjs passes its result to the Panneau as P.graphe; the drawing is
// hooks/graphe_view.mjs drawGraphe(h, model, labels, width). Labels: panel.labels.graphe* in cockpit.config.json.
export function grapheModel(scan, self, cfg, nowMs) { // eslint-disable-line no-unused-vars
  return { ready: false }
}
