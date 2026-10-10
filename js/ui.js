// DOM-based HUD: hotbar, health/air, layer panel, inventory + crafting screens.
//
// The UI never parses HTML from strings (no innerHTML): everything is built with
// h() below, where strings only ever become text. The page's CSP enforces this
// with Trusted Types, so any string-to-HTML/script sink throws instead of running.

// h('span', { class: 'x', src, title, data: {...} }, child, 'text', ...) -> element.
// Props are set as DOM properties (never parsed); string children become text nodes.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'data') Object.assign(el.dataset, v);
    else el[k] = v;
  }
  el.append(...kids.flat().filter((c) => c != null && c !== false));
  return el;
}

// The insides of an item slot: icon, stack count, durability bar.
function slotParts() {
  return [h('img', { draggable: false }), h('span', { class: 'count' }), h('div', { class: 'dur' }, h('div'))];
}

class UI {
  constructor(game) {
    this.game = game;
    this.$ = (id) => document.getElementById(id);
    this.cursor = null;          // stack held by the mouse (inventory screen or backpack windows)
    this.invVersion = -1;
    this.bags = [];              // open backpack windows
    this.chestInv = null;        // open chest (shown in the inventory screen)

    this.hotbarEls = [];
    this.invEls = [];
    this.buildSlots(this.hotbarEls, this.$('hotbar'), 0, 9, true); // clickable only while a backpack is open (CSS)
    this.buildSlots(this.invEls, this.$('inv-hotbar'), 0, 9, true);
    this.buildSlots(this.invEls, this.$('inv-grid'), 9, 36, true);
    this.buildEquipment();

    this.$('respawn').addEventListener('click', () => game.respawn());
    document.addEventListener('mousemove', (e) => {
      const c = this.$('cursor-item');
      c.style.left = e.clientX + 'px';
      c.style.top = e.clientY + 'px';
      this.updateTooltip(e);
    });
    this.$('inventory').addEventListener('contextmenu', (e) => e.preventDefault());
    this.$('seed').textContent = `Seed: ${game.seedText}`;
    this.$('menu-seed').textContent = `World seed: ${game.seedText}`;
    this.$('help').classList.toggle('hidden', !Settings.get('help'));
    // Controls and options for features switched off in config.js aren't shown at all.
    if (!OASIS_CONFIG.devTools) document.querySelectorAll('.dev-only').forEach((el) => el.remove());
    if (!OASIS_CONFIG.creative) document.querySelectorAll('.creative-only').forEach((el) => el.remove());
    this.initMenu();
  }

  // ---- item tooltip (inventory, chests, backpacks, crafting list) ----
  // Anything with data-item="<id>" shows the item's name; slots also carry their
  // stack (el._stack) for details like durability or how full a backpack is.
  updateTooltip(e) {
    const tip = this.$('tooltip');
    const el = e.target && e.target.closest ? e.target.closest('[data-item]') : null;
    const id = el ? Number(el.dataset.item) : NaN;
    const def = Number.isInteger(id) ? itemDef(id) : null;
    if (!def) { tip.classList.add('hidden'); this._tipEl = null; return; }
    if (this._tipEl !== el || this._tipVersion !== Inventory.globalVersion) {
      this._tipEl = el; this._tipVersion = Inventory.globalVersion;
      const stack = el._stack;
      const lines = [];
      if (def.tool) {
        const d = stack && stack.dur != null ? stack.dur : def.tool.durability;
        lines.push(`Durability ${d} / ${def.tool.durability}`);
        if (def.tool.fellsTrees) lines.push('Fells a whole tree');
      }
      if (def.bag) {
        const n = stack && stack.bag ? stack.bag.filter(Boolean).length : 0;
        lines.push(`${n} / ${stack && stack.bag ? stack.bag.length : def.bag} slots used · right-click to open`);
      }
      if (def.armor != null) lines.push(`Arm: ${def.armor} · ${EQUIP_NAMES[def.equip]}`);
      if (def.defense) lines.push(`Def: ${def.defense} (blocks ${def.defense}% of hits)`);
      if (def.equip && def.armor == null && !def.defense) lines.push(EQUIP_NAMES[def.equip]);
      if (def.food) lines.push(`Food +${def.food}`);
      if (el.dataset.need) lines.push(`Needs ${el.dataset.need}`);
      if (stack && stack.count > 1) lines.push(`${stack.count} in stack`);
      tip.textContent = '';
      const name = document.createElement('div');
      name.className = 'tip-name';
      name.textContent = def.name;
      tip.appendChild(name);
      for (const l of lines) {
        const d = document.createElement('div');
        d.className = 'tip-line';
        d.textContent = l;
        tip.appendChild(d);
      }
      tip.classList.remove('hidden');
    }
    // Next to the cursor, kept on screen. (Tooltip is counter-zoomed like the HUD.)
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;
    const w = tip.offsetWidth * z, h = tip.offsetHeight * z;
    let x = e.clientX + 16, y = e.clientY + 18;
    if (x + w > window.innerWidth - 4) x = e.clientX - w - 12;
    if (y + h > window.innerHeight - 4) y = e.clientY - h - 12;
    tip.style.left = (x / z) + 'px';
    tip.style.top = (y / z) + 'px';
  }

  get debug() { return Settings.get('debug'); }
  get help() { return Settings.get('help'); }

