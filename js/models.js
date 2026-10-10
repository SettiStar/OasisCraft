// Tibia-style upright creature models built from Minecraft-like boxes.
//
// Each model is a list of boxes in local coordinates:
//   a = across (+ = the creature's right), f = forward, z = up (1 unit = 1 skin pixel).
// Boxes are drawn in a 3/4 view (south, top and east sides visible, the same
// sides the world projection shows) and can be rotated at joints: legs at the
// hip, arms at the shoulder and elbow. Faces are back-face culled against the
// view direction and painted far-to-near. Models turn to 4 facings.

const MODEL_K = 0.35;    // depth shifts this far right (reveals the east side)
const MODEL_Q = 0.5;     // top-face foreshortening
const MODEL_UNIT = 1 / 28; // tiles per model unit (a 32-unit-tall figure is ~1.15 tiles)
const TORCH_LEN = 9;       // torch model height in units (drawn at 16 units per tile, like block texels)

const ModelTex = (() => {
  const cache = new Map();
  const shade = (hex, f) => Textures.shade(hex, f);

  function make(key, w, h, paint) {
    let c = cache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const rand = mulberry32(hashString(key));
    paint((x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); }, rand, w, h);
    cache.set(key, c);
    return c;
  }

  // Uniform material with a little pixel noise, sized so texels match model units.
  function mat(color, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    return make(`m:${color}:${w}x${h}`, w, h, (px, r) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, shade(color, 0.9 + r() * 0.18));
    });
  }

  // Polished metal (armor, tool heads), Minecraft-like but with our own sheen: lit from
  // above, a bright rim along the top and left edges and a dark one along the bottom and
  // right, a diagonal streak of shine with a few glints, and (chain) a ring mesh.
  function metal(color, w, h, kind) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const K = METAL_KINDS[kind] || METAL_KINDS.steel;
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const base = rgb(color), hi = rgb(K.hi);
    const out = (c) => `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v)))).join(',')})`;
    return make(`x:${kind}:${color}:${w}x${h}`, w, h, (px, r) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h;
        let c = base.map((ch) => ch * (1.1 - 0.25 * v + (r() - 0.5) * 0.06));
        if (K.mesh && (x + y) % 2) c = c.map((ch) => ch * 0.62);
        const d = u * 0.8 + v * 0.55;
        const sheen = Math.max(0, 1 - Math.abs(d - 0.42) / 0.14) * K.sheen + Math.max(0, 1 - Math.abs(d - 0.8) / 0.07) * K.sheen * 0.5;
        const toward = (t) => { c = c.map((ch, i) => ch + (hi[i] - ch) * t); };
        toward(sheen);
        if (w >= 3 && h >= 3) {
          if (y === 0 || x === 0) toward(0.35 * K.rim);
          else if (y === h - 1 || x === w - 1) c = c.map((ch) => ch * 0.66);
        }
        if (sheen > 0.3 && r() < K.glint) c = hi.slice();
        px(x, y, out(c));
      }
    });
  }

  function head(p) {
    const k = `${p.skin}${p.hair}${p.eyes}`;
    return {
      front: make('hf' + k, 8, 8, (px, r) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const hair = y < 2 || (y === 2 && (x === 0 || x === 7));
          px(x, y, shade(hair ? p.hair : p.skin, 0.92 + r() * 0.14));
        }
        px(1, 4, '#ffffff'); px(2, 4, p.eyes); px(5, 4, p.eyes); px(6, 4, '#ffffff');
        px(3, 5, shade(p.skin, 0.8)); px(4, 5, shade(p.skin, 0.8));
        if (p.mouth) for (let x = 2; x < 6; x++) px(x, 6, p.mouth);
      }),
      // Side texture with the face toward u = 0.
      side: make('hs' + k, 8, 8, (px, r) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const hair = y < 2 || x >= 4 || (y < 3 && x >= 2);
          px(x, y, shade(hair ? p.hair : p.skin, 0.92 + r() * 0.14));
        }
        px(0, 4, p.eyes);
        px(3, 4, shade(p.skin, 0.75));
      }),
      back: make('hb' + k, 8, 8, (px, r) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, shade(p.hair, (y === 7 ? 0.8 : 0.9) + r() * 0.14));
      }),
      top: make('ht' + k, 8, 8, (px, r) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, shade(p.hair, 0.95 + r() * 0.15));
      }),
    };
  }

  function pigHead(p) {
    return {
      front: make('pf' + p.body, 8, 8, (px, r) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, shade(p.head, 0.93 + r() * 0.1));
        px(0, 3, '#ffffff'); px(1, 3, '#1a1a1a'); px(6, 3, '#1a1a1a'); px(7, 3, '#ffffff');
      }),
      side: make('ps' + p.body, 8, 8, (px, r) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, shade(p.head, 0.93 + r() * 0.1));
        px(1, 3, '#1a1a1a');
      }),
      back: null,
      top: null,
    };
  }

  function snout(p) {
    const front = make('sn' + p.snout, 4, 3, (px) => {
      for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) px(x, y, p.snout);
      px(0, 1, p.nostril); px(3, 1, p.nostril);
    });
    return { front, side: null, back: null, top: null };
  }

  return { make, mat, metal, head, pigHead, snout };
})();

