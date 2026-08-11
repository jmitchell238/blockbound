# Blockbound

A 2D side-view mining & building sandbox inspired by **The Blockheads** — the classic iOS mix of Minecraft and Terraria.

Walk left or right long enough and the world **loops** so you can circumnavigate the planet. Dig deep enough and you’ll hit **magma**. Climb high enough and you reach the **sky limit**.

**Not affiliated** with Majic Jungle Software / Noodlecake / *The Blockheads*.

## Play

Requires a local HTTP server (ES modules do not load from `file://`):

```bash
python3 -m http.server 8080
# http://localhost:8080
```

Or GitHub Pages / any static host.

## Controls

| Action | Desktop | Touch |
|--------|---------|--------|
| Move | WASD / arrows | Left stick zone |
| Jump | Space | Jump button (right) |
| Mine | **Hold** click on a block | Hold on block |
| Place | **Tap** empty tile (or wall face for torches) | Short tap |
| Use | **F** (door, chest, bed, eat) | ✋ Use |
| Attack | **X** / **J** / Attack button | ⚔ Hit |
| Craft | **C** / **E** | ⚒ |
| Inventory | **I** / bag button | 🎒 |
| Zoom | Scroll wheel | — |
| Pause | Esc / P | — |
| Hotbar | 1–8 | Tap slots |

## Architecture (v1.6)

Native **ES modules** with SOLID-oriented layering:

```text
js/
  main.js                 Composition root (DOM, rAF, menu)
  core/                   Version, physics, world size, RNG
  content/                Blocks, tools, recipes, milestones (data)
  world/                  Tiles, gen, light, gravity, serialize
  player/                 Movement, mining, placement
  inventory/              Slots, craft math
  interact/               Meta, use actions, stations, milestones
  entities/               Mob AI (mobs.js) vs draw (draw.js)
  systems/                Tick slices: survival, camera, weather, autosave…
  session/                Session factory + game loop orchestration
  ui/                     Toast and UI helpers
  render/                 View only (no session import)
  input/                  Single InputState
  save/ audio/ particles/ textures/
  compat/api.js           Test façade
```

**Dependency direction:** content/core → domain → systems/session → main.

- **Single input** — the bound `InputState` is injected into the session (no dual buffer).
- **Render** does not call `getSession()`; hold-mine highlight uses `ui.holdMining`.
- **Systems** own survival/camera/weather/world services; `GameController` sequences them.

## Features

- Wrapping worlds up to **16,384** wide · local lighting · sand/snow gravity
- Survival: hunger, fall damage, bed spawn, food, night zombies/skeletons, wolves
- Build: doors, chests, furnace, platforms, campfires, boat, bucket, wall-face torches
- Combat: punch or sword · inventory backpack + chests · craft tabs

### World sizes

| Preset | Width | Approx. walk-around |
|--------|------:|---------------------|
| Tour | 1,024 | ~3 min |
| Standard (default) | 4,096 | ~12 min |
| Vast | 8,192 | ~25 min |
| Epic | 16,384 | ~50 min (Blockheads-scale) |

## Tests

```bash
node tests/run.mjs
```

## Version

`GAME_VERSION` in `js/core/constants.js` — keep `CACHE` in `sw.js` in sync (`blockbound-` + version).
