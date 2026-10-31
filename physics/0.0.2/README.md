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
Mount the **harvester** (TIMBERWOLF has it plus a log rack by default) and drive into trees at any speed. Each tree you touch melts instantly (all HP at once, no bounce, no speed loss, no damage) and gives one log per HP until the rack is full. Logs add weight (60 kg each). The harvester costs 10% top speed.

### Handling: ARCADE / NORMAL
ARCADE (default) is NFS-Carbon / Trackmania style: high grip, yaw assist, handbrake or brake-and-steer drifts that hold their angle, keep speed and fill N2O, strong anti-roll and stable landings. NORMAL is the original model. Toggle with the **ARC/NRM** button (top right) or LAB → FEEL. The setting is saved.

## Tests
```
node tests/unit.mjs      # headless physics (ARCADE): curve table, 300 km/h pass-through, survivors, harvester melt at 10/150 km/h,
                         # top speed with/without harvester per vehicle, bull bar, heat, slalom no-rollover, drift hold, landings
MODE=normal node tests/unit.mjs   # same suite on the NORMAL model
node tests/topspeed.mjs  # prints measured flat top speeds (for vtop in the defs)
node tests/browser.mjs   # puppeteer-core + Chrome (CHROME=/path): UI, selector, picker, persistence, scenes, screenshots -> shots/, no console errors
```
Screenshots are in `shots/`: 01 car selector, 02 attachments, 03 tree hit with HP, 04 temp gauge, 05 harvester, 05c harvester at 120 km/h, 05d arcade drift, 06 300 km/h pass-through.
