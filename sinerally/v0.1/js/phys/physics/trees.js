// Tree damage curve (pure). Every tree has TREE.maxHp (3) HP.
//   kmh   = horizontal car speed at the contact point, km/h
//   angle = normal fraction of the impact, |v·n| / |v| (1 = head-on, 0 = pure graze)
// Rules:
//   kmh >= 300            -> all 3 HP (car zooms through, ~1 % speed loss per HP)
//   kmh <= 200            -> refHp * ((kmh - 30) / 170)^1.3 * (0.2 + 0.8 * angle)   (head-on 200 = 2.0 HP, < 30 km/h = 0)
//   200 < kmh < 300       -> smoothstep blend from the 200 km/h value (same angle) up to 3 HP
export const TREE = { maxHp: 3, tapKmh: 30, refKmh: 200, fullKmh: 300, refHp: 2, glanceMin: 0.2, exp: 1.3 };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export function treeDamage(kmh, angle, T = TREE) {
  if (kmh >= T.fullKmh) return T.maxHp;
  const f = T.glanceMin + (1 - T.glanceMin) * clamp(angle, 0, 1);
  const base = s => T.refHp * Math.pow(clamp((s - T.tapKmh) / (T.refKmh - T.tapKmh), 0, 1), T.exp) * f;
  if (kmh <= T.refKmh) return base(kmh);
  const t = (kmh - T.refKmh) / (T.fullKmh - T.refKmh), sm = t * t * (3 - 2 * t), b = base(T.refKmh);
  return b + (T.maxHp - b) * sm;
}
// fraction of horizontal speed lost per HP consumed when the tree breaks (6 % per HP at <= 200, 1 % at >= 300)
export function breakLossPerHp(kmh) { const t = clamp((kmh - 200) / 100, 0, 1), sm = t * t * (3 - 2 * t); return 0.06 + (0.01 - 0.06) * sm; }
