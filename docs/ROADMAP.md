# Blockbound — Roadmap

Candidate work, grouped and roughly ordered by value against effort. Nothing
here is committed; it is a menu, not a plan. Items marked **▲** are the ones I
would do first in each section.

Guiding constraint for every item: **the player is a child on an iPad.** A
feature that needs a keyboard, a menu three levels deep, or a written
explanation is the wrong feature.

---

## 1. Architecture

### ▲ 1.1 Split `render/index.js` (~3,000 lines)

It currently holds sky, terrain, lighting composition, entities, HUD, panels,
and hit-testing. Natural seams already exist:

```
render/
  sky.js        gradient, celestial, clouds, parallax
  terrain.js    cave backdrop, seamless terrain, light composite
  blocks.js     deferred non-terrain block draws
  entities.js   mobs, drops, particles, player
  hud.js        hotbar, bars, minimap, coords, toast
  panels/       craft, bag, chest, creative
```

Low risk (drawing code, no state), high payoff for every future change.

### ▲ 1.2 Split `session/GameController.js` (~1,700 lines)

`gameUpdate` mixes frame orchestration with mining rules, placing rules, panel
hit-testing, and inventory click handling. Extract the pure rule blocks
(`handleMine`, `handlePlace`, inventory click routing) into `session/actions/`,
leaving `gameUpdate` as a readable sequence. Do this *after* the render split;
it is the riskier of the two.

### 1.3 A real module boundary for UI geometry

`hudLayout.js` and `chestLayout.js` prove the pattern. Panel layouts still
compute geometry inline in the renderer, which is why hit-testing and drawing
can drift apart. Move each panel's geometry into a pure layout function that
both the drawer and the hit-tester call.

### 1.4 Frame-rate instrumentation

There is currently no way to know what a real iPad is doing. A tiny dev overlay
(frame time, draw calls, active liquid cells, dirty light columns) behind a
toggle would turn performance work from guesswork into measurement.

### 1.5 Chunked terrain caching *(only if measurement says so)*

The CPU profile is dominated by per-tile `drawImage`. Caching each chunk to an
offscreen canvas and blitting it, invalidating on block change, is the standard
fix. **Do not do this speculatively** — it adds real complexity and an
invalidation bug class. Measure first (1.4).

### 1.6 Type safety without a build step

JSDoc types plus `checkJs` in a `jsconfig.json` gives editor-level checking with
zero runtime cost and no bundler. The codebase already has good `@typedef`
blocks to build on.

---

## 2. Correctness and polish

### ▲ 2.1 Item loss on a full inventory

`interact/use.js` `tryBucket` removes the bucket then adds the filled one. With
all 32 slots full and two or more buckets stacked, the result is destroyed.
Same shape of bug is possible anywhere `removeItem` is followed by `addItem`.
A small `swapItem(inv, outId, inId)` helper that verifies space first would
close the whole class.

### 2.2 `player.burning` decay is in the wrong branch

`systems/survival.js` decays it inside the hunger `else`, which is unrelated.
No user-visible effect today because the regen it gates lives in the same
branch — worth tidying when that function is next touched, not before.

### 2.3 Partial-success returns

`inventory.transferSlot` can move some items and still return `false`. Callers
that treat `false` as "nothing happened" will be wrong. Audit and either return
a count or document it.

### 2.4 Save integrity

There is no version field or checksum on the per-world payload. A truncated
`localStorage` write (quota, backgrounded tab) currently fails at parse time.
A `schema` field plus a guarded load with a clear child-facing message would
turn a crash into "that world could not be read".

---

## 3. Gameplay — near term

### 3.1 Cheats system — **shipped v1.9.069–070**

Master toggle plus per-cheat switches in Options. In-game icons appear only when
cheats are on **and** that individual cheat is on. Ships with Always Daytime,
Heal & Feed, and Instant Builds (section 5).

### ▲ 3.2 Tree felling

Walking into a tree currently stops the character dead, which reads as being
stuck rather than as an obstacle. Chopping the base should fell the whole trunk
and its canopy. Also fixes the "I held walk and nothing happened" confusion.

### 3.3 Farming

Seeds from grass, tilled dirt, crops that grow over day cycles, bread from
wheat. This is the classic next system for this genre and it gives a child a
reason to come back to a place they built.

### 3.4 Animal husbandry

Rabbits already exist and wander. Feeding, following, breeding, and a fenced
pen would make critters a project rather than scenery.

### 3.5 Signs and picture frames

A sign a child can place and type on is, in practice, one of the most-used
blocks in this genre. Needs an on-screen keyboard path for iPad.

### 3.6 More weather

Snow already exists as a block and biome. Snowfall in snow biomes, thunder with
lightning flashes, and fog would cost little and add a lot of atmosphere.

---

## 4. Content to add

### Blocks

