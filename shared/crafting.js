// Crafting recipes. Smithing makes weapons, alchemy makes potions,
// scribing makes upgrade tomes. Because trade skills share a cap, a
// goblin who smiths well usually buys their tomes and grog.

import { RARITY_ORDER } from './items.js';

export const RECIPES = {
  weapon_t1: { skill: 'smithing', level: 1, station: 'anvil', inputs: { ore_t1: 5, hide_t1: 1 }, output: { weapon: 1 }, xp: 60 },
  weapon_t2: { skill: 'smithing', level: 25, station: 'anvil', inputs: { ore_t2: 6, hide_t2: 2 }, output: { weapon: 2 }, xp: 180 },
  weapon_t3: { skill: 'smithing', level: 50, station: 'anvil', inputs: { ore_t3: 8, core_t3: 1 }, output: { weapon: 3 }, xp: 500 },
  potion_t1: { skill: 'alchemy', level: 1, station: 'cauldron', inputs: { herb_t1: 2 }, output: { stack: 'potion_t1', qty: 2 }, xp: 30 },
  potion_t2: { skill: 'alchemy', level: 25, station: 'cauldron', inputs: { herb_t2: 2 }, output: { stack: 'potion_t2', qty: 2 }, xp: 90 },
  potion_t3: { skill: 'alchemy', level: 50, station: 'cauldron', inputs: { herb_t3: 2 }, output: { stack: 'potion_t3', qty: 2 }, xp: 250 },
  tome_t1: { skill: 'scribing', level: 1, station: 'anvil', inputs: { hide_t1: 2, herb_t1: 1 }, output: { stack: 'tome_t1', qty: 1 }, xp: 40 },
  tome_t2: { skill: 'scribing', level: 25, station: 'anvil', inputs: { hide_t2: 2, herb_t2: 1 }, output: { stack: 'tome_t2', qty: 1 }, xp: 120 },
  tome_t3: { skill: 'scribing', level: 50, station: 'anvil', inputs: { core_t3: 1, herb_t3: 2 }, output: { stack: 'tome_t3', qty: 1 }, xp: 320 },
};

// Crafted rarity improves with skill margin over the recipe requirement.
export function craftedRarity(rng, skillLevel, recipeLevel) {
  const margin = Math.max(0, skillLevel - recipeLevel);
  const w = [60 - margin * 0.9, 28, 9 + margin * 0.35, 2 + margin * 0.25, 0.5 + margin * 0.1];
  return rng.weighted(RARITY_ORDER.map((r, i) => [r, Math.max(0.1, w[i])]));
}
