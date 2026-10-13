// Authoritative simulation. Clients send intents (move, aim, cast); the
// server decides what happened and tells them.

import { makeRng } from '../shared/rng.js';
import { BASE_ATTRIBUTES, deriveStats, mitigate, armorReduction, powerRating } from '../shared/stats.js';
import { ABILITIES, availableAbilities, resolveCost, canAfford } from '../shared/abilities.js';
import {
  weaponProfile, scaledAttributeDamage, attemptUpgrade, makeStack, stackKey, potionHeal,
  makeWeapon, affinityLevel, addAffinity,
} from '../shared/items.js';
import { newSkillSet, skillLevel, gainXp, athleticsBonus, evocationBonus, SKILLS } from '../shared/skills.js';
import { ThreatTable } from '../shared/threat.js';
import { spendWisdom, killWisdom, DISCOVERY_WISDOM } from '../shared/progression.js';
import { rollLoot, rollWeapon } from '../shared/loot.js';
import { Market } from '../shared/market.js';
import { ZONES, WORLD, zoneAt, zoneWarning, TOWN_SPAWN } from '../shared/zones.js';
import { ENEMIES, RANKS, SPAWNS, NODES } from '../shared/enemies.js';
import { RECIPES, craftedRarity } from '../shared/crafting.js';
import { defaultHotbars, HOTBARS, UTILITY_ACTIONS, EMOTES, COMBAT_TIMEOUT } from '../shared/hotbars.js';

const PLAYER_RADIUS = 14;
const INTEREST_RADIUS = 1150;
const MAX_INVENTORY_ITEMS = 24;
const LEASH = 650;
const BAG_OWNER_WINDOW = 60;
const PVP_DEATH_BAG_TTL = 600;
const RECALL_TIME = 6;
const POTION_CD = 15;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angleDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
};

export function newPlayerRecord(name) {
  return {
    name,
    attrs: { ...BASE_ATTRIBUTES },
    wisdom: 12, // enough to pick a direction on day one
    skills: newSkillSet(),
    inventory: { gold: 20, items: [makeWeapon({ type: 'sword', tier: 1, name: 'Rusty Shiv-Sword' })], stacks: { potion_t1: 3 } },
    bank: { gold: 0, items: [], stacks: {} },
    equipped: makeWeapon({ type: 'staff', tier: 1, name: 'Crooked Stick' }),
    hotbars: defaultHotbars(),
    discovered: ['warren'],
    known: [],
    x: TOWN_SPAWN.x,
    y: TOWN_SPAWN.y,
  };
}

export class World {
  constructor({ store, seed } = {}) {
    this.store = store;
    this.rng = makeRng(seed);
    this.time = 0;
    this.nextId = 1;
    this.players = new Map(); // id -> runtime player
    this.enemies = new Map();
    this.projectiles = [];
    this.aoes = []; // pending/visual aoes
    this.bags = new Map();
    this.nodes = new Map();
    this.market = Market.fromJSON(store?.loadMeta('market'));
    this.spawnWorld();
  }

  id(prefix) {
    return `${prefix}${this.nextId++}`;
  }

  // ---------------------------------------------------------------- setup

  randomPointIn(zoneId) {
    const z = ZONES.find((q) => q.id === zoneId);
    const [x, y, w, h] = z.rect;
    for (let i = 0; i < 50; i++) {
      const p = { x: x + 40 + this.rng() * (w - 80), y: y + 40 + this.rng() * (h - 80) };
      if (zoneAt(p.x, p.y).id === zoneId) return p;
    }
    return { x: x + w / 2, y: y + h / 2 };
  }

  spawnWorld() {
    for (const [zoneId, list] of Object.entries(SPAWNS)) {
      for (const [type, count] of list) {
        for (let i = 0; i < count; i++) this.spawnEnemy(type, zoneId);
      }
    }
    for (const [zoneId, list] of Object.entries(NODES)) {
      for (const [skill, key, level, count] of list) {
        for (let i = 0; i < count; i++) {
          const p = this.randomPointIn(zoneId);
          const id = this.id('n');
          this.nodes.set(id, { id, ...p, skill, key, level, tier: +key.slice(-1), readyAt: 0 });
        }
      }
    }
  }

  spawnEnemy(type, zoneId, existing) {
    const def = ENEMIES[type];
    const rank = def.fixedRank || this.rng.weighted(
      Object.entries(RANKS).filter(([, r]) => r.weight > 0).map(([k, r]) => [k, r.weight]),
    );
    const r = RANKS[rank];
    const home = existing?.home || this.randomPointIn(zoneId);
    const e = existing || { id: this.id('e') };
    Object.assign(e, {
      type, zoneId, rank, home,
      x: home.x, y: home.y,
      maxHp: Math.round(def.hp * r.hp), hp: Math.round(def.hp * r.hp),
      radius: def.radius * r.scale,
      damageMult: r.damage,
      threat: new ThreatTable(),
      state: 'idle', attackReadyAt: 0, windupUntil: 0, aim: null,
      dead: false, respawnAt: 0, stunUntil: 0, slowUntil: 0, slow: 0,
      wanderTarget: null,
      damageBy: new Map(),
    });
    this.enemies.set(e.id, e);
    return e;
  }

  // ---------------------------------------------------------------- players

  join(name, send) {
    let rec = this.store?.get(name);
    if (!rec) {
      rec = newPlayerRecord(name);
      this.store?.put(rec);
    }
    for (const p of this.players.values()) {
      if (p.rec.name.toLowerCase() === name.toLowerCase()) return { error: 'That goblin is already online.' };
    }
    const p = {
      id: this.id('p'),
      rec,
      send,
      x: rec.x, y: rec.y,
      aim: 0,
      input: { up: false, down: false, left: false, right: false },
      cooldowns: {},
      buffs: [],
      iframesUntil: 0,
      combatUntil: 0,
      stunUntil: 0, slowUntil: 0, slow: 0,
      dead: false, respawnAt: 0,
      zoneId: null,
      ventureKills: 0,
      channel: null,
      potionReadyAt: 0,
      dirty: true,
      chatTokens: 5,
    };
    this.recompute(p);
    p.hp = p.stats.maxHealth;
    p.mana = p.stats.maxMana;
    p.stamina = p.stats.maxStamina;
    this.players.set(p.id, p);
    this.updateZone(p);
    this.broadcast({ t: 'chat', from: null, text: `${rec.name} has joined.` });
    return { player: p };
  }

  leave(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.rec.x = p.x;
    p.rec.y = p.y;
    for (const e of this.enemies.values()) e.threat.remove(id);
    this.players.delete(id);
    this.broadcast({ t: 'chat', from: null, text: `${p.rec.name} has left.` });
  }

