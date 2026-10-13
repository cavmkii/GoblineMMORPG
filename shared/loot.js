// Loot rolls.
//
// Item tier comes from where you are (zone tier) and what you killed
// (enemy rank). Rarity comes from rank plus the "venture" bonus: every kill
// outside a safe zone since you last banked or died nudges rarity up. Going
// home resets it. That is the risk/reward lever: the longer you stay out
// carrying unbanked loot, the better the next drop and the more you lose if
// someone catches you.

import { RARITY_ORDER, WEAPON_TYPES, makeWeapon, AFFIXES, MAX_TIER } from './items.js';

const RARITY_WEIGHTS = {
  normal: [60, 28, 10, 2, 0.2],
  elite: [35, 35, 20, 8, 2],
  champion: [10, 30, 35, 18, 7],
  boss: [0, 10, 40, 35, 15],
};

const DROP_CHANCE = { normal: 0.12, elite: 0.45, champion: 0.9, boss: 1 };
const TIER_UP_CHANCE = { normal: 0, elite: 0.2, champion: 0.5, boss: 1 };

export function ventureBonus(ventureKills, zoneTier) {
  return Math.min(0.6, ventureKills * 0.012 * Math.max(1, zoneTier));
}

export function rollRarity(rng, rank, bonus = 0) {
  const w = RARITY_WEIGHTS[rank] || RARITY_WEIGHTS.normal;
  // Shift weight from the bottom tiers toward the top ones.
  const shifted = w.map((x, i) => x * (i <= 1 ? 1 - bonus * 0.6 : 1 + bonus * (i * 0.8)));
  return rng.weighted(RARITY_ORDER.map((r, i) => [r, shifted[i]]));
}

export function rollAffixes(rng, count) {
  const pool = Object.keys(AFFIXES);
  const out = [];
  while (out.length < count && pool.length) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

export function rollWeapon(rng, { tier, rarity, type, dungeon = false, name }) {
  return makeWeapon({
    type: type || rng.pick(Object.keys(WEAPON_TYPES)),
    tier,
    rarity,
    affixes: rollAffixes(rng, { common: 0, uncommon: 1, rare: 1, epic: 2, legendary: 2 }[rarity]),
    dungeon,
    name,
  });
}

// Dungeon-only uniques: fixed type and affixes, not obtainable elsewhere.
export const DUNGEON_UNIQUES = [
  { name: "Old Rotfang's Jaw", type: 'maul', rarity: 'epic', affixes: ['leeching', 'menacing'] },
  { name: 'Sporelord Wand', type: 'staff', rarity: 'epic', affixes: ['quickcast', 'swift'] },
  { name: 'Tooth-and-Nail', type: 'dagger', rarity: 'legendary', affixes: ['brutal', 'leeching'] },
];

export function rollLoot(rng, { zoneTier, rank, dungeon = false, ventureKills = 0, table = {} }) {
  const drops = { gold: 0, items: [], stacks: [] };
  const tierBase = Math.max(1, zoneTier);
  drops.gold = Math.round((3 + rng() * 6) * tierBase * ({ normal: 1, elite: 3, champion: 6, boss: 20 }[rank] || 1));

  for (const [key, chance] of Object.entries(table.materials || {})) {
    if (rng() < chance) drops.stacks.push({ key, qty: 1 + (rng() < 0.25 ? 1 : 0) });
  }
  if (rng() < 0.08 * tierBase + (rank !== 'normal' ? 0.2 : 0)) {
    drops.stacks.push({ key: `tome_t${Math.min(MAX_TIER, tierBase)}`, qty: 1 });
  }

  if (rng() < (DROP_CHANCE[rank] ?? 0.1)) {
    const tier = Math.min(MAX_TIER, tierBase + (rng() < (TIER_UP_CHANCE[rank] ?? 0) ? 1 : 0));
    const rarity = rollRarity(rng, rank, ventureBonus(ventureKills, zoneTier));
    drops.items.push(rollWeapon(rng, { tier, rarity }));
  }

  if (dungeon && rank === 'boss') {
    const u = rng.pick(DUNGEON_UNIQUES);
    const w = makeWeapon({ type: u.type, tier: Math.min(MAX_TIER, tierBase + 1), rarity: u.rarity, affixes: [...u.affixes], name: u.name, dungeon: true });
    drops.items.push(w);
  }
  return drops;
}
