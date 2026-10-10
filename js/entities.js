// Entities live at a (x, y) position on an integer layer z.
// An entity on layer z stands on top of block z-1 and fills `height` cells
// upward (the player and zombies are 2 tall, like Minecraft: feet + head).
//
// Creatures (player, mobs) move Tibia-style: one tile per step, sliding
// smoothly between tile centres. Stepping into a 1-block ledge climbs it
// (like jumping in Minecraft) if there's headroom; stepping off an edge falls
// after arriving. Item drops use simple continuous movement instead.

const FALL_TIME = 0.06;    // seconds per layer when falling through air
const SINK_TIME = 0.35;    // seconds per layer when sinking through liquid
const DIAGONAL_COST = 1.41; // diagonal steps take this much longer
const MAX_FOOD = 20;
// Exhaustion costs (4 exhaustion = 1 saturation or 1 food point).
const HUNGER = { idle: 0.01, walk: 0.03, swim: 0.05, climb: 0.08, mine: 0.03, attack: 0.1, hurt: 0.1, heal: 3 };

class Entity {
  constructor(game, x, y, z) {
    this.game = game;
    this.world = game.world;
    this.x = x; this.y = y; this.z = z;
    this.radius = 0.3;
    this.height = 1;            // cells tall (z .. z + height - 1)
    this.maxHealth = 20;
    this.health = 20;
    this.dead = false;
    this.facing = Math.PI / 2;  // always a multiple of PI/2 for creatures
    this.canStep = true;
    this.fallTimer = 0;
    this.fallDist = 0;
    this.hurtTimer = 0;
    this.lavaTimer = 0;
    this.kbx = 0; this.kby = 0;
    this.move = null;           // active grid step
    this.stepCount = 0;
  }

  get tx() { return Math.floor(this.x); }
  get ty() { return Math.floor(this.y); }

  // Tile this entity occupies for blocking purposes (its destination while stepping).
  get occX() { return this.move ? Math.floor(this.move.toX) : this.tx; }
  get occY() { return this.move ? Math.floor(this.move.toY) : this.ty; }

  // Does a block get in the way of this entity's body? Foliage doesn't: leaves near
  // the player are hidden from view, so they must never be invisible walls.
  solidAt(x, y, z) {
    const b = BLOCKS[this.world.getBlock(x, y, z)];
    return b.solid && !b.leaves;
  }

  // Can this entity stand on the block? (Creatures can stand on leaves; items fall through.)
  standsOn(x, y, z) { return BLOCKS[this.world.getBlock(x, y, z)].solid; }

  // Room for this entity's whole body with its feet at (x, y, z)?
  clearAt(x, y, z) {
    if (z < 0 || z + this.height > WORLD_H) return false;
    for (let k = 0; k < this.height; k++) if (this.solidAt(x, y, z + k)) return false;
    return true;
  }

  get headZ() { return this.z + this.height - 1; }
  blockAtFeet() { return this.world.getBlock(this.tx, this.ty, this.z); }
  blockAtHead() { return this.world.getBlock(this.tx, this.ty, this.headZ); }
  inLiquid() { return BLOCKS[this.blockAtFeet()].liquid; }
  inWater() { return this.blockAtFeet() === B.WATER; }
  headUnderwater() { return this.blockAtHead() === B.WATER; }

  // Standing on a solid block, or floating with your feet in water.
  isSupported() {
    if (this.z <= 0) return true;
    if (this.standsOn(this.tx, this.ty, this.z - 1)) return true;
    return this.world.getBlock(this.tx, this.ty, this.z - 1) === B.WATER && this.inLiquid();
  }

  // Can push off from here to climb (solid ground, or treading water).
  canClimbFromHere() {
    return this.isSupported() || this.inLiquid() || this.world.getBlock(this.tx, this.ty, this.z - 1) === B.WATER;
  }

  // ---- grid movement ----------------------------------------------------

