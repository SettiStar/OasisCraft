// Block and item registries.
// Block ids are 0-255 (stored in Uint8Array chunks). Non-block items use ids >= 256.
// A block is also an item with the same id.

const B = {
  AIR: 0, BEDROCK: 1, STONE: 2, DIRT: 3, GRASS: 4, SAND: 5, GRAVEL: 6, WATER: 7,
  OAK_LOG: 8, OAK_LEAVES: 9, PLANKS: 10, COBBLESTONE: 11,
  COAL_ORE: 12, IRON_ORE: 13, GOLD_ORE: 14, DIAMOND_ORE: 15,
  SNOW: 16, ICE: 17, CACTUS: 18, SANDSTONE: 19, CRAFTING_TABLE: 20, TORCH: 21, FURNACE: 22,
  TALL_GRASS: 23, FLOWER_RED: 24, FLOWER_YELLOW: 25, SPRUCE_LOG: 26, SPRUCE_LEAVES: 27,
  GLASS: 28, LAVA: 29, SNOWY_GRASS: 30, DEAD_BUSH: 31,
  // Doors are 2 blocks tall. NS doors sit in an east-west wall (you pass north/south);
  // EW doors sit in a north-south wall (you pass east/west).
  DOOR_NS: 32, DOOR_NS_TOP: 33, DOOR_EW: 34, DOOR_EW_TOP: 35,
  // Stairs: same as a full block for movement, drawn as steps rising toward n/e/s/w.
  OAK_STAIRS_N: 36, OAK_STAIRS_E: 37, OAK_STAIRS_S: 38, OAK_STAIRS_W: 39,
  COBBLE_STAIRS_N: 40, COBBLE_STAIRS_E: 41, COBBLE_STAIRS_S: 42, COBBLE_STAIRS_W: 43,
  CHEST: 44,
  BEEHIVE: 45, BEEHIVE_EMPTY: 46, // hive on an oak trunk; empty after its beeswax is taken
  LAMP: 47,
  // Torches on a block's side, named by the side the block is on (N = hangs on the block to its north).
  WALL_TORCH_N: 48, WALL_TORCH_E: 49, WALL_TORCH_S: 50, WALL_TORCH_W: 51,
  // 52-96: bars / fences / glass panes (PANELS, below)
  GUN_TOWER: 97, ELEVATOR: 98,
};

const STAIR_DIRS = ['n', 'e', 's', 'w'];
const DIR_STEP = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }; // compass direction -> (dx, dy)

// Tool tiers: 0 = hand, 1 = wood, 2 = stone, 3 = iron, 4 = diamond.
const BLOCKS = [];

function defBlock(id, name, props) {
  BLOCKS[id] = Object.assign({
    id, name,
    solid: true,        // collides with entities
    opaque: true,       // hides what is below / blocks sky light
    liquid: false,
    decoration: false,  // small thing sitting on top of a block (torch, flower, lamp); goes when its support does
    upright: false,     // drawn standing up on its tile (Tibia-style object) instead of flat
    obstacle: false,    // solid object (lamp): blocks the way, but nothing stands or is built on it
    wall: null,         // 'n' | 'e' | 's' | 'w': hangs on the block on that side (wall torches) instead of standing
    panel: null,        // 'bars' | 'fence' | 'glass': thin walls on the cell's edges (see PANELS)
    edges: 0,           // panels: which edges, as EDGE_BIT flags
    gravity: false,     // falls when unsupported (sand, gravel)
    hardness: 1,        // seconds-ish, Minecraft scale
    tool: null,         // 'pickaxe' | 'axe' | 'shovel' | null
    tier: 0,            // minimum tool tier needed to get a drop
    drop: id,           // item id, null, or function(rand) -> item id | null
    light: 0,           // light emission 0..15
    replaceable: false, // can be placed over (water, tall grass)
  }, props);
}

