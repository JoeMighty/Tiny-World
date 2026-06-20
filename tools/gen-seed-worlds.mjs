#!/usr/bin/env node
// Generates the Worlds seed migration: a small, fixed collection of distinct
// worlds with different resource strengths (fishing / mining / farming / mixed),
// each procedurally laid out from a per-world seed so they are all different.
//
//   node tools/gen-seed-worlds.mjs > netlify/database/migrations/20260607122000_reseed_worlds.sql
//
// Deterministic: re-running produces the same SQL. This is a SEPARATE migration
// from the original seed (20260607121000) — migrations are immutable once applied
// (Netlify tracks their checksums), so we never edit that file; this one clears
// the original placeholder seed and inserts the curated collection instead.
// The claim flow never INSERTs worlds, so these files define the universe supply.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Grow a connected blob of `count` cells from (cx,cz), 4-neighbour random walk —
// keeps water bodies connected (one shared fishing node) and stone clusters tight.
function growBlob(occupied, g, cx, cz, count, rng) {
  const out = [];
  const key = (x, z) => x + ',' + z;
  const frontier = [[cx, cz]];
  while (out.length < count && frontier.length) {
    const i = Math.floor(rng() * frontier.length);
    const [x, z] = frontier.splice(i, 1)[0];
    if (x < 0 || z < 0 || x >= g || z >= g || occupied.has(key(x, z))) continue;
    occupied.add(key(x, z));
    out.push([x, z]);
    const nbrs = [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]];
    for (const n of nbrs) if (rng() < 0.7) frontier.push(n);
    if (!frontier.length) frontier.push([x + (rng() < 0.5 ? 1 : -1), z]);
  }
  return out;
}

function emptyGrassCell(occupied, g, rng) {
  for (let tries = 0; tries < 40; tries++) {
    const x = Math.floor(rng() * g), z = Math.floor(rng() * g);
    if (!occupied.has(x + ',' + z)) { occupied.add(x + ',' + z); return [x, z]; }
  }
  return null;
}

const PLANTS = ['corn', 'wheat', 'carrot', 'sunflower', 'pumpkin'];

// archetype: { slug, name, status, grid, water:[blobSizes], stone:[clusterSizes], crops, trees }
function buildWorld(a) {
  const g = a.grid;
  const rng = mulberry32(hashSeed(a.slug));
  const occupied = new Set();
  const cells = [];
  // Water bodies.
  for (const size of a.water) {
    const cx = Math.floor(rng() * g), cz = Math.floor(rng() * g);
    for (const [x, z] of growBlob(occupied, g, cx, cz, size, rng)) cells.push({ x, z, terrain: 'water' });
  }
  // Stone / ore clusters.
  for (const size of a.stone) {
    const cx = Math.floor(rng() * g), cz = Math.floor(rng() * g);
    for (const [x, z] of growBlob(occupied, g, cx, cz, size, rng)) cells.push({ x, z, terrain: 'stone' });
  }
  // Crops (ripe plants → gather nodes) on open grass.
  for (let i = 0; i < a.crops; i++) {
    const c = emptyGrassCell(occupied, g, rng); if (!c) break;
    cells.push({ x: c[0], z: c[1], terrain: 'grass', kind: PLANTS[Math.floor(rng() * PLANTS.length)] });
  }
  // Trees for character (block standing, not harvestable).
  for (let i = 0; i < a.trees; i++) {
    const c = emptyGrassCell(occupied, g, rng); if (!c) break;
    cells.push({ x: c[0], z: c[1], terrain: 'grass', kind: 'tree' });
  }
  const water = cells.filter(c => c.terrain === 'water').length;
  const stone = cells.filter(c => c.terrain === 'stone').length;
  const tile = g * g;
  const grass = tile - water - stone;            // crops/trees keep grass terrain
  const price = a.status === 'unclaimed' ? Math.round(0.01 * tile * 1e6) / 1e6 : 0;
  return {
    slug: a.slug, name: a.name, status: a.status,
    kind: a.status === 'published' ? 'starter' : 'purchasable',
    grid: g, tile, stone, grass, water, price,
    data: { v: 4, gridSize: g, cells },
  };
}