  face(dx, dy) {
    if (dx) this.facing = dx > 0 ? 0 : Math.PI;
    else if (dy) this.facing = dy > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  faceToward(x, y) {
    const dx = x - this.x, dy = y - this.y;
    if (Math.abs(dx) >= Math.abs(dy)) this.face(Math.sign(dx), 0);
    else this.face(0, Math.sign(dy));
  }

  // Layer we'd end up on stepping into tile (x, y), or null if blocked.
  // Walking onto a tile one layer lower steps straight down (like stairs);
  // anything deeper is a drop, handled by gravity once the step lands.
  // Lamps block the way and are never stepped up (or down) onto; bars, fences and panes
  // on the edge between the tiles block the step.
  destLayer(x, y) {
    const nz = this.stepLayer(x, y);
    if (nz === null || BLOCKS[this.world.getBlock(x, y, nz - 1)].obstacle) return null;
    const dx = x - this.tx, dy = y - this.ty;
    if (Math.max(Math.abs(dx), Math.abs(dy)) === 1 &&
        !this.world.crossable(this.tx, this.ty, dx, dy, Math.min(this.z, nz), Math.max(this.z, nz) + this.height - 1)) return null;
    return nz;
  }

  stepLayer(x, y) {
    const w = this.world, z = this.z;
    if (this.clearAt(x, y, z)) {
      const below = w.getBlock(x, y, z - 1);
      if (z > 1 && !this.flying && !BLOCKS[below].solid && below !== B.WATER) {
        const under = w.getBlock(x, y, z - 2);
        if (BLOCKS[under].solid || under === B.WATER) return z - 1;
      }
      return z;
    }
    // Step up one block: needs the whole body to fit on top, and headroom to rise here first.
    if (this.canStep && this.canClimbFromHere() && this.clearAt(x, y, z + 1) &&
        !this.solidAt(this.tx, this.ty, z + this.height)) return z + 1;
    return null;
  }

  // Would a creature of this height at (x, y, z) overlap another creature?
  spanOccupied(x, y, z) {
    for (let k = 0; k < this.height; k++) if (this.game.isOccupied(x, y, z + k, this)) return true;
    return false;
  }

  stepDuration() { return 0.3; }

  // Start a one-tile step. Returns false (and just turns) if blocked.
  stepTo(dx, dy, dur) {
    if (this.move || this.dead) return false;
    const fx = this.tx, fy = this.ty, nx = fx + dx, ny = fy + dy;
    this.face(dx, dy);
    if (dx && dy && this.destLayer(fx + dx, fy) === null && this.destLayer(fx, fy + dy) === null) return false; // no corner cutting
    const nz = this.destLayer(nx, ny);
    if (nz === null || this.spanOccupied(nx, ny, nz)) return false;
    if (dur == null) dur = this.stepDuration() * (dx && dy ? DIAGONAL_COST : 1);
    this.move = { fromX: this.x, fromY: this.y, fromZ: this.visualZ, toX: nx + 0.5, toY: ny + 0.5, t: 0, dur };
    this.z = nz;
    this.stepCount++;
    return true;
  }

  // Advance the current step. Returns time left over after arriving (for chaining steps).
  updateStep(dt) {
    const m = this.move;
    if (!m) return dt;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    this.x = m.fromX + (m.toX - m.fromX) * k;
    this.y = m.fromY + (m.toY - m.fromY) * k;
    if (k < 1) return 0;
    this.move = null;
    return m.t - m.dur;
  }

  get stepProgress() { return this.move ? Math.min(1, this.move.t / this.move.dur) : 0; }

  // Layer used for drawing: eases between layers while climbing / stepping down.
  get visualZ() {
    const m = this.move;
    if (!m || m.fromZ === undefined || m.fromZ === this.z) return this.z;
    const k = Math.min(1, m.t / m.dur);
    return m.fromZ + (this.z - m.fromZ) * (1 - (1 - k) * (1 - k));
  }

  // Limb swing for walk animation, -1..1.
  get swing() {
    return this.move ? Math.sin(this.stepProgress * Math.PI) * (this.stepCount % 2 ? 1 : -1) : 0;
  }

  // Try to change layer by dz (swimming up/down). Returns true on success.
  tryShiftLayer(dz) {
    const nz = this.z + dz;
    if (this.move || !this.clearAt(this.tx, this.ty, nz)) return false;
    this.z = nz;
    return true;
  }

  // ---- continuous movement (item drops) ----------------------------------

  collidesAt(x, y, z, r = this.radius) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r - 1e-6);
    const y0 = Math.floor(y - r), y1 = Math.floor(y + r - 1e-6);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.solidAt(tx, ty, z)) return true;
      }
    }
    return false;
  }

  slide(dx, dy) {
    if (dx && !this.collidesAt(this.x + dx, this.y, this.z)) this.x += dx;
    if (dy && !this.collidesAt(this.x, this.y + dy, this.z)) this.y += dy;
  }

  // ---- physics ----------------------------------------------------------

  updatePhysics(dt) {
    if (this.hurtTimer > 0) this.hurtTimer -= dt;

    if (this.blockAtFeet() === B.LAVA) {
      this.lavaTimer -= dt;
      if (this.lavaTimer <= 0) { this.lavaTimer = 0.5; this.damage(4, 'lava', null, true); }
    }

    if (this.move || this.flying) return; // gravity applies once the step lands (and never while flying)

    // Buried (e.g. sand fell on us or a block was placed inside us): pop up.
    if (this.solidAt(this.tx, this.ty, this.z)) {
      if (this.z + 1 < WORLD_H) this.z++;
      this.damage(1, 'suffocation');
      return;
    }
    // Something solid in our head space (gravel fell on us): suffocate until it's cleared.
    for (let k = 1; k < this.height; k++) {
      if (this.solidAt(this.tx, this.ty, this.z + k)) { this.damage(1, 'suffocation'); break; }
    }

    if (this.kbx || this.kby) {
      this.slide(this.kbx * dt, this.kby * dt);
      const decay = Math.pow(0.002, dt);
      this.kbx *= decay; this.kby *= decay;
      if (Math.abs(this.kbx) + Math.abs(this.kby) < 0.05) this.kbx = this.kby = 0;
    }

    if (!this.isSupported()) {
      this.fallTimer += dt;
      const rate = this.inLiquid() ? SINK_TIME : FALL_TIME;
      if (this.fallTimer >= rate) {
        this.fallTimer = 0;
        this.z--;
        if (!this.inLiquid()) this.fallDist++;
        else this.fallDist = 0;
      }
    } else {
      const below = this.world.getBlock(this.tx, this.ty, this.z - 1);
      if (this.fallDist > 3 && !this.inLiquid() && below !== B.WATER) this.damage(this.fallDist - 3, 'fall');
      this.fallDist = 0;
      this.fallTimer = 0;
    }
  }

  damage(amount, source, attacker = null, ignoreInvuln = false) {
    if (this.dead || (this.hurtTimer > 0 && !ignoreInvuln)) return false;
    this.health -= amount;
    this.hurtTimer = 0.5;
    if (this.health <= 0) { this.health = 0; this.die(source, attacker); return true; }
    // Knockback: shoved one tile away from the attacker.
    if (attacker && this.canStep) {
      const dx = Math.sign(Math.round(this.x - attacker.x)), dy = Math.sign(Math.round(this.y - attacker.y));
      if (dx || dy) {
        const f = this.facing;
        this.stepTo(dx, dy, 0.12);
        this.facing = f;
      }
    }
    return true;
  }

  die() { this.dead = true; }

  distTo(o) { return Math.hypot(this.x - o.x, this.y - o.y); }
}

