// Player settings, saved in this browser (localStorage) so they survive reloads.
//
// Saved data is treated as untrusted: only known keys are read, each must have the
// right type (and allowed value), and anything else is ignored.

const Settings = (() => {
  const KEY = 'oasiscraft.settings.v1';
  const defaults = {
    climbHints: true,   // blue highlight on tiles you can step up onto (underground)
    outlines: true,     // ledge edges, wall bands, contact shadows
    help: true,         // controls overlay
    weather: true,      // random weather events
    leafClear: true,    // hide tree canopy around the player
    mirrorView: false,  // view from the opposite side (map turned 180 degrees), toggled with M
    debug: false,       // F3 info
    cutMode: 'auto',    // 'auto' | 'always' | 'off'
    bagLayout: 'vertical', // backpack windows: 'vertical' (docked column) | 'horizontal' (wide, along the bottom)
    creative: false,    // creative mode
    showArmor: true,    // draw worn armor on the character (off = Tibia's look: outfit only)
    skin: { kind: 'preset', index: 0 },
  };

  // Returns a clean value for `key`, or undefined if `v` isn't acceptable.
  function validate(key, v) {
    const d = defaults[key];
    if (typeof d === 'boolean') return typeof v === 'boolean' ? v : undefined;
    if (key === 'cutMode') return ['auto', 'always', 'off'].includes(v) ? v : undefined;
    if (key === 'bagLayout') return ['vertical', 'horizontal'].includes(v) ? v : undefined;
    if (key === 'skin') {
      if (!v || typeof v !== 'object') return undefined;
      if (v.kind === 'preset' && Number.isInteger(v.index) && v.index >= 0 && v.index < 8) return { kind: 'preset', index: v.index };
      if (v.kind === 'link' && typeof v.url === 'string' && v.url.length < 2048 && /^https?:\/\//i.test(v.url)) return { kind: 'link', url: v.url };
      if (v.kind === 'data' && typeof v.data === 'string' && v.data.length < 3e6 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(v.data)) return { kind: 'data', data: v.data };
      return undefined;
    }
    return undefined;
  }

  const values = Object.assign({}, defaults);
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object') {
      for (const key of Object.keys(defaults)) {
        if (!Object.prototype.hasOwnProperty.call(saved, key)) continue;
        const v = validate(key, saved[key]);
        if (v !== undefined) values[key] = v;
      }
    }
  } catch (e) { /* storage unavailable or corrupt: use defaults */ }

  // Settings that only exist while their build switch in config.js is on; otherwise they read
  // as the default and can't be changed (a saved value doesn't count).
  const SWITCH = { creative: 'creative', debug: 'devTools' };
  const allowed = (k) => !SWITCH[k] || !!OASIS_CONFIG[SWITCH[k]];

  const listeners = [];
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch (e) { /* ignore */ }
  }

  return {
    get: (k) => (allowed(k) ? values[k] : defaults[k]),
    set(k, v) {
      if (!Object.prototype.hasOwnProperty.call(defaults, k) || !allowed(k)) return;
      const clean = validate(k, v);
      if (clean === undefined) return;
      values[k] = clean;
      save();
      for (const fn of listeners) fn(k, clean);
    },
    onChange(fn) { listeners.push(fn); },
  };
})();