defBlock(B.AIR, 'Air', { solid: false, opaque: false, replaceable: true, drop: null, hardness: 0 });
defBlock(B.BEDROCK, 'Bedrock', { hardness: Infinity, drop: null });
defBlock(B.STONE, 'Stone', { hardness: 1.5, tool: 'pickaxe', tier: 1, drop: B.COBBLESTONE });
defBlock(B.DIRT, 'Dirt', { hardness: 0.5, tool: 'shovel' });
defBlock(B.GRASS, 'Grass Block', { hardness: 0.6, tool: 'shovel', drop: B.DIRT });
defBlock(B.SNOWY_GRASS, 'Snowy Grass', { hardness: 0.6, tool: 'shovel', drop: B.DIRT });
defBlock(B.SAND, 'Sand', { hardness: 0.5, tool: 'shovel', gravity: true });
defBlock(B.GRAVEL, 'Gravel', { hardness: 0.6, tool: 'shovel', gravity: true });
defBlock(B.WATER, 'Water', { solid: false, opaque: false, liquid: true, replaceable: true, hardness: Infinity, drop: null });
defBlock(B.LAVA, 'Lava', { solid: false, opaque: false, liquid: true, replaceable: true, hardness: Infinity, drop: null, light: 15 });
defBlock(B.OAK_LOG, 'Oak Log', { hardness: 2, tool: 'axe', log: true });
defBlock(B.SPRUCE_LOG, 'Spruce Log', { hardness: 2, tool: 'axe', log: true });
defBlock(B.OAK_LEAVES, 'Oak Leaves', { hardness: 0.2, leaves: true, drop: (r) => (r < 0.08 ? I.STICK : r < 0.12 ? I.APPLE : null) });
defBlock(B.SPRUCE_LEAVES, 'Spruce Leaves', { hardness: 0.2, leaves: true, drop: (r) => (r < 0.08 ? I.STICK : null) });
defBlock(B.PLANKS, 'Planks', { hardness: 2, tool: 'axe' });
defBlock(B.COBBLESTONE, 'Cobblestone', { hardness: 2, tool: 'pickaxe', tier: 1 });
defBlock(B.COAL_ORE, 'Coal Ore', { hardness: 3, tool: 'pickaxe', tier: 1, drop: () => I.COAL });
defBlock(B.IRON_ORE, 'Iron Ore', { hardness: 3, tool: 'pickaxe', tier: 2 });
defBlock(B.GOLD_ORE, 'Gold Ore', { hardness: 3, tool: 'pickaxe', tier: 3 });
defBlock(B.DIAMOND_ORE, 'Diamond Ore', { hardness: 3, tool: 'pickaxe', tier: 3, drop: () => I.DIAMOND });
defBlock(B.SNOW, 'Snow Block', { hardness: 0.2, tool: 'shovel' });
defBlock(B.ICE, 'Ice', { hardness: 0.5, tool: 'pickaxe', drop: null });
defBlock(B.CACTUS, 'Cactus', { hardness: 0.4 });
defBlock(B.SANDSTONE, 'Sandstone', { hardness: 0.8, tool: 'pickaxe', tier: 1 });
defBlock(B.CRAFTING_TABLE, 'Crafting Table', { hardness: 2.5, tool: 'axe' });
defBlock(B.FURNACE, 'Furnace', { hardness: 3.5, tool: 'pickaxe', tier: 1 });
defBlock(B.GLASS, 'Glass', { hardness: 0.3, opaque: false, drop: null });
defBlock(B.TORCH, 'Torch', { solid: false, opaque: false, decoration: true, upright: true, torch: true, hardness: 0, light: 14 });
STAIR_DIRS.forEach((wall, i) => {
  defBlock(B.WALL_TORCH_N + i, 'Torch', { solid: false, opaque: false, decoration: true, upright: true, torch: true, wall, hardness: 0, light: 14, drop: B.TORCH });
});
// Stands on any free top face, like a torch, but you can't walk through it.
defBlock(B.LAMP, 'Lamp', { opaque: false, decoration: true, upright: true, obstacle: true, hardness: 0.5, tool: 'pickaxe', light: 15 });
defBlock(B.TALL_GRASS, 'Tall Grass', { solid: false, opaque: false, decoration: true, replaceable: true, hardness: 0, drop: null });
defBlock(B.FLOWER_RED, 'Poppy', { solid: false, opaque: false, decoration: true, hardness: 0 });
defBlock(B.FLOWER_YELLOW, 'Dandelion', { solid: false, opaque: false, decoration: true, hardness: 0 });
defBlock(B.DEAD_BUSH, 'Dead Bush', { solid: false, opaque: false, decoration: true, replaceable: true, hardness: 0, drop: (r) => (r < 0.5 ? I.STICK : null) });

