// Inventories / containers (player 36 slots with 0-8 the hotbar, chests 27,
// backpacks 20) and crafting recipes.
// A stack is { id, count, dur?, bag? }: dur = tool durability left, bag = a
// backpack's own slot array (backpacks stack to 1, so each keeps its contents).

class Inventory {
  // `slots` (optional) wraps an existing slot array, e.g. a backpack's bag, so
  // changes go straight into it.
  constructor(size = 36, slots = null) {
    this.slots = slots || new Array(size).fill(null);
    this.version = 0; // bumped on every change so the UI knows to redraw
  }

  changed() { this.version++; Inventory.globalVersion++; }

  maxStack(id) {
    const d = itemDef(id);
    return d ? d.stack : 64;
  }

  // Returns how many could NOT be added.
  add(id, count = 1, dur) {
    const max = this.maxStack(id);
    if (max > 1) {
      for (const s of this.slots) {
        if (s && s.id === id && s.count < max) {
          const n = Math.min(count, max - s.count);
          s.count += n; count -= n;
          if (!count) break;
        }
      }
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(count, max);
        this.slots[i] = { id, count: n };
        const def = itemDef(id);
        if (def.tool) this.slots[i].dur = dur != null ? dur : def.tool.durability;
        if (def.bag) this.slots[i].bag = new Array(def.bag).fill(null); // a new, empty backpack
        count -= n;
      }
    }
    this.changed();
    return count;
  }

  // Add a whole stack object, keeping anything it carries (a backpack's contents).
  // Returns how many could NOT be added.
  addStack(stack) {
    if (!stack.bag) return this.add(stack.id, stack.count, stack.dur);
    const i = this.slots.indexOf(null);
    if (i < 0) return stack.count;
    this.slots[i] = stack;
    this.changed();
    return 0;
  }

  // Is there room for at least one of this item?
  canAdd(id) {
    const max = this.maxStack(id);
    return this.slots.some((s) => !s || (s.id === id && s.count < max));
  }

  countOf(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  // Removes `count` of an item (anywhere). Assumes caller checked countOf.
  consume(id, count) {
    for (let i = this.slots.length - 1; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const n = Math.min(count, s.count);
        s.count -= n; count -= n;
        if (!s.count) this.slots[i] = null;
      }
    }
    this.changed();
  }

  takeFromSlot(i, count = 1) {
    const s = this.slots[i];
    if (!s) return null;
    const n = Math.min(count, s.count);
    s.count -= n;
    const out = { id: s.id, count: n };
    if (s.dur != null) out.dur = s.dur;
    if (s.bag) out.bag = s.bag; // the backpack goes, with its contents
    if (!s.count) this.slots[i] = null;
    this.changed();
    return out;
  }
}

Inventory.globalVersion = 0; // bumped by any container change (the UI redraws on it)

// The Tibia-style equipment panel: 10 slots (see EQUIP_SLOTS), each taking only its kind.
class Equipment extends Inventory {
  constructor() { super(EQUIP_SLOTS.length); }

  static slotFor(id) {
    const d = itemDef(id);
    if (!d) return null;
    if (d.equip) return d.equip;
    if (d.bag) return 'back';
    if (d.tool) return 'hand';
    return null;
  }

  // Can `stack` go into slot i? (The ammo slot, like Tibia's, takes anything.)
  accepts(i, stack) {
    const slot = EQUIP_SLOTS[i];
    return slot === 'ammo' || Equipment.slotFor(stack.id) === slot;
  }

  get(slot) { return this.slots[EQUIP_SLOTS.indexOf(slot)]; }

  // Adding always goes to the item's own slot, and only if that slot is free.
  add(id, count = 1, dur) {
    const def = itemDef(id);
    const stack = { id, count };
    if (def && def.tool) stack.dur = dur != null ? dur : def.tool.durability;
    if (def && def.bag) stack.bag = new Array(def.bag).fill(null);
    return this.addStack(stack);
  }

  addStack(stack) {
    const i = EQUIP_SLOTS.indexOf(Equipment.slotFor(stack.id));
    if (i < 0 || this.slots[i]) return stack.count;
    this.slots[i] = stack;
    this.changed();
    return 0;
  }

  canAdd(id) { const i = EQUIP_SLOTS.indexOf(Equipment.slotFor(id)); return i >= 0 && !this.slots[i]; }

