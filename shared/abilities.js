// Abilities.
//
// Two sources:
//  - school abilities, gated by attribute thresholds. Your attribute spread
//    is your "class"; abilities that need two attributes are where hybrids
//    (high-AGI casters, INT bruisers) get moves nobody else has.
//  - weapon abilities, gated by the weapon unlock score (tier, affinity,
//    weapon-type skill; see items.js weaponUnlockScore).
//
// Costs mix mana, stamina and health. Health-cost abilities mean a big HP
// pool is a resource for an aggressive build, not proof of a tank. Tanking
// comes from threat generation plus mitigation, not raw HP.
//
// Shapes the server knows how to execute:
//   projectile {range, speed, radius, count?, spread?, pierce?}
//   melee      {range, arc}            arc in degrees
//   aoe        {radius, at: 'self'|'target', range?, delay?}
//   dash       {distance}              moves caster along aim
//   self       {}                      buffs only

export const ABILITIES = {
  // ---------- always available ----------
  punch: {
    name: 'Scrappy Jab', icon: '👊', source: 'innate', cooldown: 0.5,
    cost: { stamina: 4 },
    shape: { type: 'melee', range: 46, arc: 70 },
    damage: { base: 4, scale: { str: 0.4, agi: 0.2 } },
    skill: null,
  },
  dodge: {
    name: 'Tumble', icon: '🌀', source: 'innate', cooldown: 0.6,
    cost: { stamina: 22 },
    shape: { type: 'dash', distance: 110 },
    iframes: true, skill: 'athletics',
  },

  // ---------- school: INT ----------
  arcane_bolt: {
    name: 'Sparkbolt', icon: '✨', source: 'school', cooldown: 0.7,
    requires: { int: 8 }, cost: { mana: 10 },
    shape: { type: 'projectile', range: 520, speed: 620, radius: 9 },
    damage: { base: 10, scale: { int: 1.1 } }, skill: 'evocation',
  },
  frost_nova: {
    name: 'Bog Frost', icon: '❄️', source: 'school', cooldown: 9,
    requires: { int: 14 }, cost: { mana: 30 },
    shape: { type: 'aoe', at: 'self', radius: 110 },
    damage: { base: 12, scale: { int: 0.7 } }, debuff: { slow: 0.5, duration: 3 },
    skill: 'evocation',
  },
  mend: {
    name: 'Mudpoultice', icon: '💚', source: 'school', cooldown: 5,
    requires: { int: 10 }, cost: { mana: 24 },
    shape: { type: 'aoe', at: 'target', range: 300, radius: 70 },
    heal: { base: 25, scale: { int: 1.4 } }, skill: 'evocation',
  },

  // ---------- school: STR ----------
  war_cry: {
    name: 'Bellow', icon: '📣', source: 'school', cooldown: 10,
    requires: { str: 10 }, cost: { stamina: 20 },
    shape: { type: 'aoe', at: 'self', radius: 170 },
    taunt: { duration: 4 }, skill: 'athletics',
  },
  iron_skin: {
    name: 'Thick Hide', icon: '🛡️', source: 'school', cooldown: 16,
    requires: { str: 14 }, cost: { stamina: 30 },
    shape: { type: 'self' },
    buff: { id: 'iron_skin', duration: 5, damageTaken: -0.4 }, skill: 'athletics',
  },

  // ---------- school: AGI ----------
  feint: {
    name: 'Feint', icon: '🎭', source: 'school', cooldown: 12,
    requires: { agi: 10 }, cost: { stamina: 12 },
    shape: { type: 'aoe', at: 'self', radius: 220 },
    threatDrop: 0.5, skill: 'athletics',
  },

  // ---------- school: hybrids ----------
  blood_bolt: {
    // STR+INT: the high-HP caster spends HP as mana.
    name: 'Bloodspit', icon: '🩸', source: 'school', cooldown: 1.1,
    requires: { str: 10, int: 10 }, cost: { health: 14 },
    shape: { type: 'projectile', range: 480, speed: 560, radius: 11, pierce: 1 },
    damage: { base: 22, scale: { int: 0.9, str: 0.5 } }, skill: 'evocation',
  },
  bloodlust: {
    // STR+AGI: pay HP for damage.
    name: 'Bloodlust', icon: '😤', source: 'school', cooldown: 18,
    requires: { str: 9, agi: 9 }, cost: { healthPct: 0.12 },
    shape: { type: 'self' },
    buff: { id: 'bloodlust', duration: 6, damageDealt: 0.3 }, skill: 'athletics',
  },
  shadowstep: {
    // AGI+INT: the "high-dex mage" blink.
    name: 'Shadowhop', icon: '👣', source: 'school', cooldown: 6,
    requires: { agi: 12, int: 8 }, cost: { stamina: 18, mana: 12 },
    shape: { type: 'dash', distance: 230 },
    iframes: true, buff: { id: 'ambush', duration: 3, nextHitCrit: true }, skill: 'evocation',
  },
  arcane_volley: {
    // AGI+INT: fast, cheap, spammy.
    name: 'Sparkfan', icon: '🎆', source: 'school', cooldown: 2.5,
    requires: { agi: 10, int: 10 }, cost: { mana: 14, stamina: 8 },
    shape: { type: 'projectile', range: 380, speed: 700, radius: 7, count: 3, spread: 24 },
    damage: { base: 6, scale: { int: 0.45, agi: 0.45 } }, skill: 'evocation',
  },

  // ---------- weapon: sword ----------
  slash: {
    name: 'Slash', icon: '🗡️', source: 'weapon', weapon: 'sword', unlock: 0, cooldown: 0.55,
    cost: { stamina: 7 }, shape: { type: 'melee', range: 62, arc: 100 },
    damage: { base: 3, weapon: 1.0 }, skill: 'sword',
  },
  riposte: {
    name: 'Riposte', icon: '⚔️', source: 'weapon', weapon: 'sword', unlock: 10, cooldown: 5,
    cost: { stamina: 14 }, shape: { type: 'dash', distance: 90 },
    iframes: true, buff: { id: 'riposte', duration: 2, nextHitBonus: 1.0 }, skill: 'sword',
  },
  whirlwind: {
    name: 'Whirligig', icon: '🌪️', source: 'weapon', weapon: 'sword', unlock: 18, cooldown: 8,
    cost: { stamina: 30 }, shape: { type: 'aoe', at: 'self', radius: 95 },
    damage: { base: 6, weapon: 1.3 }, skill: 'sword',
  },

  // ---------- weapon: dagger ----------
  stab: {
    name: 'Stab', icon: '🔪', source: 'weapon', weapon: 'dagger', unlock: 0, cooldown: 0.35,
    cost: { stamina: 5 }, shape: { type: 'melee', range: 48, arc: 60 },
    damage: { base: 2, weapon: 0.75 }, skill: 'dagger',
  },
  fan_of_knives: {
    name: 'Knife Fan', icon: '🔪', source: 'weapon', weapon: 'dagger', unlock: 10, cooldown: 4,
    cost: { stamina: 16 }, shape: { type: 'projectile', range: 300, speed: 650, radius: 7, count: 5, spread: 60 },
    damage: { base: 2, weapon: 0.6 }, skill: 'dagger',
  },
  gut_twist: {
    name: 'Gut Twist', icon: '💢', source: 'weapon', weapon: 'dagger', unlock: 17, cooldown: 7,
    cost: { stamina: 10, health: 8 }, shape: { type: 'melee', range: 48, arc: 50 },
    damage: { base: 8, weapon: 2.4 }, skill: 'dagger',
  },

  // ---------- weapon: staff ----------
  staff_bolt: {
    name: 'Knob Bolt', icon: '🔮', source: 'weapon', weapon: 'staff', unlock: 0, cooldown: 0.65,
    cost: { stamina: 4, mana: 2 }, shape: { type: 'projectile', range: 460, speed: 560, radius: 9 },
    damage: { base: 3, weapon: 0.9 }, skill: 'staff',
  },
  staff_sweep: {
    name: 'Shin Sweep', icon: '🦯', source: 'weapon', weapon: 'staff', unlock: 9, cooldown: 6,
    cost: { stamina: 15 }, shape: { type: 'melee', range: 70, arc: 160 },
    damage: { base: 4, weapon: 0.8 }, debuff: { stun: 0.8 }, skill: 'staff',
  },
  mana_burst: {
    name: 'Overcharge', icon: '💥', source: 'weapon', weapon: 'staff', unlock: 18, cooldown: 10,
    cost: { mana: 40 }, shape: { type: 'aoe', at: 'target', range: 380, radius: 90, delay: 0.6 },
    damage: { base: 12, weapon: 2.0 }, skill: 'staff',
  },

  // ---------- weapon: bow ----------
  shoot: {
    name: 'Loose', icon: '🏹', source: 'weapon', weapon: 'bow', unlock: 0, cooldown: 0.6,
    cost: { stamina: 6 }, shape: { type: 'projectile', range: 600, speed: 800, radius: 6 },
    damage: { base: 2, weapon: 0.95 }, skill: 'bow',
  },
  piercing_shot: {
    name: 'Skewer', icon: '➶', source: 'weapon', weapon: 'bow', unlock: 11, cooldown: 5,
    cost: { stamina: 18 }, shape: { type: 'projectile', range: 700, speed: 950, radius: 8, pierce: 4 },
    damage: { base: 5, weapon: 1.5 }, skill: 'bow',
  },
  arrow_rain: {
    name: 'Arrow Drizzle', icon: '🌧️', source: 'weapon', weapon: 'bow', unlock: 19, cooldown: 11,
    cost: { stamina: 30 }, shape: { type: 'aoe', at: 'target', range: 520, radius: 110, delay: 0.8 },
    damage: { base: 6, weapon: 1.6 }, debuff: { slow: 0.35, duration: 2 }, skill: 'bow',
  },

  // ---------- weapon: maul ----------
  smash: {
    name: 'Bonk', icon: '🔨', source: 'weapon', weapon: 'maul', unlock: 0, cooldown: 0.9,
    cost: { stamina: 11 }, shape: { type: 'melee', range: 66, arc: 90 },
    damage: { base: 5, weapon: 1.35 }, threatMult: 1.5, skill: 'maul',
  },
  ground_slam: {
    name: 'Ground Slam', icon: '🌋', source: 'weapon', weapon: 'maul', unlock: 10, cooldown: 7,
    cost: { stamina: 24 }, shape: { type: 'aoe', at: 'self', radius: 105 },
    damage: { base: 6, weapon: 1.1 }, debuff: { stun: 1.0 }, threatMult: 2.0, skill: 'maul',
  },
  stubborn: {
    // Maul ultimate costs health: big goblin, big swing, pays in blood.
    name: 'Stubborn Swing', icon: '🪨', source: 'weapon', weapon: 'maul', unlock: 18, cooldown: 9,
    cost: { stamina: 20, healthPct: 0.08 }, shape: { type: 'melee', range: 80, arc: 140 },
    damage: { base: 14, weapon: 2.6 }, threatMult: 2.5, skill: 'maul',
  },
};

