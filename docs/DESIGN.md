# Gobline: design notes

This file records what the prototype does, why, and where I think the design
still has tension. Numbers given here come from the code in `shared/`, not
from intention. If code and doc disagree, the code is right and this file is
stale.

## Core loop

Explore → fight/gather → loot → bank → upgrade/craft/trade → go further out.

The rule that ties it together is that **anything carried outside the Warren
can be lost**. Each system pushes against that rule from a different side:

| Pressure to stay out | Pressure to go home |
|---|---|
| **Venture streak**: each kill outside a safe zone since you last banked raises loot rarity, `min(60%, kills × 1.2% × zoneTier)`, shifted toward epic and legendary | Death outside the Warren and the Arena drops *everything carried* (gold, unequipped weapons, materials, tomes) into a bag anyone can loot |
| Higher-tier zones drop higher-tier items and materials | Recall is a 6s channel, unavailable in combat, and interrupted by damage or movement |
| Dungeon bosses drop uniques found nowhere else | Banking resets the streak |

The equipped weapon is never dropped. Dropping it would make every death a
total reset of your affinity investment, and that makes people stop leaving
town at all. This is a dial we can turn later.

## Combat

Action combat on a server-authoritative 20 Hz tick.

- Every enemy attack has a **windup** (0.4 to 1.2s), and the client draws it as
  a telegraph: a cone for melee, a growing circle for slams, a line for
  projectiles.
- **Tumble** (Space) is a stamina-cost dash with i-frames. Base i-frame time
  is 0.25s plus 0.02s per AGI characteristic bonus. Dodging a hit trains
  Athletics.
- Abilities are skillshots. Projectiles fly and can miss, melee hits an arc,
  and AoEs land at a point, some after a delay.
- **Hotbars**: combat, utility and social. Tab cycles them. Entering combat
  switches to the combat bar. Leaving combat (6s without dealing or taking
  damage) restores the previous bar, unless you cycled bars by hand during
  the fight.

## Builds without classes

There are no classes. A build comes from three things:

1. **Attribute spread**. STR, AGI and INT are bought with Wisdom. Every
   point of every attribute does something for everyone, as in DOTA. Nobody
   has a dead stat.
2. **School abilities gated by attribute thresholds**. Single-attribute
   abilities need 8 to 14 in that attribute. Hybrid abilities need two
   attributes, which gives hybrids moves that pure builds can't get:
   - STR+INT: *Bloodspit*, which costs health instead of mana. It is a
     caster that wants a big HP pool.
   - AGI+INT: *Shadowhop* (blink plus guaranteed crit) and *Sparkfan*.
     This is the "high-dex mage" from MO.
   - STR+AGI: *Bloodlust*, which costs 12% max HP for +30% damage.
3. **Weapon**. Each weapon type has its own ability kit and its own
   attribute scaling. Affixes can add scaling: a *Quickcast* staff scales
   with AGI, a *Runed* sword with INT.

**High HP does not mean tank.** Health is a spendable resource for several
abilities. Tanking comes from **threat generation and mitigation**: the maul
kit has threat ×1.5 to ×2.5, *Bellow* taunts, *Thick Hide* gives −40% damage
taken, and the *Menacing* affix adds +40% threat.

### Derived stats (`shared/stats.js`)

| Stat | Formula |
|---|---|
| Max HP | 100 + 10·STR + 2·AGI |
| Max mana | 40 + 10·INT |
| Max stamina | 80 + 6·AGI + 2·STR |
| Move speed | 150 + 1.6·AGI (×Athletics bonus, up to +15%) |
| Crit | 4% + 0.4%·AGI (cap 50%), multiplier 1.5 + 0.005·INT |
| Armor | 0.6·STR; reduction = armor / (armor + 60) |
| Flat soak | STR characteristic bonus, i.e. ⌊STR/10⌋ (the Rogue Trader idea) |

### Threat (`shared/threat.js`)

