// World saving in the browser (IndexedDB), kept small:
//  - only chunks the player has changed are stored (untouched terrain is
//    regenerated from the seed), each run-length compressed;
//  - plus a small record per world: player position, inventory, health,
//    hunger, time of day and weather.
// Mobs and dropped items aren't saved.
//
// Saved data is treated as untrusted when loaded (it can be edited in DevTools):
// everything is validated before use.

const SaveStore = (() => {
  const DB_NAME = 'oasiscraft';
  const LAST_KEY = 'oasiscraft.lastWorld';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('worlds');  // seedText -> meta
          db.createObjectStore('chunks');  // "seed|cx,cy" -> compressed bytes
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  const done = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const finished = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  const chunkKey = (seed, cx, cy) => `${seed}|${cx},${cy}`;
  const chunkRange = (seed) => IDBKeyRange.bound(`${seed}|`, `${seed}|￿`);

  // ---- compression: run-length pairs [count 1..255, value] ----
  function encode(bytes) {
    const out = new Uint8Array(bytes.length * 2);
    let o = 0;
    for (let i = 0; i < bytes.length;) {
      const v = bytes[i];
      let n = 1;
      while (n < 255 && i + n < bytes.length && bytes[i + n] === v) n++;
      out[o++] = n; out[o++] = v;
      i += n;
    }
    return out.slice(0, o);
  }

  function decode(data, length) {
    if (!(data instanceof Uint8Array) || data.length % 2) return null;
    const out = new Uint8Array(length);
    let o = 0;
    for (let i = 0; i < data.length; i += 2) {
      const n = data[i], v = data[i + 1];
      if (!n || o + n > length || !BLOCKS[v]) return null; // corrupt / unknown block
      out.fill(v, o, o + n);
      o += n;
    }
    return o === length ? out : null;
  }

  // ---- worlds ----

  async function loadWorld(seed) {
    const db = await open();
    const tx = db.transaction(['worlds', 'chunks'], 'readonly');
    const meta = await done(tx.objectStore('worlds').get(seed));
    const chunks = new Map();
    await new Promise((resolve, reject) => {
      const req = tx.objectStore('chunks').openCursor(chunkRange(seed));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { resolve(); return; }
        const coords = String(cur.key).slice(seed.length + 1);
        if (/^-?\d+,-?\d+$/.test(coords) && cur.value instanceof Uint8Array) chunks.set(coords, cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return { meta: meta && typeof meta === 'object' ? meta : null, chunks };
  }

  // Writes the world record and any chunks changed since the last save.
  async function saveWorld(seed, meta, dirtyChunks) {
    const db = await open();
    const tx = db.transaction(['worlds', 'chunks'], 'readwrite');
    const store = tx.objectStore('chunks');
    let added = 0;
    for (const c of dirtyChunks) {
      const data = encode(c.blocks);
      store.put(data, chunkKey(seed, c.cx, c.cy));
      added += data.length - (c.savedBytes || 0);
      c.savedBytes = data.length;
    }
    meta.bytes = Math.max(0, (meta.bytes || 0) + added);
    tx.objectStore('worlds').put(meta, seed);
    await finished(tx);
    try { localStorage.setItem(LAST_KEY, seed); } catch (e) { /* ignore */ }
  }

  async function listWorlds() {
    const db = await open();
    const tx = db.transaction('worlds', 'readonly');
    const [keys, vals] = await Promise.all([done(tx.objectStore('worlds').getAllKeys()), done(tx.objectStore('worlds').getAll())]);
    return keys.map((k, i) => ({ seed: String(k), meta: vals[i] || {} }))
      .sort((a, b) => (b.meta.lastPlayed || 0) - (a.meta.lastPlayed || 0));
  }

  async function deleteWorld(seed) {
    const db = await open();
    const tx = db.transaction(['worlds', 'chunks'], 'readwrite');
    tx.objectStore('worlds').delete(seed);
    tx.objectStore('chunks').delete(chunkRange(seed));
    await finished(tx);
    try { if (localStorage.getItem(LAST_KEY) === seed) localStorage.removeItem(LAST_KEY); } catch (e) { /* ignore */ }
  }

  function lastWorld() {
    try { return localStorage.getItem(LAST_KEY); } catch (e) { return null; }
  }

  return { loadWorld, saveWorld, listWorlds, deleteWorld, lastWorld, encode, decode };
})();

// Seeds are shown in the UI and used as storage keys: keep them short and plain.
function cleanSeed(s) {
  s = String(s == null ? '' : s).replace(/[^\w\- ]/g, '').trim().slice(0, 32);
  return s || null;
}
