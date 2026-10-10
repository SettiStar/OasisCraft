// Mobs: data-driven types + pluggable behaviors.
//
// To add/change AI, add an entry to BEHAVIORS and point a mob type at it.
// A behavior is { init(mob)?, update(mob, game, dt), onHurt(mob, attacker, game)? }.
// update() is only called while the mob is standing on a tile (not mid-step);
// move with mob.stepTo(dx, dy) (one tile, Tibia-style), turn with mob.face(dx, dy).
// Mob AI is intentionally minimal for now (wander only) — real behaviors TBD.

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const BEHAVIORS = {
  idle: {
    update() {},
  },

  wander: {
    init(m) { m.ai = { timer: Math.random() * 2, dir: null, steps: 0 }; },
    update(m, game, dt) {
      const ai = m.ai;
      ai.timer -= dt;
      if (ai.timer > 0) return;
      if (!ai.steps) {
        if (Math.random() < 0.4) { ai.timer = 1 + Math.random() * 3; return; } // stand around
        ai.dir = DIRS4[Math.floor(Math.random() * 4)];
        ai.steps = 1 + Math.floor(Math.random() * 4);
      }
      if (m.stepTo(ai.dir[0], ai.dir[1])) ai.steps--;
      else ai.steps = 0;
      if (!ai.steps) ai.timer = 0.3 + Math.random() * 1.5;
    },
  },

  // Hostile: walks toward the player when within CHASE_RANGE tiles (and roughly the
  // same height), otherwise wanders. When adjacent it attacks, but only if no block
  // is in the way (line of sight).
  chase: {
    init(m) { BEHAVIORS.wander.init(m); },
    update(m, game, dt) {
      const p = game.player;
      const dx = p.x - m.x, dy = p.y - m.y;
      const near = !p.dead && !game.creative && Math.hypot(dx, dy) <= CHASE_RANGE && Math.abs(p.z - m.z) <= 3;
      if (!near) { BEHAVIORS.wander.update(m, game, dt); return; }
      const sx = Math.sign(Math.round(dx)), sy = Math.sign(Math.round(dy));
      if (Math.max(Math.abs(p.tx - m.tx), Math.abs(p.ty - m.ty)) <= 1) {
        m.faceToward(p.x, p.y);
        if (m.attackTimer <= 0 && Math.abs(p.z - m.z) <= 1 && game.lineOfSight(m, p)) {
          p.damage(m.def.attackDamage || 2, m.type, m);
          m.attackTimer = 1;
          m.actionTime = 0.3;
        }
        return;
      }
      // Greedy pathing: straight at the player, then along each axis, then sidestep.
      const tries = [[sx, sy], Math.abs(dx) >= Math.abs(dy) ? [sx, 0] : [0, sy], Math.abs(dx) >= Math.abs(dy) ? [0, sy] : [sx, 0],
        sx ? [0, 1] : [1, 0], sx ? [0, -1] : [-1, 0]];
      const speedUp = m.def.chaseSpeed ? m.def.chaseSpeed / m.speed : 1;
      for (const [tx, ty] of tries) {
        if (!tx && !ty) continue;
        if (m.stepTo(tx, ty, m.stepDuration() / speedUp * (tx && ty ? DIAGONAL_COST : 1))) return;
      }
      m.faceToward(p.x, p.y);
    },
  },
};

// Bees fly freely (no grid steps, no gravity): straight at the player, rising over
// anything in the way. A sting does half a heart plus poison, and the bee dies.
// They lose interest and fly off after a while. Creative players are ignored.
BEHAVIORS.bee = {
  init(m) { m.ai = { life: 25 + Math.random() * 10, zTimer: 0, wobble: Math.random() * 6 }; m.homeX = m.x; m.homeY = m.y; },
  update(m, game, dt) {
    const p = game.player, ai = m.ai, w = game.world;
    ai.life -= dt; ai.wobble += dt * 3; ai.zTimer -= dt;
    if (ai.life <= 0) { m.dead = true; return; }
    const angry = !p.dead && !game.creative && m.distTo(p) < 16;
    const tx = angry ? p.x : m.homeX + Math.cos(ai.wobble) * 2, ty = angry ? p.y : m.homeY + Math.sin(ai.wobble * 1.3) * 2;
    const tz = angry ? p.z + 1 : m.z;
    const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
    if (d > 0.05) {
      const step = Math.min(d, BEE_SPEED * dt);
      const nx = m.x + dx / d * step + Math.sin(ai.wobble * 5) * 0.4 * dt, ny = m.y + dy / d * step;
      if (!w.isSolid(Math.floor(nx), Math.floor(ny), m.z)) { m.x = nx; m.y = ny; }
      else if (ai.zTimer <= 0 && !w.isSolid(m.tx, m.ty, m.z + 1)) { m.z++; ai.zTimer = 0.2; } // fly up and over
      m.faceToward(tx, ty);
    }
    if (ai.zTimer <= 0) {
      if (w.isSolid(m.tx, m.ty, m.z)) { m.z++; ai.zTimer = 0.15; }
      else if (m.z < tz && !w.isSolid(m.tx, m.ty, m.z + 1)) { m.z++; ai.zTimer = 0.25; }
      else if (m.z > tz && !w.isSolid(m.tx, m.ty, m.z - 1)) { m.z--; ai.zTimer = 0.25; }
    }
    // Sting (only counts if it lands; right after another hit you're briefly immune, so it tries again).
    if (angry && d < 0.75 && Math.abs(p.z + 1 - m.z) <= 1 && p.damage(1, 'bee', m)) {
      p.poison(POISON_SECONDS);
      game.spawnDebris(m.tx, m.ty, m.z - 1, B.BEEHIVE, 5);
      m.dead = true; // a bee that stings dies
    }
  },
};