- Damage generates threat 1:1, multiplied by the ability's `threatMult` and the
  attacker's threat multiplier.
- Healing generates 0.5 threat per HP healed. It goes to every enemy that is
  already fighting the healed player.
- An enemy switches targets only when a challenger's threat beats the
  current target's by **10% in melee range or 30% at range**. This is the
  WoW rule. Without hysteresis, aggro ping-pongs and nobody can plan around
  it.
- Taunt pins the target for its duration and lifts the taunter to 110% of the
  top threat.
- Threat decays by 4% a second after 3s of not contributing, so a player
  who backs off does shed aggro.
- *Feint* halves your own threat on everything nearby.

## Progression

There are three independent axes. That is intentional, and it is also the
part most likely to need cutting (see Tensions).

### Wisdom → attributes (`shared/progression.js`)
- Sources: kills (scaled by tier² and rank; a T1 normal gives 1, a T3 elite
  14, the boss 81), first discovery of a zone (+5), and later quests and guild
  challenges.
- The next point costs `1 + ⌊current/8⌋`, so spreading points is cheaper
  than stacking them.
- The total attribute cap is **120**, starting from 15. Even 40/40/40 costs
  345 wisdom; a specialised 75/40/5 costs 500.
- Respec refunds 70%. Builds can change, but not for free every fight.

### Use-based skills (`shared/skills.js`)
- OSRS XP curve: level 99 = 13,034,431 XP, and 92 is about half of that.
- Weapon skills (sword, dagger, staff, bow, maul) train on hits. Evocation
  trains on school spells, Athletics on movement and dodges.
- Skill effects: weapon skill feeds weapon mastery, Athletics makes Tumble
  cheaper (up to −30%) and movement faster, and Evocation makes school
  spells cheaper (up to −20%).

### Weapons (`shared/items.js`)

```
effective power = item power × mastery
item power      = TIER_POWER[tier] × rarity mult × (1 + 0.06 × upgrade)
mastery         = 0.55 + 0.05 × affinity(0..10) + 0.0035 × weaponSkill(1..99)
```

Affinity is stored per **player and item**, so it does not transfer when a
weapon is traded. Mastery ranges from 0.55× to 1.4×. Worked example at
10/10/10 attributes:

| Weapon | Power |
|---|---|
| T1 common, affinity 8, sword skill 40 | **10.9** |
| T2 rare, fresh (affinity 0, skill 5) | 9.9 |
| T3 epic, fresh | 15.1 |

So it isn't "get the purple sword". A weapon you know well beats a fresh
one a tier up, though a big enough tier gap still wins.

**Weapon abilities** unlock on a combined score,
`3·tier + 2·affinity + ⌊skill/5⌋`, so the three axes can substitute for each
other. Each weapon type has a basic ability (score 0), a mid ability (about
10) and a top ability (about 18).

**Affixes** come from rarity (uncommon and rare have 1, epic and legendary
2). Each one is dormant until the item reaches its upgrade gate *and* you
reach its affinity gate: slot 1 needs +3 and affinity 2, slot 2 needs +6 and
affinity 4. Those are the "abilities at affinity levels that are unlocked
prior".

**Upgrades** consume a tome whose tier is at least the item's tier. The
success chance is `max(5%, 95% − 8.5% × level) + 3% × failstacks`, capped at
95%. A failure adds a failstack and **never destroys the item**. The rarity
cap is +5 for common and +13 for legendary.

## Trade

- **Trade skill cap.** Mining, foraging, smithing, alchemy and scribing
  share a total of **250 levels** above 1. That is enough to master two and
  dabble in a third. Each skill can be set to ▲ up, ▼ down or ■ locked, the
  UO/MO model. When a gain would break the cap, XP drains from skills set to
  ▼. If none are set to ▼, the skill stops just short of its next level and
  the player is told why.
- Recipes are split so that no single trade is self-sufficient. Smithing
  needs hides and ore, alchemy needs herbs, and scribing (upgrade tomes)
  needs hides and herbs.