  // ---- pause menu / settings / skin editor ----------------------------------

  initMenu() {
    document.querySelectorAll('#menu [data-act]').forEach((el) => {
      el.addEventListener('click', () => this.menuAction(el.dataset.act));
    });
    // Each control with data-set="key" edits that setting.
    const controls = document.querySelectorAll('#menu [data-set]');
    const sync = () => controls.forEach((el) => {
      const v = Settings.get(el.dataset.set);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    controls.forEach((el) => el.addEventListener('change', () => {
      Settings.set(el.dataset.set, el.type === 'checkbox' ? el.checked : el.value);
    }));
    Settings.onChange((k, v) => {
      if (k === 'help') this.$('help').classList.toggle('hidden', !v);
      if (k === 'creative' || k === 'bagLayout') this.applyDockSettings();
      sync();
    });
    sync();
    this.$('creative-btn').addEventListener('mousedown', (e) => { e.stopPropagation(); this.toggleCreative(); });
    this.applyDockSettings();
    this.$('menu-controls-text').replaceChildren(...[...this.$('help').childNodes].map((n) => n.cloneNode(true)));
    this.$('skin-file').addEventListener('change', (e) => this.uploadSkin(e.target.files[0]));
    this.$('skin-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.menuAction('skin-load-url'); });
  }

  openMenu() {
    if (this.game.inventoryOpen) this.game.toggleInventory();
    this.game.menuOpen = true;
    this.$('menu').classList.remove('hidden');
    this.showMenuPage('menu-main');
  }

  closeMenu() {
    this.game.menuOpen = false;
    this.$('menu').classList.add('hidden');
    this.stopSkinPreview();
  }

  showMenuPage(id) {
    for (const el of document.querySelectorAll('#menu .menu-page')) el.classList.toggle('hidden', el.id !== id);
    this.menuPage = id;
    if (id === 'menu-skin') this.openSkinEditor(); else this.stopSkinPreview();
  }

  // Esc: step back one page, or close from the main page.
  menuBack() {
    const parent = { 'menu-settings': 'menu-main', 'menu-controls': 'menu-main', 'menu-worlds': 'menu-main', 'menu-skin': 'menu-settings' }[this.menuPage];
    if (parent) this.showMenuPage(parent); else this.closeMenu();
  }

  menuAction(act) {
    switch (act) {
      case 'resume': this.closeMenu(); break;
      case 'settings': this.showMenuPage('menu-settings'); break;
      case 'controls': this.showMenuPage('menu-controls'); break;
      case 'skin': this.showMenuPage('menu-skin'); break;
      case 'back': this.menuBack(); break;
      case 'skin-random': {
        const n = Skins.presets.length, cur = Settings.get('skin');
        let i = Math.floor(Math.random() * n);
        if (cur.kind === 'preset' && i === cur.index) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
        this.choosePreset(i);
        break;
      }
      case 'skin-load-url': this.loadSkinLink(this.$('skin-url').value); break;
      case 'worlds': this.showMenuPage('menu-worlds'); this.renderWorlds(); break;
      case 'save-now': this.game.save(true).then(() => this.renderWorlds()); break;
      case 'new-world': {
        const seed = cleanSeed(this.$('new-seed').value) || String(Math.floor(Math.random() * 1e9));
        this.switchWorld(seed);
        break;
      }
    }
  }

  // ---- worlds page ----

  switchWorld(seed) {
    const go = () => { location.search = '?seed=' + encodeURIComponent(seed); };
    this.game.save().then(go, go);
  }

  async renderWorlds() {
    const list = this.$('world-list'), status = this.$('world-status');
    list.textContent = '';
    if (!this.game.saveEnabled) { status.textContent = "This browser isn't allowing the game to save."; return; }
    let worlds = [];
    try { worlds = await SaveStore.listWorlds(); } catch (e) { status.textContent = "Couldn't read saved worlds."; return; }
    if (!worlds.some((w) => w.seed === this.game.seedText)) worlds.unshift({ seed: this.game.seedText, meta: { lastPlayed: Date.now(), bytes: 0 }, unsaved: true });
    let total = 0;
    // Stored records are untrusted (anything on this origin can write them): use numbers only.
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    for (const w of worlds) {
      if (!w.meta || typeof w.meta !== 'object') w.meta = {};
      w.meta = { bytes: n(w.meta.bytes), lastPlayed: n(w.meta.lastPlayed) };
      total += w.meta.bytes;
      const row = document.createElement('div');
      row.className = 'world-row' + (w.seed === this.game.seedText ? ' current' : '');
      const info = document.createElement('div');
      info.className = 'world-info';
      const name = document.createElement('b');
      name.textContent = `Seed ${w.seed}`; // plain text only
      const sub = document.createElement('small');
      const when = w.meta.lastPlayed ? new Date(w.meta.lastPlayed).toLocaleString() : 'never';
      sub.textContent = `${w.seed === this.game.seedText ? 'Playing now · ' : ''}${w.unsaved ? 'not saved yet' : 'last played ' + when} · ${UI.formatBytes(w.meta.bytes || 0)}`;
      info.append(name, sub);
      row.appendChild(info);
      if (w.seed !== this.game.seedText) {
        const play = document.createElement('button');
        play.textContent = 'Play';
        play.addEventListener('click', () => this.switchWorld(w.seed));
        row.appendChild(play);
      }
      if (!w.unsaved) {
        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.className = 'danger';
        del.addEventListener('click', () => {
          if (del.dataset.armed !== '1') { // click twice to confirm
            del.dataset.armed = '1'; del.textContent = 'Really delete?';
            setTimeout(() => { del.dataset.armed = ''; del.textContent = 'Delete'; }, 3000);
            return;
          }
          const current = w.seed === this.game.seedText;
          if (current) this.game.saveEnabled = false; // don't re-save the world we're deleting
          SaveStore.deleteWorld(w.seed).then(() => {
            if (current) location.search = '?seed=' + encodeURIComponent(String(Math.floor(Math.random() * 1e9)));
            else this.renderWorlds();
          });
        });
        row.appendChild(del);
      }
      list.appendChild(row);
    }
    status.textContent = `${worlds.length} world${worlds.length === 1 ? '' : 's'} · ${UI.formatBytes(total)} used in this browser.`;
  }

  static formatBytes(n) {
    return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
  }

  skinStatus(text, bad) {
    const el = this.$('skin-status');
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
  }

  openSkinEditor() {
    const grid = this.$('skin-presets');
    if (!grid.childElementCount) {
      Skins.presets.forEach((sk, i) => {
        const b = document.createElement('button');
        b.className = 'preset';
        b.title = sk.name;
        const c = document.createElement('canvas');
        c.width = 64; c.height = 84;
        const cx = c.getContext('2d');
        cx.imageSmoothingEnabled = false;
        drawModel3D(cx, 32, 76, 58, Math.PI / 2, 'skinned', sk, 0, 0, 1, null);
        b.appendChild(c);
        const label = document.createElement('span');
        label.textContent = sk.name;
        b.appendChild(label);
        b.addEventListener('click', () => this.choosePreset(i));
        grid.appendChild(b);
      });
    }
    this.markPreset();
    this.skinStatus('');
    const cur = Settings.get('skin');
    if (cur.kind === 'link') this.$('skin-url').value = cur.url;
    this.startSkinPreview();
  }

  markPreset() {
    const cur = Settings.get('skin');
    [...this.$('skin-presets').children].forEach((b, i) => b.classList.toggle('selected', cur.kind === 'preset' && cur.index === i));
  }

  choosePreset(i) {
    Skins.current = Skins.presets[i];
    Settings.set('skin', { kind: 'preset', index: i });
    this.markPreset();
    this.skinStatus(`Using preset: ${Skins.presets[i].name}`);
  }

  loadSkinLink(url) {
    url = (url || '').trim();
    if (!url) { this.skinStatus('Paste a NovaSkin link or a link to a skin PNG first.', true); return; }
    this.skinStatus('Loading skin…');
    Skins.fromLink(url).then((sk) => {
      Skins.current = sk;
      Settings.set('skin', { kind: 'link', url });
      this.markPreset();
      this.skinStatus(`Loaded skin from link${sk.slim ? ' (slim arms)' : ''}.`);
    }).catch(() => {
      this.skinStatus("Couldn't load a skin from that link. On NovaSkin, open the skin's page and copy its address (…novaskin.me/post/…), or download the PNG and use Upload.", true);
    });
  }

  uploadSkin(file) {
    if (!file) return;
    if (file.type !== 'image/png') { this.skinStatus('Skins must be PNG images.', true); return; }
    if (file.size > Skins.MAX_UPLOAD_BYTES) { this.skinStatus('That file is too large for a skin.', true); return; }
    const reader = new FileReader();
    reader.onload = () => {
      Skins.fromDataUrl(reader.result).then((sk) => {
        Skins.current = sk;
        Settings.set('skin', { kind: 'data', data: reader.result });
        this.markPreset();
        this.skinStatus(`Loaded ${file.name}${sk.slim ? ' (slim arms)' : ''}.`);
      }).catch((e) => this.skinStatus(`That file isn't a Minecraft skin (${e.message}).`, true));
    };
    reader.readAsDataURL(file);
  }

  // Turntable preview: walks in place and turns to face each direction.
  startSkinPreview() {
    const c = this.$('skin-preview'), cx = c.getContext('2d');
    const facings = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];
    const draw = (t) => {
      if (this.menuPage !== 'menu-skin') return;
      const s = t / 1000;
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.clearRect(0, 0, c.width, c.height);
      cx.imageSmoothingEnabled = false;
      drawModel3D(cx, c.width / 2, c.height - 30, 190, facings[Math.floor(s / 1.6) % 4], 'skinned', Skins.current, Math.sin(s * 6), 0, 1, null);
      this.previewRaf = requestAnimationFrame(draw);
    };
    cancelAnimationFrame(this.previewRaf);
    this.previewRaf = requestAnimationFrame(draw);
  }

  stopSkinPreview() { cancelAnimationFrame(this.previewRaf); }

  // `getInv` picks the container the slots belong to (the player's inventory by default).
  buildSlots(els, parent, from, to, interactive, getInv = () => this.game.player.inventory) {
    for (let i = from; i < to; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.append(...slotParts());
      if (interactive) {
        el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.clickSlot(getInv(), i, e.button, e.shiftKey); });
        el.addEventListener('contextmenu', (e) => e.preventDefault());
      }
      parent.appendChild(el);
      els[i] = el;
    }
  }

