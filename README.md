# Blockbound

A 2D side-view mining & building sandbox inspired by **The Blockheads** — the classic iOS mix of Minecraft and Terraria.

Walk left or right long enough and the world **loops** so you can circumnavigate the planet. Dig deep enough and you’ll hit **magma**. Climb high enough and you reach the **sky limit**.

**Not affiliated** with Majic Jungle Software / Noodlecake / *The Blockheads*.

## Play

Open `index.html` via a local server (or GitHub Pages):

```bash
python3 -m http.server 8080
# http://localhost:8080
```

## Controls

| Action | Desktop | Touch |
|--------|---------|--------|
| Move | WASD / arrows | Left stick zone |
| Jump | Space | Jump button (right) |
| Mine | Hold click / tap block | Hold on block |
| Place | **Q** toggle / right-click | **Place** button |
| Use | **F** (door, chest, bed, eat) | ✋ Use |
| Craft | **C** / **E** | ⚒ |
| Zoom | Scroll wheel | — |
| Pause | Esc / P | — |
| Hotbar | 1–8 | Tap slots |

## Features (v1.4)

- Wrapping worlds up to **16,384** wide · deeper digs · local lighting
- Survival: hunger, fall damage, bed spawn, food, night **scorpions & dropbears**
- Build: doors, chests, furnace, **platforms**, **campfires**, boat, water bucket
- Sand/snow **gravity**, rain weather, floating drops, dodos/bunnies
- UX: minimap, coords/biome, hover outline, backpack (**I**), zoom, pause

### World sizes

| Preset | Width | Approx. walk-around |
|--------|------:|---------------------|
| Tour | 1,024 | ~3 min |
| Standard (default) | 4,096 | ~12 min |
| Vast | 8,192 | ~25 min |
| Epic | 16,384 | ~50 min (Blockheads-scale) |

Render cost does **not** grow with width (camera-local tiles only). Memory ≈ `width × 128` bytes × 2 (tiles + light).

## Tests

```bash
node tests/run.mjs
```

## Version

`GAME_VERSION` in `js/config.js` — keep `CACHE` in `sw.js` in sync (`blockbound-` + version).
