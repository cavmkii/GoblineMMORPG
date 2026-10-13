// Enemy archetypes and where they live. Every zone has its own roster.
// Attacks are telegraphed (windup) so they can be dodged.

export const ENEMIES = {
  mossback: {
    name: 'Mossback Toad', zone: 'hollows', tier: 1, hp: 70, speed: 95, radius: 16,
    attack: { kind: 'melee', range: 44, damage: 9, windup: 0.55, cooldown: 1.4 },
    aggro: 170, color: '#6b8e23',
    materials: { hide_t1: 0.4 },
  },
  spore_puff: {
    name: 'Spore Puff', zone: 'hollows', tier: 1, hp: 45, speed: 70, radius: 13,
    attack: { kind: 'ranged', range: 300, damage: 7, windup: 0.7, cooldown: 2.0, speed: 320 },
    aggro: 240, color: '#c9a0dc',
    materials: { herb_t1: 0.3 },
  },
  ash_jackal: {
    name: 'Ash Jackal', zone: 'barrens', tier: 2, hp: 140, speed: 175, radius: 15,
    attack: { kind: 'melee', range: 42, damage: 17, windup: 0.4, cooldown: 1.0 },
    aggro: 230, color: '#a0522d',
    materials: { hide_t2: 0.45 },
  },
  cinder_shaman: {
    name: 'Cinder Shaman', zone: 'barrens', tier: 2, hp: 110, speed: 90, radius: 15,
    attack: { kind: 'ranged', range: 360, damage: 19, windup: 0.8, cooldown: 2.2, speed: 380 },
    aggro: 280, color: '#ff6a2f',
    materials: { herb_t2: 0.35 },
  },
  shard_golem: {
    name: 'Shard Golem', zone: 'shardspire', tier: 3, hp: 420, speed: 70, radius: 24, armor: 30,
    attack: { kind: 'slam', range: 85, damage: 38, windup: 1.0, cooldown: 2.6 },
    aggro: 200, color: '#8fa6d6',
    materials: { core_t3: 0.4, ore_t3: 0.3 },
  },
  crystal_wisp: {
    name: 'Crystal Wisp', zone: 'shardspire', tier: 3, hp: 160, speed: 150, radius: 12,
    attack: { kind: 'ranged', range: 380, damage: 26, windup: 0.6, cooldown: 1.6, speed: 460 },
    aggro: 300, color: '#bff4ff',
    materials: { herb_t3: 0.3 },
  },
  rotfang_brute: {
    name: 'Rotfang Brute', zone: 'rotfang', tier: 3, hp: 520, speed: 105, radius: 22, armor: 20,
    attack: { kind: 'slam', range: 80, damage: 42, windup: 0.85, cooldown: 2.0 },
    aggro: 220, color: '#5d3d5e',
    materials: { rotfang_tooth: 0.5 },
  },
  rotfang_hexer: {
    name: 'Rotfang Hexer', zone: 'rotfang', tier: 3, hp: 260, speed: 95, radius: 15,
    attack: { kind: 'ranged', range: 400, damage: 30, windup: 0.7, cooldown: 1.8, speed: 420 },
    aggro: 320, color: '#9e3fae',
    materials: { rotfang_tooth: 0.3 },
  },
  old_rotfang: {
    name: 'Old Rotfang', zone: 'rotfang', tier: 3, hp: 3200, speed: 90, radius: 38, armor: 35,
    attack: { kind: 'slam', range: 120, damage: 70, windup: 1.2, cooldown: 2.4 },
    aggro: 260, color: '#3b1f3c', fixedRank: 'boss', respawn: 180,
    materials: { rotfang_tooth: 1 },
  },
};

export const RANKS = {
  normal: { hp: 1, damage: 1, weight: 85, scale: 1 },
  elite: { hp: 2.2, damage: 1.35, weight: 12, scale: 1.25 },
  champion: { hp: 4, damage: 1.7, weight: 3, scale: 1.5 },
  boss: { hp: 1, damage: 1, weight: 0, scale: 1 },
};

// [archetype, count]
export const SPAWNS = {
  hollows: [['mossback', 18], ['spore_puff', 12]],
  barrens: [['ash_jackal', 22], ['cinder_shaman', 14]],
  shardspire: [['shard_golem', 14], ['crystal_wisp', 18]],
  rotfang: [['rotfang_brute', 6], ['rotfang_hexer', 6], ['old_rotfang', 1]],
};

// Gathering nodes per zone: [skill, materialKey, requiredLevel, count]
export const NODES = {
  hollows: [['mining', 'ore_t1', 1, 14], ['foraging', 'herb_t1', 1, 14]],
  barrens: [['mining', 'ore_t2', 20, 16], ['foraging', 'herb_t2', 20, 14]],
  shardspire: [['mining', 'ore_t3', 40, 14], ['foraging', 'herb_t3', 40, 12]],
};