// How each metal looks: highlight colour, sheen strength, rim highlight, glint chance, chain mesh,
// and `spec`: how strongly a face flashes when it turns toward the light (see drawModel3D).
const METAL_KINDS = {
  steel: { hi: '#ffffff', sheen: 0.6, rim: 1, glint: 0.25, spec: 0.8 },
  golden: { hi: '#fff6c8', sheen: 0.65, rim: 1, glint: 0.3, spec: 0.9 },
  diamond: { hi: '#e8ffff', sheen: 0.6, rim: 1, glint: 0.3, spec: 0.8 },
  chain: { hi: '#f0f4f8', sheen: 0.35, rim: 0.6, glint: 0.12, spec: 0.45, mesh: true },
  leather: { hi: '#e0b080', sheen: 0.15, rim: 0.4, glint: 0, spec: 0.12 },
};

// Flickering torch flame (placed and held torches): pixel-art frames, o outer, y middle, w core.
const torchFlame = (() => {
  let frames = null;
  return (seed = 0) => {
    if (!frames) {
      const colors = { o: '#ff7418', y: '#ffc83c', w: '#fff8d0' };
      frames = [
        ['..o..', '.oyo.', '.oyo.', 'oywyo', 'oywyo', '.oyo.'],
        ['.o...', '.oo..', '.oyo.', 'oyyo.', 'oywyo', '.oyo.'],
        ['..o..', '..oo.', '.oyo.', '.oyyo', 'oywyo', '.oyo.'],
        ['...o.', '..oo.', '.oyo.', '.oyyo', 'oywyo', '.oyo.'],
      ].map((rows) => {
        const c = document.createElement('canvas');
        c.width = rows[0].length; c.height = rows.length;
        const ctx = c.getContext('2d');
        rows.forEach((row, py) => [...row].forEach((ch, px) => { if (colors[ch]) { ctx.fillStyle = colors[ch]; ctx.fillRect(px, py, 1, 1); } }));
        return c;
      });
    }
    return frames[Math.floor(performance.now() / 1000 * 7 + Math.abs(seed)) % frames.length];
  };
})();

// ---- held tools, weapons and torches ----------------------------------------
// Boxes in grip coordinates: s runs up the handle from the middle of the fist, w across
// it (the way a head points), a is thickness. drawModel3D tilts them forward in the hand
// and swings them with the forearm. `flame: s` marks where a torch's flame burns.
// How far the handle leans forward from upright, in radians: tools and weapons point forward
// from the player (a little above level); a torch is held out at about 45 degrees (its flame
// is always drawn burning straight up).
const HELD_TILT = 1.3, HELD_TORCH_TILT = 0.8;
// The forearm around the grip point (model units): half its thickness, and how far it
// reaches above / below the grip. Handles (`grip`) aren't drawn inside it.
const GRIP_ARM = { half: 2, up: 5, down: 1 };
const HANDLE_WOOD = '#6b4a2a';

