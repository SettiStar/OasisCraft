// OasisCraft automated tests. Run with:  powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1
// (optionally -Only "equip,bags" to run some tests by name).
//
// Runs inside tests/test.html, a copy of index.html with the SAME Content-Security-Policy
// (including Trusted Types), so the tests also prove the game works under the real policy.
// Because of that, test code must never use innerHTML / eval / string timers either.
//
// Every test starts from fresh(): the player back at the start spot on a flat, open patch
// of grass, inventory empty, wearing only the starting backpack, daytime, no mobs or drops.
// The game's own loop is paused while tests run; tests drive g.update(dt) themselves.
// Output lines (read by run-tests.ps1): "TEST PASS name", "TEST FAIL name: why",
// "TEST INFO ...", and a final "TEST SUMMARY passed/total".

// The tests exercise creative mode and the dev tools, which config.js keeps off for players.
OASIS_CONFIG.creative = true;
OASIS_CONFIG.devTools = true;

(() => {
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  const out = (s) => console.log('TEST ' + s);

  // Uncaught errors and CSP / Trusted Types violations fail the run.
  const errors = [];
  window.addEventListener('error', (e) => errors.push(`${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => errors.push('unhandled rejection: ' + (e.reason && e.reason.message || e.reason)));
  let expectViolations = false, expectedViolations = 0;
  const violations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    if (expectViolations) expectedViolations++;
    else violations.push(`${e.violatedDirective}: ${e.sample || e.blockedURI}`);
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- shared setup ---------------------------------------------------------
  let g, p, w, ui, BASE;

  // Clear a (2r+1)^2 patch around the start spot: grass floor, open sky above.
  function flat(r = 8) {
    const { x: tx, y: ty, z } = BASE;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      for (let k = z; k < WORLD_H; k++) w.setBlock(tx + dx, ty + dy, k, B.AIR);
      w.setBlock(tx + dx, ty + dy, z - 1, B.GRASS);
    }
  }

  function fresh(r = 8) {
    for (const b of [...ui.bags]) ui.closeBag(b);
    if (ui.creativeWin) ui.toggleCreative();
    if (g.inventoryOpen) g.toggleInventory(false);
    if (g.menuOpen) ui.closeMenu();
    ui.cursor = null; ui.renderCursor();
    if (Settings.get('creative')) Settings.set('creative', false);
    if (Settings.get('mirrorView')) Settings.set('mirrorView', false);
    g.mobs = []; g.drops = []; g.particles = []; g.projectiles = []; g.turretTimers.clear(); g.mining = null; g.rotation = 0;
    g.time = DAY_LENGTH * 0.3; g.viewOffset = 0;
    flat(r);
    p.inventory.slots.fill(null); p.inventory.changed();
    p.equipment.slots.fill(null); p.equipment.add(I.BACKPACK, 1);
    p.x = BASE.x + 0.5; p.y = BASE.y + 0.5; p.z = BASE.z;
    p.move = null; p.dead = false; p.fallDist = 0; p.kbx = p.kby = 0;
    p.health = p.maxHealth; p.air = p.maxAir; p.resetHunger(); p.hurtTimer = 0;
    p.selected = 0; p.attackCooldown = 0; p.actionTime = 0; p.face(0, 1);
    g.input.keys.clear();
    ui.redraw();
  }

  const step = (frames) => { for (let i = 0; i < frames; i++) g.update(1 / 60); };
  const ids = (slots) => slots.filter(Boolean).map((s) => [s.id, s.count]);

  // ---- security --------------------------------------------------------------

  test('security: code-injection sinks are blocked', async (ok) => {
    expectViolations = true;
    const tries = {
      innerHTML: () => { document.createElement('div').innerHTML = '<img src=x>'; },
      insertAdjacentHTML: () => { document.createElement('div').insertAdjacentHTML('beforeend', '<b>x</b>'); },
      eval: () => eval('1 + 1'),
      newFunction: () => new Function('return 1')(),
      stringTimer: () => { if (setTimeout('void 0', 0) === undefined) throw new Error('blocked'); },
      scriptSrc: () => { const s = document.createElement('script'); s.src = 'data:text/javascript,void 0'; },
      scriptText: () => { const s = document.createElement('script'); s.text = 'void 0'; },
    };
    for (const [name, fn] of Object.entries(tries)) {
      let blocked = false;
      try { fn(); } catch (e) { blocked = true; }
      ok(blocked, `${name} was allowed`);
    }
    await sleep(50); // violation reports arrive asynchronously
    expectViolations = false;
  });

  test('security: bad settings and skins are refused', async (ok) => {
    const before = Settings.get('cutMode');
    Settings.set('cutMode', '<img src=x onerror=alert(1)>');
    Settings.set('toString', 'x');
    Settings.set('__proto__', { polluted: true });
    Settings.set('skin', { kind: 'link', url: 'javascript:alert(1)' });
    ok(Settings.get('cutMode') === before, 'bad cutMode accepted');
    ok(({}).polluted === undefined, 'prototype polluted');
    ok(Settings.get('skin').kind !== 'link', 'javascript: skin link accepted');
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const png = c.toDataURL('image/png');
    const fake = 'data:image/png;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const loads = async (fn) => { try { await fn(); return true; } catch (e) { return false; } };
    ok(await loads(() => Skins.fromDataUrl(png)), 'a real PNG skin was refused');
    ok(!(await loads(() => Skins.fromDataUrl(fake))), 'an SVG renamed to PNG was accepted');
    for (const link of ['javascript:alert(1)', 'data:image/png;base64,iVBORw0KGgo', 'file:///C:/Windows/win.ini', 'vbscript:x']) {
      ok(!(await loads(() => Skins.fromLink(link))), `skin link accepted: ${link}`);
    }
  });

  test('security: tampered saves are cleaned', async (ok) => {
    // Loops / shared stacks in the item table must not survive.
    const evil = [{ id: I.BACKPACK, count: 1, bag: [0, 1] }, { id: I.BACKPACK, count: 1, bag: [0] }];
    const ev = Game.unpackItems(evil, [[0]])[0][0];
    ok(ev.bag[0] === null && ev.bag[1] && ev.bag[1].bag[0] === null, 'self-containing backpack survived');
    // Junk ids, counts and keys.
    const junk = Game.unpackItems([{ id: 99999, count: 5 }, { id: B.WATER, count: 1 }, { id: B.STONE, count: 1e9 }, { id: '1', count: 1 }], [[0, 1, 2, 3]])[0];
    ok(junk[0] === null && junk[1] === null && junk[3] === null, 'unknown / liquid / non-integer ids kept');
    ok(junk[2] && junk[2].count === 64, 'stack count not clamped');
    const hp = p.health;
    g.restore({ player: { health: 1e9, x: NaN, food: -5, inv: 'nope', equip: { length: 1e9 } }, chests: [['<b>', []], ['1,2,3', 'x']], hives: [['x', 1]], items: 'nope', weather: { type: '<script>' } });
    ok(p.health === p.maxHealth, 'health not clamped: ' + p.health);
    ok(Number.isFinite(p.x) && p.food === 0, 'position / food not validated');
    ok(!g.chests.has('<b>') && g.weather.type !== '<script>', 'bad chest key / weather kept');
    p.health = hp;
    // Corrupt chunk data is rejected (the chunk regenerates from the seed instead).
    const len = CHUNK * CHUNK * WORLD_H;
    ok(SaveStore.decode(new Uint8Array([255, 250]), len) === null, 'unknown block id accepted');
    ok(SaveStore.decode(new Uint8Array([255, 1, 255]), len) === null, 'odd-length chunk accepted');
    const blocks = new Uint8Array(len).fill(B.STONE); blocks[5] = B.DIRT;
    const back = SaveStore.decode(SaveStore.encode(blocks), len);
    ok(back && back.every((v, i) => v === blocks[i]), 'chunk encode/decode round trip broken');
  });

  // ---- movement & world ------------------------------------------------------

  test('walk: Tibia grid steps', (ok) => {
    const y0 = p.y, x0 = p.x;
    g.input.keys.add('KeyS'); step(60); g.input.keys.delete('KeyS'); step(30);
    ok(p.y - y0 >= 2, `walked only ${(p.y - y0).toFixed(2)} tiles in 1 s`);
    ok(p.x === x0 && (p.y % 1) === 0.5 && p.z === BASE.z, `ended off-grid at ${p.x},${p.y},${p.z}`);
    const x1 = p.x, y1 = p.y;
    g.input.keys.add('KeyD'); g.input.keys.add('KeyS'); step(60); g.input.keys.clear(); step(30);
    ok(p.x > x1 && p.y > y1, 'diagonal step failed');
  });

  test('movement rules: ledges, headroom, pillaring, cut-off', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    w.setBlock(tx + 1, ty, z + 1, B.STONE);                                  // east: head-height block
    w.setBlock(tx, ty + 1, z, B.STONE); w.setBlock(tx, ty + 1, z + 2, B.STONE); // south: ledge, low ceiling
    w.setBlock(tx, ty - 1, z, B.STONE);                                      // north: ledge with headroom
    ok(p.destLayer(tx + 1, ty) === null, 'walked into a 1-high gap');
    ok(p.destLayer(tx - 1, ty) === z, 'flat step refused');
    ok(p.destLayer(tx, ty + 1) === null, 'climbed under a low ceiling');
    ok(p.destLayer(tx, ty - 1) === z + 1, '1-high ledge not climbable');
    p.inventory.add(B.DIRT, 5); p.selected = 0;
    g.place({ x: tx, y: ty, z: z + 1, face: 'top' }, B.DIRT);
    ok(w.getBlock(tx, ty, z + 1) === B.AIR, 'placed a block in your own head');
    g.place({ x: tx, y: ty, z: z - 1, face: 'top' }, B.DIRT);
    ok(p.z === z + 1 && w.getBlock(tx, ty, z) === B.DIRT, 'pillar-up failed');
    w.setBlock(tx, ty, p.z + 2, B.STONE);
    ok(g.playerCovered() && g.cutActive() && g.visibleAbove() === p.height - 1, 'cut-off not active under a roof');
  });

  test('movement: leaves never block stepping up', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 0; dx++) w.setBlock(tx + dx, ty + dy, z + 2, B.OAK_LEAVES);
    w.setBlock(tx + 1, ty, z, B.GRASS);
    ok(p.destLayer(tx + 1, ty) === z + 1, 'stuck under a canopy');
  });

  test('worldgen: caves are never 1-2 blocks tall', (ok) => {
    let bad = 0, example = null;
    for (let cy = -3; cy <= 3; cy++) for (let cx = -3; cx <= 3; cx++) {
      w.getChunk(cx, cy);
      for (let ly = 0; ly < 16; ly++) for (let lx = 0; lx < 16; lx++) {
        const x = cx * 16 + lx, y = cy * 16 + ly, h = w.gen.column(x, y).h;
        for (let z = 2; z < h - 1; z++) {
          const id = w.getBlock(x, y, z);
          if (id !== B.AIR && id !== B.LAVA) continue;
          let top = z; while (top + 1 < h && (w.getBlock(x, y, top + 1) === B.AIR || w.getBlock(x, y, top + 1) === B.LAVA)) top++;
          if (top + 1 >= h) break;
          if (top - z + 1 < 3) { bad++; example = example || [x, y, z]; }
          z = top;
        }
      }
    }
    ok(bad === 0, `${bad} short cave pockets, e.g. at ${example}`);
  });

  test('pickup: magnet, through leaves, into holes; reach limits', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    w.setBlock(tx + 1, ty + 1, z, B.STONE);
    w.setBlock(tx - 1, ty, z - 1, B.AIR); w.setBlock(tx - 1, ty, z - 2, B.AIR);
    for (let k = 0; k < 3; k++) w.setBlock(tx, ty - 2, z + k, B.OAK_LOG);
    w.setBlock(tx, ty - 1, z + 2, B.OAK_LEAVES);
    g.spawnDrop(tx + 1.5, ty + 1.5, z + 1, { id: B.DIRT, count: 1 }, 0);   // on a ledge
    g.spawnDrop(tx - 0.5, ty + 0.5, z - 1, { id: B.SAND, count: 2 }, 0);   // down a hole
    g.spawnDrop(tx + 0.5, ty - 0.5, z + 3, { id: I.APPLE, count: 1 }, 0);  // in the leaves
    g.spawnDrop(tx + 2.5, ty - 2.5, z, { id: B.STONE, count: 1 }, 0);      // too far
    step(120);
    ok(g.drops.length === 1 && g.drops[0].stack.id === B.STONE, 'wrong drops left: ' + JSON.stringify(g.drops.map((d) => d.stack.id)));
    ok(p.inventory.countOf(B.DIRT) === 1 && p.inventory.countOf(B.SAND) === 2 && p.inventory.countOf(I.APPLE) === 1, 'not all picked up');
    ok(g.inReach(tx + 1, ty, z + 4) && !g.inReach(tx + 1, ty, z + 5), 'vertical reach wrong');
  });

  test('render: mobs 2+ layers below are hidden', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    for (let dx = 2; dx <= 4; dx++) { w.setBlock(tx + dx, ty, z - 1, B.AIR); w.setBlock(tx + dx, ty, z - 2, B.AIR); w.setBlock(tx + dx, ty, z - 3, B.GRASS); }
    w.setBlock(tx - 2, ty, z - 1, B.AIR); w.setBlock(tx - 2, ty, z - 2, B.GRASS);
    const deep = new Mob(g, 'pig', tx + 3.5, ty + 0.5, z - 2), shallow = new Mob(g, 'pig', tx - 1.5, ty + 0.5, z - 1);
    deep.behavior = shallow.behavior = BEHAVIORS.idle; g.mobs.push(deep, shallow);
    g.renderer.render();
    const drawn = (m) => g.renderer.picks.some((q) => q.kind === 'entity' && q.entity === m);
    ok(!drawn(deep) && drawn(shallow), `deep drawn=${drawn(deep)} shallow drawn=${drawn(shallow)}`);
  });

  test('torches and lamps: pass through / blocked, placement, light, drops', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    p.inventory.add(B.TORCH, 4); p.inventory.add(B.LAMP, 4);
    g.place({ x: tx + 1, y: ty, z: z - 1, face: 'top' }, B.TORCH);
    g.place({ x: tx - 1, y: ty, z: z - 1, face: 'top' }, B.LAMP);
    ok(w.getBlock(tx + 1, ty, z) === B.TORCH && w.getBlock(tx - 1, ty, z) === B.LAMP, 'placing on a top face');
    ok(p.destLayer(tx + 1, ty) === z, 'torch blocks the way');
    ok(p.destLayer(tx - 1, ty) === null, 'walked through (or climbed onto) a lamp');
    g.place({ x: tx - 1, y: ty, z, face: 'top' }, B.DIRT);
    ok(w.getBlock(tx - 1, ty, z + 1) === B.AIR, 'built on top of a lamp');
    g.place({ x: tx, y: ty, z: z - 1, face: 'top' }, B.LAMP);
    ok(w.getBlock(tx, ty, z) === B.AIR && p.z === z, 'lamp placed under the player');
    w.setBlock(tx + 2, ty + 2, z, B.STONE); w.setBlock(tx + 2, ty + 2, z + 1, B.STONE);
    g.place({ x: tx + 2, y: ty + 2, z: z + 1, face: 'south' }, B.LAMP);
    ok(w.getBlock(tx + 2, ty + 3, z + 1) === B.AIR, 'lamp placed in mid-air against a wall');

    g.time = DAY_LENGTH * 0.75; step(1);
    ok(g.frameLights.some((L) => L.x === tx - 1 && L.y === ty && L.level === 15), 'lamp is not a light source');
    ok(g.lightAt(tx - 2, ty, z) > 0.9 && g.lightAt(tx + 30, ty, z) < 0.5, 'lamp does not light its surroundings');
    g.renderer.render();
    const sprite = (x) => g.renderer.picks.some((q) => q.shape === 'box' && q.x === x && q.y === ty && q.z === z);
    ok(sprite(tx + 1) && sprite(tx - 1), 'torch / lamp not drawn upright');

    g.breakBlock(tx - 1, ty, z - 1);
    ok(w.getBlock(tx - 1, ty, z) === B.AIR && g.drops.some((d) => d.stack.id === B.LAMP), 'lamp not dropped when its support broke');
    g.drops = [];
    w.setBlock(tx + 3, ty, z, B.LAMP); w.setBlock(tx + 3, ty, z + 2, B.SAND);
    g.fallBlock(tx + 3, ty, z + 2);
    ok(w.getBlock(tx + 3, ty, z) === B.SAND && g.drops.some((d) => d.stack.id === B.LAMP), 'falling sand buried a lamp');
    ok(RECIPES.some((r) => r.out.id === B.LAMP && r.station === 'table'), 'no lamp recipe');
  });

  test('torches: hang on block sides, drop with their wall', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    w.setBlock(tx + 2, ty, z, B.STONE); w.setBlock(tx + 2, ty, z + 1, B.STONE);
    p.inventory.add(B.TORCH, 8); p.selected = 0;
    const click = (x, y, zz, face) => g.use({ kind: 'tile', x, y, z: zz, face });
    click(tx + 2, ty, z + 1, 'south'); click(tx + 2, ty, z, 'east'); click(tx + 2, ty, z + 1, 'top');
    ok(w.getBlock(tx + 2, ty + 1, z + 1) === B.WALL_TORCH_N && w.getBlock(tx + 3, ty, z) === B.WALL_TORCH_W &&
       w.getBlock(tx + 2, ty, z + 2) === B.TORCH, 'south / east / top placement: ' +
       [w.getBlock(tx + 2, ty + 1, z + 1), w.getBlock(tx + 3, ty, z), w.getBlock(tx + 2, ty, z + 2)].join());
    ok(g.torchFor({ x: tx + 2, y: ty, z, face: 'north' }) === B.WALL_TORCH_S && g.torchFor({ x: tx + 2, y: ty, z, face: 'west' }) === B.WALL_TORCH_E, 'north / west faces (mirrored view)');
    ok(p.inventory.countOf(B.TORCH) === 5, 'torches not used up');
    ok(p.clearAt(tx + 3, ty, z) && p.destLayer(tx + 1, ty) === z, 'wall torch blocks the way');

    g.renderer.render();
    ok(g.renderer.picks.some((q) => q.shape === 'box' && q.x === tx + 2 && q.y === ty + 1 && q.z === z + 1), 'wall torch not drawn');

    g.breakBlock(tx + 2, ty, z + 1);
    ok(w.getBlock(tx + 2, ty + 1, z + 1) === B.AIR && w.getBlock(tx + 2, ty, z + 2) === B.AIR && w.getBlock(tx + 3, ty, z) === B.WALL_TORCH_W,
       'torches on the broken block stayed (or one on another block fell)');
    g.breakBlock(tx + 2, ty, z);
    ok(w.getBlock(tx + 3, ty, z) === B.AIR, 'wall torch left hanging on nothing');
    ok(g.drops.filter((d) => d.stack.id === B.TORCH).length === 3, 'dropped torches: ' + g.drops.map((d) => d.stack.id).join());
  });

  test('panels: bars, fences, panes on tile edges', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    const id = (kind, ...ds) => panelId(kind, ds.reduce((m, d) => m | EDGE_BIT[d], 0));
    // A fence on the north edge of the player's tile: that edge is closed, the rest of the tile is open.
    ok(g.placePanel(tx, ty, z, 'n', 'fence') && w.getBlock(tx, ty, z) === id('fence', 'n'), 'fence not placed');
    ok(p.destLayer(tx, ty - 1) === null && p.destLayer(tx + 1, ty) === z && p.destLayer(tx + 1, ty - 1) === z, 'crossing rules (north blocked, east and north-east open)');
    // More fence on another edge of the same tile makes a corner; another material can't share it.
    ok(!g.placePanel(tx, ty, z, 'e', 'bars'), 'bars shared a tile with a fence');
    ok(g.placePanel(tx, ty, z, 'e', 'fence') && w.getBlock(tx, ty, z) === id('fence', 'n', 'e'), 'corner not added to the same tile');
    ok(p.destLayer(tx + 1, ty) === null && p.destLayer(tx + 1, ty - 1) === null, 'corner should block east and the diagonal');
    ok(!g.placePanel(tx, ty - 1, z, 's', 'bars'), 'two panels on one edge');
    ok(g.placePanel(tx - 1, ty, z, 'e', 'bars') && p.destLayer(tx - 1, ty) === null, 'bars from the west tile should block');
    const zb = new Mob(g, 'zombie', tx + 0.5, ty - 0.5, z);
    ok(!g.lineOfSight(zb, p), 'a zombie can hit through the fence');
    g.renderer.render();
    ok(g.renderer.picks.some((q) => q.edge === 'n' && q.x === tx && q.y === ty && q.z === z) &&
       g.renderer.picks.some((q) => q.edge === 'e' && q.x === tx - 1 && q.z === z), 'panels not drawn');

    // Support and stacking, away from the player.
    const sx = tx + 3, sy = ty + 3;
    ok(!g.placePanel(sx, sy, z + 1, 'n', 'fence'), 'panel placed in mid-air');
    ok(g.placePanel(sx, sy, z, 'n', 'fence') && g.placePanel(sx, sy, z + 1, 'n', 'glass'), 'stacking glass on a fence');
    g.breakBlock(sx, sy, z - 1);
    ok(w.getBlock(sx, sy, z) === id('fence', 'n'), 'fence fell though the block across its edge still holds it');
    g.drops = [];
    g.breakBlock(sx, sy - 1, z - 1);
    ok(w.getBlock(sx, sy, z) === B.AIR && w.getBlock(sx, sy, z + 1) === B.AIR, 'unsupported panels stayed');
    ok(g.drops.some((d) => d.stack.id === I.FENCE) && !g.drops.some((d) => d.stack.id === I.GLASS_PANE), 'drops: fence yes, glass no');

    // Mining one edge of a corner leaves the other.
    g.drops = [];
    g.mine({ kind: 'tile', x: tx, y: ty, z, face: 'top', edge: 'e' }, 10);
    ok(w.getBlock(tx, ty, z) === id('fence', 'n') && g.drops.some((d) => d.stack.id === I.FENCE && d.stack.count === 1), 'mining one edge of a corner');

    // Panel blocks only ever reach players as items: not in the creative window, and turned
    // into the item if an old save has one in an inventory.
    const inv = Game.unpackStack({ id: id('fence', 'e', 'w'), count: 3 });
    ok(inv && inv.id === I.FENCE && inv.count === 3, 'panel block in an inventory: ' + JSON.stringify(inv));
    Settings.set('creative', true); ui.toggleCreative();
    const listed = new Set([...ui.creativeWin.el.querySelectorAll('[data-item]')].map((s) => Number(s.dataset.item)));
    ok(listed.has(B.GUN_TOWER) && listed.has(I.FENCE) && listed.has(I.GLASS_PANE) && listed.has(I.IRON_BARS) &&
       !Object.keys(PANELS).some((k) => [...Array(15)].some((_, m) => listed.has(panelId(k, m + 1)))), 'creative list: tower / panel items in, panel blocks out');
    ui.toggleCreative(); Settings.set('creative', false);

    // Through the item in hand: it goes on the edge of the tile that faces the player (here the
    // tile is south of them, so its north edge), and R turns that clockwise.
    p.inventory.slots[0] = { id: I.IRON_BARS, count: 5 }; p.selected = 0;
    g.use({ kind: 'tile', x: tx + 1, y: ty + 2, z: z - 1, face: 'top' });
    ok(w.getBlock(tx + 1, ty + 2, z) === id('bars', 'n') && p.inventory.slots[0].count === 4, 'placing iron bars from the hand');
    g.input.pressed.add('KeyR'); step(1); g.input.endFrame();
    ok(g.rotation === 1, 'R did not turn the placement rotation');
    g.use({ kind: 'tile', x: tx + 2, y: ty + 2, z: z - 1, face: 'top' });
    ok(w.getBlock(tx + 2, ty + 2, z) === id('bars', 'e'), 'rotated placement: ' + w.getBlock(tx + 2, ty + 2, z));
    // Stairs rise away from you, turned the same way.
    p.inventory.slots[0] = { id: I.OAK_STAIRS, count: 2 };
    g.use({ kind: 'tile', x: tx - 2, y: ty, z: z - 1, face: 'top' }); // west of the player: rises west, turned once: north
    ok(w.getBlock(tx - 2, ty, z) === B.OAK_STAIRS_N, 'rotated stairs: ' + w.getBlock(tx - 2, ty, z));
    g.rotation = 0;
    ok(RECIPES.some((r) => r.out.id === I.FENCE) && RECIPES.some((r) => r.out.id === I.GLASS_PANE), 'fence / pane recipes missing');
  });

  test('config.js switches: creative mode and dev tools off for players', (ok) => {
    try {
      OASIS_CONFIG.creative = false; OASIS_CONFIG.devTools = false;
      Settings.set('creative', true); Settings.set('debug', true);
      ok(!Settings.get('creative') && !Settings.get('debug') && !g.creative, 'switched-off settings could be turned on');
      ui.toggleCreative();
      ok(!ui.creativeWin, 'creative window opened with creative switched off');
      const w0 = g.weather.type;
      g.input.pressed.add('F8'); step(1); g.input.endFrame();
      ok(g.weather.type === w0, 'F8 changed the weather with dev tools switched off');
    } finally {
      OASIS_CONFIG.creative = true; OASIS_CONFIG.devTools = true;
      Settings.set('creative', false); Settings.set('debug', false);
    }
  });

  test('elevators: ride up / down to the next one in the column', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    w.setBlock(tx, ty, z - 1, B.ELEVATOR);                                       // under the player
    w.setBlock(tx, ty, z + 3, B.ELEVATOR); w.setBlock(tx, ty, z + 4, B.STONE);   // no room to stand on this one
    w.setBlock(tx, ty, z + 5, B.ELEVATOR);
    const press = (code) => { g.input.pressed.add(code); step(1); g.input.endFrame(); };
    ok(g.elevatorBelow(tx, ty, z + 6) && !g.elevatorBelow(tx + 1, ty, z + 6), 'elevatorBelow (the placing highlight)');
    press('Space');
    ok(p.z === z + 6, 'Space should ride past the blocked elevator to the next one, got layer ' + (p.z - z));
    step(30);
    ok(p.z === z + 6, 'did not stay on the upper elevator');
    press('ShiftLeft');
    ok(p.z === z, 'Shift should ride back down, got layer ' + (p.z - z));
    for (const k of [3, 4, 5]) w.setBlock(tx, ty, z + k, B.AIR);
    w.setBlock(tx, ty, z + 22, B.ELEVATOR);
    press('Space');
    ok(p.z === z, 'rode further than ELEVATOR_RANGE');
  });

  test('gun tower: shoots hostile mobs within 8 tiles at any height', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    fresh(13);
    g.time = DAY_LENGTH * 0.75; step(1); // night, so zombies don't burn
    g.mobs = [];
    Math.random = () => 0.1;             // zombies stand still instead of wandering
    const gx = tx + 10, gy = ty;
    w.setBlock(gx, gy, z, B.GUN_TOWER);
    // A zombie 5 tiles away down a 2-deep pit (out of the player's chase range), one 9.5
    // tiles away, and a pig right beside the tower.
    for (let k = 1; k <= 2; k++) w.setBlock(gx + 5, gy, z - k, B.AIR);
    const low = new Mob(g, 'zombie', gx + 5.5, gy + 0.5, z - 2), far = new Mob(g, 'zombie', gx + 0.5, gy + 10, z);
    const pig = new Mob(g, 'pig', gx + 1.5, gy + 1.5, z);
    pig.behavior = BEHAVIORS.idle;
    g.mobs.push(low, far, pig);
    step(60 * 3);
    ok(g.projectiles.length > 0 || low.health < low.maxHealth, 'tower never shot');
    ok(low.health < low.maxHealth, `zombie in the pit not hit (health ${low.health})`);
    ok(far.health === far.maxHealth && pig.health === pig.maxHealth, 'shot something it should not have');
    step(60 * 6);
    ok(low.dead, 'the tower did not finish the zombie');
    pig.damage(1e6, 'arrow', { x: gx + 0.5, y: gy + 0.5, tower: true });
    ok(g.drops.some((d) => d.stack.id === I.RAW_PORK), 'tower kills should drop loot');
    g.renderer.render();
    g.breakBlock(gx, gy, z);
    ok(!g.turretTimers.has(`${gx},${gy},${z}`), 'broken tower still tracked');
  });

  test('held 3D tools, torch light, shiny armor', (ok) => {
    const tools = [B.TORCH, I.WOOD_GREATAXE, ...TOOL_MATERIALS.flatMap((m) => TOOL_TYPES.map((t) => toolId(m.key, t)))];
    ok(tools.every((id) => heldModel(id)) && !heldModel(B.DIRT) && !heldModel(I.APPLE), 'held models missing (or a block got one)');
    // Every held model and armor set draws without errors, facing all four ways, at rest and mid-swing.
    const sets = Object.keys(ARMOR_SETS);
    tools.forEach((id, i) => {
      p.inventory.slots[0] = { id, count: 1 }; p.selected = 0;
      const set = sets[i % sets.length];
      p.equipment.slots.fill(null);
      for (const slot of ['head', 'body', 'legs', 'feet']) {
        if (ARMOR_SETS[set].pieces[slot]) p.equipment.slots[EQUIP_SLOTS.indexOf(slot)] = { id: ARMOR_IDS[set][slot], count: 1 };
      }
      p.equipment.slots[EQUIP_SLOTS.indexOf('shield')] = { id: I.PLATE_SHIELD, count: 1 };
      p.face(...[[1, 0], [0, 1], [-1, 0], [0, -1]][i % 4]);
      p.actionTime = i % 2 ? 0.15 : 0;
      g.renderer.render();
    });
    ok(p.armorLook().metal.body && p.armorLook().metal.shield === 'steel', 'armor pieces lost their metal kind');

    g.time = DAY_LENGTH * 0.75; step(1);
    p.inventory.slots[0] = null;
    const dark = g.lightAt(p.tx + 5, p.ty, p.z);
    p.inventory.slots[0] = { id: B.TORCH, count: 1 };
    const lit = g.lightAt(p.tx + 5, p.ty, p.z);
    ok(lit > 0.5 && dark < 0.5, `a held torch should light the area (${dark.toFixed(2)} -> ${lit.toFixed(2)})`);
  });

  test('render: mirrored view (M) turns the map 180 degrees', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    w.setBlock(tx + 2, ty + 1, z, B.STONE); // a 1-high block south-east of the player
    const r = g.renderer, cx = r.vpX + r.vpW / 2, cy = r.vpY + r.vpH / 2;
    const mine = () => r.picks.filter((q) => q.kind === 'tile' && q.x === tx + 2 && q.y === ty + 1 && q.z === z);
    const faces = () => mine().map((q) => q.face).sort().join(',');
    const centre = () => { const t = mine().find((q) => q.face === 'top'); return [t.px + t.T / 2 - cx, t.py + t.T / 2 - cy]; };
    const pressM = () => { g.input.pressed.add('KeyM'); step(1); g.input.endFrame(); };

    r.render();
    const [nx, ny] = centre();
    ok(faces() === 'east,south,top' && nx > 0 && ny > 0, `normal view: faces ${faces()}, at ${nx},${ny}`);
    pressM();
    ok(g.mirrored, 'M did not turn on the mirrored view');
    r.render();
    const [mx, my] = centre();
    ok(faces() === 'north,top,west' && mx < 0 && my < 0, `mirrored view: faces ${faces()}, at ${mx},${my}`);
    ok(g.placementCell({ x: tx + 2, y: ty + 1, z, face: 'north' }).join() === [tx + 2, ty, z].join() &&
       g.placementCell({ x: tx + 2, y: ty + 1, z, face: 'west' }).join() === [tx + 1, ty + 1, z].join(), 'placing on north / west faces');
    // Keys follow the screen: D walks right on screen, which is now world west.
    const x0 = p.x;
    g.input.keys.add('KeyD'); step(60); g.input.keys.clear(); step(30);
    ok(p.x < x0, `D walked from ${x0} to ${p.x}`);
    pressM();
    ok(!g.mirrored, 'M did not turn the mirrored view off');
  });

  // ---- mobs & combat ---------------------------------------------------------

  test('zombies: attack with line of sight, chase within 7', (ok) => {
    g.time = DAY_LENGTH * 0.75;
    const zb = new Mob(g, 'zombie', p.x + 1, p.y, p.z); g.mobs.push(zb);
    step(90);
    ok(p.health < p.maxHealth, 'adjacent zombie never hit');
    g.mobs = [];
    const a = new Mob(g, 'zombie', p.x + 3, p.y, p.z);
    ok(g.lineOfSight(a, p), 'no line of sight in the open');
    w.setBlock(p.tx + 1, p.ty, p.z, B.STONE); w.setBlock(p.tx + 1, p.ty, p.z + 1, B.STONE);
    ok(!g.lineOfSight(a, p), 'line of sight through a wall');
  });

  test('zombies: chase range', (ok) => {
    fresh(13); g.time = DAY_LENGTH * 0.75;
    Math.random = () => 0.1; // wandering zombies stand still, so the far one can't stroll into range by chance
    const near = new Mob(g, 'zombie', p.x + 6, p.y + 2, p.z), far = new Mob(g, 'zombie', p.x - 11, p.y, p.z);
    g.mobs.push(near, far);
    const d0 = near.distTo(p);
    p.health = 1e6; step(240); p.health = p.maxHealth;
    ok(near.distTo(p) < d0 - 2, `near zombie didn't chase (${d0.toFixed(1)} -> ${near.distTo(p).toFixed(1)})`);
    ok(far.distTo(p) > 8, 'far zombie chased from 11 tiles');
  });

  test('zombies: burn in daylight, not in shade', (ok) => {
    g.time = DAY_LENGTH * 0.25;
    const sun = new Mob(g, 'zombie', p.x + 2, p.y, p.z), shade = new Mob(g, 'zombie', p.x - 2, p.y, p.z);
    sun.behavior = shade.behavior = BEHAVIORS.idle; g.mobs.push(sun, shade);
    w.setBlock(p.tx - 2, p.ty, p.z + 3, B.STONE);
    step(180);
    ok(sun.burning && sun.health < sun.maxHealth, 'zombie in the sun not burning');
    ok(!shade.burning && shade.health === shade.maxHealth, 'zombie in the shade burning');
  });

  test('hive: harvest, bees, poison, refill', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    for (let k = 0; k < 4; k++) w.setBlock(tx + 2, ty - 2, z + k, B.OAK_LOG);
    const hx = tx + 2, hy = ty - 1, hz = z + 1;
    w.setBlock(hx, hy, hz, B.BEEHIVE);
    p.x = hx + 0.5; p.y = hy + 1.5; p.face(0, -1);
    p.selected = 8;
    g.harvestHive(hx, hy, hz);
    ok(w.getBlock(hx, hy, hz) === B.BEEHIVE, 'harvested without an axe');
    p.inventory.add(toolId('stone', 'axe')); p.selected = 0;
    const rnd = Math.random; Math.random = () => 0.95; // force the 3-bee roll
    try { g.harvestHive(hx, hy, hz); } finally { Math.random = rnd; }
    ok(w.getBlock(hx, hy, hz) === B.BEEHIVE_EMPTY && p.inventory.countOf(I.BEESWAX) === 1, 'no beeswax / hive not emptied');
    ok(g.mobs.filter((m) => m.type === 'bee').length === 3, 'expected 3 bees');
    let maxPoison = 0, minHp = p.health;
    for (let i = 0; i < 360; i++) { g.update(1 / 60); maxPoison = Math.max(maxPoison, p.poisonTime); minHp = Math.min(minHp, p.health); }
    ok(g.mobs.filter((m) => m.type === 'bee').length === 0, 'bees still alive after stinging');
    ok(maxPoison <= 3.001 && maxPoison > 0, `poison timer ${maxPoison.toFixed(2)} (should be 3 s, not stacking)`);
    ok(!p.dead && minHp >= 14, `took too much damage (lowest ${minHp})`);
    g.time += HIVE_REFILL + 1; g.hiveTimer = 0; g.updateHives(0.1);
    ok(w.getBlock(hx, hy, hz) === B.BEEHIVE, 'hive never refilled');
  });

  test('greataxe: fells the whole tree, leaves decay', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    const lx = tx + 2, ly = ty - 2;
    for (let k = 0; k < 5; k++) w.setBlock(lx, ly, z + k, B.OAK_LOG);
    for (let dz = 3; dz <= 5; dz++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!w.getBlock(lx + dx, ly + dy, z + dz)) w.setBlock(lx + dx, ly + dy, z + dz, B.OAK_LEAVES);
    }
    p.x = lx + 0.5; p.y = ly + 1.5; p.face(0, -1);
    p.inventory.add(I.WOOD_GREATAXE); p.selected = 0;
    const decay0 = g.decayQueue.length;
    let frames = 0;
    while (w.getBlock(lx, ly, z) === B.OAK_LOG && frames < 600) { g.mine({ x: lx, y: ly, z }, 1 / 60); frames++; }
    let logs = 0; for (let k = 0; k < 6; k++) if (w.getBlock(lx, ly, z + k) === B.OAK_LOG) logs++;
    ok(logs === 0, `${logs} logs left standing`);
    ok(frames / 60 < 3, `took ${(frames / 60).toFixed(1)} s`);
    ok(g.drops.length >= 5, `only ${g.drops.length} drops`);
    ok(g.decayQueue.length > decay0, 'no leaf decay queued');
  });

  // ---- items & containers ----------------------------------------------------

  test('backpacks: three tiers, contents carried over', (ok) => {
    const inv = p.inventory, st = { table: true, furnace: true };
    const rec = (id) => RECIPES.find((r) => r.out.id === id);
    inv.add(I.BACKPACK, 1);
    const bp = inv.slots.find((s) => s && s.id === I.BACKPACK);
    ok(bp.bag.length === 8, 'backpack size');
    bp.bag[0] = { id: I.DIAMOND, count: 5 }; bp.bag[7] = { id: B.TORCH, count: 20 };
    inv.add(I.LEATHER, 24); craft(inv, rec(I.GREATER_BACKPACK));
    const gb = inv.slots.find((s) => s && s.id === I.GREATER_BACKPACK);
    ok(gb && gb.bag.length === 16 && ids(gb.bag).length === 2 && !inv.countOf(I.BACKPACK), 'greater backpack upgrade');
    inv.add(I.IRON_INGOT, 8); craft(inv, rec(I.IRON_BARS)); inv.add(I.BONE, 8);
    ok(canCraft(inv, rec(I.PACK_CHASSIS), st), 'chassis not craftable'); craft(inv, rec(I.PACK_CHASSIS));
    inv.add(I.LEATHER, 48);
    ok(!canCraft(inv, rec(I.BIGPACK), st), 'bigpack craftable without beeswax');
    inv.add(I.BEESWAX, 1); craft(inv, rec(I.BIGPACK));
    const big = inv.slots.find((s) => s && s.id === I.BIGPACK);
    ok(big && big.bag.length === 24 && ids(big.bag).length === 2 && !inv.countOf(I.LEATHER), 'bigpack upgrade');
  });

  test('backpacks: windows, shift-click, nesting, self-nest refused', (ok) => {
    const pinv = p.inventory;
    pinv.add(I.BACKPACK, 1);
    const bagSlot = pinv.slots.findIndex((s) => s && s.id === I.BACKPACK), bag = pinv.slots[bagSlot];
    pinv.add(B.TORCH, 30); pinv.add(I.APPLE, 5); pinv.add(I.BACKPACK, 1);
    ui.openBag(bag);
    ui.clickSlot(pinv, pinv.slots.findIndex((s) => s && s.id === B.TORCH), 0, true);
    ui.clickSlot(pinv, pinv.slots.findIndex((s) => s && s.id === I.APPLE), 0, false); ui.clickSlot(ui.bags[0].inv, 5, 0, false);
    ok(bag.bag[0] && bag.bag[0].id === B.TORCH && bag.bag[5] && bag.bag[5].id === I.APPLE, 'items not moved into the backpack');
    const bag2Idx = pinv.slots.findIndex((s, i) => s && s.id === I.BACKPACK && i !== bagSlot), bag2 = pinv.slots[bag2Idx];
    ui.clickSlot(pinv, bag2Idx, 0, true);
    ui.clickSlot(ui.bags[0].inv, bag.bag.indexOf(bag2), 2, false); // right-click opens it
    ok(ui.bags.length === 2, 'nested backpack window not opened');
    bag2.bag[0] = { id: B.SAND, count: 12 };
    ui.clickSlot(pinv, bagSlot, 0, false); ui.clickSlot(ui.bags[1].inv, 5, 0, false);
    ok(ui.cursor === bag, 'backpack went inside itself');
    ui.returnCursor();
    const pk = Game.packItems([bag], []), round = Game.unpackItems(pk.items, [pk.inventory])[0][0];
    ok(round.bag.find((s) => s && s.bag).bag[0].count === 12, 'nested contents lost in save round trip');
  });

  test('backpacks: 500 deep through the UI and save format', (ok) => {
    const pinv = p.inventory, N = 500;
    pinv.add(I.BACKPACK, 1);
    const outer = pinv.slots.find((s) => s && s.id === I.BACKPACK);
    let cur = outer;
    for (let i = 0; i < N; i++) {
      pinv.add(I.BACKPACK, 1);
      const idx = pinv.slots.findIndex((s) => s && s.id === I.BACKPACK && s !== outer), nb = pinv.slots[idx];
      ui.openBag(cur);
      ui.clickSlot(pinv, idx, 0, false);
      ui.clickSlot(ui.bags[ui.bags.length - 1].inv, 0, 0, false);
      ui.closeBag(ui.bags[ui.bags.length - 1]);
      cur = nb;
    }
    cur.bag[0] = { id: I.DIAMOND, count: 9 };
    const depth = (s) => { let d = 0; while (s && s.bag && s.bag[0] && s.bag[0].bag) { s = s.bag[0]; d++; } return [d, s]; };
    ok(depth(outer)[0] === N, 'nesting depth ' + depth(outer)[0]);
    const packed = Game.packItems(pinv.slots, []);
    const back = Game.unpackItems(JSON.parse(JSON.stringify(packed.items)), [packed.inventory])[0];
    const [d2, inner] = depth(back.find((x) => x && x.id === I.BACKPACK));
    ok(d2 === N && inner.bag[0].count === 9, `round trip depth ${d2}`);
  });

  test('backpacks: old 20-slot saves keep their items', (ok) => {
    const refs = new Array(20).fill(-1); refs[2] = 1; refs[15] = 2;
    const items = [{ id: I.BACKPACK, count: 1, bag: refs }, { id: I.DIAMOND, count: 4 }, { id: B.TORCH, count: 9 }, { id: I.BACKPACK, count: 1, bag: new Array(20).fill(-1) }];
    const o = Game.unpackItems(items, [[0, 3]])[0];
    ok(o[0].bag.length === 16 && o[0].bag[2].count === 4 && o[0].bag[15].count === 9, 'items lost from an old backpack');
    ok(o[1].bag.length === 8, 'empty old backpack not shrunk to 8');
  });

  test('chest: shift-click in, break spills', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    w.setBlock(tx + 1, ty, z, B.CHEST);
    p.inventory.add(B.OAK_LOG, 20);
    g.openChest(tx + 1, ty, z);
    ui.clickSlot(p.inventory, p.inventory.slots.findIndex((s) => s && s.id === B.OAK_LOG), 0, true);
    const key = `${tx + 1},${ty},${z}`;
    ok(JSON.stringify(ids(g.chests.get(key))) === JSON.stringify([[B.OAK_LOG, 20]]), 'logs not in the chest');
    g.toggleInventory(false);
    g.breakBlock(tx + 1, ty, z, true);
    ok(g.drops.some((d) => d.stack.id === B.OAK_LOG && d.stack.count === 20) && !g.chests.has(key), 'chest contents not spilled');
  });

  test('door: walk through, blocked by a block, zombies cannot', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    for (let dx = -3; dx <= 3; dx++) for (let k = 0; k < 2; k++) w.setBlock(tx + dx, ty - 2, z + k, B.COBBLESTONE);
    for (let k = 0; k < 2; k++) w.setBlock(tx, ty - 2, z + k, B.AIR);
    p.inventory.add(I.DOOR, 2); p.selected = 0; p.face(0, -1);
    g.placeDoor({ x: tx, y: ty - 2, z: z - 1, face: 'top' });
    ok(w.getBlock(tx, ty - 2, z) === B.DOOR_NS && w.getBlock(tx, ty - 2, z + 1) === B.DOOR_NS_TOP, 'door not placed');
    p.x = tx + 0.5; p.y = ty - 0.5;
    g.useDoor(tx, ty - 2, z); const through = [p.tx, p.ty];
    g.useDoor(tx, ty - 2, z); const back = [p.tx, p.ty];
    ok(through[1] === ty - 3 && back[1] === ty - 1, `door use went ${through} then ${back}`);
    const zb = new Mob(g, 'zombie', tx + 0.5, ty - 3.5, z);
    ok(zb.destLayer(tx, ty - 2) === null, 'zombie can walk through a door');
    w.setBlock(tx, ty - 3, z + 1, B.STONE);
    g.useDoor(tx, ty - 2, z);
    ok(p.ty === ty - 1, 'went through a door with a block behind it');
  });

  test('tooltip: names and details', (ok) => {
    p.inventory.add(toolId('stone', 'pickaxe'), 1, 50); p.inventory.add(B.TORCH, 12);
    g.toggleInventory(true);
    const el = ui.invEls[1], r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + 10, clientY: r.top + 10, bubbles: true }));
    const tip = document.getElementById('tooltip');
    ok(!tip.classList.contains('hidden') && tip.innerText.includes('Torch') && tip.innerText.includes('12 in stack'), 'tooltip: ' + tip.innerText);
    ok(document.querySelectorAll('#recipes .recipe').length === RECIPES.length, 'crafting list incomplete');
    g.toggleInventory(false);
  });

  test('hunger: activity drains, food restores', (ok) => {
    fresh(12);
    g.input.keys.add('KeyD'); step(600); g.input.keys.clear();
    ok(p.exhaustion > 0.1 || p.saturation < 5, 'walking used no energy');
    p.food = 9; p.saturation = 0;
    p.inventory.add(I.COOKED_PORK, 3); p.selected = 0;
    g.use(null);
    ok(p.food === 17 && Math.abs(p.saturation - 12.8) < 0.01, `ate pork: food ${p.food} sat ${p.saturation}`);
  });

  test('creative: invulnerable, instant mining, flight, item window', (ok) => {
    const { x: tx, y: ty, z } = BASE;
    Settings.set('creative', true);
    p.damage(10, 'test');
    ok(p.health === p.maxHealth, 'took damage in creative');
    g.mine({ x: tx + 1, y: ty, z: z - 1 }, 1 / 60);
    ok(w.getBlock(tx + 1, ty, z - 1) === B.AIR && g.drops.length === 0, 'not instant / dropped items');
    p.inventory.add(B.STONE, 1); p.selected = 0;
    g.place({ x: tx + 2, y: ty, z: z - 1, face: 'top' }, B.STONE); g.place({ x: tx + 3, y: ty, z: z - 1, face: 'top' }, B.STONE);
    ok(p.inventory.countOf(B.STONE) === 1, 'placing used up blocks');
    g.input.keys.add('Space'); step(40); g.input.keys.clear();
    const flew = p.z; step(60);
    ok(flew > z && p.z === flew, 'flight failed');
    ui.toggleCreative();
    ui.creativeTake(I.BIGPACK, 0, true);
    ok(p.inventory.slots.some((s) => s && s.id === I.BIGPACK && s.bag.length === 24), 'creative window take failed');
  });

  // ---- equipment ---------------------------------------------------------------

  test('equipment: slots, crafting, equipping', (ok) => {
    const eq = p.equipment, inv = p.inventory, ix = (s) => EQUIP_SLOTS.indexOf(s);
    ok(eq.get('back') && eq.get('back').id === I.BACKPACK, 'starting backpack not worn');
    inv.add(I.IRON_INGOT, 64);
    for (const slot of ['head', 'body', 'legs', 'feet']) craft(inv, RECIPES.find((r) => r.out.id === ARMOR_IDS.steel[slot]));
    ok(inv.countOf(I.IRON_INGOT) === 40, 'steel set cost wrong');
    for (const slot of ['head', 'body', 'legs', 'feet']) ui.clickSlot(inv, inv.slots.findIndex((s) => s && s.id === ARMOR_IDS.steel[slot]), 0, true);
    ok(eq.armor === 26, 'shift-click equip: Arm ' + eq.armor);
    ui.cursor = { id: B.COBBLESTONE, count: 5 }; ui.clickSlot(eq, ix('head'), 0, false);
    ok(eq.get('head').id === ARMOR_IDS.steel.head && ui.cursor.id === B.COBBLESTONE, 'block went in the helmet slot');
    ui.cursor = { id: B.TORCH, count: 10 }; ui.clickSlot(eq, ix('ammo'), 0, false);
    ok(eq.get('ammo') && eq.get('ammo').id === B.TORCH, 'ammo slot refused an item');
    ui.cursor = { id: I.APPLE, count: 1 }; ui.clickSlot(eq, ix('hand'), 0, false);
    ok(!eq.get('hand'), 'food went in the weapon slot');
    ui.cursor = null; ui.renderCursor();
    inv.slots[3] = { id: ARMOR_IDS.golden.head, count: 1 }; p.selected = 3;
    g.use(null);
    ok(eq.get('head').id === ARMOR_IDS.golden.head && p.held && p.held.id === ARMOR_IDS.steel.head, 'right-click equip did not swap');
    ui.redraw();
    ok(ui.armEl.textContent === String(eq.armor), 'Arm box not updated');
  });

  test('equipment: armor, shield, weapon in combat', (ok) => {
    const eq = p.equipment, ix = (s) => EQUIP_SLOTS.indexOf(s), rnd = Math.random;
    for (const slot of ['head', 'body', 'legs', 'feet']) eq.slots[ix(slot)] = { id: ARMOR_IDS.steel[slot], count: 1 };
    const hit = (r, dmg) => {
      Math.random = () => r; p.hurtTimer = 0; p.health = 20; p.canStep = false;
      try { return [p.damage(dmg, 'zombie', { x: p.x + 1, y: p.y }), 20 - p.health]; } finally { Math.random = rnd; p.canStep = true; }
    };
    ok(hit(0.99, 3)[1] === 1 && hit(0, 3)[1] === 2, 'Arm 26 reduction wrong');
    let tot = 0;
    for (let i = 0; i < 2000; i++) tot += hit(rnd(), 3)[1];
    ok(Math.abs(tot / 2000 - 1.47) < 0.1, `average damage ${(tot / 2000).toFixed(2)}, expected 1.47`);
    p.hurtTimer = 0; p.health = 20; p.damage(3, 'fall');
    ok(p.health === 17, 'armor reduced fall damage');
    eq.slots[ix('shield')] = { id: I.PLATE_SHIELD, count: 1 };
    ok(hit(0.1, 3)[0] === false && hit(0.5, 3)[1] === 1, 'shield block chance wrong');
    Math.random = () => 0.05; p.hurtTimer = 0; p.poisonTime = 0; p.health = 20;
    const bee = new Mob(g, 'bee', p.x, p.y, p.z + 1); g.mobs.push(bee);
    try { step(5); } finally { Math.random = rnd; }
    ok(!bee.dead && p.poisonTime === 0, 'blocked bee still stung');
    g.mobs = []; eq.slots[ix('shield')] = null;
    eq.slots[ix('hand')] = { id: toolId('iron', 'sword'), count: 1, dur: 251 };
    p.selected = 8;
    const pig = new Mob(g, 'pig', p.x + 1, p.y, p.z); g.mobs.push(pig);
    const ph = pig.health; p.attackCooldown = 0; g.attack(pig);
    ok(ph - pig.health === 6 && eq.get('hand').dur === 250, 'equipped weapon not used / worn');
  });

  test('equipment: overflow pickup into worn backpack', (ok) => {
    const inv = p.inventory;
    for (let i = 0; i < 36; i++) inv.slots[i] = { id: B.COBBLESTONE, count: 64 };
    inv.changed();
    g.spawnDrop(p.x + 0.6, p.y, p.z, { id: I.DIAMOND, count: 3 }).pickupDelay = 0;
    step(40);
    const bag = p.equipment.get('back').bag;
    ok(bag.some((s) => s && s.id === I.DIAMOND && s.count === 3), 'diamonds not in the worn backpack');
    ui.redraw();
    ok(ui.capEl.textContent === '7', 'Cap box shows ' + ui.capEl.textContent);
  });

  // ---- saving ------------------------------------------------------------------

  test('save: world record round trip (equipment, inventory, player)', async (ok) => {
    const eq = p.equipment, ix = (s) => EQUIP_SLOTS.indexOf(s);
    eq.slots[ix('head')] = { id: ARMOR_IDS.golden.head, count: 1 };
    eq.slots[ix('shield')] = { id: I.WOODEN_SHIELD, count: 1 };
    p.inventory.add(B.TORCH, 17); p.inventory.add(toolId('stone', 'pickaxe'), 1, 77);
    p.food = 11; p.health = 13; g.time = 1234;
    const real = SaveStore.saveWorld; let meta = null;
    SaveStore.saveWorld = (seed, m) => { meta = JSON.parse(JSON.stringify(m)); return Promise.resolve(); };
    const wasEnabled = g.saveEnabled; g.saveEnabled = true; g.saving = false;
    try { await g.save(false); } finally { SaveStore.saveWorld = real; g.saveEnabled = wasEnabled; }
    ok(meta, 'nothing saved');
    if (!meta) return;
    eq.slots.fill(null); p.inventory.slots.fill(null); p.food = 20; p.health = 20; g.time = 0;
    g.restore(meta);
    ok(eq.get('head') && eq.get('head').id === ARMOR_IDS.golden.head && eq.get('shield') && eq.get('back'), 'equipment not restored');
    ok(p.inventory.countOf(B.TORCH) === 17 && p.inventory.slots.some((s) => s && s.dur === 77), 'inventory not restored');
    ok(p.food === 11 && p.health === 13 && Math.round(g.time) === 1234, 'player state not restored');
    // A tampered record can't put a block in the helmet slot: it goes to the inventory.
    const evil = JSON.parse(JSON.stringify(meta));
    evil.items.push({ id: B.STONE, count: 64 });
    evil.player.equip[ix('head')] = evil.items.length - 1;
    eq.slots.fill(null); p.inventory.slots.fill(null);
    g.restore(evil);
    ok(!eq.get('head') && p.inventory.countOf(B.STONE) === 64, 'block accepted in the helmet slot');
  });

  // ---- runner --------------------------------------------------------------------

  async function run() {
    g = window.game; p = g.player; w = g.world; ui = g.ui;
    g.loop = () => {};                  // pause the live loop: tests drive the game
    g.spawner.update = () => {};        // no random mobs
    BASE = { x: 0, y: 0, z: g.surfaceZ(0, 0) };
    w.preload(0.5, 0.5, 2, 999);
    const only = decodeURIComponent(location.hash.slice(1)).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const chosen = only.length ? tests.filter((t) => only.some((o) => t.name.toLowerCase().includes(o))) : tests;
    let passed = 0;
    for (const t of chosen) {
      const fails = [];
      const ok = (cond, msg) => { if (!cond) fails.push(msg); };
      const rnd = Math.random, errs = errors.length;
      try {
        fresh();
        await Promise.race([t.fn(ok), sleep(15000).then(() => { throw new Error('timed out'); })]);
      } catch (e) {
        fails.push('threw ' + (e && e.message || e));
      } finally {
        Math.random = rnd;
      }
      if (errors.length > errs) fails.push('uncaught: ' + errors.slice(errs).join(' | '));
      if (fails.length) out(`FAIL ${t.name}: ${fails.join('; ')}`); else { out(`PASS ${t.name}`); passed++; }
    }
    // Any CSP / Trusted Types violation from the game itself (not the deliberate ones) fails the run.
    await sleep(100);
    let total = chosen.length;
    if (!only.length) {
      total++;
      if (violations.length) out(`FAIL no security-policy violations: ${violations.slice(0, 5).join(' | ')}`);
      else { out('PASS no security-policy violations'); passed++; }
    }
    fresh();
    g.renderer.render(); ui.update();   // leave a clean frame for the screenshot
    out(`SUMMARY ${passed}/${total}`);
  }

  window.addEventListener('load', () => {
    const t = setInterval(() => {
      if (window.game instanceof Game) { clearInterval(t); setTimeout(run, 200); }
    }, 50);
  });
})();