  recompute(p) {
    const rec = p.rec;
    const w = rec.equipped;
    const typeLevel = w ? skillLevel(rec.skills, w.type) : 1;
    p.weapon = weaponProfile(w, rec.attrs, typeLevel, rec.name);
    p.stats = deriveStats(rec.attrs, { threat: p.weapon.mods.threat || 0 });
    const ath = athleticsBonus(skillLevel(rec.skills, 'athletics'));
    p.stats.moveSpeed *= ath.moveSpeedMult;
    p.dodgeCostMult = ath.dodgeCostMult;
    p.evoCostMult = evocationBonus(skillLevel(rec.skills, 'evocation')).costMult;
    p.abilities = new Set(availableAbilities(rec.attrs, p.weapon));
    p.power = powerRating(rec.attrs, p.weapon.power);
    // Auto-slot newly available abilities into empty combat slots.
    const bar = rec.hotbars.combat;
    for (const id of p.abilities) {
      if (rec.known.includes(id)) continue;
      rec.known.push(id);
      if (!bar.includes(id)) {
        const slot = bar.indexOf(null);
        if (slot >= 0) bar[slot] = id;
      }
    }
    if (p.hp !== undefined) {
      p.hp = Math.min(p.hp, p.stats.maxHealth);
      p.mana = Math.min(p.mana, p.stats.maxMana);
      p.stamina = Math.min(p.stamina, p.stats.maxStamina);
    }
    p.dirty = true;
  }

  inCombat(p) {
    return this.time < p.combatUntil;
  }

  zoneOf(ent) {
    return zoneAt(ent.x, ent.y);
  }

  updateZone(p) {
    const z = this.zoneOf(p);
    if (z.id === p.zoneId) return;
    p.zoneId = z.id;
    let discovered = false;
    if (!p.rec.discovered.includes(z.id)) {
      p.rec.discovered.push(z.id);
      p.rec.wisdom += DISCOVERY_WISDOM;
      discovered = true;
      p.dirty = true;
    }
    p.send({ t: 'zone', zone: z.id, warning: zoneWarning(z, p.power), discovered, wisdom: discovered ? DISCOVERY_WISDOM : 0 });
  }

  msg(p, text, kind = 'info') {
    // Swallow identical repeats (e.g. holding attack while out of mana).
    if (p.lastMsg === text && this.time - p.lastMsgAt < 1.5) return;
    p.lastMsg = text;
    p.lastMsgAt = this.time;
    p.send({ t: 'msg', text, kind });
  }

  broadcast(m) {
    for (const p of this.players.values()) p.send(m);
  }

  broadcastNear(x, y, m, r = INTEREST_RADIUS) {
    for (const p of this.players.values()) if (Math.hypot(p.x - x, p.y - y) < r) p.send(m);
  }

  xp(p, skill, amount) {
    if (!skill || amount <= 0) return;
    const res = gainXp(p.rec.skills, skill, amount);
    if (res.levelUps > 0) {
      const lvl = skillLevel(p.rec.skills, skill);
      this.msg(p, `${SKILLS[skill].label} is now level ${lvl}.`, 'level');
      if (['athletics', 'evocation', p.rec.equipped?.type].includes(skill)) this.recompute(p);
    }
    if (res.drained.length) this.msg(p, `Trade cap: ${[...new Set(res.drained)].join(', ')} lowered.`, 'warn');
    if (res.capped) {
      // At cap with nothing marked down. Tell them once in a while.
      if (!p.capWarnAt || this.time - p.capWarnAt > 30) {
        p.capWarnAt = this.time;
        this.msg(p, 'Trade skill cap reached. Mark a skill "down" to keep learning.', 'warn');
      }
    }
    p.dirty = true;
  }

  // ---------------------------------------------------------------- input

  handle(p, m) {
    switch (m.t) {
      case 'input':
        p.input = { up: !!m.up, down: !!m.down, left: !!m.left, right: !!m.right };
        if (Number.isFinite(m.aim)) p.aim = m.aim;
        if (p.channel && (p.input.up || p.input.down || p.input.left || p.input.right)) this.cancelChannel(p, 'You moved.');
        break;
      case 'cast':
        this.cast(p, m.id, m.ax, m.ay);
        break;
      case 'util':
        this.utility(p, m.id);
        break;
      case 'emote':
        if (EMOTES[m.id]) this.broadcastNear(p.x, p.y, { t: 'emote', who: p.id, name: p.rec.name, id: m.id });
        break;
      case 'chat': {
        const text = String(m.text || '').slice(0, 200).trim();
        if (!text) break;
        if (p.chatTokens < 1) return this.msg(p, 'Slow down.', 'warn');
        p.chatTokens -= 1;
        this.broadcast({ t: 'chat', from: p.rec.name, text });
        break;
      }
      case 'hotbar':
        this.assignHotbar(p, m.bar, m.slot, m.id ?? null);
        break;
      case 'wisdom': {
        const r = spendWisdom(p.rec, m.attr);
        if (!r.ok) this.msg(p, r.reason, 'warn');
        else this.recompute(p);
        break;
      }
      case 'equip':
        this.equip(p, m.uid);
        break;
      case 'unequip':
        this.unequip(p);
        break;
      case 'upgrade':
        this.upgrade(p, m.uid);
        break;
      case 'craft':
        this.craft(p, m.recipe, m.weaponType);
        break;
      case 'withdraw':
        this.withdraw(p, m);
        break;
      case 'market':
        this.marketOp(p, m);
        break;
      case 'skillLock':
        if (p.rec.skills[m.skill] && ['up', 'down', 'locked'].includes(m.lock)) {
          p.rec.skills[m.skill].lock = m.lock;
          p.dirty = true;
        }
        break;
      default:
        break;
    }
  }

  assignHotbar(p, bar, slot, id) {
    if (!HOTBARS.includes(bar) || !(slot >= 0 && slot < 8)) return;
    const valid = id === null
      || (bar === 'combat' && ABILITIES[id])
      || (bar === 'utility' && (UTILITY_ACTIONS[id] || ABILITIES[id]))
      || (bar === 'social' && EMOTES[id]);
    if (!valid) return;
    p.rec.hotbars[bar][slot] = id;
    p.dirty = true;
  }

  // ---------------------------------------------------------------- combat

