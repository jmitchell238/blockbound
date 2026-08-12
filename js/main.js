/**
 * Blockbound composition root — DOM, rAF loop, Minecraft-style menu wiring.
 * Game rules live in session/systems; this file only bootstraps.
 */
import {
  W, H, SURFACE_Y, GAME_VERSION_LABEL, applyViewport, ORIENTATION,
} from './core/constants.js';
import { WORLD_W, WORLD_SIZE_PRESETS, applyWorldSize, worldSizePreset } from './core/worldSize.js';
import { DIFFICULTIES, DIFFICULTY_IDS, getDifficulty } from './core/difficulty.js';
import { randomSeed, parseSeed } from './core/seed.js';
import { BLOCK } from './content/blocks.js';
import { makeInput, bindInput } from './input/input.js';
import { loadTextures } from './textures/textures.js';
import {
  save, loadSave, writeSave, listWorlds, selectWorld, loadWorldData,
  createWorldEntry, renameWorld, deleteWorld, getWorldMeta, worldSummaryLine,
  formatSeedDisplay, persistSession, setControlMode, getControlMode, preferKidsOnTouch,
} from './save/save.js';
import { audioSetMuted, ensureAudio } from './audio/audio.js';
import {
  enterPlay, enterMenu, getSession, gameUpdate, gameRender, gameClickCraft, gameUiPointer,
} from './session/index.js';
import { skyColors, drawParallax, drawBlock } from './render/index.js';

const cv = document.getElementById('cv');
let ctx = null;
let last = performance.now();
/** title | worlds | create | options | play */
let screenName = 'title';

/** Selected world card id (not necessarily loaded). */
let selectedListId = null;
/** World currently open in the Edit screen */
let editingWorldId = null;
/** Draft difficulty/size on create screen */
let draftDiff = 'normal';
let draftSize = 'standard';
/** Prefill seed on create (from Edit → New World From This Seed) */
let prefillSeed = null;

const SPLASH = [
  'Mine · build · walk the world around',
  'Also try landscape!',
  'Seeds make identical worlds!',
  'Dig carefully near magma…',
  'Shift to sprint!',
  'A looping world awaits',
  'Creative mode has every block',
  'Name your worlds like a pro',
];

/** Single input instance bound to DOM and injected into the session. */
const appInput = makeInput();
let listenersReady = false;

function resizeCanvas() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  applyViewport(vw, vh);
  document.body.classList.toggle('landscape', ORIENTATION === 'landscape');
  document.body.classList.toggle('portrait', ORIENTATION === 'portrait');

  const scale = Math.min(vw / W, vh / H);
  const cssW = Math.floor(W * scale);
  const cssH = Math.floor(H * scale);
  cv.style.width = cssW + 'px';
  cv.style.height = cssH + 'px';
  // Keep stage box in sync so absolute menu screens cover the full canvas and center correctly
  const stage = document.getElementById('stage');
  if (stage) {
    stage.style.width = cssW + 'px';
    stage.style.height = cssH + 'px';
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.floor(W * dpr);
  cv.height = Math.floor(H * dpr);
  ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function eventToStage(e) {
  const rect = cv.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * W,
    y: ((e.clientY - rect.top) / rect.height) * H,
  };
}

function setScreen(name) {
  screenName = name;
  const isPlay = name === 'play';
  document.querySelectorAll('.menu-screen').forEach(el => {
    el.classList.toggle('hidden', el.dataset.screen !== name);
  });
  document.querySelectorAll('.play-chrome').forEach(el => {
    // Context action is shown only when there is something to do
    if (el.id === 'btnTouchAct') {
      el.classList.add('hidden');
      return;
    }
    el.classList.toggle('hidden', !isPlay);
  });
  // creative chrome only when playing creative
  if (!isPlay) syncCreativeChrome(null);
  else syncCreativeChrome(getSession());
  // Deferred PWA update reload (never mid-game)
  if (!isPlay && window.__bbPendingReload) {
    window.__bbPendingReload = false;
    safeReloadForUpdate();
  }
}

