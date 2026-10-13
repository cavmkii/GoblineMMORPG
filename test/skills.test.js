import test from 'node:test';
import assert from 'node:assert/strict';
import { xpForLevel, levelForXp, newSkillSet, gainXp, skillLevel, tradeTotal, TRADE_CAP } from '../shared/skills.js';

test('OSRS curve', () => {
  assert.equal(xpForLevel(2), 83);
  assert.equal(xpForLevel(99), 13034431);
  assert.equal(levelForXp(13034430), 98);
  assert.equal(levelForXp(13034431), 99);
});

test('trade cap blocks gains when nothing is marked down', () => {
  const s = newSkillSet();
  s.mining.xp = xpForLevel(99);
  s.smithing.xp = xpForLevel(99);
  s.alchemy.xp = xpForLevel(55); // 98 + 98 + 54 = 250
  assert.equal(tradeTotal(s), TRADE_CAP);
  const before = s.foraging.xp;
  gainXp(s, 'foraging', 10_000);
  assert.equal(skillLevel(s, 'foraging'), 1);
  assert.ok(s.foraging.xp > before && s.foraging.xp < xpForLevel(2), 'progress stops just short of level 2');
});

test('trade cap drains skills marked down', () => {
  const s = newSkillSet();
  s.mining.xp = xpForLevel(99);
  s.smithing.xp = xpForLevel(99);
  s.alchemy.xp = xpForLevel(55);
  s.alchemy.lock = 'down';
  const r = gainXp(s, 'foraging', xpForLevel(10));
  assert.equal(skillLevel(s, 'foraging'), 10);
  assert.equal(skillLevel(s, 'alchemy'), 46);
  assert.ok(r.drained.length === 9);
  assert.equal(tradeTotal(s), TRADE_CAP);
});

test('locked skills do not gain', () => {
  const s = newSkillSet();
  s.sword.lock = 'locked';
  gainXp(s, 'sword', 500);
  assert.equal(s.sword.xp, 0);
});

test('combat skills ignore the trade cap', () => {
  const s = newSkillSet();
  s.mining.xp = xpForLevel(99);
  s.smithing.xp = xpForLevel(99);
  s.alchemy.xp = xpForLevel(55);
  gainXp(s, 'sword', xpForLevel(50));
  assert.equal(skillLevel(s, 'sword'), 50);
});