  cast(p, id, ax, ay) {
    const a = ABILITIES[id];
    if (!a || p.dead || this.time < p.stunUntil || p.channel) return;
    if (!p.abilities.has(id)) return this.msg(p, `You can't use ${a.name} right now.`, 'warn');
    if ((p.cooldowns[id] || 0) > this.time) return;
    const mults = {
      cost: (1 + (p.weapon.mods.cost || 0)) * (a.source === 'school' ? p.evoCostMult : 1),
      dodge: p.dodgeCostMult,
    };
    const cost = resolveCost(a, { maxHealth: p.stats.maxHealth, health: p.hp }, mults);
    if (!canAfford(cost, { mana: p.mana, stamina: p.stamina, health: p.hp })) return this.msg(p, 'Not enough juice.', 'warn');
    p.mana -= cost.mana;
    p.stamina -= cost.stamina;
    p.hp -= cost.health;
    p.cooldowns[id] = this.time + a.cooldown * Math.max(0.3, 1 + (p.weapon.mods.cooldown || 0));

    const tx = Number.isFinite(ax) ? ax : p.x + Math.cos(p.aim) * 100;
    const ty = Number.isFinite(ay) ? ay : p.y + Math.sin(p.aim) * 100;
    const ang = Math.atan2(ty - p.y, tx - p.x);
    p.aim = ang;
    const s = a.shape;

    this.broadcastNear(p.x, p.y, { t: 'cast', who: p.id, id, ang });

    if (s.type === 'projectile') {
      const count = s.count || 1;
      const spread = ((s.spread || 0) * Math.PI) / 180;
      for (let i = 0; i < count; i++) {
        const off = count === 1 ? 0 : -spread / 2 + (spread * i) / (count - 1);
        this.spawnProjectile({
          x: p.x, y: p.y, ang: ang + off, speed: s.speed, range: s.range, radius: s.radius,
          owner: { kind: 'player', id: p.id }, ability: id, pierce: s.pierce || 0,
        });
      }
    } else if (s.type === 'melee') {
      const arc = (s.arc * Math.PI) / 180 / 2;
      const hit = (t, r) => dist(p, t) <= s.range + r && angleDiff(Math.atan2(t.y - p.y, t.x - p.x), ang) <= arc;
      for (const e of this.enemies.values()) if (!e.dead && hit(e, e.radius)) this.playerHitsEnemy(p, e, a);
      for (const q of this.players.values()) if (q !== p && !q.dead && hit(q, PLAYER_RADIUS)) this.playerHitsPlayer(p, q, a);
      this.aoes.push({ id: this.id('a'), x: p.x, y: p.y, r: s.range, kind: 'swing', ang, arc: s.arc, until: this.time + 0.15 });
    } else if (s.type === 'aoe') {
      let cx = p.x;
      let cy = p.y;
      if (s.at === 'target') {
        const d = Math.min(s.range, Math.hypot(tx - p.x, ty - p.y));
        cx = p.x + Math.cos(ang) * d;
        cy = p.y + Math.sin(ang) * d;
      }
      const aoe = { id: this.id('a'), x: cx, y: cy, r: s.radius, kind: a.heal ? 'heal' : 'blast', ownerId: p.id, ability: id, fireAt: this.time + (s.delay || 0), until: this.time + (s.delay || 0) + 0.3, fired: false };
      this.aoes.push(aoe);
      if (!s.delay) this.fireAoe(aoe);
    } else if (s.type === 'dash') {
      const d = s.distance;
      p.x = clamp(p.x + Math.cos(ang) * d, 0, WORLD.width);
      p.y = clamp(p.y + Math.sin(ang) * d, 0, WORLD.height);
      if (a.iframes) p.iframesUntil = this.time + (id === 'dodge' ? p.stats.dodgeIframes : 0.3);
      this.updateZone(p);
    }
    if (a.buff) {
      const { id: bid, duration, ...rest } = a.buff;
      p.buffs = p.buffs.filter((b) => b.id !== bid);
      p.buffs.push({ id: bid, until: this.time + duration, ...rest });
    }
    // Non-damaging abilities train their skill on use.
    if (!a.damage && !a.heal) this.xp(p, a.skill, 8);
    p.dirty = true;
  }

  spawnProjectile({ x, y, ang, speed, range, radius, owner, ability, damage, pierce = 0 }) {
    this.projectiles.push({
      id: this.id('j'), x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      travelled: 0, range, radius, owner, ability, damage, pierce, hit: new Set(),
    });
  }

  fireAoe(aoe) {
    aoe.fired = true;
    const p = this.players.get(aoe.ownerId);
    if (!p) return;
    const a = ABILITIES[aoe.ability];
    const inR = (t, r = 0) => Math.hypot(t.x - aoe.x, t.y - aoe.y) <= aoe.r + r;
    for (const e of this.enemies.values()) {
      if (e.dead || !inR(e, e.radius)) continue;
      if (a.damage) this.playerHitsEnemy(p, e, a);
      if (a.taunt) e.threat.taunt(p.id, a.taunt.duration, this.time);
      if (a.threatDrop) e.threat.scale(p.id, 1 - a.threatDrop);
      if (a.debuff && !a.damage) this.applyDebuff(e, a.debuff);
    }
    for (const q of this.players.values()) {
      if (q.dead || !inR(q, PLAYER_RADIUS)) continue;
      if (a.heal) this.heal(p, q, a);
      else if (a.damage && q !== p) this.playerHitsPlayer(p, q, a);
    }
  }

  applyDebuff(t, d) {
    if (d.stun) t.stunUntil = Math.max(t.stunUntil, this.time + d.stun);
    if (d.slow) {
      t.slow = d.slow;
      t.slowUntil = this.time + (d.duration || 2);
    }
  }

  buffValue(p, key) {
    let v = 0;
    for (const b of p.buffs) if (b[key]) v += b[key];
    return v;
  }

  consumeBuff(p, key) {
    const b = p.buffs.find((x) => x[key]);
    if (b) p.buffs = p.buffs.filter((x) => x !== b);
    return b;
  }

  rawDamage(p, a) {
    const d = a.damage;
    let amt = d.base || 0;
    for (const [k, v] of Object.entries(d.scale || {})) amt += (p.rec.attrs[k] || 0) * v;
    if (d.weapon) amt += (p.weapon.power + scaledAttributeDamage(p.weapon.scaling, p.rec.attrs)) * d.weapon;
    amt *= 1 + this.buffValue(p, 'damageDealt');
    const rip = this.consumeBuff(p, 'nextHitBonus');
    if (rip) amt *= 1 + rip.nextHitBonus;
    let crit = this.rng() < p.stats.critChance;
    if (this.consumeBuff(p, 'nextHitCrit')) crit = true;
    if (crit) amt *= p.stats.critMult;
    return { amount: amt, crit };
  }

  markCombat(ent) {
    ent.combatUntil = this.time + COMBAT_TIMEOUT;
  }

