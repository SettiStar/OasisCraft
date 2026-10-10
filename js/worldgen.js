// Minecraft-style terrain generation: continents + hills + mountains heightmap,
// temperature/humidity biomes, spaghetti & cheese caves, lava lakes, ore veins,
// trees, cacti and surface decorations.

const BIOME = {
  OCEAN: 'Ocean', FROZEN_OCEAN: 'Frozen Ocean', BEACH: 'Beach', PLAINS: 'Plains',
  FOREST: 'Forest', DESERT: 'Desert', TAIGA: 'Taiga', SNOWY: 'Snowy Tundra', MOUNTAINS: 'Mountains',
};

const LAVA_LEVEL = 10;
const ENTRANCE_CHANCE = 0.2; // chance a chunk starts a walkable cave entrance
const MIN_CAVE_HEIGHT = 3;   // no cave pocket is shorter than this
const BEEHIVE_CHANCE = 0.05; // share of oak trees with a beehive

class WorldGen {
  constructor(seed) {
    this.seed = seed;
    const n = (k) => new SimplexNoise((seed ^ Math.imul(k, 0x9E3779B1)) >>> 0);
    this.nCont = n(1);
    this.nHill = n(2);
    this.nDetail = n(3);
    this.nMount = n(4);
    this.nTemp = n(5);
    this.nHumid = n(6);
    this.nCaveA = n(7);
    this.nCaveB = n(8);
    this.nCheese = n(9);
    this.nGravel = n(10);
    this._entrances = new Map();
  }

  // Pure function of (x, y): terrain height and biome.
  column(x, y) {
    const cont = this.nCont.fbm2D(x / 700, y / 700, 4);
    const hills = this.nHill.fbm2D(x / 160, y / 160, 4);
    const detail = this.nDetail.fbm2D(x / 40, y / 40, 2);
    let m = Math.max(0, this.nMount.fbm2D(x / 350, y / 350, 3) - 0.1) / 0.9;
    m = m * m * 70 * Math.min(1, Math.max(0, (cont + 0.05) * 5));

    let h = SEA_LEVEL + 3 + cont * 32 + hills * 7 + detail * 2 + m;
    h = Math.max(6, Math.min(WORLD_H - 12, Math.round(h)));

    const temp = this.nTemp.fbm2D(x / 900, y / 900, 2) - Math.max(0, h - SEA_LEVEL - 12) * 0.012;
    const humid = this.nHumid.fbm2D(x / 800, y / 800, 2);

    let biome;
    if (h < SEA_LEVEL - 1) biome = temp < -0.25 ? BIOME.FROZEN_OCEAN : BIOME.OCEAN;
    else if (h <= SEA_LEVEL + 1 && cont < 0.08) biome = temp < -0.25 ? BIOME.SNOWY : BIOME.BEACH;
    else if (h > SEA_LEVEL + 24) biome = BIOME.MOUNTAINS;
    else if (temp > 0.18 && humid < 0.05) biome = BIOME.DESERT;
    else if (temp < -0.25) biome = BIOME.SNOWY;
    else if (temp < -0.08) biome = BIOME.TAIGA;
    else if (humid > 0.08) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;

    return { h, biome, temp, humid };
  }

  isCave(x, y, z, h) {
    if (z < 5 || z > h) return false; // never carve the bedrock layers (1-3)
    // Keep sea / lake floors sealed so static water doesn't hang over caves.
    if (h <= SEA_LEVEL + 1 && z > h - 5) return false;
    const a = this.nCaveA.noise3D(x / 48, y / 48, z / 14);
    const b = this.nCaveB.noise3D(x / 48, y / 48, z / 14);
    if (a * a + b * b < 0.014) return true;
    if (z < SEA_LEVEL - 10) {
      const c = this.nCheese.noise3D(x / 90, y / 90, z / 22);
      if (c > 0.58) return true;
    }
    return false;
  }

