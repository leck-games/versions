# Sine Rally: physics, vehicles and attachments modules

A standalone build of the Sine Rally driving physics, split into drop-in ES modules. Three.js r160 is vendored in `lib/`, so there is no build step. The target is iPhone 12 / iOS Safari at about 30 fps with touch controls.

**Live test page:** https://leck-games.github.io/sinerally-physics/

The API is documented in [MODULE_API.md](MODULE_API.md) and how to merge into the main game is in [MERGE_NOTES.md](MERGE_NOTES.md).

## Test page
- **MENU → CAR**: car selector with a rotating 3D preview and stats (5 cars).
- **MENU → PARTS**: attachments picker per mount, plus unload logs.
- **MENU → LAB**: teleports (speed strip / practice row / forest), repair, regrow trees, infinite N2O, stability assist.
- Your car and its parts are saved in localStorage.
- Touch: left stick steers (and pitches in the air). Buttons: GAS, BRAKE, N2O, DRIFT. Keyboard: WASD/arrows, Space = handbrake, Shift = nitro, R = reset, M = menu.
- Trees show HP bars (3 HP) and tint from green to yellow to orange as they take damage. The temp gauge sits next to the speedo, and the event log is at the top right.
- Query params: `?car=hyper`, `?menu=car|parts|lab`, `?touch` (force touch UI), `?hd` (full pixel ratio).

### How to reach 300 km/h
Pick **SINE GT**, use LAB → *Speed strip* and hold GAS + N2O down the strip. It reaches 300 km/h before the first gate at z = 700 (top speed about 293 without nitro, 330 with). At 300 km/h or more a tree is smashed through (3 HP removed, about 1% speed loss per HP). The *infinite N2O* toggle helps.

### How to test heat
Stand still and hold GAS + BRAKE. The engine free-revs on the limiter. `engine:hot` starts at 105 °C (smoke puffs), `engine:overheat` comes at 118 °C (power ×0.65, no N2O), and the engine cuts at 140 °C. Long N2O runs also heat the engine.

### Harvesting
Pick **TIMBERWOLF** (harvester + log rack by default) and creep into a tree below 25 km/h. The saw removes 1.2 HP/s and each HP gives one log in the rack. Logs add weight (60 kg each).

## Tests
```
node tests/unit.mjs      # headless physics: curve table, 300 km/h pass-through, survivors, harvester, bull bar, heat events, all vehicles
node tests/browser.mjs   # puppeteer-core + Chrome (CHROME=/path): UI, selector, picker, persistence, scenes, screenshots -> shots/, no console errors
```
Screenshots are in `shots/`: 01 car selector, 02 attachments, 03 tree hit with HP, 04 temp gauge, 05 harvester, 06 300 km/h pass-through.