const CHASE_RANGE = 7; // hostile mobs notice the player within this many tiles
const BEE_SPEED = 3.4;   // tiles per second
const POISON_SECONDS = 3;

const MOB_TYPES = {
  pig: {
    name: 'Pig',
    maxHealth: 10,
    speed: 1.6,
    radius: 0.35,
    height: 1,
    size: 1,
    behavior: 'wander',
    hostile: false,
    drops: [{ id: I.RAW_PORK, min: 1, max: 3 }, { id: I.LEATHER, min: 0, max: 2 }],
    model: 'quadruped',
    look: { body: '#f0a0a0', head: '#f5aeae', snout: '#e88a95', nostril: '#9a4a55', legs: '#d98585' },
    spawn: { place: 'surface', light: 'bright', ground: [B.GRASS], weight: 3 },
  },
  zombie: {
    name: 'Zombie',
    maxHealth: 20,
    speed: 1.6,
    radius: 0.3,
    height: 2,
    size: 1,
    behavior: 'chase',
    chaseSpeed: 2.2,
    hostile: true,
    attackDamage: 3,
    burnsInDaylight: true,
    drops: [{ id: I.ROTTEN_FLESH, min: 0, max: 2 }, { id: I.BONE, min: 0, max: 2 }],
    model: 'humanoid',
    look: { hair: '#3f6e33', skin: '#5a8f4a', shirt: '#2f8f9a', sleeve: '#2a8590', pants: '#3a3a8a', shoes: '#3a3a3a', eyes: '#0a0a0a', armsForward: true },
    spawn: { place: 'dark', light: 'dark', weight: 2 },
  },
  bee: {
    name: 'Bee',
    maxHealth: 4,
    speed: BEE_SPEED,
    radius: 0.2,
    height: 1,
    size: 1.3,
    behavior: 'bee',
    flying: true,
    hostile: true,
    drops: [],
    model: 'bee',
    look: { body: '#f2c230', stripe: '#3a2a10', face: '#2a1a08', stinger: '#1a1a1a', wing: '#e6f2ff' },
    spawn: null, // only comes out of beehives
  },
};

class Mob extends Entity {
  constructor(game, type, x, y, z) {
    super(game, x, y, z);
    this.type = type;
    this.def = MOB_TYPES[type];
    this.maxHealth = this.health = this.def.maxHealth;
    this.speed = this.def.speed;
    this.radius = this.def.radius;
    this.height = this.def.height || 1;
    this.behavior = BEHAVIORS[this.def.behavior] || BEHAVIORS.idle;
    if (this.behavior.init) this.behavior.init(this);
    this.attackTimer = 0;
    this.actionTime = 0;
    this.burning = false;
    this.burnTimer = 0;
  }

  stepDuration() {
    return 1 / (this.speed * (this.inLiquid() ? 0.5 : 1));
  }

