// Tibia-style top-down renderer.
//
// The camera looks down at the "view layer" V (normally the layer the player
// stands on). Each map column is drawn as its highest visible block using
// Tibia's oblique projection: a block E layers above the floor (V-1) is drawn
// shifted E*ELEV tiles up-left, exposing its south and east faces; layers
// below the floor shift down-right (like looking down a hole in Tibia).
// Layers above V are cut off when the player is under a roof / in a cave, and
// solid rock sliced by the cut is drawn black so open space reads clearly.
//
// Mirrored view (M): the camera swings round to look from the north-west, i.e.
// the map is turned 180 degrees. Drawing works in "view space": view tile (u, v)
// shows world column (vt(u), vt(v)), and the faces drawn as south / east on
// screen are the world's north / west faces.

const VIEW_W = 15;        // Tibia's classic 15 x 11 tile field of view
const VIEW_H = 11;
const ELEV = 0.4;         // diagonal screen offset per layer of height, in tiles
const DEPTH_SCAN = 10;    // how many layers below the floor you can see into holes
const DEPTH_CLAMP = 2;    // lower layers stop shifting after this many (keeps holes readable)
const SHOW_ABOVE = 5;     // layers above V drawn when the player is outdoors
const LEAF_CLEAR_R = 3;   // leaves drawn within this many tiles of the player are hidden
const MAX_VIEW_TILES = 48; // widest view allowed when zoomed far out (keeps it fast)
const FULL_STRIP = [[0, 0, 16, 16]];
const TOP_HALF = [[0, 0, 16, 8]];
const MOB_BELOW_LIMIT = 2; // mobs this many layers (or more) below the player aren't drawn
const TORCH_SCALE = 1 / (16 * MODEL_UNIT); // torch models at 16 units per tile (block texel size)
const TORCH_TILT = Math.PI / 4; // how far a wall torch leans out from its wall
const TORCH_WALL_LIFT = 0.3;    // a wall torch's foot, in layers above the floor of its cell
const TORCH_SOUTH_OUT = 0.06;   // extra tiles a camera-facing wall torch stands off its wall
const TORCH_SOUTH_TILT = Math.atan(1 / (MODEL_Q - MODEL_K)); // lean (~81 degrees) that draws as 45 degrees on screen
// Panel tops: colour, thickness (texels) and which stretches along the edge have one.
const PANEL_STYLE = {
  bars: { cap: '#7d838a', thick: 2, caps: [[0, 16]] },
  fence: { cap: '#c49a62', thick: 3, caps: [[0, 3], [13, 16]] },
  glass: { cap: 'rgba(220,240,255,0.55)', thick: 1.5, caps: [[0, 16]] },
};