  playerHitsEnemy(p, e, a) {
    const { amount, crit } = this.rawDamage(p, a);
    const armor = ENEMIES[e.type].armor || 0;
    const dmg = Math.max(1, Math.round(amount * (1 - armorReduction(armor))));
    e.hp -= dmg;
    e.damageBy.set(p.id, (e.damageBy.get(p.id) || 0) + dmg);
    const tm = (a.threatMult || 1) * p.stats.threatMult;
    e.threat.add(p.id, dmg * tm, this.time);
    if (a.debuff) this.applyDebuff(e, a.debuff);
    this.markCombat(p);
    if (p.weapon.mods.lifesteal) this.healRaw(p, dmg * p.weapon.mods.lifesteal);
    if (a.source === 'weapon' && p.rec.equipped) {
      const xp = addAffinity(p.rec.equipped, p.rec.name, 1);
      if (affinityLevel(xp) !== p.weapon.affinity) {
        this.recompute(p);
        this.msg(p, `Affinity with ${p.rec.equipped.name} is now ${p.weapon.affinity}.`, 'level');
      }
    }
    this.xp(p, a.skill, dmg * 0.6 * ENEMIES[e.type].tier);
    this.broadcastNear(e.x, e.y, { t: 'hit', x: e.x, y: e.y, amt: dmg, crit, target: e.id });
    if (e.hp <= 0) this.killEnemy(e);
  }

  pvpAllowed(a, b) {
    const za = this.zoneOf(a);
    const zb = this.zoneOf(b);
    return !za.safe && !zb.safe;
  }

  playerHitsPlayer(p, q, a) {
    if (!this.pvpAllowed(p, q)) return;
    const { amount, crit } = this.rawDamage(p, a);
    this.markCombat(p);
    const dealt = this.damagePlayer(q, amount, { by: p.rec.name, crit, pvp: true });
    if (dealt > 0) {
      if (p.weapon.mods.lifesteal) this.healRaw(p, dealt * p.weapon.mods.lifesteal);
      this.xp(p, a.skill, dealt * 0.5);
    }
  }

  damagePlayer(q, raw, { by, crit = false, ignoreArmor = false } = {}) {
    if (q.dead) return 0;
    if (this.time < q.iframesUntil) {
      this.broadcastNear(q.x, q.y, { t: 'hit', x: q.x, y: q.y, amt: 0, dodged: true, target: q.id });
      this.xp(q, 'athletics', 6);
      return 0;
    }
    const reduced = raw * Math.max(0.1, 1 + this.buffValue(q, 'damageTaken'));
    const dmg = mitigate(reduced, q.stats, { ignoreArmor });
    q.hp -= dmg;
    this.markCombat(q);
    if (q.channel) this.cancelChannel(q, 'Interrupted!');
    this.broadcastNear(q.x, q.y, { t: 'hit', x: q.x, y: q.y, amt: dmg, crit, target: q.id, onPlayer: true });
    if (q.hp <= 0) this.killPlayer(q, by);
    return dmg;
  }

  healRaw(p, amt) {
    p.hp = Math.min(p.stats.maxHealth, p.hp + amt);
  }

  heal(healer, q, a) {
    let amt = a.heal.base;
    for (const [k, v] of Object.entries(a.heal.scale || {})) amt += (healer.rec.attrs[k] || 0) * v;
    const before = q.hp;
    this.healRaw(q, amt);
    const healed = q.hp - before;
    if (healed <= 0) return;
    this.xp(healer, a.skill, healed * 0.4);
    this.broadcastNear(q.x, q.y, { t: 'hit', x: q.x, y: q.y, amt: Math.round(healed), heal: true, target: q.id });
    // Healing draws threat from everything already fighting the healed goblin.
    for (const e of this.enemies.values()) {
      if (!e.dead && e.threat.entries.has(q.id)) e.threat.add(healer.id, healed * 0.5 * healer.stats.threatMult, this.time);
    }
  }

  killEnemy(e) {
    const def = ENEMIES[e.type];
    e.dead = true;
    e.respawnAt = this.time + (def.respawn || 25);
    const zone = ZONES.find((z) => z.id === e.zoneId);
    // Credit: everyone who did at least 10% of the damage.
    const total = [...e.damageBy.values()].reduce((s, v) => s + v, 0);
    let topId = null;
    let topDmg = 0;
    for (const [pid, d] of e.damageBy) {
      if (d > topDmg) { topDmg = d; topId = pid; }
      const p = this.players.get(pid);
      if (!p || d < total * 0.1) continue;
      const w = killWisdom(def.tier, e.rank);
      p.rec.wisdom += w;
      if (!this.zoneOf(p).safe) p.ventureKills += 1;
      this.msg(p, `+${w} wisdom (${def.name}${e.rank !== 'normal' ? `, ${e.rank}` : ''})`, 'reward');
      p.dirty = true;
    }
    const killer = this.players.get(topId);
    const loot = rollLoot(this.rng, {
      zoneTier: zone.tier, rank: e.rank, dungeon: !!zone.dungeon,
      ventureKills: killer?.ventureKills || 0, table: { materials: def.materials },
    });
    this.dropBag(e.x, e.y, loot, topId, this.time + BAG_OWNER_WINDOW, this.time + 180);
    this.broadcastNear(e.x, e.y, { t: 'death', target: e.id });
  }

  dropBag(x, y, loot, owner, freeAt, expiresAt) {
    const stacks = {};
    for (const s of loot.stacks || []) stacks[s.key] = (stacks[s.key] || 0) + s.qty;
    for (const [k, v] of Object.entries(loot.stackMap || {})) stacks[k] = (stacks[k] || 0) + v;
    if (!loot.gold && !(loot.items || []).length && !Object.keys(stacks).length) return null;
    const id = this.id('b');
    const bag = { id, x, y, gold: loot.gold || 0, items: loot.items || [], stacks, owner, freeAt, expiresAt };
    this.bags.set(id, bag);
    return bag;
  }

  killPlayer(q, by) {
    q.dead = true;
    q.hp = 0;
    q.respawnAt = this.time + 5;
    q.channel = null;
    const z = this.zoneOf(q);
    for (const e of this.enemies.values()) e.threat.remove(q.id);
    const inv = q.rec.inventory;
    let lost = false;
    if (!z.safe && !z.arena) {
      // Full loot of what you carried. Equipped weapon stays with you.
      const bag = this.dropBag(q.x, q.y, { gold: inv.gold, items: inv.items, stackMap: inv.stacks }, null, this.time, this.time + PVP_DEATH_BAG_TTL);
      lost = !!bag;
      q.rec.inventory = { gold: 0, items: [], stacks: {} };
    }
    q.ventureKills = 0;
    this.broadcast({ t: 'chat', from: null, text: `${q.rec.name} was slain by ${by || 'something'}${z.arena ? ' in the arena' : ''}.` });
    this.msg(q, lost ? 'You died. Everything you carried is in a bag where you fell.' : 'You died.', 'warn');
    q.dirty = true;
  }

