// Surface friction table. worldQuery.surfaceAt(x, z) may return one of these names, an index (0..6, main-game SURF order)
// or a custom object { name, mu, roll, bs } (mu = peak friction, roll = rolling resistance coeff, bs = tyre stiffness scale).
export const SURFACES = {
  asphalt: { name: 'asphalt', mu: 1.10, roll: 0.012, bs: 1.00 },
  dirt:    { name: 'dirt',    mu: 0.84, roll: 0.028, bs: 0.75 },
  grass:   { name: 'grass',   mu: 0.74, roll: 0.045, bs: 0.70 },
  sand:    { name: 'sand',    mu: 0.68, roll: 0.10,  bs: 0.55 },
  rock:    { name: 'rock',    mu: 0.92, roll: 0.020, bs: 0.90 },
  snow:    { name: 'snow',    mu: 0.50, roll: 0.050, bs: 0.60 },
  mud:     { name: 'mud',     mu: 0.52, roll: 0.15,  bs: 0.50 },
};
export const SURFACE_ORDER = ['asphalt', 'dirt', 'grass', 'sand', 'rock', 'snow', 'mud'];
export function resolveSurface(s) {
  if (s && typeof s === 'object') return s.mu ? s : SURFACES.grass;
  if (typeof s === 'number') return SURFACES[SURFACE_ORDER[s]] || SURFACES.grass;
  return SURFACES[s] || SURFACES.grass;
}