/** Big iPad button: Use / Eat / Hit / Boat — never requires a keyboard. */
function syncTouchActButton(session) {
  const btn = document.getElementById('btnTouchAct');
  if (!btn) return;
  if (screenName !== 'play' || !session || !session.ui || !session.ui.touchAct) {
    btn.classList.add('hidden');
    return;
  }
  const act = session.ui.touchAct;
  btn.classList.remove('hidden', 'act-use', 'act-eat', 'act-hit', 'act-boat');
  btn.textContent = act.label || 'Use';
  if (act.kind === 'eat') btn.classList.add('act-eat');
  else if (act.kind === 'attack') btn.classList.add('act-hit');
  else if (act.label === 'Sail' || act.label === 'Leave') btn.classList.add('act-boat');
  else btn.classList.add('act-use');
}

function pickSplash() {
  const el = document.getElementById('splashLine');
  if (!el) return;
  el.textContent = SPLASH[Math.floor(Math.random() * SPLASH.length)];
}

function updateControlModeUi() {
  const btn = document.getElementById('btnControlMode');
  const hint = document.getElementById('controlModeHint');
  const mode = getControlMode();
  if (btn) {
    btn.textContent = mode === 'kids'
      ? 'Controls: Kids (tap to walk)'
      : 'Controls: Stick (classic)';
  }
  if (hint) {
    hint.textContent = mode === 'kids'
      ? 'Kids mode: tap to walk · tap blocks to queue digging · select a block then tap to queue building. Character does the jobs. Tap again cancels. Drag to look around.'
      : 'Classic: virtual stick + JUMP. Switch to Kids for Blockheads-style tap-to-walk, dig & build queue.';
  }
  // Live session picks this up next frame via save.controlMode
  const s = getSession();
  if (s && s.ui) {
    s.ui.controlMode = mode;
    if (s.input) s.input.controlMode = mode;
  }
}

function updateMuteButtons() {
  const label = save.muted ? '🔇 Sound off' : '🔊 Sound on';
  const muteBtn = document.getElementById('muteBtn');
  if (muteBtn) muteBtn.textContent = label;
  audioSetMuted(!!save.muted);
}

function renderDiffChips() {
  const row = document.getElementById('diffRow');
  if (!row) return;
  const cur = draftDiff || save.difficultyId || 'normal';
  row.innerHTML = '';
  DIFFICULTY_IDS.forEach(id => {
    const p = DIFFICULTIES[id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-chip' + (p.id === cur ? ' active' : '');
    btn.dataset.diff = p.id;
    btn.innerHTML = p.name + '<small>' + p.blurb + '</small>';
    btn.addEventListener('click', () => {
      draftDiff = p.id;
      save.difficultyId = p.id;
      writeSave();
      renderDiffChips();
    });
    row.appendChild(btn);
  });
  const hint = document.getElementById('diffHint');
  const d = getDifficulty(cur);
  if (hint && d) hint.textContent = d.name + ' · ' + d.blurb;
}

function renderSizeChips() {
  const row = document.getElementById('sizeRow');
  if (!row) return;
  const cur = draftSize || save.worldSizeId || 'standard';
  row.innerHTML = '';
  WORLD_SIZE_PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-chip' + (p.id === cur ? ' active' : '');
    btn.dataset.size = p.id;
    btn.innerHTML = p.name + '<small>' + p.w.toLocaleString() + ' · ' + p.blurb + '</small>';
    btn.addEventListener('click', () => {
      draftSize = p.id;
      save.worldSizeId = p.id;
      save.worldSize = p.w;
      writeSave();
      renderSizeChips();
    });
    row.appendChild(btn);
  });
  const preset = worldSizePreset(cur);
  const hint = document.getElementById('sizeHint');
  if (hint && preset) {
    hint.textContent = preset.name + ' · ' + preset.w.toLocaleString() + ' blocks · ' + preset.blurb;
  }
}

/**
 * Paint a small Minecraft-ish landscape thumb from the world seed
 * (deterministic, no need to load the full world).
 */
