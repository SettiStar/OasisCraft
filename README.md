# OasisCraft

A top-down 2D game with Minecraft mechanics, drawn at Tibia's camera angle.
Plain HTML5 Canvas + JavaScript with no build step and no dependencies.

**Run it:** double-click `index.html`. Add `?seed=yourseed` to the URL to choose a world seed.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move tile by tile, Tibia-style (hold to keep walking). Walk into a 1-block ledge to climb it; walk off edges to fall. |
| Left click (hold) | Mine a block, bare-handed or with a tool (cracks show progress); attack an adjacent mob |
| Right click | Place a block, use a crafting table or furnace, eat food |
| Right click on your own tile | Pillar up (place a block under yourself) |
| Alt + click | Target the clicked column at your own layer |
| 1–9 / mouse wheel | Select hotbar slot |
| E | Inventory and crafting |
| Q / Ctrl+Q | Drop one / drop the stack |
| PgUp / PgDn or `]` / `[` | Move the view layer up or down |
| V / Home | Reset the view to the player's layer |
| C | Cycle cut-off mode: auto, always, off |
| M | Mirrored view: look from the opposite side (the map turns 180°; WASD follows the screen) |
| R | Turn the placement rotation 90° clockwise (stairs, doors, bars / fences / panes) |
| Space / Shift | Swim up / dive. Standing on an elevator: ride up / down |
| Ctrl + / Ctrl − / Ctrl+wheel | Zoom (uses browser zoom: zoom out to see more of the world; the HUD stays the same size) |
| Esc | Pause menu: Settings (saved in the browser), Controls, Skin editor |
| H | Toggle help |
| F3 / F8 | Debug info / cycle weather. Only with `devTools` on in `config.js` |

## World and gameplay notes

- **The player is 2 blocks tall** (feet + head), and so are zombies.
  - Walking needs 2 free cells, and climbing a 1-block ledge needs room above your head.
  - Tunnelling means mining 2 blocks per step.
  - You can't place a block in your head space. Placing one under your feet pillars you up.
  - Breath and suffocation are checked at your head.
  - When you're under a roof, the cut-off sits at head height, so tunnel walls show a feet strip and a head strip you can mine separately.
- **Leaves don't block movement.** You can walk through foliage and still stand on top of it. Leaves near you are hidden from view, so they must never act as invisible walls.
- **Height cues** (Settings → Height cues):
  - Each top face has an edge where the ground drops away behind it: a thin dark line for a 1-block step, a heavy one for a 2+ drop (too high to climb).
  - Wall faces show one band per block, so you can count a wall's height.
  - Floors get soft contact shadows at the foot of higher blocks.
- **Climb hint:** when you can't see the sky (underground or under a roof), blocks you can step up onto right now get a light blue highlight. Settings → Blue highlight.
- **Caves** are never shorter than 3 blocks (`MIN_CAVE_HEIGHT`), so with a 2-tall player there's always room to walk and to step up.
- **Zombies:**
  - They walk toward you when you're within 7 tiles (`CHASE_RANGE` in `mobs.js`).
  - When next to you, they hit for 3, but only with a clear line of sight. Any solid block in between stops them; leaves don't.
  - In daylight under open sky they catch fire and take 1 damage per second. Shade, water or rain puts them out.
- **Mob visibility:**
  - Mobs 2 or more layers below you aren't drawn (`MOB_BELOW_LIMIT` in `renderer.js`).
  - A mob hidden behind a block gets a faint red outline drawn over that block.
- **Placement direction:** stairs, doors and panels face by your line of sight to the tile you click, turned by the placement rotation (R, shown in the layer panel).
- **Doors** (6 planks → 3 at a crafting table) are 2 blocks tall and don't open. Right-click one to step through to the tile just behind it. Mobs can't use them. Looking north/south sets one in an east-west wall, east/west in a north-south wall.
- **Stairs** (6 planks or 6 cobblestone → 4 at a crafting table) act like a full block for movement but are drawn as steps. They rise away from you.
- **Torches** (coal + stick → 4) can go on any top or side face. Standing torches sit in the middle of the tile; wall torches lean out at 45°. They're 3D, with a flickering flame and glow, and you can walk through them. A torch in your hand lights your surroundings too.
- **Lamps** (iron ingot + torch at a crafting table) stand on any free top face and give the brightest light (15). You can't walk through, stand on or build on them.
- **Bars, fences and glass panes** stand on a tile's edge, not its middle, and each covers the whole edge. The rest of the tile stays walkable, but nobody can cross that edge, and zombies can't hit through it.
  - A panel goes on the edge of the clicked tile that faces you (turned by R); a white bar previews it. Click a panel to stack another on top.
  - A tile can hold several edges of the same material (corners). Mining a corner takes off only the edge you hit.
  - They need a block under either side of their edge, or a panel below on the same edge, and drop when that goes.
  - Recipes (crafting table): iron bars 6 iron ingots → 16; oak fence 4 planks + 2 sticks → 3; glass pane 6 glass → 16. Panes break into nothing, like glass.
