// Main game: ties world, entities, interaction, lighting and the loop together.

const DAY_LENGTH = 600;      // seconds per full day/night cycle
const REACH = 4.5;           // block reach in tiles
const REACH_UP = 4;          // how many layers above your feet you can reach
const REACH_DOWN = 4;        // ... and below
const PICKUP_PULL = 2;       // items within this many tiles (and 2 layers) fly to you
const ENTITY_RANGE = 12;     // creatures / items are only drawn within this many tiles
const WEATHER_INTERVAL = 600; // seconds between weather rolls (10 minutes)
const WEATHER_CHANCE = 0.2;  // chance per roll that a weather event starts
const WEATHER_FADE = 8;      // seconds for weather to fade in / out
const AUTOSAVE_EVERY = 30;   // seconds between autosaves (only changes are written)
const MAX_SAVED_ITEMS = 500000; // sanity cap on stacks in one save (inventory + chests + backpacks)
const MAX_BAG_SLOTS = 32;       // largest backpack accepted from a save
const HIVE_REFILL = 300;        // seconds for an emptied beehive to make beeswax again
const AMBIENT_LIGHT = 0.04;  // light in pitch-black caves
const HAND_LIGHT = 4;        // radius of the faint light around the player
const VIEW_MIN = -8, VIEW_MAX = 4; // how far the view layer can be moved from the player
const LEAF_REACH = 4;        // leaves further than this (through leaves) from a log decay
const LEAF_DECAY_MIN = 0.4;  // each orphaned leaf disappears after a random delay
const LEAF_DECAY_MAX = 4.5;  //   between these many seconds
const TURRET_RANGE = 8;      // gun towers shoot hostile mobs within this many tiles (any height)
const TURRET_RELOAD = 1;     // seconds between a tower's shots
const ARROW_SPEED = 12;      // tiles per second
const ARROW_DAMAGE = 4;      // a zombie (20) takes 5 arrows
const ELEVATOR_RANGE = 20;   // layers an elevator reaches to the next one up / down (OpenBlocks' default)

