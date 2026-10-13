# Gobline

A goblin MMORPG, very early: a playable vertical slice of the core loop
(explore, fight, loot, bank, upgrade, trade). It has an authoritative Node
server and a canvas browser client, and the game rules are pure, tested
modules shared by both.

Design rationale, formulas and open questions are in
[docs/DESIGN.md](docs/DESIGN.md).

## Run it

```sh
npm install
npm start            # http://localhost:8080  (PORT=... to change)
npm test
```

Open several browser tabs with different names to see multiplayer. Player
data goes to `data/` (set `DATA_DIR` to change it).

## Controls

| Key | Action |
|---|---|
| WASD / mouse | move / aim |
| LMB (hold) | weapon basic attack |
| Space | Tumble (dash with i-frames) |
| 1-8 | active hotbar slot |
| Tab | cycle combat / utility / social bar |
| E / Q | interact (loot, gather) / drink grog |
| C / I / K | character + abilities / inventory / skills |
| B / M / U | bank / market / anvil and cauldron (in the Warren) |
| Enter | chat |

To put an ability on a bar: press C, click "place" next to the ability,
then click a hotbar slot. Right-click a slot to clear it.

## Layout

```
shared/    game rules, no I/O; imported by server, client and tests
  stats.js        attributes -> derived stats, mitigation
  abilities.js    school (attribute-gated) and weapon (score-gated) abilities
  items.js        rarity, tiers, mastery, affixes, upgrades
  skills.js       use-based skills, OSRS curve, trade cap with up/down/lock
  progression.js  wisdom -> attributes
  threat.js       aggro tables with switch hysteresis, taunt, decay
  loot.js         drop tables, venture streak, dungeon uniques
  market.js       GE-style order book
  zones.js, enemies.js, crafting.js, hotbars.js
server/    world simulation (20 Hz), WebSocket protocol, JSON persistence
client/    canvas renderer, HUD, panels
test/      node:test suites for rules and world integration
```
