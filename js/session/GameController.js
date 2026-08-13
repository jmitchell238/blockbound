import {
  DAY_LEN, SURFACE_Y, WORLD_H, W, H, SKY_LIMIT,
} from '../core/constants.js';
import { WORLD_W, applyWorldSize, worldSizePreset } from '../core/worldSize.js';
import { getDifficulty, applyStarterKit, creativeGiveCount } from '../core/difficulty.js';
import { BLOCK, BLOCK_META } from '../content/blocks.js';
import { TOOLS, isTool, isFood, isWeapon } from '../content/tools.js';
import { isBlockItem, tileKey, itemName } from '../content/items.js';
import {
  generateWorldAsync, deserializeWorld, getTile, flushLight, tickGravityNear,
  wrapDeltaX, wrapX, isSolid,
} from '../world/index.js';
import {
  makePlayer, updatePlayer, tryPlace, findSpawn, isAttachableBlock,
} from '../player/index.js';
import {
  makeInventory, addItem, removeItem, selectedSlot, selectHotbar,
  syncEquippedTool, toolPowerFor, canCraft, craft, deserializeInv,
  moveOrSwap, stowToBag, transferSlot, HOTBAR_SIZE, getMeleeWeapon, getHeldTool,
  countItem,
} from '../inventory/inventory.js';
import {
  makeWorldMeta, getChest, removeChest, nearInteract, isDoorOpen, toggleDoor,
  tryEat, trySleep, tryBucket, tryMountBoat, tryDismountBoat,
  unlockMilestone, recipesInTab, stationAvailable, missingMaterials, stationHint,
  setTorchFacing, clearTorchFacing, setLanternMode, clearLanternMode,
} from '../interact/index.js';
import {
  makeEntityState, seedCritters, deserializeEntities, updateDrops, updateCritters,
  updateHostiles, tryMeleeAttack, spawnDrop,
} from '../entities/state.js';
import { makeParticleSystem, spawnBurst, updateParticles } from '../particles/particles.js';
import { makeInput, pollInput } from '../input/input.js';
import { renderWorld, skyColors } from '../render/index.js';
import {
  sfxJump, sfxMine, sfxPlace, sfxHurt, sfxPickup, sfxDoor, sfxSleep, sfxCraft,
} from '../audio/audio.js';
import { save, persistSession } from '../save/save.js';
import { toast } from '../ui/toast.js';
import { updateSurvival } from '../systems/survival.js';
import { updateCamera } from '../systems/camera.js';
import { updateWeather } from '../systems/weather.js';
import { updateWorldServices } from '../systems/autosave.js';
import {
  applyKidsNav, setMoveTarget, clearMoveTarget, clearKidsQueue,
  queueMine, queuePlace, queueUse, kidsQueueMarkers,
} from '../systems/nav.js';

export let session = null;

export function _finishSession(world, player, inv, timeOfDay, seed, ents, sharedInput, difficultyId) {
  if (!world.meta) world.meta = makeWorldMeta();
  if (!ents) {
    ents = makeEntityState();
    seedCritters(ents, world);
  }
  const diff = getDifficulty(difficultyId);
  player.godMode = !!(diff.creative || diff.invincible);
  player.canSprint = true;
  // Equip whatever the selected hotbar slot holds. inventory.addItem does not
  // sync, and gameUpdate only syncs on a hotbar tap — so a fresh spawn held a
  // pickaxe while inv.tool was still 'hand': HUD read "Tool: Hands" and mining
  // ran at bare-hand power until the player happened to tap a slot.
  syncEquippedTool(inv);
  // Single InputState (DIP): app may inject the bound input; no dual-buffer sync.
  const input = sharedInput || makeInput();
  const ui = {
    mode: 'mine',
    craftOpen: false,
    craftHit: [],
    craftTab: 'basic',
    craftScroll: 0,
    craftSelected: null, // recipe id
    chestOpen: null, // { x, y, slots }
    chestHit: [],
    bagOpen: false,
    creativeOpen: false,
    creativeHit: [],
    creativeScroll: 0,
    invPick: null, // { from: 'hotbar'|'bag'|'chest', i }
    /** Drag ghost: { from, i, id, count, durability, x, y, active } */
    invDrag: null,
    /** Hover tooltip { text, x, y } */
    hoverTip: null,
    /** Double-click tracking { key, t } */
    invClickLast: null,
    toast: '',
    toastT: 0,
    showTouch: false,
    prompt: '',
    zoom: 1,
    hoverTx: null,
    hoverTy: null,
    holdMining: false,
    weather: 0, // 0 clear, 1 rain intensity
    wasNight: false,
    difficultyId: diff.id,
    creative: !!diff.creative,
    seedLabel: 'seed ' + ((save && save.seedString) || seed || ''),
    worldName: (save && save.worldName) || '',
    /** 'classic' | 'kids' — Kids = tap-to-walk + free camera (great for little ones) */
    controlMode: (save && save.controlMode) || 'classic',
    moveMarker: null,
    kidsQueue: [],
  };
  const stats = {
    blocksMined: save.blocksMined | 0,
    distanceWalked: save.distanceWalked || 0,
    circumnavigations: save.circumnavigations | 0,
    milestones: save.milestones | 0,
    lastX: player.x,
    wrapAccum: 0,
  };
  const cam = { x: player.x, y: player.y - 0.5, zoom: 1 };
  return {
    world, player, inv, input, ui, cam, timeOfDay, stats, seed, ents,
    difficultyId: diff.id,
    worldName: (save && save.worldName) || 'World',
    seedString: (save && save.seedString) || String(seed >>> 0),
    saveTimer: 0, lightTimer: 0, hungerTimer: 0,
    particles: makeParticleSystem(),
    paused: false, dead: false,
  };
}

export async function createSession(opts) {
  opts = opts || {};
  let world;
  let player;
  let inv;
  let timeOfDay = 0.28;
  let seed = (Math.random() * 1e9) | 0;
  let ents = null;
  let difficultyId = opts.difficultyId || save.difficultyId || 'normal';

  if (opts.continueSave && save.hasWorld && save.world) {
    world = deserializeWorld(save.world);
    if (!world) {
      applyWorldSize((save.worldSize | 0) || worldSizePreset(save.worldSizeId || 'standard').w);
      world = await generateWorldAsync(save.seed || seed, opts.onProgress);
    } else {
      seed = world.seed;
    }
    inv = deserializeInv(save.inv);
    timeOfDay = save.timeOfDay != null ? save.timeOfDay : 0.28;
    ents = deserializeEntities(save.ents);
    difficultyId = save.difficultyId || difficultyId;
    if (save.player) {
      player = makePlayer(save.player.x, save.player.y);
      player.x = save.player.x;
      player.y = save.player.y;
      player.hp = save.player.hp != null ? save.player.hp : 100;
      player.energy = save.player.energy != null ? save.player.energy : 100;
      player.hunger = save.player.hunger != null ? save.player.hunger : 100;
      player.spawnX = save.player.spawnX != null ? save.player.spawnX : null;
      player.spawnY = save.player.spawnY != null ? save.player.spawnY : null;
      player.inBoat = !!save.player.inBoat;
    } else {
      const sp = findSpawn(world);
      player = makePlayer(sp.x, sp.y);
    }
    if (!ents.critters.length) seedCritters(ents, world);
  } else {
    seed = opts.seed != null ? opts.seed : (save.seed != null ? save.seed : seed);
    seed = (seed >>> 0) || 1;
    const size = worldSizePreset(opts.worldSizeId || save.worldSizeId || 'standard');
    applyWorldSize(size.w);
    world = await generateWorldAsync(seed, opts.onProgress);
    const sp = findSpawn(world);
    player = makePlayer(sp.x, sp.y);
    inv = makeInventory();
    applyStarterKit(inv, difficultyId);
    ents = makeEntityState();
    seedCritters(ents, world);
  }

  return _finishSession(world, player, inv, timeOfDay, seed, ents, opts.input, difficultyId);
}

/**
 * Fix corrupt / stuck spawn so caves never open to a blank void.
 * - NaN coords
 * - Embedded in solid rock
 * - Below magma / above sky
 */
