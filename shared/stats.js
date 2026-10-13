// Attributes and derived stats.
//
// Three primaries, DOTA-style: every point of every attribute does something
// for every character, so there is no dead stat for a given "class".
// From Rogue Trader we take the characteristic bonus (tens digit), used for
// flat effects: STR bonus is flat damage soak, AGI bonus is extra dodge
// i-frame time, INT bonus is extra projectile pierce/size at thresholds.
//
// Attributes are raised with Wisdom (see progression.js), not levels.

export const ATTRIBUTES = ['str', 'agi', 'int'];

export const BASE_ATTRIBUTES = { str: 5, agi: 5, int: 5 };

// Hard ceiling on the sum of all three. Forces identity: you can be a
// strong-and-quick goblin or a clever-and-quick one, not all three at max.
export const ATTRIBUTE_TOTAL_CAP = 120;

export function characteristicBonus(value) {
  return Math.floor(value / 10);
}

export function deriveStats(attrs, gear = {}) {
  const { str, agi, int } = attrs;
  return {
    maxHealth: Math.round(100 + str * 10 + agi * 2 + (gear.health || 0)),
    maxMana: Math.round(40 + int * 10 + (gear.mana || 0)),
    maxStamina: Math.round(80 + agi * 6 + str * 2 + (gear.stamina || 0)),
    healthRegen: 0.6 + str * 0.06, // per second, out of combat x3
    manaRegen: 1.2 + int * 0.14,
    staminaRegen: 10 + agi * 0.35,
    moveSpeed: 150 + agi * 1.6, // world units per second
    critChance: Math.min(0.5, 0.04 + agi * 0.004),
    critMult: 1.5 + int * 0.005, // clever goblins find the soft spots
    armor: str * 0.6 + (gear.armor || 0),
    damageSoak: characteristicBonus(str), // flat, after armor
    dodgeIframes: 0.25 + characteristicBonus(agi) * 0.02,
    threatMult: 1 + (gear.threat || 0),
  };
}

// DOTA-like armor curve: diminishing, never 100%.
export function armorReduction(armor) {
  return armor / (armor + 60);
}

export function mitigate(raw, defenderStats, { ignoreArmor = false } = {}) {
  const afterArmor = ignoreArmor ? raw : raw * (1 - armorReduction(defenderStats.armor));
  return Math.max(1, Math.round(afterArmor - defenderStats.damageSoak));
}

// What the zone warnings compare against. Deliberately crude: it is a hint,
// not a gate.
export function powerRating(attrs, weaponPower = 0) {
  return Math.round(attrs.str + attrs.agi + attrs.int + weaponPower * 1.5);
}