  respawn(p) {
    p.dead = false;
    p.x = TOWN_SPAWN.x + (this.rng() - 0.5) * 60;
    p.y = TOWN_SPAWN.y + (this.rng() - 0.5) * 60;
    p.hp = Math.round(p.stats.maxHealth * 0.5);
    p.mana = Math.round(p.stats.maxMana * 0.5);
    p.stamina = p.stats.maxStamina;
    p.buffs = [];
    this.updateZone(p);
  }

  // ---------------------------------------------------------------- utility

  utility(p, id) {
    if (p.dead) return;
    if (id === 'interact') return this.interact(p);
    if (id === 'potion') return this.drinkPotion(p);
    if (id === 'bank') return this.bankAll(p);
    if (id === 'recall') {
      if (this.zoneOf(p).safe) return this.msg(p, "You're already home.");
      if (this.inCombat(p)) return this.msg(p, "Can't recall in combat.", 'warn');
      p.channel = { kind: 'recall', until: this.time + RECALL_TIME, total: RECALL_TIME };
      this.msg(p, 'Recalling... hold still.');
    }
  }

  cancelChannel(p, why) {
    p.channel = null;
    this.msg(p, why, 'warn');
  }

  drinkPotion(p) {
    if (this.time < p.potionReadyAt) return this.msg(p, 'Still burping from the last one.', 'warn');
    const stacks = p.rec.inventory.stacks;
    const key = ['potion_t3', 'potion_t2', 'potion_t1'].find((k) => stacks[k] > 0);
    if (!key) return this.msg(p, 'No grog.', 'warn');
    stacks[key] -= 1;
    if (!stacks[key]) delete stacks[key];
    this.healRaw(p, potionHeal(+key.slice(-1)));
    p.potionReadyAt = this.time + POTION_CD;
    p.dirty = true;
  }

  interact(p) {
    let best = null;
    let bestD = 60;
    for (const b of this.bags.values()) {
      const d = dist(p, b);
      if (d < bestD) { best = { kind: 'bag', ref: b }; bestD = d; }
    }
    if (!best) {
      for (const n of this.nodes.values()) {
        const d = dist(p, n);
        if (d < bestD && n.readyAt <= this.time) { best = { kind: 'node', ref: n }; bestD = d; }
      }
    }
    if (!best) return this.msg(p, 'Nothing to interact with here.');
    if (best.kind === 'bag') this.lootBag(p, best.ref);
    else this.gather(p, best.ref);
  }

  lootBag(p, bag) {
    if (bag.owner && bag.owner !== p.id && this.time < bag.freeAt) return this.msg(p, 'Not yours (yet).', 'warn');
    const inv = p.rec.inventory;
    inv.gold += bag.gold;
    const got = [];
    if (bag.gold) got.push(`${bag.gold}g`);
    bag.gold = 0;
    for (const [k, v] of Object.entries(bag.stacks)) {
      inv.stacks[k] = (inv.stacks[k] || 0) + v;
      got.push(`${v}x ${k}`);
    }
    bag.stacks = {};
    const left = [];
    for (const it of bag.items) {
      if (inv.items.length >= MAX_INVENTORY_ITEMS) left.push(it);
      else {
        inv.items.push(it);
        got.push(it.name);
      }
    }
    bag.items = left;
    if (!left.length) this.bags.delete(bag.id);
    else this.msg(p, 'Inventory full; some items left in the bag.', 'warn');
    if (got.length) this.msg(p, `Looted: ${got.join(', ')}`, 'reward');
    p.dirty = true;
  }

  gather(p, n) {
    const lvl = skillLevel(p.rec.skills, n.skill);
    if (lvl < n.level) return this.msg(p, `Need ${SKILLS[n.skill].label} ${n.level}.`, 'warn');
    const qty = 1 + (this.rng() < (lvl - n.level) / 120 ? 1 : 0);
    const st = p.rec.inventory.stacks;
    st[n.key] = (st[n.key] || 0) + qty;
    n.readyAt = this.time + 30;
    this.xp(p, n.skill, Math.round(25 * Math.pow(n.tier, 1.6)));
    this.msg(p, `Gathered ${qty}x ${n.key}.`, 'reward');
    p.dirty = true;
  }

  requireTown(p) {
    if (this.zoneOf(p).id !== 'warren') {
      this.msg(p, 'You need to be in the Goblin Warren for that.', 'warn');
      return false;
    }
    return true;
  }

  bankAll(p) {
    if (!this.requireTown(p)) return;
    const inv = p.rec.inventory;
    const bank = p.rec.bank;
    bank.gold += inv.gold;
    bank.items.push(...inv.items);
    for (const [k, v] of Object.entries(inv.stacks)) {
      if (k.startsWith('potion')) continue; // keep consumables on you
      bank.stacks[k] = (bank.stacks[k] || 0) + v;
      delete inv.stacks[k];
    }
    inv.gold = 0;
    inv.items = [];
    if (p.ventureKills) this.msg(p, `Banked. Venture streak of ${p.ventureKills} reset.`, 'info');
    else this.msg(p, 'Banked.');
    p.ventureKills = 0;
    p.dirty = true;
  }

  withdraw(p, { uid, key, qty, gold }) {
    if (!this.requireTown(p)) return;
    const { bank, inventory: inv } = p.rec;
    if (uid) {
      const i = bank.items.findIndex((x) => x.uid === uid);
      if (i < 0 || inv.items.length >= MAX_INVENTORY_ITEMS) return;
      inv.items.push(bank.items.splice(i, 1)[0]);
    } else if (key) {
      const n = Math.min(bank.stacks[key] || 0, Math.max(1, qty | 0));
      if (!n) return;
      bank.stacks[key] -= n;
      if (!bank.stacks[key]) delete bank.stacks[key];
      inv.stacks[key] = (inv.stacks[key] || 0) + n;
    } else if (gold) {
      const g = Math.min(bank.gold, Math.max(0, gold | 0));
      bank.gold -= g;
      inv.gold += g;
    }
    p.dirty = true;
  }

  findItem(p, uid) {
    const rec = p.rec;
    if (rec.equipped?.uid === uid) return { item: rec.equipped, where: 'equipped' };
    for (const where of ['inventory', 'bank']) {
      const item = rec[where].items.find((x) => x.uid === uid);
      if (item) return { item, where };
    }
    return null;
  }