class Game {
  // `saved` is what SaveStore.loadWorld returned ({ meta, chunks }), or null when
  // browser storage isn't available (the game still runs, it just can't save).
  constructor(seedText, saved) {
    this.seedText = seedText;
    this.seed = hashString(this.seedText);
    this.saveEnabled = !!saved;
    this.meta = (saved && saved.meta) || { version: 1, seed: seedText, created: Date.now(), bytes: 0 };

    Textures.init();
    Skins.init();
    Skins.apply(Settings.get('skin')).catch(() => {
      Skins.current = Skins.presets[0];
      this.ui && this.ui.message("Couldn't load your saved skin; using Steve.");
    });
    this.world = new World(this.seed, saved && saved.chunks);

    const s = this.world.gen.findSpawn();
    this.world.preload(s.x, s.y, 2, 999);
    this.spawnPoint = { x: s.x, y: s.y };
    this.player = new Player(this, s.x, s.y, this.surfaceZ(Math.floor(s.x), Math.floor(s.y)));

    this.mobs = [];
    this.drops = [];
    this.particles = [];
    this.projectiles = [];             // arrows from gun towers
    this.turretTimers = new Map();     // "x,y,z" -> seconds until that gun tower can shoot again
    this.rotation = 0;                 // quarter turns (clockwise) added to directional blocks you place (R)
    this.decayQueue = [];
    this.decaying = new Set();
    this.spawner = new MobSpawner(this);

    this.time = DAY_LENGTH * 0.03;
    this.daylight = 1;
    this.weather = { type: 'clear', time: 0, duration: 0, intensity: 0 };
    this.weatherClock = WEATHER_INTERVAL;
    this.viewOffset = 0;               // view layer relative to the player
    this.frameLights = [];
    this.mining = null;
    this.hover = null;
    this.useTimer = 0;
    this.inventoryOpen = false;
    this.menuOpen = false;             // pause menu (game is paused while open)
    this.stations = { table: false, furnace: false };

    this.chests = new Map();           // "x,y,z" -> 27 slots
    this.hives = new Map();            // "x,y,z" -> game time an emptied hive refills
    if (saved && saved.meta) this.restore(saved.meta);
    else this.player.equipment.add(I.BACKPACK, 1); // everyone starts wearing a backpack, like in Tibia
    this.saveTimer = AUTOSAVE_EVERY;

    this.input = new Input(document.getElementById('game'));
    this.renderer = new Renderer(document.getElementById('game'), this);
    this.ui = new UI(this);
    if (!this.saveEnabled) this.ui.message("This browser won't let the game save, so progress won't be kept.");

    // Save when the tab is hidden or closed (the reliable moment browsers give us).
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.save(); });
    window.addEventListener('pagehide', () => this.save());

    this.last = performance.now();
    this.fps = 60;
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---- saving -------------------------------------------------------------

  // Write changed chunks + player/world state. Safe to call often; it only
  // writes what changed and never overlaps itself.
  save(manual = false) {
    if (!this.saveEnabled || this.saving) return Promise.resolve(false);
    const p = this.player;
    const meta = Object.assign(this.meta, {
      version: 1, seed: this.seedText, lastPlayed: Date.now(),
      time: this.time, weatherClock: this.weatherClock,
      weather: { type: this.weather.type, time: this.weather.time, duration: this.weather.duration, intensity: this.weather.intensity },
      spawn: { x: this.spawnPoint.x, y: this.spawnPoint.y },
      player: {
        x: p.x, y: p.y, z: p.z, facing: p.facing, health: p.health, air: p.air,
        food: p.food, saturation: p.saturation, exhaustion: p.exhaustion, selected: p.selected,
        dead: p.dead,
      },
    });
    // Items are saved as one flat table so backpacks can nest to any depth.
    const packed = Game.packItems(p.inventory.slots, [...this.chests], p.equipment.slots);
    meta.items = packed.items;
    meta.player.inv = packed.inventory;
    meta.player.equip = packed.equipment;
    meta.chests = packed.chests;
    meta.hives = [...this.hives];
    delete meta.player.inventory; // old nested format
    if (p.move) { meta.player.x = p.move.toX; meta.player.y = p.move.toY; } // save where the step ends
    const dirty = this.world.takeDirtyChunks();
    this.saving = true;
    return SaveStore.saveWorld(this.seedText, meta, dirty).then(() => {
      if (manual) this.ui.message('World saved.');
      return true;
    }).catch(() => {
      for (const c of dirty) c.dirty = true; // try again next time
      if (manual) this.ui.message("Couldn't save (browser storage may be full or disabled).");
      return false;
    }).finally(() => { this.saving = false; });
  }

  // Flatten the player's inventory and every chest into one table of stacks. A
  // backpack lists the table indices of its contents, so nesting depth is unlimited
  // (no recursion, nothing deeply nested for the browser to store).
  //   items: [{ id, count, dur?, bag?: [index | -1, ...] }]
  //   inventory / equipment: [index | -1, ...]   chests: [["x,y,z", [index | -1, ...]], ...]
  static packItems(invSlots, chests, equipSlots = []) {
    const items = [], queue = [], seen = new Set();
    const add = (s) => {
      if (!s || seen.has(s)) return -1;
      seen.add(s);
      const n = { id: s.id, count: s.count };
      if (s.dur != null) n.dur = s.dur;
      items.push(n);
      if (s.bag) queue.push([s, n]);
      return items.length - 1;
    };
    const inventory = invSlots.map(add);
    const equipment = equipSlots.map(add);
    const chestList = chests.map(([k, slots]) => [k, slots.map(add)]);
    while (queue.length) {
      const [s, n] = queue.pop();
      n.bag = s.bag.map(add);
    }
    return { items, inventory, equipment, chests: chestList };
  }

  // Rebuild stacks from a saved item table (untrusted). Every stack is validated, and
  // each table entry can be used only once, reached from the inventory / chests, so
  // the result is always a proper tree: no shared or self-containing backpacks.
  static unpackItems(table, roots) {
    if (!Array.isArray(table) || table.length > MAX_SAVED_ITEMS) return roots.map(() => []);
    const used = new Uint8Array(table.length);
    const take = (r) => {
      if (!Number.isInteger(r) || r < 0 || r >= table.length || used[r]) return null;
      used[r] = 1;
      return Game.unpackStack(table[r], true);
    };
    const queue = [];
    const out = roots.map((slots) => slots.map((r) => { const s = take(r); if (s && s.bag) queue.push([s, table[r].bag]); return s; }));
    while (queue.length) {
      const [s, refs] = queue.pop();
      const list = Array.isArray(refs) ? refs : [];
      // Backpacks from older saves may be bigger than their tier is now: keep the extra
      // slots only if something is in them, so nothing is ever lost.
      let last = -1;
      for (let i = 0; i < Math.min(list.length, MAX_BAG_SLOTS); i++) if (Number.isInteger(list[i]) && list[i] >= 0) last = i;
      if (last >= s.bag.length) s.bag.length = last + 1, s.bag.fill(null);
      for (let i = 0; i < s.bag.length; i++) {
        const child = take(list[i]);
        s.bag[i] = child;
        if (child && child.bag) queue.push([child, table[list[i]].bag]);
      }
    }
    return out;
  }

  // One saved stack, checked: real item, sane count / durability. With `emptyBag`,
  // a backpack comes back empty (unpackItems fills it); otherwise its old-format
  // nested contents are read too (saves made before the flat table).
  static unpackStack(it, emptyBag = false, depth = 0) {
    const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    if (!it || typeof it !== 'object' || !Number.isInteger(it.id)) return null;
    // Panel blocks (bars / fence / pane variants, once handed out by the creative window) become their item.
    let id = it.id;
    if (id < 256 && BLOCKS[id] && BLOCKS[id].panel) id = PANELS[BLOCKS[id].panel].item;
    if (!itemDef(id)) return null;
    if (id < 256 && (BLOCKS[id].liquid || id === B.AIR)) return null;
    const def = itemDef(id);
    const out = { id, count: Math.round(num(it.count, 1, def.stack, 1)) };
    if (def.tool) out.dur = Math.round(num(it.dur, 1, def.tool.durability, def.tool.durability));
    if (def.bag) {
      const src = !emptyBag && Array.isArray(it.bag) && depth < 32 ? it.bag : [];
      let len = def.bag; // older, bigger backpacks keep slots that still hold items
      for (let i = def.bag; i < Math.min(src.length, MAX_BAG_SLOTS); i++) if (src[i]) len = i + 1;
      out.bag = Array.from({ length: len }, (_, i) => Game.unpackStack(src[i], false, depth + 1));
    }
    return out;
  }

  // Apply a saved world record. It's treated as untrusted: every value is checked.
  restore(m) {
    const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    if (Array.isArray(m.hives)) {
      for (const h of m.hives.slice(0, 10000)) {
        if (Array.isArray(h) && typeof h[0] === 'string' && /^-?\d{1,8},-?\d{1,8},\d{1,3}$/.test(h[0])) this.hives.set(h[0], num(h[1], 0, 1e12, 0));
      }
    }
    // Items: the flat table (current format) or nested stacks (older saves).
    const flat = Array.isArray(m.items);
    const chestEntries = (Array.isArray(m.chests) ? m.chests.slice(0, 5000) : []).filter((e) =>
      Array.isArray(e) && typeof e[0] === 'string' && /^-?\d{1,8},-?\d{1,8},\d{1,3}$/.test(e[0]) && Array.isArray(e[1]));
    const csize = BLOCKS[B.CHEST].container, isize = this.player.inventory.slots.length;
    const fit = (arr, n) => Array.from({ length: n }, (_, i) => (arr && i < arr.length ? arr[i] : -1));
    let invSlots = null, equipSlots = null;
    if (flat) {
      const invRefs = m.player && Array.isArray(m.player.inv) ? m.player.inv : [];
      const equipRefs = m.player && Array.isArray(m.player.equip) ? m.player.equip : [];
      const roots = [fit(invRefs, isize), fit(equipRefs, EQUIP_SLOTS.length), ...chestEntries.map((e) => fit(e[1], csize))];
      const out = Game.unpackItems(m.items, roots);
      invSlots = out[0];
      equipSlots = out[1];
      chestEntries.forEach((e, i) => this.chests.set(e[0], out[i + 2] && out[i + 2].length ? out[i + 2] : new Array(csize).fill(null)));
    } else {
      for (const e of chestEntries) this.chests.set(e[0], Array.from({ length: csize }, (_, i) => Game.unpackStack(e[1][i])));
      if (m.player && Array.isArray(m.player.inventory)) invSlots = Array.from({ length: isize }, (_, i) => Game.unpackStack(m.player.inventory[i]));
    }
    const p = this.player;
    this.time = num(m.time, 0, 1e9, this.time);
    this.weatherClock = num(m.weatherClock, 0, WEATHER_INTERVAL, this.weatherClock);
    if (m.weather && ['clear', 'cloudy', 'rain'].includes(m.weather.type)) {
      Object.assign(this.weather, {
        type: m.weather.type, time: num(m.weather.time, 0, 1e6, 0),
        duration: num(m.weather.duration, 0, 1e6, 0), intensity: num(m.weather.intensity, 0, 1, 0),
      });
    }
    if (m.spawn) this.spawnPoint = { x: num(m.spawn.x, -1e7, 1e7, this.spawnPoint.x), y: num(m.spawn.y, -1e7, 1e7, this.spawnPoint.y) };
    const s = m.player;
    if (!s || typeof s !== 'object') return;
    p.x = Math.floor(num(s.x, -1e7, 1e7, p.x)) + 0.5;
    p.y = Math.floor(num(s.y, -1e7, 1e7, p.y)) + 0.5;
    p.z = Math.round(num(s.z, 1, WORLD_H - 3, p.z));
    p.face(...[[1, 0], [0, 1], [-1, 0], [0, -1]][Math.round(num(s.facing, -4, 4, Math.PI / 2) / (Math.PI / 2) + 4) % 4]);
    p.health = Math.round(num(s.health, 1, p.maxHealth, p.maxHealth));
    p.air = num(s.air, 0, p.maxAir, p.maxAir);
    p.food = Math.round(num(s.food, 0, MAX_FOOD, MAX_FOOD));
    p.saturation = num(s.saturation, 0, p.food, 5);
    p.exhaustion = num(s.exhaustion, 0, 4, 0);
    p.selected = Math.round(num(s.selected, 0, 8, 0));
    if (invSlots && invSlots.length === isize) {
      p.inventory.slots = invSlots;
      p.inventory.changed();
    }
    // Equipment: each item must suit its slot (a tampered save can't put, say, a block
    // in the helmet slot); anything that doesn't goes to the inventory instead.
    if (equipSlots && equipSlots.length === EQUIP_SLOTS.length) {
      equipSlots.forEach((s, i) => {
        if (s && p.equipment.accepts(i, s)) p.equipment.slots[i] = s;
        else if (s) p.inventory.addStack(s);
      });
      p.equipment.changed();
    }
    this.world.preload(p.x, p.y, 2, 999);
    // If the saved spot is now inside a block (or the save was odd), stand on the surface instead.
    if (!p.clearAt(p.tx, p.ty, p.z)) p.z = this.surfaceZ(p.tx, p.ty);
  }

  // ---- queries ----------------------------------------------------------

  get creative() { return Settings.get('creative'); }

  get viewZ() {
    return Math.max(1, Math.min(WORLD_H - 1, this.player.z + this.viewOffset));
  }

  // First free layer on top of a column (standing on solid ground or water).
  surfaceZ(x, y) {
    for (let z = WORLD_H - 2; z >= 0; z--) {
      const id = this.world.getBlock(x, y, z);
      if (BLOCKS[id].solid || id === B.WATER) return z + 1;
    }
    return 1;
  }

  // Is there a roof (an opaque block that isn't tree canopy) somewhere above the player's head?
  playerCovered() {
    const p = this.player, w = this.world;
    const top = w.topAt(p.tx, p.ty);
    for (let z = p.headZ + 1; z <= top; z++) {
      const b = BLOCKS[w.getBlock(p.tx, p.ty, z)];
      if (b.opaque && !b.leaves) return true;
    }
    return false;
  }

  get cutMode() { return Settings.get('cutMode'); }
  set cutMode(v) { Settings.set('cutMode', v); }

  // Mirrored view: the camera looks from the north-west instead of the south-east.
  get mirrored() { return Settings.get('mirrorView'); }

  // Is the cut-off plane active (layers above head height hidden)?
  cutActive() {
    if (this.cutMode === 'off') return false;
    if (this.cutMode === 'always' || this.viewOffset !== 0) return true;
    return this.playerCovered();
  }

  // How many layers above the view layer are drawn. When cut, that's still head
  // height (the player is 2 tall), so walls at head level stay visible and minable.
  visibleAbove() {
    return this.cutActive() ? this.player.height - 1 : SHOW_ABOVE;
  }

  allEntities() {
    return [...this.drops, ...this.mobs, this.player];
  }

  // Sky light reaching cell (x, y, z): full if open to the sky, fading over a
  // few tiles when an open column is nearby (overhangs, cave mouths, tree shade).
  // Blocks above capZ are treated as see-through (they are cut off from view).
  skyAt(x, y, z, capZ = Infinity) {
    const w = this.world;
    const open = (cx, cy) => { const t = w.topAt(cx, cy); return t < z || t > capZ; };
    if (open(x, y)) return 1;
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (open(x + dx, y + dy)) return 1 - r * 0.22;
        }
      }
    }
    return 0;
  }

  lightAt(x, y, z, capZ = Infinity) {
    let l = Math.max(AMBIENT_LIGHT, this.skyAt(x, y, z, capZ) * this.daylight);
    for (const L of this.frameLights) {
      const d = Math.abs(L.x - x) + Math.abs(L.y - y) + Math.abs(L.z - z);
      if (d < L.level) {
        const v = (L.level - d) / L.level;
        if (v > l) l = v;
      }
    }
    const p = this.player;
    const d = Math.hypot(p.x - x - 0.5, p.y - y - 0.5) + Math.abs(p.z - z);
    if (d < HAND_LIGHT) l = Math.max(l, 0.5 * (1 - d / HAND_LIGHT));
    // A torch in hand lights the way like a placed one.
    const held = p.held, torch = BLOCKS[B.TORCH].light;
    if (held && held.id === B.TORCH && d < torch) l = Math.max(l, (torch - d) / torch);
    return Math.min(1, l);
  }

  inReach(x, y, z) {
    const p = this.player;
    const dz = z - p.z;
    if (dz < -REACH_DOWN || dz > REACH_UP) return false;
    return Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y, dz * 0.7) <= REACH;
  }

  findStations() {
    const p = this.player, w = this.world, found = { table: false, furnace: false };
    for (let z = p.z - 2; z <= p.z + 2; z++) {
      for (let y = p.ty - 4; y <= p.ty + 4; y++) {
        for (let x = p.tx - 4; x <= p.tx + 4; x++) {
          const id = w.getBlock(x, y, z);
          if (id === B.CRAFTING_TABLE) found.table = true;
          else if (id === B.FURNACE) found.furnace = true;
        }
      }
    }
    return found;
  }

  // ---- loop -------------------------------------------------------------

  loop(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    this.update(dt);
    this.renderer.render();
    this.ui.update();
    this.input.endFrame();
    requestAnimationFrame((tt) => this.loop(tt));
  }

  update(dt) {
    const p = this.player, inp = this.input;

    // Paused while the menu is open: only listen for the key that closes it.
    if (this.menuOpen) {
      if (inp.wasPressed('Escape')) this.ui.menuBack();
      this.mining = null;
      return;
    }

    this.saveTimer -= dt;
    if (this.saveTimer <= 0) { this.saveTimer = AUTOSAVE_EVERY; this.save(); }

    this.time += dt;
    const phase = (this.time / DAY_LENGTH) % 1;
    this.updateWeather(dt);
    const sun = Math.max(0.28, Math.min(1, 0.55 + 0.7 * Math.sin(phase * Math.PI * 2)));
    this.sun = sun; // raw sunlight, before weather (undead burn when this is high)
    const gloom = { clear: 0, cloudy: 0.18, rain: 0.3 }[this.weather.type] * this.weather.intensity;
    this.daylight = Math.max(0.22, sun * (1 - gloom));

    // Keep chunks generated a little beyond what's on screen (more when zoomed out).
    const r = this.renderer;
    this.world.preload(p.x, p.y, Math.ceil(Math.max(r.viewW, r.viewH) / 2 / CHUNK) + 1, 1);
    this.handleKeys();

    if (!p.dead) {
      if (!this.inventoryOpen) p.update(dt, inp);
      else { p.updateStep(dt); p.updatePhysics(dt); }
    }

    this.frameLights.length = 0;
    this.world.forEachLight(p.tx, p.ty, Math.max(30, Math.ceil(r.viewW / 2) + 16), (x, y, z, level) => {
      if (Math.abs(z - p.z) <= 16) this.frameLights.push({ x, y, z, level });
    });

    this.handleInteraction(dt);

    for (const m of this.mobs) m.update(dt);
    this.updateTurrets(dt);
    this.updateProjectiles(dt);
    for (const d of this.drops) d.update(dt);
    this.pickupItems(dt);
    this.spawner.update(dt);
    this.mobs = this.mobs.filter((m) => !m.dead);
    this.drops = this.drops.filter((d) => !d.dead);
    this.updateParticles(dt);
    this.updateLeafDecay(dt);
    this.updateHives(dt);

    if (this.inventoryOpen) {
      this.stationTimer = (this.stationTimer || 0) - dt;
      if (this.stationTimer <= 0) {
        this.stationTimer = 0.5;
        this.stations = this.findStations();
        this.ui.renderRecipes();
      }
    }
  }

  handleKeys() {
    const inp = this.input, p = this.player;
    if (inp.wasPressed('Escape')) {
      if (this.inventoryOpen) this.toggleInventory();
      else if (!p.dead) { this.ui.openMenu(); return; }
    }
    if (inp.wasPressed('KeyE')) this.toggleInventory();
    if (OASIS_CONFIG.devTools && inp.wasPressed('F3')) this.ui.toggleDebug();
    if (inp.wasPressed('KeyH')) this.ui.toggleHelp();
    if (OASIS_CONFIG.devTools && inp.wasPressed('F8')) this.cycleWeather();
    if (this.inventoryOpen || p.dead) return;

    for (let i = 0; i < 9; i++) if (inp.wasPressed('Digit' + (i + 1))) p.selected = i;
    if (inp.wheel) p.selected = (p.selected + inp.wheel + 9) % 9;

    if (inp.wasPressed('PageUp') || inp.wasPressed('BracketRight')) this.viewOffset = Math.min(VIEW_MAX, this.viewOffset + 1);
    if (inp.wasPressed('PageDown') || inp.wasPressed('BracketLeft')) this.viewOffset = Math.max(VIEW_MIN, this.viewOffset - 1);
    if (inp.wasPressed('Home') || inp.wasPressed('KeyV')) this.viewOffset = 0;
    if (inp.wasPressed('KeyC')) {
      this.cutMode = { auto: 'always', always: 'off', off: 'auto' }[this.cutMode];
      this.ui.message(`Cut-off: ${this.cutMode}`);
    }
    if (inp.wasPressed('KeyR')) {
      this.rotation = (this.rotation + 1) % 4;
      this.ui.message(`Rotation: ${this.rotation * 90}°`);
    }
    if (inp.wasPressed('KeyM')) {
      Settings.set('mirrorView', !this.mirrored);
      this.ui.message(this.mirrored ? 'View: mirrored (from the north-west)' : 'View: normal (from the south-east)');
    }
    if (inp.wasPressed('KeyQ')) this.dropHeld(inp.key('ControlLeft'));
  }

  handleInteraction(dt) {
    const inp = this.input, p = this.player, m = inp.mouse;
    if (this.inventoryOpen || p.dead) { this.mining = null; this.hover = null; return; }

    this.hover = m.inside ? this.renderer.pick(m.x, m.y) : null;

    // Holding an item picked up from a backpack window: clicking the world throws it down.
    if (this.ui.cursor) {
      this.mining = null;
      if (m.leftPressed) this.ui.throwCursor();
      return;
    }

    let target = this.hover;
    // Alt-click targets the clicked column at the view layer (reach walls hidden behind tall terrain).
    if (target && target.kind === 'tile' && (inp.key('AltLeft') || inp.key('AltRight'))) {
      target = Object.assign({}, target, { z: this.viewZ, face: 'top' });
    }

    if (m.left && target) {
      if (target.kind === 'entity') {
        this.mining = null;
        if (target.entity instanceof Mob) this.attack(target.entity);
      } else {
        this.mine(target, dt);
      }
    } else {
      this.mining = null;
    }

    if (m.right) {
      this.useTimer -= dt;
      if (m.rightPressed || this.useTimer <= 0) {
        this.useTimer = 0.25;
        this.use(target);
      }
    }
  }

  // ---- actions ----------------------------------------------------------

  breakTime(id) {
    const b = BLOCKS[id];
    if (b.hardness === 0) return 0.05;
    const tool = this.player.heldTool;
    const correct = tool && b.tool === tool.type;
    const speed = correct ? tool.speed : 1;
    return b.hardness * (this.canHarvest(id) ? 1.5 : 5) / speed;
  }

  canHarvest(id) {
    const b = BLOCKS[id];
    if (b.tier === 0) return true;
    const tool = this.player.heldTool;
    return !!tool && tool.type === b.tool && tool.tier >= b.tier;
  }

  mine(t, dt) {
    const id = this.world.getBlock(t.x, t.y, t.z);
    const b = BLOCKS[id];
    if (id === B.AIR || b.liquid || b.hardness === Infinity || !this.inReach(t.x, t.y, t.z)) { this.mining = null; return; }
    const p = this.player;
    if (!p.move) p.faceToward(t.x + 0.5, t.y + 0.5);
    p.swingArm();
    const mm = this.mining;
    if (!mm || mm.x !== t.x || mm.y !== t.y || mm.z !== t.z) this.mining = { x: t.x, y: t.y, z: t.z, progress: 0, chip: 0 };
    this.mining.progress += this.creative ? 1 : dt / this.breakTime(id); // creative: instant
    // Little chips fly off while you hit it.
    this.mining.chip -= dt;
    if (this.mining.chip <= 0) {
      this.mining.chip = 0.15;
      this.spawnDebris(t.x, t.y, t.z, id, 2);
    }
    if (this.mining.progress >= 1) {
      const harvest = this.canHarvest(id);
      this.spawnDebris(t.x, t.y, t.z, id, 12);
      this.mining = null;
      // The greataxe chops a log like any axe; when that log breaks, the whole tree comes down.
      const tool = p.heldTool;
      // In a corner of bars / fence / panes, only the edge you hit comes off.
      if (b.panel && t.edge && (b.edges & ~EDGE_BIT[t.edge])) {
        this.removePanelEdges(t.x, t.y, t.z, EDGE_BIT[t.edge], harvest && !this.creative);
        if (!this.creative) this.wearTool(1);
        return;
      }
      if (this.creative) { this.breakBlock(t.x, t.y, t.z, false); return; } // creative: no drops, no wear
      const felled = tool && tool.fellsTrees && b.log ? this.fellTree(t.x, t.y, t.z) : 0;
      if (felled) {
        this.wearTool(felled);
        p.exhaust(HUNGER.mine * felled);
        return;
      }
      this.breakBlock(t.x, t.y, t.z, harvest);
      if (b.hardness > 0) this.wearTool(1);
      p.exhaust(HUNGER.mine);
    }
  }

  // Break every log of the tree containing (x, y, z). Returns how many logs fell,
  // or 0 if this isn't a tree (logs touching no leaves, e.g. a log house wall).
  fellTree(x, y, z) {
    const w = this.world, key = (a, b, c) => a + ',' + b + ',' + c;
    const seen = new Set([key(x, y, z)]), logs = [[x, y, z]];
    let leafy = false;
    for (let i = 0; i < logs.length && logs.length < 96; i++) {
      const [lx, ly, lz] = logs[i];
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = lx + dx, ny = ly + dy, nz = lz + dz, k = key(nx, ny, nz);
        const blk = BLOCKS[w.getBlock(nx, ny, nz)];
        if (blk.leaves) leafy = true;
        if (!blk.log || seen.has(k)) continue;
        seen.add(k);
        logs.push([nx, ny, nz]);
      }
    }
    if (!leafy) return 0;
    let x0 = x, x1 = x, y0 = y, y1 = y, z0 = z, z1 = z;
    for (const [lx, ly, lz] of logs) {
      this.spawnDebris(lx, ly, lz, w.getBlock(lx, ly, lz), 4);
      this.breakBlock(lx, ly, lz, true, true);
      x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); y0 = Math.min(y0, ly); y1 = Math.max(y1, ly); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz);
    }
    this.checkLeafDecay(x0, y0, z0, x1, y1, z1);
    return logs.length;
  }

  // `quiet` skips the leaf-decay check (fellTree runs one check for the whole tree).
  breakBlock(x, y, z, drop = true, quiet = false) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    const b = BLOCKS[id];
    w.setBlock(x, y, z, B.AIR);
    if (drop) {
      const d = typeof b.drop === 'function' ? b.drop(Math.random()) : b.drop;
      if (d) this.spawnDrop(x + 0.5, y + 0.5, z, { id: d, count: b.panel ? edgeCount(b.edges) : 1 });
    }
    if (b.turret) this.turretTimers.delete(`${x},${y},${z}`);
    // Breaking a hive angers whatever bees were inside.
    if (b.hive) {
      this.hives.delete(`${x},${y},${z}`);
      if (id === B.BEEHIVE && !this.creative) this.releaseBees(x, y, z);
    }
    // A broken chest spills everything in it.
    if (b.container) {
      const key = `${x},${y},${z}`;
      const slots = this.chests.get(key);
      if (slots) for (const s of slots) if (s) this.spawnDrop(x + 0.5, y + 0.5, z, s, 0.4);
      this.chests.delete(key);
      if (this.ui.chestKey === key) this.ui.closeChest();
    }
    // Doors come in pairs: breaking either half removes both and drops one door.
    if (b.door) {
      const oz = b.doorPart === 'lower' ? z + 1 : z - 1;
      if (BLOCKS[w.getBlock(x, y, oz)].door) { w.setBlock(x, y, oz, B.AIR); this.dropUnsupported(x, y, oz); }
      if (drop) this.spawnDrop(x + 0.5, y + 0.5, Math.min(z, oz), { id: I.DOOR, count: 1 });
    }
    if (b.log && !quiet) this.checkLeafDecay(x, y, z);
    this.dropUnsupported(x, y, z);
    // Sand / gravel above falls.
    for (let zz = z + 1; zz < WORLD_H && BLOCKS[w.getBlock(x, y, zz)].gravity; zz++) this.fallBlock(x, y, zz);
  }

  // After a log is removed, leaves that are no longer within LEAF_REACH leaf-steps
  // of any log start decaying, each after its own random delay so the canopy
  // visibly crumbles away over a few seconds.
  // Checks the box (x0..x1, y0..y1, z0..z1) grown by R; a single point is fine too.
  checkLeafDecay(x0, y0, z0, x1 = x0, y1 = y0, z1 = z0) {
    const w = this.world, R = 5, S = R + LEAF_REACH;
    const key = (x, y, z) => x + ',' + y + ',' + z;
    const reached = new Set();
    let frontier = [];
    for (let z = z0 - S; z <= z1 + S; z++) for (let y = y0 - S; y <= y1 + S; y++) for (let x = x0 - S; x <= x1 + S; x++) {
      if (BLOCKS[w.getBlock(x, y, z)].log) frontier.push([x, y, z]);
    }
    const inBox = (x, y, z) => x >= x0 - S && x <= x1 + S && y >= y0 - S && y <= y1 + S && z >= z0 - S && z <= z1 + S;
    for (let d = 0; d < LEAF_REACH && frontier.length; d++) {
      const next = [];
      for (const [x, y, z] of frontier) {
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = x + dx, ny = y + dy, nz = z + dz, k = key(nx, ny, nz);
          if (reached.has(k) || !inBox(nx, ny, nz) || !BLOCKS[w.getBlock(nx, ny, nz)].leaves) continue;
          reached.add(k);
          next.push([nx, ny, nz]);
        }
      }
      frontier = next;
    }
    for (let z = z0 - R; z <= z1 + R; z++) for (let y = y0 - R; y <= y1 + R; y++) for (let x = x0 - R; x <= x1 + R; x++) {
      const k = key(x, y, z);
      if (!BLOCKS[w.getBlock(x, y, z)].leaves || reached.has(k) || this.decaying.has(k)) continue;
      this.decaying.add(k);
      this.decayQueue.push({ x, y, z, k, t: LEAF_DECAY_MIN + Math.random() * (LEAF_DECAY_MAX - LEAF_DECAY_MIN) });
    }
  }

  updateLeafDecay(dt) {
    if (!this.decayQueue.length) return;
    const w = this.world;
    for (const d of this.decayQueue) {
      d.t -= dt;
      if (d.t > 0) continue;
      this.decaying.delete(d.k);
      const id = w.getBlock(d.x, d.y, d.z);
      if (!BLOCKS[id].leaves) continue;
      this.spawnDebris(d.x, d.y, d.z, id, 6);
      this.breakBlock(d.x, d.y, d.z, true);
    }
    this.decayQueue = this.decayQueue.filter((d) => d.t > 0);
  }

  // ---- elevators (like OpenBlocks') ----

  // From the elevator under the player to the next one straight up (dir 1) or down (-1) within
  // ELEVATOR_RANGE layers that has room to stand on, whatever is in between. True if it moved.
  rideElevator(dir) {
    const p = this.player, w = this.world, x = p.tx, y = p.ty, from = p.z - 1;
    for (let z = from + dir; Math.abs(z - from) <= ELEVATOR_RANGE && z >= 0 && z < WORLD_H; z += dir) {
      if (w.getBlock(x, y, z) !== B.ELEVATOR || !p.clearAt(x, y, z + 1)) continue;
      this.spawnDebris(x, y, p.z, B.ELEVATOR, 8);
      p.z = z + 1;
      p.fallDist = 0; p.kbx = p.kby = 0;
      this.spawnDebris(x, y, p.z, B.ELEVATOR, 8);
      return true;
    }
    return false;
  }

  // Is there another elevator above or below (x, y, z) in the same column, close enough to ride between?
  elevatorInRange(x, y, z) {
    for (let k = 1; k <= ELEVATOR_RANGE; k++) {
      if (this.world.getBlock(x, y, z - k) === B.ELEVATOR || this.world.getBlock(x, y, z + k) === B.ELEVATOR) return true;
    }
    return false;
  }

  // ---- gun towers ----
  // Every TURRET_RELOAD seconds a tower shoots an arrow at the nearest hostile mob within
  // TURRET_RANGE tiles, measured flat (height doesn't matter). Arrows home in on their
  // target and fly over (through) anything in the way.
  updateTurrets(dt) {
    const p = this.player;
    this.world.forEachTurret(p.tx, p.ty, ENTITY_RANGE + TURRET_RANGE, (x, y, z) => {
      const key = x + ',' + y + ',' + z;
      const left = (this.turretTimers.get(key) || 0) - dt;
      if (left > 0) { this.turretTimers.set(key, left); return; }
      const cx = x + 0.5, cy = y + 0.5;
      let target = null, best = TURRET_RANGE;
      for (const m of this.mobs) {
        if (m.dead || !m.def.hostile) continue;
        const d = Math.hypot(m.x - cx, m.y - cy);
        if (d <= best) { best = d; target = m; }
      }
      this.turretTimers.set(key, target ? TURRET_RELOAD : 0);
      if (!target) return;
      // `z` is the arrow's height in layers (like an entity's feet); it starts just above the tower.
      this.projectiles.push({ x: cx, y: cy, z: z + 1.3, vx: 0, vy: 0, vz: 0, target, life: 2, from: z + 1 });
    });
  }

  updateProjectiles(dt) {
    for (const a of this.projectiles) {
      a.life -= dt;
      const m = a.target;
      if (m && !m.dead) { // steer at the middle of the target
        const tx = m.x - a.x, ty = m.y - a.y, tz = m.visualZ + m.height * 0.5 - a.z;
        const d = Math.hypot(tx, ty, tz);
        if (d <= Math.max(0.4, ARROW_SPEED * dt)) {
          m.damage(ARROW_DAMAGE, 'arrow', { x: a.x - tx / d, y: a.y - ty / d, tower: true }); // knocked back along its flight
          a.life = 0;
          continue;
        }
        a.vx = tx / d * ARROW_SPEED; a.vy = ty / d * ARROW_SPEED; a.vz = tz / d * ARROW_SPEED;
        a.ground = m.visualZ; // the renderer draws the arrow over its target's ground as it closes in
        a.dist0 = a.dist0 || d; a.dist = d;
      }
      a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    }
    this.projectiles = this.projectiles.filter((a) => a.life > 0);
  }

  // The block at (x, y, z) is gone: whatever stood on it or hung on its sides falls off as items.
  dropUnsupported(x, y, z) {
    const w = this.world, up = BLOCKS[w.getBlock(x, y, z + 1)];
    if (up.decoration && !up.wall && !up.panel) this.breakBlock(x, y, z + 1, true);
    // Panels on top: in the cell above, or the neighbours' ones on its edges.
    this.settlePanel(x, y, z + 1);
    for (const [dx, dy] of Object.values(DIR_STEP)) this.settlePanel(x + dx, y + dy, z + 1);
    for (const [d, [dx, dy]] of Object.entries(DIR_STEP)) {
      // A wall torch on the far side whose wall (toward d) is this block.
      if (BLOCKS[w.getBlock(x - dx, y - dy, z)].wall === d) this.breakBlock(x - dx, y - dy, z, true);
    }
  }

  fallBlock(x, y, z) {
    const w = this.world;
    // Never comes to rest on a lamp; torches, flowers and lamps in the way are knocked loose.
    const rests = (b) => b.solid && !b.obstacle;
    let nz = z;
    while (nz > 0 && !rests(BLOCKS[w.getBlock(x, y, nz - 1)])) nz--;
    if (nz === z) return;
    const id = w.getBlock(x, y, z);
    w.setBlock(x, y, z, B.AIR);
    for (let k = z - 1; k >= nz; k--) if (BLOCKS[w.getBlock(x, y, k)].decoration) this.breakBlock(x, y, k);
    w.setBlock(x, y, nz, id);
    this.dropUnsupported(x, y, z);
  }

  // Wear down the held tool (or, with `equipment`, the equipped weapon).
  wearTool(amount, equipment = null) {
    const p = this.player, inv = equipment || p.inventory;
    const i = equipment ? EQUIP_SLOTS.indexOf('hand') : p.selected, h = inv.slots[i];
    if (!h || h.dur == null) return;
    h.dur -= amount;
    if (h.dur <= 0) {
      this.ui.message(`${itemName(h.id)} broke!`);
      inv.slots[i] = null;
    }
    inv.changed();
  }

  attack(mob) {
    const p = this.player;
    if (p.attackCooldown > 0) return;
    // Melee reaches adjacent tiles (diagonals included), Tibia-style.
    if (Math.max(Math.abs(mob.occX - p.tx), Math.abs(mob.occY - p.ty)) > 1 || Math.abs(mob.z - p.z) > 1) return;
    if (!p.move) p.faceToward(mob.x, mob.y);
    p.swingArm();
    // Fight with whichever is stronger: the item in your hand or the equipped weapon.
    const held = p.heldTool, weapon = p.equipment.get('hand');
    const wtool = weapon ? itemDef(weapon.id).tool : null;
    const useWeapon = wtool && (!held || wtool.damage > held.damage);
    const tool = useWeapon ? wtool : held;
    mob.damage(tool ? tool.damage : 1, 'player', p);
    p.attackCooldown = 0.45;
    p.exhaust(HUNGER.attack);
    if (tool) this.wearTool(tool.type === 'sword' ? 1 : 2, useWeapon ? p.equipment : null);
  }

  use(target) {
    const p = this.player, held = p.held, w = this.world;
    if (target && target.kind === 'tile' && !this.input.shift()) {
      const id = w.getBlock(target.x, target.y, target.z);
      if ((id === B.CRAFTING_TABLE || id === B.FURNACE) && this.inReach(target.x, target.y, target.z)) {
        this.toggleInventory(true);
        return;
      }
      if (BLOCKS[id].hive && this.inReach(target.x, target.y, target.z)) {
        this.harvestHive(target.x, target.y, target.z);
        return;
      }
      if (id === B.CHEST && this.inReach(target.x, target.y, target.z)) {
        this.openChest(target.x, target.y, target.z);
        return;
      }
      if (BLOCKS[id].door && this.inReach(target.x, target.y, target.z)) {
        this.useDoor(target.x, target.y, BLOCKS[id].doorPart === 'upper' ? target.z - 1 : target.z);
        return;
      }
    }
    if (held) {
      const def = itemDef(held.id);
      if (def.bag) { this.ui.openBag(held); return; } // right-click a held backpack to open it
      if (def.equip) { this.equipHeld(); return; }    // right-click armor (etc.) to put it on
      if (def.food) {
        if (p.food < MAX_FOOD) {
          p.food = Math.min(MAX_FOOD, p.food + def.food);
          p.saturation = Math.min(p.food, p.saturation + (def.sat || 0));
          p.inventory.takeFromSlot(p.selected, 1);
          p.swingArm();
        } else {
          this.ui.message("You're not hungry.");
        }
        return;
      }
      if (!target || target.kind !== 'tile') return;
      if (def.placeable) this.place(target, held.id === B.TORCH ? this.torchFor(target) : held.id);
      else if (def.stairs) {
        const [x, y] = this.placementCell(target);
        this.place(target, def.stairs + STAIR_DIRS.indexOf(this.turned(this.lookDir(x, y)))); // rising away from you
      }
      else if (def.door) this.placeDoor(target);
      else if (def.panel) this.placePanelAt(target, def.panel);
    }
  }

  // ---- panels: iron bars, fences, glass panes (see PANELS in blocks.js) ----

  // Compass direction the player looks in to see tile (x, y) (their facing, for their own tile).
  lookDir(x, y) {
    const p = this.player, dx = x + 0.5 - p.x, dy = y + 0.5 - p.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return this.facingDir();
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
  }

  // Direction d turned clockwise by the placement rotation (R).
  turned(d) { return STAIR_DIRS[(STAIR_DIRS.indexOf(d) + this.rotation) % 4]; }

  // Where a panel placed on target t goes: [x, y, z, edge]. It stands on the edge of the cell
  // that faces you (turned by the placement rotation); clicking a panel stacks one on top of it.
  panelSpot(t) {
    if (t.edge) return [t.x, t.y, t.z + 1, t.edge];
    const [x, y, z] = this.placementCell(t);
    return [x, y, z, this.turned(OPPOSITE[this.lookDir(x, y)])];
  }

  placePanelAt(t, kind) {
    const p = this.player;
    const [x, y, z, d] = this.panelSpot(t);
    if (!this.placePanel(x, y, z, d, kind)) return;
    if (!p.move) p.faceToward(x + 0.5, y + 0.5);
    p.swingArm();
    if (!this.creative) p.inventory.takeFromSlot(p.selected, 1);
  }

  // Put a `kind` panel on edge d of cell (x, y, z): into an empty cell, or onto another edge of a
  // cell that already holds that material. Another material (or any other block) there refuses
  // it, as does an edge already closed from the other side. True if placed.
  placePanel(x, y, z, d, kind) {
    const w = this.world, b = BLOCKS[w.getBlock(x, y, z)];
    if (z <= 0 || z >= WORLD_H || !this.inReach(x, y, z)) return false;
    if (b.panel !== kind && (!b.replaceable || b.liquid)) return false;
    if (w.edgeClosed(x, y, z, d) || !this.panelSupported(x, y, z, d)) return false;
    w.setBlock(x, y, z, panelId(kind, (b.panel === kind ? b.edges : 0) | EDGE_BIT[d]));
    return true;
  }

  // A panel on edge d of (x, y, z) stands on a block under either side of that edge, or on
  // a panel on the same edge below.
  panelSupported(x, y, z, d) {
    const w = this.world, [dx, dy] = DIR_STEP[d];
    const rests = (b) => b.solid && !b.obstacle;
    return rests(BLOCKS[w.getBlock(x, y, z - 1)]) || rests(BLOCKS[w.getBlock(x + dx, y + dy, z - 1)]) || w.edgeClosed(x, y, z - 1, d);
  }

  // Take `bits` off the panel cell at (x, y, z) (dropping them as items when `drop`), then
  // let whatever stood on them fall too.
  removePanelEdges(x, y, z, bits, drop = true) {
    const w = this.world, b = BLOCKS[w.getBlock(x, y, z)];
    bits &= b.edges;
    if (!b.panel || !bits) return;
    const left = b.edges & ~bits;
    w.setBlock(x, y, z, left ? panelId(b.panel, left) : B.AIR);
    if (drop && b.drop) this.spawnDrop(x + 0.5, y + 0.5, z, { id: b.drop, count: edgeCount(bits) });
    this.settlePanel(x, y, z + 1);
    for (const [d, [dx, dy]] of Object.entries(DIR_STEP)) if (bits & EDGE_BIT[d]) this.settlePanel(x + dx, y + dy, z + 1);
  }

  // Drop the edges of the panel cell at (x, y, z) that no longer have anything to stand on.
  settlePanel(x, y, z) {
    const b = BLOCKS[this.world.getBlock(x, y, z)];
    if (!b.panel) return;
    let lost = 0;
    for (const d of STAIR_DIRS) if ((b.edges & EDGE_BIT[d]) && !this.panelSupported(x, y, z, d)) lost |= EDGE_BIT[d];
    if (lost) this.removePanelEdges(x, y, z, lost);
  }

  // Put on the held armor / shield / ring / amulet, swapping out whatever was in that slot.
  equipHeld() {
    const p = this.player, held = p.held;
    const i = EQUIP_SLOTS.indexOf(Equipment.slotFor(held.id));
    if (i < 0) return;
    p.inventory.slots[p.selected] = p.equipment.slots[i];
    p.equipment.slots[i] = held;
    p.inventory.changed();
    p.equipment.changed();
    p.swingArm();
  }

  // The player's facing as 'n' | 'e' | 's' | 'w'.
  facingDir() {
    const f = this.player.facing;
    return Math.abs(f) < 0.1 ? 'e' : Math.abs(f - Math.PI) < 0.1 || Math.abs(f + Math.PI) < 0.1 ? 'w' : f > 0 ? 's' : 'n';
  }

  // Where a block would go when clicking face `t` (into the clicked cell if it's replaceable).
  placementCell(t) {
    const w = this.world;
    let x = t.x, y = t.y, z = t.z;
    if (!BLOCKS[w.getBlock(x, y, z)].replaceable) {
      if (t.face === 'top') z++;
      else if (t.face === 'south') y++;
      else if (t.face === 'north') y--;
      else if (t.face === 'east') x++;
      else if (t.face === 'west') x--;
    }
    return [x, y, z];
  }

  // A torch clicked onto a block's side hangs on that wall; onto a top face it stands.
  torchFor(t) {
    if (BLOCKS[this.world.getBlock(t.x, t.y, t.z)].replaceable) return B.TORCH; // goes into the clicked cell itself
    return { south: B.WALL_TORCH_N, north: B.WALL_TORCH_S, east: B.WALL_TORCH_W, west: B.WALL_TORCH_E }[t.face] || B.TORCH;
  }

  place(t, blockId) {
    const w = this.world, p = this.player;
    const [x, y, z] = this.placementCell(t);
    if (z <= 0 || z >= WORLD_H || !this.inReach(x, y, z)) return;
    if (!BLOCKS[w.getBlock(x, y, z)].replaceable) return;
    const nb = BLOCKS[blockId], under = BLOCKS[w.getBlock(x, y, z - 1)];
    if (under.obstacle && !nb.wall) return;         // nothing goes on top of a lamp
    // Torches and lamps need a block to stand on (wall torches: to hang on).
    const support = nb.wall ? BLOCKS[w.getBlock(x + DIR_STEP[nb.wall][0], y + DIR_STEP[nb.wall][1], z)] : under;
    if (nb.decoration && (!support.solid || support.obstacle)) return;

    if (nb.solid) {
      if (this.isOccupied(x, y, z, p)) return; // a mob's body is there
      const onTile = (p.tx === x && p.ty === y) || (p.occX === x && p.occY === y);
      if (onTile && z >= p.z && z <= p.headZ) {
        // Inside the player: only allowed at the feet, as a pillar-up (Minecraft jump-place),
        // and only with headroom to rise. A lamp can't be stood on, so never under yourself.
        if (nb.obstacle || z !== p.z || p.move || w.isSolid(x, y, p.z + p.height)) return;
        p.z = z + 1;
      }
    }

    if (!nb.stairs && !p.move) p.faceToward(x + 0.5, y + 0.5); // stairs keep the facing they were placed with
    p.swingArm();
    w.setBlock(x, y, z, blockId);
    if (!this.creative) p.inventory.takeFromSlot(p.selected, 1); // creative: unlimited blocks
    if (nb.gravity) this.fallBlock(x, y, z);
  }

  // Doors stand 2 blocks tall across your line of sight (turned by the placement rotation):
  // looking north/south puts one in an east-west wall, east/west in a north-south wall.
  placeDoor(t) {
    const w = this.world, p = this.player;
    const [x, y, z] = this.placementCell(t);
    if (z <= 0 || z + 1 >= WORLD_H || !this.inReach(x, y, z)) return;
    if (!BLOCKS[w.getBlock(x, y, z)].replaceable || !BLOCKS[w.getBlock(x, y, z + 1)].replaceable) { this.ui.message('A door needs 2 free blocks.'); return; }
    const under = BLOCKS[w.getBlock(x, y, z - 1)];
    if (!under.solid || under.obstacle) return;
    if (this.isOccupied(x, y, z, null) || this.isOccupied(x, y, z + 1, null)) return;
    const d = this.turned(this.lookDir(x, y)), ns = d === 'n' || d === 's';
    w.setBlock(x, y, z, ns ? B.DOOR_NS : B.DOOR_EW);
    w.setBlock(x, y, z + 1, ns ? B.DOOR_NS_TOP : B.DOOR_EW_TOP);
    p.swingArm();
    if (!this.creative) p.inventory.takeFromSlot(p.selected, 1);
  }

  // ---- beehives ----

  // Right-click a full hive holding any axe: take its beeswax. 0-3 angry bees may come out.
  // The hive refills after HIVE_REFILL seconds.
  harvestHive(x, y, z) {
    const p = this.player, id = this.world.getBlock(x, y, z);
    const tool = p.heldTool;
    if (!tool || tool.type !== 'axe') { this.ui.message('Use an axe on the hive to collect beeswax.'); return; }
    if (id === B.BEEHIVE_EMPTY) { this.ui.message('This hive has no beeswax right now. Come back later.'); return; }
    if (!p.move) p.faceToward(x + 0.5, y + 0.5);
    p.swingArm();
    this.world.setBlock(x, y, z, B.BEEHIVE_EMPTY);
    this.hives.set(`${x},${y},${z}`, this.time + HIVE_REFILL);
    if (p.inventory.add(I.BEESWAX, 1)) this.spawnDrop(p.x, p.y, p.z, { id: I.BEESWAX, count: 1 }, 1);
    this.wearTool(1);
    this.spawnDebris(x, y, z, B.BEEHIVE, 6);
    this.releaseBees(x, y, z);
  }

  // 0-3 bees: 35% none, 30% one, 23% two, 12% three.
  releaseBees(x, y, z) {
    const r = Math.random();
    const n = r < 0.35 ? 0 : r < 0.65 ? 1 : r < 0.88 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      this.mobs.push(new Mob(this, 'bee', x + 0.5 + (Math.random() - 0.5) * 0.6, y + 1 + Math.random() * 0.4, z));
    }
    if (n) this.ui.message(n === 1 ? 'A bee comes out of the hive!' : `${n} angry bees come out of the hive!`);
    return n;
  }

  // Empty hives fill back up over time (checked every couple of seconds).
  updateHives(dt) {
    this.hiveTimer = (this.hiveTimer || 0) - dt;
    if (this.hiveTimer > 0 || !this.hives.size) return;
    this.hiveTimer = 2;
    for (const [key, at] of this.hives) {
      if (this.time < at) continue;
      const [x, y, z] = key.split(',').map(Number);
      if (!this.world.hasChunk(x >> 4, y >> 4)) continue;
      if (this.world.getBlock(x, y, z) === B.BEEHIVE_EMPTY) this.world.setBlock(x, y, z, B.BEEHIVE);
      this.hives.delete(key);
    }
  }

  // The contents of the chest at (x, y, z), as an Inventory (created empty on first use).
  chestAt(x, y, z) {
    const key = `${x},${y},${z}`;
    if (!this.chests.has(key)) this.chests.set(key, new Array(BLOCKS[B.CHEST].container).fill(null));
    return new Inventory(0, this.chests.get(key));
  }

  openChest(x, y, z) {
    if (!this.inventoryOpen) this.toggleInventory(true);
    this.ui.openChest(`${x},${y},${z}`, this.chestAt(x, y, z));
  }

  // Doors don't open: using one steps you through to the tile just behind it.
  // The only thing that stops you is a block in that spot (where your feet or head would go).
  useDoor(x, y, z) {
    const p = this.player;
    const ns = BLOCKS[this.world.getBlock(x, y, z)].door === 'ns';
    const s = ns ? (p.y < y + 0.5 ? 1 : -1) : (p.x < x + 0.5 ? 1 : -1);
    const tx = ns ? x : x + s, ty = ns ? y + s : y;
    for (let k = 0; k < p.height; k++) {
      if (p.solidAt(tx, ty, z + k)) { this.ui.message('A block is in front of the door.'); return; }
    }
    p.move = null; // works mid-step too
    p.x = tx + 0.5; p.y = ty + 0.5; p.z = z;
    p.kbx = p.kby = 0;
    p.fallDist = 0;
    if (ns) p.face(0, s); else p.face(s, 0);
    this.mining = null;
    this.spawnDebris(x, y, z, B.PLANKS, 6);
  }

  // Can `a` see `b`? Traces a line between their upper bodies; any solid block
  // (leaves excepted, like movement) in between blocks the view.
  lineOfSight(a, b) {
    const ax = a.x, ay = a.y, az = a.z + a.height * 0.75;
    const bx = b.x, by = b.y, bz = b.z + b.height * 0.75;
    const dist = Math.hypot(bx - ax, by - ay, bz - az);
    const steps = Math.max(2, Math.ceil(dist / 0.2));
    let px = Math.floor(ax), py = Math.floor(ay);
    const feet = Math.min(a.z, b.z);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const x = Math.floor(ax + (bx - ax) * k), y = Math.floor(ay + (by - ay) * k), z = Math.floor(az + (bz - az) * k);
      // Bars, fences and panes in between stop a blow too (a fence that stops you walking
      // stops a reach over it as well).
      if ((x !== px || y !== py) && !this.world.crossable(px, py, Math.sign(x - px), Math.sign(y - py), Math.min(feet, z), z)) return false;
      px = x; py = y;
      if (i === steps) break;
      const blk = BLOCKS[this.world.getBlock(x, y, z)];
      if (blk.solid && !blk.leaves) return false;
    }
    return true;
  }

  // Is cell (x, y, z) inside a creature's body (player or mob) other than `self`?
  isOccupied(x, y, z, self) {
    const taken = (e) => e !== self && !e.dead && z >= e.z && z < e.z + e.height && e.occX === x && e.occY === y;
    if (taken(this.player)) return true;
    for (const m of this.mobs) if (taken(m)) return true;
    return false;
  }

  spawnDebris(x, y, z, id, n) {
    const color = Textures.colors[id] || '#888';
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: x + 0.2 + Math.random() * 0.6, y: y + 0.5 + Math.random() * 0.4, z: z + 1,
        h: Math.random() * 0.2, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.3) * 1.5,
        vh: 1 + Math.random() * 1.5, life: 0.4 + Math.random() * 0.3, size: 0.06 + Math.random() * 0.05, color,
      });
    }
  }

  // A little cloud at someone's head (blocked / absorbed hits).
  spawnPuff(e, color) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.particles.push({
        x: e.x + Math.cos(a) * 0.15, y: e.y + Math.sin(a) * 0.15, z: e.z + 1, h: 0.2,
        vx: Math.cos(a) * 0.8, vy: Math.sin(a) * 0.8, vh: 0.6, rise: true,
        life: 0.35 + Math.random() * 0.15, size: 0.07, color,
      });
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (!p.rise) p.vh -= 6 * dt; // debris falls; flames rise
      p.h = Math.max(0, p.h + p.vh * dt);
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  spawnDrop(x, y, z, stack, delay) {
    const def = itemDef(stack.id);
    if (def && def.bag && !stack.bag) stack.bag = new Array(def.bag).fill(null); // every backpack has its storage
    const d = new ItemDrop(this, x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, z, stack);
    if (delay != null) d.pickupDelay = delay;
    this.drops.push(d);
    return d;
  }

  dropHeld(all) {
    const p = this.player;
    const s = p.inventory.takeFromSlot(p.selected, all ? 64 : 1);
    if (!s) return;
    const d = this.spawnDrop(p.x + Math.cos(p.facing) * 0.4, p.y + Math.sin(p.facing) * 0.4, p.z, s, 1.5);
    d.kbx = Math.cos(p.facing) * 7; d.kby = Math.sin(p.facing) * 7;
  }

  // The backpack in the equipment's backpack slot, as an Inventory (or null).
  wornBag() {
    const s = this.player.equipment.get('back');
    return s && s.bag ? new Inventory(0, s.bag) : null;
  }

  canPickUp(stack) {
    if (this.player.inventory.canAdd(stack.id)) return true;
    const bag = this.wornBag();
    return !!bag && bag.canAdd(stack.id);
  }

  // Items within PICKUP_PULL tiles (and up to 2 layers above/below, e.g. on a
  // ledge or down a hole) fly to the player and are collected on arrival.
  pickupItems(dt) {
    const p = this.player;
    if (p.dead) return;
    for (const d of this.drops) {
      if (d.dead || d.pickupDelay > 0) continue;
      const dist = p.distTo(d);
      if (!d.attract) {
        if (dist > PICKUP_PULL || Math.abs(d.z - p.z) > 2 || !this.canPickUp(d.stack)) continue;
        d.attract = true;
        d.z = p.z;
        d.kbx = d.kby = 0;
      }
      const k = Math.min(1, dt * 12);
      d.x += (p.x - d.x) * k;
      d.y += (p.y - d.y) * k;
      if (p.distTo(d) < 0.35) {
        // Into the inventory first; whatever doesn't fit goes into the worn backpack.
        let left = p.inventory.addStack(d.stack);
        const bag = this.wornBag();
        if (left && bag) { d.stack.count = left; left = bag.addStack(d.stack); }
        if (left === 0) d.dead = true;
        else { d.stack.count = left; d.attract = false; d.pickupDelay = 1; }
      }
    }
  }

  // ---- weather ------------------------------------------------------------
  // Every WEATHER_INTERVAL seconds there's a WEATHER_CHANCE roll for an event
  // (cloudy or a storm). A storm shows as rain, as snow in cold biomes, and as
  // just clouds in deserts. Snow is visual only and never places snow blocks.

  updateWeather(dt) {
    const w = this.weather;
    if (!Settings.get('weather')) {
      if (w.type !== 'clear') Object.assign(w, { type: 'clear', time: 0, duration: 0, intensity: 0 });
      return;
    }
    this.weatherClock -= dt;
    if (this.weatherClock <= 0) {
      this.weatherClock += WEATHER_INTERVAL;
      if (w.type === 'clear' && Math.random() < WEATHER_CHANCE) this.startWeather(Math.random() < 0.5 ? 'rain' : 'cloudy');
    }
    if (w.type === 'clear') return;
    w.time += dt;
    const fadingOut = w.time > w.duration;
    w.intensity = Math.max(0, Math.min(1, w.intensity + (fadingOut ? -dt : dt) / WEATHER_FADE));
    if (fadingOut && w.intensity === 0) Object.assign(w, { type: 'clear', time: 0, duration: 0 });
  }

  startWeather(type, duration = 120 + Math.random() * 240) {
    Object.assign(this.weather, { type, time: 0, duration });
  }

  // F8 (debug): clear -> cloudy -> storm -> clear, instantly.
  cycleWeather() {
    const next = { clear: 'cloudy', cloudy: 'rain', rain: 'clear' }[this.weather.type];
    if (next === 'clear') Object.assign(this.weather, { type: 'clear', time: 0, duration: 0, intensity: 0 });
    else { this.startWeather(next); this.weather.intensity = 1; }
    this.ui.message(`Weather: ${this.weatherLabel()}`);
  }

  // What falls from the sky where the player is: 'rain', 'snow' or 'none'.
  precipitation() {
    if (this.weather.type !== 'rain') return 'none';
    const p = this.player, col = this.world.gen.column(p.tx, p.ty);
    if (col.biome === BIOME.DESERT) return 'none';
    const cold = col.biome === BIOME.SNOWY || col.biome === BIOME.FROZEN_OCEAN || col.temp < -0.2 ||
      (col.biome === BIOME.MOUNTAINS && col.h > SEA_LEVEL + 28);
    return cold ? 'snow' : 'rain';
  }

  weatherLabel() {
    const t = this.weather.type;
    if (t === 'clear') return 'Clear';
    if (t === 'cloudy') return 'Cloudy';
    const pr = this.precipitation();
    return pr === 'snow' ? 'Snowing' : pr === 'rain' ? 'Raining' : 'Cloudy';
  }

  // In-game clock: the day starts at 06:00 (sunrise).
  clock() {
    const total = this.time / DAY_LENGTH;
    const hours = (((total % 1) * 24) + 6) % 24;
    const day = Math.floor(total + 0.25) + 1;
    return { day, h: Math.floor(hours), m: Math.floor((hours % 1) * 60), night: hours < 6 || hours >= 19 };
  }

  toggleInventory(force) {
    this.inventoryOpen = force === true ? true : !this.inventoryOpen;
    if (this.inventoryOpen) {
      this.stations = this.findStations();
      this.stationTimer = 0.5;
      this.ui.openInventory();
    } else {
      this.ui.closeInventory();
    }
  }

  onPlayerDeath(source) {
    this.ui.showDeath(source);
  }

  respawn() {
    const p = this.player, s = this.spawnPoint;
    p.x = s.x; p.y = s.y;
    p.z = this.surfaceZ(Math.floor(s.x), Math.floor(s.y));
    p.health = p.maxHealth;
    p.air = p.maxAir;
    p.resetHunger();
    p.dead = false;
    p.move = null;
    p.fallDist = 0;
    p.kbx = p.kby = 0;
    this.viewOffset = 0;
    this.ui.hideDeath();
  }
}

// Start-up: ?seed=X opens (or creates) that world; otherwise resume the last world
// played, or start a fresh one.
window.addEventListener('load', async () => {
  const params = new URLSearchParams(location.search);
  const seed = cleanSeed(params.get('seed')) || cleanSeed(SaveStore.lastWorld()) || String(Math.floor(Math.random() * 1e9));
  // If browser storage is broken or hangs (some privacy modes), start anyway without saving.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
  const saved = await Promise.race([SaveStore.loadWorld(seed).catch(() => null), timeout]);
  window.game = new Game(seed, saved);
});
