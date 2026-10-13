import test from 'node:test';
import assert from 'node:assert/strict';
import { availableAbilities, resolveCost, canAfford, ABILITIES } from '../shared/abilities.js';
import { spendWisdom, respec, attributePointCost } from '../shared/progression.js';
import { BASE_ATTRIBUTES, ATTRIBUTE_TOTAL_CAP } from '../shared/stats.js';
import { rollLoot, rollRarity } from '../shared/loot.js';
import { makeRng } from '../shared/rng.js';
import { zoneAt, zoneWarning } from '../shared/zones.js';

test('hybrid abilities need both attributes', () => {
  const caster = availableAbilities({ str: 5, agi: 5, int: 12 }, null);
  assert.ok(caster.includes('arcane_bolt'));
  assert.ok(!caster.includes('shadowstep'));
  const dexMage = availableAbilities({ str: 5, agi: 12, int: 10 }, null);
  assert.ok(dexMage.includes('shadowstep') && dexMage.includes('arcane_volley'));
});

test('weapon abilities follow the unlock score', () => {
  const low = availableAbilities(BASE_ATTRIBUTES, { type: 'maul', unlockScore: 3 });
  const high = availableAbilities(BASE_ATTRIBUTES, { type: 'maul', unlockScore: 18 });
  assert.ok(low.includes('smash') && !low.includes('ground_slam'));
  assert.ok(high.includes('stubborn'));
  assert.ok(!high.includes('slash'));
});

test('health costs can never kill you', () => {
  const cost = resolveCost(ABILITIES.blood_bolt, { maxHealth: 200, health: 14 });
  assert.equal(canAfford(cost, { mana: 0, stamina: 0, health: 14 }), false);
  assert.equal(canAfford(cost, { mana: 0, stamina: 0, health: 15 }), true);
});

test('wisdom costs scale and the total cap holds', () => {
  const p = { attrs: { ...BASE_ATTRIBUTES }, wisdom: 10_000 };
  assert.equal(attributePointCost(5), 1);
  assert.equal(attributePointCost(16), 3);
  while (spendWisdom(p, 'str').ok);
  const total = p.attrs.str + p.attrs.agi + p.attrs.int;
  assert.equal(total, ATTRIBUTE_TOTAL_CAP);
  const r = respec(p, BASE_ATTRIBUTES);
  assert.ok(r.lost > 0 && r.refunded > r.lost);
});

test('venture streak shifts rarity upward', () => {
  const count = (bonus) => {
    const rng = makeRng(42);
    let good = 0;
    for (let i = 0; i < 5000; i++) if (['epic', 'legendary'].includes(rollRarity(rng, 'elite', bonus))) good++;
    return good;
  };
  assert.ok(count(0.5) > count(0) * 1.5);
});

test('dungeon bosses drop dungeon-only items', () => {
  const loot = rollLoot(makeRng(7), { zoneTier: 3, rank: 'boss', dungeon: true });
  assert.ok(loot.items.some((i) => i.dungeon));
  const field = rollLoot(makeRng(7), { zoneTier: 3, rank: 'boss', dungeon: false });
  assert.ok(!field.items.some((i) => i.dungeon));
});

test('zones: small regions win, warnings scale', () => {
  assert.equal(zoneAt(2000, 1500).id, 'warren');
  assert.equal(zoneAt(3500, 2500).id, 'rotfang');
  assert.equal(zoneAt(1000, 800).id, 'hollows');
  assert.equal(zoneWarning({ recommended: 40 }, 50), null);
  assert.match(zoneWarning({ recommended: 80 }, 20), /probably die/);
});