  equip(p, uid) {
    const inv = p.rec.inventory;
    const i = inv.items.findIndex((x) => x.uid === uid && x.kind === 'weapon');
    if (i < 0) return;
    const item = inv.items.splice(i, 1)[0];
    if (p.rec.equipped) inv.items.push(p.rec.equipped);
    p.rec.equipped = item;
    this.recompute(p);
  }

  unequip(p) {
    const inv = p.rec.inventory;
    if (!p.rec.equipped || inv.items.length >= MAX_INVENTORY_ITEMS) return;
    inv.items.push(p.rec.equipped);
    p.rec.equipped = null;
    this.recompute(p);
  }

  // Take stacks from inventory first, then bank. Returns false if short.
  takeStacks(p, needs) {
    const { inventory: inv, bank } = p.rec;
    for (const [k, n] of Object.entries(needs)) {
      if ((inv.stacks[k] || 0) + (bank.stacks[k] || 0) < n) return false;
    }
    for (const [k, n] of Object.entries(needs)) {
      let left = n;
      for (const src of [inv.stacks, bank.stacks]) {
        const t = Math.min(left, src[k] || 0);
        src[k] = (src[k] || 0) - t;
        if (!src[k]) delete src[k];
        left -= t;
      }
    }
    return true;
  }

  upgrade(p, uid) {
    if (!this.requireTown(p)) return;
    const found = this.findItem(p, uid);
    if (!found) return;
    const { item } = found;
    const { inventory: inv, bank } = p.rec;
    const tomeKey = [1, 2, 3, 4, 5].map((t) => `tome_t${t}`).find((k) => +k.slice(-1) >= item.tier && ((inv.stacks[k] || 0) + (bank.stacks[k] || 0)) > 0);
    if (!tomeKey) return this.msg(p, `Need a tier ${item.tier}+ upgrade tome.`, 'warn');
    const res = attemptUpgrade(item, makeStack(tomeKey), this.rng);
    if (!res.ok) return this.msg(p, res.reason, 'warn');
    this.takeStacks(p, { [tomeKey]: 1 });
    const pct = Math.round(res.chance * 100);
    if (res.success) this.msg(p, `Success (${pct}%)! ${item.name} is now +${item.upgrade}.`, 'reward');
    else this.msg(p, `Failed (${pct}%). Failstacks: ${res.failstacks}. Next try is better.`, 'warn');
    if (found.where === 'equipped') this.recompute(p);
    p.dirty = true;
  }

  craft(p, recipeId, weaponType) {
    if (!this.requireTown(p)) return;
    const r = RECIPES[recipeId];
    if (!r) return;
    const lvl = skillLevel(p.rec.skills, r.skill);
    if (lvl < r.level) return this.msg(p, `Need ${SKILLS[r.skill].label} ${r.level}.`, 'warn');
    if (r.output.weapon && p.rec.inventory.items.length >= MAX_INVENTORY_ITEMS) return this.msg(p, 'Inventory full.', 'warn');
    if (!this.takeStacks(p, r.inputs)) return this.msg(p, 'Missing materials.', 'warn');
    if (r.output.weapon) {
      const rarity = craftedRarity(this.rng, lvl, r.level);
      const type = ['sword', 'dagger', 'staff', 'bow', 'maul'].includes(weaponType) ? weaponType : 'sword';
      const w = rollWeapon(this.rng, { tier: r.output.weapon, rarity, type });
      w.crafter = p.rec.name;
      p.rec.inventory.items.push(w);
      this.msg(p, `Crafted ${w.name}.`, 'reward');
    } else {
      const st = p.rec.inventory.stacks;
      st[r.output.stack] = (st[r.output.stack] || 0) + r.output.qty;
      this.msg(p, `Crafted ${r.output.qty}x ${r.output.stack}.`, 'reward');
    }
    this.xp(p, r.skill, r.xp);
    p.dirty = true;
  }

  // ---------------------------------------------------------------- market

  // The market trades out of your bank, like the GE trades out of its own
  // collection box. Fills land in the bank, so offline sellers get paid.
  marketOp(p, m) {
    if (!this.requireTown(p)) return;
    const bank = p.rec.bank;
    const owner = p.rec.name;
    try {
      if (m.op === 'cancel') {
        const o = this.market.cancel(m.id | 0, owner);
        if (!o) return;
        if (o.side === 'buy') bank.gold += o.remaining * o.price;
        else bank.stacks[o.key] = (bank.stacks[o.key] || 0) + o.remaining;
        this.msg(p, 'Order cancelled.');
      } else if (m.op === 'buy' || m.op === 'sell') {
        const price = m.price | 0;
        const qty = m.qty | 0;
        const key = String(m.key);
        makeStack(key); // validates key
        if (m.op === 'buy') {
          if (bank.gold < price * qty) return this.msg(p, 'Not enough gold in the bank.', 'warn');
          bank.gold -= price * qty;
        } else {
          if ((bank.stacks[key] || 0) < qty) return this.msg(p, 'Not enough of that in the bank.', 'warn');
          bank.stacks[key] -= qty;
          if (!bank.stacks[key]) delete bank.stacks[key];
        }
        const { fills } = this.market.place({ side: m.op, owner, key, price, qty });
        for (const f of fills) this.settle(f);
        this.msg(p, fills.length ? `Order placed; ${fills.reduce((s, f) => s + f.qty, 0)} filled immediately.` : 'Order placed.');
      }
    } catch (err) {
      this.msg(p, `Market: ${err.message}`, 'warn');
    }
    this.store?.saveMeta('market', this.market.toJSON());
    p.dirty = true;
  }

  recordFor(name) {
    for (const p of this.players.values()) if (p.rec.name === name) return { rec: p.rec, p };
    const rec = this.store?.get(name);
    return rec ? { rec, p: null } : null;
  }

  settle(f) {
    const buyer = this.recordFor(f.buyer);
    const seller = this.recordFor(f.seller);
    if (buyer) {
      buyer.rec.bank.stacks[f.key] = (buyer.rec.bank.stacks[f.key] || 0) + f.qty;
      buyer.rec.bank.gold += f.buyerRefundPerUnit * f.qty;
      if (buyer.p) {
        buyer.p.dirty = true;
        this.msg(buyer.p, `Bought ${f.qty}x ${f.key} @ ${f.price}g.`, 'reward');
      }
    }
    if (seller) {
      seller.rec.bank.gold += f.sellerProceeds;
      if (seller.p) {
        seller.p.dirty = true;
        this.msg(seller.p, `Sold ${f.qty}x ${f.key} @ ${f.price}g (after tax ${f.sellerProceeds}g).`, 'reward');
      }
    }
  }