export function sanitizePlayerInWorld(world, player) {
  if (!player || !world) return;
  if (!Number.isFinite(player.x)) player.x = WORLD_W / 2;
  if (!Number.isFinite(player.y)) player.y = SURFACE_Y;
  player.x = wrapX(player.x);
  player.y = Math.max(SKY_LIMIT + (player.h || 1.5), Math.min(WORLD_H - 2.5, player.y));
  player.vx = Number.isFinite(player.vx) ? player.vx : 0;
  player.vy = Number.isFinite(player.vy) ? player.vy : 0;

  // Push out of solid (search upward for air feet + head room)
  const px = Math.floor(player.x);
  let y = Math.floor(player.y);
  let guard = 0;
  while (guard++ < 48) {
    const feetSolid = isSolid(world, px, y);
    const bodySolid = isSolid(world, px, y - 1);
    const headSolid = isSolid(world, px, Math.floor(player.y - (player.h || 1.5) + 0.05));
    if (!feetSolid && !bodySolid && !headSolid) break;
    y -= 1;
    player.y = y + 0.02;
    if (y < SKY_LIMIT + 2) {
      const sp = findSpawn(world, player);
      player.x = sp.x + 0.5;
      player.y = sp.y;
      break;
    }
  }
  // Ensure standing on something if floating in void columns
  if (!isSolid(world, px, Math.floor(player.y) + 1)
      && !isSolid(world, px, Math.floor(player.y))) {
    // ok in open cave air
  }
}

export function snapCameraToPlayer(s) {
  if (!s || !s.player || !s.cam) return;
  const p = s.player;
  s.cam.x = Number.isFinite(p.x) ? p.x : 0;
  s.cam.y = Number.isFinite(p.y) ? p.y - 1.2 : SURFACE_Y;
  s.cam.y = Math.max(8, Math.min(WORLD_H - 8, s.cam.y));
  s.cam.zoom = (s.ui && s.ui.zoom) || 1;
  if (s.input) {
    s.input.camUserPanned = false;
    s.input._panning = false;
    s.input.moveTarget = null;
    if (s.input.kidsQueue) s.input.kidsQueue.length = 0;
  }
}

export async function enterPlay(continueSave, extra) {
  extra = extra || {};
  // Clear sticky touch state from a previous session (shared appInput)
  if (extra.input) {
    const inp = extra.input;
    inp.pointerDown = false;
    inp.holdMining = false;
    inp._panning = false;
    inp.camUserPanned = false;
    inp.moveTarget = null;
    inp.kidsQueue = [];
    inp.mineTx = null;
    inp.mineTy = null;
    inp.tapPlace = null;
    inp.stickX = 0;
    inp.stickY = 0;
    inp._touchJump = false;
    inp._touchFlyUp = false;
    inp._touchFlyDown = false;
    inp._kidsMining = false;
  }
  session = await createSession({
    continueSave: !!continueSave,
    worldSizeId: extra.worldSizeId,
    difficultyId: extra.difficultyId,
    seed: extra.seed,
    onProgress: extra.onProgress,
    input: extra.input,
  });
  // Apply saved control scheme immediately (pointer events read input.controlMode)
  if (session) {
    const mode = (save && save.controlMode) === 'classic' ? 'classic' : 'kids';
    session.ui.controlMode = mode;
    session.input.controlMode = mode;
    // Apply difficulty flags immediately (don't wait for first gameUpdate frame)
    try {
      const diff = getDifficulty(session.difficultyId);
      session.player.godMode = !!(diff.creative || diff.invincible);
      session.player.canFly = !!diff.creative;
      session.ui.creative = !!diff.creative;
      if (diff.creative) {
        // Creative *allows* flight, it doesn't start in it. Spawning airborne
        // makes tap-to-walk drift through the air instead of walking.
        session.player.flying = false;
        session._flyInited = true;
      }
    } catch (_) {}
    sanitizePlayerInWorld(session.world, session.player);
    snapCameraToPlayer(session);
    // Local light around spawn so deep caves aren't pure black on load
    try {
      if (session.world) {
        session.world.dirtyLight = true;
        if (!session.world.lightDirtyCols) session.world.lightDirtyCols = new Set();
        session.world.lightDirtyCols.add(wrapX(Math.floor(session.player.x)));
        flushLight(session.world);
      }
    } catch (_) {}
    if (save && save.loadError) {
      // Outranks the welcome line: the player is standing in a fresh world
      // where their build used to be, and needs to know before they build more.
      toast(session.ui, '⚠ Saved world could not be read — a copy was kept');
    } else if (mode === 'kids') {
      toast(session.ui, 'Kids · tap walk · dig · build · ☰ is always bottom-left');
    } else if (session.ui.creative) {
      toast(session.ui, 'Creative · ✈ flying · dig / place by tapping');
    }
  }
  return session;
}

export function enterMenu() {
  if (session) {
    try {
      persistSession(
        session.world, session.player, session.inv, session.timeOfDay,
        session.stats, session.ents, session.difficultyId
      );
    } catch (_) {}
  }
  session = null;
}