- **Gun tower** (6 cobblestone + 2 iron ingots + 4 sticks): every second it shoots an arrow at the nearest hostile mob within 8 tiles, at any height. Arrows home in and fly over everything; kills drop loot. Towers fire while you're within about 20 tiles.
- **Elevators** (8 planks + 1 iron ingot), like OpenBlocks': stand on one and press Space to ride to the next elevator straight up (within 20 layers, through anything in between) or Shift to ride down. Elevators without 2 free blocks above are skipped. While you hold one, a spot turns green if an elevator placed there would line up with another above or below.
- **Held tools and weapons** are 3D models gripped in the hand and swung with the arm. Worn metal armor shines.
- **Wooden Greataxe:**
  - Crafted at a table from planks in the shape `PPP / PPS / _ _S` (P = plank, S = stick).
  - One hit on a tree fells every log in it, and the leaves then decay normally.
  - Logs that don't touch any leaves (like a log wall) are mined normally instead.
- **Chests** (8 planks at a crafting table) hold 27 stacks. Right-click one to open it above your inventory and shift-click to move items between them. Breaking a chest spills its contents. Contents are saved with the world.
- **Backpacks** work like Tibia's and come in three tiers. All recipes are at a crafting table:

  | Tier | Slots | Recipe (n = 6 leather) |
  | --- | --- | --- |
  | Backpack | 8 | n leather + 1 stick |
  | Greater Backpack | 16 | Backpack + 4n leather |
  | Bigpack | 24 | Greater Backpack + 8n leather + Pack Chassis + Beeswax |

  - Upgrading moves the old backpack's contents into the new one.
  - **Pack Chassis** = 8 iron bars + 2 iron ingots + 8 bones. Iron bars: 6 iron ingots → 16. Bones come from zombies; leather from pigs.
  - New worlds start you wearing a Backpack (in the equipment's backpack slot).
  - Backpacks from older saves keep any extra slots that hold items, so nothing is lost.
  - Right-click a backpack, held or in any slot, to open it in a Tibia-style window docked on the right. Windows have minimise (–) and close (×) buttons and stay usable while you play.
  - Click to pick up and put down items, and shift-click to move them between your inventory and the open container. The hotbar can be clicked too while the equipment panel or any window is open. Clicking the world while holding an item throws it.
  - Backpacks can go inside backpacks to any depth (tested 500 deep, including saving), but never inside themselves.
  - A backpack keeps its contents when dropped, picked up or stored. Its window closes if it leaves your inventory.
- **Backpack window layout** (Settings): vertical (narrow windows docked on the right, under the equipment panel) or horizontal (wide windows, 8 slots per row, along the bottom).
- **Equipment** is a Tibia-style panel, always on the right, with the slots laid out like Tibia's:

  |  |  |  |
  | --- | --- | --- |
  | Amulet | Helmet | Backpack |
  | Weapon | Armor | Shield |
  | Ring | Legs | Ammo |
  | *Arm* | Boots | *Cap* |

  - **Putting things on:** drag items onto their slots, shift-click armor in the inventory, or right-click armor in your hand. Each slot only takes its own kind of item. The ammo slot takes anything, like Tibia's.
  - **Empty slots** show a faint silhouette of what goes there. Hover over one for its name.
  - **Arm** is your total armor. **Cap** is free space: empty inventory slots plus empty slots in your worn backpack.
  - **Conditions bar:** under the slots, icons show when you're poisoned, drowning (head underwater), hungry or in creative mode.
  - **Armor** (helmet, armor, legs, boots) reduces damage from creatures by Arm ÷ (Arm + 25). Leftover fractions round at random, so small hits sometimes do nothing at all (yellow sparks). Like Tibia, armor does nothing against falls, lava, drowning, hunger or poison.
  - **Shields** block a whole hit from a creature (grey puff) with a chance equal to their Def. A blocked bee doesn't sting you or die.
  - **Weapon slot:** your attack uses whichever is stronger, the weapon equipped here or the tool in your hand. Whichever one is used takes the wear.
  - **Backpack slot:** right-click the worn backpack to open it. Items you pick up go there when your inventory is full.
  - **Amulet and ring:** cosmetic for now.
  - **On your character:** worn helmet, armor, legs, boots and shield are drawn on your character over your skin. The helmet leaves the face open, the armor adds shoulder pads, and the shield is on the left arm. Tibia itself never shows equipment (outfits are separate), so you can turn this off in Settings for the pure Tibia look.
  - All armor is made at a crafting table, with Minecraft piece counts (helmet 5, armor 8, legs 7, boots 4):

    | Set | Material | Helmet | Armor | Legs | Boots | Full set |
    | --- | --- | --- | --- | --- | --- | --- |
    | Leather | leather | 1 | 4 | 1 | 1 | 7 (22% less damage) |
    | Chain | iron bars | 2 | 6 | 3 | – | 11 (31%) |
    | Steel / Plate | iron ingots | 6 | 10 | 7 | 3 | 26 (51%) |
    | Golden | gold ingots | 12 | 14 | 9 | 4 | 39 (61%) |

  - **Shields:** Wooden Shield, Def 14 (6 planks); Plate Shield, Def 23 (6 iron ingots + 1 plank).
  - **Jewellery:** Gold Ring (2 gold ingots); Bronze Amulet (1 gold ingot + 2 sticks).
- **Beehives** grow on about 1 in 20 oak trees.
  - Right-click one with any axe to collect beeswax. 0–3 bees may fly out (35% none, 30% one, 23% two, 12% three).
  - Bees fly straight at you over obstacles. A sting does half a heart plus 3 seconds of poison, and the bee dies.
  - Poison does 1 damage every 1.25 s, can't kill you, and doesn't stack: a new sting just resets the timer. Your hearts turn green while poisoned.
  - An emptied hive refills after 5 minutes. Breaking a full hive also releases its bees.
- **Creative mode** is off for players: it only appears in Settings with `creative: true` in `config.js` (see Build switches). It works like Minecraft's: no damage or hunger, instant mining with no drops, unlimited placing, and flying (Space up, Shift down, no gravity). Mobs and bees ignore you.
  - The **Creative** button in the equipment panel's title bar opens a window of every item, with search.
  - Click to take a stack, right-click to take one, and shift-click to send it straight to your inventory.
  - Clicking the window while holding something deletes it.
- **Tooltips:** hover over any item in your inventory, a chest, a backpack window or the crafting list to see its name in large text, plus details like durability, how full a backpack is, food value or the amount a recipe needs.
- **Hunger** works like Minecraft's: 10 drumsticks (food 0–20) plus a gold saturation bar.
  - Walking, climbing, swimming, mining, fighting, taking damage and healing all use energy. Saturation drains first, then food.
  - At food 18 or more you heal; at 0 you starve, down to half a heart.
  - Eat by right-clicking food. Values: apple 4, raw pork 3, cooked pork 8, rotten flesh 4.
- **Skins** (Esc → Settings → Skin editor):
  - Pick one of 8 presets, or use Random preset.
  - Paste a NovaSkin link (`minecraft.novaskin.me/post/<id>/…` or `novask.in/<id>`) or any direct skin PNG link.
  - Or upload a skin PNG.
  - Standard 64×64, legacy 64×32 and HD skins all work, including hat and overlay layers. Slim arms are detected when the image can be inspected.

- **Reach:** blocks up to 4 layers above or below you, within 4.5 tiles.
- **Item pickup:** items within 2 tiles (and up to 2 layers up or down) fly to you. Items fall through leaves.
- **Cave entrances:** about 1 in 5 chunks has a walkable entrance. It's a 3-wide ramp that drops one layer per tile, starts as an open trench and becomes a tunnel, and is ringed with exposed stone and gravel (`ENTRANCE_CHANCE` in `worldgen.js`).
- **Weather:** every 10 minutes there's a 20% chance of an event lasting 2–6 minutes (`WEATHER_*` in `game.js`).
  - Cloudy events dim the light and add drifting cloud shadows.
  - Storms show as rain, as snow in cold biomes (snow never places blocks), and as just clouds in deserts.
  - Precipitation is hidden when you're underground or under a roof.
- **Clock:** the top-centre bar shows the day, the in-game time (each day starts at 06:00) and the weather.
- **Entity draw range:** creatures and items are only drawn within 12 tiles (`ENTITY_RANGE`), however far you zoom out.

## How layers work

- The world is 3D voxels: chunks are 16×16 columns, `WORLD_H` = 96 layers, and sea level is 48.
- An entity on layer `z` stands on block `z-1`.
- The **view layer** `V` is normally the player's layer. You can move it from −8 to +4 to inspect other layers.
- The **cut-off** works like Tibia's roof hiding. When something opaque is above you (a cave, roof or tree), every layer above `V` is hidden. Outdoors, `SHOW_ABOVE` layers above `V` are drawn.
- Rock that the cut plane slices through is drawn black, so caves read clearly.
- **Trees:** tree canopy doesn't count as a roof. Leaves within `LEAF_CLEAR_R` tiles of you are hidden so trunks stay visible. When a log is removed, leaves more than `LEAF_REACH` steps from any log decay one by one over a few seconds.
- **Projection:** a block `E` layers above the floor is shifted `E * ELEV` tiles up and to the left, exposing its south and east faces (Tibia's angle). Layers below the floor shift down and to the right.

## Build switches (`config.js`)

`config.js` in the repo root turns features on for a build. Players can't change these from inside the game, and a saved setting can't override a switch that's off.

| Switch | Default | What it enables |
| --- | --- | --- |
| `creative` | `false` | The Creative mode option in Settings, the Creative button and item window |
| `devTools` | `false` | The F3 debug overlay (and its Settings option) and F8 weather cycling |

The automated tests switch both on for themselves.

## Code map (`js/`)

| File | Contents |
| --- | --- |
| `../config.js` | Build switches (above) |
| `settings.js` | Saved settings (localStorage) |
| `noise.js` | Seeded PRNG, hashing, 2D/3D simplex noise |
| `blocks.js` | Block and item registries (`B`, `I`, `BLOCKS`, `ITEMS`), tools |
| `textures.js` | Procedural 16×16 textures and item icons |
| `worldgen.js` | Terrain, biomes, caves, lava, ores, trees, decorations |
| `world.js` | Chunk storage, heightmap (sky light), light sources |
| `inventory.js` | Inventory, Tibia-style `Equipment` (slot rules, total Arm) and crafting recipes (`station`: table / furnace) |
| `skins.js` | Minecraft skin UV layout, the 8 painted presets, loading from links or files |
| `models.js` | Upright 3/4-view box models (skinned player, humanoid, quadruped) with joints |
| `entities.js` | `Entity` (grid steps, step-up, falling, swimming, damage), `Player`, `ItemDrop` |
| `mobs.js` | `BEHAVIORS` (pluggable AI), `MOB_TYPES` (data), `Mob`, `MobSpawner` |
| `renderer.js` | Tibia-style renderer, cut-off, lighting, mouse picking |
| `ui.js` | HUD, layer panel, inventory and crafting screens |
| `game.js` | Main loop, interaction (mine/place/attack), lighting, day/night |

### Adding mob behavior

Add an entry to `BEHAVIORS` in `mobs.js`:

```js
myBehavior: {
  init(mob) {},
  update(mob, game, dt) {},
  onHurt(mob, attacker, game) {},
}
```

Then set `behavior: 'myBehavior'` on a type in `MOB_TYPES`.

- `update()` is only called while the mob is standing on a tile.
- Mobs move one tile at a time with `mob.stepTo(dx, dy)`, which handles collision, climbing ledges and tiles occupied by other creatures.
- `mob.face(dx, dy)` turns a mob without moving it.
- Physics (falling, liquids) runs automatically.

## Testing

`powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1` runs the automated tests in headless Chrome. They take a few seconds and print one `PASS`/`FAIL` line per test.
- **Scope:** movement rules, worldgen caves, pickup, rendering (including the mirrored view), torches and lamps, panels, placement rotation, elevators, gun towers, held 3D tools and torch light, mobs, hives and poison, the greataxe, backpacks (tiers, nesting 500 deep, old saves), chests, doors, tooltips, hunger, creative, the `config.js` switches, equipment and combat, save round trips, and security (blocked code sinks, tampered settings, saves and skins).
- **Options:** add `-Only "equip,bags"` to run some tests, or `-Shot` for a screenshot.
- **Same security policy as the game:** the test page is built from `index.html` with the same CSP, so a passing run also proves the game works under it.
- **Safe for your saves:** it uses a throwaway browser profile, so your own worlds and settings aren't touched.
- **Hosting:** the `tests/` folder isn't needed when you host the game. To embed it in another site, see `INTEGRATION.md`.

## Saving

Worlds are saved in the browser (IndexedDB) and stay small:

- **Only chunks you changed are stored**, run-length compressed. Untouched terrain regenerates from the seed. In testing, 3 edited chunks took 7.8 KB instead of 72 KB.
- **Also saved:** a small record with your position, inventory, equipment, chest contents, health, hunger, time of day and weather. Items are stored as one flat table, where each backpack lists its contents by index, so nesting depth doesn't matter. Mobs and dropped items aren't saved.
- **When it saves:** every 30 seconds (only if something changed), when the tab is hidden or closed, and with Esc → Worlds → Save now.
- **Which world opens:** `?seed=X` opens or creates that world. Otherwise the last world played is resumed.
- **Esc → Worlds** lists saved worlds with their sizes, and lets you play, delete (click twice) or start a new world.
- **If saving isn't possible:** when browser storage is unavailable or hangs, the game starts anyway and says progress won't be kept.
- **Saves are untrusted:** like settings, every loaded value is validated before use. For example, an item that doesn't belong in an equipment slot is moved to the inventory.

No server is involved. Hosting the game is serving about 360 KB of static files; everything else runs and is stored on each player's own device.

## Security

The game is entirely client-side. It has no server, sends no network requests, and loads no remote scripts.

- **Content-Security-Policy** (in `index.html`): only the game's own files (`config.js`, `js/`, `css/`) can run. Inline scripts, inline event handlers, `eval`, plugins, frames, workers and network connections are all blocked by the browser. Images may come from `data:` (generated icons, uploaded skins) and http(s) (skin links). This is verified to be enforced when the page is opened as a local file.
- **Trusted Types** (also in the CSP): the browser refuses to turn any string into HTML or script. `innerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, string timers and script URLs all throw, so even a future bug can't make text run as code. This is enforced in Chromium browsers (Chrome, Edge). Elsewhere the rest of the CSP still applies, and the code has no HTML-string sinks anyway.
- **No HTML from strings at all:** the UI is built with DOM calls (the `h()` helper in `ui.js`), where strings only ever become text. The seed, skin links, file names, world list and messages are always plain text.
- **Skins** are only ever loaded as images. Links must be http(s) (NovaSkin links are matched on the exact domain and a letters-and-digits id). Uploads must be real PNG data (checked by the file signature, not just the extension, ≤ 2 MB). Images must be valid skin sizes (≤ 1024 px wide), and the size is checked before the image is drawn.
- **Saved worlds** (IndexedDB) are validated on load. Item ids, counts, durability, nesting, chest and hive keys, equipment slots, player values and every compressed chunk are checked. Unknown blocks or corrupt chunks are regenerated from the seed. The worlds list only shows stored sizes and dates that are real numbers.
- **Saved settings** (localStorage) are treated as untrusted. Only known keys with valid types and values are used; anything else is ignored, including `__proto__` tricks.
- **No referrer:** skin links are fetched without a referrer.

Why storage is treated as untrusted: other pages on the same origin can read and write it. When opened as a local file, that means other local HTML files. When hosted on a shared domain, it means other sites on that domain (for example `username.github.io`).

**If you host it**, also send these as HTTP headers. They can't be set from inside the page:
- `Content-Security-Policy: frame-ancestors 'none'` (or `X-Frame-Options: DENY`) stops other sites from framing the game to trick clicks, for example on "Delete world". Leave it off if you embed the game somewhere like itch.io, which runs games in a frame.
- `X-Content-Type-Options: nosniff`.
- The same CSP as the meta tag, as a header.
- Don't host it on an origin where other people can upload files. `script-src 'self'` trusts every script on the same origin.

Players can always change their own copy of a purely client-side game, for example with browser DevTools. That only affects their own game. The protections above stop *untrusted input* (links, files, URLs, saved data) from running code. If the game ever gets multiplayer, the server must be the authority.

## Simplifications and TODO

- Water and lava are animated but don't spread or flow into new blocks.
- Smelting needs no fuel.
- Mob AI: pigs wander; zombies chase, attack with line of sight, and burn in daylight.
- The crafting list takes ingredients by count. Shaped recipes (the greataxe) display their 3×3 pattern but don't need a grid.
- The layer-view feature is still to be designed in detail.
- Equipment: amulets and rings have no effects yet, the ammo slot has no ranged weapons to feed, and Cap counts free slots rather than weight.