  // Total Arm from helmet, armor, legs and boots.
  get armor() {
    return ['head', 'body', 'legs', 'feet'].reduce((t, s) => { const it = this.get(s); return t + (it ? itemDef(it.id).armor || 0 : 0); }, 0);
  }
}

// Does backpack `stack` contain `slots` (its own bag, or any bag nested inside, at
// any depth)? Used to stop a backpack being put inside itself. Iterative, so
// nesting depth never matters.
function bagContains(stack, slots) {
  if (!stack || !stack.bag) return false;
  const todo = [stack], seen = new Set();
  while (todo.length) {
    const s = todo.pop();
    if (seen.has(s)) continue;
    seen.add(s);
    if (s.bag === slots) return true;
    for (const c of s.bag) if (c && c.bag) todo.push(c);
  }
  return false;
}

// Every backpack stack inside `slots`, at any depth (iterative).
function allBags(slots) {
  const out = new Set(), todo = [slots];
  while (todo.length) {
    for (const s of todo.pop()) if (s && s.bag && !out.has(s)) { out.add(s); todo.push(s.bag); }
  }
  return out;
}

// station: null (by hand), 'table' (crafting table nearby), 'furnace' (furnace nearby)
const RECIPES = [];
// `pattern` (optional) is the 3x3 crafting shape shown in the crafting list, e.g.
// ['PPP', 'PPS', '  S'] with `key` mapping letters to item ids. Ingredients are
// still taken by count; the pattern is how the recipe is presented.
function recipe(outId, outCount, inputs, station = null, pattern = null, key = null) {
  RECIPES.push({ out: { id: outId, count: outCount }, inputs: inputs.map(([id, count]) => ({ id, count })), station, pattern, key });
}

recipe(B.PLANKS, 4, [[B.OAK_LOG, 1]]);
recipe(B.PLANKS, 4, [[B.SPRUCE_LOG, 1]]);
recipe(I.STICK, 4, [[B.PLANKS, 2]]);
recipe(B.CRAFTING_TABLE, 1, [[B.PLANKS, 4]]);
recipe(B.TORCH, 4, [[I.COAL, 1], [I.STICK, 1]]);
recipe(B.LAMP, 1, [[I.IRON_INGOT, 1], [B.TORCH, 1]], 'table');
recipe(B.FURNACE, 1, [[B.COBBLESTONE, 8]], 'table');
recipe(B.SANDSTONE, 1, [[B.SAND, 4]], 'table');
recipe(I.DOOR, 3, [[B.PLANKS, 6]], 'table');
recipe(B.CHEST, 1, [[B.PLANKS, 8]], 'table');
// Backpack tiers. n = the basic backpack's leather; each tier needs the one below,
// and its contents move into the new backpack.
const BACKPACK_LEATHER = 6;
recipe(I.BACKPACK, 1, [[I.LEATHER, BACKPACK_LEATHER], [I.STICK, 1]], 'table');
recipe(I.GREATER_BACKPACK, 1, [[I.BACKPACK, 1], [I.LEATHER, 4 * BACKPACK_LEATHER]], 'table');
recipe(I.BIGPACK, 1, [[I.GREATER_BACKPACK, 1], [I.LEATHER, 8 * BACKPACK_LEATHER], [I.PACK_CHASSIS, 1], [I.BEESWAX, 1]], 'table');
recipe(I.PACK_CHASSIS, 1, [[I.IRON_BARS, 8], [I.IRON_INGOT, 2], [I.BONE, 8]], 'table');
recipe(I.IRON_BARS, 16, [[I.IRON_INGOT, 6]], 'table');
recipe(I.FENCE, 3, [[B.PLANKS, 4], [I.STICK, 2]], 'table');
recipe(I.GLASS_PANE, 16, [[B.GLASS, 6]], 'table');
recipe(B.GUN_TOWER, 1, [[B.COBBLESTONE, 6], [I.IRON_INGOT, 2], [I.STICK, 4]], 'table');
recipe(B.ELEVATOR, 1, [[B.PLANKS, 8], [I.IRON_INGOT, 1]], 'table');
RECIPES.find((r) => r.out.id === I.GREATER_BACKPACK).upgrade = I.BACKPACK;
RECIPES.find((r) => r.out.id === I.BIGPACK).upgrade = I.GREATER_BACKPACK;
recipe(I.OAK_STAIRS, 4, [[B.PLANKS, 6]], 'table');
recipe(I.COBBLE_STAIRS, 4, [[B.COBBLESTONE, 6]], 'table');
recipe(I.WOOD_GREATAXE, 1, [[B.PLANKS, 5], [I.STICK, 2]], 'table', ['PPP', 'PPS', '  S'], { P: B.PLANKS, S: I.STICK });

