# Blockbound — Architecture

A 2D side-view mining and building sandbox inspired by *The Blockheads*, written
as native ES modules with no build step, no bundler, and no runtime
dependencies. Open `index.html` from any static HTTP server and it runs.

> **Audience.** This document is for someone (human or agent) about to change
> the code. It explains where things live, why the seams are where they are, and
> which invariants will bite you if you break them.

**Target platform is an iPad used by a child.** That single fact explains most
of the design: touch-first controls, no keyboard requirement, an aggressive
service-worker update path, defensive rendering that never leaves a blank
screen, and a save format that fights for storage quota.

---

## 1. Ten-second tour

```
index.html          shell: canvas, DOM menus, play-chrome buttons
  └── js/main.js    composition root: DOM wiring, rAF loop, menu screens
        └── js/session/GameController.js   the game: update + render orchestration
              ├── js/world/       tiles, generation, lighting, liquids
              ├── js/player/      movement, collision, mining, placing
              ├── js/entities/    critters, hostiles, dropped items
              ├── js/systems/     camera, survival, weather, nav, autosave
              ├── js/inventory/   hotbar, bag, crafting maths
              ├── js/interact/    doors, chests, beds, stations, milestones
              ├── js/render/      all canvas drawing
              └── js/save/        multi-world library + per-world payloads
```

Roughly 11,000 lines of JavaScript. The two large files are
`js/render/index.js` (~3,000 lines) and `js/session/GameController.js`
(~1,700 lines); everything else is small and focused.

---

## 2. Layering and the dependency rule

The intended dependency direction is one-way:

```
main.js  →  session  →  systems / player / entities / world / inventory / interact  →  content / core
                                              ↓
                                           render
```

- **`core/`** holds engine constants and pure maths (`rng`, `seed`,
  `worldSize`, `difficulty`). It imports almost nothing.
- **`content/`** is the data catalog — blocks, tools, recipes, items,
  milestones. Pure data plus tiny predicates. Adding game content should mostly
  mean editing these files.
- **Domain modules** (`world`, `player`, `inventory`, `entities`, `interact`)
  own rules and state shape. They must not touch the DOM or the canvas.
- **`render/`** reads state and draws. It never mutates game state.
- **`session/GameController.js`** is the orchestrator: it owns the single
  `session` object and calls everything in a fixed order each frame.
- **`main.js`** is the only file that knows about the DOM, and the only file
  that owns the `requestAnimationFrame` loop.

**The rule that matters:** domain and content modules stay free of `document`,
`window`, and `CanvasRenderingContext2D`. This is what lets `tests/run.mjs`
import them directly in Node with no browser shim. Breaking it breaks the test
suite's ability to test behaviour at all.

---

## 3. The world model

### Tiles

A world is flat typed arrays of size `WORLD_W × WORLD_H`:

| Array | Type | Meaning |
|---|---|---|
| `tiles` | `Uint8Array` | block id per cell |
| `light` | `Uint8Array` | computed light level per cell |
| `surface` | `Int16Array` | terrain height per column |
| `biome` | `Uint8Array` | 0 forest, 1 desert, 2 snow, 3 plains |

`WORLD_H` is a fixed **128**. `WORLD_W` is *mutable* — chosen per world from
`WORLD_SIZE_PRESETS`:

| Preset | Width | Feel |
|---|---|---|
| Tour | 1,024 | ~3 min lap |
| Standard | 4,096 | ~12 min lap (default) |
| Vast | 8,192 | ~25 min lap |
| Epic | 16,384 | Blockheads 1× |

At Epic that is ~4 MB of tiles. `js/core/worldSize.js` exports `WORLD_W` as a
live binding reassigned by `applyWorldSize()` at generation and load time.

> **Invariant.** Anything that captures `WORLD_W` into a module-level constant
> at import time will be wrong for every world that is not 4,096 wide. Read the
> live binding, or call `getWorldW()`.

### Horizontal wrap

The signature feature: walk far enough and you return to where you started.
Every horizontal coordinate must be normalised through `wrapX()`, and every
horizontal *difference* through `wrapDeltaX()`. Vertical is clamped, not
wrapped — `y = 0` is the sky edge, `SKY_LIMIT = 2` is the build ceiling, and
`WORLD_H - 1` is bedrock.

> **Invariant.** A raw `a.x - b.x` is a bug waiting to happen: near the seam it
> produces a distance of nearly a whole world. Camera, mob AI, drop pickup, and
> reach checks all go through `wrapDeltaX`.

### Vertical bands

```
y=0            space edge
y=2            SKY_LIMIT — hard build ceiling
y≈36           SURFACE_Y — nominal sea / surface band
   …           caves, ores
y=WORLD_H-8    MAGMA_Y — magma crust caps the molten lava
y=WORLD_H-1    bedrock floor
```

