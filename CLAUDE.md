# OasisCraft: notes for Claude

Top-down 2D game: Minecraft mechanics and world generation, Tibia's camera angle (oblique, 15×11 tiles) and Tibia-style UI. Vanilla JS + Canvas, no build step. Open `index.html` directly (file://) or serve the folder statically. The README has the feature list, controls and a code map; read the relevant section instead of exploring.

The repo is github.com/SettiStar/OasisCraft (private). It gets embedded in the user's CultOasis site by another Claude instance, following `INTEGRATION.md`; keep that file current when anything it describes changes (shipped files, storage keys, switches, headers).

## Hard rules
- **Classic `<script>` tags, no modules, no dependencies, no network.** Script order is in `index.html`; globals are shared across files.
- **Build switches in `config.js`** (`OASIS_CONFIG`): `creative` (Creative mode) and `devTools` (F3 debug, F8 weather) are `false` for players and can only be turned on by editing that file. Put any new testing or debug feature behind `devTools`. A gated setting is listed in `Settings`' `SWITCH` map; gated HTML gets the class `dev-only` / `creative-only` (removed at start-up). `tests/tests.js` switches both on.
- **Security (user requirement: players must never be able to run their own code).** The CSP in `index.html` has `script-src 'self'` and Trusted Types (`require-trusted-types-for 'script'; trusted-types 'none'`), so:
  - Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, string timers, inline handlers or inline `style=""` in HTML. Build DOM with `h()` and `slotParts()` in `ui.js` (strings become text only). Setting `el.style.x` from JS is fine.
  - Treat everything loaded as untrusted: settings (localStorage), saved worlds (IndexedDB), skin links and uploads, `?seed=`. Validate types and ranges like `Settings.validate`, `Game.restore` and `Game.unpackStack` do.
- **Coordinates:** z is the layer and an entity on layer z stands on block z−1. `CHUNK` = 16, `WORLD_H` = 96, `SEA_LEVEL` = 48. The player is 2 tall. Ask before changing the projection or coordinate model.
- **Mirrored view (M, setting `mirrorView`):** the renderer draws in view space (map turned 180°; see the top of `renderer.js`). Convert world coordinates with `vt`/`vp`/`viewDir` there. Picks always carry world x, y, and their `face` can be `north`/`west`. WASD follows the screen.

## Where to extend
- **Blocks and items:** `blocks.js` (`B`, `I`, `defBlock`, `defItem`, `TOOL_MATERIALS`, `ARMOR_SETS`, `EQUIP_SLOTS`). Item icons are pixel art in `textures.js` (`ITEM_ART`, `EQUIP_ART`). Objects standing on a tile (torch, lamp) are `decoration` + `upright` blocks: the lamp is drawn from `DECO_ART` (with a `glow` pixel), torches as a 3D model (`MODEL_DEFS.torch`, `Renderer.drawTorch`). `obstacle` makes one solid but never stood or built on. Wall torches are separate block ids with `wall: 'n'|'e'|'s'|'w'` (the side their block is on); `Game.dropUnsupported` drops anything that loses its support. Panels (iron bars, fences, glass panes; `PANELS`) stand on cell edges: one block id per material and edge mask (`panelId`). The cell stays walkable, but `World.crossable` blocks crossing a closed edge (movement and `lineOfSight`). The renderer draws each tile's north and west edges before the tile (`drawEdgePanels`). Directional placement (panels, stairs, doors) uses `Game.lookDir` (player to target) turned by `Game.rotation` (R). Gun towers are `turret` blocks indexed per chunk like lights (`World.forEachTurret`); `Game.updateTurrets` / `updateProjectiles` fire homing arrows.
- **Recipes:** `inventory.js` via `recipe(...)`. `Inventory` and `Equipment` (slot rules, total Arm) live there too.
- **Mobs:** `mobs.js`. `BEHAVIORS` holds the pluggable AI and `MOB_TYPES` the data.
- **Player:** `entities.js`. Armor, shield blocking, poison and hunger are in `Player.damage` and its helpers.
- **Player model:** `models.js`. Armor is drawn as extra boxes in `armorBody` and `armorArm`; a box's `metal` kind (`METAL_KINDS`) gives it the shiny texture and highlight. Armor that wraps all round a limb, body or head gets that box's `part` and a higher `layer`, so they sort as one unit (otherwise swinging limbs poke through); one-sided plates (helmet sides, shield) sort alone. Held tools, weapons and torches are box models in `heldModel` (grip coordinates); other items show their icon.
- **Saving:** `game.js`. `packItems` and `unpackItems` store all items in one flat table, with the roots inventory, equipment and chests. A new item container needs a new root plus validation in `restore`.

## Testing
- Run `powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1`. It takes about 3 s and prints `PASS`/`FAIL` lines, exiting 1 on failure.
  - Add `-Only "equip,bags"` to run tests by name substring.
  - Add `-Shot` to save `tests\last-run.png`. The world canvas comes out black unless the final scene keeps re-rendering (temporarily add a `requestAnimationFrame` render loop and a `resize` listener after the last `fresh()`).
- The tests run in `tests/test.html`. This file is generated from `index.html` with the same CSP, so don't edit it; tests can't use HTML-string sinks either.
- To add a test, add `test('name', async (ok) => { ... ok(cond, 'why it failed') })` in `tests/tests.js`.
  - Each test starts from `fresh()`: start spot, flat open patch, empty inventory, wearing the starting backpack, daytime, no mobs.
  - The game loop is paused; drive time with `step(frames)`.
  - Stub `Math.random` for rolls; the runner restores it.
- Headless quirks (virtual time):
  - `performance.now()` doesn't advance.
  - IndexedDB is unavailable, so `saveEnabled` is false. To test saving, stub `SaveStore.saveWorld` to capture the meta (see the save round-trip test).
- During work, run only the related tests. Run the full suite before reporting a feature done.

## Environment (Windows)
- PowerShell scripts need `-ExecutionPolicy Bypass`.
- Never run `python`: it's the WindowsApps stub and hangs. There's no Node.
- Write multi-line files with the Write tool, not bash heredocs (quotes break them).
- Chrome is at `C:\Program Files\Google\Chrome\Application\chrome.exe`.

## Working with the user
- Emulate Tibia as closely as possible for UI, equipment and feel; the user shares Tibia screenshots as references.
- The user does the visual and feel testing: looks, balance, real-browser saving, drag and drop. Don't take or inspect screenshots unless the change is visual and risky, or the user asks. Rely on the tests for logic.
- Keep reports short. Update the README at milestones or when asked, not after every change.
- Pausing mid-feature when usage runs low is fine.
- If the user gives exact numbers (stats, recipes, slot counts), use them as given. If they say "your call", decide and note the choice briefly instead of laying out options.
- The user batches related requests. Work through a batch together when it touches the same files; if a batch is large and mixed, suggest splitting it across fresh sessions.
- Pending design input from the user: the layer selection and rendering feature in depth, and more mob behaviors. Equipment TODO: ring and amulet effects, ammo and ranged weapons, Cap as real weight.