export function gameUpdate(dt) {
  if (!session) return;
  const s = session;
  const { world, player, inv, input, ui, cam, stats, ents } = s;

  if (ui.toastT > 0) ui.toastT -= dt;

  // Pause. Esc closes an open panel first: pausing on top of one hid the panel
  // behind the overlay and stranded whatever the player was carrying in it.
  if (input.pauseToggle) {
    input.pauseToggle = false;
    // No toast: the full-screen overlay already says it, louder.
    if (ui.creativeOpen || ui.bagOpen || ui.chestOpen || ui.craftOpen) closeOpenPanel(ui);
    else s.paused = !s.paused;
  }
  if (s.paused) {
    // Every one-shot handler below this return would otherwise keep its flag
    // set and all fire at once the moment play resumes — press Esc, mash keys,
    // un-pause, and the character would suddenly do all of it.
    clearLatchedInput(input);
    return;
  }

  // Zoom — wheel (delta) or iPad pinch (absolute)
  if (input.zoomAbsolute != null && Number.isFinite(input.zoomAbsolute)) {
    ui.zoom = Math.max(0.55, Math.min(2.0, input.zoomAbsolute));
    cam.zoom = ui.zoom;
    input.zoomAbsolute = null;
  } else if (input.zoomDelta) {
    ui.zoom = Math.max(0.55, Math.min(2.0, (ui.zoom || 1) + input.zoomDelta * 0.1));
    cam.zoom = ui.zoom;
    input.zoomDelta = 0;
  }
  // Don't dig / place while pinching
  if (input.pinching) {
    input.mineTx = null;
    input.mineTy = null;
    input.tapPlace = null;
    input.holdMining = false;
  }

  const diff = getDifficulty(s.difficultyId);
  player.godMode = !!(diff.creative || diff.invincible);
  // Creative flight
  player.canFly = !!diff.creative;
  if (!player.canFly) player.flying = false;
  else if (player.flying == null) player.flying = false;
  // Tell the player fly is available — but let them start on the ground, so
  // tap-to-walk walks. ✈ opts in.
  if (player.canFly && !s._flyInited) {
    s._flyInited = true;
    toast(ui, '✈ button to fly · tap the ground to walk');
  }
  input._flyPads = !!(player.canFly && player.flying && ui.showTouch);

  if (input.craftToggle) {
    if (ui.chestOpen) ui.chestOpen = null;
    else if (ui.creativeOpen) ui.creativeOpen = false;
    else if (ui.bagOpen) ui.bagOpen = false;
    else {
      ui.craftOpen = !ui.craftOpen;
      if (ui.craftOpen) {
        ui.craftScroll = 0;
        ui.craftTab = ui.craftTab || 'all';
        const rows = typeof recipesInTab === 'function'
          ? recipesInTab(ui.craftTab, world, player.x, player.y)
          : [];
        const ready = rows.find(row => row.stationOk && canCraft(inv, row.recipe));
        ui.craftSelected = ready ? ready.recipe.id : (rows[0] && rows[0].recipe.id) || null;
      }
    }
    input.craftToggle = false;
  }
  if (input.bagToggle) {
    ui.bagOpen = !ui.bagOpen;
    ui.craftOpen = false;
    ui.chestOpen = null;
    ui.creativeOpen = false;
    ui.invPick = null;
    input.bagToggle = false;
  }
  if (input.creativeToggle) {
    input.creativeToggle = false;
    if (diff.creative) {
      ui.creativeOpen = !ui.creativeOpen;
      ui.craftOpen = false;
      ui.bagOpen = false;
      ui.chestOpen = null;
      ui.invPick = null;
      if (ui.creativeOpen) ui.creativeScroll = ui.creativeScroll || 0;
    }
  }
  if (input.modeToggle) {
    // Legacy no-op (mine/place is tap vs hold now)
    input.modeToggle = false;
  }
  if (input.hotbarTap >= 0) {
    selectHotbar(inv, input.hotbarTap);
    syncEquippedTool(inv);
    input.hotbarTap = -1;
  }

  // Use / interact (F)
  if (input.usePressed) {
    input.usePressed = false;
    handleUse(s);
  }

  // Attack (X / J / Attack button)
  if (input.attackPressed) {
    input.attackPressed = false;
    doPlayerAttack(s);
  }

  // Sync control mode (Options → Kids / Classic)
  ui.controlMode = (save && save.controlMode) || ui.controlMode || 'classic';
  input.controlMode = ui.controlMode;
  // Options toggles — read every frame so Options takes effect without reload.
  ui.showCoords = !save || save.showCoords !== false;
  ui.showMinimap = !save || save.showMinimap !== false;
  player.autoJump = !save || save.autoJump !== false;
  if (ui.controlMode !== 'kids') {
    if (input.moveTarget || (input.kidsQueue && input.kidsQueue.length)) clearKidsQueue(input);
  }

  // Promote long-press → mine; refresh hover after hold state is known
  pollInput(input, ui.mode, cam);
  // Kids: run staged walk / dig / build queue
  let kidsNavResult = null;
  if (ui.controlMode === 'kids' && !ui.craftOpen && !ui.bagOpen && !ui.chestOpen && !ui.creativeOpen) {
    kidsNavResult = applyKidsNav(player, world, input, dt);
    if (kidsNavResult && kidsNavResult.toast) toast(ui, kidsNavResult.toast);
  }
  ui.moveMarker = input.moveTarget;
  ui.kidsQueue = kidsQueueMarkers(input);
  ui.holdMining = !!input.holdMining;
  if (input.holdMining && input.mineTx != null) {
    ui.hoverTx = input.mineTx;
    ui.hoverTy = input.mineTy;
  } else if (input.placeTx != null) {
    ui.hoverTx = input.placeTx;
    ui.hoverTy = input.placeTy;
  } else if (input.tapPlace) {
    ui.hoverTx = input.tapPlace.tx;
    ui.hoverTy = input.tapPlace.ty;
  }

  if (input.jumpPressed) {
    // Creative: double-tap JUMP toggles fly
    if (player.canFly) {
      if (player._flyTapT > 0) {
        input.flyToggle = true;
        player._flyTapT = 0;
        input.jumpPressed = false;
      } else {
        player._flyTapT = 0.35;
        if (!player.flying) {
          sfxJump();
        }
        input.jumpPressed = false;
      }
    } else {
      sfxJump();
      input.jumpPressed = false;
    }
  }
  if (player._flyTapT > 0) player._flyTapT = Math.max(0, player._flyTapT - dt);

  if (input.flyToggle) {
    // Applied inside updatePlayer; toast here after we know new state post-update
    s._pendingFlyToast = true;
  }

  if (ui.craftOpen || ui.chestOpen || ui.bagOpen || ui.creativeOpen) {
    // Don't mine/place while menus are open (keep pointer flags for UI)
    input.mineTx = null;
    input.mineTy = null;
    input.placeTx = null;
    input.placeTy = null;
    input.tapPlace = null;
    input.holdMining = false;
    s.timeOfDay = (s.timeOfDay + dt / DAY_LEN * 0.25) % 1;
    return;
  }

  updateSurvival(s, dt);

  let minePower = TOOLS[inv.tool] ? TOOLS[inv.tool].power : 1;
  if (player.mining) {
    minePower = toolPowerFor(inv, getTile(world, player.mining.tx, player.mining.ty));
  }

  // Hold-to-mine only: until hold engages, force mine target clear
  // (placeTx still tracks the finger for tap-place / hover)
  // Kids auto-dig uses mineTx without a finger hold — don't wipe it.
  if (input.pointerDown && !input.holdMining && !input._kidsMining) {
    input.mineTx = null;
    input.mineTy = null;
  } else if (input.holdMining && input.placeTx != null) {
    // Keep mine locked to the held tile
    input.mineTx = input.placeTx;
    input.mineTy = input.placeTy;
  }

  const prevX = player.x;
  const wasFlying = !!player.flying;
  const result = updatePlayer(player, world, input, dt, minePower);
  if (s._pendingFlyToast || (wasFlying !== !!player.flying)) {
    s._pendingFlyToast = false;
    if (player.canFly && wasFlying !== !!player.flying) {
      toast(ui, player.flying
        ? '✈ Flying · UP & DOWN pads · tap ✈ to walk'
        : 'Walking · tap ✈ Fly to fly again');
      try {
        const flyBtn = document.getElementById('btnFly');
        if (flyBtn) {
          flyBtn.classList.toggle('is-on', !!player.flying);
          flyBtn.textContent = player.flying ? '✈ Flying' : '✈ Fly';
        }
      } catch (_) {}
    }
  }

  // Kids queue: auto-place / auto-use when character arrives
  if (kidsNavResult && kidsNavResult.placed) {
    const { tx, ty, blockId } = kidsNavResult.placed;
    // Prefer the staged block if still in inventory; else current selection if same id
    let placeId = blockId;
    const hasStaged = countItem(inv, placeId) > 0 || player.godMode;
    if (!hasStaged) {
      const slotNow = selectedSlot(inv);
      if (slotNow && isBlockItem(slotNow.id)) placeId = slotNow.id;
      else placeId = null;
    }
    if (placeId != null && isBlockItem(placeId)) {
      const placed = tryPlace(player, world, tx, ty, placeId);
      if (placed) {
        if (!player.godMode) removeItem(inv, placeId, 1);
        sfxPlace();
        const m = BLOCK_META[placeId];
        spawnBurst(s.particles, placed.tx + 0.5, placed.ty + 0.5, (m && m.color) || '#fff', 5);
        if (placeId === BLOCK.TORCH) {
          setTorchFacing(world.meta, placed.tx, placed.ty, placed.attach || 'floor');
          unlockMilestone(world.meta, stats, ui, 'first_torch');
        }
        if (placeId === BLOCK.LANTERN) {
          setLanternMode(world.meta, placed.tx, placed.ty, placed.attach || 'hang');
          unlockMilestone(world.meta, stats, ui, 'first_lantern');
        }
        if (placeId === BLOCK.CHEST) getChest(world.meta, placed.tx, placed.ty);
        if (placeId === BLOCK.BED) unlockMilestone(world.meta, stats, ui, 'first_bed');
        if (placeId === BLOCK.FURNACE) unlockMilestone(world.meta, stats, ui, 'first_furnace');
        if (placeId === BLOCK.CAMPFIRE) unlockMilestone(world.meta, stats, ui, 'first_campfire');
        if (placeId === BLOCK.PLATFORM) unlockMilestone(world.meta, stats, ui, 'first_platform');
        tickGravityNear(world, placed.tx, placed.ty, 6);
      } else {
        toast(ui, 'Can’t build there');
      }
    } else {
      toast(ui, 'Need more blocks');
    }
  }
  if (kidsNavResult && kidsNavResult.used) {
    handleUse(s);
  }

  if (player.mining && Math.random() < dt * 10) {
    const meta = BLOCK_META[getTile(world, player.mining.tx, player.mining.ty)];
    spawnBurst(s.particles, player.mining.tx + 0.5, player.mining.ty + 0.5, (meta && meta.color) || '#888', 2);
  }

  let dx = player.x - prevX;
  if (dx > WORLD_W / 2) dx -= WORLD_W;
  if (dx < -WORLD_W / 2) dx += WORLD_W;
  stats.distanceWalked += Math.abs(dx);
  stats.wrapAccum += dx;
  if (Math.abs(stats.wrapAccum) >= WORLD_W) {
    stats.circumnavigations += 1;
    stats.wrapAccum = stats.wrapAccum % WORLD_W;
    unlockMilestone(world.meta, stats, ui, 'loop');
  }

  if (result.mined) {
    sfxMine();
    stats.blocksMined++;
    unlockMilestone(world.meta, stats, ui, 'first_mine');
    if (result.mined.ty > SURFACE_Y + 30) unlockMilestone(world.meta, stats, ui, 'deep_dig');

    const meta = BLOCK_META[result.mined.id];
    spawnBurst(s.particles, result.mined.tx + 0.5, result.mined.ty + 0.5, (meta && meta.color) || '#c4a060', 10);

    // Drops (floating)
    let dropId = meta && meta.drops;
    let dropN = 1;
    if (result.mined.id === BLOCK.LEAVES && meta && meta.fruitChance && Math.random() < meta.fruitChance) {
      spawnDrop(ents, result.mined.tx + 0.5, result.mined.ty + 0.5, 'apple', 1);
    }
    if (result.mined.id === BLOCK.CHEST) {
      const slots = getChest(world.meta, result.mined.tx, result.mined.ty);
      for (const sl of slots) {
        if (sl) spawnDrop(ents, result.mined.tx + 0.5, result.mined.ty + 0.3, sl.id, sl.count);
      }
      removeChest(world.meta, result.mined.tx, result.mined.ty);
    }
    if (result.mined.id === BLOCK.DOOR) {
      delete world.meta.openDoors[tileKey(result.mined.tx, result.mined.ty)];
    }
    if (result.mined.id === BLOCK.TORCH) {
      clearTorchFacing(world.meta, result.mined.tx, result.mined.ty);
    }
    if (result.mined.id === BLOCK.LANTERN) {
      clearLanternMode(world.meta, result.mined.tx, result.mined.ty);
    }
    if (dropId != null) {
      spawnDrop(ents, result.mined.tx + 0.5, result.mined.ty + 0.5, dropId, dropN);
    }

    if (inv.tool !== 'hand' && !player.godMode) {
      const slot = selectedSlot(inv);
      if (slot && isTool(slot.id)) {
        slot.durability = (slot.durability != null ? slot.durability : 100) - 1;
        if (slot.durability <= 0) {
          inv.hotbar[inv.selected] = null;
          inv.tool = 'hand';
          toast(ui, 'Tool broke!');
        }
      }
    }
  }

  if (result.hurt) {
    sfxHurt();
    if (result.fall) toast(ui, 'Ouch — fall damage!');
  }

  // TAP place (short press) — HOLD digs via mineTx
  if (input.tapPlace) {
    const ptx = input.tapPlace.tx;
    const pty = input.tapPlace.ty;
    input.tapPlace = null;

    const slot = selectedSlot(inv);
    const tid = getTile(world, ptx, pty);
    // Prefer combat when the tap is on/near a mob (click enemy to hit — no Attack button required)
    const mobAtTap = findMobAtTile(ents, player, ptx, pty);
    const tileMeta = BLOCK_META[tid];
    const tapDist = Math.hypot(wrapDeltaX(player.x, ptx + 0.5), (player.y - 0.8) - (pty + 0.5));
    // Doors / chests / beds / etc. — tap to use (no Use button on touch)
    const canInteractTap = !!(tileMeta && tileMeta.interact && tapDist <= 2.8);

    const kids = ui.controlMode === 'kids';

    if (kids) {
      // ── Kids command staging (Blockheads-style queue) ──
      // Tap far/near anything to queue work; character walks and does it.
      if (mobAtTap && tapDist < 2.8) {
        doPlayerAttack(s);
      } else if (tileMeta && tileMeta.interact) {
        const r = queueUse(input, ptx, pty);
        toast(ui, r === 'cancel' ? 'Canceled use' : r === 'full' ? 'Too many jobs' : 'Will use that');
      } else if (slot && slot.id === 'boat') {
        handleUse(s);
      } else if (player.inBoat) {
        handleUse(s);
      } else if (slot && (slot.id === 'bucket' || slot.id === 'bucket_water')) {
        const r = tryBucket(inv, world, player, ptx, pty);
        if (r) {
          if (r.ok) { sfxPlace(); toast(ui, r.msg); }
          else toast(ui, r.reason);
        } else {
          setMoveTarget(input, ptx, pty);
        }
      } else if (slot && isBlockItem(slot.id) && (tid === BLOCK.AIR || tid === BLOCK.WATER
          || isAttachableBlock(slot.id))) {
        // Stage a build (or cancel if same tile already staged)
        // If already in reach, place immediately for snappy building
        if (tapDist <= 4.2) {
          const placed = tryPlace(player, world, ptx, pty, slot.id);
          if (placed) {
            if (!player.godMode) removeItem(inv, slot.id, 1);
            sfxPlace();
            const m = BLOCK_META[slot.id];
            spawnBurst(s.particles, placed.tx + 0.5, placed.ty + 0.5, (m && m.color) || '#fff', 5);
            if (slot.id === BLOCK.TORCH) {
              setTorchFacing(world.meta, placed.tx, placed.ty, placed.attach || 'floor');
            }
            if (slot.id === BLOCK.LANTERN) {
              setLanternMode(world.meta, placed.tx, placed.ty, placed.attach || 'hang');
            }
            if (slot.id === BLOCK.CHEST) getChest(world.meta, placed.tx, placed.ty);
            tickGravityNear(world, placed.tx, placed.ty, 6);
          } else {
            const r = queuePlace(input, ptx, pty, slot.id);
            toast(ui, r === 'cancel' ? 'Canceled build' : r === 'full' ? 'Too many jobs' : 'Will build there');
          }
        } else {
          const r = queuePlace(input, ptx, pty, slot.id);
          toast(ui, r === 'cancel' ? 'Canceled build' : r === 'full' ? 'Too many jobs' : 'Will build there');
        }
      } else if (tid !== BLOCK.AIR && tid !== BLOCK.WATER && BLOCK_META[tid] && BLOCK_META[tid].mine > 0
          && BLOCK_META[tid].mine < 50) {
        // Stage dig on solid blocks (tap again to cancel)
        const r = queueMine(input, world, ptx, pty);
        if (r === 'set') {
          if (!ui._kidsMineToast) {
            ui._kidsMineToast = true;
            toast(ui, 'Will dig that — tap more to queue');
          }
        } else if (r === 'cancel') {
          toast(ui, 'Canceled dig');
        } else if (r === 'full') {
          toast(ui, 'Too many jobs');
        }
      } else if (slot && isFood(slot.id) && tapDist < 1.5) {
        const ate = tryEat(inv, player);
        if (ate && ate.ok) {
          sfxPickup();
          toast(ui, 'Ate ' + ate.food.name);
        }
      } else if (isHostileNearPlayer(ents, player, 2.2) && tapDist < 2.5) {
        doPlayerAttack(s);
      } else {
        // Walk there
        const r = setMoveTarget(input, ptx, pty);
        if (r === 'set' && !ui._kidsGoToast) {
          ui._kidsGoToast = true;
          toast(ui, 'Walking there — tap blocks to dig · pick blocks to build');
        } else if (r === 'cancel') {
          toast(ui, 'Canceled walk');
        }
      }
    } else if (mobAtTap) {
      doPlayerAttack(s);
    } else if (canInteractTap) {
      handleUse(s);
    } else if (slot && slot.id === 'boat') {
      handleUse(s);
    } else if (player.inBoat && (tid === BLOCK.AIR || tid === BLOCK.WATER || isSolid(world, ptx, pty))) {
      handleUse(s);
    } else if (slot && (slot.id === 'bucket' || slot.id === 'bucket_water')) {
      const r = tryBucket(inv, world, player, ptx, pty);
      if (r) {
        if (r.ok) { sfxPlace(); toast(ui, r.msg); }
        else toast(ui, r.reason);
      }
    } else if (slot && isBlockItem(slot.id)) {
      const placed = tryPlace(player, world, ptx, pty, slot.id);
      if (placed) {
        if (!player.godMode) removeItem(inv, slot.id, 1);
        sfxPlace();
        const m = BLOCK_META[slot.id];
        const bx = placed.tx;
        const by = placed.ty;
        spawnBurst(s.particles, bx + 0.5, by + 0.5, (m && m.color) || '#fff', 5);
        if (slot.id === BLOCK.BED) unlockMilestone(world.meta, stats, ui, 'first_bed');
        if (slot.id === BLOCK.FURNACE) unlockMilestone(world.meta, stats, ui, 'first_furnace');
        if (slot.id === BLOCK.TORCH) {
          unlockMilestone(world.meta, stats, ui, 'first_torch');
          setTorchFacing(world.meta, bx, by, placed.attach || 'floor');
        }
        if (slot.id === BLOCK.LANTERN) {
          unlockMilestone(world.meta, stats, ui, 'first_lantern');
          setLanternMode(world.meta, bx, by, placed.attach || 'hang');
        }
        if (slot.id === BLOCK.CAMPFIRE) unlockMilestone(world.meta, stats, ui, 'first_campfire');
        if (slot.id === BLOCK.PLATFORM) unlockMilestone(world.meta, stats, ui, 'first_platform');
        if (slot.id === BLOCK.CHEST) getChest(world.meta, bx, by);
        tickGravityNear(world, bx, by, 6);
      }
    } else if (slot && isFood(slot.id) && tid !== BLOCK.AIR && tid !== BLOCK.WATER) {
      // ignore
    } else if (slot && isFood(slot.id)) {
      const ate = tryEat(inv, player);
      if (ate && ate.ok) {
        sfxPickup();
        toast(ui, 'Ate ' + ate.food.name);
        unlockMilestone(world.meta, stats, ui, 'fed');
      }
    } else if (
      tid === BLOCK.AIR || tid === BLOCK.WATER || tid === BLOCK.LEAVES
      || (slot && isTool(slot.id))
      || !slot
    ) {
      if (isHostileNearPlayer(ents, player, 2.8) || (slot && isWeapon(slot.id))) {
        doPlayerAttack(s);
      }
    }
  }

  // Gravity after mine
  if (result.mined) {
    tickGravityNear(world, result.mined.tx, result.mined.ty, 8);
  }

  // Entities
  const picked = updateDrops(ents, world, player, inv, dt);
  if (picked.length) sfxPickup();
  updateCritters(ents, world, dt);

  // Hostiles (skipped / harmless in creative)
  const hostHits = updateHostiles(ents, world, player, dt, s.timeOfDay, ui, {
    hostiles: diff.hostiles && !player.godMode,
    damageMul: diff.mobDamageMul,
  });
  for (const hh of hostHits) {
    if (player.godMode) break;
    player.hp -= hh.dmg;
    player.invuln = 0.7;
    sfxHurt();
    const label = hh.kind === 'zombie' ? 'Zombie hit!'
      : hh.kind === 'skeleton' ? 'Skeleton hit!'
      : hh.kind === 'wolf' ? 'Wolf bite!'
      : 'Hit!';
    toast(ui, label);
  }

  updateWeather(s, dt);

  // Recover boat if left on shore
  if (!player.inBoat && s._hadBoat) {
    addItem(inv, 'boat', 1);
    s._hadBoat = false;
    toast(ui, 'Picked up boat');
  }
  if (player.inBoat) s._hadBoat = true;

  // Interact prompt + big touch action (iPad has no F / X keys)
  const hit = nearInteract(world, world.meta, player.x, player.y);
  const slot = selectedSlot(inv);
  const touch = !!ui.showTouch;
  const kids = ui.controlMode === 'kids';
  const qn = (input.kidsQueue && input.kidsQueue.length) || 0;
  const hostileNear = isHostileNearPlayer(ents, player, 2.8);

  // Context button for pure touch: Use / Eat / Hit / Boat
  ui.touchAct = null;
  if (touch || kids) {
    if (hit) {
      let label = 'Use';
      if (hit.kind === 'door') label = isDoorOpen(world.meta, hit.x, hit.y) ? 'Close' : 'Open';
      else if (hit.kind === 'chest') label = 'Chest';
      else if (hit.kind === 'bed') label = 'Sleep';
      else if (hit.kind === 'furnace') label = 'Smelt';
      else if (hit.kind === 'campfire') label = 'Warm';
      else if (hit.kind === 'craft') label = 'Craft';
      ui.touchAct = { kind: 'use', label };
    } else if (player.inBoat) {
      ui.touchAct = { kind: 'use', label: 'Leave' };
    } else if (slot && slot.id === 'boat') {
      ui.touchAct = { kind: 'use', label: 'Sail' };
    } else if (slot && isFood(slot.id)) {
      ui.touchAct = { kind: 'eat', label: 'Eat' };
    } else if (hostileNear) {
      ui.touchAct = { kind: 'attack', label: 'Hit' };
    }
  }

  if (kids) {
    // Only say something when there IS something to say. The idle "tap to walk"
    // line sat permanently across the middle of the play area and repeated the
    // KIDS MODE chip word for word.
    ui.prompt = qn
      ? (qn + ' job' + (qn > 1 ? 's' : '') + ' · big button = use/eat · drag to look')
      : (ui.touchAct
        ? ('Tap ' + ui.touchAct.label + ' button · or tap the world')
        : null);
  } else if (hit) {
    ui.prompt = touch
      ? ('Tap ' + (ui.touchAct ? ui.touchAct.label : 'Use') + ' or tap the block')
      : ((hit.kind === 'door' ? 'F / Tap · ' + (isDoorOpen(world.meta, hit.x, hit.y) ? 'Close door' : 'Open door')
        : hit.kind === 'chest' ? 'F / Tap · Open chest'
        : hit.kind === 'bed' ? 'F / Tap · Sleep'
        : hit.kind === 'furnace' ? 'F / Tap · Furnace'
        : hit.kind === 'campfire' ? 'F / Tap · Warm up'
        : hit.kind === 'craft' ? 'F / Tap · Craft'
        : 'F / Tap · Use'));
  } else if (touch) {
    ui.prompt = ui.touchAct
      ? ('Tap ' + ui.touchAct.label)
      : (slot && isBlockItem(slot.id)
        ? 'Tap to place · hold to dig · stick to move'
        : 'Stick to move · hold to dig · tap enemies');
  } else {
    ui.prompt = slot && slot.id === 'boat' ? 'F · Launch boat (in water)'
      : player.inBoat ? 'F · Leave boat'
      : slot && isFood(slot.id) ? 'F · Eat'
      : slot && (slot.id === 'bucket' || slot.id === 'bucket_water') ? 'Tap to use bucket'
      : slot && isAttachableBlock(slot.id) ? 'Tap wall/floor to place · hold to dig'
      : slot && isBlockItem(slot.id) ? 'Tap empty tile to place · hold to dig'
      : 'Hold to dig · tap enemies to fight';
  }

  updateCamera(s, dt);
  updateWorldServices(s, dt);
}

