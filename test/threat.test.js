import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreatTable } from '../shared/threat.js';

test('target switches only past the hysteresis threshold', () => {
  const t = new ThreatTable();
  t.add('tank', 100, 0);
  assert.equal(t.pickTarget(0), 'tank');
  t.add('dps', 105, 0);
  assert.equal(t.pickTarget(0), 'tank', '105% is not enough in melee');
  t.add('dps', 6, 0); // 111
  assert.equal(t.pickTarget(0), 'dps');
});

test('ranged attackers need 130%', () => {
  const t = new ThreatTable();
  t.add('tank', 100, 0);
  t.pickTarget(0);
  t.add('mage', 125, 0);
  assert.equal(t.pickTarget(0, (id) => id !== 'mage'), 'tank');
  t.add('mage', 10, 0);
  assert.equal(t.pickTarget(0, (id) => id !== 'mage'), 'mage');
});

test('taunt pins target for its duration and lifts the taunter to the top', () => {
  const t = new ThreatTable();
  t.add('dps', 500, 0);
  t.pickTarget(0);
  t.taunt('tank', 4, 1);
  assert.equal(t.pickTarget(2), 'tank');
  t.add('dps', 1000, 3);
  assert.equal(t.pickTarget(3), 'tank', 'still taunted');
  assert.equal(t.pickTarget(6), 'dps', 'taunt expired');
});

test('threat decays after going idle', () => {
  const t = new ThreatTable();
  t.add('a', 100, 0);
  t.decay(1, 2);
  assert.equal(t.entries.get('a').threat, 100, 'grace period');
  t.decay(10, 20);
  assert.ok(t.entries.get('a').threat < 100);
});
