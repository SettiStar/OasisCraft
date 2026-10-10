// Keyboard + mouse state.

class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();   // keys pressed this frame
    this.mouse = { x: 0, y: 0, left: false, right: false, rightPressed: false, inside: false };
    this.wheel = 0;

    const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Tab', 'F3', 'F8', 'Home', 'AltLeft', 'AltRight']);
    window.addEventListener('keydown', (e) => {
      // Typing in a text box (e.g. a skin link) shouldn't move the player; Esc still works.
      const t = e.target;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.type !== 'checkbox' && e.code !== 'Escape') return;
      if (block.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    // Mouse position in canvas (device) pixels, which is what the renderer draws in.
    canvas.addEventListener('mousemove', (e) => {
      const dpr = window.devicePixelRatio || 1;
      this.mouse.x = e.clientX * dpr; this.mouse.y = e.clientY * dpr; this.mouse.inside = true;
    });
    canvas.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return; // Ctrl+wheel = browser zoom = game zoom
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  key(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  shift() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }

  endFrame() {
    this.pressed.clear();
    this.mouse.rightPressed = false;
    this.mouse.leftPressed = false;
    this.wheel = 0;
  }
}