export function handleUse(s) {
  const { world, player, inv, ui, stats } = s;
  // Prefer eat if food selected and no interact
  const hit = nearInteract(world, world.meta, player.x, player.y);

  if (hit && hit.kind === 'door') {
    const open = toggleDoor(world.meta, hit.x, hit.y);
    sfxDoor();
    toast(ui, open ? 'Door opened' : 'Door closed');
    return;
  }
  if (hit && hit.kind === 'chest') {
    ui.craftOpen = false;
    ui.bagOpen = false;
    ui.invPick = null;
    ui.chestOpen = { x: hit.x, y: hit.y, slots: getChest(world.meta, hit.x, hit.y) };
    toast(ui, 'Chest open — move items with taps');
    return;
  }
  if (hit && hit.kind === 'bed') {
    const r = trySleep(player, world, s.timeOfDay, { x: hit.x, y: hit.y });
    if (r.ok) {
      s.timeOfDay = r.timeOfDay;
      if (typeof sfxSleep === 'function') sfxSleep(); else sfxCraft();
      toast(ui, r.setSpawn ? 'Slept · spawn set at bed' : 'Slept until morning');
      unlockMilestone(world.meta, stats, ui, 'first_bed');
    } else {
      toast(ui, r.reason || 'Can\'t sleep');
    }
    return;
  }
  if (hit && hit.kind === 'campfire') {
    player.hp = Math.min(player.maxHp, player.hp + 8);
    player.energy = Math.min(player.maxEnergy, player.energy + 25);
    player.hunger = Math.min(player.maxHunger, player.hunger + 5);
    sfxCraft();
    toast(ui, 'Warmed by the campfire');
    unlockMilestone(world.meta, stats, ui, 'first_campfire');
    return;
  }
  if (hit && (hit.kind === 'furnace' || hit.kind === 'craft')) {
    ui.chestOpen = null;
    ui.bagOpen = null;
    ui.bagOpen = false;
    ui.craftOpen = true;
    ui.craftScroll = 0;
    if (hit.kind === 'furnace') {
      ui.craftTab = 'smelt';
      toast(ui, 'Furnace — smelt ores into ingots');
    } else {
      // Full workbench: show everything, start on tools
      ui.craftTab = 'all';
      toast(ui, 'Workbench — all recipes');
    }
    const rows = typeof recipesInTab === 'function'
      ? recipesInTab(ui.craftTab, world, player.x, player.y)
      : [];
    const ready = rows.find(row => row.stationOk && canCraft(inv, row.recipe));
    ui.craftSelected = ready ? ready.recipe.id : (rows[0] && rows[0].recipe.id) || null;
    return;
  }

  // Boat
  if (player.inBoat) {
    if (tryDismountBoat(player, inv)) {
      s._hadBoat = false;
      toast(ui, 'Left the boat');
      return;
    }
  } else {
    const boat = tryMountBoat(inv, player, world);
    if (boat) {
      if (boat.ok) {
        unlockMilestone(world.meta, stats, ui, 'first_boat');
        toast(ui, boat.msg);
        sfxPlace();
      } else if (selectedSlot(inv) && selectedSlot(inv).id === 'boat') {
        toast(ui, boat.reason);
      }
      if (boat.ok || (selectedSlot(inv) && selectedSlot(inv).id === 'boat')) return;
    }
  }

  const ate = tryEat(inv, player);
  if (ate) {
    if (ate.ok) {
      sfxPickup();
      toast(ui, 'Ate ' + ate.food.name);
      unlockMilestone(world.meta, stats, ui, 'fed');
    } else toast(ui, ate.reason);
  }
}