  // ---------------------------------------------------------------- tick

  tick(dt) {
    this.time += dt;
    const now = this.time;

    for (const p of this.players.values()) {
      p.chatTokens = Math.min(5, p.chatTokens + dt * 0.5);
      if (p.dead) {
        if (now >= p.respawnAt) this.respawn(p);
        continue;
      }
      p.buffs = p.buffs.filter((b) => b.until > now);
      const combat = this.inCombat(p);
      const ooc = combat ? 1 : 3;
      p.hp = Math.min(p.stats.maxHealth, p.hp + p.stats.healthRegen * ooc * dt);
      p.mana = Math.min(p.stats.maxMana, p.mana + p.stats.manaRegen * dt * (combat ? 1 : 2));
      p.stamina = Math.min(p.stats.maxStamina, p.stamina + p.stats.staminaRegen * dt);

      if (now >= p.stunUntil && !p.channel) {
        let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
        let dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
        if (dx || dy) {
          const len = Math.hypot(dx, dy);
          const sp = p.stats.moveSpeed * (now < p.slowUntil ? 1 - p.slow : 1);
          p.x = clamp(p.x + (dx / len) * sp * dt, 0, WORLD.width);
          p.y = clamp(p.y + (dy / len) * sp * dt, 0, WORLD.height);
          p.walked = (p.walked || 0) + sp * dt;
          if (p.walked > 600) {
            p.walked = 0;
            this.xp(p, 'athletics', 2);
          }
        }
      }
      if (p.channel && now >= p.channel.until) {
        p.channel = null;
        p.x = TOWN_SPAWN.x;
        p.y = TOWN_SPAWN.y;
        this.msg(p, 'Home again.');
      }
      this.updateZone(p);
    }

    this.tickEnemies(dt, now);
    this.tickProjectiles(dt);

    for (const a of this.aoes) if (!a.fired && a.fireAt !== undefined && now >= a.fireAt) this.fireAoe(a);
    this.aoes = this.aoes.filter((a) => a.until > now);

    for (const [id, b] of this.bags) if (now > b.expiresAt) this.bags.delete(id);

    this.sendSnapshots();
  }

  tickEnemies(dt, now) {
    for (const e of this.enemies.values()) {
      if (e.dead) {
        if (now >= e.respawnAt) this.spawnEnemy(e.type, e.zoneId, e);
        continue;
      }
      const def = ENEMIES[e.type];
      // Drop players who left, died, or went home.
      for (const pid of [...e.threat.entries.keys()]) {
        const p = this.players.get(pid);
        if (!p || p.dead || this.zoneOf(p).safe || dist(p, e) > LEASH * 1.5) e.threat.remove(pid);
      }
      e.threat.decay(dt, now);

      if (e.threat.size === 0) {
        let closest = null;
        let cd = def.aggro;
        for (const p of this.players.values()) {
          if (p.dead || this.zoneOf(p).safe) continue;
          const d = dist(p, e);
          if (d < cd) { cd = d; closest = p; }
        }
        if (closest) e.threat.add(closest.id, 1, now);
      }

      const stunned = now < e.stunUntil;
      const speed = def.speed * (now < e.slowUntil ? 1 - e.slow : 1);
      const targetId = e.threat.size ? e.threat.pickTarget(now, (id) => {
        const p = this.players.get(id);
        return p && dist(p, e) <= def.attack.range + 40;
      }) : null;
      const target = targetId && this.players.get(targetId);

      if (e.state === 'windup') {
        if (now >= e.windupUntil) this.enemyStrike(e, def);
        continue;
      }
      if (stunned) continue;

      if (!target) {
        // Return home, then wander.
        const home = e.home;
        if (dist(e, home) > 30 && e.state === 'return') this.moveToward(e, home, speed * 1.4, dt);
        else {
          if (e.state === 'return') {
            e.hp = e.maxHp;
            e.damageBy.clear();
          }
          e.state = 'idle';
          if (!e.wanderTarget || dist(e, e.wanderTarget) < 8 || this.rng() < 0.002) {
            e.wanderTarget = { x: home.x + (this.rng() - 0.5) * 160, y: home.y + (this.rng() - 0.5) * 160 };
          }
          this.moveToward(e, e.wanderTarget, speed * 0.3, dt);
        }
        continue;
      }

      if (dist(e, e.home) > LEASH) {
        e.threat.clear();
        e.state = 'return';
        continue;
      }

      e.state = 'chase';
      const d = dist(e, target);
      const ranged = def.attack.kind === 'ranged';
      const want = ranged ? def.attack.range * 0.75 : def.attack.range * 0.8;
      if (d > want) this.moveToward(e, target, speed, dt);
      if (d <= def.attack.range + PLAYER_RADIUS && now >= e.attackReadyAt) {
        e.state = 'windup';
        e.windupUntil = now + def.attack.windup;
        e.aim = { x: target.x, y: target.y };
        e.attackReadyAt = now + def.attack.cooldown;
      }
    }
  }

  moveToward(e, t, speed, dt) {
    const d = dist(e, t);
    if (d < 1) return;
    const step = Math.min(d, speed * dt);
    const nx = e.x + ((t.x - e.x) / d) * step;
    const ny = e.y + ((t.y - e.y) / d) * step;
    if (zoneAt(nx, ny).safe) return; // monsters don't come into town
    e.x = nx;
    e.y = ny;
  }

  enemyStrike(e, def) {
    e.state = 'chase';
    const atk = def.attack;
    const dmg = atk.damage * e.damageMult;
    const ang = Math.atan2(e.aim.y - e.y, e.aim.x - e.x);
    const name = ENEMIES[e.type].name;
    if (atk.kind === 'ranged') {
      this.spawnProjectile({ x: e.x, y: e.y, ang, speed: atk.speed, range: atk.range * 1.2, radius: 8, owner: { kind: 'enemy', id: e.id, name }, damage: dmg });
    } else if (atk.kind === 'melee') {
      for (const p of this.players.values()) {
        if (p.dead) continue;
        const pd = dist(p, e);
        if (pd <= atk.range + PLAYER_RADIUS + e.radius && angleDiff(Math.atan2(p.y - e.y, p.x - e.x), ang) < 1.0) {
          this.damagePlayer(p, dmg, { by: name });
        }
      }
      this.aoes.push({ id: this.id('a'), x: e.x, y: e.y, r: atk.range + e.radius, kind: 'eswing', ang, arc: 114, until: this.time + 0.15 });
    } else if (atk.kind === 'slam') {
      const cx = e.x + Math.cos(ang) * atk.range * 0.5;
      const cy = e.y + Math.sin(ang) * atk.range * 0.5;
      const r = atk.range * 0.75;
      for (const p of this.players.values()) {
        if (!p.dead && Math.hypot(p.x - cx, p.y - cy) <= r + PLAYER_RADIUS) this.damagePlayer(p, dmg, { by: name });
      }
      this.aoes.push({ id: this.id('a'), x: cx, y: cy, r, kind: 'eslam', until: this.time + 0.25 });
    }
  }