  generate(chunk) {
    const ox = chunk.cx * CHUNK, oy = chunk.cy * CHUNK;
    const cols = new Array(CHUNK * CHUNK);
    const rand = mulberry32(hashString(`${this.seed}:${chunk.cx}:${chunk.cy}`));

    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = ox + lx, y = oy + ly;
        const col = this.column(x, y);
        cols[ly * CHUNK + lx] = col;
        this.fillColumn(chunk, lx, ly, x, y, col);
      }
    }

    this.placeOres(chunk, rand, cols);
    this.carveEntrances(chunk, ox, oy);
    this.placeTrees(chunk, ox, oy);
    this.placeDecorations(chunk, ox, oy, cols);
  }

  // ---- cave entrances -----------------------------------------------------
  // Walkable cave mouths: a 3-wide ramp that drops one layer per tile from the
  // surface (an open trench that becomes a tunnel), ringed with exposed stone and
  // gravel so it stands out from the grass. Deterministic per chunk, so ramps that
  // cross chunk borders line up.

  caveEntrance(cx, cy) {
    const key = cx + ',' + cy;
    if (this._entrances.has(key)) return this._entrances.get(key);
    let ent = null;
    const r = mulberry32(hashString(`${this.seed}:mouth:${cx}:${cy}`));
    if (r() < ENTRANCE_CHANCE) {
      const sx = cx * CHUNK + 2 + Math.floor(r() * 12), sy = cy * CHUNK + 2 + Math.floor(r() * 12);
      const col = this.column(sx, sy);
      if (col.h > SEA_LEVEL + 2 && col.biome !== BIOME.BEACH) {
        const d = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(r() * 4)];
        const len = 14 + Math.floor(r() * 12);
        const path = [];
        let off = 0; // sideways wander, kept within 1 so the centre line stays a straight walk
        for (let i = 0; i < len; i++) {
          const floor = col.h - 1 - i;
          if (floor <= LAVA_LEVEL + 3) break;
          if (i > 3 && r() < 0.3) off = off === 0 ? (r() < 0.5 ? 1 : -1) : 0;
          path.push({ x: sx + d[0] * i + d[1] * off, y: sy + d[1] * i + d[0] * off, floor });
        }
        ent = { path, perp: [d[1], d[0]] };
      }
    }
    this._entrances.set(key, ent);
    return ent;
  }

  // Entrances whose ramps might reach into the given chunk.
  nearbyEntrances(cx, cy) {
    const out = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const e = this.caveEntrance(cx + dx, cy + dy);
      if (e) out.push(e);
    }
    return out;
  }

  carveEntrances(chunk, ox, oy) {
    const inside = (x, y) => x >= ox && y >= oy && x < ox + CHUNK && y < oy + CHUNK;
    const get = (x, y, z) => chunk.blocks[Chunk.index(x - ox, y - oy, z)];
    const set = (x, y, z, id) => { chunk.blocks[Chunk.index(x - ox, y - oy, z)] = id; };
    for (const ent of this.nearbyEntrances(chunk.cx, chunk.cy)) {
      const [px, py] = ent.perp;
      ent.path.forEach((p, i) => {
        for (let a = -2; a <= 2; a++) {
          const x = p.x + px * a, y = p.y + py * a;
          if (!inside(x, y)) continue;
          if (Math.abs(a) <= 1) {
            // Trench / tunnel: 3 wide, 3 tall above the ramp floor.
            for (let z = p.floor + 1; z <= p.floor + 3 && z < WORLD_H; z++) {
              if (get(x, y, z) !== B.BEDROCK) set(x, y, z, B.AIR);
            }
            // Bare rock floor near the mouth.
            if (i < 8 && get(x, y, p.floor) !== B.AIR) set(x, y, p.floor, hash3(x, y, p.floor) < 0.3 ? B.GRAVEL : B.STONE);
          } else if (i < 6) {
            // Rim: swap the surface block beside the opening for exposed rock.
            let z = Math.min(WORLD_H - 2, p.floor + 6);
            while (z > p.floor && get(x, y, z) === B.AIR) z--;
            const top = get(x, y, z);
            if (top === B.GRASS || top === B.DIRT || top === B.SNOWY_GRASS || top === B.SAND) {
              const r = hash3(x, y, z + 7);
              set(x, y, z, r < 0.45 ? B.STONE : r < 0.75 ? B.GRAVEL : B.COBBLESTONE);
              if (BLOCKS[get(x, y, z + 1)].decoration) set(x, y, z + 1, B.AIR);
            }
          }
        }
      });
    }
  }

  // Is (x, y) on or right beside a cave entrance? (Keeps trees out of the ramps.)
  nearEntrance(x, y) {
    for (const ent of this.nearbyEntrances(x >> 4, y >> 4)) {
      for (const p of ent.path) if (Math.abs(p.x - x) <= 3 && Math.abs(p.y - y) <= 3) return true;
    }
    return false;
  }

  fillColumn(chunk, lx, ly, x, y, { h, biome }) {
    const set = (z, id) => { chunk.blocks[Chunk.index(lx, ly, z)] = id; };
    const r = hash3(x, y, this.seed);

    // Surface materials by biome.
    let topBlock = B.GRASS, fill = B.DIRT, fillDepth = 3, under = B.STONE;
    switch (biome) {
      case BIOME.OCEAN:
      case BIOME.FROZEN_OCEAN:
        topBlock = fill = this.nGravel.noise2D(x / 20, y / 20) > 0.3 ? B.GRAVEL : B.SAND;
        break;
      case BIOME.BEACH:
        topBlock = fill = B.SAND; under = B.SANDSTONE;
        break;
      case BIOME.DESERT:
        topBlock = fill = B.SAND; fillDepth = 4; under = B.SANDSTONE;
        break;
      case BIOME.SNOWY:
        topBlock = B.SNOWY_GRASS;
        break;
      case BIOME.MOUNTAINS:
        topBlock = h > SEA_LEVEL + 34 ? B.SNOW : (h > SEA_LEVEL + 28 ? B.STONE : B.GRASS);
        fill = topBlock === B.GRASS ? B.DIRT : B.STONE;
        break;
      case BIOME.TAIGA:
        topBlock = r < 0.15 ? B.DIRT : B.GRASS;
        break;
    }

    set(0, B.BEDROCK);
    for (let z = 1; z <= h; z++) {
      let id;
      if (z <= 3 && hash3(x, y, z * 31 + this.seed) < 0.6 - z * 0.15) id = B.BEDROCK;
      else if (z === h) id = topBlock;
      else if (z > h - fillDepth) id = fill;
      else if (z > h - fillDepth - 3 && under === B.SANDSTONE) id = B.SANDSTONE;
      else id = B.STONE;

      if (id !== B.BEDROCK && this.isCave(x, y, z, h)) {
        id = z <= LAVA_LEVEL ? B.LAVA : B.AIR;
      }
      set(z, id);
    }

    // Caves are never shorter than MIN_CAVE_HEIGHT. The player is 2 tall and can't
    // jump, so a 1-block gap is a dead end, and stepping up a block inside a cave
    // needs a free cell above your head. Short pockets grow upward (keeping the
    // surface block as a roof), then downward if they can't.
    const get = (z) => chunk.blocks[Chunk.index(lx, ly, z)];
    const open = (id) => id === B.AIR || id === B.LAVA;
    const fillWith = (z) => (z <= LAVA_LEVEL ? B.LAVA : B.AIR);
    for (let z = 2; z < h; z++) {
      if (!open(get(z))) continue;
      let top = z;
      while (top + 1 <= h && open(get(top + 1))) top++;
      if (top >= h) break; // opens to the sky: not a pocket
      let need = MIN_CAVE_HEIGHT - (top - z + 1);
      while (need > 0 && top + 1 < h && get(top + 1) !== B.BEDROCK) { top++; set(top, fillWith(top)); need--; }
      for (let zz = z - 1; need > 0 && zz >= 4 && get(zz) !== B.BEDROCK; zz--, need--) set(zz, fillWith(zz));
      z = top;
    }

    // Static water up to sea level.
    for (let z = h + 1; z <= SEA_LEVEL; z++) {
      set(z, z === SEA_LEVEL && biome === BIOME.FROZEN_OCEAN ? B.ICE : B.WATER);
    }
  }

  placeOres(chunk, rand, cols) {
    const veins = [
      { id: B.COAL_ORE, count: 18, size: 9, maxZ: WORLD_H, minZ: 5 },
      { id: B.IRON_ORE, count: 12, size: 6, maxZ: SEA_LEVEL + 8, minZ: 4 },
      { id: B.GOLD_ORE, count: 3, size: 5, maxZ: 30, minZ: 4 },
      { id: B.DIAMOND_ORE, count: 1.2, size: 4, maxZ: 16, minZ: 4 },
    ];
    for (const v of veins) {
      let n = Math.floor(v.count) + (rand() < v.count % 1 ? 1 : 0);
      while (n-- > 0) {
        let x = Math.floor(rand() * CHUNK), y = Math.floor(rand() * CHUNK);
        const h = cols[y * CHUNK + x].h;
        const top = Math.min(v.maxZ, h - 2);
        if (top <= v.minZ) continue;
        let z = v.minZ + Math.floor(rand() * (top - v.minZ));
        for (let i = 0; i < v.size; i++) {
          if (x >= 0 && x < CHUNK && y >= 0 && y < CHUNK && z > 0 && z < WORLD_H) {
            const idx = Chunk.index(x, y, z);
            if (chunk.blocks[idx] === B.STONE) chunk.blocks[idx] = v.id;
          }
          const axis = Math.floor(rand() * 3), dir = rand() < 0.5 ? -1 : 1;
          if (axis === 0) x += dir; else if (axis === 1) y += dir; else z += dir;
        }
      }
    }
  }

  // Trees can overhang chunk borders, so look at origins in a margin around the
  // chunk and only write blocks that land inside it.
  placeTrees(chunk, ox, oy) {
    const M = 3;
    for (let y = oy - M; y < oy + CHUNK + M; y++) {
      for (let x = ox - M; x < ox + CHUNK + M; x++) {
        const r = hash3(x, y, this.seed + 77);
        if (r > 0.08) continue; // fast reject before computing the column
        const col = this.column(x, y);
        let density = 0, kind = 'oak';
        switch (col.biome) {
          case BIOME.FOREST: density = 0.06; break;
          case BIOME.PLAINS: density = 0.004; break;
          case BIOME.TAIGA: density = 0.05; kind = 'spruce'; break;
          case BIOME.SNOWY: density = 0.008; kind = 'spruce'; break;
          case BIOME.MOUNTAINS: density = col.h < SEA_LEVEL + 28 ? 0.01 : 0; kind = 'spruce'; break;
          case BIOME.DESERT: density = 0.006; kind = 'cactus'; break;
        }
        if (r >= density || col.h <= SEA_LEVEL) continue;
        if (this.isCave(x, y, col.h, col.h) || this.isCave(x, y, col.h - 1, col.h)) continue;
        if (this.nearEntrance(x, y)) continue;

        const r2 = hash3(x, y, this.seed + 91);
        if (kind === 'oak') this.oak(chunk, ox, oy, x, y, col.h, r2);
        else if (kind === 'spruce') this.spruce(chunk, ox, oy, x, y, col.h, r2);
        else this.cactus(chunk, ox, oy, x, y, col.h, r2);
      }
    }
  }

  _put(chunk, ox, oy, x, y, z, id, onlyAir) {
    const lx = x - ox, ly = y - oy;
    if (lx < 0 || ly < 0 || lx >= CHUNK || ly >= CHUNK || z < 0 || z >= WORLD_H) return;
    const i = Chunk.index(lx, ly, z);
    if (onlyAir && chunk.blocks[i] !== B.AIR) return;
    chunk.blocks[i] = id;
  }

  oak(chunk, ox, oy, x, y, h, r) {
    const trunk = 4 + Math.floor(r * 3);
    const topZ = h + trunk;
    for (let dz = -1; dz <= 1; dz++) {
      const z = topZ + dz;
      const rad = dz === 1 ? 1 : 2;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) === rad && Math.abs(dy) === rad && (dz === 1 || hash3(x + dx, y + dy, z) < 0.5)) continue;
          this._put(chunk, ox, oy, x + dx, y + dy, z, B.OAK_LEAVES, true);
        }
      }
    }
    this._put(chunk, ox, oy, x, y, topZ + 2, B.OAK_LEAVES, true);
    for (let z = h + 1; z <= topZ; z++) this._put(chunk, ox, oy, x, y, z, B.OAK_LOG, false);
    this._put(chunk, ox, oy, x, y, h, B.DIRT, false);
    // Some oaks carry a beehive on the south side of the trunk, just under the canopy.
    if (hash3(x, y, this.seed + 555) < BEEHIVE_CHANCE) this._put(chunk, ox, oy, x, y + 1, topZ - 2, B.BEEHIVE, true);
  }

  spruce(chunk, ox, oy, x, y, h, r) {
    const trunk = 6 + Math.floor(r * 3);
    const topZ = h + trunk;
    for (let z = h + 3; z <= topZ + 1; z++) {
      const fromTop = topZ + 1 - z;
      const rad = fromTop === 0 ? 0 : (fromTop % 2 === 1 ? 1 : 2);
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (rad === 2 && Math.abs(dx) === 2 && Math.abs(dy) === 2) continue;
          this._put(chunk, ox, oy, x + dx, y + dy, z, B.SPRUCE_LEAVES, true);
        }
      }
    }
    for (let z = h + 1; z <= topZ; z++) this._put(chunk, ox, oy, x, y, z, B.SPRUCE_LOG, false);
    this._put(chunk, ox, oy, x, y, h, B.DIRT, false);
  }

  cactus(chunk, ox, oy, x, y, h, r) {
    const tall = 1 + Math.floor(r * 3);
    for (let z = h + 1; z <= h + tall; z++) this._put(chunk, ox, oy, x, y, z, B.CACTUS, true);
  }

  placeDecorations(chunk, ox, oy, cols) {
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const { h, biome } = cols[ly * CHUNK + lx];
        if (h + 1 >= WORLD_H || h < SEA_LEVEL) continue;
        const ground = chunk.blocks[Chunk.index(lx, ly, h)];
        const above = Chunk.index(lx, ly, h + 1);
        if (chunk.blocks[above] !== B.AIR) continue;
        const r = hash3(ox + lx, oy + ly, this.seed + 123);
        let id = B.AIR;
        if (ground === B.GRASS) {
          const grass = biome === BIOME.PLAINS ? 0.18 : biome === BIOME.FOREST ? 0.1 : 0.05;
          if (r < 0.015) id = B.FLOWER_RED;
          else if (r < 0.03) id = B.FLOWER_YELLOW;
          else if (r < 0.03 + grass) id = B.TALL_GRASS;
        } else if (ground === B.SAND && biome === BIOME.DESERT && r < 0.01) {
          id = B.DEAD_BUSH;
        }
        if (id) chunk.blocks[above] = id;
      }
    }
  }

  // Find a dry land column near the origin to spawn on.
  findSpawn() {
    for (let r = 0; r < 2000; r += 8) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos(a / 16 * Math.PI * 2) * r);
        const y = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
        const col = this.column(x, y);
        if (col.h > SEA_LEVEL && col.biome !== BIOME.MOUNTAINS && !this.isCave(x, y, col.h, col.h)) {
          return { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
    return { x: 0.5, y: 0.5 };
  }
}
