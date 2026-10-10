# Embedding OasisCraft in another site (CultOasis)

This is for whoever wires OasisCraft into the CultOasis repo, most likely a Claude instance working there. It covers what to copy, how to embed it and what to watch out for. Game rules and features are in `README.md`; notes for working on the game itself are in `CLAUDE.md`.

## What you're embedding

- A finished, self-contained browser game: plain HTML, CSS and classic `<script>` files. There's no build step, no dependencies, no server and no network requests.
- Entry point: `index.html`. All paths in it are relative, so it works from any URL path (for example `/oasiscraft/index.html`).
- What ships: `index.html`, `config.js`, `css/`, `js/` (about 360 KB). Leave out `tests/`, `README.md`, `CLAUDE.md` and this file.
- Saves live in each player's browser (IndexedDB plus localStorage), on whatever origin serves the game.

## Recommended setup: static files plus an iframe

The game expects to own its whole window. It sizes a canvas to the window, listens for keys on `window`, stops the page scrolling on Space and the arrow keys, and carries its own strict Content-Security-Policy with Trusted Types. So don't mount its scripts inside a CultOasis page. Serve the files as static assets and show them in an `<iframe>`.

1. **Copy the files** into the CultOasis static folder under one directory, for example `public/oasiscraft/` (Next.js, Vite, Astro and similar serve `public/` at `/`). Copy `index.html`, `config.js`, `css/` and `js/` unchanged. Note the OasisCraft commit you copied from (for example in a short `public/oasiscraft/VERSION` file) so updates are easy to diff.
2. **Embed it** on the page that should show the game:
   ```html
   <iframe src="/oasiscraft/index.html" title="OasisCraft" allow="fullscreen"
           style="width: 100%; height: 100%; border: 0; display: block"></iframe>
   ```
   - Give it a definite height (a full-viewport section or a fixed-aspect box). The game keeps a 15:11 play area and letterboxes the rest.
   - Keyboard input goes to the iframe once it has focus, so clicking the game is enough. Calling `iframe.focus()` on open is a nice touch.
   - Add `?seed=<text>` to the `src` to open or create a specific world. Without it, the player's last world is resumed.
3. **Headers.** If CultOasis sends `X-Frame-Options: DENY` or `frame-ancestors 'none'` site-wide, allow its own origin to frame the game path (`frame-ancestors 'self'`). The embedding page's CSP must allow the frame (`frame-src 'self'`). For the game's files it's also good to send `X-Content-Type-Options: nosniff` and the same CSP as the `<meta>` tag in `index.html` (plus `frame-ancestors 'self'`) as real headers.

### Alternatives for getting the files across

- **Copy a snapshot (recommended):** the simplest option, and CultOasis's hosting/CI never needs access to the private OasisCraft repo. Re-copy to update.
- **Git submodule** at `public/oasiscraft`, pinned to a commit and updated with `git submodule update --remote`. But anything that clones CultOasis (CI, the host's build) then needs read access to the private OasisCraft repo, through a deploy key or token. The submodule would also bring in `tests/` and the docs. They're harmless to serve, but they're not needed.

## Things to know

- **Build switches** are in `config.js`. `creative` and `devTools` are both `false`, and should stay that way for players. They gate Creative mode and the F3 / F8 testing tools. A player can't turn them on from inside the game.
- **Storage keys** on the serving origin:
  - localStorage: `oasiscraft.settings.v1` and `oasiscraft.lastWorld`
  - IndexedDB: database `oasiscraft`

  Don't reuse these names in CultOasis.
- **Same origin means shared trust.** The game's CSP allows any script from its own origin (`script-src 'self'`) and treats its own saved data as untrusted. That's fine as long as CultOasis never serves user-uploaded files from the same origin. If it does, serve the game from its own subdomain (for example `play.cultoasis.…`) and embed that instead.
- **Don't sandbox the iframe without `allow-same-origin`.** Without it the game still runs, but browser storage is unavailable, so it says progress won't be kept.
- **No messages to or from the host.** The game doesn't talk to the parent page (no `postMessage`) and knows nothing about CultOasis accounts. Linking saves to accounts, or showing game events on the site, would need new work in OasisCraft first.
- **Updating.** Make changes in the OasisCraft repo and run its tests there (`powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1`: Windows, Chrome, about 3 s, prints PASS/FAIL). Then copy the files across again.

## Checklist

- [ ] `public/oasiscraft/` holds `index.html`, `config.js`, `css/`, `js/` (with `config.js` switches `false`)
- [ ] A page embeds `/oasiscraft/index.html` in an iframe with a real height
- [ ] Site headers allow `frame-src 'self'` on that page and `frame-ancestors 'self'` for `/oasiscraft/`
- [ ] Opening the page: the world loads, WASD moves after clicking the game, Esc opens the menu, and no CSP errors show in the console
- [ ] Reload the page: the world and position come back (saving works on this origin)