**Magma vs Lava** is a deliberate two-block design. `MAGMA` is a solid,
mineable, faintly glowing crust that does not burn. `LAVA` beneath it is a
non-solid hazard you sink into, unmineable (`mine: 99`). Breaking the crust is
therefore a deliberate act with consequences. The route to bedrock is to quench
lava with water, which turns it to stone, then mine the stone.

### Lighting

Light is flood-filled with radius `LIGHT_RADIUS = 16`, which must stay at or
above the brightest emitter (lantern, 14) or light will not fully spread.
After generation, lighting is **column-local**: edits mark dirty columns in
`world.lightDirtyCols` and `flushLight()` recomputes only those. This is what
keeps mining responsive at Epic width.

### Liquids

`js/world/liquid.js` is a finite-level flow simulation, and its two design
constraints are worth preserving:

1. **Levels, not booleans.** A binary "is water" spreads without bound — one
   bucket would flood a flat world. Each flowing tile carries a level; a source
   is `MAX_LEVEL`, each sideways step is one lower, and it stops at zero.
2. **Levels live in a sparse map, not a parallel array.** A `Uint8Array` of
   levels would double world memory and every save — 2 MB on Epic. Storage
   quota has been a real problem in this project. Only *flowing* tiles carry an
   entry; a settled world stores almost nothing.

Work is driven by an active-cell queue (`scheduleCell`), so a still world costs
nothing per frame.

---

## 4. The session object

`GameController.js` owns exactly one module-level `session`. Its shape:

| Field | What it is |
|---|---|
| `world` | tiles, light, surface, biome, meta |
| `player` | position, velocity, hp/hunger/energy, flags |
| `inv` | hotbar (8) + bag (24) + selected + equipped tool |
| `ents` | `{ critters, hostiles, drops }` |
| `input` | shared input state, written by `js/input/input.js` |
| `ui` | panel open flags, zoom, toast, weather, camera mirror |
| `cam` | camera x/y/zoom in tile space |
| `stats` | blocks mined, distance walked, circumnavigations, milestones |
| `timeOfDay` | 0..1, full cycle every `DAY_LEN` = 480 s |
| `difficultyId` | `creative` \| `easy` \| `normal` \| `hard` |
| `paused` | pause flag |

### Frame order

`gameUpdate(dt)` runs a deliberate sequence. The order is load-bearing:

1. Toast timer, **pause handling** (Esc closes an open panel before it pauses)
2. Zoom (wheel delta or iPad pinch absolute)
3. Difficulty-derived flags — `godMode`, `canFly`, `hazardMul`
4. Panel toggles — craft / bag / creative / chest
5. `applyKidsNav` — converts tap targets into per-frame movement intent
6. `updateSurvival` — hunger, energy, regen, death and respawn
7. `updatePlayer` — physics, collision, mining and placing
8. Mining and placing results — drops, gravity, light, milestones
9. `updateDrops`, `updateCritters`, `updateHostiles`
10. `updateWeather`
11. `updateCamera`
12. `tickLiquids`
13. `updateWorldServices` — autosave

> **Invariant.** When paused, `clearLatchedInput(input)` runs before the early
> return. One-shot input flags would otherwise accumulate while paused and all
> fire at once on resume — press Esc, mash keys, unpause, and the character does
> all of it at once.

---

## 5. Input and the two control modes

`js/input/input.js` produces one shared input object consumed by the session.
Two control modes exist, and **`kids` is the default**:

| | Kids (default) | Classic |
|---|---|---|
| Move | tap where to walk | stick / WASD |
| Mine | tap a block to queue digging | hold to dig |
| Place | select a block, tap to queue | tap to place |
| Camera | free pan by drag; soft box follow | lag-follow, player above centre |
| Keyboard | never required | supported |

Kids mode routes through `js/systems/nav.js`, which turns a tap target into
per-frame steering intent and a queue of mine/place/use jobs the character walks
to and performs. The character does the work; a second tap cancels.

The camera has two implementations in `js/systems/camera.js`. Kids mode uses a
**box pull, never a re-centre** — children jump and place a block under
themselves, and a centring camera yanks the view out from under that. The
vertical dead zone is asymmetric: the downward edge is derived from the real HUD
height so the character can never settle behind the hotbar.

---

## 6. Rendering

`js/render/index.js` draws in strict back-to-front order:

1. Sky gradient (`skyColors` from time of day and weather)
2. Sun / moon / stars (`drawCelestial`)
3. Clouds, then parallax hills
4. Cave backdrop (`drawSmoothCaveBackdrop`)
5. Seamless terrain (`drawSeamlessTerrain`) onto an offscreen canvas
6. Light multiplied onto terrain, then composited
7. Deferred non-terrain blocks — torches, doors, chests, ladders
8. Entities, particles, player
9. HUD — hotbar, bars, minimap, coordinates, toast, panels