function paintWorldThumb(canvas, meta) {
  if (!canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const seed = (meta && meta.seed) ? (meta.seed >>> 0) : 1;
  // simple LCG for local variation
  let s = seed || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  const dayish = (seed % 100) / 100;
  sky.addColorStop(0, dayish > 0.55 ? '#3d7ec4' : '#1a2040');
  sky.addColorStop(1, dayish > 0.55 ? '#9ec8e8' : '#3a4060');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Distant hills
  ctx.fillStyle = 'rgba(40, 70, 55, 0.55)';
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) {
    const y = h * 0.45 + Math.sin(x * 0.04 + seed) * 10 + rnd() * 6;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  // Ground band
  const groundY = h * 0.62;
  ctx.fillStyle = '#5a9e3a';
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(0, groundY + 8, w, h - groundY);

  // Block-ish columns
  const tiles = [ '#6fbf45', '#8b5a2b', '#7a7f88', '#c4a060', '#5a9e3a' ];
  for (let i = 0; i < 10; i++) {
    const bw = 8 + Math.floor(rnd() * 6);
    const bx = Math.floor(rnd() * (w - bw));
    const bh = 6 + Math.floor(rnd() * 14);
    ctx.fillStyle = tiles[Math.floor(rnd() * tiles.length)];
    ctx.fillRect(bx, groundY - bh, bw, bh);
  }

  // Mode accent strip
  const diff = getDifficulty(meta && meta.difficultyId);
  const accent = diff.id === 'creative' ? '#ffd60a'
    : diff.id === 'easy' ? '#7dffa0'
    : diff.id === 'hard' ? '#ff6a50'
    : '#5a9ed4';
  ctx.fillStyle = accent;
  ctx.fillRect(0, h - 3, w, 3);
}

function renderWorldList() {
  const grid = document.getElementById('worldGrid');
  const empty = document.getElementById('worldEmpty');
  if (!grid) return;
  const worlds = listWorlds();
  grid.innerHTML = '';

  if (!selectedListId || !worlds.some(w => w.id === selectedListId)) {
    selectedListId = worlds[0] ? worlds[0].id : null;
  }

  if (!worlds.length) {
    if (empty) empty.classList.remove('hidden');
  } else {
    if (empty) empty.classList.add('hidden');
  }

  // Create New World tile (Minecraft-style first action)
  const createCard = document.createElement('div');
  createCard.className = 'world-card create-card-tile';
  createCard.setAttribute('role', 'button');
  createCard.tabIndex = 0;
  createCard.innerHTML =
    '<span class="create-plus" aria-hidden="true">+</span>' +
    '<span class="create-label">Create New World</span>';
  const openCreate = () => {
    prefillSeed = null;
    draftDiff = save.difficultyId || 'normal';
    draftSize = save.worldSizeId || 'standard';
    showCreate();
  };
  createCard.addEventListener('click', openCreate);
  createCard.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCreate(); }
  });
  grid.appendChild(createCard);

  worlds.forEach(w => {
    // div (not button) so Edit can be a real nested button
    const card = document.createElement('div');
    card.className = 'world-card' + (w.id === selectedListId ? ' selected' : '');
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', w.id === selectedListId ? 'true' : 'false');
    card.tabIndex = 0;
    card.dataset.worldId = w.id;

    const thumb = document.createElement('canvas');
    thumb.className = 'world-card-thumb';
    thumb.width = 160;
    thumb.height = 100;
    thumb.setAttribute('aria-hidden', 'true');
    paintWorldThumb(thumb, w);

    const body = document.createElement('div');
    body.className = 'world-card-body';

    const nameEl = document.createElement('span');
    nameEl.className = 'world-card-name';
    nameEl.textContent = w.name || 'World';

    const modeEl = document.createElement('span');
    const diff = getDifficulty(w.difficultyId);
    modeEl.className = 'world-card-mode ' + diff.id;
    modeEl.textContent = diff.name;

    const metaEl = document.createElement('span');
    metaEl.className = 'world-card-meta';
    // size + last played only — no seed on the card
    const summary = worldSummaryLine(w);
    metaEl.textContent = summary.split(' · ').slice(1).join(' · ') || '';

    body.appendChild(nameEl);
    body.appendChild(modeEl);
    body.appendChild(metaEl);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'world-card-edit';
    editBtn.textContent = '✎ Edit';
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedListId = w.id;
      selectWorld(w.id);
      showEditWorld(w.id);
    });

    card.appendChild(thumb);
    card.appendChild(body);
    card.appendChild(editBtn);

    const selectThis = () => {
      selectedListId = w.id;
      selectWorld(w.id);
      renderWorldList();
      updateWorldActionButtons();
    };
    card.addEventListener('click', selectThis);
    card.addEventListener('dblclick', () => {
      selectedListId = w.id;
      playSelectedWorld();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); playSelectedWorld(); }
      else if (e.key === ' ') { e.preventDefault(); selectThis(); }
    });

    grid.appendChild(card);
  });
  updateWorldActionButtons();
}