  fillSlot(el, stack) {
    const img = el.querySelector('img'), count = el.querySelector('.count'), dur = el.querySelector('.dur');
    el._stack = stack; // for the hover tooltip
    if (!stack) {
      img.style.display = 'none';
      count.textContent = '';
      dur.style.display = 'none';
      delete el.dataset.item;
      return;
    }
    img.src = Textures.iconUrl(stack.id);
    img.style.display = '';
    count.textContent = stack.count > 1 ? stack.count : '';
    el.dataset.item = stack.id;
    const tool = itemDef(stack.id).tool;
    if (tool && stack.dur < tool.durability) {
      dur.style.display = '';
      const f = stack.dur / tool.durability;
      dur.firstChild.style.width = (f * 100) + '%';
      dur.firstChild.style.background = `hsl(${f * 120},80%,45%)`;
    } else {
      dur.style.display = 'none';
    }
  }

  update() {
    const g = this.game, p = g.player, inv = p.inventory;

    if (Inventory.globalVersion !== this.invVersion) {
      this.invVersion = Inventory.globalVersion;
      this.checkBags();
      this.redraw();
    }
    this.hotbarEls.forEach((el, i) => el.classList.toggle('selected', i === p.selected));

    const held = p.held;
    this.$('held-name').textContent = held ? itemName(held.id) : '';

    // Hearts (each = 2 HP) and air bubbles.
    const hearts = [];
    for (let i = 0; i < p.maxHealth / 2; i++) {
      const v = p.health - i * 2;
      hearts.push(v >= 2 ? 'full' : v >= 1 ? 'half' : 'empty');
    }
    const heartKey = hearts.join();
    if (heartKey !== this._hearts) {
      this.$('hearts').replaceChildren(...hearts.map((k) => h('span', { class: 'heart ' + k }, '♥')));
      this._hearts = heartKey;
    }
    this.$('hearts').classList.toggle('poisoned', p.poisonTime > 0);
    const air = Math.ceil(p.air), bubbles = air < p.maxAir ? air : 0;
    if (bubbles !== this._air) {
      this.$('air').replaceChildren(...Array.from({ length: bubbles }, () => h('span', { class: 'bubble' }, 'o')));
      this._air = bubbles;
    }

    // Hunger: 10 drumsticks (each = 2 food), emptying from the left like Minecraft,
    // and a gold saturation bar underneath.
    const food = Math.ceil(p.food);
    if (food !== this._food) {
      const icons = [];
      for (let i = MAX_FOOD / 2 - 1; i >= 0; i--) {
        const v = food - i * 2;
        icons.push(h('img', { src: v >= 2 ? Textures.hunger.full : v >= 1 ? Textures.hunger.half : Textures.hunger.empty, alt: '' }));
      }
      this.$('food').replaceChildren(...icons);
      this._food = food;
    }
    this.$('saturation').firstChild.style.width = (p.saturation / MAX_FOOD * 100) + '%';
    this.$('food').classList.toggle('starving', p.food <= 6);

    this.renderLayerPanel();
    this.renderInfo();
    this.renderClock();
    this.renderConditions();
  }