Two things to know:

- **Every stage is wrapped in `try/catch` with a flat-colour fallback.** This is
  intentional. On an iPad there is no console to read, and a thrown render error
  would otherwise leave a child staring at a blank screen. `js/main.js` also
  installs a DOM error reporter for the same reason.
- **Layout constants are shared, not duplicated.** `hudLayout.js` and
  `chestLayout.js` export the real pixel geometry so that non-render code (the
  camera, hit-testing) can reason about where the UI actually is.

---

## 7. Content catalogs

Adding content should mean editing data, not logic.

- **`content/blocks.js`** — `BLOCK` ids and `BLOCK_META`. Metadata flags drive
  behaviour generically: `solid`, `mine` (seconds), `drops`, `gravity`,
  `fluid`, `hazard`, `climb`, `platform`, `hang`, `light`, `alpha`, `interact`.
  A new block usually needs only an id, a meta row, and a texture.
- **`content/tools.js`** — `TOOLS` (power, durability, mine bonuses),
  `FOOD`, `ITEM_NAMES`. Note `isTool()` tests `TOOLS`, and `canStack()` is
  `!isTool()`, so anything in `TOOLS` does not stack.
- **`content/recipes.js`** — `RECIPES` with `station: 'hand' | 'workbench' |
  'furnace'`, plus `SMELTS`.
- **`content/milestones.js`** — one-time celebratory toasts.

### Difficulty

`core/difficulty.js` is a single profile table, and most mode differences are
multipliers rather than branches: `mobDamageMul`, `playerDamageMul`,
`hungerDrainSec`, `starveHpSec`, `sprintMinHungerFrac`, plus the booleans
`creative`, `invincible`, `hostiles`. Magma burn deliberately reuses
`mobDamageMul` rather than introducing a parallel dial.

---

## 8. Persistence

Two-tier, because a single blob hits storage quota:

- **Library** (`blockbound-library-v1`) — small. Global prefs plus a list of
  `WorldMeta` (id, name, seed, difficulty, size, timestamps, stats).
- **Per-world payload** (`blockbound-w-<id>`) — heavy. World tiles, player,
  inventory, entities, time of day.

`save` is a live façade over the active world plus global preferences.
`persistSession()` writes the payload; `js/systems/autosave.js` schedules it.

> **Known hazard.** Autosave overwrites player fields continuously. Any external
> tool that pokes at saved player state while the game is running will have its
> writes stamped over on the next autosave.

### Service worker and updates

There are two workers on purpose. `sw-bb.js` is the real one; `sw.js` is a
legacy bridge that exists only to rescue iPads stuck on an old shell.
`main.js` unregisters every old registration, purges non-current
`blockbound-*` caches, registers `sw-bb.js`, and polls for a newer
`GAME_VERSION` on the server — bouncing to `update.html` when it finds one.

> **Invariant.** `GAME_VERSION` appears in seven places that must move together:
> `core/constants.js`, `sw-bb.js` cache name, `manifest.webmanifest` start_url,
> two `index.html` query strings plus its `BUILD` var, and two in `update.html`.
> The test suite checks the constant against the worker cache name. Bump them
> all, or the update path silently stops working.

---

## 9. Testing

`node tests/run.mjs` — a dependency-free runner using a single `ok(cond, msg)`
helper. It mixes three kinds of check:

1. **Structure** — required files exist, version constants agree.
2. **Source assertions** — a regression is pinned by asserting the source
   contains (or no longer contains) a specific construct.
3. **Behavioural** — modules imported directly and driven with stub worlds and
   stub players. This is the valuable kind, and it is only possible because
   domain modules avoid the DOM.

Many tests are named for the bug they pin. When fixing a regression, add the
test that fails before the fix and passes after — and *verify it fails*, or it
is decoration.

---

## 10. Conventions

- **ES modules only**, no build step. Imports use explicit `.js` extensions.
- **Comments explain why, not what.** The codebase's existing comments are
  unusually good at recording the failed approach that motivated the current
  one. Match that.
- **Version bump per release commit**, message `vX.Y.ZZZ: summary`.
- **Defensive at the edges, strict in the middle.** Render and boot code
  swallow errors and degrade; domain logic should not hide bugs.

---

## 11. Where the sharp edges are

| Area | Watch out for |
|---|---|
| `WORLD_W` | mutable; never capture at import time |
| Horizontal maths | always `wrapX` / `wrapDeltaX` |
| Lighting | `LIGHT_RADIUS` ≥ brightest emitter |
| Liquids | keep levels sparse; a parallel array blows the save |
| `GAME_VERSION` | seven places, must move together |
| Global `button` CSS | `button { width: 100% }` stretches any new chrome button unless it sets `width: auto` |
| Storage quota | the reason for the two-tier save and the sparse liquid map |
| Paused input | latched one-shot flags must be cleared |