export function gameRender(ctx) {
  if (!session) return;
  const s = session;
  // Any touchscreen (iPad reports fine pointer sometimes — also check maxTouchPoints)
  let canTouch;
  try {
    canTouch = !!(navigator.maxTouchPoints > 0
      || window.matchMedia('(pointer: coarse)').matches
      || window.matchMedia('(hover: none)').matches);
  } catch (_) {
    canTouch = true;
  }
  // Capability alone over-reports: touchscreen laptops get a JUMP pad nobody
  // wants. Follow the device actually in use — mouse or keyboard hides the
  // pads, the next finger tap brings them back.
  const lastPtr = s.input && s.input.lastPointerType;
  s.ui.showTouch = canTouch && lastPtr !== 'mouse';
  if (s.input) s.input._touchUI = s.ui.showTouch;
  renderWorld(ctx, s.world, s.player, s.inv, s.cam, s.timeOfDay, s.ui, s.particles, s.ents);
  if (s.paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = '700 28px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Paused', W / 2, H / 2);
    ctx.font = '600 14px system-ui';
    ctx.fillStyle = '#9ec5b0';
    // Name something the player can actually do. Children on an iPad have no
    // Esc key, and the old line offered nothing else.
    ctx.fillText(s.ui.showTouch ? 'Tap anywhere to keep playing'
                                : 'Click or press Esc to keep playing', W / 2, H / 2 + 28);
  }
}

