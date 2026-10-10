// Chunked voxel storage. The world is infinite on X/Y and WORLD_H layers tall (Z).
// Z is "up": layer 0 is bedrock, the player walks on layer z standing on block z-1.

const CHUNK = 16;
const WORLD_H = 96;
const SEA_LEVEL = 48;

class Chunk {
  constructor(cx, cy) {
    this.cx = cx;
    this.cy = cy;
    this.blocks = new Uint8Array(CHUNK * CHUNK * WORLD_H);
    // Highest light-blocking block per column (-1 = none). Used for sky light and roof detection.
    this.top = new Int16Array(CHUNK * CHUNK).fill(-1);
    // Indices of light-emitting blocks (torches, lava) and of gun towers.
    this.lights = new Set();
    this.turrets = new Set();
    this.modified = false;
  }

  static index(x, y, z) {
    return (z * CHUNK + y) * CHUNK + x;
  }

  get(x, y, z) {
    return this.blocks[(z * CHUNK + y) * CHUNK + x];
  }

  set(x, y, z, id) {
    const i = (z * CHUNK + y) * CHUNK + x;
    const old = this.blocks[i];
    if (old === id) return;
    this.blocks[i] = id;
    if (BLOCKS[old].light) this.lights.delete(i);
    if (BLOCKS[id].light) this.lights.add(i);
    if (BLOCKS[old].turret) this.turrets.delete(i);
    if (BLOCKS[id].turret) this.turrets.add(i);
    const ci = y * CHUNK + x;
    if (BLOCKS[id].opaque) {
      if (z > this.top[ci]) this.top[ci] = z;
    } else if (z === this.top[ci]) {
      this.recomputeTop(x, y);
    }
  }

  recomputeTop(x, y) {
    let z = WORLD_H - 1;
    while (z >= 0 && !BLOCKS[this.blocks[(z * CHUNK + y) * CHUNK + x]].opaque) z--;
    this.top[y * CHUNK + x] = z;
  }

  recomputeAll() {
    this.lights.clear();
    this.turrets.clear();
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) this.recomputeTop(x, y);
    for (let i = 0; i < this.blocks.length; i++) {
      const b = BLOCKS[this.blocks[i]];
      if (b.light) this.lights.add(i);
      if (b.turret) this.turrets.add(i);
    }
  }
}

class World {
  // `saved` (optional): Map "cx,cy" -> compressed chunk bytes from SaveStore.
  constructor(seed, saved) {
    this.seed = seed;
    this.gen = new WorldGen(seed);
    this.chunks = new Map();
    this.saved = saved || new Map();
    this._lastKey = null;
    this._lastChunk = null;
  }

  // Chunks changed since the last save (clears their dirty flag).
  takeDirtyChunks() {
    const out = [];
    for (const c of this.chunks.values()) if (c.dirty) { c.dirty = false; out.push(c); }
    return out;
  }

  static key(cx, cy) {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  getChunk(cx, cy) {
    const key = World.key(cx, cy);
    if (key === this._lastKey) return this._lastChunk;
    let c = this.chunks.get(key);
    if (!c) {
      c = new Chunk(cx, cy);
      // A chunk the player changed is restored from the save; otherwise generated from the seed.
      const data = this.saved.get(cx + ',' + cy);
      const restored = data ? SaveStore.decode(data, c.blocks.length) : null;
      if (restored) {
        c.blocks.set(restored);
        c.modified = true;
        c.savedBytes = data.length;
      } else {
        this.gen.generate(c);
      }
      c.recomputeAll();
      this.chunks.set(key, c);
    }
    this._lastKey = key;
    this._lastChunk = c;
    return c;
  }

  hasChunk(cx, cy) {
    return this.chunks.has(World.key(cx, cy));
  }

  getBlock(x, y, z) {
    if (z < 0) return B.BEDROCK;
    if (z >= WORLD_H) return B.AIR;
    return this.getChunk(x >> 4, y >> 4).get(x & 15, y & 15, z);
  }

  setBlock(x, y, z, id) {
    if (z < 0 || z >= WORLD_H) return;
    const c = this.getChunk(x >> 4, y >> 4);
    c.set(x & 15, y & 15, z, id);
    c.modified = true;
    c.dirty = true;
  }

  // Highest light-blocking layer in this column.
  topAt(x, y) {
    return this.getChunk(x >> 4, y >> 4).top[(y & 15) * CHUNK + (x & 15)];
  }

  isSolid(x, y, z) {
    return BLOCKS[this.getBlock(x, y, z)].solid;
  }

  // Panels (bars, fences, panes) stand on cell edges. Is the edge between (x, y) and its
  // neighbour toward d closed by one at layer z? It may be stored in either cell.
  edgeClosed(x, y, z, d) {
    const [dx, dy] = DIR_STEP[d];
    return !!(BLOCKS[this.getBlock(x, y, z)].edges & EDGE_BIT[d]) ||
      !!(BLOCKS[this.getBlock(x + dx, y + dy, z)].edges & EDGE_BIT[OPPOSITE[d]]);
  }

  // Can something get from (x, y) to the tile (x + dx, y + dy) next to it (diagonals too)
  // at layers z0..z1 without crossing a panel? A diagonal needs one open way round the corner.
  crossable(x, y, dx, dy, z0, z1) {
    const ex = dx > 0 ? 'e' : 'w', ey = dy > 0 ? 's' : 'n';
    for (let z = z0; z <= z1; z++) {
      if (dx && dy) {
        const viaX = !this.edgeClosed(x, y, z, ex) && !this.edgeClosed(x + dx, y, z, ey);
        const viaY = !this.edgeClosed(x, y, z, ey) && !this.edgeClosed(x, y + dy, z, ex);
        if (!viaX && !viaY) return false;
      } else if (this.edgeClosed(x, y, z, dx ? ex : ey)) {
        return false;
      }
    }
    return true;
  }

  // Calls cb(x, y, z, level) for every light source within `r` tiles horizontally.
  forEachLight(x, y, r, cb) {
    this.forEachIn('lights', x, y, r, (bx, by, bz, id) => cb(bx, by, bz, BLOCKS[id].light));
  }

  // Calls cb(x, y, z) for every gun tower within `r` tiles horizontally.
  forEachTurret(x, y, r, cb) {
    this.forEachIn('turrets', x, y, r, cb);
  }

  // Walks one of the chunks' block index sets (`lights` / `turrets`) in loaded chunks near (x, y).
  forEachIn(set, x, y, r, cb) {
    const cx0 = (x - r) >> 4, cx1 = (x + r) >> 4;
    const cy0 = (y - r) >> 4, cy1 = (y + r) >> 4;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.hasChunk(cx, cy)) continue;
        const c = this.getChunk(cx, cy);
        for (const i of c[set]) cb(cx * CHUNK + (i & 15), cy * CHUNK + ((i >> 4) & 15), i >> 8, c.blocks[i]);
      }
    }
  }

  // Generate chunks around a point, at most `budget` per call (avoids frame hitches).
  preload(x, y, radiusChunks, budget) {
    const pcx = Math.floor(x) >> 4, pcy = Math.floor(y) >> 4;
    let made = 0;
    for (let r = 0; r <= radiusChunks; r++) {
      for (let cy = pcy - r; cy <= pcy + r; cy++) {
        for (let cx = pcx - r; cx <= pcx + r; cx++) {
          if (Math.max(Math.abs(cx - pcx), Math.abs(cy - pcy)) !== r) continue;
          if (!this.hasChunk(cx, cy)) {
            this.getChunk(cx, cy);
            if (++made >= budget) return;
          }
        }
      }
    }
  }
}