// Fallback look if no skin is available.
const PLAYER_LOOK = {
  hair: '#3b2510', skin: '#c8956c', shirt: '#00a8a8', sleeve: '#009c9c',
  pants: '#3b3b9e', shoes: '#4a4a4a', eyes: '#3a4fbf', mouth: '#6b4030',
};

class Player extends Entity {
  constructor(game, x, y, z) {
    super(game, x, y, z);
    this.height = 2;        // feet + head, like Minecraft
    this.inventory = new Inventory();
    this.equipment = new Equipment(); // Tibia-style: helmet, armor, legs, boots, shield...
    this.selected = 0;
    this.maxAir = 10;
    this.air = 10;
    this.airTimer = 0;
    this.regenTimer = 0;
    this.speed = 3.5;       // tiles per second on land
    this.attackCooldown = 0;
    this.actionTime = 0;    // drives the arm swing when mining / attacking
    this.resetHunger();
  }

  // ---- hunger (Minecraft-style) ----
  // Activity adds exhaustion; every 4 exhaustion uses 1 saturation, or 1 food once
  // saturation is gone. Food >= 18 heals you; food at 0 starves you (down to half a heart).
  resetHunger() {
    this.poisonTime = 0;
    this.food = MAX_FOOD;
    this.saturation = 5;
    this.exhaustion = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
  }

  exhaust(amount) { if (!this.game.creative) this.exhaustion += amount; }

  // Poison: 1 damage every 1.25 s while it lasts; never kills (stops at half a heart).
  // A new dose doesn't stack, it just resets the timer.
  poison(seconds) {
    if (this.game.creative) return;
    this.poisonTime = Math.max(this.poisonTime || 0, seconds);
  }

