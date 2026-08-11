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
  persistSession,
} from './save/save.js';
import { audioSetMuted, ensureAudio } from './audio/audio.js';
import {
  enterPlay, enterMenu, getSession, gameUpdate, gameRender, gameClickCraft,
} from './session/index.js';
import { skyColors, drawParallax, drawBlock } from './render/index.js';

const cv = document.getElementById('cv');
let ctx = null;
let last = performance.now();
/** title | worlds | create | options | play */
let screenName = 'title';

/** Selected row on the world list (not necessarily loaded). */
let selectedListId = null;
/** Draft difficulty/size on create screen */
let draftDiff = 'normal';
let draftSize = 'standard';

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
  cv.style.width = Math.floor(W * scale) + 'px';
  cv.style.height = Math.floor(H * scale) + 'px';
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
    el.classList.toggle('hidden', !isPlay);
  });
  // creative chrome only when playing creative
  if (!isPlay) syncCreativeChrome(null);
  else syncCreativeChrome(getSession());
}

function pickSplash() {
  const el = document.getElementById('splashLine');
  if (!el) return;
  el.textContent = SPLASH[Math.floor(Math.random() * SPLASH.length)];
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

function renderWorldList() {
  const list = document.getElementById('worldList');
  const empty = document.getElementById('worldEmpty');
  if (!list) return;
  const worlds = listWorlds();
  list.innerHTML = '';

  if (!selectedListId || !worlds.some(w => w.id === selectedListId)) {
    selectedListId = worlds[0] ? worlds[0].id : null;
  }

  if (!worlds.length) {
    if (empty) empty.classList.remove('hidden');
  } else {
    if (empty) empty.classList.add('hidden');
  }

  worlds.forEach(w => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'world-item' + (w.id === selectedListId ? ' selected' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', w.id === selectedListId ? 'true' : 'false');
    btn.innerHTML =
      '<span class="w-name"></span><span class="w-meta"></span>';
    btn.querySelector('.w-name').textContent = w.name;
    btn.querySelector('.w-meta').textContent = worldSummaryLine(w);
    btn.addEventListener('click', () => {
      selectedListId = w.id;
      selectWorld(w.id);
      renderWorldList();
      updateWorldActionButtons();
    });
    btn.addEventListener('dblclick', () => {
      selectedListId = w.id;
      playSelectedWorld();
    });
    list.appendChild(btn);
  });
  updateWorldActionButtons();
}

function updateWorldActionButtons() {
  const has = !!selectedListId;
  const play = document.getElementById('btnPlayWorld');
  const ren = document.getElementById('btnRenameWorld');
  const del = document.getElementById('btnDeleteWorld');
  if (play) play.disabled = !has;
  if (ren) ren.disabled = !has;
  if (del) del.disabled = !has;
  if (play && has) {
    const meta = getWorldMeta(selectedListId);
    play.textContent = meta && meta.hasData ? '▶  Play Selected' : '▶  Enter World';
  }
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
  draftDiff = save.difficultyId || 'normal';
  draftSize = save.worldSizeId || 'standard';
  const nameIn = document.getElementById('inputWorldName');
  const seedIn = document.getElementById('inputSeed');
  if (nameIn) nameIn.value = '';
  if (seedIn) seedIn.value = '';
  const hint = document.getElementById('seedHint');
  if (hint) hint.textContent = 'Same seed + size = same terrain';
  renderDiffChips();
  renderSizeChips();
  setGenProgress(null);
  setScreen('create');
}

function showOptions() {
  updateMuteButtons();
  setScreen('options');
}

function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;
  bindInput(appInput, cv, () => {
    const s = getSession();
    return s ? s.cam : { x: WORLD_W / 2, y: SURFACE_Y };
  });

  cv.addEventListener('pointerdown', e => {
    if (screenName !== 'play') return;
    const s = getSession();
    if (!s) return;
    const p = eventToStage(e);
    if (s.ui.craftOpen || s.ui.chestOpen || s.ui.bagOpen || s.ui.creativeOpen) {
      gameClickCraft(p.x, p.y);
      e.preventDefault();
      e.stopPropagation();
      appInput.pointerDown = false;
      appInput.mineTx = null;
      appInput.mineTy = null;
      appInput.placeTx = null;
      appInput.placeTy = null;
    }
  }, true);
}

function syncCreativeChrome(session) {
  const creative = !!(session && (session.ui.creative || getDifficulty(session.difficultyId).creative));
  document.body.classList.toggle('has-creative', creative);
  const btn = document.getElementById('btnCreative');
  if (btn) btn.classList.toggle('hidden', !creative || screenName !== 'play');
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

function openRenameModal() {
  if (!selectedListId) return;
  const meta = getWorldMeta(selectedListId);
  if (!meta) return;
  const modal = document.getElementById('renameModal');
  const input = document.getElementById('inputRename');
  if (input) input.value = meta.name;
  if (modal) modal.classList.remove('hidden');
  if (input) setTimeout(() => input.focus(), 50);
}

function closeRenameModal() {
  const modal = document.getElementById('renameModal');
  if (modal) modal.classList.add('hidden');
}

function confirmRename() {
  const input = document.getElementById('inputRename');
  const name = input ? input.value : '';
  if (selectedListId && renameWorld(selectedListId, name)) {
    renderWorldList();
  }
  closeRenameModal();
}

function confirmDelete() {
  if (!selectedListId) return;
  const meta = getWorldMeta(selectedListId);
  if (!meta) return;
  const ok = confirm('Delete "' + meta.name + '" forever? This cannot be undone.');
  if (!ok) return;
  deleteWorld(selectedListId);
  selectedListId = null;
  renderWorldList();
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
  document.getElementById('btnCreateWorld').addEventListener('click', showCreate);
  document.getElementById('btnCreateCancel').addEventListener('click', showWorlds);
  document.getElementById('btnCreatePlay').addEventListener('click', () => {
    startNewWorldFromCreate();
  });
  document.getElementById('btnPlayWorld').addEventListener('click', () => {
    playSelectedWorld();
  });
  document.getElementById('btnRenameWorld').addEventListener('click', openRenameModal);
  document.getElementById('btnDeleteWorld').addEventListener('click', confirmDelete);
  document.getElementById('btnRenameOk').addEventListener('click', confirmRename);
  document.getElementById('btnRenameCancel').addEventListener('click', closeRenameModal);

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
  const modeBtn = document.getElementById('btnMode');
  if (modeBtn) {
    modeBtn.classList.add('hidden');
    modeBtn.style.display = 'none';
  }
  const useBtn = document.getElementById('btnUse');
  if (useBtn) {
    useBtn.addEventListener('click', () => {
      const s = getSession();
      if (s) s.input.usePressed = true;
    });
  }
  const atkBtn = document.getElementById('btnAttack');
  if (atkBtn) {
    atkBtn.addEventListener('click', () => {
      const s = getSession();
      if (s) s.input.attackPressed = true;
    });
  }

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

// Bootstrap — force SW onto latest cache
if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });

  navigator.serviceWorker.register('./sw.js?v=' + GAME_VERSION_LABEL).then(reg => {
    try { reg.update(); } catch (_) {}
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          nw.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
  }).catch(() => {});
}

loadSave();
selectedListId = save.worldId || null;
resizeCanvas();
wireUI();
pickSplash();
updateMuteButtons();
setScreen('title');

loadTextures().catch(err => console.warn('texture load', err));
requestAnimationFrame(frame);