export function getInvArray(s, from) {
  if (from === 'hotbar') return s.inv.hotbar;
  if (from === 'bag') return s.inv.bag;
  if (from === 'chest' && s.ui.chestOpen) return s.ui.chestOpen.slots;
  return null;
}

function hitTest(hits, x, y) {
  if (!hits) return null;
  // Later hits drawn on top — search reverse
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
  }
  return null;
}

function activeMenuHits(ui) {
  if (ui.creativeOpen) return ui.creativeHit || [];
  if (ui.bagOpen) return ui.bagHit || [];
  if (ui.chestOpen) return ui.chestHit || [];
  if (ui.craftOpen) return ui.craftHit || [];
  return [];
}

function slotLabel(slotOrId) {
  if (slotOrId == null) return '';
  if (typeof slotOrId === 'object') {
    const n = itemName(slotOrId.id);
    return slotOrId.count > 1 ? n + ' ×' + slotOrId.count : n;
  }
  return itemName(slotOrId);
}

function giveCreativeItem(inv, id) {
  const count = creativeGiveCount(id);
  const left = addItem(inv, id, count);
  if (isTool(id)) {
    for (const arr of [inv.hotbar, inv.bag]) {
      for (const s of arr) {
        if (s && s.id === id && s.durability == null && TOOLS[id]) {
          s.durability = TOOLS[id].durability;
        }
      }
    }
  }
  syncEquippedTool(inv);
  return { count, left, got: count - left };
}

/** Destroy held / picked inventory stack (creative void). */
function voidInvPick(s) {
  const ui = s.ui;
  if (!ui.invPick) return false;
  const arr = getInvArray(s, ui.invPick.from);
  if (!arr || !arr[ui.invPick.i]) {
    ui.invPick = null;
    return false;
  }
  const name = slotLabel(arr[ui.invPick.i]);
  arr[ui.invPick.i] = null;
  ui.invPick = null;
  syncEquippedTool(s.inv);
  sfxPlace();
  toast(ui, 'Removed ' + name);
  return true;
}

function voidInvDrag(s) {
  const ui = s.ui;
  const d = ui.invDrag;
  if (!d) return false;
  const arr = getInvArray(s, d.from);
  if (arr && arr[d.i]) {
    const name = slotLabel(arr[d.i]);
    arr[d.i] = null;
    syncEquippedTool(s.inv);
    sfxPlace();
    toast(ui, 'Removed ' + name);
  }
  ui.invDrag = null;
  ui.invPick = null;
  return true;
}

/**
 * Double-click auto-move: hotbar ↔ bag, or creative give.
 * @returns {boolean} handled
 */
export function handleInvDoubleClick(s, from, i) {
  const arr = getInvArray(s, from);
  if (!arr || !arr[i]) return false;
  const inv = s.inv;
  const ui = s.ui;

  // Creative catalog double-click is handled separately (give)
  if (from === 'hotbar') {
    if (stowToBag(inv, i)) {
      sfxPickup();
      toast(ui, '→ Backpack');
      syncEquippedTool(inv);
      ui.invPick = null;
      return true;
    }
    toast(ui, 'Backpack full');
    return true;
  }
  if (from === 'bag') {
    if (transferSlot(inv.bag, i, inv.hotbar)) {
      sfxPickup();
      toast(ui, '→ Hotbar');
      syncEquippedTool(inv);
      ui.invPick = null;
      return true;
    }
    toast(ui, 'Hotbar full');
    return true;
  }
  if (from === 'chest') {
    // Prefer hotbar, then bag
    if (transferSlot(arr, i, inv.hotbar) || transferSlot(arr, i, inv.bag)) {
      sfxPickup();
      toast(ui, 'Took item');
      ui.invPick = null;
      return true;
    }
  }
  return false;
}

