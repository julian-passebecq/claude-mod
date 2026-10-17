// cockpit Panneau, section 5 « Graphe des conversations » - RESERVED SLOT: the render hook the next package fills.
// drawGraphe(h, model, L, width) -> element list (the section's body). h: view.mjs's kit (T, row, col, btn, lr, box);
// model: lib/graphe.mjs grapheModel(...); L: panel labels; width: the columns of the body. Keep every line <= width.
export function drawGraphe(h, model, L, width) { // eslint-disable-line no-unused-vars
  if (!model || !model.ready) return [h.T(L.graphe_slot, { dim: true, key: 'pg-slot' })]
  return []
}
