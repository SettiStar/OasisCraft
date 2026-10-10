// Player skins: standard Minecraft 64x64 (and legacy 64x32 / HD) skin textures
// mapped onto the box model, plus 8 built-in presets painted procedurally.
//
// Skins can come from a preset, a NovaSkin link (or any direct PNG link), or an
// uploaded PNG. Images from other sites are drawn without reading their pixels
// (browsers allow that), so links work even from a local file.

const Skins = (() => {
  // UV rects [x, y, w, h] for a box with size w x h x d whose texture starts at (ox, oy).
  function box(ox, oy, w, h, d) {
    return {
      top: [ox + d, oy, w, d], bottom: [ox + d + w, oy, w, d],
      right: [ox, oy + d, d, h], front: [ox + d, oy + d, w, h],
      left: [ox + d + w, oy + d, d, h], back: [ox + d + w + d, oy + d, w, h],
    };
  }

  function layout(slim) {
    const aw = slim ? 3 : 4;
    return {
      head: box(0, 0, 8, 8, 8), hat: box(32, 0, 8, 8, 8),
      body: box(16, 16, 8, 12, 4), bodyO: box(16, 32, 8, 12, 4),
      rarm: box(40, 16, aw, 12, 4), rarmO: box(40, 32, aw, 12, 4),
      larm: box(32, 48, aw, 12, 4), larmO: box(48, 48, aw, 12, 4),
      rleg: box(0, 16, 4, 12, 4), rlegO: box(0, 32, 4, 12, 4),
      lleg: box(16, 48, 4, 12, 4), llegO: box(0, 48, 4, 12, 4),
    };
  }

  // ---- presets ------------------------------------------------------------

  const PRESETS = [
    { name: 'Steve', skin: '#c8956c', hair: '#3b2510', hairStyle: 'short', eyes: '#3a4fbf', mouth: '#6b4030', shirt: '#00a8a8', sleeves: 'short', pants: '#3b3b9e', shoes: '#4a4a4a' },
    { name: 'Alex', skin: '#f0c8a0', hair: '#e07a2a', hairStyle: 'long', eyes: '#3c8a3c', mouth: '#c47a6a', shirt: '#5aa04a', sleeves: 'short', pants: '#7a5230', shoes: '#4a3a2a' },
    { name: 'Knight', skin: '#c8956c', hair: '#3b2510', hairStyle: 'short', eyes: '#222222', hat: 'helmet', hatColor: '#a4aab2', shirt: '#9aa0a8', sleeves: 'long', gloves: '#80868e', pants: '#80868e', shoes: '#5a5e64', belt: '#6b4a2a', plates: true },
    { name: 'Ninja', skin: '#d8a878', hair: '#151515', hairStyle: 'short', eyes: '#222222', hat: 'mask', hatColor: '#1c1c20', shirt: '#1e1e22', sleeves: 'long', gloves: '#1e1e22', pants: '#1e1e22', shoes: '#111111', belt: '#b02020' },
    { name: 'Wizard', skin: '#e0b090', hair: '#dddddd', hairStyle: 'short', eyes: '#3050a0', beard: '#e8e8e8', hat: 'wizard', hatColor: '#4a2a8a', shirt: '#4a2a8a', sleeves: 'long', pants: '#3a2070', shoes: '#2a1a40', belt: '#d4a020' },
    { name: 'Miner', skin: '#b07a50', hair: '#2a1a0a', hairStyle: 'short', eyes: '#3a2a1a', mouth: '#5a3020', hat: 'hardhat', hatColor: '#e8c020', shirt: '#8a8a8a', sleeves: 'short', pants: '#2c4a8a', overalls: '#2c4a8a', shoes: '#3a2a1a' },
    { name: 'Ranger', skin: '#d8a070', hair: '#5a3a1a', hairStyle: 'short', eyes: '#2a6a2a', mouth: '#7a4a30', hat: 'hood', hatColor: '#2f5a2a', shirt: '#7a5a3a', sleeves: 'long', pants: '#3a4a2a', shoes: '#4a3420', belt: '#3a2614' },
    { name: 'Royal', skin: '#e8c0a0', hair: '#e8c040', hairStyle: 'long', eyes: '#4060c0', mouth: '#b06060', hat: 'crown', hatColor: '#e0b030', shirt: '#a02030', sleeves: 'long', trim: '#e0b030', pants: '#f0f0f0', shoes: '#5a3a1a', belt: '#e0b030' },
  ];

  function paintPreset(p, seed) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const rand = mulberry32(seed);
    const shade = (hex, f) => Textures.shade(hex, f);
    const px = (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); };
    const fill = (r, col, n = 0.1) => {
      for (let y = 0; y < r[3]; y++) for (let x = 0; x < r[2]; x++) px(r[0] + x, r[1] + y, shade(col, 1 + (rand() - 0.5) * n));
    };
    const rows = (r, y0, y1, col, n) => fill([r[0], r[1] + y0, r[2], y1 - y0], col, n);
    const SIDES = ['front', 'back', 'left', 'right'];
    const L = layout(false);

    // Head: skin, then hair.
    for (const f of [...SIDES, 'top', 'bottom']) fill(L.head[f], p.skin, 0.06);
    const long = p.hairStyle === 'long';
    fill(L.head.top, p.hair);
    rows(L.head.back, 0, long ? 8 : 7, p.hair);
    for (const f of ['left', 'right']) {
      const r = L.head[f];
      rows(r, 0, 2, p.hair);
      // the back half of each side is hair (front edge is u=0 on the left face, u=max on the right face)
      const bx = f === 'right' ? r[0] : r[0] + 4;
      fill([bx, r[1] + 2, 4, long ? 6 : 2], p.hair);
    }
    const F = L.head.front, fx = F[0], fy = F[1];
    rows(F, 0, 2, p.hair);
    px(fx, fy + 2, p.hair); px(fx + 7, fy + 2, p.hair);
    if (long) for (let y = 2; y < 7; y++) { px(fx, fy + y, p.hair); px(fx + 7, fy + y, p.hair); }
    px(fx + 1, fy + 4, '#ffffff'); px(fx + 2, fy + 4, p.eyes); px(fx + 5, fy + 4, p.eyes); px(fx + 6, fy + 4, '#ffffff');
    px(fx + 3, fy + 5, shade(p.skin, 0.82)); px(fx + 4, fy + 5, shade(p.skin, 0.82));
    if (p.beard) {
      for (let y = 5; y < 8; y++) for (let x = 1; x < 7; x++) if (!(y === 5 && (x === 3 || x === 4))) px(fx + x, fy + y, shade(p.beard, 0.95 + rand() * 0.1));
    } else if (p.mouth) {
      for (let x = 2; x < 6; x++) px(fx + x, fy + 6, p.mouth);
    }

    // Body.
    for (const f of [...SIDES, 'top', 'bottom']) fill(L.body[f], p.shirt);
    if (p.plates) for (const f of SIDES) { rows(L.body[f], 4, 5, shade(p.shirt, 0.75), 0.05); rows(L.body[f], 8, 9, shade(p.shirt, 0.75), 0.05); }
    if (p.overalls) {
      const r = L.body.front;
      fill([r[0] + 1, r[1] + 4, 6, 8], p.overalls);
      fill([r[0] + 1, r[1], 1, 4], p.overalls); fill([r[0] + 6, r[1], 1, 4], p.overalls);
      fill([r[0] + 3, r[1] + 6, 2, 2], shade(p.overalls, 0.8), 0.02);
      const b = L.body.back;
      fill([b[0] + 1, b[1] + 4, 6, 8], p.overalls);
      for (const f of ['left', 'right']) rows(L.body[f], 4, 12, p.overalls);
    }
    if (p.beard) { const r = L.body.front; fill([r[0] + 1, r[1], 6, 4], p.beard); fill([r[0] + 2, r[1] + 4, 4, 2], p.beard); }
    if (p.trim) {
      const r = L.body.front;
      fill([r[0] + 3, r[1], 2, 12], p.trim, 0.05);
      for (const f of SIDES) rows(L.body[f], 0, 1, p.trim, 0.05);
    }
    if (p.belt) for (const f of SIDES) rows(L.body[f], 9, 11, p.belt, 0.05);

    // Arms.
    for (const part of [L.rarm, L.larm]) {
      for (const f of SIDES) {
        if (p.sleeves === 'long') {
          rows(part[f], 0, 10, p.shirt);
          rows(part[f], 10, 12, p.gloves || p.skin, 0.06);
          if (p.trim) rows(part[f], 9, 10, p.trim, 0.05);
        } else {
          rows(part[f], 0, 4, p.shirt);
          rows(part[f], 4, 12, p.skin, 0.06);
        }
      }
      fill(part.top, p.shirt);
      fill(part.bottom, p.sleeves === 'long' ? (p.gloves || p.skin) : p.skin, 0.06);
    }

    // Legs.
    for (const part of [L.rleg, L.lleg]) {
      for (const f of SIDES) { rows(part[f], 0, 10, p.pants); rows(part[f], 10, 12, p.shoes); }
      fill(part.top, p.pants);
      fill(part.bottom, p.shoes);
    }

    // Headwear on the hat (overlay) layer; everything else there stays transparent.
    const H = L.hat, hc = p.hatColor;
    const hatAll = (col, faces) => faces.forEach((f) => fill(H[f], col));
    switch (p.hat) {
      case 'helmet': {
        hatAll(hc, ['top', 'back', 'left', 'right']);
        const r = H.front;
        rows(r, 0, 4, hc); rows(r, 5, 8, hc);
        px(r[0], r[1] + 4, hc); px(r[0] + 7, r[1] + 4, hc);
        for (let x = 1; x < 7; x++) px(r[0] + x, r[1] + 4, '#202226');
        break;
      }
      case 'mask': {
        hatAll(hc, ['top', 'back', 'left', 'right']);
        const r = H.front;
        rows(r, 0, 3, hc); rows(r, 5, 8, hc);
        break;
      }
      case 'wizard': {
        fill(H.top, hc);
        for (const f of ['back', 'left', 'right', 'front']) rows(H[f], 0, 2, hc);
        px(H.front[0] + 3, H.front[1], '#f0d040'); px(H.front[0] + 4, H.front[1] + 1, '#f0d040');
        break;
      }
      case 'hardhat': {
        fill(H.top, hc);
        for (const f of ['back', 'left', 'right', 'front']) rows(H[f], 0, 2, hc);
        px(H.front[0] + 3, H.front[1] + 1, '#fff6b0'); px(H.front[0] + 4, H.front[1] + 1, '#fff6b0');
        break;
      }
      case 'hood': {
        hatAll(hc, ['top', 'back', 'left', 'right']);
        const r = H.front;
        rows(r, 0, 2, hc);
        for (let y = 2; y < 8; y++) { px(r[0], r[1] + y, hc); px(r[0] + 7, r[1] + y, hc); }
        break;
      }
      case 'crown': {
        for (const f of ['back', 'left', 'right', 'front']) {
          const r = H[f];
          rows(r, 1, 2, hc, 0.05);
          for (let x = 0; x < r[2]; x += 2) px(r[0] + x, r[1], hc);
        }
        px(H.front[0] + 3, H.front[1] + 1, '#d02040'); px(H.front[0] + 4, H.front[1] + 1, '#2040d0');
        break;
      }
    }
    return c;
  }

  // ---- building a usable skin from an image ---------------------------------

  // Normalise any skin image into a 64x64 canvas (legacy 64x32 skins fill the top
  // half; their left limbs are mirrored from the right ones when drawn).
  function makeSkin(img, name) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h || w % 64 !== 0 || (h !== w && h !== w / 2)) throw new Error(`Not a Minecraft skin (${w}x${h})`);
    if (w > MAX_SKIN_SIZE) throw new Error(`Skin too large (${w}x${h}, max ${MAX_SKIN_SIZE})`);
    const legacy = h === w / 2;
    const scale = w / 64;
    const base = document.createElement('canvas');
    base.width = 64; base.height = 64;
    const bctx = base.getContext('2d');
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(img, 0, 0, w, h, 0, 0, 64, legacy ? 32 : 64);

    // If we're allowed to read pixels (presets, uploads, CORS-friendly hosts), detect
    // slim (Alex) arms and old skins whose hat layer is filled in solid.
    let slim = false, useHat = true;
    try {
      const d = bctx.getImageData(0, 0, 64, 64).data;
      const a = (x, y) => d[(y * 64 + x) * 4 + 3];
      if (!legacy) slim = a(50, 16) === 0 && a(51, 16) === 0 && a(54, 20) === 0 && a(55, 31) === 0;
      let transparent = 0;
      for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) if (a(x, y) < 128) transparent++;
      useHat = transparent > 0;
    } catch (e) { /* cross-origin image: draw it, just can't inspect it */ }

    // Pre-darkened copies so faces can be shaded without darkening transparent overlay pixels.
    const shaded = SHADE_LEVELS.map((lvl) => {
      if (lvl >= 1) return base;
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const cx = c.getContext('2d');
      cx.drawImage(base, 0, 0);
      cx.globalCompositeOperation = 'source-atop';
      cx.fillStyle = `rgba(0,0,0,${1 - lvl})`;
      cx.fillRect(0, 0, 64, 64);
      return c;
    });
    return { name, legacy, slim, useHat, base, shaded, L: layout(slim) };
  }

  const SHADE_LEVELS = [1, 0.9, 0.8, 0.7, 0.6];
  const MAX_SKIN_SIZE = 1024;          // widest HD skin accepted
  const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

  // Skins are only ever loaded as images (never fetched as text or run), and only
  // from http(s) links or uploaded PNG data, so a link can't smuggle in code.
  const isWebUrl = (u) => u.protocol === 'https:' || u.protocol === 'http:';
  // Base64 PNG data that really starts with the PNG signature (iVBORw0KGgo = \x89PNG\r\n\x1a\n),
  // not just something renamed to .png.
  const isPngData = (s) => typeof s === 'string' && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(s);
  // A hostname that is `domain` or one of its subdomains (not just anything ending in it).
  const onDomain = (host, domain) => host === domain || host.endsWith('.' + domain);

  function loadImage(src, cors) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('load failed'));
      img.src = src;
    });
  }

  // Image URLs to try for a link the player pasted.
  //   minecraft.novaskin.me/post/<id>/<name>  ->  minecraft.novaskin.me/post/<id>.png
  //   novask.in/<id>                           ->  (same; novask.in redirects there)
  //   anything else                            ->  used as-is (direct PNG link)
  function candidates(link) {
    let u;
    try { u = new URL(String(link).trim()); } catch (e) { return []; }
    if (!isWebUrl(u)) return [];
    const host = u.hostname.toLowerCase();
    if (onDomain(host, 'novask.in')) {
      const id = u.pathname.replace(/^\/+/, '').replace(/\.png$/i, '').split('/')[0];
      if (/^[A-Za-z0-9]+$/.test(id)) return [`https://minecraft.novaskin.me/post/${id}.png`, `https://novask.in/${id}.png`];
    }
    if (onDomain(host, 'novaskin.me')) {
      const m = u.pathname.match(/\/(post|skin)\/([A-Za-z0-9]+)/);
      if (m) return [`https://minecraft.novaskin.me/post/${m[2]}.png`, `https://minecraft.novaskin.me/skin/${m[2]}.png`, `https://novask.in/${m[2]}.png`];
    }
    return [u.href];
  }

  async function fromLink(link) {
    let lastErr = null;
    const list = candidates(link);
    if (!list.length) throw new Error('Only http(s) links are allowed');
    for (const src of list) {
      for (const cors of [true, false]) {
        try { return makeSkin(await loadImage(src, cors), 'Custom'); } catch (e) { lastErr = e; }
      }
    }
    throw lastErr || new Error('Could not load skin');
  }

  async function fromDataUrl(dataUrl) {
    if (!isPngData(dataUrl)) throw new Error('Not a PNG image');
    if (dataUrl.length > MAX_UPLOAD_BYTES * 1.4) throw new Error('File too large');
    return makeSkin(await loadImage(dataUrl, false), 'Uploaded');
  }

  // ---- current skin ---------------------------------------------------------

  let presets = null;
  let current = null;

  function init() {
    presets = PRESETS.map((p, i) => makeSkin(paintPreset(p, 1000 + i), p.name));
    current = presets[0];
  }

  // Apply a saved choice: { kind: 'preset', index } | { kind: 'link', url } | { kind: 'data', data }.
  async function apply(choice) {
    if (!choice || choice.kind === 'preset') { current = presets[(choice && choice.index) || 0] || presets[0]; return current; }
    current = choice.kind === 'link' ? await fromLink(choice.url) : await fromDataUrl(choice.data);
    return current;
  }

  return {
    init, apply, fromLink, fromDataUrl, SHADE_LEVELS, MAX_UPLOAD_BYTES,
    get presets() { return presets; },
    get presetInfo() { return PRESETS; },
    get current() { return current; },
    set current(s) { current = s; },
  };
})();