export function handleInvSlotClick(s, from, i, opts) {
  opts = opts || {};
  const ui = s.ui;
  const arr = getInvArray(s, from);
  if (!arr) return;

  // Double-click auto-move
  if (opts.doubleClick) {
    handleInvDoubleClick(s, from, i);
    return;
  }

  // First tap: pick up if slot has item, or clear pick
  if (!ui.invPick) {
    if (!arr[i]) {
      // empty — nothing
      return;
    }
    ui.invPick = { from, i };
    return;
  }

  // Same slot → cancel
  if (ui.invPick.from === from && ui.invPick.i === i) {
    ui.invPick = null;
    return;
  }

  const fromArr = getInvArray(s, ui.invPick.from);
  if (!fromArr || !fromArr[ui.invPick.i]) {
    ui.invPick = null;
    return;
  }

  if (moveOrSwap(fromArr, ui.invPick.i, arr, i)) {
    sfxPickup();
    ui.invPick = null;
    syncEquippedTool(s.inv);
  } else {
    toast(ui, 'Can\'t move there');
  }
}

export function stowHotbarToBag(s) {
  let moved = 0;
  // Stow from end of hotbar (keep selected tool if possible)
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    if (i === s.inv.selected) continue;
    if (s.inv.hotbar[i] && stowToBag(s.inv, i)) moved++;
  }
  if (moved) {
    sfxPlace();
    toast(s.ui, 'Stowed ' + moved + ' stack' + (moved > 1 ? 's' : '') + ' in backpack');
  } else {
    toast(s.ui, 'Nothing to stow (or backpack full)');
  }
}

/**
 * Close whichever canvas panel is open. Since the chrome row hides behind a
 * panel, the ✕ was the only way out on touch — tapping the dimmed area
 * outside is the gesture people already expect, and costs no new UI.
 */
/**
 * Drop one-shot input flags that would otherwise queue up while paused.
 * Held state (movement keys, sprint) is deliberately left alone — it re-reads
 * from the keyboard every frame anyway.
 */
function clearLatchedInput(input) {
  input.craftToggle = false;
  input.bagToggle = false;
  input.creativeToggle = false;
  input.modeToggle = false;
  input.flyToggle = false;
  input.usePressed = false;
  input.attackPressed = false;
  input.jumpPressed = false;
  input.jump = false;
  input.hotbarTap = -1;
  input.tapPlace = null;
  input.holdMining = false;
  input.mineTx = null;
  input.mineTy = null;
}

function closeOpenPanel(ui) {
  if (ui.creativeOpen) ui.creativeOpen = false;
  else if (ui.bagOpen) ui.bagOpen = false;
  else if (ui.chestOpen) ui.chestOpen = null;
  else if (ui.craftOpen) ui.craftOpen = false;
  ui.invPick = null;
  ui.hoverTip = null;
  ui.invDrag = null;
}

/** True when the point is outside the panel currently drawn. */
function outsidePanel(ui, x, y) {
  const r = ui.panelRect;
  if (!r) return false;
  return x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h;
}

/**
 * Unified pointer handler for open inventory / creative / chest / craft menus.
 * phase: 'down' | 'move' | 'up'
 */
export function gameUiPointer(x, y, phase) {
  if (!session) return false;
  const s = session;
  const ui = s.ui;
  const inv = s.inv;
  const menuOpen = !!(ui.creativeOpen || ui.bagOpen || ui.chestOpen || ui.craftOpen);
  if (!menuOpen) {
    ui.hoverTip = null;
    ui.invDrag = null;
    return false;
  }

  // Tap outside the panel to dismiss. Never while an item is mid-drag or
  // picked up, or a fumbled drop would close the panel under the player.
  if (phase === 'down' && !ui.invDrag && !ui.invPick && outsidePanel(ui, x, y)) {
    closeOpenPanel(ui);
    return true;
  }

  const hits = activeMenuHits(ui);
  const h = hitTest(hits, x, y);

  // ——— MOVE: tooltips + drag follow ———
  if (phase === 'move') {
    // Tooltip
    if (h && (h.kind === 'slot' || h.kind === 'give')) {
      let text = '';
      if (h.kind === 'give') text = slotLabel(h.id);
      else {
        const arr = getInvArray(s, h.from);
        const slot = arr && arr[h.i];
        text = slot ? slotLabel(slot) : '';
      }
      ui.hoverTip = text ? { text, x, y } : null;
    } else if (ui.invPick) {
      const arr = getInvArray(s, ui.invPick.from);
      const slot = arr && arr[ui.invPick.i];
      ui.hoverTip = slot ? { text: slotLabel(slot) + ' (click to place)', x, y } : null;
    } else {
      ui.hoverTip = null;
    }

    if (ui.invDrag) {
      const dx = x - ui.invDrag.originX;
      const dy = y - ui.invDrag.originY;
      if (!ui.invDrag.active && (dx * dx + dy * dy) > 64) {
        ui.invDrag.active = true;
        ui.invPick = null; // drag takes over click-click
      }
      ui.invDrag.x = x;
      ui.invDrag.y = y;
    }
    return true;
  }

  // ——— DOWN: begin potential drag / click ———
  if (phase === 'down') {
    if (h && h.kind === 'slot') {
      const arr = getInvArray(s, h.from);
      const slot = arr && arr[h.i];
      if (slot) {
        ui.invDrag = {
          from: h.from,
          i: h.i,
          id: slot.id,
          count: slot.count,
          durability: slot.durability,
          originX: x,
          originY: y,
          x,
          y,
          active: false,
          t0: performance.now(),
        };
      } else {
        ui.invDrag = null;
      }
    } else if (h && h.kind === 'give') {
      ui.invDrag = {
        from: 'creative',
        i: -1,
        id: h.id,
        count: creativeGiveCount(h.id),
        originX: x,
        originY: y,
        x,
        y,
        active: false,
        t0: performance.now(),
        give: true,
      };
    } else {
      ui.invDrag = null;
    }
    return true;
  }

  // ——— UP: complete click, drag-drop, double-click ———
  if (phase === 'up') {
    const drag = ui.invDrag;
    const wasDragging = !!(drag && drag.active);
    ui.invDrag = null;

    // Drag-drop completion
    if (wasDragging && drag) {
      // Drop on inventory slot
      if (h && h.kind === 'slot') {
        if (drag.give) {
          // Dragged from creative catalog → place into slot
          const arr = getInvArray(s, h.from);
          if (arr) {
            const n = creativeGiveCount(drag.id);
            if (!arr[h.i]) {
              arr[h.i] = { id: drag.id, count: n };
              if (isTool(drag.id) && TOOLS[drag.id]) arr[h.i].durability = TOOLS[drag.id].durability;
              sfxPickup();
              toast(ui, '+ ' + itemName(drag.id));
              syncEquippedTool(inv);
            } else if (arr[h.i].id === drag.id && !isTool(drag.id) && arr[h.i].count < 99) {
              arr[h.i].count = Math.min(99, arr[h.i].count + n);
              sfxPickup();
            } else {
              // stack into inv any free slot
              const r = giveCreativeItem(inv, drag.id);
              if (r.got > 0) { sfxPickup(); toast(ui, '+ ' + itemName(drag.id)); }
              else toast(ui, 'Inventory full');
            }
          }
        } else {
          const fromArr = getInvArray(s, drag.from);
          const toArr = getInvArray(s, h.from);
          if (fromArr && toArr && fromArr[drag.i]) {
            if (moveOrSwap(fromArr, drag.i, toArr, h.i)) {
              sfxPickup();
              syncEquippedTool(inv);
            }
          }
        }
        ui.invPick = null;
        return true;
      }

      // Drop on creative catalog / void while holding inventory item → destroy
      if (!drag.give && (h && (h.kind === 'give' || h.kind === 'void') || (ui.creativeOpen && !h))) {
        // recreate drag state briefly for void
        ui.invDrag = drag;
        voidInvDrag(s);
        return true;
      }

      // Drop creative item onto empty panel → add to inventory
      if (drag.give && ui.creativeOpen) {
        const r = giveCreativeItem(inv, drag.id);
        if (r.got > 0) {
          sfxPickup();
          toast(ui, '+ ' + itemName(drag.id) + (r.got > 1 ? ' ×' + r.got : ''));
        } else toast(ui, 'Inventory full');
        return true;
      }

      return true;
    }

    // Non-drag click handling
    if (!h) {
      // Click empty creative backdrop with a picked inv item → void
      if (ui.creativeOpen && ui.invPick && (ui.invPick.from === 'hotbar' || ui.invPick.from === 'bag')) {
        voidInvPick(s);
        return true;
      }
      return true;
    }

    if (h.kind === 'close') {
      if (ui.creativeOpen) ui.creativeOpen = false;
      else if (ui.bagOpen) ui.bagOpen = false;
      else if (ui.chestOpen) ui.chestOpen = null;
      else if (ui.craftOpen) ui.craftOpen = false;
      ui.invPick = null;
      ui.hoverTip = null;
      return true;
    }
    if (h.kind === 'scroll') {
      ui.creativeScroll = Math.max(0, (ui.creativeScroll || 0) + h.dir);
      return true;
    }
    if (h.kind === 'stow') {
      stowHotbarToBag(s);
      return true;
    }
    if (h.kind === 'void') {
      if (ui.invPick) voidInvPick(s);
      return true;
    }

    // Creative give (click)
    if (h.kind === 'give') {
      // Holding inv item + click catalog → delete held item
      if (ui.invPick && (ui.invPick.from === 'hotbar' || ui.invPick.from === 'bag')) {
        voidInvPick(s);
        return true;
      }
      // Double-click give
      const key = 'give:' + h.id;
      const now = performance.now();
      const last = ui.invClickLast;
      const dbl = last && last.key === key && (now - last.t) < 380;
      ui.invClickLast = { key, t: now };
      const times = dbl ? 2 : 1;
      let gotTotal = 0;
      for (let n = 0; n < times; n++) {
        const r = giveCreativeItem(inv, h.id);
        gotTotal += r.got;
        if (r.got <= 0) break;
      }
      if (gotTotal > 0) {
        sfxPickup();
        toast(ui, '+ ' + itemName(h.id) + (gotTotal > 1 ? ' ×' + gotTotal : ''));
      } else toast(ui, 'Inventory full');
      return true;
    }

    if (h.kind === 'slot') {
      const key = h.from + ':' + h.i;
      const now = performance.now();
      const last = ui.invClickLast;
      const dbl = last && last.key === key && (now - last.t) < 380;
      ui.invClickLast = { key, t: now };
      handleInvSlotClick(s, h.from, h.i, { doubleClick: dbl });
      return true;
    }

    // Craft panel passthrough for remaining kinds
    if (ui.craftOpen) {
      return gameClickCraft(x, y);
    }
    return true;
  }

  return true;
}

