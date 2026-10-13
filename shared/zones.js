// World layout. Rectangles on a 4000x3000 map, checked in order; first hit
// wins, so small regions (town, arena, dungeon) come before the big ones.
//
// Nothing is locked. Entering a zone above your power rating gets a warning
// and nothing else. Careful players can poach high-tier nodes and kills.

export const WORLD = { width: 4000, height: 3000 };

export const ZONES = [
  {
    id: 'warren', name: 'Goblin Warren', tier: 0, safe: true, color: '#3b4a2f',
    rect: [1700, 1250, 600, 500], services: ['bank', 'market', 'anvil', 'cauldron'],
    blurb: 'Safe. Bank, market, anvil, cauldron.',
  },
  {
    id: 'arena', name: 'Scrap Pit Arena', tier: 0, safe: false, arena: true, color: '#5a4630',
    rect: [2350, 1350, 260, 260],
    blurb: 'PvP for fun. Death here costs nothing.',
  },
  {
    id: 'rotfang', name: 'Rotfang Depths', tier: 3, safe: false, dungeon: true, color: '#2a1f2e',
    rect: [3300, 2350, 620, 580], recommended: 85,
    blurb: 'Dungeon. Items here drop nowhere else.',
  },
  {
    id: 'hollows', name: 'Mossy Hollows', tier: 1, safe: false, color: '#2f5a33',
    rect: [900, 700, 2200, 1600], recommended: 20,
    blurb: 'Toads, spores, soft ground.',
  },
  {
    id: 'barrens', name: 'Ashen Barrens', tier: 2, safe: false, color: '#5a4a3a',
    rect: [0, 0, 4000, 1400], recommended: 45,
    blurb: 'Jackals and cinder shamans. Hot.',
  },
  {
    id: 'shardspire', name: 'Shardspire Heights', tier: 3, safe: false, color: '#3d4660',
    rect: [0, 1400, 4000, 1600], recommended: 75,
    blurb: 'Golems and wisps. Shiny and lethal.',
  },
];

export function zoneAt(x, y) {
  for (const z of ZONES) {
    const [zx, zy, w, h] = z.rect;
    if (x >= zx && x < zx + w && y >= zy && y < zy + h) return z;
  }
  return ZONES[ZONES.length - 1];
}

export function zoneWarning(zone, power) {
  if (!zone.recommended) return null;
  const ratio = power / zone.recommended;
  if (ratio >= 1) return null;
  if (ratio >= 0.75) return `Recommended power ${zone.recommended}. You are ${power}. Careful.`;
  if (ratio >= 0.5) return `Recommended power ${zone.recommended}. You are ${power}. This will hurt.`;
  return `Recommended power ${zone.recommended}. You are ${power}. You will probably die. Nobody is stopping you.`;
}

export const TOWN_SPAWN = { x: 2000, y: 1500 };

// Service points inside the Warren
export const SERVICES = {
  bank: { x: 1820, y: 1380, label: 'Bank' },
  market: { x: 2180, y: 1380, label: 'Market' },
  anvil: { x: 1820, y: 1640, label: 'Anvil' },
  cauldron: { x: 2180, y: 1640, label: 'Cauldron' },
};