const heldModel = (() => {
  const cache = new Map();
  const box = (s0, s1, w0, w1, a0, a1, color, metal) => ({ s0, s1, w0, w1, a0, a1, color, metal });
  const handle = (s0, s1, t = 0.6, color = HANDLE_WOOD) => Object.assign(box(s0, s1, -t, t, -t, t, color), { grip: true });

  function build(id) {
    if (id === B.TORCH) {
      return [handle(-2, 7, 0.9, '#8a6034'), box(7, 9.2, -1.2, 1.2, -1.2, 1.2, '#3b2614'), { flame: 9.2 }];
    }
    const def = itemDef(id);
    if (!def || !def.tool) return null;
    const mat = def.material.color, metal = { iron: 'steel', diamond: 'diamond' }[def.material.key];
    const head = (s0, s1, w0, w1, a0, a1) => box(s0, s1, w0, w1, a0, a1, mat, metal);
    if (def.art === 'greataxe') {
      return [handle(-3, 17, 0.7), head(10, 16, 0.7, 6, -0.6, 0.6), head(11, 15, -5, -0.7, -0.6, 0.6), head(17, 18, -0.5, 0.5, -0.5, 0.5)];
    }
    switch (def.tool.type) {
      case 'pickaxe':
        return [handle(-2, 12), head(11, 12.6, -4.5, 4.5, -0.8, 0.8), head(9.4, 11, -6, -4.5, -0.7, 0.7), head(9.4, 11, 4.5, 6, -0.7, 0.7)];
      case 'axe':
        return [handle(-2, 12), head(7, 12, 0.6, 4.6, -0.55, 0.55), head(6.4, 12.6, 4.6, 5.4, -0.4, 0.4), head(9, 11, -1.6, 0.6, -0.7, 0.7)];
      case 'shovel':
        return [handle(-2, 9), head(8.5, 10, -0.9, 0.9, -0.9, 0.9), head(10, 15.5, -2, 2, -0.45, 0.45), head(15.5, 16.3, -1.2, 1.2, -0.4, 0.4)];
      case 'sword':
        return [head(-3.3, -2.2, -0.9, 0.9, -0.9, 0.9), handle(-2.2, 3, 0.65, '#4a3218'),
          box(3, 4.2, -2.8, 2.8, -1, 1, darkenHex(mat, 0.8), metal), head(4.2, 16, -1.1, 1.1, -0.4, 0.4), head(16, 17.5, -0.55, 0.55, -0.3, 0.3)];
      default: return null;
    }
  }

  // { parts, tilt } for items that have a 3D model in the hand, else null (drawn as an icon).
  return (id) => {
    if (!cache.has(id)) { const parts = build(id); cache.set(id, parts ? { parts, tilt: id === B.TORCH ? HELD_TORCH_TILT : HELD_TILT } : null); }
    return cache.get(id);
  };
})();

// ---- model definitions ----------------------------------------------------
// Each returns boxes { a0, a1, f0, f1, z0, z1, color, tex?, rot?, dz? }.
//   rot: joint rotations applied innermost-first, each { f, z, ang }: a pivot in
//        rest-pose (f, z) and an angle in radians (+ swings the limb forward).
//        All joints turn about the across (a) axis, like real hips/shoulders/elbows.
//   dz:  vertical offset applied last (used for the gait bob).
// pose = { s: walk phase -1..1, act: arm action 0..1 }.