  updatePoison(dt) {
    if (!(this.poisonTime > 0)) { this.poisonTick = 0; return; }
    this.poisonTime -= dt;
    this.poisonTick = (this.poisonTick || 0) + dt;
    if (this.poisonTick >= 1.25) {
      this.poisonTick -= 1.25;
      if (this.health > 1) this.damage(1, 'poison', null, true);
    }
  }

  updateHunger(dt) {
    if (this.game.creative) { this.food = MAX_FOOD; this.saturation = Math.max(this.saturation, 5); return; }
    this.exhaust(dt * HUNGER.idle);
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
    // Well fed: heal, which costs energy. Faster while saturated and full.
    const regenEvery = this.food >= MAX_FOOD && this.saturation > 0 ? 1 : 4;
    this.regenTimer += dt;
    if (this.food >= 18 && this.health < this.maxHealth && this.regenTimer >= regenEvery) {
      this.regenTimer = 0;
      this.health = Math.min(this.maxHealth, this.health + 1);
      this.exhaust(HUNGER.heal);
    }
    if (this.health >= this.maxHealth) this.regenTimer = 0;
    // Starving.
    if (this.food <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 4) {
        this.starveTimer = 0;
        if (this.health > 1) this.damage(1, 'starvation', null, true);
      }
    } else this.starveTimer = 0;
  }

  stepTo(dx, dy, dur) {
    const z0 = this.z;
    const ok = super.stepTo(dx, dy, dur);
    if (ok) this.exhaust((this.inWater() ? HUNGER.swim : HUNGER.walk) * (dx && dy ? DIAGONAL_COST : 1) + (this.z > z0 ? HUNGER.climb : 0));
    return ok;
  }

  get held() { return this.inventory.slots[this.selected]; }
  get heldTool() { const h = this.held; return h ? itemDef(h.id).tool || null : null; }

  stepDuration() {
    let s = this.speed;
    if (this.inWater()) s *= 0.5;
    else if (this.inLiquid()) s *= 0.3;
    return 1 / s;
  }

  // Swing the arm (call every frame while mining, or once per hit).
  swingArm() { if (this.actionTime <= 0) this.actionTime = 0.3; }

  update(dt, input) {
    let dx = 0, dy = 0;
    if (input.key('KeyW') || input.key('ArrowUp')) dy -= 1;
    if (input.key('KeyS') || input.key('ArrowDown')) dy += 1;
    if (input.key('KeyA') || input.key('ArrowLeft')) dx -= 1;
    if (input.key('KeyD') || input.key('ArrowRight')) dx += 1;
    if (this.game.mirrored) { dx = -dx; dy = -dy; } // keys follow the screen, not the compass

    const left = this.updateStep(dt);
    // Only start the next step from solid footing, so walking off a drop falls.
    if (!this.move && (dx || dy) && (this.isSupported() || this.game.creative)) {
      // Hold a direction to chain steps; if a diagonal is blocked, slide along an axis.
      const ok = this.stepTo(dx, dy) || (dx && dy && (this.stepTo(dx, 0) || this.stepTo(0, dy)));
      if (ok && left > 0) this.updateStep(left);
    }

    // Swimming: Space rises a layer, Shift dives a layer. In creative you fly: no gravity,
    // and Space / Shift go up / down anywhere there's room.
    this.flying = this.game.creative;
    this.swimTimer = (this.swimTimer || 0) - dt;
    // Standing on an elevator, a press of Space / Shift rides it up / down (one ride per press).
    if (!this.move && this.world.getBlock(this.tx, this.ty, this.z - 1) === B.ELEVATOR) {
      const dir = input.wasPressed('Space') ? 1 : input.wasPressed('ShiftLeft') || input.wasPressed('ShiftRight') ? -1 : 0;
      if (dir && this.game.rideElevator(dir)) this.swimTimer = 0.3; // don't also fly / swim on the same press
    }
    if (this.flying && this.swimTimer <= 0 && !this.move) {
      if (input.key('Space') && this.tryShiftLayer(1)) this.swimTimer = 0.18;
      else if (input.shift() && this.tryShiftLayer(-1)) this.swimTimer = 0.18;
    } else if (this.swimTimer <= 0 && !this.move) {
      const below = this.world.getBlock(this.tx, this.ty, this.z - 1);
      if (input.key('Space') && this.inLiquid()) {
        if (this.tryShiftLayer(1)) this.swimTimer = 0.3;
      } else if (input.shift() && below === B.WATER) {
        if (this.tryShiftLayer(-1)) this.swimTimer = 0.3;
      }
    }

    this.updatePhysics(dt);

    // Breath (only when your head is under water).
    if (this.headUnderwater()) {
      this.airTimer += dt;
      if (this.airTimer >= 1) {
        this.airTimer = 0;
        if (this.air > 0) this.air--;
        else this.damage(2, 'drowning', null, true);
      }
    } else {
      this.air = Math.min(this.maxAir, this.air + dt * 4);
      this.airTimer = 0;
    }

    this.updateHunger(dt);
    this.updatePoison(dt);

    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.actionTime > 0) this.actionTime -= dt;
  }

  // Hits from creatures (attacker set) can be blocked by a shield (Def% chance) and
  // are reduced by armor: Arm / (Arm + 25), rounded at random so small hits average out.
  // Like Tibia, armor and shields do nothing against falls, fire, hunger or poison.
  damage(amount, source, attacker, ignoreInvuln) {
    if (this.game.creative) return false; // invulnerable in creative
    if (attacker && !this.dead && (this.hurtTimer <= 0 || ignoreInvuln)) {
      const shield = this.equipment.get('shield');
      if (shield && Math.random() * 100 < itemDef(shield.id).defense) {
        this.hurtTimer = 0.5;
        this.game.spawnPuff(this, '#e8eef4'); // Tibia's grey "poff": blocked
        return false;
      }
      const arm = this.equipment.armor;
      if (arm > 0) {
        const left = amount * (1 - arm / (arm + 25));
        amount = Math.floor(left) + (Math.random() < left % 1 ? 1 : 0);
        if (amount <= 0) {
          this.hurtTimer = 0.5;
          this.game.spawnPuff(this, '#ffd23a'); // yellow sparks: the armor took it all
          return false;
        }
      }
    }
    const hit = super.damage(amount, source, attacker, ignoreInvuln);
    if (hit) { this.game.ui.flashDamage(); this.exhaust(HUNGER.hurt); }
    return hit;
  }

  die(source) {
    this.dead = true;
    this.move = null;
    this.game.onPlayerDeath(source);
  }

  // Colours of the worn helmet / armor / legs / boots / shield, for drawing on the model,
  // plus `metal`: each piece's metal kind for its shine (null when the "Show armor on
  // character" setting is off).
  armorLook() {
    if (!Settings.get('showArmor')) return null;
    const look = { metal: {} };
    let any = false;
    for (const slot of ['head', 'body', 'legs', 'feet', 'shield']) {
      const it = this.equipment.get(slot);
      if (!it) continue;
      const def = itemDef(it.id);
      look[slot] = def.color;
      look.metal[slot] = def.set || def.metal || null;
      any = true;
    }
    return any ? look : null;
  }

  draw(ctx, sx, sy, T, opts = {}) {
    const act = this.actionTime > 0 ? Math.sin((this.actionTime / 0.3) * Math.PI) : 0;
    const h = this.held;
    const held = h ? heldModel(h.id) || Textures.icons[h.id] : null; // tools, weapons and torches are 3D
    if (Skins.current) drawModel3D(ctx, sx, sy, T, this.facing, 'skinned', Skins.current, this.swing, act, 1, held, Object.assign({ armor: this.armorLook() }, opts));
    else drawModel3D(ctx, sx, sy, T, this.facing, 'humanoid', PLAYER_LOOK, this.swing, act, 1, held, opts);
  }
}

class ItemDrop extends Entity {
  constructor(game, x, y, z, stack) {
    super(game, x, y, z);
    this.radius = 0.15;
    this.canStep = false;
    this.stack = stack;
    this.age = 0;
    this.pickupDelay = 0.6;
  }

  // Items drop through leaves rather than getting stranded up in a canopy.
  standsOn(x, y, z) {
    const b = BLOCKS[this.world.getBlock(x, y, z)];
    return b.solid && !b.leaves;
  }

  update(dt) {
    this.age += dt;
    if (this.pickupDelay > 0) this.pickupDelay -= dt;
    if (!this.attract) this.updatePhysics(dt); // being pulled to the player: no gravity
    if (this.age > 300) this.dead = true;
  }

  damage() { return false; }

  draw(ctx, sx, sy, T) {
    const icon = Textures.icons[this.stack.id];
    if (!icon) return;
    const s = T * 0.42;
    const bob = Math.sin(this.age * 3) * T * 0.05;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(sx, sy + s * 0.45, s * 0.45, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(icon, sx - s / 2, sy - s / 2 + bob, s, s);
    if (this.stack.count > 1) ctx.drawImage(icon, sx - s / 2 + 3, sy - s / 2 + bob - 3, s, s);
  }
}