  // Top-centre readout: day, in-game time and the current weather.
  renderClock() {
    const g = this.game, c = g.clock();
    const label = g.weatherLabel();
    const icon = { Clear: c.night ? '☾' : '☀', Cloudy: '☁', Raining: '☂', Snowing: '❄' }[label];
    const time = `${String(c.h).padStart(2, '0')}:${String(c.m).padStart(2, '0')}`;
    const key = `${c.day}|${time}|${icon}|${label}`;
    if (key !== this._clock) {
      this.$('clock').replaceChildren(h('span', { class: 'day' }, `Day ${c.day}`), h('span', { class: 'time' }, time), h('span', { class: 'wx' }, `${icon} ${label}`));
      this._clock = key;
    }
  }

  renderLayerPanel() {
    const g = this.game, p = g.player, V = g.viewZ;
    const top = V + 4, bottom = V - 6;
    const cutAbove = V + g.visibleAbove();
    const off = g.viewOffset;
    const key = `${V}|${cutAbove}|${p.z}|${off}|${g.cutMode}|${g.mirrored}|${g.rotation}`;
    if (key === this._layers) return;
    this._layers = key;
    const rows = [];
    for (let z = top; z >= bottom; z--) {
      if (z < 0 || z >= WORLD_H) continue;
      const cls = [];
      if (z > cutAbove) cls.push('cut');
      if (z === V) cls.push('view');
      if (z === p.z) cls.push('player');
      if (z === SEA_LEVEL) cls.push('sea');
      rows.push(h('div', { class: `layer ${cls.join(' ')}` }, String(z),
        z === p.z && [' ', h('b', {}, 'you')], z === V && [' ', h('b', {}, 'view')], z === SEA_LEVEL && ' ~sea'));
    }
    rows.push(h('div', { class: 'layer-info' }, `View ${off === 0 ? 'on player' : (off > 0 ? '+' : '') + off}`, h('br'), `Cut-off: ${g.cutMode}`,
      g.mirrored && [h('br'), 'Mirrored (M)'], h('br'), `Rotation: ${g.rotation * 90}° (R)`));
    this.$('layer-panel').replaceChildren(...rows);
  }

