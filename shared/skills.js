// Use-based skills. Doing a thing raises the skill for that thing.
//
// XP curve is the OSRS one: level 92 is roughly half the XP of level 99, so
// the last few levels are where dedication shows.
//
// Trade skills share a total cap (MO2-style). Nobody can max every trade, so
// a fully self-sufficient character is impossible by construction and the
// market has a reason to exist. Combat and movement skills are uncapped in
// total because their limiting factor is attributes and gear, not breadth.

export const MAX_LEVEL = 99;

const XP_TABLE = (() => {
  const table = [0, 0]; // index = level
  let points = 0;
  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    table.push(Math.floor(points / 4));
  }
  return table;
})();

export function xpForLevel(level) {
  return XP_TABLE[Math.max(1, Math.min(MAX_LEVEL, level))];
}

export function levelForXp(xp) {
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (XP_TABLE[mid] <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export const SKILLS = {
  // weapon styles: feed weapon mastery (see items.js masteryMultiplier)
  sword: { category: 'combat', label: 'Swords' },
  dagger: { category: 'combat', label: 'Daggers' },
  staff: { category: 'combat', label: 'Staves' },
  bow: { category: 'combat', label: 'Bows' },
  maul: { category: 'combat', label: 'Mauls' },
  evocation: { category: 'combat', label: 'Evocation' }, // attribute-school spells
  // movement: repetition makes you better at moving
  athletics: { category: 'movement', label: 'Athletics' },
  // trade: capped in total
  mining: { category: 'trade', label: 'Mining' },
  foraging: { category: 'trade', label: 'Foraging' },
  smithing: { category: 'trade', label: 'Smithing' },
  alchemy: { category: 'trade', label: 'Alchemy' },
  scribing: { category: 'trade', label: 'Scribing' },
};

// Sum of (level - 1) across trade skills. 6 trades x 98 = 588 possible;
// 250 lets a player master two and dabble in a third.
export const TRADE_CAP = 250;

export function newSkillSet() {
  const s = {};
  for (const name of Object.keys(SKILLS)) s[name] = { xp: 0, lock: 'up' };
  return s;
}

export function skillLevel(skills, name) {
  return levelForXp(skills[name]?.xp ?? 0);
}

export function tradeTotal(skills) {
  let total = 0;
  for (const [name, def] of Object.entries(SKILLS)) {
    if (def.category === 'trade') total += skillLevel(skills, name) - 1;
  }
  return total;
}

// Grants XP and returns { gained, levelUps, drained, capped }.
// When a trade gain would push the trade total over the cap, XP is pulled
// from skills the player has marked 'down'. If nothing is marked down, the
// skill stops just short of the level that would break the cap.
export function gainXp(skills, name, amount) {
  const result = { gained: 0, levelUps: 0, drained: [], capped: false };
  const entry = skills[name];
  if (!entry || amount <= 0 || entry.lock !== 'up') return result;

  const before = levelForXp(entry.xp);
  const maxXp = xpForLevel(MAX_LEVEL);
  let target = Math.min(maxXp, entry.xp + amount);

  if (SKILLS[name].category === 'trade') {
    let levelsWanted = levelForXp(target) - before;
    let headroom = TRADE_CAP - tradeTotal(skills);
    if (levelsWanted > headroom) {
      // Drain from 'down' skills one level at a time.
      for (const [other, def] of Object.entries(SKILLS)) {
        if (levelsWanted <= headroom) break;
        if (other === name || def.category !== 'trade') continue;
        const o = skills[other];
        if (o.lock !== 'down') continue;
        while (levelsWanted > headroom && levelForXp(o.xp) > 1) {
          const lvl = levelForXp(o.xp);
          o.xp = xpForLevel(lvl - 1);
          headroom++;
          result.drained.push(other);
        }
      }
      if (levelsWanted > headroom) {
        const allowedLevel = before + Math.max(0, headroom);
        target = Math.min(target, xpForLevel(allowedLevel + 1) - 1);
        result.capped = true;
      }
    }
  }

  result.gained = Math.max(0, target - entry.xp);
  entry.xp = Math.max(entry.xp, target);
  result.levelUps = levelForXp(entry.xp) - before;
  return result;
}

// Effects of non-weapon skills. Kept here so the client can show them.
export function athleticsBonus(level) {
  // Up to 30% cheaper dodges and 15% faster movement at 99.
  const t = (level - 1) / (MAX_LEVEL - 1);
  return { dodgeCostMult: 1 - 0.3 * t, moveSpeedMult: 1 + 0.15 * t };
}

export function evocationBonus(level) {
  // Up to 20% cheaper school spells.
  const t = (level - 1) / (MAX_LEVEL - 1);
  return { costMult: 1 - 0.2 * t };
}
