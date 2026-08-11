import {
  DAY_LEN, SURFACE_Y, WORLD_H, W, H,
} from '../core/constants.js';
import { WORLD_W, applyWorldSize, worldSizePreset } from '../core/worldSize.js';
import { getDifficulty, applyStarterKit, creativeGiveCount } from '../core/difficulty.js';
import { BLOCK, BLOCK_META } from '../content/blocks.js';
import { TOOLS, isTool, isFood, isWeapon } from '../content/tools.js';
import { isBlockItem, tileKey, itemName } from '../content/items.js';
import {
  generateWorldAsync, deserializeWorld, getTile, flushLight, tickGravityNear,
  wrapDeltaX, wrapX,
} from '../world/index.js';
import {
  makePlayer, updatePlayer, tryPlace, findSpawn, isAttachableBlock,
} from '../player/index.js';
import {
  makeInventory, addItem, removeItem, selectedSlot, selectHotbar,
  syncEquippedTool, toolPowerFor, canCraft, craft, deserializeInv,
  moveOrSwap, stowToBag, HOTBAR_SIZE, getMeleeWeapon, getHeldTool,
} from '../inventory/inventory.js';
import {
  makeWorldMeta, getChest, removeChest, nearInteract, isDoorOpen, toggleDoor,
  tryEat, trySleep, tryBucket, tryMountBoat, tryDismountBoat,
  unlockMilestone, recipesInTab, stationAvailable, missingMaterials, stationHint,
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

export async function enterPlay(continueSave, extra) {
  extra = extra || {};
  session = await createSession({
    continueSave: !!continueSave,
    worldSizeId: extra.worldSizeId,
    difficultyId: extra.difficultyId,
    seed: extra.seed,
    onProgress: extra.onProgress,
    input: extra.input,
  });
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

  // Pause
  if (input.pauseToggle) {
    s.paused = !s.paused;
    input.pauseToggle = false;
    if (s.paused) toast(ui, 'Paused — Esc to resume');
  }
  if (s.paused) return;

  // Zoom
  if (input.zoomDelta) {
    ui.zoom = Math.max(0.7, Math.min(1.6, (ui.zoom || 1) + input.zoomDelta * 0.1));
    cam.zoom = ui.zoom;
    input.zoomDelta = 0;
  }

  const diff = getDifficulty(s.difficultyId);
  player.godMode = !!(diff.creative || diff.invincible);

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

  // Promote long-press → mine; refresh hover after hold state is known
  pollInput(input, ui.mode, cam);
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
    sfxJump();
    input.jumpPressed = false;
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
  if (input.pointerDown && !input.holdMining) {
    input.mineTx = null;
    input.mineTy = null;
  } else if (input.holdMining && input.placeTx != null) {
    // Keep mine locked to the held tile
    input.mineTx = input.placeTx;
    input.mineTy = input.placeTy;
  }

  const prevX = player.x;
  const result = updatePlayer(player, world, input, dt, minePower);

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

    if (mobAtTap) {
      doPlayerAttack(s);
    } else if (slot && (slot.id === 'bucket' || slot.id === 'bucket_water')) {
      const r = tryBucket(inv, world, player, ptx, pty);
      if (r) {
        if (r.ok) { sfxPlace(); toast(ui, r.msg); }
        else toast(ui, r.reason);
      }
    } else if (slot && isBlockItem(slot.id)) {
      const placed = tryPlace(player, world, ptx, pty, slot.id);
      if (placed) {
        // Creative: infinite blocks — do not consume
        if (!player.godMode) removeItem(inv, slot.id, 1);
        sfxPlace();
        const m = BLOCK_META[slot.id];
        const bx = placed.tx;
        const by = placed.ty;
        spawnBurst(s.particles, bx + 0.5, by + 0.5, (m && m.color) || '#fff', 5);
        if (slot.id === BLOCK.BED) unlockMilestone(world.meta, stats, ui, 'first_bed');
        if (slot.id === BLOCK.FURNACE) unlockMilestone(world.meta, stats, ui, 'first_furnace');
        if (slot.id === BLOCK.TORCH) unlockMilestone(world.meta, stats, ui, 'first_torch');
        if (slot.id === BLOCK.CAMPFIRE) unlockMilestone(world.meta, stats, ui, 'first_campfire');
        if (slot.id === BLOCK.PLATFORM) unlockMilestone(world.meta, stats, ui, 'first_platform');
        if (slot.id === BLOCK.CHEST) getChest(world.meta, bx, by);
        tickGravityNear(world, bx, by, 6);
      }
    } else if (slot && isFood(slot.id) && tid !== BLOCK.AIR && tid !== BLOCK.WATER) {
      // Food selected on a solid tile: still allow eat on empty/air taps only via F; here ignore
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
      // Empty hand / tool / air tap near a close hostile still swings
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

  // Interact prompt
  const hit = nearInteract(world, world.meta, player.x, player.y);
  const slot = selectedSlot(inv);
  ui.prompt = hit
    ? (hit.kind === 'door' ? 'F · ' + (isDoorOpen(world.meta, hit.x, hit.y) ? 'Close door' : 'Open door')
      : hit.kind === 'chest' ? 'F · Open chest'
      : hit.kind === 'bed' ? 'F · Sleep (night) · set spawn'
      : hit.kind === 'furnace' ? 'F · Furnace'
      : hit.kind === 'campfire' ? 'F · Warm up'
      : hit.kind === 'craft' ? 'F · Craft'
      : 'F · Use')
    : (slot && slot.id === 'boat' ? 'F · Launch boat (in water)'
      : player.inBoat ? 'F · Leave boat'
      : slot && isFood(slot.id) ? 'F · Eat'
      : slot && (slot.id === 'bucket' || slot.id === 'bucket_water') ? 'Tap to use bucket'
      : slot && isAttachableBlock(slot.id) ? 'Tap wall/floor to place · hold to dig'
      : slot && isBlockItem(slot.id) ? 'Tap empty tile to place · hold to dig'
      : 'Hold to dig · ⚔ to fight'
      );

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
  s.ui.showTouch = window.matchMedia('(pointer: coarse)').matches;
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
    ctx.fillText('Esc to resume · ☰ for menu', W / 2, H / 2 + 28);
  }
}

export function getInvArray(s, from) {
  if (from === 'hotbar') return s.inv.hotbar;
  if (from === 'bag') return s.inv.bag;
  if (from === 'chest' && s.ui.chestOpen) return s.ui.chestOpen.slots;
  return null;
}

export function handleInvSlotClick(s, from, i) {
  const ui = s.ui;
  const arr = getInvArray(s, from);
  if (!arr) return;

  // First tap: pick up if slot has item, or clear pick
  if (!ui.invPick) {
    if (!arr[i]) {
      toast(ui, 'Empty slot');
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

export function gameClickCraft(x, y) {
  if (!session) return false;
  const ui = session.ui;
  const inv = session.inv;

  // Creative block picker
  if (ui.creativeOpen) {
    const hits = ui.creativeHit || [];
    for (const h of hits) {
      if (x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h) continue;
      if (h.kind === 'close') {
        ui.creativeOpen = false;
        return true;
      }
      if (h.kind === 'scroll') {
        ui.creativeScroll = Math.max(0, (ui.creativeScroll || 0) + h.dir);
        return true;
      }
      if (h.kind === 'give') {
        const count = creativeGiveCount(h.id);
        const left = addItem(inv, h.id, count);
        if (isTool(h.id)) {
          for (const arr of [inv.hotbar, inv.bag]) {
            for (const s of arr) {
              if (s && s.id === h.id && s.durability == null && TOOLS[h.id]) {
                s.durability = TOOLS[h.id].durability;
              }
            }
          }
        }
        syncEquippedTool(inv);
        if (left < count) {
          sfxPickup();
          toast(ui, '+ ' + itemName(h.id) + (count > 1 ? ' ×' + (count - left) : ''));
        } else {
          toast(ui, 'Inventory full');
        }
        return true;
      }
    }
    return true;
  }

  // Inventory (bag) UI
  if (ui.bagOpen) {
    const hits = ui.bagHit || [];
    for (const h of hits) {
      if (x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h) continue;
      if (h.kind === 'close') {
        ui.bagOpen = false;
        ui.invPick = null;
        return true;
      }
      if (h.kind === 'stow') {
        stowHotbarToBag(session);
        return true;
      }
      if (h.kind === 'slot') {
        handleInvSlotClick(session, h.from, h.i);
        return true;
      }
    }
    return true;
  }

  // Chest UI
  if (ui.chestOpen) {
    const hits = ui.chestHit || [];
    for (const h of hits) {
      if (x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h) continue;
      if (h.kind === 'close') {
        ui.chestOpen = null;
        ui.invPick = null;
        return true;
      }
      if (h.kind === 'slot') {
        handleInvSlotClick(session, h.from, h.i);
        return true;
      }
    }
    return true;
  }

  if (!ui.craftOpen) return false;

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