// 10 worlds, all different, spanning board sizes 8/12/16/20 (the client's valid
// home-grid sizes). Mixed published (playable now) + unclaimed (buyable).
const ARCHETYPES = [
  { slug: 'tidewater-bay', name: 'Tidewater Bay', status: 'published', grid: 16, water: [40, 16, 8], stone: [4], crops: 6, trees: 6 },
  { slug: 'iron-ridge', name: 'Iron Ridge', status: 'published', grid: 12, water: [4], stone: [12, 8, 6], crops: 3, trees: 3 },
  { slug: 'green-pastures', name: 'Green Pastures', status: 'published', grid: 12, water: [5], stone: [2], crops: 18, trees: 6 },
  { slug: 'mixed-hollow', name: 'Mixed Hollow', status: 'published', grid: 20, water: [30, 12], stone: [14, 8], crops: 16, trees: 10 },
  { slug: 'forest-glade', name: 'Forest Glade', status: 'published', grid: 12, water: [8], stone: [3], crops: 6, trees: 22 },
  { slug: 'quarry-flats', name: 'Quarry Flats', status: 'published', grid: 12, water: [3], stone: [10, 7, 5], crops: 3, trees: 2 },
  { slug: 'lake-district', name: 'Lake District', status: 'unclaimed', grid: 20, water: [34, 22, 14], stone: [5], crops: 8, trees: 8 },
  { slug: 'stone-vale', name: 'Stone Vale', status: 'unclaimed', grid: 16, water: [6], stone: [16, 11, 8, 5], crops: 3, trees: 4 },
  { slug: 'meadow-plots', name: 'Meadow Plots', status: 'unclaimed', grid: 8, water: [3], stone: [2], crops: 12, trees: 4 },
  { slug: 'crossroads', name: 'Crossroads', status: 'unclaimed', grid: 8, water: [5], stone: [4], crops: 4, trees: 3 },
];

function sqlString(obj) {
  return "'" + JSON.stringify(obj).replace(/'/g, "''") + "'";
}

function main() {
  const worlds = ARCHETYPES.map(buildWorld);
  const lines = [];
  lines.push('-- Reseed the universe with a FIXED, hand-tuned collection of distinct worlds.');
  lines.push('-- GENERATED by tools/gen-seed-worlds.mjs — do not edit by hand; re-run the');
  lines.push('-- generator to regenerate. Each world has a different mix of water / stone /');
  lines.push('-- grass / crops, so they carry different resource strengths. Published worlds');
  lines.push('-- are playable immediately (owner-less, no tax sink); unclaimed worlds are');
  lines.push('-- buyable with USDC. The claim flow never INSERTs worlds, so supply is fixed.');
  lines.push('');
  lines.push('-- Clear the original placeholder seed (5 starter-* + 80 plot-*) that nobody');
  lines.push('-- owns. Owned worlds are never touched.');
  lines.push("DELETE FROM worlds WHERE owner_profile_id IS NULL AND (slug LIKE 'plot-%' OR slug LIKE 'starter-%');");
  lines.push('');
  for (const w of worlds) {
    lines.push('INSERT INTO worlds (slug, kind, status, name, tax_percent, grid_size, tile_count,');
    lines.push('                    stone_tile_count, grass_tile_count, water_tile_count, price_usdc, data, published_at)');
    lines.push('VALUES (' + [
      "'" + w.slug + "'", "'" + w.kind + "'", "'" + w.status + "'", "'" + w.name.replace(/'/g, "''") + "'",
      10, w.grid, w.tile, w.stone, w.grass, w.water, w.price,
      sqlString(w.data) + '::jsonb',
      w.status === 'published' ? 'NOW()' : 'NULL',
    ].join(', ') + ')');
    lines.push('ON CONFLICT (slug) DO NOTHING;');
    lines.push('');
  }
  process.stdout.write(lines.join('\n'));
  const summary = worlds.map(w => `${w.slug}: ${w.grid}x${w.grid} water=${w.water} stone=${w.stone} grass=${w.grass} [${w.status}]`).join('\n');
  process.stderr.write('\n' + summary + '\n');
}

main();