function updateWorldActionButtons() {
  const has = !!selectedListId;
  const play = document.getElementById('btnPlayWorld');
  if (play) {
    play.disabled = !has;
    if (has) {
      const meta = getWorldMeta(selectedListId);
      play.textContent = meta && meta.hasData ? 'Play Selected World' : 'Enter Selected World';
    } else {
      play.textContent = 'Play Selected World';
    }
  }
}

function showEditWorld(id) {
  const meta = getWorldMeta(id);
  if (!meta) return;
  editingWorldId = id;
  selectedListId = id;
  const nameIn = document.getElementById('inputEditName');
  const seedIn = document.getElementById('inputEditSeed');
  const metaLine = document.getElementById('editMetaLine');
  const hint = document.getElementById('copySeedHint');
  if (nameIn) nameIn.value = meta.name || '';
  if (seedIn) seedIn.value = formatSeedDisplay(meta.seed, meta.seedString);
  if (metaLine) {
    const diff = getDifficulty(meta.difficultyId);
    const size = WORLD_SIZE_PRESETS.find(p => p.id === meta.worldSizeId);
    metaLine.textContent = [
      diff.name + ' mode',
      size ? size.name + ' (' + size.w.toLocaleString() + ' wide)' : '',
      worldSummaryLine(meta).split(' · ').pop() || '',
    ].filter(Boolean).join(' · ');
  }
  if (hint) hint.textContent = 'Copy this seed to recreate the same terrain in a new world.';
  setScreen('edit');
}

function saveEditName() {
  if (!editingWorldId) return;
  const nameIn = document.getElementById('inputEditName');
  const name = nameIn ? nameIn.value : '';
  if (renameWorld(editingWorldId, name)) {
    hintFlash('Name saved');
  }
}

function hintFlash(msg) {
  const hint = document.getElementById('copySeedHint');
  if (!hint) return false;
  const prev = hint.textContent;
  hint.textContent = msg;
  setTimeout(() => { if (hint) hint.textContent = prev; }, 1400);
  return true;
}

async function copyEditSeed() {
  const seedIn = document.getElementById('inputEditSeed');
  const text = seedIn ? seedIn.value : '';
  if (!text) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      seedIn.focus();
      seedIn.select();
      document.execCommand('copy');
    }
    hintFlash('Seed copied!');
  } catch (_) {
    // Fallback: select so user can Ctrl+C
    if (seedIn) {
      seedIn.focus();
      seedIn.select();
    }
    hintFlash('Seed selected — press Ctrl+C / ⌘C to copy');
  }
}

function cloneFromEditSeed() {
  if (!editingWorldId) return;
  const meta = getWorldMeta(editingWorldId);
  if (!meta) return;
  prefillSeed = formatSeedDisplay(meta.seed, meta.seedString);
  // Match size/diff as convenience when cloning terrain
  draftDiff = meta.difficultyId || 'normal';
  draftSize = meta.worldSizeId || 'standard';
  showCreate();
}

function setGenProgress(p) {
  const overlay = document.getElementById('genOverlay');
  const fill = document.getElementById('genBarFill');
  const pct = document.getElementById('genPct');
  if (!overlay) return;
  overlay.classList.toggle('hidden', p == null);
  if (p == null) return;
  const v = Math.max(0, Math.min(1, p));
  if (fill) fill.style.width = (v * 100).toFixed(0) + '%';
  if (pct) pct.textContent = (v * 100).toFixed(0) + '% · ' + WORLD_W.toLocaleString() + ' wide';
}

function showTitle() {
  enterMenu();
  pickSplash();
  updateMuteButtons();
  setScreen('title');
  syncCreativeChrome(null);
}

function showWorlds() {
  loadSave(); // refresh meta
  if (!selectedListId) selectedListId = save.worldId || null;
  renderWorldList();
  setScreen('worlds');
}

function showCreate() {
  const cloning = prefillSeed != null && String(prefillSeed).length > 0;
  if (!cloning) {
    draftDiff = save.difficultyId || 'normal';
    draftSize = save.worldSizeId || 'standard';
  }
  const nameIn = document.getElementById('inputWorldName');
  const seedIn = document.getElementById('inputSeed');
  if (nameIn) nameIn.value = cloning ? 'World Copy' : '';
  if (seedIn) seedIn.value = cloning ? String(prefillSeed) : '';
  const hint = document.getElementById('seedHint');
  if (hint) {
    hint.textContent = cloning
      ? 'Using seed from another world — same size recreates the same terrain'
      : 'Same seed + size = same terrain';
  }
  prefillSeed = null;
  renderDiffChips();
  renderSizeChips();
  setGenProgress(null);
  setScreen('create');
}