  tickProjectiles(dt) {
    const keep = [];
    for (const j of this.projectiles) {
      const step = Math.hypot(j.vx, j.vy) * dt;
      j.x += j.vx * dt;
      j.y += j.vy * dt;
      j.travelled += step;
      let alive = j.travelled < j.range && j.x >= 0 && j.y >= 0 && j.x <= WORLD.width && j.y <= WORLD.height;
      if (alive && j.owner.kind === 'player') {
        const p = this.players.get(j.owner.id);
        if (!p) alive = false;
        else {
          const a = ABILITIES[j.ability];
          for (const e of this.enemies.values()) {
            if (!alive) break;
            if (e.dead || j.hit.has(e.id) || Math.hypot(e.x - j.x, e.y - j.y) > e.radius + j.radius) continue;
            j.hit.add(e.id);
            this.playerHitsEnemy(p, e, a);
            if (j.pierce-- <= 0) alive = false;
          }
          for (const q of this.players.values()) {
            if (!alive) break;
            if (q === p || q.dead || j.hit.has(q.id) || Math.hypot(q.x - j.x, q.y - j.y) > PLAYER_RADIUS + j.radius) continue;
            if (!this.pvpAllowed(p, q)) continue;
            j.hit.add(q.id);
            this.playerHitsPlayer(p, q, a);
            if (j.pierce-- <= 0) alive = false;
          }
        }
      } else if (alive && j.owner.kind === 'enemy') {
        for (const q of this.players.values()) {
          if (q.dead || Math.hypot(q.x - j.x, q.y - j.y) > PLAYER_RADIUS + j.radius) continue;
          if (this.zoneOf(q).safe) continue;
          this.damagePlayer(q, j.damage, { by: j.owner.name });
          alive = false;
          break;
        }
      }
      if (alive) keep.push(j);
    }
    this.projectiles = keep;
  }

  // ---------------------------------------------------------------- network

  privateState(p) {
    const rec = p.rec;
    return {
      t: 'self',
      id: p.id,
      name: rec.name,
      attrs: rec.attrs,
      wisdom: rec.wisdom,
      skills: Object.fromEntries(Object.entries(rec.skills).map(([k, v]) => [k, { xp: Math.floor(v.xp), lock: v.lock, level: skillLevel(rec.skills, k) }])),
      inventory: rec.inventory,
      bank: rec.bank,
      equipped: rec.equipped,
      hotbars: rec.hotbars,
      abilities: [...p.abilities],
      stats: p.stats,
      weapon: { power: Math.round(p.weapon.power * 10) / 10, mastery: p.weapon.mastery, affinity: p.weapon.affinity, unlockScore: p.weapon.unlockScore, mods: p.weapon.mods },
      power: p.power,
      discovered: rec.discovered,
      orders: this.market.ordersFor(rec.name),
      market: this.market.summary(),
    };
  }

  sendSnapshots() {
    const now = this.time;
    for (const p of this.players.values()) {
      if (p.dirty) {
        p.send(this.privateState(p));
        p.dirty = false;
      }
      const near = (o) => Math.abs(o.x - p.x) < INTEREST_RADIUS && Math.abs(o.y - p.y) < INTEREST_RADIUS;
      const r1 = (v) => Math.round(v);
      p.send({
        t: 'snap',
        time: now,
        me: {
          x: p.x, y: p.y, hp: p.hp, mana: p.mana, stamina: p.stamina,
          maxHp: p.stats.maxHealth, maxMana: p.stats.maxMana, maxStamina: p.stats.maxStamina,
          dead: p.dead, respawnIn: p.dead ? Math.max(0, p.respawnAt - now) : 0,
          inCombat: this.inCombat(p), venture: p.ventureKills,
          cooldowns: Object.fromEntries(Object.entries(p.cooldowns).filter(([, t]) => t > now).map(([k, t]) => [k, t - now])),
          potionCd: Math.max(0, p.potionReadyAt - now),
          buffs: p.buffs.map((b) => ({ id: b.id, left: b.until - now })),
          channel: p.channel ? { kind: p.channel.kind, left: p.channel.until - now, total: p.channel.total } : null,
          iframes: now < p.iframesUntil,
        },
        players: [...this.players.values()].filter((q) => near(q)).map((q) => ({
          id: q.id, name: q.rec.name, x: r1(q.x), y: r1(q.y), aim: q.aim, hp: Math.round(q.hp), maxHp: q.stats.maxHealth,
          dead: q.dead, weapon: q.rec.equipped?.type || null, iframes: now < q.iframesUntil,
        })),
        enemies: [...this.enemies.values()].filter((e) => !e.dead && near(e)).map((e) => ({
          id: e.id, type: e.type, x: r1(e.x), y: r1(e.y), hp: Math.round(e.hp), maxHp: e.maxHp, rank: e.rank, r: e.radius,
          state: e.state, windup: e.state === 'windup' ? { left: e.windupUntil - now, total: ENEMIES[e.type].attack.windup, ax: e.aim.x, ay: e.aim.y } : null,
          target: e.threat.target,
        })),
        projectiles: this.projectiles.filter(near).map((j) => ({ x: r1(j.x), y: r1(j.y), r: j.radius, enemy: j.owner.kind === 'enemy', ability: j.ability })),
        aoes: this.aoes.filter(near).map((a) => ({ x: r1(a.x), y: r1(a.y), r: a.r, kind: a.kind, ang: a.ang, arc: a.arc, pending: a.fired === false, left: a.until - now })),
        bags: [...this.bags.values()].filter(near).map((b) => ({ id: b.id, x: r1(b.x), y: r1(b.y), mine: !b.owner || b.owner === p.id || now >= b.freeAt })),
        nodes: [...this.nodes.values()].filter(near).map((n) => ({ id: n.id, x: n.x, y: n.y, skill: n.skill, key: n.key, level: n.level, ready: n.readyAt <= now })),
      });
    }
  }

  save() {
    for (const p of this.players.values()) {
      p.rec.x = p.x;
      p.rec.y = p.y;
    }
    this.store?.saveAll();
    this.store?.saveMeta('market', this.market.toJSON());
  }
}