// Shoots arrows at hostile mobs nearby (Game.updateTurrets).
defBlock(B.GUN_TOWER, 'Gun Tower', { hardness: 3.5, tool: 'pickaxe', tier: 1, turret: true });
// Stand on one and press Space / Shift to ride to the next elevator straight up / down (Game.rideElevator).
defBlock(B.ELEVATOR, 'Elevator', { hardness: 0.8 });

// Chests hold 27 stacks (stored by position in game.chests); contents spill when broken.
defBlock(B.CHEST, 'Chest', { hardness: 2.5, tool: 'axe', container: 27 });

// Beehives: right-click with an axe for beeswax (bees may come out). Breaking one angers its bees.
defBlock(B.BEEHIVE, 'Beehive', { hardness: 0.6, tool: 'axe', drop: null, hive: true });
defBlock(B.BEEHIVE_EMPTY, 'Beehive (empty)', { hardness: 0.6, tool: 'axe', drop: null, hive: true });

// Doors drop their item from game.breakBlock (once for the pair).
defBlock(B.DOOR_NS, 'Oak Door', { hardness: 3, tool: 'axe', drop: null, door: 'ns', doorPart: 'lower' });
defBlock(B.DOOR_NS_TOP, 'Oak Door', { hardness: 3, tool: 'axe', drop: null, door: 'ns', doorPart: 'upper' });
defBlock(B.DOOR_EW, 'Oak Door', { hardness: 3, tool: 'axe', drop: null, door: 'ew', doorPart: 'lower' });
defBlock(B.DOOR_EW_TOP, 'Oak Door', { hardness: 3, tool: 'axe', drop: null, door: 'ew', doorPart: 'upper' });
STAIR_DIRS.forEach((dir, i) => {
  defBlock(B.OAK_STAIRS_N + i, 'Oak Stairs', { hardness: 2, tool: 'axe', stairs: dir, stairBase: B.PLANKS, drop: () => I.OAK_STAIRS });
  defBlock(B.COBBLE_STAIRS_N + i, 'Cobblestone Stairs', { hardness: 2, tool: 'pickaxe', tier: 1, stairs: dir, stairBase: B.COBBLESTONE, drop: () => I.COBBLE_STAIRS });
});

// ---------------------------------------------------------------------------
// Items

const I = {
  STICK: 256, COAL: 257, IRON_INGOT: 258, GOLD_INGOT: 259, DIAMOND: 260,
  RAW_PORK: 261, COOKED_PORK: 262, APPLE: 263, ROTTEN_FLESH: 264,
  DOOR: 265, OAK_STAIRS: 266, COBBLE_STAIRS: 267, LEATHER: 268, BACKPACK: 269,
  GREATER_BACKPACK: 270, BIGPACK: 271, PACK_CHASSIS: 272, BEESWAX: 273, IRON_BARS: 274, BONE: 275,
  FENCE: 276, GLASS_PANE: 277,
  WOOD_GREATAXE: 330,
};

const TOOL_TYPES = ['pickaxe', 'axe', 'shovel', 'sword'];
const TOOL_MATERIALS = [
  // tier, speed (mining multiplier), durability, sword damage
  { key: 'wood', name: 'Wooden', tier: 1, speed: 2, durability: 60, damage: 4, color: '#a8834f' },
  { key: 'stone', name: 'Stone', tier: 2, speed: 4, durability: 132, damage: 5, color: '#8a8a8a' },
  { key: 'iron', name: 'Iron', tier: 3, speed: 6, durability: 251, damage: 6, color: '#e6e6e6' },
  { key: 'diamond', name: 'Diamond', tier: 4, speed: 8, durability: 1562, damage: 7, color: '#4fe3d4' },
];

const ITEMS = {};

