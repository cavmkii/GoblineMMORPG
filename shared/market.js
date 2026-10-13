// Player market, Grand Exchange style: limit orders on stackable goods,
// matched by price then time, filled at the resting order's price.
//
// Escrow is the caller's job: take gold from buyers (price * qty) and goods
// from sellers when the order is placed. Fills report a per-unit refund for
// buyers who got a better price than they bid. Sellers pay a 2% tax, which is
// the market's gold sink.

export const MARKET_TAX = 0.02;

export class Market {
  constructor() {
    this.books = new Map(); // key -> { buys: [], sells: [] }
    this.nextId = 1;
    this.seq = 0;
  }

  book(key) {
    if (!this.books.has(key)) this.books.set(key, { buys: [], sells: [] });
    return this.books.get(key);
  }

  place({ side, owner, key, price, qty }) {
    if (!['buy', 'sell'].includes(side)) throw new Error('bad side');
    if (!(price > 0) || !(qty > 0) || !Number.isInteger(price) || !Number.isInteger(qty)) {
      throw new Error('price and qty must be positive integers');
    }
    const order = { id: this.nextId++, side, owner, key, price, qty, remaining: qty, seq: this.seq++ };
    const b = this.book(key);
    const fills = [];
    const opposite = side === 'buy' ? b.sells : b.buys;
    const crosses = (o) => (side === 'buy' ? o.price <= price : o.price >= price);

    while (order.remaining > 0 && opposite.length && crosses(opposite[0])) {
      const rest = opposite[0];
      const q = Math.min(order.remaining, rest.remaining);
      const buy = side === 'buy' ? order : rest;
      const sell = side === 'buy' ? rest : order;
      fills.push({
        key,
        qty: q,
        price: rest.price,
        buyer: buy.owner,
        seller: sell.owner,
        buyOrderId: buy.id,
        sellOrderId: sell.id,
        buyerRefundPerUnit: buy.price - rest.price,
        sellerProceeds: Math.floor(q * rest.price * (1 - MARKET_TAX)),
      });
      order.remaining -= q;
      rest.remaining -= q;
      if (rest.remaining === 0) opposite.shift();
    }

    if (order.remaining > 0) {
      const mine = side === 'buy' ? b.buys : b.sells;
      mine.push(order);
      // buys: highest price first; sells: lowest first; ties by time
      mine.sort((x, y) => (side === 'buy' ? y.price - x.price : x.price - y.price) || x.seq - y.seq);
    }
    return { order, fills };
  }

  cancel(id, owner) {
    for (const b of this.books.values()) {
      for (const list of [b.buys, b.sells]) {
        const i = list.findIndex((o) => o.id === id && o.owner === owner);
        if (i >= 0) return list.splice(i, 1)[0];
      }
    }
    return null;
  }

  ordersFor(owner) {
    const out = [];
    for (const b of this.books.values()) {
      for (const o of [...b.buys, ...b.sells]) if (o.owner === owner) out.push(o);
    }
    return out;
  }

  summary() {
    const out = {};
    for (const [key, b] of this.books) {
      out[key] = {
        bestBuy: b.buys[0]?.price ?? null,
        bestSell: b.sells[0]?.price ?? null,
        buyQty: b.buys.reduce((s, o) => s + o.remaining, 0),
        sellQty: b.sells.reduce((s, o) => s + o.remaining, 0),
      };
    }
    return out;
  }

  toJSON() {
    return { nextId: this.nextId, seq: this.seq, books: [...this.books.entries()] };
  }

  static fromJSON(j) {
    const m = new Market();
    if (!j) return m;
    m.nextId = j.nextId;
    m.seq = j.seq;
    m.books = new Map(j.books);
    return m;
  }
}