const MODEL_DEFS = {
  humanoid(p, { s, act }) {
    const legAng = s * 0.5;                        // ~29 degrees at full stride
    const bob = -12 * (1 - Math.cos(legAng));      // hips drop as the legs spread
    const boxes = [];

    // Legs pivot at the hip; trousers + shoes move together.
    for (const [a0, a1, ang] of [[0, 4, legAng], [-4, 0, -legAng]]) {
      const rot = [{ f: 0, z: 12, ang }];
      const part = a0 >= 0 ? 'legR' : 'legL';
      boxes.push({ a0, a1, f0: -2, f1: 2, z0: 2, z1: 12, color: p.pants, rot, dz: bob, part, layer: 1 });
      boxes.push({ a0, a1, f0: -2, f1: 2, z0: 0, z1: 2, color: p.shoes, rot, dz: bob, part });
    }

    boxes.push({ a0: -4, a1: 4, f0: -2, f1: 2, z0: 12, z1: 24, color: p.shirt, dz: bob, part: 'body' });
    boxes.push({ a0: -4, a1: 4, f0: -4, f1: 4, z0: 24, z1: 32, tex: ModelTex.head(p), color: p.hair, dz: bob, part: 'head' });

    // Arms: shoulder joint at the top of the arm, elbow halfway down.
    // They swing opposite to the leg on the same side; the elbow flexes more on the forward swing.
    const arms = [];
    for (const [a0, a1, side] of [[4, 8, 1], [-8, -4, -1]]) {
      let shoulder, elbow;
      if (p.armsForward) {
        shoulder = Math.PI / 2 - 0.08 + side * s * 0.08 + act * 0.5; // act: swipe when attacking
        elbow = 0.05;
      } else {
        shoulder = -side * s * 0.42;
        elbow = 0.18 + Math.max(0, shoulder) * 0.7;
        if (side === 1 && act > 0) { shoulder += act * 1.9; elbow += act * 0.35; }
      }
      const upper = [{ f: 0, z: 22, ang: shoulder }];
      const lower = [{ f: 0, z: 18, ang: elbow }, { f: 0, z: 22, ang: shoulder }];
      boxes.push({ a0, a1, f0: -2, f1: 2, z0: 20, z1: 24, color: p.sleeve, rot: upper, dz: bob, part: `arm${side}u` });
      boxes.push({ a0, a1, f0: -2, f1: 2, z0: 18, z1: 20, color: p.skin, rot: upper, dz: bob, part: `arm${side}u` });
      boxes.push({ a0, a1, f0: -2, f1: 2, z0: 12, z1: 18, color: p.skin, rot: lower, dz: bob, part: `arm${side}l` });
      arms.push({ a: (a0 + a1) / 2, rot: lower });
    }
    // Where a held item goes: the right hand.
    boxes.hand = { a: arms[0].a, f: 1, z: 12.5, rot: arms[0].rot, dz: bob };
    return boxes;
  },

  // The player, textured from a Minecraft skin (skins.js). Same joints as `humanoid`;
  // overlay layers (hat, jacket, sleeves, trousers) are slightly larger boxes on top.
  skinned(sk, { s, act, armor }) {
    const L = sk.L, aw = sk.slim ? 3 : 4;
    const legAng = s * 0.5;
    const bob = -12 * (1 - Math.cos(legAng));
    const boxes = [];
    // Side faces can be cut to a band of rows (upper arm / forearm share one texture).
    const slice = (rects, o) => {
      const out = {};
      for (const k in rects) {
        const r = rects[k];
        if ((k === 'top' && o.noTop) || (k === 'bottom' && o.noBottom)) continue;
        out[k] = o.rows && k !== 'top' && k !== 'bottom' ? [r[0], r[1] + o.rows[0], r[2], o.rows[1] - o.rows[0]] : r;
      }
      return out;
    };
    const add = (b, rects, o, overlay, grow) => {
      boxes.push(Object.assign({}, b, { skin: { img: sk, rects: slice(rects, o), flip: !!o.flip } }));
      if (!overlay) return;
      boxes.push(Object.assign({}, b, {
        a0: b.a0 - grow, a1: b.a1 + grow, f0: b.f0 - grow, f1: b.f1 + grow, z0: b.z0 - grow, z1: b.z1 + grow,
        skin: { img: sk, rects: slice(overlay, o), flip: !!o.flip }, layer: 1,
      }));
    };
    const legacy = sk.legacy;

    for (const [a0, a1, ang, main, over, flip] of [
      [0, 4, legAng, L.rleg, legacy ? null : L.rlegO, false],
      [-4, 0, -legAng, legacy ? L.rleg : L.lleg, legacy ? null : L.llegO, legacy],
    ]) {
      add({ a0, a1, f0: -2, f1: 2, z0: 0, z1: 12, rot: [{ f: 0, z: 12, ang }], dz: bob, part: a0 >= 0 ? 'legR' : 'legL' }, main, { flip }, over, 0.25);
    }
    add({ a0: -4, a1: 4, f0: -2, f1: 2, z0: 12, z1: 24, dz: bob, part: 'body' }, L.body, {}, legacy ? null : L.bodyO, 0.25);
    add({ a0: -4, a1: 4, f0: -4, f1: 4, z0: 24, z1: 32, dz: bob, part: 'head' }, L.head, {}, sk.useHat ? L.hat : null, 0.5);

    let hand = null;
    for (const [a0, a1, side, main, over, flip] of [
      [4, 4 + aw, 1, L.rarm, legacy ? null : L.rarmO, false],
      [-4 - aw, -4, -1, legacy ? L.rarm : L.larm, legacy ? null : L.larmO, legacy],
    ]) {
      let shoulder = -side * s * 0.42;
      let elbow = 0.18 + Math.max(0, shoulder) * 0.7;
      if (side === 1 && act > 0) { shoulder += act * 1.9; elbow += act * 0.35; }
      const upper = [{ f: 0, z: 22, ang: shoulder }];
      const lower = [{ f: 0, z: 18, ang: elbow }, { f: 0, z: 22, ang: shoulder }];
      add({ a0, a1, f0: -2, f1: 2, z0: 18, z1: 24, rot: upper, dz: bob, part: `arm${side}u` }, main, { rows: [0, 6], noBottom: true, flip }, over, 0.25);
      add({ a0, a1, f0: -2, f1: 2, z0: 12, z1: 18, rot: lower, dz: bob, part: `arm${side}l` }, main, { rows: [6, 12], noTop: true, flip }, over, 0.25);
      if (side === 1) hand = { a: (a0 + a1) / 2, f: 1, z: 12.5, rot: lower, dz: bob };
      if (armor) armorArm(boxes, armor, a0, a1, side, upper, lower, bob);
    }
    if (armor) armorBody(boxes, armor, legAng, bob);
    boxes.hand = hand;
    return boxes;
  },

  // Bee: striped yellow body, dark face, stinger, two wings buzzing (s = wing flap).
  bee(p, { s }) {
    const z = 4, flap = 0.6 + s * 0.6;
    return [
      { a0: -3, a1: 3, f0: -4, f1: 3, z0: z, z1: z + 6, color: p.body },
      { a0: -3.15, a1: 3.15, f0: -2.5, f1: -1.5, z0: z - 0.15, z1: z + 6.15, color: p.stripe },
      { a0: -3.15, a1: 3.15, f0: 0.5, f1: 1.5, z0: z - 0.15, z1: z + 6.15, color: p.stripe },
      { a0: -3, a1: 3, f0: 3, f1: 4.5, z0: z, z1: z + 6, color: p.face },
      { a0: -0.5, a1: 0.5, f0: -5.5, f1: -4, z0: z + 2.5, z1: z + 3.5, color: p.stinger },
      { a0: 0.5, a1: 5, f0: -2, f1: 1.5, z0: z + 6, z1: z + 6 + flap, color: p.wing },
      { a0: -5, a1: -0.5, f0: -2, f1: 1.5, z0: z + 6, z1: z + 6 + flap, color: p.wing },
    ];
  },

  // Torch: a wooden stick with a dark wrapped head (the renderer adds the flame on top).
  // p.tilt leans it about its foot (negative = forward), for torches hanging on a wall.
  torch(p) {
    const rot = p.tilt ? [{ f: 0, z: 0, ang: p.tilt }] : null;
    return [
      { a0: -1, a1: 1, f0: -1, f1: 1, z0: 0, z1: TORCH_LEN - 2, color: '#8a6034', rot },
      { a0: -1.3, a1: 1.3, f0: -1.3, f1: 1.3, z0: TORCH_LEN - 2, z1: TORCH_LEN, color: '#3b2614', rot },
    ];
  },

  quadruped(p, { s }) {
    const legAng = s * 0.45;
    const bob = -6 * (1 - Math.cos(legAng));
    const boxes = [];
    // Diagonal pairs move together (front-left with back-right), like a real trot.
    for (const [a0, a1, f0, ang] of [[-5, -1, 2, legAng], [1, 5, -10, legAng], [1, 5, 2, -legAng], [-5, -1, -10, -legAng]]) {
      boxes.push({ a0, a1, f0, f1: f0 + 4, z0: 0, z1: 6, color: p.legs, rot: [{ f: f0 + 2, z: 6, ang }], dz: bob });
    }
    boxes.push({ a0: -5, a1: 5, f0: -10, f1: 6, z0: 6, z1: 14, color: p.body, dz: bob });
    boxes.push({ a0: -4, a1: 4, f0: 5, f1: 12, z0: 8, z1: 16, tex: ModelTex.pigHead(p), color: p.head, dz: bob });
    boxes.push({ a0: -2, a1: 2, f0: 12, f1: 13, z0: 9, z1: 12, tex: ModelTex.snout(p), color: p.snout, dz: bob });
    return boxes;
  },
};

