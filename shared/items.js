// Weapons, rarity, upgrades, affinity.
//
// A weapon's effective power is the product of two things:
//   item power   = f(tier, rarity, upgrade level)       -- what the item is
//   mastery mult = f(affinity with THIS item, skill in THIS weapon type)
// Mastery ranges ~0.55x..1.4x, wide enough that a well-known low-tier weapon
// can beat a fresh higher-tier one. See test/items.test.js for the case.

export const RARITIES = {
  common: { mult: 1.0, affixes: 0, upgradeCap: 5, color: '#c8c8c8' },
  uncommon: { mult: 1.1, affixes: 1, upgradeCap: 7, color: '#5fd35f' },
  rare: { mult: 1.25, affixes: 1, upgradeCap: 9, color: '#4f9cff' },
  epic: { mult: 1.4, affixes: 2, upgradeCap: 11, color: '#b65cff' },
  legendary: { mult: 1.6, affixes: 2, upgradeCap: 13, color: '#ff9b2f' },
};
export const RARITY_ORDER = Object.keys(RARITIES);

export const TIER_POWER = [0, 10, 14, 19, 25, 32];
export const MAX_TIER = 5;

// Attribute scaling per weapon type. A staff that a high-AGI goblin can use
// well is an affix away (see 'quickcast'), not a different class.
export const WEAPON_TYPES = {
  sword: { scaling: { str: 0.6, agi: 0.4 }, label: 'Sword' },
  dagger: { scaling: { agi: 0.9, str: 0.1 }, label: 'Dagger' },
  staff: { scaling: { int: 0.8, str: 0.2 }, label: 'Staff' },
  bow: { scaling: { agi: 0.7, str: 0.3 }, label: 'Bow' },
  maul: { scaling: { str: 1.0 }, label: 'Maul' },
};

// Affixes are dormant until BOTH the upgrade level and the player's affinity
// with the item reach the gate for that slot.
export const AFFIX_GATES = [
  { upgrade: 3, affinity: 2 },
  { upgrade: 6, affinity: 4 },
];

export const AFFIXES = {
  brutal: { label: 'Brutal', desc: '+15% weapon damage', weaponDamage: 0.15 },
  leeching: { label: 'Leeching', desc: 'Heal 6% of damage dealt', lifesteal: 0.06 },
  swift: { label: 'Swift', desc: '-15% cooldowns', cooldown: -0.15 },
  menacing: { label: 'Menacing', desc: '+40% threat generated', threat: 0.4 },
  quickcast: {
    label: 'Quickcast',
    desc: 'Weapon also scales with AGI (0.5)',
    extraScaling: { agi: 0.5 },
  },
  runed: {
    label: 'Runed',
    desc: 'Weapon also scales with INT (0.5)',
    extraScaling: { int: 0.5 },
  },
  frugal: { label: 'Frugal', desc: '-20% ability resource costs', cost: -0.2 },
};

export function affinityLevel(affinityXp) {
  return Math.min(10, Math.floor(Math.sqrt((affinityXp || 0) / 40)));
}

// Affinity belongs to the (player, item) pair, not the item. A weapon you
// have used for months is worth more to you than to whoever buys it.
export function affinityXpFor(item, who) {
  return item?.affinity?.[who] ?? 0;
}

export function addAffinity(item, who, xp) {
  item.affinity = item.affinity || {};
  item.affinity[who] = (item.affinity[who] || 0) + xp;
  return item.affinity[who];
}