export function meetsAttributeReq(req, attrs) {
  if (!req) return true;
  return Object.entries(req).every(([k, v]) => (attrs[k] || 0) >= v);
}

// Which abilities can this goblin use right now?
export function availableAbilities(attrs, weapon) {
  const out = [];
  for (const [id, a] of Object.entries(ABILITIES)) {
    if (a.source === 'innate') out.push(id);
    else if (a.source === 'school' && meetsAttributeReq(a.requires, attrs)) out.push(id);
    else if (a.source === 'weapon') {
      const type = weapon?.type ?? null;
      if (type === a.weapon && (weapon.unlockScore ?? 0) >= a.unlock) out.push(id);
    }
  }
  return out;
}

export function resolveCost(ability, { maxHealth, health }, mults = {}) {
  const c = ability.cost || {};
  const costMult = mults.cost ?? 1;
  const out = {
    mana: Math.round((c.mana || 0) * costMult),
    stamina: Math.round((c.stamina || 0) * costMult * (ability.id === 'dodge' ? mults.dodge ?? 1 : 1)),
    health: Math.round(((c.health || 0) + (c.healthPct || 0) * maxHealth) * costMult),
  };
  return out;
}

export function canAfford(cost, res) {
  // Health costs can't kill you; you need to have strictly more.
  return res.mana >= cost.mana && res.stamina >= cost.stamina && (cost.health === 0 || res.health > cost.health);
}

for (const [id, a] of Object.entries(ABILITIES)) a.id = id;
