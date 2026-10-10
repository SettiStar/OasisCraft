// OasisCraft build switches. Edit this file in the repo to turn features on; players can't
// change them from inside the game (and a saved setting can't override a switch that's off).
//
//   creative  - Creative mode: the "Creative mode" option in Settings, the creative button and
//               the creative item window (every item, no damage, flight, instant mining).
//   devTools  - Testing apparatus: the F3 debug overlay (and its Settings option) and F8 to
//               cycle the weather.
//
// Both are off for players. The automated tests (tests/) switch both on for themselves.

const OASIS_CONFIG = {
  creative: false,
  devTools: false,
};