  update(dt) {
    if (this.def.flying) { // flyers move themselves every frame and ignore gravity
      this.behavior.update(this, this.game, dt);
      if (this.hurtTimer > 0) this.hurtTimer -= dt;
      return;
    }
    this.updateStep(dt);
    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.actionTime > 0) this.actionTime -= dt;
    if (!this.move && this.isSupported()) this.behavior.update(this, this.game, dt);
    this.updatePhysics(dt);
    if (this.def.burnsInDaylight) this.updateBurning(dt);
  }

  // Undead catch fire in daylight under open sky (not in water or rain): 1 damage
  // per second, with flames, until they find shade or die.
  updateBurning(dt) {
    const g = this.game;
    const raining = g.weather.type === 'rain' && g.weather.intensity > 0.3 && g.precipitation() === 'rain';
    const exposed = g.world.topAt(this.tx, this.ty) < this.z + this.height;
    this.burning = g.sun > 0.5 && exposed && !raining && !this.inWater() && !this.dead;
    if (!this.burning) { this.burnTimer = 0; return; }
    this.burnTimer += dt;
    if (this.burnTimer >= 1) { this.burnTimer -= 1; this.damage(1, 'fire', null, true); }
    // Flames licking up the body.
    if (Math.random() < dt * 22) {
      g.particles.push({
        x: this.x + (Math.random() - 0.5) * 0.5, y: this.y + (Math.random() - 0.3) * 0.3, z: this.z,
        h: Math.random() * 0.9, vx: 0, vy: 0, vh: 0.8 + Math.random() * 0.8, rise: true,
        life: 0.3 + Math.random() * 0.3, size: 0.05 + Math.random() * 0.06,
        color: ['#ffd23a', '#ff9a1a', '#ff5a10'][Math.floor(Math.random() * 3)],
      });
    }
  }

  damage(amount, source, attacker, ignoreInvuln) {
    const hit = super.damage(amount, source, attacker, ignoreInvuln);
    if (hit && !this.dead && this.behavior.onHurt) this.behavior.onHurt(this, attacker, this.game);
    return hit;
  }

  die(source, attacker) {
    this.dead = true;
    if (attacker === this.game.player || (attacker && attacker.tower)) { // loot from your kills and your gun towers'
      for (const d of this.def.drops) {
        const n = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
        if (n > 0) this.game.spawnDrop(this.x, this.y, this.z, { id: d.id, count: n });
      }
    }
  }

  draw(ctx, sx, sy, T, opts) {
    if (this.def.flying) { // hover above the ground with a little bob, wings buzzing
      const t = performance.now() / 1000;
      drawModel3D(ctx, sx, sy - T * (0.15 + Math.sin(t * 5 + this.x) * 0.05), T, this.facing, this.def.model, this.def.look,
        Math.sin(t * 60), 0, this.def.size, null, opts);
      return;
    }
    const act = this.actionTime > 0 ? Math.sin((this.actionTime / 0.3) * Math.PI) : 0;
    drawModel3D(ctx, sx, sy, T, this.facing, this.def.model, this.def.look, this.swing, act, this.def.size, null, opts);
  }
}

// Spawns mobs in a ring around the player and despawns distant ones.
class MobSpawner {
  constructor(game) {
    this.game = game;
    this.timer = 2;
    this.maxMobs = 14;
    this.despawnDist = 48;
  }

  update(dt) {
    const g = this.game, p = g.player;
    for (const m of g.mobs) if (m.distTo(p) > this.despawnDist) m.dead = true;

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1.5;
    if (g.mobs.length >= this.maxMobs) return;

    const types = Object.keys(MOB_TYPES).filter((t) => MOB_TYPES[t].spawn); // bees only come from hives
    const total = types.reduce((s, t) => s + MOB_TYPES[t].spawn.weight, 0);
    let pick = Math.random() * total, type = types[0];
    for (const t of types) { pick -= MOB_TYPES[t].spawn.weight; if (pick <= 0) { type = t; break; } }
    const rule = MOB_TYPES[type].spawn;

    const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 14;
    const x = Math.floor(p.x + Math.cos(a) * d), y = Math.floor(p.y + Math.sin(a) * d);
    if (!g.world.hasChunk(x >> 4, y >> 4)) return;

    const z = this.findSpawnLayer(x, y, Object.assign({ height: MOB_TYPES[type].height }, rule), p.z);
    if (z == null || g.isOccupied(x, y, z, null)) return;
    g.mobs.push(new Mob(g, type, x + 0.5, y + 0.5, z));
  }

  findSpawnLayer(x, y, rule, nearZ) {
    const w = this.game.world, g = this.game;
    const ok = (z) => {
      if (z <= 0 || z >= WORLD_H) return false;
      const here = w.getBlock(x, y, z), below = w.getBlock(x, y, z - 1);
      if (BLOCKS[here].solid || BLOCKS[here].liquid || !BLOCKS[below].solid) return false;
      for (let k = 1; k < (rule.height || 1); k++) if (BLOCKS[w.getBlock(x, y, z + k)].solid) return false;
      if (rule.ground && !rule.ground.includes(below)) return false;
      const light = g.lightAt(x, y, z);
      if (rule.light === 'bright' && light < 0.6) return false;
      if (rule.light === 'dark' && light > 0.3) return false;
      return true;
    };
    if (rule.place === 'surface') {
      const z = w.topAt(x, y) + 1;
      return ok(z) ? z : null;
    }
    // 'dark': surface at night, or any dark pocket near the player's layer.
    const surface = w.topAt(x, y) + 1;
    if (ok(surface)) return surface;
    for (let z = Math.min(WORLD_H - 1, nearZ + 6); z >= Math.max(1, nearZ - 10); z--) {
      if (ok(z)) return z;
    }
    return null;
  }
}
