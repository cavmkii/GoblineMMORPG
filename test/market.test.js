import test from 'node:test';
import assert from 'node:assert/strict';
import { Market, MARKET_TAX } from '../shared/market.js';

test('crossing orders fill at the resting price with buyer refund', () => {
  const m = new Market();
  m.place({ side: 'sell', owner: 'a', key: 'ore_t1', price: 10, qty: 5 });
  const { fills, order } = m.place({ side: 'buy', owner: 'b', key: 'ore_t1', price: 12, qty: 3 });
  assert.equal(fills.length, 1);
  assert.equal(fills[0].price, 10);
  assert.equal(fills[0].qty, 3);
  assert.equal(fills[0].buyerRefundPerUnit, 2);
  assert.equal(fills[0].sellerProceeds, Math.floor(30 * (1 - MARKET_TAX)));
  assert.equal(order.remaining, 0);
  assert.equal(m.summary().ore_t1.sellQty, 2);
});

test('price then time priority, partial fills rest on the book', () => {
  const m = new Market();
  m.place({ side: 'sell', owner: 'late', key: 'k', price: 9, qty: 1 });
  m.place({ side: 'sell', owner: 'cheap', key: 'k', price: 8, qty: 1 });
  m.place({ side: 'sell', owner: 'later', key: 'k', price: 9, qty: 1 });
  const { fills, order } = m.place({ side: 'buy', owner: 'b', key: 'k', price: 9, qty: 4 });
  assert.deepEqual(fills.map((f) => f.seller), ['cheap', 'late', 'later']);
  assert.equal(order.remaining, 1);
  assert.equal(m.summary().k.bestBuy, 9);
});

test('cancel only by owner', () => {
  const m = new Market();
  const { order } = m.place({ side: 'buy', owner: 'x', key: 'k', price: 5, qty: 2 });
  assert.equal(m.cancel(order.id, 'y'), null);
  assert.equal(m.cancel(order.id, 'x').remaining, 2);
});

test('rejects nonsense', () => {
  const m = new Market();
  assert.throws(() => m.place({ side: 'buy', owner: 'x', key: 'k', price: 0, qty: 1 }));
  assert.throws(() => m.place({ side: 'buy', owner: 'x', key: 'k', price: 1.5, qty: 1 }));
});