// ---- worn equipment, drawn over the skin as slightly larger boxes ----
// armor = { head, body, legs, feet, shield }: each a colour (or missing).
// The helmet is a cap, back and side plates and a brow, so the face stays visible.
function armorBody(boxes, armor, legAng, bob) {
  const g = 0.7; // just outside the skin's overlay layer
  // Lower pieces a shade darker, so a full set still reads as helmet / armor / legs / boots.
  const legs = armor.legs && darkenHex(armor.legs, 0.86), feet = armor.feet && darkenHex(armor.feet, 0.72);
  const m = armor.metal || {}; // metal kind per slot (METAL_KINDS), for the shine
  // Pieces that wrap all the way round a part (cap, armor, belt, leg plates, boots) sort with
  // that part, outside its skin (`part`/`layer`, see drawModel3D); plates on one side sort alone.
  if (armor.head) {
    const c = armor.head, z0 = 24 - 0.2, z1 = 32 + g, metal = m.head;
    boxes.push({ a0: -4 - g, a1: 4 + g, f0: -4 - g, f1: 4 + g, z0: 30, z1, color: c, metal, dz: bob, part: 'head', layer: 2 }); // cap
    boxes.push({ a0: -4 - g, a1: 4 + g, f0: -4 - g, f1: -3, z0, z1: 30, color: c, metal, dz: bob });               // back
    boxes.push({ a0: 4, a1: 4 + g, f0: -3, f1: 4 + g, z0: z0 + 1, z1: 30, color: c, metal, dz: bob });              // sides
    boxes.push({ a0: -4 - g, a1: -4, f0: -3, f1: 4 + g, z0: z0 + 1, z1: 30, color: c, metal, dz: bob });
    boxes.push({ a0: -0.6, a1: 0.6, f0: 4, f1: 4 + g, z0: 27, z1: 30, color: c, metal, dz: bob });                 // nose guard
  }
  if (armor.body) {
    boxes.push({ a0: -4 - g, a1: 4 + g, f0: -2 - g, f1: 2 + g, z0: 12.5, z1: 24 + g, color: armor.body, metal: m.body, dz: bob, part: 'body', layer: 2 });
    boxes.push({ a0: -4 - g - 0.05, a1: 4 + g + 0.05, f0: -2 - g - 0.15, f1: 2 + g + 0.15, z0: 12.2, z1: 13.6, color: darkenHex(armor.body, 0.55), dz: bob, part: 'body', layer: 3 }); // belt
  }
  for (const [a0, a1, ang] of [[0, 4, legAng], [-4, 0, -legAng]]) {
    const rot = [{ f: 0, z: 12, ang }], part = a0 >= 0 ? 'legR' : 'legL';
    // Boots before leg plates: the plates hang over the boot tops.
    if (armor.feet) boxes.push({ a0: a0 - g, a1: a1 + g, f0: -2 - g, f1: 2 + g * 1.6, z0: -0.2, z1: 3.5, color: feet, metal: m.feet, rot, dz: bob, part, layer: 2 });
    if (armor.legs) boxes.push({ a0: a0 - g * 0.8, a1: a1 + g * 0.8, f0: -2 - g * 0.8, f1: 2 + g * 0.8, z0: 3.5, z1: 12.3, color: legs, metal: m.legs, rot, dz: bob, part, layer: 3 });
  }
}

