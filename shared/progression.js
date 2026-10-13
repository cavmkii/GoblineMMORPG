// Wisdom: the currency for raising attributes. Earned from kills, first
// discovery of a zone, and (later) quests. Spent a la carte on STR/AGI/INT.
//
// Cost of the next point rises with the attribute's current value, so
// spreading is cheaper than stacking, but ATTRIBUTE_TOTAL_CAP still forces a
// choice of identity eventually.

import { ATTRIBUTE_TOTAL_CAP, ATTRIBUTES } from './stats.js';

export function attributePointCost(current) {
  return 1 + Math.floor(current / 8);
}

export function spendWisdom(player, attr) {
  if (!ATTRIBUTES.includes(attr)) return { ok: false, reason: 'Unknown attribute.' };
  const total = ATTRIBUTES.reduce((s, a) => s + player.attrs[a], 0);
  if (total >= ATTRIBUTE_TOTAL_CAP) return { ok: false, reason: 'Attribute total cap reached.' };
  const cost = attributePointCost(player.attrs[attr]);
  if (player.wisdom < cost) return { ok: false, reason: `Need ${cost} wisdom.` };
  player.wisdom -= cost;
  player.attrs[attr] += 1;
  return { ok: true, cost };
}

// Re-spec is allowed but lossy: you get back 70% of what you spent. Builds
// should be changeable, not free to flip every fight.
export function respec(player, base) {
  let refund = 0;
  for (const a of ATTRIBUTES) {
    for (let v = base[a]; v < player.attrs[a]; v++) refund += attributePointCost(v);
    player.attrs[a] = base[a];
  }
  const back = Math.floor(refund * 0.7);
  player.wisdom += back;
  return { refunded: back, lost: refund - back };
}

export function killWisdom(enemyTier, rank) {
  const rankMult = { normal: 1, elite: 2.5, champion: 5, boss: 15 }[rank] ?? 1;
  return Math.max(1, Math.round(enemyTier * enemyTier * rankMult * 0.6));
}

export const DISCOVERY_WISDOM = 5;