  renderInfo() {
    const g = this.game, p = g.player;
    let txt = `X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)}  Layer ${p.z}`;
    if (this.debug) {
      const col = g.world.gen.column(p.tx, p.ty);
      const phase = (g.time / DAY_LENGTH) % 1;
      const hh = Math.floor((phase * 24 + 6) % 24), mm = Math.floor((phase * 24 * 60) % 60);
      const r = g.renderer;
      txt += `\nFPS ${g.fps.toFixed(0)}  chunks ${g.world.chunks.size}  mobs ${g.mobs.length}  items ${g.drops.length}` +
        `\nZoom ${Math.round(r.zoom * 100)}%  view ${r.viewW.toFixed(1)} x ${r.viewH.toFixed(1)} tiles  weather roll in ${Math.ceil(g.weatherClock)}s` +
        `\nBiome ${col.biome}  terrain h ${col.h}  sea ${SEA_LEVEL}` +
        `\nFood ${p.food}  saturation ${p.saturation.toFixed(1)}  exhaustion ${p.exhaustion.toFixed(2)}` +
        `\nTime ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}  daylight ${g.daylight.toFixed(2)}  light here ${g.lightAt(p.tx, p.ty, p.z).toFixed(2)}`;
      const h = g.hover;
      if (h && h.kind === 'tile') txt += `\nTarget ${itemName(g.world.getBlock(h.x, h.y, h.z))} @ ${h.x},${h.y},${h.z} (${h.face})`;
      else if (h && h.kind === 'entity') txt += `\nTarget ${h.entity.def ? h.entity.def.name : 'entity'}`;
    }
    if (txt !== this._info) { this.$('debug').textContent = txt; this._info = txt; }
  }

  toggleDebug() { Settings.set('debug', !Settings.get('debug')); }
  toggleHelp() { Settings.set('help', !Settings.get('help')); }