function darkenHex(hex, f) {
  return '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('');
}

// Shoulder pads (with body armor) and the shield on the left forearm.
function armorArm(boxes, armor, a0, a1, side, upper, lower, bob) {
  const g = 0.7;
  const m = armor.metal || {};
  if (armor.body) boxes.push({ a0: a0 - g, a1: a1 + g, f0: -2 - g, f1: 2 + g, z0: 20, z1: 24 + g, color: armor.body, metal: m.body, rot: upper, dz: bob, part: `arm${side}u`, layer: 2 });
  if (armor.shield && side === -1) {
    boxes.push({ a0: a0 - 1.6, a1: a0 - 0.4, f0: -4.5, f1: 4.5, z0: 10, z1: 20, color: armor.shield, metal: m.shield, rot: lower, dz: bob });
    boxes.push({ a0: a0 - 2.1, a1: a0 - 1.6, f0: -1.2, f1: 1.2, z0: 13.8, z1: 16.2, color: '#d8b040', metal: 'golden', rot: lower, dz: bob }); // boss
  }
}

// Faces of a box in local (a, f, z): which corner is the texture origin, which
// corners its u (right) and v (down) edges run to, and the outward normal.
// Side faces run u from the front edge toward the back (side textures have the face at u = 0).
const BOX_FACES = [
  { name: 'front', o: [1, 1, 1], u: [0, 1, 1], v: [1, 1, 0], n: [0, 1, 0] },
  { name: 'back', o: [0, 0, 1], u: [1, 0, 1], v: [0, 0, 0], n: [0, -1, 0] },
  { name: 'right', o: [1, 1, 1], u: [1, 0, 1], v: [1, 1, 0], n: [1, 0, 0] },
  { name: 'left', o: [0, 1, 1], u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0] },
  { name: 'top', o: [0, 0, 1], u: [1, 0, 1], v: [0, 1, 1], n: [0, 0, 1] },
  { name: 'bottom', o: [0, 1, 0], u: [1, 1, 0], v: [0, 0, 0], n: [0, 0, -1] },
];

// Viewer direction for this projection (screen position doesn't change along it).
const VIEW_DIR = [MODEL_K, 1, MODEL_Q];
// Light from the north-west and above: tops brightest, east faces darkest.
const LIGHT_DIR = (() => { const l = [-0.4, 0.5, 1], m = Math.hypot(...l); return l.map((v) => v / m); })();
// Halfway between the light and the viewer: faces pointing this way show a specular highlight.
const SPEC_DIR = (() => {
  const vm = Math.hypot(...VIEW_DIR), h = LIGHT_DIR.map((v, i) => v + VIEW_DIR[i] / vm), m = Math.hypot(...h);
  return h.map((v) => v / m);
})();

// Apply a box's joint rotations (all about the across axis) to a local (f, z) point.
function applyJoints(rot, f, z) {
  if (rot) {
    for (const j of rot) {
      const c = Math.cos(j.ang), s = Math.sin(j.ang);
      const df = f - j.f, dz = z - j.z;
      f = j.f + df * c - dz * s;
      z = j.z + df * s + dz * c;
    }
  }
  return [f, z];
}

// Screen position of local point (a, f, z) (after `rot` joints) of a model drawn at (sx, sy).
function modelPoint(sx, sy, T, facing, scale, a, f, z, rot = null) {
  const u = T * MODEL_UNIT * scale;
  const F = [Math.round(Math.cos(facing)), Math.round(Math.sin(facing))], R = [-F[1], F[0]];
  [f, z] = applyJoints(rot, f, z);
  const wx = a * R[0] + f * F[0], wy = a * R[1] + f * F[1];
  return [sx + (wx - MODEL_K * wy) * u, sy + (MODEL_Q * wy - z) * u];
}

