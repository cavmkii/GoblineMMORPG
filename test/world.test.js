import test from 'node:test';
import assert from 'node:assert/strict';
import { World, newPlayerRecord } from '../server/world.js';

function fakeStore() {
  const recs = new Map();
  return {
    get: (n) => recs.get(n.toLowerCase()) || null,
    put: (r) => recs.set(r.name.toLowerCase(), r),
    saveAll() {},
    loadMeta: () => null,
    saveMeta() {},
    recs,
  };
}

function setup() {
  const store = fakeStore();
  const world = new World({ store, seed: 123 });
  const inbox = [];
  const { player } = world.join('Snik', (m) => inbox.push(m));
  return { world, store, player, inbox };
}

function clearArea(world, x, y, r = 800) {
  for (const e of world.enemies.values()) if (Math.hypot(e.x - x, e.y - y) < r) world.enemies.delete(e.id);
}

test('melee ability damages and builds threat, kill drops a bag and wisdom', () => {
  const { world, player } = setup();
  player.x = 1000; player.y = 1000; // Mossy Hollows
  clearArea(world, 1000, 1000);
  const e = world.spawnEnemy('mossback', 'hollows');
  Object.assign(e, { x: 1030, y: 1000, home: { x: 1030, y: 1000 }, hp: 5, maxHp: 5 });
  // Equip the starter sword for Slash.
  world.equip(player, player.rec.inventory.items[0].uid);
  assert.ok(player.abilities.has('slash'));
  const wisdom = player.rec.wisdom;
  world.cast(player, 'slash', 1030, 1000);
  assert.ok(e.dead, 'enemy should die');
  assert.ok(player.rec.wisdom > wisdom);
  assert.equal(player.ventureKills, 1);
  assert.ok(player.rec.equipped.affinity.Snik >= 1);
  assert.ok(player.rec.skills.sword.xp > 0);
});

test('threat: a taunting tank pulls the enemy off the damage dealer', () => {
  const { world, player: dps } = setup();
  const { player: tank } = world.join('Grub', () => {});
  clearArea(world, 1000, 1000);
  dps.x = 1000; dps.y = 1000; tank.x = 1010; tank.y = 1000;
  tank.rec.attrs.str = 12;
  world.recompute(tank);
  const e = world.spawnEnemy('mossback', 'hollows');
  Object.assign(e, { x: 1040, y: 1000, home: { x: 1040, y: 1000 }, hp: 10_000, maxHp: 10_000 });
  e.threat.add(dps.id, 200, world.time);
  world.tick(0.05);
  assert.equal(e.threat.target, dps.id);
  world.cast(tank, 'war_cry', 1040, 1000);
  world.tick(0.05);
  assert.equal(e.threat.target, tank.id);
});

test('dying in the wild drops everything carried; equipped weapon stays', () => {
  const { world, player } = setup();
  clearArea(world, 1000, 1000);
  player.x = 1000; player.y = 1000;
  player.rec.inventory.gold = 77;
  const equipped = player.rec.equipped.uid;
  world.damagePlayer(player, 1e6, { by: 'test' });
  assert.ok(player.dead);
  assert.equal(player.rec.inventory.gold, 0);
  assert.equal(player.rec.equipped.uid, equipped);
  const bag = [...world.bags.values()].find((b) => b.gold === 77);
  assert.ok(bag, 'bag with carried gold exists');
  assert.equal(bag.owner, null, 'anyone can loot a death bag');
});

test('dying in the arena costs nothing', () => {
  const { world, player } = setup();
  player.x = 2450; player.y = 1450;
  player.rec.inventory.gold = 50;
  world.damagePlayer(player, 1e6, { by: 'test' });
  assert.equal(player.rec.inventory.gold, 50);
});

test('no PvP damage in the safe zone, PvP allowed outside', () => {
  const { world, player: a } = setup();
  const { player: b } = world.join('Zug', () => {});
  a.rec.attrs.int = 10; world.recompute(a);
  a.x = 2000; a.y = 1500; b.x = 2030; b.y = 1500;
  const hp = b.hp;
  world.cast(a, 'punch', 2030, 1500);
  assert.equal(b.hp, hp);
  clearArea(world, 1000, 1000);
  a.x = 1000; a.y = 1000; b.x = 1030; b.y = 1000;
  world.time += 1; // punch cooldown
  world.cast(a, 'punch', 1030, 1000);
  assert.ok(b.hp < hp);
});