function showOptions() {
  updateMuteButtons();
  updateControlModeUi();
  setScreen('options');
}

function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;
  bindInput(appInput, cv, () => {
    const s = getSession();
    return s ? s.cam : { x: WORLD_W / 2, y: SURFACE_Y };
  });

  const menuOpen = (s) => !!(s && (s.ui.craftOpen || s.ui.chestOpen || s.ui.bagOpen || s.ui.creativeOpen));

  const blockWorldInput = () => {
    appInput.pointerDown = false;
    appInput.mineTx = null;
    appInput.mineTy = null;
    appInput.placeTx = null;
    appInput.placeTy = null;
    appInput.holdMining = false;
    appInput.tapPlace = null;
  };

  cv.addEventListener('pointerdown', e => {
    if (screenName !== 'play') return;
    const s = getSession();
    if (!menuOpen(s)) return;
    const p = eventToStage(e);
    if (s.ui.craftOpen && !s.ui.bagOpen && !s.ui.creativeOpen && !s.ui.chestOpen) {
      // Craft menu still uses click-up path
      gameClickCraft(p.x, p.y);
    } else {
      gameUiPointer(p.x, p.y, 'down');
    }
    e.preventDefault();
    e.stopPropagation();
    blockWorldInput();
  }, true);

  cv.addEventListener('pointermove', e => {
    if (screenName !== 'play') return;
    const s = getSession();
    if (!menuOpen(s)) return;
    const p = eventToStage(e);
    if (s.ui.bagOpen || s.ui.creativeOpen || s.ui.chestOpen) {
      gameUiPointer(p.x, p.y, 'move');
      e.preventDefault();
      e.stopPropagation();
      blockWorldInput();
    }
  }, true);

  cv.addEventListener('pointerup', e => {
    if (screenName !== 'play') return;
    const s = getSession();
    if (!menuOpen(s)) return;
    const p = eventToStage(e);
    if (s.ui.craftOpen && !s.ui.bagOpen && !s.ui.creativeOpen && !s.ui.chestOpen) {
      // already handled on down for craft
    } else {
      gameUiPointer(p.x, p.y, 'up');
    }
    e.preventDefault();
    e.stopPropagation();
    blockWorldInput();
  }, true);
}

function syncCreativeChrome(session) {
  const creative = !!(session && (session.ui.creative || getDifficulty(session.difficultyId).creative));
  document.body.classList.toggle('has-creative', creative);
  const btn = document.getElementById('btnCreative');
  if (btn) btn.classList.toggle('hidden', !creative || screenName !== 'play');
  const flyBtn = document.getElementById('btnFly');
  if (flyBtn) {
    const show = creative && screenName === 'play';
    flyBtn.classList.toggle('hidden', !show);
    const flying = !!(session && session.player && session.player.flying);
    flyBtn.classList.toggle('is-on', flying);
    flyBtn.textContent = flying ? '✈ Flying' : '✈ Fly';
    flyBtn.title = flying ? 'Fly ON — tap to walk' : 'Fly OFF — tap to fly (creative)';
  }
}

function resetInput() {
  appInput.pointerDown = false;
  appInput.mineTx = null;
  appInput.mineTy = null;
  appInput.stickX = 0;
  appInput.stickY = 0;
  appInput.jump = false;
  appInput.tapPlace = null;
  appInput.holdMining = false;
}