// Draw a model with its feet at screen (sx, sy). opts.turn rotates it with the camera (mirrored view).
function drawModel3D(ctx, sx, sy, T, facing, kind, palette, swing = 0, act = 0, scale = 1, held = null, opts = {}) {
  const u = T * MODEL_UNIT * scale;
  if (opts.turn) facing += opts.turn;
  const F = [Math.round(Math.cos(facing)), Math.round(Math.sin(facing))];
  const R = [-F[1], F[0]];
  const K = MODEL_K, Q = MODEL_Q;

  // local (a, f, z) -> world (x, y, z) -> screen
  const toWorld = (a, f, z) => [a * R[0] + f * F[0], a * R[1] + f * F[1], z];
  const toScreen = (w) => [sx + (w[0] - K * w[1]) * u, sy + (Q * w[1] - w[2]) * u];
  const depth = (w) => w[0] * VIEW_DIR[0] + w[1] * VIEW_DIR[1] + w[2] * VIEW_DIR[2];

  const boxes = MODEL_DEFS[kind](palette, { s: swing, act, armor: opts.armor });
  // A held tool, weapon or torch (heldModel) becomes part of the model: gripped in the
  // middle of the fist, leaning forward, and swung by the forearm's joints.
  let flame = null;
  if (held && held.parts && boxes.hand) {
    const h = boxes.hand, gf = h.f - 1, gz = h.z + 0.5;
    const rot = [{ f: gf, z: gz, ang: -held.tilt }, ...(h.rot || [])];
    // Where a handle leaves the forearm in front of and behind the grip: the stretch inside
    // the hand isn't drawn, so it can't show through the fist.
    const sn = Math.sin(held.tilt), cs = Math.cos(held.tilt);
    const out = Math.min(GRIP_ARM.half / sn, GRIP_ARM.up / cs), back = Math.min(GRIP_ARM.half / sn, GRIP_ARM.down / cs);
    for (const p of held.parts) {
      if (p.flame != null) { flame = { f: gf, z: gz + p.flame, a: h.a, rot, dz: h.dz }; continue; }
      const spans = p.grip ? [[p.s0, Math.min(p.s1, -back)], [Math.max(p.s0, out), p.s1]] : [[p.s0, p.s1]];
      for (const [s0, s1] of spans) {
        if (s1 - s0 < 0.05) continue;
        boxes.push({ a0: h.a + p.a0, a1: h.a + p.a1, f0: gf + p.w0, f1: gf + p.w1, z0: gz + s0, z1: gz + s1, color: p.color, metal: p.metal, rot, dz: h.dz });
      }
    }
    held = null;
  }
  const items = boxes.map((b) => {
    const A = [b.a0, b.a1], Fs = [b.f0, b.f1], Z = [b.z0, b.z1];
    const corner = (i) => {
      const [f, z] = applyJoints(b.rot, Fs[i[1]], Z[i[2]]);
      return toWorld(A[i[0]], f, z + (b.dz || 0));
    };
    const angle = b.rot ? b.rot.reduce((t, j) => t + j.ang, 0) : 0;
    const center = corner([0, 0, 0]).map((v, k) => (v + corner([1, 1, 1])[k]) / 2);
    return { b, corner, angle, depth: depth(center) + (b.bias || 0) };
  });

  if (held && boxes.hand) {
    const h = boxes.hand;
    const [f, z] = applyJoints(h.rot, h.f, h.z);
    const w = toWorld(h.a, f, z + h.dz);
    items.push({ held, w, depth: depth(w) + 0.5 });
  }
  if (flame) {
    const [f, z] = applyJoints(flame.rot, flame.f, flame.z);
    const w = toWorld(flame.a, f, z + flame.dz);
    items.push({ flame: true, w, depth: depth(w) + 1 });
  }

  // A limb (or the body, or the head) sorts as one unit with its skin overlay and the armor
  // wrapped round it (boxes sharing a `part`): at the depth of its first box, inner layers
  // first. Sorting each box by its own centre let a swinging leg poke through its armor.
  const partDepth = new Map();
  for (const it of items) {
    const part = it.b && it.b.part;
    if (!part) continue;
    if (!partDepth.has(part)) partDepth.set(part, it.depth);
    it.depth = partDepth.get(part);
    it.layer = it.b.layer || 0;
  }
  items.sort((p, q) => p.depth - q.depth || (p.layer || 0) - (q.layer || 0));

  // Shadow.
  if (!opts.noShadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    const ext = kind === 'quadruped' ? 11 : 8;
    ctx.beginPath();
    ctx.ellipse(sx, sy, ext * u * (Math.abs(F[0]) ? 1.15 : 0.85), ext * u * Q * (Math.abs(F[1]) ? 1.3 : 0.9), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const it of items) {
    if (it.held) {
      const [hx, hy] = toScreen(it.w);
      const s = 10 * u;
      ctx.drawImage(it.held, hx - s / 2, hy - s / 2, s, s);
      continue;
    }
    if (it.flame) {
      const [hx, hy] = toScreen(it.w), fr = torchFlame(), k = u * 1.1;
      ctx.drawImage(fr, hx - fr.width * k / 2, hy + k * 0.6 - fr.height * k, fr.width * k, fr.height * k);
      continue;
    }
    const { b, corner, angle } = it;
    const c = Math.cos(angle), sn = Math.sin(angle);
    for (const face of BOX_FACES) {
      // Rotate the local normal by the joints, then into the world.
      const [na, nf0, nz0] = face.n;
      const nf = nf0 * c - nz0 * sn, nz = nf0 * sn + nz0 * c;
      const nw = toWorld(na, nf, nz);
      const facingViewer = nw[0] * VIEW_DIR[0] + nw[1] * VIEW_DIR[1] + nw[2] * VIEW_DIR[2];
      if (facingViewer <= 1e-3) continue;

      const O = corner(face.o), U = corner(face.u), Vc = corner(face.v);
      const lit = Math.max(0, nw[0] * LIGHT_DIR[0] + nw[1] * LIGHT_DIR[1] + nw[2] * LIGHT_DIR[2]);
      const bright = 0.6 + 0.4 * lit / LIGHT_DIR[2];

      if (b.skin) {
        // Minecraft skin face. Our right/top/bottom faces run the opposite way to the
        // skin layout, so those are mirrored; legacy left limbs reuse the right limb mirrored.
        const sk = b.skin;
        let key = face.name;
        if (sk.flip && (key === 'left' || key === 'right')) key = key === 'left' ? 'right' : 'left';
        const r = sk.rects[key];
        if (!r) continue;
        let mirror = face.name === 'right' || face.name === 'top' || face.name === 'bottom';
        if (sk.flip) mirror = !mirror;
        let [ox, oy] = toScreen(O), [ux, uy] = toScreen(U), [vx, vy] = toScreen(Vc);
        if (mirror) [ox, oy, ux, uy, vx, vy] = [ux, uy, ox, oy, vx + (ux - ox), vy + (uy - oy)];
        const lvl = Math.max(0, Math.min(Skins.SHADE_LEVELS.length - 1, Math.round((1 - bright) / 0.1)));
        ctx.setTransform((ux - ox) / r[2], (uy - oy) / r[2], (vx - ox) / r[3], (vy - oy) / r[3], ox, oy);
        ctx.drawImage(sk.img.shaded[lvl], r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
        continue;
      }
      const ext = (i) => Math.abs(b[['a1', 'f1', 'z1'][i]] - b[['a0', 'f0', 'z0'][i]]);
      const axis = (p, q) => p.findIndex((v, k) => v !== q[k]);
      const tw = ext(axis(face.o, face.u)), th = ext(axis(face.o, face.v));
      let tex = null;
      if (b.tex) tex = b.tex[face.name === 'left' || face.name === 'right' ? 'side' : face.name];
      if (!tex) tex = b.metal ? ModelTex.metal(b.color, tw, th, b.metal) : ModelTex.mat(b.color, tw, th);

      const [ox, oy] = toScreen(O), [ux, uy] = toScreen(U), [vx, vy] = toScreen(Vc);
      ctx.setTransform((ux - ox) / tex.width, (uy - oy) / tex.width, (vx - ox) / tex.height, (vy - oy) / tex.height, ox, oy);
      ctx.drawImage(tex, 0, 0);
      const shade = 1 - bright;
      if (shade > 0.01) {
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fillRect(0, 0, tex.width, tex.height);
      } else if (shade < -0.01) {
        ctx.fillStyle = `rgba(255,255,255,${-shade * 0.5})`;
        ctx.fillRect(0, 0, tex.width, tex.height);
      }
      // Metal flashes as a face turns toward the light (swinging arms and legs glint as you walk).
      if (b.metal) {
        const hv = nw[0] * SPEC_DIR[0] + nw[1] * SPEC_DIR[1] + nw[2] * SPEC_DIR[2];
        const spec = Math.pow(Math.max(0, hv), 8) * (METAL_KINDS[b.metal] || METAL_KINDS.steel).spec * 0.55;
        if (spec > 0.02) {
          ctx.fillStyle = `rgba(255,255,255,${spec})`;
          ctx.fillRect(0, 0, tex.width, tex.height);
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