test('iframes from tumble avoid damage', () => {
  const { world, player } = setup();
  clearArea(world, 1000, 1000);
  player.x = 1000; player.y = 1000;
  world.cast(player, 'dodge', 1100, 1000);
  const hp = player.hp;
  world.damagePlayer(player, 50, { by: 'test' });
  assert.equal(player.hp, hp);
});

test('banking resets the venture streak; market settles into banks, even offline', () => {
  const { world, store, player } = setup();
  player.ventureKills = 9;
  player.rec.inventory.stacks.ore_t1 = 10;
  world.bankAll(player);
  assert.equal(player.ventureKills, 0);
  assert.equal(player.rec.bank.stacks.ore_t1, 10);

  const buyer = newPlayerRecord('Offline');
  buyer.bank.gold = 1000;
  store.put(buyer);
  world.market.place({ side: 'buy', owner: 'Offline', key: 'ore_t1', price: 20, qty: 5 });
  buyer.bank.gold -= 100; // escrow the server would have taken
  world.marketOp(player, { op: 'sell', key: 'ore_t1', price: 15, qty: 5 });
  assert.equal(buyer.bank.stacks.ore_t1, 5);
  assert.equal(player.rec.bank.stacks.ore_t1, 5);
  assert.equal(player.rec.bank.gold, 20 + 98, 'starting 20g banked, plus 5 x 20 minus 2% tax');
});

test('health-cost ability spends HP and respects the floor', () => {
  const { world, player } = setup();
  clearArea(world, 1000, 1000);
  player.x = 1000; player.y = 1000;
  Object.assign(player.rec.attrs, { str: 10, int: 10 });
  world.recompute(player);
  player.hp = 100;
  world.cast(player, 'blood_bolt', 1200, 1000);
  assert.equal(player.hp, 86);
  assert.equal(world.projectiles.length, 1);
});

test('trade cap: crafting at cap tells the player instead of silently failing', () => {
  const { world, player, inbox } = setup();
  player.x = 2000; player.y = 1500;
  const s = player.rec.skills;
  s.mining.xp = 13034431; s.smithing.xp = 13034431; s.foraging.xp = 13034431;
  s.alchemy.xp = 0;
  player.rec.inventory.stacks.herb_t1 = 2;
  world.craft(player, 'potion_t1');
  assert.equal(player.rec.inventory.stacks.potion_t1, 5);
  assert.ok(inbox.some((m) => m.t === 'msg' && /cap/.test(m.text)));
});

test('enemy AI aggroes, telegraphs, and hits a goblin who stands still', () => {
  const { world, player } = setup();
  clearArea(world, 1000, 1000);
  player.x = 1000; player.y = 1000;
  const e = world.spawnEnemy('mossback', 'hollows');
  Object.assign(e, { x: 1100, y: 1000, home: { x: 1100, y: 1000 } });
  const hp = player.hp;
  let sawWindup = false;
  for (let i = 0; i < 80; i++) {
    world.tick(0.05);
    if (e.state === 'windup') sawWindup = true;
  }
  assert.equal(e.threat.target, player.id);
  assert.ok(sawWindup, 'attack was telegraphed');
  assert.ok(player.hp < hp, 'goblin took damage');
});

test('enemies leash home and reset when kited too far', () => {
  const { world, player } = setup();
  clearArea(world, 1000, 1000, 1500);
  const e = world.spawnEnemy('mossback', 'hollows');
  Object.assign(e, { x: 1000, y: 1000, home: { x: 1000, y: 1000 }, hp: 10 });
  e.threat.add(player.id, 50, world.time);
  player.x = 1000; player.y = 1000 + 700;
  e.y = 1000 + 660; // dragged past LEASH
  world.tick(0.05);
  assert.equal(e.state, 'return');
  for (let i = 0; i < 200; i++) { player.x = 2000; player.y = 1500; world.tick(0.05); }
  assert.equal(e.hp, e.maxHp, 'healed on reset');
});