  message(text) {
    const el = this.$('message');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  flashDamage() {
    const el = this.$('damage-flash');
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  // ---- inventory screen -------------------------------------------------

  openInventory() {
    this.$('inventory').classList.remove('hidden');
    this.redraw();
  }

  closeInventory() {
    this.$('inventory').classList.add('hidden');
    this.$('tooltip').classList.add('hidden');
    this.closeChest();
    if (this.cursor && !this.bags.length) this.returnCursor();
  }

  // Put whatever the mouse is holding back in the inventory (or drop it if full).
  returnCursor() {
    if (!this.cursor) return;
    const g = this.game, c = this.cursor;
    this.cursor = null;
    if (g.player.inventory.addStack(c)) g.spawnDrop(g.player.x, g.player.y, g.player.z, c, 1.5);
    this.renderCursor();
  }

  // Tibia-style: drop the held item on the ground in front of the player.
  throwCursor() {
    const g = this.game, p = g.player, c = this.cursor;
    if (!c) return;
    this.cursor = null;
    const d = g.spawnDrop(p.x + Math.cos(p.facing) * 0.6, p.y + Math.sin(p.facing) * 0.6, p.z, c, 1.2);
    d.kbx = Math.cos(p.facing) * 4; d.kby = Math.sin(p.facing) * 4;
    this.renderCursor();
    Inventory.globalVersion++;
  }

  // Can `stack` go into `inv`? (A backpack can't go inside itself or its own contents.)
  fits(stack, inv) {
    if (stack && stack.bag && (stack.bag === inv.slots || bagContains(stack, inv.slots))) {
      this.message("A backpack can't go inside itself.");
      return false;
    }
    return true;
  }

  // Where shift-click sends a stack from `inv`: player <-> open chest / backpack.
  quickMoveTarget(inv) {
    const pinv = this.game.player.inventory;
    if (inv !== pinv) return pinv;
    if (this.chestInv) return this.chestInv;
    const bag = this.bags.find((b) => b.inv.slots.includes(null));
    return bag ? bag.inv : null;
  }

  // Click on slot i of any container (player inventory, chest or backpack).
  //  left: pick up / put down / merge / swap   right: split, place one, or OPEN a backpack
  //  shift+click: quick-move to the other side
  clickSlot(inv, i, button, shift) {
    const slots = inv.slots;
    const s = slots[i], cur = this.cursor;
    const eq = this.game.player.equipment;
    // Equipment slots only take their own kind of item.
    if (inv === eq && cur && !shift && !eq.accepts(i, cur)) {
      this.message(`That doesn't go in the ${EQUIP_NAMES[EQUIP_SLOTS[i]].toLowerCase()} slot.`);
      return;
    }
    // Shift-click armor (shield, ring...) in the inventory to put it on, if that slot is free.
    if (shift && s && inv === this.game.player.inventory && !this.chestInv && itemDef(s.id).equip && eq.canAdd(s.id)) {
      slots[i] = null;
      eq.addStack(s);
      inv.changed();
      return;
    }
    if (shift && s) {
      let target = this.quickMoveTarget(inv), range = null;
      if (!target) { target = inv; range = i < 9 ? [9, 36] : [0, 9]; } // player only: hotbar <-> main
      if (!this.fits(s, target)) return;
      const [a, b] = range || [0, target.slots.length];
      const max = inv.maxStack(s.id);
      if (!s.bag) {
        for (let j = a; j < b && s.count; j++) {
          const o = target.slots[j];
          if (o && o !== s && o.id === s.id && o.count < max) { const n = Math.min(s.count, max - o.count); o.count += n; s.count -= n; }
        }
      }
      for (let j = a; j < b && s.count; j++) {
        if (!target.slots[j]) { target.slots[j] = s.bag ? s : Object.assign({}, s); s.count = s.bag ? s.count : 0; if (s.bag) { slots[i] = null; break; } }
      }
      if (!s.bag) slots[i] = s.count ? s : null;
      target.changed();
    } else if (button === 0) {
      if (cur && !this.fits(cur, inv)) return;
      if (!cur) { this.cursor = s; slots[i] = null; }
      else if (!s) { slots[i] = cur; this.cursor = null; }
      else if (s.id === cur.id && inv.maxStack(s.id) > 1) {
        const n = Math.min(cur.count, inv.maxStack(s.id) - s.count);
        s.count += n; cur.count -= n;
        if (!cur.count) this.cursor = null;
      } else { slots[i] = cur; this.cursor = s; }
    } else if (button === 2) {
      if (!cur && s && s.bag) { this.openBag(s); return; }
      if (!cur && s) {
        const half = Math.ceil(s.count / 2);
        this.cursor = { id: s.id, count: half, dur: s.dur };
        s.count -= half;
        if (!s.count) slots[i] = null;
      } else if (cur && !cur.bag && (!s || (s.id === cur.id && s.count < inv.maxStack(s.id)))) {
        if (!s) slots[i] = { id: cur.id, count: 1, dur: cur.dur };
        else s.count++;
        cur.count--;
        if (!cur.count) this.cursor = null;
      }
    }
    inv.changed();
    this.renderCursor();
  }

  // Redraw every visible container (called when any of them changes).
  redraw() {
    const g = this.game, inv = g.player.inventory;
    for (let i = 0; i < 9; i++) this.fillSlot(this.hotbarEls[i], inv.slots[i]);
    if (g.inventoryOpen) {
      for (let i = 0; i < 36; i++) this.fillSlot(this.invEls[i], inv.slots[i]);
      if (this.chestInv) this.chestEls.forEach((el, i) => this.fillSlot(el, this.chestInv.slots[i]));
      else this.renderRecipes();
    }
    for (const b of this.bags) b.slotEls.forEach((el, i) => this.fillSlot(el, b.inv.slots[i]));
    this.renderEquipment();
    // While any container is open, the hotbar can be clicked too (to move things in and out).
    this.$('hotbar').classList.toggle('interactive', this.dockOpen);
  }

  // ---- Tibia equipment panel (always on screen, top of the right-hand dock) ----
  // 3 columns like Tibia:  amulet helmet backpack / weapon armor shield /
  // ring legs ammo / [Arm] boots [Cap]. Empty slots show faint silhouettes.
  buildEquipment() {
    const grid = this.$('equip-grid');
    this.equipEls = [];
    const stat = (label, title) => {
      const box = document.createElement('div');
      box.className = 'equip-stat';
      box.title = title;
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('b');
      box.append(l, v);
      grid.appendChild(box);
      return v;
    };
    EQUIP_SLOTS.forEach((slot, i) => {
      if (slot === 'feet') this.armEl = stat('Arm:', 'Armor: reduces damage from creatures');
      const el = document.createElement('div');
      el.className = 'tslot eslot';
      el.dataset.slot = EQUIP_NAMES[slot];
      el.append(...slotParts());
      el.style.backgroundImage = `url("${Textures.ghostUrl(slot)}")`;
      el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.clickSlot(this.game.player.equipment, i, e.button, e.shiftKey); });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      grid.appendChild(el);
      this.equipEls[i] = el;
    });
    this.capEl = stat('Cap:', 'Capacity: free slots in your inventory and worn backpack');
    this.$('equip-min').addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.$('equipment').classList.toggle('min');
      this.redraw();
    });
  }

  get equipOpen() { return !this.$('equipment').classList.contains('min'); }

  renderEquipment() {
    const p = this.game.player, eq = p.equipment;
    this.equipEls.forEach((el, i) => {
      this.fillSlot(el, eq.slots[i]);
      el.classList.toggle('filled', !!eq.slots[i]);
      el.title = eq.slots[i] ? '' : el.dataset.slot; // empty: just the slot's name
    });
    this.armEl.textContent = eq.armor;
    const bag = eq.get('back');
    this.capEl.textContent = p.inventory.slots.filter((s) => !s).length + (bag && bag.bag ? bag.bag.filter((s) => !s).length : 0);
  }

  // Status icons under the equipment, like Tibia's condition bar.
  renderConditions() {
    const p = this.game.player, g = this.game;
    const on = [];
    if (p.poisonTime > 0) on.push(['poisoned', 'Poisoned']);
    if (p.headUnderwater()) on.push(['drowning', 'Drowning']);
    if (p.food <= 6) on.push(['hungry', 'Hungry']);
    if (g.creative) on.push(['creative', 'Creative mode']);
    const key = on.map((c) => c[0]).join();
    if (key === this._conditions) return;
    this._conditions = key;
    const bar = this.$('conditions');
    bar.textContent = '';
    for (const [name, title] of on) {
      const img = document.createElement('img');
      img.src = Textures.conditionUrl(name);
      img.title = title;
      img.alt = '';
      bar.appendChild(img);
    }
  }

  // ---- chest panel (inside the inventory screen) ----

  openChest(key, inv) {
    this.chestKey = key;
    this.chestInv = inv;
    if (!this.chestEls) {
      this.chestEls = [];
      this.buildSlots(this.chestEls, this.$('chest-grid'), 0, inv.slots.length, true, () => this.chestInv);
    }
    this.$('chest-panel').classList.remove('hidden');
    this.$('craft-panel').classList.add('hidden');
    this.redraw();
  }

  closeChest() {
    this.chestKey = null;
    this.chestInv = null;
    this.$('chest-panel').classList.add('hidden');
    this.$('craft-panel').classList.remove('hidden');
  }

  // ---- Tibia-style backpack windows (docked on the right, usable while playing) ----

  openBag(stack) {
    const existing = this.bags.find((b) => b.stack === stack);
    if (existing) { // already open: bring it back up and flash it
      existing.el.classList.remove('min');
      existing.el.classList.remove('flash'); void existing.el.offsetWidth; existing.el.classList.add('flash');
      return;
    }
    const inv = new Inventory(0, stack.bag);
    const el = document.createElement('div');
    el.className = 'tw';
    const title = document.createElement('div');
    title.className = 'tw-title';
    const icon = document.createElement('img');
    icon.src = Textures.iconUrl(stack.id);
    const name = document.createElement('span');
    name.textContent = itemName(stack.id);
    const min = document.createElement('button');
    min.className = 'tw-btn'; min.title = 'Minimise'; min.textContent = '–';
    const close = document.createElement('button');
    close.className = 'tw-btn'; close.title = 'Close'; close.textContent = '×';
    title.append(icon, name, min, close);
    const body = document.createElement('div');
    body.className = 'tw-body';
    el.append(title, body);
    const win = { stack, inv, el, slotEls: [] };
    stack.bag.forEach((_, i) => {
      const s = document.createElement('div');
      s.className = 'tslot';
      s.append(...slotParts());
      s.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.clickSlot(inv, i, e.button, e.shiftKey); });
      s.addEventListener('contextmenu', (e) => e.preventDefault());
      body.appendChild(s);
      win.slotEls.push(s);
    });
    min.addEventListener('mousedown', (e) => { e.stopPropagation(); el.classList.toggle('min'); });
    close.addEventListener('mousedown', (e) => { e.stopPropagation(); this.closeBag(win); });
    this.$('containers').appendChild(el);
    this.bags.push(win);
    this.redraw();
  }

  closeBag(win) {
    win.el.remove();
    this.$('tooltip').classList.add('hidden');
    this.bags = this.bags.filter((b) => b !== win);
    if (!this.dockOpen && this.cursor && !this.game.inventoryOpen) this.returnCursor();
    this.redraw();
  }

  // Is anything open in the right-hand dock you can drag items to and from?
  get dockOpen() { return this.bags.length > 0 || !!this.creativeWin || this.equipOpen; }

  // Backpack window layout (vertical dock on the right / horizontal along the bottom)
  // and the creative button.
  applyDockSettings() {
    // Vertical: backpacks stack under the equipment panel. Horizontal: they move out to
    // run along the bottom of the screen and the equipment panel stays on the right.
    const horizontal = Settings.get('bagLayout') === 'horizontal', box = this.$('containers');
    box.classList.toggle('horizontal', horizontal);
    if (horizontal && box.parentNode !== this.$('hud')) this.$('hud').insertBefore(box, this.$('help'));
    else if (!horizontal && box.parentNode !== this.$('sidebar')) this.$('sidebar').appendChild(box);
    const creative = Settings.get('creative');
    this.$('creative-btn').classList.toggle('hidden', !creative);
    if (!creative && this.creativeWin) this.toggleCreative();
  }

  // ---- creative menu: every item, in a window beside the backpacks ----
  //  click: take a full stack · right-click: take one · shift-click: straight into the inventory
  //  clicking the window while holding something deletes it (like Minecraft's creative trash)
  toggleCreative() {
    if (!this.creativeWin && !this.game.creative) return; // creative mode is off (or switched off in config.js)
    if (this.creativeWin) {
      this.creativeWin.el.remove();
      this.creativeWin = null;
      this.$('tooltip').classList.add('hidden');
      this.redraw();
      return;
    }
    const el = document.createElement('div');
    el.className = 'tw creative';
    const title = document.createElement('div');
    title.className = 'tw-title';
    const name = document.createElement('span');
    name.textContent = 'Creative';
    const min = document.createElement('button');
    min.className = 'tw-btn'; min.title = 'Minimise'; min.textContent = '–';
    const close = document.createElement('button');
    close.className = 'tw-btn'; close.title = 'Close'; close.textContent = '×';
    title.append(name, min, close);
    const search = document.createElement('input');
    search.type = 'text'; search.placeholder = 'Search items'; search.className = 'tw-search'; search.maxLength = 40;
    const body = document.createElement('div');
    body.className = 'tw-body creative-grid';
    el.append(title, search, body);

    const ids = [];
    for (let id = 1; id < BLOCKS.length; id++) {
      const b = BLOCKS[id];
      if (b && !b.liquid && !b.door && !b.stairs && !b.wall && !b.panel) ids.push(id); // doors / stairs / wall torches / panels come as items
    }
    for (const id of Object.keys(ITEMS).map(Number).sort((a, b) => a - b)) ids.push(id);
    const cells = ids.map((id) => {
      const s = document.createElement('div');
      s.className = 'tslot';
      s.dataset.item = id;
      const img = document.createElement('img');
      img.src = Textures.iconUrl(id); img.draggable = false;
      s.appendChild(img);
      s.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.creativeTake(id, e.button, e.shiftKey); });
      s.addEventListener('contextmenu', (e) => e.preventDefault());
      body.appendChild(s);
      return { id, s };
    });
    body.addEventListener('mousedown', (e) => { // clicking empty space while holding something: delete it
      if (e.target === body && this.cursor) { this.cursor = null; this.renderCursor(); }
    });
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      for (const c of cells) c.s.classList.toggle('hidden', !!q && !itemName(c.id).toLowerCase().includes(q));
    });
    min.addEventListener('mousedown', (e) => { e.stopPropagation(); el.classList.toggle('min'); });
    close.addEventListener('mousedown', (e) => { e.stopPropagation(); this.toggleCreative(); });
    this.$('containers').prepend(el);
    this.creativeWin = { el };
    this.redraw();
  }

  creativeTake(id, button, shift) {
    if (this.cursor) { this.cursor = null; this.renderCursor(); return; } // trash what you're holding
    const def = itemDef(id);
    const stack = { id, count: button === 2 ? 1 : def.stack };
    if (def.tool) stack.dur = def.tool.durability;
    if (def.bag) stack.bag = new Array(def.bag).fill(null);
    if (shift) { this.game.player.inventory.addStack(stack); return; }
    this.cursor = stack;
    this.renderCursor();
  }

  // Close windows for backpacks that are no longer on you (thrown down, put in a chest...).
  checkBags() {
    if (!this.bags.length) return;
    const reachable = allBags(this.game.player.inventory.slots);
    for (const s of allBags(this.game.player.equipment.slots)) reachable.add(s);
    if (this.chestInv) for (const s of allBags(this.chestInv.slots)) reachable.add(s);
    if (this.cursor && this.cursor.bag) for (const s of allBags([this.cursor])) reachable.add(s);
    for (const b of [...this.bags]) if (!reachable.has(b.stack)) this.closeBag(b);
  }

  renderCursor() {
    const el = this.$('cursor-item');
    if (this.cursor) {
      el.style.display = 'block';
      el.replaceChildren(h('img', { src: Textures.iconUrl(this.cursor.id) }), h('span', {}, this.cursor.count > 1 ? String(this.cursor.count) : ''));
    } else {
      el.style.display = 'none';
    }
  }

  renderRecipes() {
    const g = this.game, inv = g.player.inventory, st = g.stations;
    this.$('station-info').replaceChildren(
      h('span', { class: st.table ? 'on' : '' }, `Crafting Table ${st.table ? 'nearby' : 'not nearby'}`), ' · ',
      h('span', { class: st.furnace ? 'on' : '' }, `Furnace ${st.furnace ? 'nearby' : 'not nearby'}`));

    const list = this.$('recipes');
    list.replaceChildren();
    const sorted = RECIPES.map((r, i) => ({ r, i, ok: canCraft(inv, r, st) }))
      .sort((a, b) => (b.ok - a.ok) || (a.i - b.i));
    for (const { r, ok } of sorted) {
      const row = document.createElement('div');
      row.className = 'recipe' + (ok ? ' ok' : '');
      let ins = r.inputs.map((x) => h('span', { class: 'ing ' + (inv.countOf(x.id) >= x.count ? '' : 'missing'), data: { item: x.id, need: x.count } },
        h('img', { src: Textures.iconUrl(x.id) }), String(x.count)));
      if (r.pattern) {
        // Shaped recipe: show the 3x3 layout.
        const cells = r.pattern.join('').split('').map((ch) => {
          const id = r.key[ch];
          return id != null ? h('span', { class: 'cell', data: { item: id } }, h('img', { src: Textures.iconUrl(id) })) : h('span', { class: 'cell' });
        });
        ins = [h('span', { class: 'grid3' }, cells)];
      }
      row.dataset.item = r.out.id; // hovering the row names what it makes
      row.append(
        h('img', { class: 'out', src: Textures.iconUrl(r.out.id) }),
        h('div', { class: 'rname' }, itemName(r.out.id) + (r.out.count > 1 ? ' ×' + r.out.count : ''), r.station && h('small', {}, STATION_NAME[r.station])),
        h('div', { class: 'ins' }, ins));
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        let times = e.shiftKey ? 64 : 1;
        while (times-- > 0 && canCraft(inv, r, g.stations)) {
          const left = craft(inv, r);
          if (left) { g.spawnDrop(g.player.x, g.player.y, g.player.z, { id: r.out.id, count: left }, 1.5); break; }
        }
      });
      list.appendChild(row);
    }
  }

  showDeath(source) {
    const reasons = {
      fall: 'fell from a high place', lava: 'tried to swim in lava', drowning: 'drowned',
      suffocation: 'suffocated in a wall', starvation: 'starved to death', zombie: 'were slain by a zombie',
    };
    this.$('death-reason').textContent = `You ${reasons[source] || 'died'}.`;
    this.$('death').classList.remove('hidden');
  }

  hideDeath() { this.$('death').classList.add('hidden'); }
}