const TOOL_HEADS = { wood: B.PLANKS, stone: B.COBBLESTONE, iron: I.IRON_INGOT, diamond: I.DIAMOND };
for (const mat of TOOL_MATERIALS) {
  const head = TOOL_HEADS[mat.key];
  recipe(toolId(mat.key, 'pickaxe'), 1, [[head, 3], [I.STICK, 2]], 'table');
  recipe(toolId(mat.key, 'axe'), 1, [[head, 3], [I.STICK, 2]], 'table');
  recipe(toolId(mat.key, 'shovel'), 1, [[head, 1], [I.STICK, 2]], 'table');
  recipe(toolId(mat.key, 'sword'), 1, [[head, 2], [I.STICK, 1]], 'table');
}

// Armor: leather / iron bars (chain) / iron ingots (steel) / gold ingots, Minecraft piece counts.
{
  const mats = { leather: I.LEATHER, chain: I.IRON_BARS, steel: I.IRON_INGOT, golden: I.GOLD_INGOT };
  const counts = { head: 5, body: 8, legs: 7, feet: 4 };
  for (const [set, matId] of Object.entries(mats)) {
    for (const slot of ['head', 'body', 'legs', 'feet']) {
      if (ITEMS[ARMOR_IDS[set][slot]]) recipe(ARMOR_IDS[set][slot], 1, [[matId, counts[slot]]], 'table');
    }
  }
}
recipe(I.WOODEN_SHIELD, 1, [[B.PLANKS, 6]], 'table');
recipe(I.PLATE_SHIELD, 1, [[I.IRON_INGOT, 6], [B.PLANKS, 1]], 'table');
recipe(I.GOLD_RING, 1, [[I.GOLD_INGOT, 2]], 'table');
recipe(I.BRONZE_AMULET, 1, [[I.GOLD_INGOT, 1], [I.STICK, 2]], 'table');

// Smelting (simplified: no fuel needed yet, just a furnace nearby).
recipe(I.IRON_INGOT, 1, [[B.IRON_ORE, 1]], 'furnace');
recipe(I.GOLD_INGOT, 1, [[B.GOLD_ORE, 1]], 'furnace');
recipe(B.GLASS, 1, [[B.SAND, 1]], 'furnace');
recipe(B.STONE, 1, [[B.COBBLESTONE, 1]], 'furnace');
recipe(I.COOKED_PORK, 1, [[I.RAW_PORK, 1]], 'furnace');
recipe(I.COAL, 1, [[B.OAK_LOG, 1]], 'furnace'); // charcoal stand-in

const STATION_BLOCK = { table: B.CRAFTING_TABLE, furnace: B.FURNACE };
const STATION_NAME = { table: 'Crafting Table', furnace: 'Furnace' };

function canCraft(inv, r, stations) {
  if (r.station && !stations[r.station]) return false;
  return r.inputs.every((inp) => inv.countOf(inp.id) >= inp.count);
}

function craft(inv, r) {
  if (r.upgrade) {
    // Backpack upgrade: take one lower-tier backpack and move its contents into the new one.
    const i = inv.slots.findIndex((s) => s && s.id === r.upgrade);
    const old = inv.slots[i];
    inv.slots[i] = null;
    for (const inp of r.inputs) if (inp.id !== r.upgrade) inv.consume(inp.id, inp.count);
    const items = old.bag.filter(Boolean);
    const bag = new Array(Math.max(itemDef(r.out.id).bag, items.length)).fill(null); // never lose items
    items.forEach((s, k) => { bag[k] = s; });
    inv.changed();
    return inv.addStack({ id: r.out.id, count: 1, bag });
  }
  for (const inp of r.inputs) inv.consume(inp.id, inp.count);
  return inv.add(r.out.id, r.out.count);
}