/** @deprecated use gameUiPointer — kept for craft-only path */
export function gameClickCraft(x, y) {
  if (!session) return false;
  const ui = session.ui;
  const inv = session.inv;
  // Prefer unified handler for inv menus
  if (ui.creativeOpen || ui.bagOpen || ui.chestOpen) {
    return gameUiPointer(x, y, 'up');
  }

  if (!ui.craftOpen) return false;

  if (outsidePanel(ui, x, y)) {
    closeOpenPanel(ui);
    return true;
  }

  const hits = ui.craftHit || [];
  // Process later hits first? No — check each, first match wins. Prefer specific actions.
  // Sort by kind priority: craft > tab > scroll > select > close
  const order = { craft: 0, tab: 1, scroll: 2, select: 3, close: 4 };
  const sorted = hits.slice().sort((a, b) => (order[a.kind] != null ? order[a.kind] : 9) - (order[b.kind] != null ? order[b.kind] : 9));

  for (const h of sorted) {
    if (x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h) continue;

    if (h.kind === 'close') {
      ui.craftOpen = false;
      return true;
    }
    if (h.kind === 'tab') {
      ui.craftTab = h.tab;
      ui.craftScroll = 0;
      ui.craftSelected = null;
      const rows = recipesInTab(ui.craftTab, session.world, session.player.x, session.player.y);
      const ready = rows.find(row => row.stationOk && canCraft(inv, row.recipe));
      ui.craftSelected = ready ? ready.recipe.id : (rows[0] && rows[0].recipe.id) || null;
      return true;
    }
    if (h.kind === 'scroll') {
      ui.craftScroll = Math.max(0, (ui.craftScroll || 0) + h.dir);
      return true;
    }
    if (h.kind === 'select') {
      ui.craftSelected = h.recipe.id;
      return true;
    }
    if (h.kind === 'craft') {
      const recipe = h.recipe;
      if (!h.stationOk) {
        toast(ui, stationHint(recipe.station) || 'Need a station');
        return true;
      }
      if (!canCraft(inv, recipe)) {
        const miss = missingMaterials(inv, recipe);
        if (miss.length) {
          const m = miss[0];
          toast(ui, 'Need ' + (m.need - m.have) + ' more ' + itemName(m.id));
        } else {
          toast(ui, 'Need more materials');
        }
        return true;
      }
      if (craft(inv, recipe)) {
        sfxCraft();
        toast(ui, '✓ Made ' + recipe.name + '!');
        syncEquippedTool(inv);
        unlockMilestone(session.world.meta, session.stats, ui, 'first_craft');
        if (isTool(recipe.out[0])) unlockMilestone(session.world.meta, session.stats, ui, 'first_tool');
      }
      return true;
    }
  }
  return true; // swallow clicks while open
}

/** True if a hostile is close enough that a swing should connect. */
export function isHostileNearPlayer(ents, player, range) {
  range = range == null ? 2.8 : range;
  if (!ents || !ents.hostiles) return false;
  for (const h of ents.hostiles) {
    if (Math.hypot(wrapDeltaX(player.x, h.x), (player.y - 0.5) - h.y) < range) return true;
  }
  return false;
}

/**
 * Tap hit-test: is the tapped tile on/near a living mob (hostiles first, then critters)?
 * Lets the player click an enemy to attack without the Attack button.
 */
export function findMobAtTile(ents, player, tx, ty) {
  if (!ents) return null;
  const lists = [ents.hostiles, ents.critters];
  let best = null;
  let bestD = 1.65;
  for (const list of lists) {
    if (!list) continue;
    for (const m of list) {
      // Mob body occupies roughly [feet-h, feet] vertically and ~w around x
      const mx = m.x;
      const my = m.y - (m.h || 1) * 0.5;
      const d = Math.hypot(wrapDeltaX(tx + 0.5, mx), (ty + 0.5) - my);
      const reach = 0.95 + (m.w || 0.6) * 0.5;
      if (d < reach && d < bestD) {
        bestD = d;
        best = m;
      }
    }
  }
  // Also accept "near player + near tap" for hostiles slightly off-tile
  if (!best && ents.hostiles) {
    for (const h of ents.hostiles) {
      const toPlayer = Math.hypot(wrapDeltaX(player.x, h.x), (player.y - 0.5) - h.y);
      const toTap = Math.hypot(wrapDeltaX(tx + 0.5, h.x), (ty + 0.5) - (h.y - (h.h || 1) * 0.5));
      if (toPlayer < 3.2 && toTap < 2.0) return h;
    }
  }
  return best;
}

export function doPlayerAttack(s) {
  const { player, inv, ents, world, ui, stats } = s;
  if (player.attackCd > 0) return;
  const diff = getDifficulty(s.difficultyId);
  const result = tryMeleeAttack(player, inv, ents, world, diff.playerDamageMul);
  sfxMine();
  if (result.hits > 0) {
    const col = result.fist ? '#ffcc88' : '#fff';
    spawnBurst(s.particles, player.x + player.facing * 0.8, player.y - 0.7, col, result.fist ? 8 : 6);
    if (result.kills > 0) {
      toast(ui, result.fist ? 'Punched out!' : 'Monster defeated!');
      unlockMilestone(world.meta, stats, ui, 'first_kill');
    }
  }
  const tool = getMeleeWeapon(inv);
  if (tool && tool.weapon) unlockMilestone(world.meta, stats, ui, 'first_sword');
}

export function getSession() {
  return session;
}
