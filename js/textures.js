// Procedurally generated 16x16 pixel textures (no image assets needed).
// Each block gets a "top" texture (what you see from above) and a "side"
// texture (the south-facing wall drawn below raised blocks).

const TEX = 16;

const Textures = (() => {
  const top = [];
  const side = [];
  const icons = {};      // id -> canvas
  const iconUrls = {};   // id -> data URL (for DOM UI)
  const cracks = [];     // 10 destroy-stage overlays
  const colors = [];     // block id -> average colour
  const sprites = [];    // upright blocks other than torches (lamp): side-view art drawn standing on the tile; .glow = flame pixel

  function canvas() {
    const c = document.createElement('canvas');
    c.width = TEX; c.height = TEX;
    return c;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function shade(hex, f) {
    const [r, g, b] = hexToRgb(hex);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${c(r)},${c(g)},${c(b)})`;
  }

  // Fill every pixel with base colour +- random brightness.
  function noisy(ctx, rand, base, variance) {
    for (let y = 0; y < TEX; y++) {
      for (let x = 0; x < TEX; x++) {
        ctx.fillStyle = shade(base, 1 + (rand() - 0.5) * variance);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  function speckle(ctx, rand, color, count, size = 1) {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = typeof color === 'function' ? color() : color;
      ctx.fillRect(Math.floor(rand() * (TEX - size + 1)), Math.floor(rand() * (TEX - size + 1)), size, size);
    }
  }

  function ore(ctx, rand, spot) {
    noisy(ctx, rand, '#7d7d7d', 0.25);
    for (let i = 0; i < 5; i++) {
      const x = 1 + Math.floor(rand() * 12), y = 1 + Math.floor(rand() * 12);
      ctx.fillStyle = spot;
      ctx.fillRect(x, y, 2, 2);
      ctx.fillStyle = shade(spot, 0.7);
      ctx.fillRect(x + 1, y + 1, 1, 1);
      if (rand() < 0.6) { ctx.fillStyle = shade(spot, 1.2); ctx.fillRect(x + 2, y, 1, 1); }
    }
  }

  function rings(ctx, rand, bark, inner) {
    noisy(ctx, rand, bark, 0.25);
    for (let r = 6; r >= 0; r -= 1) {
      ctx.fillStyle = shade(inner, r % 2 === 0 ? 1 : 0.85);
      ctx.fillRect(8 - r - 1, 8 - r - 1, (r + 1) * 2, (r + 1) * 2);
    }
    ctx.fillStyle = shade(inner, 0.7);
    ctx.fillRect(7, 7, 2, 2);
  }

  function bark(ctx, rand, color) {
    for (let x = 0; x < TEX; x++) {
      const f = 0.8 + rand() * 0.35;
      for (let y = 0; y < TEX; y++) {
        ctx.fillStyle = shade(color, f * (1 + (rand() - 0.5) * 0.15));
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  function planks(ctx, rand, color) {
    for (let y = 0; y < TEX; y++) {
      const row = Math.floor(y / 4);
      for (let x = 0; x < TEX; x++) {
        let f = 1 + (rand() - 0.5) * 0.12;
        if (y % 4 === 3) f = 0.65;
        if ((x + row * 5) % 16 === 0) f = 0.7;
        ctx.fillStyle = shade(color, f);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  function cobble(ctx, rand) {
    noisy(ctx, rand, '#6e6e6e', 0.2);
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(rand() * 13), y = Math.floor(rand() * 13);
      const w = 3 + Math.floor(rand() * 3), h = 3 + Math.floor(rand() * 2);
      ctx.fillStyle = shade('#8c8c8c', 0.9 + rand() * 0.3);
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#4a4a4a';
      ctx.fillRect(x, y + h, w, 1);
      ctx.fillRect(x + w, y, 1, h + 1);
    }
  }

  function leaves(ctx, rand, color) {
    noisy(ctx, rand, color, 0.45);
    speckle(ctx, rand, () => shade(color, 0.45), 18);
  }

  function grassSide(ctx, rand, topColor) {
    noisy(ctx, rand, '#866043', 0.25);
    for (let x = 0; x < TEX; x++) {
      const d = 3 + Math.floor(rand() * 3);
      for (let y = 0; y < d; y++) {
        ctx.fillStyle = shade(topColor, 1 + (rand() - 0.5) * 0.25);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  const gens = {
    [B.BEDROCK]: (c, r) => { noisy(c, r, '#3a3a3a', 0.6); speckle(c, r, '#111', 20, 2); },
    [B.STONE]: (c, r) => { noisy(c, r, '#7d7d7d', 0.25); speckle(c, r, '#6a6a6a', 10, 2); },
    [B.DIRT]: (c, r) => { noisy(c, r, '#866043', 0.3); speckle(c, r, '#6b4a30', 12); },
    [B.GRASS]: (c, r) => { noisy(c, r, '#5f9f35', 0.3); speckle(c, r, '#76b84a', 14); },
    [B.SNOWY_GRASS]: (c, r) => { noisy(c, r, '#f2f6f8', 0.08); speckle(c, r, '#dfe8ee', 12); },
    [B.SAND]: (c, r) => { noisy(c, r, '#dbd3a0', 0.12); speckle(c, r, '#c9bf88', 14); },
    [B.GRAVEL]: (c, r) => { noisy(c, r, '#837f7e', 0.3); speckle(c, r, () => (r() < 0.5 ? '#5d5a59' : '#a8a3a1'), 30, 2); },
    [B.WATER]: (c, r) => { noisy(c, r, '#2f5fd0', 0.12); speckle(c, r, '#5a85e8', 10, 2); },
    [B.LAVA]: (c, r) => { noisy(c, r, '#d4560f', 0.25); speckle(c, r, '#f7b733', 18, 2); speckle(c, r, '#a8320a', 8, 2); },
    [B.OAK_LOG]: (c, r) => rings(c, r, '#5c4325', '#b08a52'),
    [B.SPRUCE_LOG]: (c, r) => rings(c, r, '#3b2a17', '#8a6a3f'),
    [B.OAK_LEAVES]: (c, r) => leaves(c, r, '#3f8a2a'),
    [B.SPRUCE_LEAVES]: (c, r) => leaves(c, r, '#2d5a3a'),
    [B.PLANKS]: (c, r) => planks(c, r, '#a8834f'),
    [B.COBBLESTONE]: (c, r) => cobble(c, r),
    [B.COAL_ORE]: (c, r) => ore(c, r, '#222222'),
    [B.IRON_ORE]: (c, r) => ore(c, r, '#d8af93'),
    [B.GOLD_ORE]: (c, r) => ore(c, r, '#f5d742'),
    [B.DIAMOND_ORE]: (c, r) => ore(c, r, '#5decf5'),
    [B.SNOW]: (c, r) => noisy(c, r, '#f4f8fa', 0.06),
    [B.ICE]: (c, r) => { noisy(c, r, '#9cc2f5', 0.1); speckle(c, r, '#d6e7ff', 8, 2); },
    [B.CACTUS]: (c, r) => {
      noisy(c, r, '#3c8a2e', 0.2);
      c.fillStyle = '#5bb045'; c.fillRect(2, 2, 12, 12);
      c.fillStyle = '#2a6420'; c.fillRect(4, 4, 8, 8);
      speckle(c, r, '#e8e8b0', 6);
    },
    [B.SANDSTONE]: (c, r) => { noisy(c, r, '#d8cc8f', 0.1); c.fillStyle = '#c4b77a'; c.fillRect(0, 0, 16, 1); c.fillRect(0, 15, 16, 1); },
    [B.CRAFTING_TABLE]: (c, r) => {
      planks(c, r, '#a8834f');
      c.fillStyle = '#5c4325';
      c.fillRect(0, 0, 16, 1); c.fillRect(0, 15, 16, 1); c.fillRect(0, 0, 1, 16); c.fillRect(15, 0, 1, 16);
      c.fillRect(5, 1, 1, 14); c.fillRect(10, 1, 1, 14); c.fillRect(1, 5, 14, 1); c.fillRect(1, 10, 14, 1);
    },
    [B.FURNACE]: (c, r) => {
      noisy(c, r, '#7d7d7d', 0.2);
      c.fillStyle = '#5a5a5a'; c.fillRect(3, 3, 10, 10);
      c.fillStyle = '#2a2a2a'; c.fillRect(5, 5, 6, 6);
    },
    [B.GLASS]: (c) => {
      c.fillStyle = 'rgba(200,230,255,0.15)'; c.fillRect(0, 0, 16, 16);
      c.fillStyle = '#dbeeff';
      c.fillRect(0, 0, 16, 1); c.fillRect(0, 15, 16, 1); c.fillRect(0, 0, 1, 16); c.fillRect(15, 0, 1, 16);
      c.fillRect(3, 3, 1, 3); c.fillRect(4, 3, 2, 1);
    },
    [B.TORCH]: (c) => {
      c.fillStyle = '#6b4a2a'; c.fillRect(7, 7, 2, 2);
      c.fillStyle = '#ffcf40'; c.fillRect(6, 6, 4, 4);
      c.fillStyle = '#fff6b0'; c.fillRect(7, 7, 2, 2);
      c.fillStyle = 'rgba(255,200,60,0.35)'; c.fillRect(4, 4, 8, 8);
    },
    // Gun tower from above: battlements round the edge, a crossbow in the dark well inside.
    [B.GUN_TOWER]: (c, r) => {
      c.fillStyle = '#707070'; c.fillRect(0, 0, 16, 16);
      for (const [mx, my] of [[0, 0], [6, 0], [12, 0], [0, 6], [12, 6], [0, 12], [6, 12], [12, 12]]) {
        for (let y = my; y < my + 4; y++) for (let x = mx; x < mx + 4; x++) { c.fillStyle = shade('#b8b8b8', 0.9 + r() * 0.2); c.fillRect(x, y, 1, 1); }
      }
      c.fillStyle = '#3a3a3a'; c.fillRect(4, 4, 8, 8);
      c.fillStyle = '#7a5530'; c.fillRect(7, 5, 2, 7);
      c.fillStyle = '#b8bec4'; c.fillRect(5, 6, 6, 1); c.fillRect(5, 7, 1, 1); c.fillRect(10, 7, 1, 1);
      c.fillStyle = '#e0e4e8'; c.fillRect(7, 4, 2, 1);
    },
    // Elevator: a framed pad with arrows up and down.
    [B.ELEVATOR]: (c, r) => {
      noisy(c, r, '#c9d3dc', 0.08);
      c.fillStyle = '#5a6672'; c.fillRect(0, 0, 16, 1); c.fillRect(0, 15, 16, 1); c.fillRect(0, 0, 1, 16); c.fillRect(15, 0, 1, 16);
      c.fillStyle = '#3c78c8';
      for (const [y, x0, w] of [[2, 7, 2], [3, 6, 4], [4, 5, 6], [5, 7, 2], [6, 7, 2], [9, 7, 2], [10, 7, 2], [11, 5, 6], [12, 6, 4], [13, 7, 2]]) c.fillRect(x0, y, w, 1);
    },
    [B.LAMP]: (c) => {
      c.fillStyle = '#2b2f36'; c.fillRect(4, 4, 8, 8);
      c.fillStyle = '#ffd870'; c.fillRect(6, 6, 4, 4);
    },
    [B.TALL_GRASS]: (c, r) => {
      for (let i = 0; i < 9; i++) {
        const x = 2 + Math.floor(r() * 12), y = 2 + Math.floor(r() * 12);
        c.fillStyle = shade('#6fae3f', 0.8 + r() * 0.4);
        c.fillRect(x, y, 1, 3);
        c.fillRect(x - 1, y + 1, 1, 1);
      }
    },
    [B.FLOWER_RED]: (c) => {
      c.fillStyle = '#4c8a2a'; c.fillRect(5, 9, 2, 2); c.fillRect(9, 6, 2, 2);
      c.fillStyle = '#d62b2b'; c.fillRect(6, 5, 4, 4);
      c.fillStyle = '#2b1a0a'; c.fillRect(7, 6, 2, 2);
    },
    [B.FLOWER_YELLOW]: (c) => {
      c.fillStyle = '#4c8a2a'; c.fillRect(5, 9, 2, 2); c.fillRect(9, 6, 2, 2);
      c.fillStyle = '#f5e042'; c.fillRect(6, 5, 4, 4);
      c.fillStyle = '#f59e1b'; c.fillRect(7, 6, 2, 2);
    },
    [B.DEAD_BUSH]: (c) => {
      c.fillStyle = '#8a6a3a';
      [[7, 7], [6, 6], [5, 5], [9, 6], [10, 5], [8, 9], [8, 10], [6, 9], [10, 9], [4, 7], [11, 8]].forEach(([x, y]) => c.fillRect(x, y, 1, 1));
    },
  };

  const sideGens = {
    [B.GRASS]: (c, r) => grassSide(c, r, '#5f9f35'),
    [B.SNOWY_GRASS]: (c, r) => grassSide(c, r, '#f2f6f8'),
    [B.OAK_LOG]: (c, r) => bark(c, r, '#6b4f2c'),
    [B.SPRUCE_LOG]: (c, r) => bark(c, r, '#3b2a17'),
    [B.CACTUS]: (c, r) => { bark(c, r, '#3c8a2e'); speckle(c, r, '#e8e8b0', 5); },
    [B.CRAFTING_TABLE]: (c, r) => { planks(c, r, '#8a6a3f'); c.fillStyle = '#3a3a3a'; c.fillRect(3, 4, 3, 6); c.fillRect(10, 4, 3, 3); },
    [B.FURNACE]: (c, r) => { noisy(c, r, '#7d7d7d', 0.2); c.fillStyle = '#2a2a2a'; c.fillRect(4, 7, 8, 6); },
    [B.SANDSTONE]: (c, r) => { noisy(c, r, '#d8cc8f', 0.1); c.fillStyle = '#c4b77a'; c.fillRect(0, 4, 16, 1); c.fillRect(0, 11, 16, 1); },
    // Gun tower walls: stone bricks with notched battlements and a cross-shaped arrow slit.
    [B.GUN_TOWER]: (c, r) => {
      noisy(c, r, '#a2a2a2', 0.16);
      c.fillStyle = '#5e5e5e';
      for (const y of [4, 9, 14]) c.fillRect(0, y, 16, 1);
      for (const [x, y0, h] of [[8, 0, 4], [4, 5, 4], [12, 5, 4], [8, 10, 4]]) c.fillRect(x, y0, 1, h);
      c.fillStyle = '#3a3a3a'; c.fillRect(3, 0, 3, 2); c.fillRect(10, 0, 3, 2);
      c.fillStyle = '#161616'; c.fillRect(7, 5, 2, 8); c.fillRect(5, 8, 6, 2);
    },
  };

  // ---- item icons (pixel art) -------------------------------------------
  const TOOL_ART = {
    pickaxe: [
      '................',
      '...mmmmmmm......',
      '..mdddddddm.....',
      '.m.....hh.dm....',
      '......h....dm...',
      '.....h......dm..',
      '....h........m..',
      '...h............',
      '..h.............',
      '.h..............',
    ],
    axe: [
      '................',
      '........mmm.....',
      '.......mdddm....',
      '......mddddm....',
      '.....mdddhm.....',
      '......mmh.......',
      '.......h........',
      '......h.........',
      '.....h..........',
      '....h...........',
      '...h............',
      '..h.............',
    ],
    shovel: [
      '................',
      '..........mmm...',
      '.........mdddm..',
      '.........mdddm..',
      '..........mdm...',
      '.........h......',
      '........h.......',
      '.......h........',
      '......h.........',
      '.....h..........',
      '....h...........',
      '...h............',
    ],
    sword: [
      '................',
      '............mm..',
      '...........mdm..',
      '..........mdm...',
      '.........mdm....',
      '........mdm.....',
      '.......mdm......',
      '..k...mdm.......',
      '...k.mdm........',
      '....khm.........',
      '....hk..........',
      '...h..k.........',
      '..h.............',
    ],
    // Double-bladed greataxe on a long haft.
    greataxe: [
      '..mm.......mm...',
      '.mddm..kk.mddm..',
      'mdddmmmhhmmdddm.',
      'mdddddhhhhddddm.',
      'mdddmmmhhmmdddm.',
      '.mddm..hh..mddm.',
      '..mm...hh...mm..',
      '.......hh.......',
      '.......hh.......',
      '.......hh.......',
      '.......hh.......',
      '.......hh.......',
      '.......hh.......',
      '......kkkk......',
    ],
  };

  // Chest: lid seen from above, and the front with the lid seam and latch.
  const CHEST_WOOD = '#9a6a30';
  gens[B.CHEST] = (c, r) => {
    planks(c, r, CHEST_WOOD);
    c.fillStyle = '#4a3010';
    c.fillRect(0, 0, 16, 1); c.fillRect(0, 15, 16, 1); c.fillRect(0, 0, 1, 16); c.fillRect(15, 0, 1, 16);
    c.fillStyle = '#6a4818'; c.fillRect(1, 1, 14, 1);
  };
  sideGens[B.CHEST] = (c, r) => {
    planks(c, r, '#8e622c');
    c.fillStyle = '#4a3010';
    c.fillRect(0, 0, 16, 1); c.fillRect(0, 15, 16, 1); c.fillRect(0, 0, 1, 16); c.fillRect(15, 0, 1, 16);
    c.fillRect(1, 5, 14, 1);                                   // lid seam
    c.fillStyle = '#c8c8c8'; c.fillRect(7, 4, 2, 4);           // latch
    c.fillStyle = '#606060'; c.fillRect(7, 7, 2, 1); c.fillRect(8, 4, 1, 3);
  };

  // Beehive: honey-coloured boards, an entrance hole, honey dripping when full.
  const hiveSide = (full) => (c, r) => {
    planks(c, r, '#c8963a');
    c.fillStyle = '#7a5418'; c.fillRect(0, 0, 16, 1); c.fillRect(0, 15, 16, 1);
    c.fillStyle = '#2a1a08'; c.fillRect(6, 7, 4, 3);
    if (full) { c.fillStyle = '#f0b020'; c.fillRect(7, 10, 2, 2); c.fillRect(8, 12, 1, 2); c.fillStyle = '#ffd860'; c.fillRect(7, 10, 1, 1); }
  };
  const hiveTop = (c, r) => {
    noisy(c, r, '#d8a440', 0.1);
    c.fillStyle = '#a87420';
    for (let y = 0; y < 16; y += 4) for (let x = (y % 8 ? 2 : 0); x < 16; x += 4) { c.fillRect(x, y, 3, 1); c.fillRect(x, y + 3, 3, 1); c.fillRect(x, y + 1, 1, 2); }
  };
  gens[B.BEEHIVE] = gens[B.BEEHIVE_EMPTY] = hiveTop;
  sideGens[B.BEEHIVE] = hiveSide(true);
  sideGens[B.BEEHIVE_EMPTY] = hiveSide(false);

  // Backpack art shared by the tiers (Tibia's colour variants of the same bag).
  const BAG_ART = ['.....kkk.....', '....k...k....', '...kkkkkkk...', '..kfffffffk..', '.kfFFFFFFFfk.', '.kfffffffffk.', '.kbbbbybbbbk.',
    '.kbbbyyybbbk.', '.kbbbbybbbbk.', '.kbhbbbbbbbk.', '.kbhbbbbbbbk.', '.kbbbbbbbbbk.', '..kbbbbbbbk..', '...kkkkkkk...'];
  const BIG_BAG_ART = ['....kkkkkk....', '...k......k...', '..kkkkkkkkkk..', '.kffffffffffk.', 'kfFFFFFFFFFFfk', 'kffffffffffffk', 'kmbbbbyybbbbmk',
    'kmbbbyyyybbbmk', 'kmbbbbyybbbbmk', 'kmbhbbbbbbbbmk', 'kmbhbbbbbbbbmk', 'kmbbbbbbbbbbmk', '.kmbbbbbbbbmk.', '..kkkkkkkkkk..'];

  const ITEM_ART = {
    // Tibia's brown leather backpack: strap loop, darker flap, gold buckle.
    [I.BACKPACK]: { art: BAG_ART, colors: { k: '#3a2410', f: '#6e441e', F: '#8f5e2c', b: '#8a5a2a', h: '#b07a40', y: '#d8b040' }, offX: 1, offY: 1 },
    // Greater backpack: Tibia's green backpack.
    [I.GREATER_BACKPACK]: { art: BAG_ART, colors: { k: '#1c2a10', f: '#3e5a1e', F: '#56782a', b: '#4e6e26', h: '#78a040', y: '#d8b040' }, offX: 1, offY: 1 },
    // Bigpack: big golden backpack on a metal chassis.
    [I.BIGPACK]: { art: BIG_BAG_ART, colors: { k: '#3a2808', f: '#8a6418', F: '#b08420', b: '#c09030', h: '#e8c060', y: '#f8e8a0', m: '#9aa0a8' }, offX: 1, offY: 1 },
    [I.PACK_CHASSIS]: {
      art: ['mmmmmmmmmmmm', 'm..b....b..m', 'm..b....b..m', 'mmmmmmmmmmmm', 'm..b....b..m', 'm..b....b..m', 'mmmmmmmmmmmm', 'm..b....b..m', 'mmmmmmmmmmmm'],
      colors: { m: '#9aa0a8', b: '#e8e0c8' }, offX: 2, offY: 3,
    },
    [I.BEESWAX]: { art: ['...xxxx...', '.xxyyxxxx.', 'xxyyxxxxxx', 'xxxxxxxxzx', '.xxxxxxzx.', '..xxxxxx..'], colors: { x: '#f0c040', y: '#fff0a0', z: '#c09020' }, offY: 5 },
    [I.IRON_BARS]: { art: ['mmmmmmmmmmmm', 'm.m.m.m.m.mm', 'm.m.m.m.m.mm', 'm.m.m.m.m.mm', 'm.m.m.m.m.mm', 'm.m.m.m.m.mm', 'm.m.m.m.m.mm', 'm.m.m.m.m.mm', 'mmmmmmmmmmmm'], colors: { m: '#a8acb2' }, offX: 2, offY: 3 },
    [I.FENCE]: { art: ['.pp......pp.', '.pp......pp.', '.pprrrrrrpp.', '.pprrrrrrpp.', '.pp......pp.', '.pp......pp.', '.pprrrrrrpp.', '.pprrrrrrpp.', '.pp......pp.', '.pp......pp.', '.dd......dd.'],
      colors: { p: '#a07a48', r: '#b8905a', d: '#6e5030' }, offX: 2, offY: 2 },
    [I.GLASS_PANE]: { art: ['ffffffffff', 'fbbbbbbbbf', 'fbwbbbbbbf', 'fbbwbbbbbf', 'fbbbwbbbbf', 'fbbbbbbbbf', 'fbbbbbwbbf', 'fbbbbbbwbf', 'fbbbbbbbbf', 'fbbbbbbbbf', 'fbbbbbbbbf', 'ffffffffff'],
      colors: { f: '#c8dceb', b: 'rgba(190,225,255,0.35)', w: '#ffffff' }, offX: 3, offY: 2 },
    [I.BONE]: { art: ['bb.......', 'bbb......', '.bbb.....', '..bbb....', '...bbb...', '....bbb..', '.....bbbb', '......bbb', '.......b.'], colors: { b: '#ece6d4' }, offX: 3, offY: 3 },
    [I.LEATHER]: {
      art: ['..xxxxxx..', '.xxyyxxxx.', 'xxxyxxxxxx', 'xxxxxxyxx.', '.xxxxxxxxx', '..xxyxxxx.', '...xxxxx..'],
      colors: { x: '#a0683a', y: '#c88a50' }, offY: 4,
    },
    [I.DOOR]: {
      art: ['kkkkkkkk', 'kddddddk', 'kdggggdk', 'kdggggdk', 'kddddddk', 'kdppppdk', 'kdppppdk', 'kddddydk','kdppppdk', 'kdppppdk', 'kddddddk', 'kkkkkkkk'],
      colors: { k: '#5a3e20', d: '#9a7040', p: '#7a5630', g: '#a9d4f0', y: '#d8b040' }, offX: 4, offY: 2,
    },
    [I.STICK]: { art: ['.........hh', '........hh.', '.......hh..', '......hh...', '.....hh....', '....hh.....', '...hh......', '..hh.......'], colors: { h: '#8a6a3f' }, offY: 3 },
    [I.COAL]: { art: ['....xxxx....', '..xxxyxxxx..', '.xxxxxxxyxx.', '.xyxxxxxxxx.', '.xxxxxyxxxx.', '..xxxxxxxx..', '....xxxx....'], colors: { x: '#262626', y: '#4a4a4a' }, offY: 4 },
    [I.IRON_INGOT]: { art: ['....yyyyyyy.', '...yxxxxxxy.', '..yxxxxxxy..', '.yxxxxxxy...', '.zzzzzzz....'], colors: { x: '#d8d8d8', y: '#ffffff', z: '#8a8a8a' }, offY: 6 },
    [I.GOLD_INGOT]: { art: ['....yyyyyyy.', '...yxxxxxxy.', '..yxxxxxxy..', '.yxxxxxxy...', '.zzzzzzz....'], colors: { x: '#f5d742', y: '#fff6a8', z: '#b08a10' }, offY: 6 },
    [I.DIAMOND]: { art: ['...yyyyyy...', '..yxxxxxxy..', '.yxxxxxxxxy.', '..zxxxxxxz..', '...zxxxxz...', '....zxxz....', '.....zz.....'], colors: { x: '#5decf5', y: '#c8fbff', z: '#1f9ea6' }, offY: 4 },
    [I.RAW_PORK]: { art: ['...xxxxx....', '..xxyyxxx...', '.xxxyyxxxw..', '.xxxxxxxxww.', '..xxxxxxxw..', '...xxxxx....'], colors: { x: '#f08c8c', y: '#f5b5b5', w: '#ffffff' }, offY: 5 },
    [I.COOKED_PORK]: { art: ['...xxxxx....', '..xxyyxxx...', '.xxxyyxxxw..', '.xxxxxxxxww.', '..xxxxxxxw..', '...xxxxx....'], colors: { x: '#9a5a2a', y: '#c27a40', w: '#eadfc8' }, offY: 5 },
    [I.APPLE]: { art: ['.....h......', '....hg......', '..xxxxxx....', '.xxyxxxxx...', '.xyxxxxxx...', '.xxxxxxxx...', '..xxxxxx....', '...xxxx.....'], colors: { x: '#d42a2a', y: '#ff8a8a', h: '#5a3a1a', g: '#4c8a2a' }, offY: 4 },
    [I.ROTTEN_FLESH]: { art: ['..xxxx......', '.xxyxxxx....', '..xxxxyxx...', '...xxyxxxx..', '....xxxxx...'], colors: { x: '#8a5a3a', y: '#5a7a3a' }, offY: 5 },
  };

  // ---- equipment art (Tibia-like). k outline, d shadow, m base, l highlight, y trim ----
  const EQUIP_ART = {
    head: ['....kkkk....', '..kkmllmkk..', '.kmllmmmmdk.', '.kmlmmmmmdk.', 'kmlmmmmmmmdk', 'kmmkkkkkkmdk', 'kmk......kdk', 'kmk......kdk', 'kdk......kdk', '.k........k.'],
    body: ['..kkk....kkk..', '.kmmmkkkkmmmk.', 'kmllmmmmmmmmdk', 'kmlmmmmmmmmmdk', 'kkkmlmmmmmmdkk', '..kmlmmmmmmdk.', '..kmlmmmmmmdk.',
      '..kmmmmmmmmdk.', '..kmmmmmmmmdk.', '..kdddddddddk.', '..kkkkkkkkkkk.'],
    legs: ['kkkkkkkkkkkk', 'kllmmmmmmmdk', 'kmlmmmmmmmdk', 'kmlmmkkmmmdk', 'kmlmk..kmmdk', 'kmlmk..kmmdk', 'kmlmk..kmmdk', 'kmlmk..kmmdk',
      'kmlmk..kmmdk', 'kdddk..kdddk', 'kkkkk..kkkkk'],
    boot: ['kkkk...', 'kmlk...', 'kmlk...', 'kmlk...', 'kmlmkkk', 'kmmmmmk', 'kdddddk', 'kkkkkkk'],
    round: ['....kkkk....', '..kkmllmkk..', '.kmllmmmmdk.', '.kmlmmyymdk.', 'kmlmmyyyymdk', 'kmlmmyyyymdk', 'kmmmmmyymmdk', '.kmmmmmmmdk.',
      '.kdmmmmmddk.', '..kkddddkk..', '....kkkk....'],
    kite: ['kkkkkkkkkkkk', 'kllllmmmmmdk', 'klmmmmmmmmdk', 'klmmyyyymmdk', 'klmmyyyymmdk', 'klmmmyymmmdk', '.kmmmyymmdk.', '.kmmmmmmmdk.',
      '..kmmmmmdk..', '..kmmmmmdk..', '...kmmmdk...', '....kddk....', '.....kk.....'],
    ring: ['...rr...', '..rRrr..', '.yyrryy.', 'yh....dy', 'yh....dy', 'yh....dy', '.yd..dy.', '..yyyy..'],
    amulet: ['c.........c', '.c.......c.', '..c.....c..', '...c...c...', '....ccc....', '....kyk....', '...kyhyk...', '...kyyyk...', '....kyk....', '.....k.....'],
    arrow: ['.........hhh', '..........hh', '.........h.h', '........h...', '.......h....', '......h.....', '.....h......', '....h.......', '.f.h........', '..f.........', '.f.f........'],
  };
  // Where each piece sits in the 16x16 icon.
  const EQUIP_POS = { head: [2, 3], body: [1, 2], legs: [2, 2], round: [2, 2], kite: [2, 1], ring: [4, 4], amulet: [2, 3], arrow: [2, 2] };

  function equipPalette(color) {
    return { k: shade(color, 0.38), d: shade(color, 0.7), m: color, l: shade(color, 1.35), y: '#d8b040' };
  }

  // Draw an equipment shape. Boots are a pair (back boot first). Chain armor gets a mesh.
  function drawEquip(c, shape, colors, mesh) {
    if (shape === 'boots') {
      drawArt(c, EQUIP_ART.boot, colors, 7, 3);
      drawArt(c, EQUIP_ART.boot, colors, 2, 6);
    } else {
      drawArt(c, EQUIP_ART[shape], colors, EQUIP_POS[shape][0], EQUIP_POS[shape][1]);
    }
    if (mesh) { // chain links: every other base pixel a shade darker
      const d = c.getImageData(0, 0, TEX, TEX), px = d.data, [r, g, b] = hexToRgb(colors.m);
      for (let i = 0; i < px.length; i += 4) {
        const x = (i / 4) % TEX, y = Math.floor(i / 4 / TEX);
        if (px[i + 3] && px[i] === r && px[i + 1] === g && px[i + 2] === b && (x + y) % 2) { px[i] *= 0.72; px[i + 1] *= 0.72; px[i + 2] *= 0.72; }
      }
      c.putImageData(d, 0, 0);
    }
  }

  const EQUIP_SHAPE = { head: 'head', body: 'body', legs: 'legs', feet: 'boots' };
  const OTHER_EQUIP = {
    [I.WOODEN_SHIELD]: ['round', { k: '#3a2410', d: '#6e441e', m: '#9a6a30', l: '#c08a48', y: '#9aa0a8' }],
    [I.PLATE_SHIELD]: ['kite', { k: '#3a3e44', d: '#7a828a', m: '#b8c0c8', l: '#e8eef4', y: '#d8b040' }],
    [I.GOLD_RING]: ['ring', { y: '#e8b828', h: '#fff0a0', d: '#a07810', r: '#d02020', R: '#ff8080' }],
    [I.BRONZE_AMULET]: ['amulet', { y: '#c0803a', h: '#f0b878', k: '#5a3410', c: '#9a6a30' }],
  };

  // Faint silhouettes shown in empty equipment slots, like Tibia's.
  const GHOST_SHAPE = { neck: 'amulet', head: 'head', hand: 'sword', body: 'body', shield: 'kite', ring: 'ring', legs: 'legs', ammo: 'arrow', feet: 'boots' };
  const ghostUrls = {};
  function ghostUrl(slot) {
    if (ghostUrls[slot]) return ghostUrls[slot];
    const c = canvas(), ctx = c.getContext('2d');
    const any = new Proxy({}, { get: (t, k) => (k === '.' ? undefined : '#2a2a2a') });
    if (slot === 'back') drawArt(ctx, BAG_ART, any, 1, 1);
    else if (slot === 'hand') drawArt(ctx, TOOL_ART.sword, any, 1, 1);
    else drawEquip(ctx, GHOST_SHAPE[slot], any, false);
    const big = document.createElement('canvas');
    big.width = big.height = 32;
    const b = big.getContext('2d');
    b.imageSmoothingEnabled = false;
    b.drawImage(c, 0, 0, 32, 32);
    return (ghostUrls[slot] = big.toDataURL());
  }

  // Condition icons for the bar under the equipment (Tibia's status icons).
  const CONDITION_ART = {
    poisoned: [['....g....', '...ggg...', '...ggg...', '..gGggg..', '.gGggggg.', '.gGggggg.', '.gggggdg.', '..gggdg..', '...ggg...'], { g: '#5fbf2a', G: '#c8f490', d: '#2f7a10' }],
    drowning: [['......bb.', '.....b..b', '.....b..b', '.bb...bb.', 'b..b.....', 'b..b..b..', '.bb..b.b.', '......b..', '.........'], { b: '#8ad0ff' }],
    hungry: [['.....bb..', '....bwwb.', '...bmmb..', '..bmmmb..', '.bmmmmb..', '.bmmmb...', '.bmmb....', '..bb.....', '.........'], { b: '#2a1608', w: '#f0e8d8', m: '#b8622a' }],
    creative: [['....y....', '....y....', '...yyy...', 'yyyyyyyyy', '.yyyyyyy.', '..yyyyy..', '..yy.yy..', '.yy...yy.', '.y.....y.'], { y: '#ffd84a' }],
  };
  const conditionUrls = {};
  function conditionUrl(name) {
    if (conditionUrls[name]) return conditionUrls[name];
    const [art, colors] = CONDITION_ART[name];
    const c = document.createElement('canvas');
    c.width = c.height = 18;
    const ctx = c.getContext('2d');
    art.forEach((row, y) => [...row].forEach((ch, x) => { if (colors[ch]) { ctx.fillStyle = colors[ch]; ctx.fillRect(x * 2, y * 2, 2, 2); } }));
    return (conditionUrls[name] = c.toDataURL());
  }

  // Side-view sprites for non-cube blocks when shown as items.
  const DECO_ART = {
    [B.TORCH]: { art: ['...y...', '..yoy..', '..oro..', '...w...', '...w...', '...w...', '...w...', '...w...', '...w...', '...w...'], colors: { y: '#fff3a0', o: '#ffb020', r: '#ff6a00', w: '#7a5530' }, offX: 4, offY: 3 },
    [B.LAMP]: {
      art: ['....kkk....', '...k...k...', '....kkk....', '..kkkkkkk..', '.khhhhhhhk.', '..kyyyyyk..', '..kyfffyk..', '..kyfwfyk..', '..kyfffyk..', '..kyyyyyk..', '.khhhhhhhk.', '..kkkkkkk..'],
      colors: { k: '#2b2f36', h: '#5d6573', y: '#f0a030', f: '#ffd870', w: '#fffbe0' }, offX: 2, offY: 2, glow: [5, 7],
    },
    [B.FLOWER_RED]: { art: ['..rr.', '.rddr', '.rrrr', '..rr.', '..g..', '.gg..', '..g.g', '..gg.', '..g..'], colors: { r: '#d62b2b', d: '#2b1a0a', g: '#4c8a2a' }, offX: 5, offY: 4 },
    [B.FLOWER_YELLOW]: { art: ['..yy.', '.yooy', '.yyyy', '..yy.', '..g..', '.gg..', '..g.g', '..gg.', '..g..'], colors: { y: '#f5e042', o: '#f59e1b', g: '#4c8a2a' }, offX: 5, offY: 4 },
    [B.TALL_GRASS]: { art: ['.g....g...', '.g..g.g..g', 'gg..g.gg.g', 'g.g.gg.g.g', 'g.g.g..ggg', '.gggg..gg.', '..ggg.gg..', '...gggg...'], colors: { g: '#6fae3f' }, offX: 3, offY: 6 },
    [B.DEAD_BUSH]: { art: ['b.......b', '.b..b..b.', '..b.b.b..', 'b..bbb..b', '.b..b..b.', '..bbbbb..', '....b....', '....b....'], colors: { b: '#8a6a3a' }, offX: 3, offY: 6 },
  };

  function drawArt(c, rows, colors, offX = 2, offY = 2) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = colors[row[x]];
        if (col) { c.fillStyle = col; c.fillRect(x + offX, y + offY, 1, 1); }
      }
    });
  }

  // ---- doors ---------------------------------------------------------------
  const DOOR_WOOD = '#9a7040';

  // Front of a door: frame, recessed panels, handle (lower half) or window (upper half).
  function doorPanel(c, r, upper) {
    noisy(c, r, DOOR_WOOD, 0.12);
    c.fillStyle = shade(DOOR_WOOD, 0.62);
    c.fillRect(0, 0, 16, 1); c.fillRect(0, 0, 1, 16); c.fillRect(15, 0, 1, 16);
    if (!upper) c.fillRect(0, 15, 16, 1);
    c.fillStyle = shade(DOOR_WOOD, 0.8);
    if (upper) {
      c.fillRect(3, 3, 10, 9);
      c.fillStyle = '#a9d4f0'; c.fillRect(4, 4, 3, 3); c.fillRect(9, 4, 3, 3); c.fillRect(4, 8, 3, 3); c.fillRect(9, 8, 3, 3);
      c.fillStyle = '#e6f6ff'; c.fillRect(4, 4, 1, 1); c.fillRect(9, 4, 1, 1);
    } else {
      c.fillRect(3, 2, 10, 5); c.fillRect(3, 9, 10, 5);
      c.fillStyle = '#3a2a14'; c.fillRect(12, 6, 2, 2);
      c.fillStyle = '#d8b040'; c.fillRect(12, 6, 1, 1);
    }
  }

  // The narrow edge of a door seen from the side.
  function doorEdge(c, r) {
    noisy(c, r, '#835f36', 0.12);
    c.fillStyle = shade(DOOR_WOOD, 0.55);
    c.fillRect(6, 0, 4, 16);
    c.fillStyle = shade(DOOR_WOOD, 0.72);
    c.fillRect(7, 0, 2, 16);
  }

  // Seen from above: door thickness as a dark band through the middle of the tile.
  function doorTop(c, r, axis) {
    planks(c, r, '#8a6a3f');
    c.fillStyle = shade(DOOR_WOOD, 0.55);
    if (axis === 'ns') c.fillRect(0, 6, 16, 4); else c.fillRect(6, 0, 4, 16);
  }

  const east = []; // east-face textures where they differ from the south face (doors)

  function init() {
    // Stairs reuse their base block's textures.
    for (const id in BLOCKS) {
      const b = BLOCKS[id];
      if (b && b.stairs) { gens[id] = gens[b.stairBase]; if (sideGens[b.stairBase]) sideGens[id] = sideGens[b.stairBase]; }
      if (b && b.wall) { gens[id] = gens[B.TORCH]; DECO_ART[id] = DECO_ART[B.TORCH]; }
      if (b && b.panel) gens[id] = { bars: (c, r) => noisy(c, r, '#9aa0a6', 0.1), fence: gens[B.PLANKS], glass: gens[B.GLASS] }[b.panel];
    }
    gens[B.DOOR_NS] = gens[B.DOOR_NS_TOP] = (c, r) => doorTop(c, r, 'ns');
    gens[B.DOOR_EW] = gens[B.DOOR_EW_TOP] = (c, r) => doorTop(c, r, 'ew');
    // The door's front faces the way you walk through it.
    const doorFaces = { [B.DOOR_NS]: ['front', false], [B.DOOR_NS_TOP]: ['front', true], [B.DOOR_EW]: ['edge'], [B.DOOR_EW_TOP]: ['edge'] };
    const doorEast = { [B.DOOR_NS]: ['edge'], [B.DOOR_NS_TOP]: ['edge'], [B.DOOR_EW]: ['front', false], [B.DOOR_EW_TOP]: ['front', true] };
    const paintDoor = ([kind, upper], seed) => {
      const s = canvas();
      if (kind === 'front') doorPanel(s.getContext('2d'), mulberry32(seed), upper); else doorEdge(s.getContext('2d'), mulberry32(seed));
      return s;
    };

    for (let id = 1; id < BLOCKS.length; id++) {
      if (!BLOCKS[id]) continue;
      const rand = mulberry32(id * 7919);
      const t = canvas();
      const ctx = t.getContext('2d');
      (gens[id] || ((c, r) => noisy(c, r, '#ff00ff', 0.2)))(ctx, rand);
      top[id] = t;
      if (doorFaces[id]) {
        side[id] = paintDoor(doorFaces[id], id * 31);
        east[id] = paintDoor(doorEast[id], id * 37);
      } else if (sideGens[id]) {
        const s = canvas();
        sideGens[id](s.getContext('2d'), mulberry32(id * 104729));
        side[id] = s;
      } else {
        side[id] = t;
      }
      colors[id] = averageColor(t);
      const b = BLOCKS[id];
      if (DECO_ART[id]) {
        const c = canvas();
        const a = DECO_ART[id];
        drawArt(c.getContext('2d'), a.art, a.colors, a.offX || 2, a.offY || 1);
        icons[id] = withShadow(c);
        if (b.upright && !b.torch) { // torches are 3D models (renderer.drawTorch)
          const s = document.createElement('canvas');
          s.width = Math.max(...a.art.map((row) => row.length)); s.height = a.art.length;
          drawArt(s.getContext('2d'), a.art, a.colors, 0, 0);
          s.glow = a.glow;
          sprites[id] = s;
        }
      } else if (!b.liquid) {
        icons[id] = cube(t, side[id]);
      }
    }
    buildCracks();
    buildLiquids();
    animate(0);

    for (const id in ITEMS) {
      const def = ITEMS[id];
      const c = canvas();
      const ctx = c.getContext('2d');
      if (def.stairs) {
        icons[id] = stairIcon(top[def.stairs], side[def.stairs]);
        continue;
      }
      if (def.tool) {
        const m = def.material.color;
        drawArt(ctx, TOOL_ART[def.art || def.tool.type], { m: shade(m, 1.15), d: m, h: '#6b4a2a', k: '#4a3218' }, def.art ? 0 : 1, 1);
      } else if (def.armor != null) {
        drawEquip(ctx, EQUIP_SHAPE[def.equip], equipPalette(def.color), def.set === 'chain');
      } else if (OTHER_EQUIP[id]) {
        drawEquip(ctx, OTHER_EQUIP[id][0], OTHER_EQUIP[id][1], false);
      } else if (ITEM_ART[id]) {
        const a = ITEM_ART[id];
        drawArt(ctx, a.art, a.colors, a.offX != null ? a.offX : 2, a.offY);
      }
      icons[id] = withShadow(c);
    }
    buildHungerIcons();
  }

  // Corner-view box with faces cut from the block textures (coordinates in block units).
  function isoBox(ctx, topTex, sideTex, x0, x1, y0, y1, z0, z1) {
    const P = (x, y, z) => [16 + (x - y) * 15, 1 + (x + y) * 7.5 + (1 - z) * 15.5];
    const face = (tex, src, O, U, V, dark) => {
      const [sx, sy, sw, sh] = src;
      ctx.setTransform((U[0] - O[0]) / sw, (U[1] - O[1]) / sw, (V[0] - O[0]) / sh, (V[1] - O[1]) / sh, O[0], O[1]);
      ctx.drawImage(tex, sx, sy, sw, sh, 0, 0, sw, sh);
      if (dark) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(0,0,0,${dark})`;
        ctx.fillRect(0, 0, sw, sh);
        ctx.globalCompositeOperation = 'source-over';
      }
    };
    const w = x1 - x0, d = y1 - y0, h = z1 - z0;
    face(topTex, [x0 * 16, y0 * 16, w * 16, d * 16], P(x0, y0, z1), P(x1, y0, z1), P(x0, y1, z1), 0);
    face(sideTex, [x0 * 16, (1 - z1) * 16, w * 16, h * 16], P(x0, y1, z1), P(x1, y1, z1), P(x0, y1, z0), 0.22);
    face(sideTex, [(1 - y1) * 16, (1 - z1) * 16, d * 16, h * 16], P(x1, y1, z1), P(x1, y0, z1), P(x1, y1, z0), 0.4);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function stairIcon(topTex, sideTex) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    isoBox(ctx, topTex, sideTex, 0, 1, 0, 1, 0, 0.5);     // bottom step
    isoBox(ctx, topTex, sideTex, 0, 1, 0, 0.5, 0.5, 1);   // top step at the back
    return c;
  }

  // Hunger bar icons: full / half / empty drumsticks (data URLs for the HUD).
  const hunger = {};
  function buildHungerIcons() {
    const art = ['.....bb..', '....bwwb.', '...bmmb..', '..bmmmb..', '.bmmmmb..', '.bmmmb...', '.bmmb....', '..bb.....', '.........'];
    const make = (fill) => {
      const c = document.createElement('canvas');
      c.width = 18; c.height = 18;
      const ctx = c.getContext('2d');
      art.forEach((row, y) => [...row].forEach((ch, x) => {
        let col = null;
        if (ch === 'b') col = '#2a1608';
        else if (ch === 'w') col = '#f0e8d8';
        else if (ch === 'm') col = (fill === 'full' || (fill === 'half' && x < 4)) ? (y < 4 ? '#e0904a' : '#b8622a') : '#3a2a20';
        if (col) { ctx.fillStyle = col; ctx.fillRect(x * 2, y * 2, 2, 2); }
      }));
      return c.toDataURL();
    };
    hunger.full = make('full'); hunger.half = make('half'); hunger.empty = make('empty');
  }

  // Minecraft-inventory style isometric cube (corner view) from a block's textures.
  function cube(topTex, sideTex) {
    const S = 32;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const k = 15 / 16, h = 7.5 / 16;
    const faces = [
      // top: diamond from (16,1)
      { tex: topTex, m: [k, h, -k, h, 16, 1], dark: 0 },
      // left: from (1, 8.5) down to the front corner
      { tex: sideTex, m: [k, h, 0, 15.5 / 16, 1, 8.5], dark: 0.22 },
      // right: from the front corner (16, 16) up to (31, 8.5)
      { tex: sideTex, m: [k, -h, 0, 15.5 / 16, 16, 16], dark: 0.4 },
    ];
    for (const f of faces) {
      ctx.setTransform(...f.m);
      ctx.drawImage(f.tex, 0, 0);
      if (f.dark) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(0,0,0,${f.dark})`;
        ctx.fillRect(0, 0, TEX, TEX);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  }

  // Flat sprite with a dark drop shadow to the lower right, so it reads as a raised object.
  function withShadow(src) {
    const S = 32;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // shadow silhouette
    const sh = document.createElement('canvas');
    sh.width = S; sh.height = S;
    const sctx = sh.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(src, 0, 0, S, S);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = 'rgba(0,0,0,0.45)';
    sctx.fillRect(0, 0, S, S);
    ctx.drawImage(sh, 2, 2);
    ctx.drawImage(src, 0, 0, S, S);
    // light top-left edge highlight / dark bottom-right edge inside the sprite
    const d = ctx.getImageData(0, 0, S, S), px = d.data;
    const src2 = new Uint8ClampedArray(px);
    const sa = (x, y) => (x < 0 || y < 0 || x >= S || y >= S) ? 0 : src2[(y * S + x) * 4 + 3];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (src2[i + 3] < 200) continue;
      let f = 1;
      if (sa(x - 2, y) < 200 || sa(x, y - 2) < 200) f = 1.25;
      else if (sa(x + 2, y) < 200 || sa(x, y + 2) < 200) f = 0.72;
      if (f !== 1) for (let ch = 0; ch < 3; ch++) px[i + ch] = Math.min(255, src2[i + ch] * f);
    }
    ctx.putImageData(d, 0, 0);
    return c;
  }

  // ---- animated liquids ----------------------------------------------------
  // 32 seamless frames each: still water shimmers with drifting ripples, lava
  // churns and creeps; their side faces flow downward. All waves use whole-number
  // frequencies over the 16px tile and the loop, so frames tile and cycle cleanly.
  const ANIM_FRAMES = 32;
  const anim = {};

  function frames(paint) {
    const out = [];
    const rand = mulberry32(4242);
    const grain = Array.from({ length: TEX * TEX }, () => rand());
    for (let f = 0; f < ANIM_FRAMES; f++) {
      const c = canvas();
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(TEX, TEX);
      const t = f / ANIM_FRAMES;
      for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
        const [r, g, b, a = 255] = paint(x / TEX, y / TEX, t, grain[y * TEX + x]);
        const i = (y * TEX + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
      }
      ctx.putImageData(img, 0, 0);
      out.push(c);
    }
    return out;
  }

  const TAU = Math.PI * 2;
  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

  function buildLiquids() {
    anim[B.WATER] = {
      period: 3.2,
      top: frames((u, v, t, n) => {
        const w = Math.sin(TAU * (u + v + t)) * 0.5 + Math.sin(TAU * (2 * u - v - 2 * t)) * 0.35 + Math.sin(TAU * (u - 2 * v + t)) * 0.25;
        const f = 0.86 + w * 0.14 + (n - 0.5) * 0.06;
        const glint = w > 0.72 ? 60 : 0;
        return [clamp255(47 * f + glint), clamp255(95 * f + glint), clamp255(208 * f + glint * 0.6)];
      }),
      side: frames((u, v, t, n) => {
        const s = Math.sin(TAU * (2 * v - 2 * t) + Math.floor(u * 16) * 0.9) * 0.5 + Math.sin(TAU * (v * 3 - 3 * t + u)) * 0.3;
        const f = 0.85 + s * 0.12 + (n - 0.5) * 0.05;
        return [clamp255(52 * f), clamp255(102 * f), clamp255(215 * f)];
      }),
    };
    const lavaColor = (h) => {
      // dark crust -> red -> orange -> yellow
      const stops = [[90, 20, 5], [190, 50, 8], [235, 110, 20], [252, 190, 60], [255, 236, 140]];
      const x = Math.max(0, Math.min(0.999, h)) * (stops.length - 1);
      const i = Math.floor(x), k = x - i, a = stops[i], b = stops[i + 1];
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k].map(clamp255);
    };
    anim[B.LAVA] = {
      period: 6.4,
      top: frames((u, v, t, n) => {
        const h = Math.sin(TAU * (u + t)) * 0.3 + Math.sin(TAU * (2 * v + u - t)) * 0.3 + Math.sin(TAU * (2 * u - v + 2 * t)) * 0.25 + Math.sin(TAU * (u + 2 * v + t)) * 0.2;
        return lavaColor(0.5 + h * 0.45 + (n - 0.5) * 0.12);
      }),
      side: frames((u, v, t, n) => {
        const h = Math.sin(TAU * (2 * v - t) + Math.floor(u * 16) * 0.7) * 0.35 + Math.sin(TAU * (v - t + 2 * u)) * 0.3;
        return lavaColor(0.55 + h * 0.4 + (n - 0.5) * 0.1);
      }),
    };
  }

  // Swap the current animation frame into the block texture tables.
  function animate(seconds) {
    for (const id in anim) {
      const a = anim[id];
      const f = Math.floor(((seconds / a.period) % 1) * ANIM_FRAMES);
      top[id] = a.top[f];
      side[id] = a.side[f];
    }
  }

  // Minecraft-style destroy stages: one set of crack lines that grows over 10 stages.
  function buildCracks() {
    const rand = mulberry32(1337);
    const px = [];
    for (let b = 0; b < 9; b++) {
      let x = 6 + Math.floor(rand() * 4), y = 6 + Math.floor(rand() * 4);
      const a = (b / 9) * Math.PI * 2 + rand() * 0.6;
      let dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a));
      if (!dx && !dy) dx = 1;
      for (let i = 0; i < 9; i++) {
        px.push([x, y, i]);
        if (rand() < 0.35) { if (rand() < 0.5) x += dx; else y += dy; }
        x += dx; y += dy;
        if (rand() < 0.25) { const t = dx; dx = rand() < 0.5 ? dy : -dy; dy = rand() < 0.5 ? t : -t; if (!dx && !dy) dx = 1; }
        if (x < 0 || y < 0 || x > 15 || y > 15) break;
      }
    }
    // Interleave branches so every stage grows all cracks a little.
    px.sort((p, q) => p[2] - q[2]);
    for (let s = 0; s < 10; s++) {
      const c = canvas();
      const ctx = c.getContext('2d');
      const n = Math.ceil(px.length * (s + 1) / 10);
      for (let i = 0; i < n; i++) {
        const [x, y] = px[i];
        ctx.fillStyle = i % 3 === 0 ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.85)';
        ctx.fillRect(x, y, 1, 1);
        if (i % 4 === 0 && x < 15) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 1, y, 1, 1); }
      }
      cracks.push(c);
    }
  }

  // Average colour of a texture (used for block-breaking debris).
  function averageColor(c) {
    const d = c.getContext('2d').getImageData(0, 0, TEX, TEX).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    if (!n) return '#888';
    return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
  }

  function iconUrl(id) {
    if (!iconUrls[id]) {
      const src = icons[id];
      if (!src) return '';
      // Upscale so the browser doesn't blur it.
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, 32, 32);
      iconUrls[id] = c.toDataURL();
    }
    return iconUrls[id];
  }

  // Panels seen side on (16x16, see-through where you can look past them), with copies
  // darkened for 9 light levels so the gaps stay clear.
  const panelCache = {};
  const PANEL_ART = {
    bars(c) {
      c.fillStyle = '#8a9096'; c.fillRect(0, 0, 16, 2); c.fillRect(0, 14, 16, 2);
      for (const x of [1, 5, 9, 13]) {
        c.fillStyle = '#9aa0a6'; c.fillRect(x, 0, 2, 16);
        c.fillStyle = '#ccd2d7'; c.fillRect(x, 0, 1, 16);
        c.fillStyle = '#5d6369'; c.fillRect(x + 1, 2, 1, 12);
      }
    },
    fence(c, r) {
      for (const [x0, y0, w, h, col] of [[0, 3, 16, 3, '#b8905a'], [0, 10, 16, 3, '#b8905a'], [0, 0, 3, 16, '#a07a48'], [13, 0, 3, 16, '#a07a48']]) {
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { c.fillStyle = shade(col, 0.88 + r() * 0.2); c.fillRect(x, y, 1, 1); }
      }
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(3, 6, 10, 1); c.fillRect(3, 13, 10, 1); c.fillRect(2, 0, 1, 16); c.fillRect(15, 0, 1, 16);
    },
    glass(c) {
      c.fillStyle = 'rgba(200,230,255,0.22)'; c.fillRect(0, 0, 16, 16);
      c.fillStyle = '#dbeeff';
      c.fillRect(0, 0, 16, 1); c.fillRect(0, 15, 16, 1); c.fillRect(0, 0, 1, 16); c.fillRect(15, 0, 1, 16);
      c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillRect(3, 3, 1, 4); c.fillRect(4, 3, 3, 1); c.fillRect(10, 9, 1, 3);
    },
  };
  function panelTex(kind, light) {
    const lv = Math.round(Math.max(0, Math.min(1, light)) * 8);
    const set = panelCache[kind] || (panelCache[kind] = []);
    if (set[lv]) return set[lv];
    const c = canvas(), ctx = c.getContext('2d');
    PANEL_ART[kind](ctx, mulberry32(hashString('panel:' + kind)));
    if (lv < 8) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(0,0,0,${(1 - lv / 8) * 0.92})`;
      ctx.fillRect(0, 0, TEX, TEX);
    }
    return (set[lv] = c);
  }

  return { init, top, side, east, icons, iconUrl, ghostUrl, conditionUrl, shade, cracks, colors, sprites, panelTex, animate, hunger };
})();