class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.picks = [];      // draw-ordered hit regions for mouse picking
    this.cols = [];
    this.flip = false;    // mirrored view this frame
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Zoom follows the browser zoom (Ctrl +/-, Ctrl+wheel). The canvas always renders
  // at device resolution; at the zoom level the page loaded with, the classic 15x11
  // Tibia view fits the window. Zooming out shrinks tiles (more world in view),
  // zooming in enlarges them. The DOM HUD is counter-scaled so it stays the same size.
  resize() {
    const dpr = window.devicePixelRatio || 1;
    if (!this.baseDpr) this.baseDpr = dpr;
    this.dpr = dpr;
    this.zoom = dpr / this.baseDpr;
    const W = Math.round(window.innerWidth * dpr), Hh = Math.round(window.innerHeight * dpr);
    this.canvas.width = W;
    this.canvas.height = Hh;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    // The 15:11 frame, letterboxed inside the window.
    const frameW = Math.min(W, Math.floor(Hh * VIEW_W / VIEW_H)), frameH = Math.min(Hh, Math.floor(W * VIEW_H / VIEW_W));
    const baseT = Math.min(frameW / VIEW_W, frameH / VIEW_H);
    this.T = Math.max(4, Math.ceil(frameW / MAX_VIEW_TILES), Math.round(baseT * this.zoom));
    this.vpW = frameW; this.vpH = frameH;
    this.vpX = Math.floor((W - frameW) / 2);
    this.vpY = Math.floor((Hh - frameH) / 2);
    this.viewW = frameW / this.T;
    this.viewH = frameH / this.T;
    this.ctx.imageSmoothingEnabled = false;
    document.documentElement.style.setProperty('--ui', String(1 / this.zoom));
  }

  // World tile <-> view tile (the mapping is its own inverse), world position ->
  // view position, and a world compass direction -> the one it appears as on screen.
  vt(n) { return this.flip ? -1 - n : n; }
  vp(n) { return this.flip ? -n : n; }
  viewDir(d) { return this.flip ? { n: 's', s: 'n', e: 'w', w: 'e' }[d] : d; }

  // Find what is visible looking down a column from maxZ.
  // `ups` lists the upright objects (torches, lamps) above the top, highest first.
  scanColumn(x, y, maxZ, minZ) {
    const w = this.game.world;
    let deco = 0, decoZ = -1, liquidTop = -1, liquidCount = 0, ups = null;
    for (let z = maxZ; z >= minZ; z--) {
      const id = w.getBlock(x, y, z);
      if (id === B.AIR) continue;
      const b = BLOCKS[id];
      if (b.leaves && this.isHiddenLeaf(x, y, z)) continue;
      if (b.decoration) {
        if (liquidTop >= 0) continue;
        if (b.upright) (ups || (ups = [])).push({ z, id });
        else if (!deco) { deco = id; decoZ = z; }
        continue;
      }
      if (id === B.WATER) { if (liquidTop < 0) liquidTop = z; liquidCount++; continue; }
      if (id === B.GLASS && liquidTop >= 0) continue;
      return { t: z, id, deco, decoZ, ups, liquidTop, liquidCount, surf: Math.max(z, liquidTop), lower: this.scanLower(x, y, z, minZ) };
    }
    return { t: -999, id: 0, deco, decoZ, ups, liquidTop, liquidCount, surf: liquidTop >= 0 ? liquidTop : -999 };
  }

  // Leaves around the player are cleared away (like Tibia hides roofs) so trunks stay visible.
  // Checked both where the leaf really is and where it's drawn (high canopy shifts up-left).
  isHiddenLeaf(x, y, z) {
    if (!this.leafClear || z < this.clearZ || !BLOCKS[this.game.world.getBlock(x, y, z)].leaves) return false;
    const R2 = LEAF_CLEAR_R * LEAF_CLEAR_R;
    const lift = (z - this.floorZ) * ELEV;
    const rx = this.vp(x + 0.5) - this.clearX, ry = this.vp(y + 0.5) - this.clearY;
    return rx * rx + ry * ry < R2 || (rx - lift) ** 2 + (ry - lift) ** 2 < R2;
  }

  // Opaque for drawing purposes (hidden leaves count as open air).
  solidView(x, y, z) {
    return BLOCKS[this.game.world.getBlock(x, y, z)].opaque && !this.isHiddenLeaf(x, y, z);
  }

  // Under a raised top block there may be an air gap (a floating trunk after you
  // chop its base, a ledge you've dug under). Find the floor you'd see through it.
  // Returns every surface seen through stacked gaps, highest first (or null).
  scanLower(x, y, t, minZ) {
    const w = this.game.world;
    const out = [];
    let z = t - 1;
    // Gaps hidden inside solid ground get painted over by the columns in front, so
    // it's safe to look down the visible depth range. For ordinary ground (top at or
    // below the floor) only short floating runs matter, which keeps this cheap.
    const maxRun = t > this.floorZ ? Infinity : 3;
    for (;;) {
      let run = 0;
      while (z >= minZ && this.solidView(x, y, z) && run < maxRun) { z--; run++; }
      if (z < minZ || (run >= maxRun && this.solidView(x, y, z))) break;
      const gapTop = z;
      let found = null;
      for (; z >= minZ; z--) {
        const id = w.getBlock(x, y, z);
        if (this.solidView(x, y, z) || id === B.WATER) { found = { t: z, id, gapTop }; break; }
      }
      if (!found) break;
      out.push(found);
      if (found.id === B.WATER || found.t <= this.floorZ - DEPTH_CLAMP) break;
      z = found.t - 1;
    }
    return out.length ? out : null;
  }

  static edraw(e) {
    return e >= 0 ? e : Math.max(e, -DEPTH_CLAMP);
  }

  render() {
    const g = this.game, ctx = this.ctx, w = g.world, p = g.player;
    const T = this.T, H = Math.round(T * ELEV);
    const V = g.viewZ;
    const floorZ = V - 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    Textures.animate(performance.now() / 1000);

    // Everything below is laid out in view space (see the top of this file).
    this.flip = g.mirrored;
    const camX = this.vp(p.x), camY = this.vp(p.y);
    // While the player eases between layers the view layer has already switched;
    // shift the scene by the remaining difference so the camera glides instead of snapping.
    const camE = (p.visualZ - p.z) * H;
    const ox = Math.round(this.vpX + this.vpW / 2 - camX * T + camE);
    const oy = Math.round(this.vpY + this.vpH / 2 - camY * T + camE);

    const above = g.visibleAbove();
    const cutting = g.cutActive();
    const maxZ = Math.min(WORLD_H - 1, V + above);
    const minZ = Math.max(0, floorZ - DEPTH_SCAN);
    this.maxZ = maxZ;
    this.floorZ = floorZ;
    this.clearX = camX; this.clearY = camY; this.clearZ = p.z;
    this.leafClear = Settings.get('leafClear');
    this.climbable = this.findClimbable();
    // Outdoors, stuff above the cut (tall trees, peaks) shouldn't shade what's drawn;
    // when viewing a different layer on purpose, show that slice lit.
    this.lightCap = (!cutting || g.viewOffset !== 0) ? maxZ : Infinity;

    const lift = Math.ceil((above + 1) * ELEV) + 1;  // raised stuff slides in from the south-east
    const sink = DEPTH_CLAMP;                         // sunken stuff slides in from the north-west
    const x0 = Math.floor(camX - this.viewW / 2) - 1 - sink, x1 = Math.ceil(camX + this.viewW / 2) + 1 + lift;
    const y0 = Math.floor(camY - this.viewH / 2) - 1 - sink, y1 = Math.ceil(camY + this.viewH / 2) + 1 + lift;
    const CW = x1 - x0 + 2;

    // Pass 1: scan columns (one extra row/column south-east for face neighbours).
    // x, y here and in pass 2 are view tiles.
    const cols = this.cols;
    cols.length = 0;
    for (let y = y0; y <= y1 + 1; y++) {
      for (let x = x0; x <= x1 + 1; x++) {
        const wx = this.vt(x), wy = this.vt(y);
        const c = this.scanColumn(wx, wy, maxZ, minZ);
        c.eTop = c.surf === -999 ? -DEPTH_CLAMP : Renderer.edraw(c.surf - floorZ);
        // Sliced by the cut-off plane (drawn black), but never tree parts, so trunks stay readable.
        const over = maxZ + 1 < WORLD_H ? BLOCKS[w.getBlock(wx, wy, maxZ + 1)] : BLOCKS[B.AIR];
        c.cut = cutting && c.surf === maxZ && over.opaque && !over.leaves && !over.log && !BLOCKS[c.id].log;
        cols.push(c);
      }
    }
    const colAt = (x, y) => (x < x0 || x > x1 + 1 || y < y0 || y > y1 + 1) ? null : cols[(y - y0) * CW + (x - x0)];

    // Entities are painted right after the south-east-most tile their sprite
    // overlaps, so ground tiles they cross never paint over them, while walls
    // in front of them still do.
    // Creatures and items only render within ENTITY_RANGE tiles, however far you zoom out.
    const ents = new Map();
    for (const e of g.allEntities()) {
      if (e !== p && e.distTo(p) > ENTITY_RANGE) continue;
      const k = Math.floor(this.vp(e.x) + 0.499) + ',' + Math.floor(this.vp(e.y) + 0.499);
      if (!ents.has(k)) ents.set(k, []);
      ents.get(k).push(e);
    }

    this.picks.length = 0;
    this.glows = [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.vpX, this.vpY, this.vpW, this.vpH);
    ctx.clip();

    let playerDrawn = false;
    const drawnMobs = [], outlined = [];

    // Pass 2: paint north -> south, west -> east (back to front for this projection).
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = colAt(x, y);
        this.drawColumn(x, y, c, colAt(x, y + 1), colAt(x + 1, y), colAt, ox, oy, T, H, floorZ);
        const here = ents.get(x + ',' + y);
        if (!here) continue;
        here.sort((a, b) => this.vp(a.y) - this.vp(b.y));
        for (const e of here) {
          const mob = e instanceof Mob;
          if (mob && e.z <= p.z - MOB_BELOW_LIMIT) continue; // too far below to show
          const own = colAt(this.vt(e.tx), this.vt(e.ty));
          const underGap = own && own.lower && own.lower.some((lw) => lw.t < e.z && e.z <= lw.gapTop);
          const visible = own && (own.t < e.z || underGap) && e.z <= maxZ + 1;
          if (!visible) {
            if (mob && e.z <= maxZ + 1) outlined.push({ e }); // completely hidden under something
            continue;
          }
          const idx = this.picks.length;
          this.drawEntity(e, ox, oy, T, H, V);
          if (mob) drawnMobs.push({ e, idx, rect: this.lastSprite });
          if (e === p) playerDrawn = true;
        }
      }
    }

    // Mobs that walked behind a block (something at their height or above was
    // painted over them afterwards) get a faint red outline drawn on top.
    for (const d of drawnMobs) {
      const r = d.rect, area = r.w * r.h;
      for (let i = d.idx + 1; i < this.picks.length; i++) {
        const q = this.picks[i];
        if (q.kind !== 'tile' || q.shape === 'box' || q.edge || q.z < d.e.z) continue; // torches, lamps, bars etc. don't hide a mob
        const bw = q.shape === 'south' ? q.T + q.H : q.shape === 'east' ? q.H : q.T;
        const bh = q.shape === 'south' ? q.H : q.shape === 'east' ? q.T + q.H : q.T;
        const ix = Math.min(r.x + r.w, q.px + bw) - Math.max(r.x, q.px);
        const iy = Math.min(r.y + r.h, q.py + bh) - Math.max(r.y, q.py);
        if (ix > 0 && iy > 0 && ix * iy > area * 0.12) { outlined.push(d); break; }
      }
    }
    for (const d of outlined) this.drawMobOutline(d.e, ox, oy, T, H, V);

    // Faint silhouette on top of everything so walls in front never hide the player
    // (invisible when nothing covers them; stronger when viewing another layer).
    ctx.globalAlpha = playerDrawn ? 0.35 : 0.5;
    this.drawEntity(p, ox, oy, T, H, V, true);
    ctx.globalAlpha = 1;

    this.drawProjectiles(ctx, ox, oy, T, H, V);
    this.drawTargeting(ctx);
    this.drawParticles(ctx, ox, oy, T, H, V);

    // Night tint.
    const night = 1 - g.daylight;
    if (night > 0.05) {
      ctx.fillStyle = `rgba(10,20,60,${night * 0.22})`;
      ctx.fillRect(this.vpX, this.vpY, this.vpW, this.vpH);
    }
    this.drawGlows(ctx, T);

    this.drawWeather(ctx, T);

    ctx.restore();
  }

  // (x, y) is the view tile; (wx, wy) the world column it shows.
  drawColumn(x, y, c, south, east, colAt, ox, oy, T, H, floorZ) {
    const ctx = this.ctx, g = this.game;
    const wx = this.vt(x), wy = this.vt(y);
    const off = c.eTop * H;
    const sx = ox + x * T - off;
    const sy = oy + y * T - off;
    this.drawEdgePanels(x, y, c, colAt, ox, oy, T, H, floorZ);

    if (c.surf === -999) {
      ctx.fillStyle = '#000';
      ctx.fillRect(sx, sy, T, T);
      if (c.ups) this.drawUprights(x, y, c.ups, ox, oy, T, H, floorZ); // a torch on a wall above a void
      return;
    }

    const depth = Math.max(0, floorZ - c.surf);
    const depthDim = 1 - Math.min(0.75, depth * 0.11);

    if (c.lower) for (let i = c.lower.length - 1; i >= 0; i--) this.drawLower(x, y, c.lower[i], ox, oy, T, H, floorZ);

    // Top face.
    if (c.cut) {
      // Solid rock sliced by the cut-off plane: black, with a faint hint at cave edges.
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = colAt(x + dx, y + dy);
          if (n && !n.cut) { edge = true; break; }
        }
      }
      ctx.fillStyle = '#000';
      ctx.fillRect(sx, sy, T, T);
      if (edge) {
        ctx.globalAlpha = 0.18;
        ctx.drawImage(Textures.top[c.id], sx, sy, T, T);
        ctx.globalAlpha = 1;
      }
    } else {
      const light = g.lightAt(wx, wy, c.surf + 1, this.lightCap) * depthDim;
      if (c.t !== -999 && BLOCKS[c.id].stairs && c.surf === c.t) {
        this.drawStairTop(c, sx, sy, T, H, light);
      } else if (c.t !== -999) ctx.drawImage(Textures.top[c.id], sx, sy, T, T);
      else { ctx.fillStyle = '#000'; ctx.fillRect(sx, sy, T, T); }
      if (c.liquidTop >= 0) {
        ctx.globalAlpha = Math.min(0.92, 0.5 + c.liquidCount * 0.06);
        ctx.drawImage(Textures.top[B.WATER], sx, sy, T, T);
        ctx.globalAlpha = 1;
      }
      if (c.deco && c.decoZ === c.surf + 1) ctx.drawImage(Textures.top[c.deco], sx, sy, T, T);
      const isStair = c.t !== -999 && BLOCKS[c.id].stairs && c.surf === c.t; // lit inside drawStairTop
      if (light < 0.999 && !isStair) {
        ctx.fillStyle = `rgba(0,0,0,${1 - light})`;
        ctx.fillRect(sx, sy, T, T);
      }
    }

    if (c.t !== -999 && !c.cut) {
      if (Settings.get('outlines')) this.drawHeightCues(c, colAt(x, y - 1), colAt(x - 1, y), south, east, sx, sy, T);
      // Underground climb hint: a light blue wash on blocks you can step up onto.
      if (this.climbable && this.climbable.has(wx + ',' + wy) && c.t === g.player.z) {
        ctx.fillStyle = 'rgba(110,195,255,0.36)';
        ctx.fillRect(sx, sy, T, T);
        const lw = Math.max(1, Math.round(T / 28));
        ctx.strokeStyle = 'rgba(165,220,255,0.85)';
        ctx.lineWidth = lw;
        ctx.strokeRect(sx + lw / 2, sy + lw / 2, T - lw, T - lw);
      }
    }

    const pickZ = c.t;
    if (pickZ !== -999) this.picks.push({ kind: 'tile', x: wx, y: wy, z: pickZ, face: 'top', shape: 'top', px: sx, py: sy, T, H });
    if (c.deco && c.decoZ === c.surf + 1 && BLOCKS[c.deco].hardness === 0) {
      // Decorations are targeted (and broken) before the block under them.
      this.picks.push({ kind: 'tile', x: wx, y: wy, z: c.decoZ, face: 'top', shape: 'top', px: sx, py: sy, T, H });
    }

    // Side faces reach down to the lowest floor visible in front of them (under an
    // overhang that's the floor beneath the gap); each strip is then drawn only
    // where this block is solid and the neighbour's block at that layer is not.
    const floorOf = (n) => (!n || n.surf === -999 ? -999 : n.lower ? n.lower[n.lower.length - 1].t : n.surf);
    const eFloor = (n) => { const f = floorOf(n); return f === -999 ? -DEPTH_CLAMP : Renderer.edraw(f - floorZ); };
    const eS = eFloor(south), eE = eFloor(east);
    // Each strip is lit by the air directly in front of it (see drawFace).
    if (c.eTop > eS) this.drawFace('south', wx, wy, c, c.eTop - eS, sx, sy + T, T, H, depthDim * 0.62, wx, this.vt(y + 1));
    if (c.eTop > eE) this.drawFace('east', wx, wy, c, c.eTop - eE, sx + T, sy, T, H, depthDim * 0.8, this.vt(x + 1), wy);
    if (c.ups) this.drawUprights(x, y, c.ups, ox, oy, T, H, floorZ);
  }

  // Torches and lamps stand (or hang) in their own cell like Tibia objects, lowest first.
  // They light themselves, so they're never shaded; in the dark their flame gets a
  // flickering glow (drawn later, on top). Each is clickable where it's drawn.
  drawUprights(x, y, ups, ox, oy, T, H, floorZ) {
    for (let i = ups.length - 1; i >= 0; i--) {
      const { z, id } = ups[i], b = BLOCKS[id];
      if (b.panel) continue; // drawn on their edges (drawEdgePanels)
      const off = Renderer.edraw(z - 1 - floorZ) * H;  // the cell's floor
      const gx = ox + (x + 0.5) * T - off, gy = oy + (y + 0.5) * T - off;
      if (b.torch) this.drawTorch(b, x, y, z, gx, gy, T, H);
      else this.drawSprite(id, x, y, z, gx, gy, T);
    }
  }

  // Panels (bars, fences, panes) standing on this view tile's north and west edges: its own,
  // and the neighbours' across those edges, lowest first, north before west. Drawn before the
  // tile, so whatever stands in it (and anything south / east) is in front of them.
  drawEdgePanels(x, y, c, colAt, ox, oy, T, H, floorZ) {
    let list = null;
    const take = (col, cx, cy, want) => {
      if (!col || !col.ups) return;
      for (const u of col.ups) {
        const b = BLOCKS[u.id];
        if (!b.panel) continue;
        for (const d of STAIR_DIRS) {
          const side = (b.edges & EDGE_BIT[d]) && want[this.viewDir(d)];
          if (side) (list || (list = [])).push({ z: u.z, side, kind: b.panel, x: this.vt(cx), y: this.vt(cy), edge: d });
        }
      }
    };
    take(c, x, y, { n: 'n', w: 'w' });
    take(colAt(x, y - 1), x, y - 1, { s: 'n' });
    take(colAt(x - 1, y), x - 1, y, { e: 'w' });
    if (!list) return;
    list.sort((a, b) => a.z - b.z || (a.side === 'n' ? -1 : 1));
    for (const p of list) this.drawPanel(p, x, y, ox, oy, T, H, floorZ);
  }

  // One panel: its texture on the vertical plane along the edge (like a block's south or east
  // face), plus a thin top so it reads as a slim wall. p.x, p.y, p.edge: where it's stored (world).
  drawPanel(p, x, y, ox, oy, T, H, floorZ) {
    const ctx = this.ctx, e = Renderer.edraw(p.z - floorZ);
    const px = ox + x * T - e * H, py = oy + y * T - e * H;
    const light = this.game.lightAt(p.x, p.y, p.z, this.lightCap);
    const s = T / 16, h = H / 16, north = p.side === 'n';
    if (north) ctx.setTransform(s, 0, h, h, px, py); else ctx.setTransform(0, s, h, h, px, py);
    ctx.drawImage(Textures.panelTex(p.kind, light), 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const st = PANEL_STYLE[p.kind], th = Math.max(1, st.thick * s);
    for (const [u0, u1] of st.caps) {
      const r = north ? [px + u0 * s, py - th / 2, (u1 - u0) * s, th] : [px - th / 2, py + u0 * s, th, (u1 - u0) * s];
      ctx.fillStyle = st.cap; ctx.fillRect(...r);
      if (light < 0.999) { ctx.fillStyle = `rgba(0,0,0,${(1 - light) * 0.9})`; ctx.fillRect(...r); }
    }
    this.picks.push({ kind: 'tile', x: p.x, y: p.y, z: p.z, face: 'top', edge: p.edge, shape: north ? 'south' : 'east', px, py, T, H });
  }

  // Lamp: flat side-view pixel art standing on the middle of the tile.
  drawSprite(id, x, y, z, gx, gy, T) {
    const spr = Textures.sprites[id], k = T / 16;
    const w = spr.width * k, h = spr.height * k;
    const px = Math.round(gx - w / 2), py = Math.round(gy + T * 0.12 - h);
    this.ctx.drawImage(spr, px, py, w, h);
    this.addGlow(x, y, z, px + (spr.glow[0] + 0.5) * k, py + (spr.glow[1] + 0.5) * k);
    const pw = Math.max(w, T * 0.5);
    this.picks.push({ kind: 'tile', x: this.vt(x), y: this.vt(y), z, face: 'top', shape: 'box', px: gx - pw / 2, py, T: pw, H: h });
  }

  // Torch: a shaded 3D stick (built and lit like the creature models) with an animated
  // pixel-art flame, Tibia-style. Standing torches sit in the middle of the tile; a wall
  // torch's foot is fixed to the block it hangs on and it sticks out at 45 degrees.
  drawTorch(b, x, y, z, gx, gy, T, H) {
    let bx = gx, by = gy, facing = Math.PI / 2, tilt = 0;
    if (b.wall) {
      const [dx, dy] = DIR_STEP[this.viewDir(b.wall)]; // toward the wall, on screen
      const lift = TORCH_WALL_LIFT * H;
      // Foot against the wall face (camera-facing ones a touch further out).
      const reach = dy < 0 ? 0.46 - TORCH_SOUTH_OUT : 0.46;
      bx = gx + dx * reach * T - lift; by = gy + dy * reach * T - lift;
      facing = Math.atan2(-dy, -dx); // facing away from the wall, leaning that way
      // Leaning toward the viewer foreshortens a torch into an upright stub, so a camera-facing
      // one leans further: that draws it as a clear 45-degree diagonal out from the wall.
      tilt = -(dy < 0 ? TORCH_SOUTH_TILT : TORCH_TILT);
    }
    drawModel3D(this.ctx, bx, by, T, facing, 'torch', { tilt }, 0, 0, TORCH_SCALE, null, { noShadow: true });

    const [tx, ty] = modelPoint(bx, by, T, facing, TORCH_SCALE, 0, 0, TORCH_LEN, [{ f: 0, z: 0, ang: tilt }]);
    const f = torchFlame(this.vt(x) * 7 + this.vt(y) * 13 + z * 3);
    const k = T / 16, fw = f.width * k, fh = f.height * k;
    const fx = Math.round(tx - fw / 2), fy = Math.round(ty + k * 0.6 - fh);
    this.ctx.drawImage(f, fx, fy, fw, fh);
    this.addGlow(x, y, z, tx, fy + fh * 0.55);

    const x0 = Math.min(bx, tx) - T * 0.22, x1 = Math.max(bx, tx) + T * 0.22;
    this.picks.push({ kind: 'tile', x: this.vt(x), y: this.vt(y), z, face: 'top', shape: 'box', px: x0, py: fy, T: x1 - x0, H: Math.max(by, ty) + k - fy });
  }

  // (x, y): view tile of the light; (sx, sy): where its flame is on screen.
  addGlow(x, y, z, sx, sy) {
    const g = this.game, wx = this.vt(x), wy = this.vt(y);
    const dark = 1 - g.skyAt(wx, wy, z, this.lightCap) * g.daylight;
    if (dark > 0.05) this.glows.push({ x: sx, y: sy, a: dark, seed: wx * 1.7 + wy * 2.3 + z });
  }

  drawGlows(ctx, T) {
    const now = performance.now() / 1000;
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.glows) {
      const flicker = 0.8 + 0.12 * Math.sin(now * 9 + l.seed) + 0.08 * Math.sin(now * 23 + l.seed * 3);
      const r = T * 0.75;
      const grad = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
      grad.addColorStop(0, `rgba(255,190,90,${0.5 * l.a * flicker})`);
      grad.addColorStop(0.35, `rgba(255,150,50,${0.18 * l.a * flicker})`);
      grad.addColorStop(1, 'rgba(255,150,50,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Height cues on a top face, so a 1-block step reads differently from a cliff:
  //  - edges where the ground drops away behind it (north / west): a thin dark line
  //    for a 1-block drop, a heavy one for 2+ (too high to climb);
  //  - a light lip where its side faces begin (south / east);
  //  - a soft contact shadow along edges where a neighbour rises above it.
  drawHeightCues(c, north, west, south, east, sx, sy, T) {
    const ctx = this.ctx;
    const heightOf = (n) => (!n || n.surf === -999 ? -999 : n.surf);
    const thin = Math.max(1, Math.round(T / 32)), thick = Math.max(2, Math.round(T / 11));
    const edge = (n, draw) => {
      const d = c.surf - heightOf(n);
      if (d >= 1) draw(d >= 2 ? thick : thin, d >= 2 ? 0.62 : 0.32);
    };
    edge(north, (w, a) => { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(sx, sy, T, w); });
    edge(west, (w, a) => { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(sx, sy, w, T); });
    edge(south, () => { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(sx, sy + T - thin, T, thin); });
    edge(east, () => { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(sx + T - thin, sy, thin, T); });

    // Contact shadows at the foot of higher neighbours.
    const ao = Renderer.aoTextures();
    const shadow = (n, tex) => {
      const d = heightOf(n) - c.surf;
      if (d < 1) return;
      ctx.globalAlpha = d >= 2 ? 0.5 : 0.3;
      ctx.drawImage(tex, sx, sy, T, T);
    };
    shadow(north, ao.n); shadow(west, ao.w); shadow(south, ao.s); shadow(east, ao.e);
    ctx.globalAlpha = 1;
  }

  // Edge gradients (dark at one edge, fading inward) for contact shadows.
  static aoTextures() {
    if (Renderer._ao) return Renderer._ao;
    const make = (x0, y0, x1, y1) => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
      return c;
    };
    Renderer._ao = { n: make(0, 0, 0, 11), w: make(0, 0, 11, 0), s: make(0, 32, 0, 24), e: make(32, 0, 24, 0) };
    return Renderer._ao;
  }

  // Which parts [u, v, w, h] (texture space, 16x16) of a side strip a stair fills.
  // South faces run u west->east, east faces run u north->south; the top half of
  // the strip is the upper step, which only covers the half it rises toward.
  static stairProfile(up, dir) {
    const bottom = [0, 8, 16, 8];
    const P = {
      south: { n: [bottom], s: FULL_STRIP, e: [bottom, [8, 0, 8, 8]], w: [bottom, [0, 0, 8, 8]] },
      east: { e: FULL_STRIP, w: [bottom], n: [bottom, [0, 0, 8, 8]], s: [bottom, [8, 0, 8, 8]] },
    };
    return P[dir][up];
  }

  // Top of a stair block: the lower step (half a layer down), the upper step on the
  // half it rises toward, and the riser between them when it faces the viewer.
  drawStairTop(c, sx, sy, T, H, light) {
    const ctx = this.ctx, up = this.viewDir(BLOCKS[c.id].stairs);
    const top = Textures.top[c.id], side = Textures.side[c.id];
    const half = T / 2, drop = H / 2;
    // [u, v, w, h] halves of the tile in texture space and on screen.
    const halves = {
      n: [[0, 8, 16, 8], [0, 0, 16, 8]], s: [[0, 0, 16, 8], [0, 8, 16, 8]],
      e: [[0, 0, 8, 16], [8, 0, 8, 16]], w: [[8, 0, 8, 16], [0, 0, 8, 16]],
    }[up];
    const draw = (r, dx, dy) => {
      const k = T / 16;
      ctx.drawImage(top, r[0], r[1], r[2], r[3], sx + r[0] * k + dx, sy + r[1] * k + dy, r[2] * k, r[3] * k);
      if (light < 0.999) { ctx.fillStyle = `rgba(0,0,0,${1 - light})`; ctx.fillRect(sx + r[0] * k + dx, sy + r[1] * k + dy, r[2] * k, r[3] * k); }
    };
    draw(halves[0], drop, drop);       // lower step
    draw(halves[1], 0, 0);             // upper step
    // Riser (the upper step's front) is visible when the stair rises north or west.
    const s = T / 16, h = H / 16, dark = `rgba(0,0,0,${1 - light * 0.72})`;
    if (up === 'n') ctx.setTransform(s, 0, h, h, sx, sy + half);
    else if (up === 'w') ctx.setTransform(0, s, h, h, sx + half, sy);
    else return;
    ctx.drawImage(side, 0, 0, 16, 8, 0, 0, 16, 8);
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, 16, 8);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // A south or east wall (on screen) made of `segs` one-layer strips, drawn as skewed
  // textures. `shadeK` scales the light for this side (south faces darker than east ones).
  // x, y and the neighbour in front (nx, ny) are world tiles.
  drawFace(dir, x, y, c, segs, fx, fy, T, H, shadeK, nx, ny) {
    const ctx = this.ctx, w = this.game.world, g = this.game;
    const s = T / 16, h = H / 16;
    const face = this.flip ? (dir === 'south' ? 'north' : 'west') : dir; // the world side it really is
    // Strips map 1:1 to layers unless the top itself is deep enough to be depth-clamped.
    const exact = c.surf - this.floorZ >= -DEPTH_CLAMP;
    const bands = Settings.get('outlines');
    for (let k = 0; k < segs; k++) {
      const z = c.surf - k;
      let id = z >= 0 ? w.getBlock(x, y, z) : B.BEDROCK;
      const b = BLOCKS[id];
      if (exact && ((!b.opaque && id !== B.GLASS && id !== B.WATER) || this.isHiddenLeaf(x, y, z))) continue; // air gap: leave it open
      // Stairs show their step profile on the side: only part of the strip is solid.
      let parts = b.stairs && exact ? Renderer.stairProfile(this.viewDir(b.stairs), dir) : FULL_STRIP;
      if (exact && this.solidView(nx, ny, z)) {
        // Covered by the neighbour, except above a stair's lower step when that step is against this face.
        const ns = BLOCKS[w.getBlock(nx, ny, z)].stairs;
        if (!ns || this.viewDir(ns) !== dir[0] || parts !== FULL_STRIP || id === B.WATER) continue;
        parts = TOP_HALF;
      }
      const px = fx + k * H, py = fy + k * H;
      if (dir === 'south') ctx.setTransform(s, 0, h, h, px, py);
      else ctx.setTransform(0, s, h, h, px, py);
      if (id === B.WATER) {
        ctx.globalAlpha = 0.7;
        ctx.drawImage(Textures.side[B.WATER], 0, 0);
        ctx.globalAlpha = 1;
      } else {
        if (!b.opaque && id !== B.GLASS) id = c.id || B.STONE;
        const tex = (dir === 'east' && Textures.east[id]) || Textures.side[id];
        for (const r of parts) ctx.drawImage(tex, r[0], r[1], r[2], r[3], r[0], r[1], r[2], r[3]);
        this.picks.push({ kind: 'tile', x, y, z, face, shape: dir, px, py, T, H });
      }
      // Lit by the open cell in front of this strip (fall back to the column top for clamped depths).
      const light = g.lightAt(nx, ny, exact ? z : c.surf + 1, this.lightCap) * shadeK;
      if (light < 0.999) {
        ctx.fillStyle = `rgba(0,0,0,${1 - light})`;
        for (const r of parts) ctx.fillRect(r[0], r[1], r[2], r[3]);
      }
      // One band per block: a dark seam at the bottom of each layer and a faint
      // highlight at its top, so you can count how many blocks tall a wall is.
      if (bands && id !== B.WATER) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(0, 14.6, 16, 1.4);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(0, 0, 16, 0.9);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // The floor seen through an air gap under a raised block (x, y: view tile).
  drawLower(x, y, lw, ox, oy, T, H, floorZ) {
    const ctx = this.ctx, wx = this.vt(x), wy = this.vt(y);
    const off = Renderer.edraw(lw.t - floorZ) * H;
    const lx = ox + x * T - off, ly = oy + y * T - off;
    ctx.drawImage(Textures.top[lw.id], lx, ly, T, T);
    const light = this.game.lightAt(wx, wy, lw.t + 1, this.lightCap);
    if (light < 0.999) {
      ctx.fillStyle = `rgba(0,0,0,${1 - light})`;
      ctx.fillRect(lx, ly, T, T);
    }
    if (lw.id !== B.WATER) this.picks.push({ kind: 'tile', x: wx, y: wy, z: lw.t, face: 'top', shape: 'top', px: lx, py: ly, T, H });
  }

  drawEntity(e, ox, oy, T, H, V, ghost = false) {
    const ctx = this.ctx;
    const off = Renderer.edraw(e.visualZ - V) * H;
    const sx = ox + this.vp(e.x) * T - off;
    const sy = oy + this.vp(e.y) * T - off;

    // Draw into a scratch canvas so lighting / hurt flash tint only the sprite's pixels.
    // Upright figures stand on (sx, sy) and extend upward, so the anchor sits low in the canvas
    // (with room above for a weapon swung overhead).
    const size = Math.ceil(T * 2.6);
    const ax = size / 2, ay = Math.round(size * 0.72);
    if (!this.ec || this.ec.width !== size) {
      this.ec = document.createElement('canvas');
      this.ec.width = this.ec.height = size;
    }
    const ec = this.ec.getContext('2d');
    ec.setTransform(1, 0, 0, 1, 0, 0);
    ec.clearRect(0, 0, size, size);
    ec.imageSmoothingEnabled = false;
    e.draw(ec, ax, ay, T, { turn: this.flip ? Math.PI : 0 }); // mirrored: models turn with the camera
    ec.globalCompositeOperation = 'source-atop';
    if (e.hurtTimer > 0.25) { ec.fillStyle = 'rgba(255,40,40,0.5)'; ec.fillRect(0, 0, size, size); }
    if (e.burning) { ec.fillStyle = `rgba(255,120,20,${0.2 + Math.random() * 0.12})`; ec.fillRect(0, 0, size, size); }
    const light = ghost || e.burning ? 1 : this.game.lightAt(e.tx, e.ty, e.z, this.lightCap);
    if (light < 0.99) { ec.fillStyle = `rgba(0,0,0,${(1 - light) * 0.92})`; ec.fillRect(0, 0, size, size); }
    ec.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.ec, Math.round(sx - ax), Math.round(sy - ay));

    const tall = e instanceof Mob && e.def.model === 'humanoid' ? 1.2 : e instanceof Mob ? 0.7 : 0.4;
    this.lastSprite = { x: sx - T * 0.38, y: sy - T * tall, w: T * 0.76, h: T * (tall + 0.15) };
    if (!ghost && e instanceof Mob && e.health < e.maxHealth) {
      const bw = T * 0.7, by = sy - T * (tall + 0.15);
      const bh = Math.max(3, Math.round(T / 16));
      ctx.fillStyle = '#300'; ctx.fillRect(sx - bw / 2, by, bw, bh);
      ctx.fillStyle = '#e33'; ctx.fillRect(sx - bw / 2, by, bw * e.health / e.maxHealth, bh);
    }
    // The player is never a click target (clicks pass through to the blocks around you).
    if (e === this.game.player) return;
    const r = T * 0.36;
    this.picks.push({ kind: 'entity', entity: e, shape: 'box', px: sx - r, py: sy - T * tall, T: r * 2, H: T * (tall + 0.25) });
  }

  // Faint red outline of a mob, drawn over whatever is hiding it.
  drawMobOutline(e, ox, oy, T, H, V) {
    const off = Renderer.edraw(e.visualZ - V) * H;
    const sx = ox + this.vp(e.x) * T - off, sy = oy + this.vp(e.y) * T - off;
    const size = Math.ceil(T * 2), ax = size / 2, ay = Math.round(size * 0.7);
    const mk = (key) => {
      if (!this[key] || this[key].width !== size) { this[key] = document.createElement('canvas'); this[key].width = this[key].height = size; }
      const c = this[key].getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, size, size);
      c.imageSmoothingEnabled = false;
      return c;
    };
    const sil = mk('silCanvas');
    e.draw(sil, ax, ay, T, { noShadow: true, turn: this.flip ? Math.PI : 0 });
    const ring = mk('ringCanvas');
    const t = Math.max(1, Math.round(T / 34));
    for (const [dx, dy] of [[-t, 0], [t, 0], [0, -t], [0, t], [-t, -t], [t, t], [-t, t], [t, -t]]) ring.drawImage(this.silCanvas, dx, dy);
    ring.globalCompositeOperation = 'source-in';
    ring.fillStyle = '#ff3030';
    ring.fillRect(0, 0, size, size);
    ring.globalCompositeOperation = 'destination-out';
    ring.drawImage(this.silCanvas, 0, 0);
    ring.globalCompositeOperation = 'source-over';
    // A whisper of red fill inside so the shape still reads.
    sil.globalCompositeOperation = 'source-in';
    sil.fillStyle = 'rgba(255,40,40,0.16)';
    sil.fillRect(0, 0, size, size);
    const ctx = this.ctx;
    ctx.globalAlpha = 0.6;
    ctx.drawImage(this.ringCanvas, Math.round(sx - ax), Math.round(sy - ay));
    ctx.drawImage(this.silCanvas, Math.round(sx - ax), Math.round(sy - ay));
    ctx.globalAlpha = 1;
  }

  // Gun tower arrows: a shaft with a grey head and white fletching, pointing the way it flies.
  // Placed like a creature part: over a ground layer that slides from the tower top to its
  // target's feet as it closes in, raised by its height above that (so it meets the target's body).
  drawProjectiles(ctx, ox, oy, T, H, V) {
    const up = T * 16 * MODEL_UNIT; // screen pixels per layer of height for upright figures
    const lw = Math.max(2, Math.round(T / 28));
    for (const a of this.game.projectiles) {
      const k = a.dist0 ? Math.max(0, Math.min(1, 1 - a.dist / a.dist0)) : 0;
      const ground = a.from + ((a.ground !== undefined ? a.ground : a.from) - a.from) * k;
      const off = Renderer.edraw(ground - V) * H;
      const x = ox + this.vp(a.x) * T - off, y = oy + this.vp(a.y) * T - off - (a.z - ground) * up;
      let dx = this.vp(a.vx) * T, dy = this.vp(a.vy) * T - a.vz * up;
      const n = Math.hypot(dx, dy) || 1, L = T * 0.45;
      dx = dx / n * L; dy = dy / n * L;
      const seg = (k0, k1, color, width) => {
        ctx.strokeStyle = color; ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(x + dx * k0, y + dy * k0); ctx.lineTo(x + dx * k1, y + dy * k1); ctx.stroke();
      };
      seg(-1, -0.05, '#7a5530', lw);          // shaft
      seg(-0.1, 0.1, '#d0d6dc', lw + 1);      // head
      seg(-1, -0.75, '#f2f2f2', lw + 2);      // fletching
    }
  }

  drawParticles(ctx, ox, oy, T, H, V) {
    for (const p of this.game.particles) {
      const off = Renderer.edraw(p.z - V) * H;
      const s = Math.max(2, Math.round(T * p.size));
      const x = ox + this.vp(p.x) * T - off, y = oy + this.vp(p.y) * T - off - p.h * T;
      ctx.globalAlpha = Math.min(1, p.life * 3);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
    }
    ctx.globalAlpha = 1;
  }

  tracePick(ctx, p) {
    ctx.beginPath();
    const { px, py, T, H } = p;
    if (p.shape === 'south') {
      ctx.moveTo(px, py); ctx.lineTo(px + T, py); ctx.lineTo(px + T + H, py + H); ctx.lineTo(px + H, py + H);
    } else if (p.shape === 'east') {
      ctx.moveTo(px, py); ctx.lineTo(px + H, py + H); ctx.lineTo(px + H, py + H + T); ctx.lineTo(px, py + T);
    } else if (p.shape === 'box') {
      ctx.rect(px, py, T, H);
    } else {
      ctx.rect(px, py, T, T);
    }
    ctx.closePath();
  }

  drawTargeting(ctx) {
    const g = this.game;
    const hov = g.hover;
    if (hov) {
      if (hov.kind === 'tile') ctx.strokeStyle = g.inReach(hov.x, hov.y, hov.z) ? 'rgba(255,255,255,0.85)' : 'rgba(255,80,80,0.6)';
      else ctx.strokeStyle = 'rgba(255,220,120,0.8)';
      ctx.lineWidth = Math.max(2, Math.round(this.T / 32));
      const held = g.player.held, def = held && itemDef(held.id);
      this.tracePick(ctx, hov);
      // Holding an elevator: the block turns green when one placed there would sit above
      // another elevator (close enough to ride between them).
      if (held && held.id === B.ELEVATOR && hov.kind === 'tile') {
        const [x, y, z] = g.placementCell(hov);
        if (g.elevatorBelow(x, y, z)) {
          ctx.fillStyle = 'rgba(70,230,110,0.4)'; ctx.fill();
          ctx.strokeStyle = 'rgba(90,255,130,0.95)';
        }
      }
      ctx.stroke();
      // Holding bars / a fence / panes over a top face: mark the edge one would stand on
      // (the one facing you, turned by the placement rotation).
      if (def && def.panel && hov.kind === 'tile' && hov.shape === 'top' && !hov.edge) {
        const d = this.viewDir(g.panelSpot(hov)[3]); // in screen terms
        const { px, py, T } = hov, lw = Math.max(3, Math.round(T / 12));
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        if (d === 'n') ctx.fillRect(px, py, T, lw);
        else if (d === 's') ctx.fillRect(px, py + T - lw, T, lw);
        else if (d === 'w') ctx.fillRect(px, py, lw, T);
        else ctx.fillRect(px + T - lw, py, lw, T);
      }
    }

    // Destroy-stage cracks on every visible face of the block being mined.
    const m = g.mining;
    if (m && m.progress > 0) {
      const crack = Textures.cracks[Math.min(9, Math.floor(m.progress * 10))];
      for (const r of this.picks) {
        if (r.kind !== 'tile' || r.x !== m.x || r.y !== m.y || r.z !== m.z) continue;
        const s = r.T / 16, h = r.H / 16;
        if (r.shape === 'south') ctx.setTransform(s, 0, h, h, r.px, r.py);
        else if (r.shape === 'east') ctx.setTransform(0, s, h, h, r.px, r.py);
        else ctx.setTransform(s, 0, 0, s, r.px, r.py);
        ctx.drawImage(crack, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
  }

  // Neighbouring tiles the player could step up onto right now (uses the same
  // check as movement). Only shown when the player can't see the sky, i.e.
  // underground or under a roof, where the cut-off hides what's above.
  findClimbable() {
    const g = this.game, p = g.player;
    if (!Settings.get('climbHints') || p.dead || g.viewOffset !== 0 || !g.playerCovered()) return null;
    const out = new Set();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (dx && dy && p.destLayer(p.tx + dx, p.ty) === null && p.destLayer(p.tx, p.ty + dy) === null) continue;
      if (p.destLayer(p.tx + dx, p.ty + dy) === p.z + 1) out.add((p.tx + dx) + ',' + (p.ty + dy));
    }
    return out;
  }

  // ---- weather ------------------------------------------------------------

  drawWeather(ctx, T) {
    const g = this.game, w = g.weather, k = w.intensity, p = g.player;
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - (this.weatherT || now));
    this.weatherT = now;
    // Track camera motion so falling particles stay put in the world as you walk
    // (flipping the view isn't motion: the particles just stay where they are).
    const cam = [this.vp(p.x), this.vp(p.y), this.flip], last = this.weatherCam;
    const moved = last && last[2] === cam[2];
    const camDX = moved ? (cam[0] - last[0]) * T : 0;
    const camDY = moved ? (cam[1] - last[1]) * T : 0;
    this.weatherCam = cam;
    if (k <= 0) { this.precip = []; this.splashes = []; return; }

    const pr = g.precipitation();
    const outdoors = !g.playerCovered();
    ctx.fillStyle = pr === 'snow' ? `rgba(215,225,240,${0.1 * k})` : `rgba(60,70,90,${(w.type === 'rain' ? 0.2 : 0.12) * k})`;
    ctx.fillRect(this.vpX, this.vpY, this.vpW, this.vpH);
    if (!outdoors) return; // underground / under a roof: no clouds or precipitation

    this.drawCloudShadows(ctx, T, k * (w.type === 'rain' ? 0.3 : 0.24), now);
    if (pr !== 'none') this.drawPrecipitation(ctx, T, k, pr, dt, camDX, camDY, now);
  }

  // Soft cloud shadows drifting over the ground with the wind.
  drawCloudShadows(ctx, T, alpha, now) {
    const p = this.game.player, S = 14;
    const driftX = now * 0.6, driftY = now * 0.25;
    const cx = this.vpX + this.vpW / 2, cy = this.vpY + this.vpH / 2;
    const i0 = Math.floor((p.x - this.viewW / 2 - driftX) / S) - 1, i1 = Math.ceil((p.x + this.viewW / 2 - driftX) / S) + 1;
    const j0 = Math.floor((p.y - this.viewH / 2 - driftY) / S) - 1, j1 = Math.ceil((p.y + this.viewH / 2 - driftY) / S) + 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (hash3(i, j, 991) > 0.6) continue;
      const wx = (i + hash3(i, j, 992)) * S + driftX, wy = (j + hash3(i, j, 993)) * S + driftY;
      const r = S * (0.4 + hash3(i, j, 994) * 0.35) * T;
      const sx = cx + this.vp(wx - p.x) * T, sy = cy + this.vp(wy - p.y) * T;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
      grad.addColorStop(0.6, `rgba(0,0,0,${alpha * 0.6})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
  }

  drawPrecipitation(ctx, T, k, kind, dt, camDX, camDY, now) {
    const { vpX, vpY, vpW, vpH } = this;
    const snow = kind === 'snow';
    const want = Math.min(900, Math.round(k * (snow ? 0.8 : 1.3) * (vpW * vpH) / (T * T)));
    const parts = this.precip || (this.precip = []);
    const splashes = this.splashes || (this.splashes = []);
    if (parts.length && parts[0].snow !== snow) parts.length = 0;
    const spawn = (q) => Object.assign(q || {}, {
      snow, x: vpX + Math.random() * vpW, y: vpY + Math.random() * vpH,
      life: snow ? 1.5 + Math.random() * 2.5 : 0.15 + Math.random() * 0.6,
      age: 0, phase: Math.random() * Math.PI * 2, size: 0.6 + Math.random() * 0.8,
    });
    while (parts.length < want) parts.push(spawn());
    if (parts.length > want) parts.length = want;

    const wrap = (q) => {
      if (q.x < vpX) q.x += vpW; else if (q.x > vpX + vpW) q.x -= vpW;
      if (q.y < vpY) q.y += vpH; else if (q.y > vpY + vpH) q.y -= vpH;
    };

    if (snow) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (const q of parts) {
        q.age += dt;
        q.x += (Math.sin(q.phase + now * 1.6) * 0.5 + 0.3) * T * dt - camDX;
        q.y += T * 1.1 * q.size * dt - camDY;
        wrap(q);
        if (q.age > q.life) spawn(q);
        const s = Math.max(2, T / 14 * q.size);
        ctx.globalAlpha = Math.min(1, q.age * 3, (q.life - q.age) * 3) * k;
        ctx.fillRect(Math.round(q.x), Math.round(q.y), s, s);
      }
      ctx.globalAlpha = 1;
      return;
    }

    // Rain: slanted streaks; each lands after a moment with a little splash.
    const vx = T * 3, vy = T * 16, len = T * 0.42;
    ctx.strokeStyle = `rgba(185,205,240,${0.55 * k})`;
    ctx.lineWidth = Math.max(1, T / 40);
    ctx.beginPath();
    for (const q of parts) {
      q.age += dt;
      q.x += vx * dt - camDX;
      q.y += vy * dt - camDY;
      wrap(q);
      if (q.age > q.life) {
        if (splashes.length < 200) splashes.push({ x: q.x, y: q.y, t: 0 });
        spawn(q);
      }
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - vx / vy * len, q.y - len);
    }
    ctx.stroke();
    ctx.lineWidth = Math.max(1, T / 48);
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i];
      s.t += dt; s.x -= camDX; s.y -= camDY;
      if (s.t > 0.22) { splashes.splice(i, 1); continue; }
      const r = T * (0.05 + s.t * 0.6);
      ctx.strokeStyle = `rgba(200,220,255,${(1 - s.t / 0.22) * 0.6 * k})`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r, r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  static hit(p, mx, my) {
    const dx = mx - p.px, dy = my - p.py;
    if (p.shape === 'south') {
      if (dy < 0 || dy >= p.H) return false;
      const u = dx - dy;
      return u >= 0 && u < p.T;
    }
    if (p.shape === 'east') {
      if (dx < 0 || dx >= p.H) return false;
      const u = dy - dx;
      return u >= 0 && u < p.T;
    }
    if (p.shape === 'box') return dx >= 0 && dx < p.T && dy >= 0 && dy < p.H;
    return dx >= 0 && dx < p.T && dy >= 0 && dy < p.T;
  }

  // Front-most thing under the mouse.
  pick(mx, my) {
    for (let i = this.picks.length - 1; i >= 0; i--) {
      if (Renderer.hit(this.picks[i], mx, my)) return this.picks[i];
    }
    return null;
  }
}