- **Market**, Grand Exchange style. Limit orders on stackables, matched by
  price then time and filled at the resting order's price, with price
  improvement refunded to the buyer. It trades from your bank and fills go
  into your bank, so sellers who are offline still get paid. There is a 2%
  seller tax as a gold sink. Weapons aren't on the market yet because they
  are unique items, so trading them needs either a listing UI or direct
  trade.

## World

| Zone | Tier | Recommended power | Notes |
|---|---|---|---|
| Goblin Warren | 0 | n/a | Safe. Bank, market, anvil, cauldron |
| Mossy Hollows | 1 | 20 | Toads (melee), spore puffs (ranged). Surrounds town |
| Ashen Barrens | 2 | 45 | Jackals (fast melee), cinder shamans |
| Shardspire Heights | 3 | 75 | Golems (armored, slams), wisps |
| Rotfang Depths | 3 (dungeon) | 85 | Brutes, hexers, Old Rotfang (boss). Dungeon-only uniques |
| Scrap Pit Arena | 0 | n/a | PvP, nothing lost on death |

Nothing is locked. Entering a zone above your power rating shows a warning
and nothing else, so a careful player can poach high-tier nodes. Enemy
ranks are normal 85%, elite 12% and champion 3%; higher ranks have more HP,
more damage and better loot. Each zone has its own enemy roster and its own
gathering nodes, and higher-tier nodes need higher gathering levels.

## Tensions and open questions

These are the places where I think the brief has internal conflicts, or
where the prototype took a position you might not agree with.

1. **Full-loot world PvP plus use-based skills invites newbie farming.**
   MO and MO2 live with this, and their populations show what it costs.
   Before any playtest with strangers, I'd add either a criminal-flag and
   reputation system (attacking non-flagged players in T1 flags you, and
   flagged players are fair game and can't use the Warren) or make T1
   no-loot. The prototype currently has neither.

2. **Use-based XP gets macroed.** UO and MO both had to fight AFK skill
   training. Weapon XP here only comes from hits on real targets, scaled by
   enemy tier, which helps. Athletics from distance walked is trivially
   botted. That needs diminishing returns, or should be removed in favour
   of dodge-only XP.

3. **Three progression currencies for one action.** A kill gives wisdom,
   weapon-skill XP and item affinity. That rewards grinding and makes
   balancing them three times the work. My suggestion: move most wisdom to
   non-kill sources (quests, discovery, guild weeklies, dungeon clears),
   so attributes reflect what you've *done* and skills reflect what you've
   *repeated*.

4. **Should upgrades destroy items on failure?** I chose no. Throne &
   Liberty-style failstacks keep the gamble without the rage-quit. With full
   loot already in play, the game has plenty of loss. Destroy-on-fail above
   some threshold, say +9, is a single-line change if you want it.

5. **Per-player affinity makes weapons sticky.** That's good for attachment
   and bad for the weapon market, since a buyer's mastery starts at 0.55×.
   This might be what you want, because it pushes the economy toward
   materials and tomes rather than finished gear. If not, the alternative is
   a partial transfer (say 25%) on trade.

6. **Guild towns with thralls.** These are a different game layer (base
   building, NPC labour, sieges). They're only worth doing if guild
   territory control is central to the endgame. If it is, design them with
   territory control from the start rather than bolting them on.

## Not built yet

These are listed so nobody mistakes the prototype for more than it is.

- Accounts and auth. Joining is by name only, with no password.
- Parties, guilds, guild halls, guild weekly challenges.
- Arena betting.
- Quests (so a whole wisdom source is missing).
- Instanced dungeons. Rotfang is a walled region of the shared world.
- Terrain and collision, line of sight, pathfinding (enemies walk in
  straight lines and stop at the town edge).
- Armor slots. Only weapons can be equipped.
- Direct player-to-player trade, and a market for unique items.
- Anti-cheat beyond server authority, rate limits beyond chat, and
  persistence beyond JSON files.
- Real art and sound.