function defItem(id, name, props) {
  ITEMS[id] = Object.assign({ id, name, stack: 64 }, props);
}

defItem(I.STICK, 'Stick');
defItem(I.COAL, 'Coal');
defItem(I.IRON_INGOT, 'Iron Ingot');
defItem(I.GOLD_INGOT, 'Gold Ingot');
defItem(I.DIAMOND, 'Diamond');
// food = hunger points restored, sat = saturation gained (Minecraft values).
defItem(I.RAW_PORK, 'Raw Porkchop', { food: 3, sat: 1.8 });
defItem(I.COOKED_PORK, 'Cooked Porkchop', { food: 8, sat: 12.8 });
defItem(I.APPLE, 'Apple', { food: 4, sat: 2.4 });
defItem(I.ROTTEN_FLESH, 'Rotten Flesh', { food: 4, sat: 0.8 });
defItem(I.DOOR, 'Oak Door', { door: true });
defItem(I.LEATHER, 'Leather');
// Tibia-style backpacks in three tiers; each one keeps its own contents. Each tier is
// crafted from the one below (contents carry over).
defItem(I.BACKPACK, 'Backpack', { stack: 1, bag: 8 });
defItem(I.GREATER_BACKPACK, 'Greater Backpack', { stack: 1, bag: 16 });
defItem(I.BIGPACK, 'Bigpack', { stack: 1, bag: 24 });
defItem(I.PACK_CHASSIS, 'Pack Chassis', { stack: 16 });
defItem(I.BEESWAX, 'Beeswax');
defItem(I.IRON_BARS, 'Iron Bars', { panel: 'bars' });
defItem(I.FENCE, 'Oak Fence', { panel: 'fence' });
defItem(I.GLASS_PANE, 'Glass Pane', { panel: 'glass' });
defItem(I.BONE, 'Bone');
defItem(I.OAK_STAIRS, 'Oak Stairs', { stairs: B.OAK_STAIRS_N });
defItem(I.COBBLE_STAIRS, 'Cobblestone Stairs', { stairs: B.COBBLE_STAIRS_N });

// Tool ids: 300 + materialIndex * 4 + typeIndex
function toolId(materialKey, type) {
  const m = TOOL_MATERIALS.findIndex((t) => t.key === materialKey);
  return 300 + m * 4 + TOOL_TYPES.indexOf(type);
}

TOOL_MATERIALS.forEach((mat, mi) => {
  TOOL_TYPES.forEach((type, ti) => {
    const id = 300 + mi * 4 + ti;
    defItem(id, `${mat.name} ${type[0].toUpperCase()}${type.slice(1)}`, {
      stack: 1,
      tool: { type, tier: mat.tier, speed: mat.speed, durability: mat.durability, damage: type === 'sword' ? mat.damage : Math.max(2, mat.damage - 2) },
      material: mat,
    });
  });
});

// ---- equipment (Tibia-style slots) ----
// Slot order matches the Tibia panel, read left to right, top to bottom:
//   amulet  helmet  backpack / weapon  armor  shield / ring  legs  ammo / [Arm]  boots  [Cap]
const EQUIP_SLOTS = ['neck', 'head', 'back', 'hand', 'body', 'shield', 'ring', 'legs', 'ammo', 'feet'];
const EQUIP_NAMES = { neck: 'Amulet', head: 'Helmet', back: 'Backpack', hand: 'Weapon', body: 'Armor', shield: 'Shield', ring: 'Ring', legs: 'Legs', ammo: 'Ammo', feet: 'Boots' };