async function startNewWorldFromCreate() {
  ensureAudio();
  ensureListeners();
  resetInput();

  const nameIn = document.getElementById('inputWorldName');
  const seedIn = document.getElementById('inputSeed');
  const name = nameIn ? nameIn.value : '';
  const seedInput = seedIn ? seedIn.value : '';

  const meta = createWorldEntry({
    name,
    seedInput,
    difficultyId: draftDiff,
    worldSizeId: draftSize,
  });

  applyWorldSize(meta.worldSize);
  const needsProgress = meta.worldSize >= 2048;
  if (needsProgress) setGenProgress(0);

  const createBtn = document.getElementById('btnCreatePlay');
  const cancelBtn = document.getElementById('btnCreateCancel');
  if (createBtn) createBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    await enterPlay(false, {
      worldSizeId: meta.worldSizeId,
      difficultyId: meta.difficultyId,
      seed: meta.seed,
      onProgress: needsProgress ? setGenProgress : null,
      input: appInput,
    });
    setGenProgress(null);
    setScreen('play');
    syncCreativeChrome(getSession());
  } catch (err) {
    console.error(err);
    setGenProgress(null);
    alert('Could not create world: ' + (err && err.message ? err.message : err));
    // remove empty meta if gen failed?
    deleteWorld(meta.id);
    showCreate();
  } finally {
    if (createBtn) createBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

async function playSelectedWorld() {
  if (!selectedListId) return;
  ensureAudio();
  ensureListeners();
  resetInput();

  const meta = getWorldMeta(selectedListId);
  if (!meta) return;

  const playBtn = document.getElementById('btnPlayWorld');
  if (playBtn) playBtn.disabled = true;

  try {
    if (meta.hasData) {
      const ok = loadWorldData(selectedListId);
      if (!ok) {
        // Corrupt / missing payload — regenerate from seed
        selectWorld(selectedListId);
        save.seed = meta.seed;
        save.seedString = meta.seedString;
        save.difficultyId = meta.difficultyId;
        save.worldSizeId = meta.worldSizeId;
        save.hasWorld = false;
        applyWorldSize(meta.worldSize);
        const needsProgress = meta.worldSize >= 2048;
        if (needsProgress) setGenProgress(0);
        await enterPlay(false, {
          worldSizeId: meta.worldSizeId,
          difficultyId: meta.difficultyId,
          seed: meta.seed,
          onProgress: needsProgress ? setGenProgress : null,
          input: appInput,
        });
      } else {
        applyWorldSize(meta.worldSize);
        await enterPlay(true, {
          worldSizeId: meta.worldSizeId,
          difficultyId: meta.difficultyId,
          input: appInput,
        });
      }
    } else {
      // Never finished generating — gen with stored seed
      selectWorld(selectedListId);
      save.seed = meta.seed;
      save.seedString = meta.seedString;
      save.difficultyId = meta.difficultyId;
      save.worldSizeId = meta.worldSizeId;
      applyWorldSize(meta.worldSize);
      const needsProgress = meta.worldSize >= 2048;
      if (needsProgress) setGenProgress(0);
      await enterPlay(false, {
        worldSizeId: meta.worldSizeId,
        difficultyId: meta.difficultyId,
        seed: meta.seed,
        onProgress: needsProgress ? setGenProgress : null,
        input: appInput,
      });
    }
    setGenProgress(null);
    setScreen('play');
    syncCreativeChrome(getSession());
  } catch (err) {
    console.error(err);
    setGenProgress(null);
    alert('Could not load world: ' + (err && err.message ? err.message : err));
  } finally {
    if (playBtn) playBtn.disabled = false;
    updateWorldActionButtons();
  }
}

function confirmDeleteFromEdit() {
  const id = editingWorldId || selectedListId;
  if (!id) return;
  const meta = getWorldMeta(id);
  if (!meta) return;
  const ok = confirm('Delete "' + meta.name + '" forever? This cannot be undone.');
  if (!ok) return;
  deleteWorld(id);
  editingWorldId = null;
  selectedListId = null;
  showWorlds();
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (screenName === 'play') {
    const s = getSession();
    try {
      if (s) gameUpdate(dt);
    } catch (err) {
      console.error('[blockbound] update error', err);
      if (s && s.ui) {
        s.ui.toast = 'Update glitch (see console)';
        s.ui.toastT = 2;
      }
    }
    syncTouchActButton(s);
    if (ctx) {
      try {
        ctx.clearRect(0, 0, W, H);
        if (s) gameRender(ctx);
        else drawMenuBackdrop(ctx, now);
      } catch (err) {
        console.error('[blockbound] render error', err);
      }
    }
  } else if (ctx) {
    drawMenuBackdrop(ctx, now);
    syncTouchActButton(null);
  }

  requestAnimationFrame(frame);
}

function drawMenuBackdrop(ctx, now) {
  const sky = skyColors(0.3 + Math.sin(now / 8000) * 0.05);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, sky.top);
  g.addColorStop(0.5, sky.mid);
  g.addColorStop(1, sky.bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  drawParallax(ctx, now / 1000, sky.day);
  const n = ORIENTATION === 'landscape' ? 22 : 14;
  for (let i = 0; i < n; i++) {
    const x = (i * 32 + (now / 50) * 0.2) % (W + 40) - 20;
    const y = H * (ORIENTATION === 'landscape' ? 0.72 : 0.62) + Math.sin(i + now / 900) * 8;
    drawBlock(ctx, x, y, 28, [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.WOOD][i % 4], 1, i, 0);
  }
}

function wireUI() {
  document.getElementById('btnSingleplayer').addEventListener('click', showWorlds);
  document.getElementById('btnWorldsBack').addEventListener('click', showTitle);
  document.getElementById('btnCreateCancel').addEventListener('click', showWorlds);
  document.getElementById('btnCreatePlay').addEventListener('click', () => {
    startNewWorldFromCreate();
  });
  document.getElementById('btnPlayWorld').addEventListener('click', () => {
    playSelectedWorld();
  });

  // Edit world screen
  const editBack = document.getElementById('btnEditBack');
  if (editBack) editBack.addEventListener('click', showWorlds);
  const editSave = document.getElementById('btnEditSave');
  if (editSave) editSave.addEventListener('click', saveEditName);
  const editDel = document.getElementById('btnEditDelete');
  if (editDel) editDel.addEventListener('click', confirmDeleteFromEdit);
  const copySeed = document.getElementById('btnCopySeed');
  if (copySeed) copySeed.addEventListener('click', () => { copyEditSeed(); });
  const cloneSeed = document.getElementById('btnCloneSeed');
  if (cloneSeed) cloneSeed.addEventListener('click', cloneFromEditSeed);

  document.getElementById('btnRandomSeed').addEventListener('click', () => {
    const seedIn = document.getElementById('inputSeed');
    if (seedIn) seedIn.value = String(randomSeed());
    const hint = document.getElementById('seedHint');
    if (hint && seedIn) {
      const p = parseSeed(seedIn.value);
      hint.textContent = 'Seed → ' + p.seed + (p.random ? ' (random)' : '');
    }
  });
  const seedIn = document.getElementById('inputSeed');
  if (seedIn) {
    seedIn.addEventListener('input', () => {
      const hint = document.getElementById('seedHint');
      if (!hint) return;
      const raw = seedIn.value.trim();
      if (!raw) {
        hint.textContent = 'Blank = random seed each create';
        return;
      }
      const p = parseSeed(raw);
      hint.textContent = 'Resolves to ' + p.seed + (p.seedString !== String(p.seed) ? ' (from text)' : '');
    });
  }

  document.getElementById('btnHow').addEventListener('click', () => {
    document.getElementById('howPanel').classList.toggle('hidden');
  });
  document.getElementById('btnOptions').addEventListener('click', showOptions);
  document.getElementById('btnOptionsBack').addEventListener('click', showTitle);

  document.getElementById('muteBtn').addEventListener('click', () => {
    save.muted = !save.muted;
    writeSave();
    updateMuteButtons();
  });
  const ctrlBtn = document.getElementById('btnControlMode');
  if (ctrlBtn) {
    ctrlBtn.addEventListener('click', () => {
      const next = getControlMode() === 'kids' ? 'classic' : 'kids';
      setControlMode(next);
      updateControlModeUi();
    });
  }
  document.getElementById('btnHub').addEventListener('click', () => {
    window.location.href = 'https://jmitchell238.github.io/arcade-hub/';
  });
  document.getElementById('btnMenu').addEventListener('click', () => {
    const s = getSession();
    if (s) {
      persistSession(
        s.world, s.player, s.inv, s.timeOfDay, s.stats, s.ents, s.difficultyId
      );
    }
    showWorlds();
  });
  document.getElementById('btnCraft').addEventListener('click', () => {
    const s = getSession();
    if (!s) return;
    s.ui.bagOpen = false;
    s.ui.creativeOpen = false;
    s.ui.chestOpen = null;
    s.ui.invPick = null;
    s.ui.craftOpen = !s.ui.craftOpen;
    if (s.ui.craftOpen) {
      s.ui.craftTab = 'all';
      s.ui.craftScroll = 0;
    }
  });
  const bagBtn = document.getElementById('btnBag');
  if (bagBtn) {
    bagBtn.addEventListener('click', () => {
      const s = getSession();
      if (!s) return;
      s.ui.craftOpen = false;
      s.ui.creativeOpen = false;
      s.ui.chestOpen = null;
      s.ui.invPick = null;
      s.ui.bagOpen = !s.ui.bagOpen;
    });
  }
  const creativeBtn = document.getElementById('btnCreative');
  if (creativeBtn) {
    creativeBtn.addEventListener('click', () => {
      const s = getSession();
      if (!s || !s.ui.creative) return;
      s.ui.craftOpen = false;
      s.ui.bagOpen = false;
      s.ui.chestOpen = null;
      s.ui.invPick = null;
      s.ui.creativeOpen = !s.ui.creativeOpen;
      if (s.ui.creativeOpen) s.ui.creativeScroll = s.ui.creativeScroll || 0;
    });
  }
  const flyBtn = document.getElementById('btnFly');
  if (flyBtn) {
    flyBtn.addEventListener('click', () => {
      const s = getSession();
      if (!s || !s.player || !s.player.canFly) return;
      s.input.flyToggle = true; // applied next frame in updatePlayer
    });
  }
  const touchAct = document.getElementById('btnTouchAct');
  if (touchAct) {
    touchAct.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const s = getSession();
      if (!s || !s.ui || !s.ui.touchAct) return;
      const kind = s.ui.touchAct.kind;
      if (kind === 'use' || kind === 'eat') {
        // handleUse covers doors, chests, beds, boat, eat
        s.input.usePressed = true;
      } else if (kind === 'attack') {
        s.input.attackPressed = true;
      }
    });
  }
  const modeBtn = document.getElementById('btnMode');
  if (modeBtn) {
    modeBtn.classList.add('hidden');
    modeBtn.style.display = 'none';
  }
  // Use / Hit chrome buttons removed — tap doors/chests/enemies instead (F / X still on keyboard)

  const ver = GAME_VERSION_LABEL;
  ['versionTag', 'versionMenu', 'versionOptions'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = ver;
  });

  // Orientation / resize
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => {
    setTimeout(resizeCanvas, 100);
  });
}

