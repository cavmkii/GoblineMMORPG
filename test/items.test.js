import test from 'node:test';
import assert from 'node:assert/strict';
import { addAffinity, makeWeapon, weaponProfile, attemptUpgrade, upgradeChance, activeAffixes, weaponUnlockScore, RARITIES } from '../shared/items.js';
import { makeRng } from '../shared/rng.js';

const attrs = { str: 10, agi: 10, int: 10 };

test('a well-known T1 weapon beats a fresh T2 rare', () => {
  const old = makeWeapon({ type: 'sword', tier: 1, rarity: 'common' });
  addAffinity(old, 'me', 40 * 64); // affinity 8
  const fresh = makeWeapon({ type: 'sword', tier: 2, rarity: 'rare' });
  const a = weaponProfile(old, attrs, 40, 'me');
  const b = weaponProfile(fresh, attrs, 5, 'me');
  assert.ok(a.power > b.power, `${a.power} should beat ${b.power}`);
});

test('tier still matters at equal mastery', () => {
  const t1 = makeWeapon({ type: 'sword', tier: 1 });
  const t3 = makeWeapon({ type: 'sword', tier: 3 });
  assert.ok(weaponProfile(t3, attrs, 30).power > weaponProfile(t1, attrs, 30).power);
});

test('unlock score lets affinity and skill substitute for tier', () => {
  // T1, affinity 6, skill 30  vs  T3, affinity 0, skill 5
  assert.ok(weaponUnlockScore(1, 6, 30) >= weaponUnlockScore(3, 0, 5));
});

test('affixes stay dormant until upgrade AND affinity gates are met', () => {
  const w = makeWeapon({ type: 'dagger', tier: 1, rarity: 'epic', affixes: ['brutal', 'swift'] });
  assert.deepEqual(activeAffixes(w, 'me'), []);
  w.upgrade = 3;
  assert.deepEqual(activeAffixes(w, 'me'), []);
  addAffinity(w, 'me', 40 * 4); // affinity 2
  assert.deepEqual(activeAffixes(w, 'me'), ['brutal']);
  w.upgrade = 6;
  addAffinity(w, 'me', 40 * 12); // affinity 4
  assert.deepEqual(activeAffixes(w, 'me'), ['brutal', 'swift']);
  assert.deepEqual(activeAffixes(w, 'buyer'), [], "affinity doesn't transfer with the item");
});

test('upgrade failure adds failstacks, never destroys, and success resets them', () => {
  const w = makeWeapon({ type: 'maul', tier: 1, rarity: 'common' });
  w.upgrade = 4;
  const tome = { kind: 'tome', tier: 1 };
  const before = upgradeChance(w);
  const alwaysFail = () => 0.999;
  alwaysFail.int = () => 0;
  const r = attemptUpgrade(w, tome, alwaysFail);
  assert.equal(r.success, false);
  assert.equal(w.failstacks, 1);
  assert.equal(w.upgrade, 4);
  assert.ok(upgradeChance(w) > before);
  const alwaysWin = () => 0;
  attemptUpgrade(w, tome, alwaysWin);
  assert.equal(w.upgrade, 5);
  assert.equal(w.failstacks, 0);
  const capped = attemptUpgrade(w, tome, alwaysWin);
  assert.equal(capped.ok, false, `common caps at +${RARITIES.common.upgradeCap}`);
});

test('tome tier must be at least item tier', () => {
  const w = makeWeapon({ type: 'bow', tier: 3 });
  assert.equal(attemptUpgrade(w, { kind: 'tome', tier: 2 }, makeRng(1)).ok, false);
});
