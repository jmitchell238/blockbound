# Blockbound

A 2D side-view mining and building sandbox, inspired by The Blockheads (the iOS game that mixes Minecraft and Terraria).

The world wraps around, so walking far enough in one direction brings you back to where you started. Dig deep enough and you hit magma; climb high enough and you hit the sky limit.

Play at https://jmitchell238.github.io/blockbound/

Not affiliated with Majic Jungle Software, Noodlecake or The Blockheads.

## Controls

| Action | Desktop | Touch |
|--------|---------|-------|
| Move | WASD / arrows | Left stick area |
| Jump | Space | Jump button |
| Mine | Hold click on a block | Hold on a block |
| Place | Click an empty tile (or a wall face, for torches) | Short tap |
| Use (door, chest, bed, eat) | F | ✋ |
| Attack | X / J | ⚔ |
| Craft | C / E | ⚒ |
| Inventory | I | 🎒 |
| Zoom | Scroll wheel | — |
| Pause | Esc / P | — |
| Hotbar | 1–8 | Tap a slot |
| Creative inventory | G / V | — |
| Fly (creative) | Z | — |

The Controls button in the menu switches touch controls between Stick and Kids. In Kids mode you tap to walk, tap blocks to queue digging, and pick a block then tap to queue building. Your character walks over and does each job.

## Features

- Four difficulties: Creative, Easy, Normal and Hard
- Wrapping worlds up to 16,384 tiles wide, local lighting, falling sand and snow
- Survival: hunger, fall damage, respawning at your bed, zombies and skeletons at night, wolves
- Building: doors, chests, furnace, platforms, campfires, a boat, a bucket, wall torches
- Combat with fists or a sword, a backpack inventory, chests, and tabbed crafting

### World sizes

| Preset | Width | Time to walk around |
|--------|------:|---------------------|
| Tour | 1,024 | ~3 min |
| Standard (default) | 4,096 | ~12 min |
| Vast | 8,192 | ~25 min |
| Epic | 16,384 | ~50 min |

## Running locally

The game uses ES modules, which don't load from `file://`, so serve it:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Code

```text
js/
  main.js        Entry point: DOM, animation loop, menu
  core/          Version, physics, world size, RNG
  content/       Block, tool, recipe and milestone data
  world/         Tiles, generation, lighting, gravity, serialization
  player/        Movement, mining, placement
  inventory/     Slots and crafting
  interact/      Block metadata, use actions, stations, milestones
  entities/      Mob AI and drawing
  systems/       Per-tick systems: survival, camera, weather, autosave
  session/       Session setup and the game loop
  render/        Drawing
  input/         Input state
  ui/ save/ audio/ particles/ textures/
  compat/api.js  API used by the tests
```

More detail:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, world model, frame order, rendering, save format
- [docs/ROADMAP.md](docs/ROADMAP.md): planned cleanups and feature ideas
- [docs/handbook.html](docs/handbook.html): both of the above on one page

## Tests

```bash
node tests/run.mjs
```

## Versioning

`GAME_VERSION` lives in `js/core/constants.js`. When you bump it, set `CACHE` in `sw-bb.js` to `'blockbound-' + GAME_VERSION`. The tests check that they match.

`sw-bb.js` is the service worker for new installs. `sw.js` only exists to move older installs that are stuck on it over to `update.html`.