// ---------- PWA auto-update (same pattern as drop-and-fuse / neon-autofire) ----------
function safeReloadForUpdate() {
  if (window.__bbReloaded) return;
  // Don't yank kids mid-game — reload when they return to menu
  if (screenName === 'play') {
    window.__bbPendingReload = true;
    return;
  }
  window.__bbReloaded = true;
  location.reload();
}

function activateWaitingWorker(reg) {
  if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
}

function watchInstallingWorker(reg) {
  const worker = reg.installing;
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      worker.postMessage({ type: 'SKIP_WAITING' });
    }
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (!(location.protocol === 'https:' || location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1')) return;

  navigator.serviceWorker.register('./sw.js?v=' + GAME_VERSION).then(reg => {
    activateWaitingWorker(reg);
    if (reg.installing) watchInstallingWorker(reg);
    reg.addEventListener('updatefound', () => watchInstallingWorker(reg));

    const checkForUpdate = () => { reg.update().catch(() => {}); };
    checkForUpdate();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        checkForUpdate();
        checkRemoteVersion();
      }
    });
    window.addEventListener('focus', () => {
      checkForUpdate();
      checkRemoteVersion();
    });
    setInterval(checkForUpdate, 60 * 1000);
    setInterval(checkRemoteVersion, 90 * 1000);

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      safeReloadForUpdate();
    });
  }).catch(err => console.warn('[sw] register failed', err));
}

/** If deployed GAME_VERSION differs from this bundle, force reload (menu only). */
function checkRemoteVersion() {
  if (screenName === 'play') return;
  fetch('js/core/constants.js?_=' + Date.now(), { cache: 'no-store' })
    .then(r => (r.ok ? r.text() : ''))
    .then(text => {
      const m = text.match(/GAME_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (m && m[1] && m[1] !== GAME_VERSION) safeReloadForUpdate();
    })
    .catch(() => {});
}

loadSave();
preferKidsOnTouch(); // iPad / phones → Kids controls (unless parent chose Classic)
selectedListId = save.worldId || null;
resizeCanvas();
wireUI();
pickSplash();
updateMuteButtons();
updateControlModeUi();
setScreen('title');
registerSW();
checkRemoteVersion();

loadTextures().catch(err => console.warn('texture load', err));
requestAnimationFrame(frame);