// Armor sets (Tibia-like Arm values). Model colours are used when armor is drawn on the player.
const ARMOR_SETS = {
  leather: { name: 'Leather', color: '#8a5a2a', pieces: { head: ['Leather Helmet', 1], body: ['Leather Armor', 4], legs: ['Leather Legs', 1], feet: ['Leather Boots', 1] } },
  chain: { name: 'Chain', color: '#8e939a', pieces: { head: ['Chain Helmet', 2], body: ['Chain Armor', 6], legs: ['Chain Legs', 3] } },
  steel: { name: 'Steel', color: '#b8c0c8', pieces: { head: ['Steel Helmet', 6], body: ['Plate Armor', 10], legs: ['Plate Legs', 7], feet: ['Steel Boots', 3] } },
  golden: { name: 'Golden', color: '#e8b828', pieces: { head: ['Golden Helmet', 12], body: ['Golden Armor', 14], legs: ['Golden Legs', 9], feet: ['Golden Boots', 4] } },
};
const ARMOR_IDS = {}; // ARMOR_IDS[set][slot] -> item id (400+)
{
  let id = 400;
  for (const [set, s] of Object.entries(ARMOR_SETS)) {
    ARMOR_IDS[set] = {};
    for (const slot of ['head', 'body', 'legs', 'feet']) {
      if (s.pieces[slot]) defItem(id, s.pieces[slot][0], { stack: 1, equip: slot, armor: s.pieces[slot][1], set, color: s.color });
      ARMOR_IDS[set][slot] = id++;
    }
  }
}
// Shields block a share of melee hits (Def / 100); rings and amulets are cosmetic for now.
I.WOODEN_SHIELD = 420; I.PLATE_SHIELD = 421; I.GOLD_RING = 422; I.BRONZE_AMULET = 423;
defItem(I.WOODEN_SHIELD, 'Wooden Shield', { stack: 1, equip: 'shield', defense: 14, color: '#9a6a30' });
defItem(I.PLATE_SHIELD, 'Plate Shield', { stack: 1, equip: 'shield', defense: 23, color: '#b8c0c8', metal: 'steel' });
defItem(I.GOLD_RING, 'Gold Ring', { stack: 1, equip: 'ring' });
defItem(I.BRONZE_AMULET, 'Bronze Amulet', { stack: 1, equip: 'neck' });

// Fells a whole tree in one hit (leaves then decay as usual).
defItem(I.WOOD_GREATAXE, 'Wooden Greataxe', {
  stack: 1,
  tool: { type: 'axe', tier: 1, speed: 2, durability: 90, damage: 5, fellsTrees: true },
  material: TOOL_MATERIALS[0],
  art: 'greataxe',
});

// ---- panels: iron bars, wooden fences, glass panes ----
// A panel stands on a cell's edge rather than filling it: the cell stays open, but nothing
// can cross that edge. Each covers a whole edge on its own (no connecting needed). A cell can
// hold several edges of one material (a corner, say), so there's one block id per material and
// set of edges (EDGE_BIT mask 1..15); players only ever handle the items.
const EDGE_BIT = { n: 1, e: 2, s: 4, w: 8 };
const OPPOSITE = { n: 's', e: 'w', s: 'n', w: 'e' };
const PANEL_BASE = 52;
const PANELS = {
  bars: { name: 'Iron Bars', item: I.IRON_BARS, hardness: 5, tool: 'pickaxe', tier: 1 },
  fence: { name: 'Oak Fence', item: I.FENCE, hardness: 2, tool: 'axe' },
  glass: { name: 'Glass Pane', item: I.GLASS_PANE, hardness: 0.3, drop: null }, // like glass, breaks into nothing
};
function panelId(kind, mask) { return PANEL_BASE + Object.keys(PANELS).indexOf(kind) * 15 + mask - 1; }
function edgeCount(mask) { let n = 0; for (; mask; mask &= mask - 1) n++; return n; }
Object.entries(PANELS).forEach(([kind, p]) => {
  for (let mask = 1; mask <= 15; mask++) {
    defBlock(panelId(kind, mask), p.name, {
      solid: false, opaque: false, decoration: true, upright: true, panel: kind, edges: mask,
      hardness: p.hardness, tool: p.tool || null, tier: p.tier || 0, drop: 'drop' in p ? p.drop : p.item,
    });
  }
});

// Unified lookup: blocks behave as stackable, placeable items.
function itemDef(id) {
  if (id < 256) {
    const b = BLOCKS[id];
    return b ? { id, name: b.name, stack: 64, placeable: true } : null;
  }
  return ITEMS[id] || null;
}

function itemName(id) {
  const d = itemDef(id);
  return d ? d.name : `#${id}`;
}