let uidCounter = 0;
export function newUid() {
  uidCounter = (uidCounter + 1) % 1e6;
  return `${Date.now().toString(36)}${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function makeWeapon({ type, tier = 1, rarity = 'common', affixes = [], name, dungeon = false, uid }) {
  return {
    uid: uid || newUid(),
    kind: 'weapon',
    type,
    tier,
    rarity,
    upgrade: 0,
    failstacks: 0,
    affinity: {}, // owner name -> xp
    affixes,
    dungeon,
    name: name || `${rarityLabel(rarity)} T${tier} ${WEAPON_TYPES[type].label}`,
  };
}

function rarityLabel(r) {
  return r[0].toUpperCase() + r.slice(1);
}

export function itemPower(item) {
  return TIER_POWER[item.tier] * RARITIES[item.rarity].mult * (1 + 0.06 * item.upgrade);
}

export function masteryMultiplier(affLvl, typeLevel) {
  return 0.55 + 0.05 * Math.min(10, affLvl) + 0.0035 * Math.min(99, typeLevel);
}

export function activeAffixes(item, who) {
  const aff = affinityLevel(affinityXpFor(item, who));
  return item.affixes.filter((_, i) => {
    const g = AFFIX_GATES[i];
    return g && item.upgrade >= g.upgrade && aff >= g.affinity;
  });
}

export function weaponProfile(item, attrs, typeLevel, who) {
  if (!item) {
    return { power: 4, scaling: { str: 0.3 }, mods: {}, type: null, unlockScore: 0 };
  }
  const aff = affinityLevel(affinityXpFor(item, who));
  const active = activeAffixes(item, who);
  const mods = { weaponDamage: 0, lifesteal: 0, cooldown: 0, threat: 0, cost: 0 };
  const scaling = { ...WEAPON_TYPES[item.type].scaling };
  for (const a of active) {
    const def = AFFIXES[a];
    for (const k of Object.keys(mods)) if (def[k]) mods[k] += def[k];
    if (def.extraScaling) {
      for (const [k, v] of Object.entries(def.extraScaling)) scaling[k] = (scaling[k] || 0) + v;
    }
  }
  const mastery = masteryMultiplier(aff, typeLevel);
  return {
    type: item.type,
    power: itemPower(item) * mastery * (1 + mods.weaponDamage),
    scaling,
    mods,
    mastery,
    affinity: aff,
    unlockScore: weaponUnlockScore(item.tier, aff, typeLevel),
  };
}

// Weapon abilities unlock on a combined score so the three axes substitute
// for each other: a T1 weapon you have used for weeks can open the same
// moves as a T3 weapon you picked up an hour ago.
export function weaponUnlockScore(tier, affLvl, typeLevel) {
  return tier * 3 + affLvl * 2 + Math.floor(typeLevel / 5);
}

// Attribute contribution to weapon damage.
export function scaledAttributeDamage(scaling, attrs) {
  let d = 0;
  for (const [k, v] of Object.entries(scaling)) d += (attrs[k] || 0) * v;
  return d;
}

// ---- Upgrades (Throne & Liberty style books, BDO-style failstacks) ----
//
// A tome of tier >= item tier is consumed per attempt. Failure never destroys
// the item; it adds a failstack that improves the next attempt on that item.
// That keeps the gamble but removes the rage-quit outcome. Destruction on
// failure is a dial we can turn later (see docs/DESIGN.md).

export function upgradeChance(item) {
  const base = Math.max(0.05, 0.95 - 0.085 * item.upgrade);
  return Math.min(0.95, base + item.failstacks * 0.03);
}

export function attemptUpgrade(item, tome, rng) {
  if (!tome || tome.kind !== 'tome') return { ok: false, reason: 'Need an upgrade tome.' };
  if (tome.tier < item.tier) return { ok: false, reason: `Need a tier ${item.tier}+ tome.` };
  if (item.upgrade >= RARITIES[item.rarity].upgradeCap) {
    return { ok: false, reason: 'This item is at its rarity cap.' };
  }
  const chance = upgradeChance(item);
  if (rng() < chance) {
    item.upgrade += 1;
    item.failstacks = 0;
    return { ok: true, success: true, chance, upgrade: item.upgrade };
  }
  item.failstacks += 1;
  return { ok: true, success: false, chance, failstacks: item.failstacks };
}

// ---- Stackables ----

export const MATERIALS = {
  ore_t1: { label: 'Bog Iron', tier: 1 },
  ore_t2: { label: 'Cinder Ore', tier: 2 },
  ore_t3: { label: 'Shardsteel', tier: 3 },
  herb_t1: { label: 'Toadcap', tier: 1 },
  herb_t2: { label: 'Ashbloom', tier: 2 },
  herb_t3: { label: 'Glimmerroot', tier: 3 },
  hide_t1: { label: 'Toad Hide', tier: 1 },
  hide_t2: { label: 'Jackal Pelt', tier: 2 },
  core_t3: { label: 'Golem Core', tier: 3 },
  rotfang_tooth: { label: 'Rotfang Tooth', tier: 3 },
};

export function stackKey(item) {
  if (item.kind === 'material') return item.id;
  if (item.kind === 'tome') return `tome_t${item.tier}`;
  if (item.kind === 'potion') return `potion_t${item.tier}`;
  return null;
}

export function makeStack(key, qty = 1) {
  if (MATERIALS[key]) return { kind: 'material', id: key, tier: MATERIALS[key].tier, qty };
  let m = /^tome_t(\d)$/.exec(key);
  if (m) return { kind: 'tome', tier: +m[1], qty };
  m = /^potion_t(\d)$/.exec(key);
  if (m) return { kind: 'potion', tier: +m[1], qty };
  throw new Error(`unknown stack key ${key}`);
}

export function stackLabel(key) {
  if (MATERIALS[key]) return MATERIALS[key].label;
  let m = /^tome_t(\d)$/.exec(key);
  if (m) return `Upgrade Tome (T${m[1]})`;
  m = /^potion_t(\d)$/.exec(key);
  if (m) return `Grog Potion (T${m[1]})`;
  return key;
}

export function potionHeal(tier) {
  return 40 + tier * 45;
}