| Block | Notes |
|---|---|
| ▲ Stone Bricks, Smooth Stone | building variety; furnace recipes |
| ▲ Coloured Wool / Clay | the single biggest win for creative building |
| ▲ Fence, Fence Gate | pens, balconies, garden edges |
| Stairs / Slabs | needs sub-tile collision — significant work, high payoff |
| Trapdoor | cheap given the door interaction already exists |
| Bookshelf, Barrel, Rug | decoration; pure `BLOCK_META` + texture |
| Flowers, Tall Grass, Cactus, Vines | biome dressing; `solid: false` |
| Ice, Packed Snow | snow biome; slippery movement flag |
| Sandstone, Gravel, Mud | terrain variety, gravity on gravel |
| Glowstone / Crystal | a bright emitter that is not a torch |
| Obsidian | quenched-lava reward block, very slow mine |
| Redstone-lite: Lever, Pressure Plate | door automation without a full circuit system |

### Items and tools

| Item | Notes |
|---|---|
| ▲ Shears | leaves → saplings, wool from sheep |
| ▲ Fishing rod | slow, calm, well suited to the audience |
| Diamond / gem tier | the top of the existing tool ladder |
| Armour | needs an equipment slot and a damage-reduction hook |
| Bow and arrow | ranged combat; entity projectile support |
| Compass / map item | "which way is home" is a real child problem |
| Torch-on-a-stick | placing light while walking |
| Paint bucket | recolour placed blocks in place |

### Mobs

| Mob | Notes |
|---|---|
| ▲ Sheep, Pig, Chicken | passive, farmable, fits existing critter code |
| Fish | water is currently lifeless |
| Bees / butterflies | pure ambience, cheap |
| Cave bat | movement variety underground |
| Boss / rare creature | a reason to go deep |

---

## 5. Instant builds (the "cheats" feature)

A prefab system: pick a structure, tap the world, it appears. Gated behind the
cheats toggles so it never intrudes on ordinary play.

### Design

A prefab is **data, not code** — a small grid plus an anchor and a legend:

```js
{
  id: 'cottage',
  name: 'Cosy Cottage',
  icon: '🏠',
  w: 9, h: 6,
  anchor: 'bottom-centre',    // where the tap lands
  legend: { P: BLOCK.PLANKS, G: BLOCK.GLASS, D: BLOCK.DOOR, ... },
  rows: [
    '  PPPPP  ',
    ' PPPPPPP ',
    'PP GGG PP',
    'PP  D  PP',
    ...
  ],
}
```

Placement clears the footprint, writes tiles with `setTile`, marks light dirty
once for the whole span, and schedules liquid cells at the edges.

### Structures worth shipping

**Homes** — Starter Hut, Cosy Cottage, Two-Storey House, Treehouse, Igloo,
Desert Villa, Underground Bunker.

**Fun** — ▲ Fountain (working water source), Swimming Pool, Slide, Maze,
Playground, Campfire Circle, Pirate Ship.

**Landmarks** — ▲ Watchtower, Castle, Bridge, Lighthouse, Windmill, Statue,
Arch.

**Practical** — Mineshaft with ladders and torches, Sky Platform, Storage Room
with chests, Farm Plot, Animal Pen, Bridge-over-lava.

### Other cheats worth having

| Cheat | Why |
|---|---|
| ~~Instant builds~~ | **shipped** — 8 structures |
| ▲ Give items | a block palette outside Creative mode |
| Fly | currently Creative-only |
| Instant mine | one-tap digging |
| Set time of day | "make it daytime, I'm scared" |
| Heal and feed | undo a bad situation without dying |
| Teleport home / to spawn | the lost-child problem |
| No hostiles | a calm switch for a nervous player |
| Reveal map | fills the minimap |

### Guardrails

- Cheats ship as **global preferences** in the library, reachable from Options
  without a world loaded. Moving them per-world (into `WorldMeta`) so one world
  can be a sandbox and another a real survival run is a reasonable later change.
- The icon rule: visible only when the master toggle **and** the individual
  cheat are on.
- Prefabs must refuse to overwrite bedrock and must clamp against `SKY_LIMIT`.
- Placement should be one undoable action — worth storing the previous tiles for
  a single-step undo, since a misplaced house is otherwise heartbreaking.

---

## 6. Accessibility and comfort

- **Reduced motion** — the library already has the flag; nothing reads it yet.
- **Colour-blind safe ore colours** — iron and copper are close.
- **Larger text option** — the HUD is small on a phone-sized portrait stage.
- **One-handed layout** — mirror the chrome for left-handed play.
- **Audio ducking and a volume slider** — currently a single mute toggle.

---

## 7. Suggested order

1. ~~Cheats system with instant builds~~ — shipped
2. Tree felling *(removes a real confusion)*
3. Render split *(unblocks everything visual)*
4. Frame-rate overlay, then decide on chunk caching
5. Building blocks: wool, fences, stone bricks
6. Farming
7. GameController split
8. Passive farm animals
