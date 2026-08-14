/**
 * Blockbound composition root — DOM, rAF loop, Minecraft-style menu wiring.
 * Game rules live in session/systems; this file only bootstraps.
 */
import {
  W, H, SURFACE_Y, GAME_VERSION, GAME_VERSION_LABEL, applyViewport, ORIENTATION,
} from './core/constants.js';
import { WORLD_W, WORLD_SIZE_PRESETS, applyWorldSize, worldSizePreset } from './core/worldSize.js';
import { DIFFICULTIES, DIFFICULTY_IDS, getDifficulty } from './core/difficulty.js';
import { randomSeed, parseSeed } from './core/seed.js';
import { BLOCK } from './content/blocks.js';
import { CHEATS } from './content/cheats.js';
import { PREFABS } from './content/prefabs.js';
import { makeInput, bindInput } from './input/input.js';
import { loadTextures } from './textures/textures.js';
import {
  save, loadSave, writeSave, listWorlds, selectWorld, loadWorldData,
  createWorldEntry, renameWorld, deleteWorld, getWorldMeta, worldSummaryLine,
  formatSeedDisplay, persistSession, setControlMode, getControlMode, preferKidsOnTouch,
  getPlayToggle, setPlayToggle, getCheatsEnabled, setCheatsEnabled, getCheat, setCheat, isCheatActive,
} from './save/save.js';
import { audioSetMuted, ensureAudio } from './audio/audio.js';
import {
  enterPlay, enterMenu, getSession, gameUpdate, gameRender, gameClickCraft, gameUiPointer,
  cheatSetDaytime, TIME_PHASES, nearestTimePhase, cheatHealFeed, beginPrefabPlacement, cancelPrefabPlacement, undoLastPrefab,
  commitSignText, pendingSignEdit,
} from './session/index.js';
import { skyColors, drawParallax, drawBlock } from './render/index.js';

const cv = document.getElementById('cv');
let ctx = null;

/**
 * On-screen error reporter.
 *
 * iPads have no console we can read, and the canvas is usually the thing that
 * died — so failures have to surface in the DOM or they are invisible. Shows
 * the first error only; later ones are appended to a count.
 */
let _fatalCount = 0;
let _noSessionReported = false;
function reportFatal(where, err) {
  _fatalCount++;
  try { console.error('[blockbound]', where, err); } catch (_) {}
  try {
    let box = document.getElementById('bbFatal');
    if (!box) {
      box = document.createElement('div');
      box.id = 'bbFatal';
      box.setAttribute('role', 'alert');
      box.style.cssText = [
        'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:9999',
        'background:rgba(120,20,20,0.96)', 'color:#fff',
        'font:600 12px/1.4 system-ui,-apple-system,sans-serif',
        'padding:calc(8px + env(safe-area-inset-top,0px)) 12px 8px',
        'white-space:pre-wrap', 'word-break:break-word', 'max-height:45vh',
        'overflow:auto', '-webkit-user-select:text', 'user-select:text',
      ].join(';');
      box.addEventListener('click', () => { box.remove(); });
      document.body.appendChild(box);
    }
    const msg = (err && (err.stack || err.message)) || String(err);
    box.textContent = 'Blockbound ' + GAME_VERSION_LABEL + ' — error in ' + where
      + (_fatalCount > 1 ? ' (+' + (_fatalCount - 1) + ' more)' : '')
      + '\n' + msg + '\n\n(tap to dismiss)';
  } catch (_) {}
}

window.addEventListener('error', (e) => {
  reportFatal('script', e.error || (e.message + ' @ ' + e.filename + ':' + e.lineno));
});
window.addEventListener('unhandledrejection', (e) => {
  reportFatal('promise', e.reason);
});
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
  const vw = Math.max(320, window.innerWidth || 320);
  const vh = Math.max(320, window.innerHeight || 320);
  applyViewport(vw, vh);
  document.body.classList.toggle('landscape', ORIENTATION === 'landscape');
  document.body.classList.toggle('portrait', ORIENTATION === 'portrait');

  const scale = Math.min(vw / W, vh / H);
  const cssW = Math.max(1, Math.floor(W * scale));
  const cssH = Math.max(1, Math.floor(H * scale));
  cv.style.width = cssW + 'px';
  cv.style.height = cssH + 'px';
  // Keep stage box in sync so absolute menu screens cover the full canvas and center correctly
  const stage = document.getElementById('stage');
  if (stage) {
    stage.style.width = cssW + 'px';
    stage.style.height = cssH + 'px';
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.max(1, Math.floor(W * dpr));
  cv.height = Math.max(1, Math.floor(H * dpr));
  // alpha:false → failed frames stay opaque (not "green body showing through")
  ctx = cv.getContext('2d', { alpha: false });
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  } else {
    // No context => nothing ever paints and the page background (dark green)
    // shows through. Never fail silently here.
    reportFatal('canvas', new Error(
      'getContext("2d") returned null at ' + cv.width + '×' + cv.height
    ));
  }
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
  document.body.classList.toggle('is-playing', isPlay);
  const chromeLayer = document.getElementById('playChrome');
  if (chromeLayer) {
    chromeLayer.classList.toggle('is-play', isPlay);
    chromeLayer.setAttribute('aria-hidden', isPlay ? 'false' : 'true');
  }
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
  // cheat icons only when in play mode
  if (!isPlay) syncCheatChrome(null);
  else syncCheatChrome(getSession());
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

/**
 * The undo button only exists while there is a build to take back.
 *
 * The one in the builds panel meant reopening "Choose a Build" to undo the
 * thing you had just placed — the moment you want it is the moment you are
 * looking at the mistake, not three taps away.
 */
/**
 * Show the sign keyboard when the game asks for one.
 *
 * This is a DOM input on purpose: tapping a real text field is what makes an
 * iPad raise its keyboard, and the game has no on-canvas one to offer.
 */
let _signPanelOpenFor = null;
function syncSignPanel() {
  const panel = document.getElementById('signPanel');
  const input = document.getElementById('signInput');
  if (!panel || !input) return;
  const edit = screenName === 'play' ? pendingSignEdit() : null;
  const key = edit ? edit.x + ',' + edit.y : null;
  if (key === _signPanelOpenFor) return;
  _signPanelOpenFor = key;
  if (!edit) {
    panel.classList.add('hidden');
    input.blur();
    return;
  }
  input.value = edit.text || '';
  panel.classList.remove('hidden');
  // Focus after the panel is visible or iOS ignores it and no keyboard appears.
  setTimeout(() => { input.focus(); input.select(); }, 30);
}

function closeSignPanel(text) {
  commitSignText(text);
  _signPanelOpenFor = null;
  const panel = document.getElementById('signPanel');
  const input = document.getElementById('signInput');
  if (panel) panel.classList.add('hidden');
  if (input) input.blur();
}

function syncUndoBuildButton(session) {
  const btn = document.getElementById('btnUndoLastBuild');
  if (!btn) return;
  const show = screenName === 'play' && !!(session && session.ui && session.ui.lastPrefabUndo);
  btn.classList.toggle('hidden', !show);
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

/** Options toggles that only change what the play screen draws. */
const PLAY_TOGGLE_BUTTONS = [
  ['btnCoords', 'showCoords', 'Coordinates'],
  ['btnMinimap', 'showMinimap', 'Minimap'],
  ['btnAutoJump', 'autoJump', 'Auto-jump'],
];

function updatePlayToggleUi() {
  const s = getSession();
  for (const [btnId, key, label] of PLAY_TOGGLE_BUTTONS) {
    const on = getPlayToggle(key);
    const btn = document.getElementById(btnId);
    if (btn) btn.textContent = `${label}: ${on ? 'On' : 'Off'}`;
    // Live session picks it up without waiting for a reload.
    if (s && s.ui) s.ui[key] = on;
  }
}

function updateMuteButtons() {
  const label = save.muted ? '🔇 Sound off' : '🔊 Sound on';
  const muteBtn = document.getElementById('muteBtn');
  if (muteBtn) muteBtn.textContent = label;
  audioSetMuted(!!save.muted);
}

function updateCheatsMasterUi() {
  const on = getCheatsEnabled();
  const btn = document.getElementById('btnCheatsMaster');
  if (btn) btn.textContent = `Cheats: ${on ? 'On' : 'Off'}`;
  // Per-cheat buttons: when master is off, they're visibly inert (disabled).
  const container = document.getElementById('cheatsContainer');
  if (container) {
    const buttons = container.querySelectorAll('button');
    buttons.forEach(b => {
      b.disabled = !on;
    });
  }
}

function renderCheatsMenu() {
  const container = document.getElementById('cheatsContainer');
  if (!container) return;
  container.innerHTML = '';
  CHEATS.forEach(cheat => {
    // Skip rendering if cheat is marked as coming soon
    if (cheat.comingSoon) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary';
    const on = getCheat(cheat.id);
    btn.textContent = `${cheat.name}: ${on ? 'On' : 'Off'}`;
    btn.disabled = !getCheatsEnabled();
    btn.addEventListener('click', () => {
      setCheat(cheat.id);
      renderCheatsMenu();
      syncCheatChrome(getSession());
    });
    container.appendChild(btn);
  });
}

function renderPrefabsPanel() {
  const container = document.getElementById('prefabsContent');
  if (!container) return;
  container.innerHTML = '';

  // Group prefabs by group
  const grouped = {};
  PREFABS.forEach(prefab => {
    const group = prefab.group || 'Other';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(prefab);
  });

  // Render each group with its prefabs
  Object.keys(grouped).forEach(group => {
    const heading = document.createElement('p');
    heading.className = 'prefab-group-heading';
    heading.textContent = group;
    container.appendChild(heading);

    const groupDiv = document.createElement('div');
    groupDiv.className = 'prefab-group';
    grouped[group].forEach(prefab => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'prefab-btn';
      btn.innerHTML = `<span class="prefab-icon">${prefab.icon}</span><span class="prefab-name">${prefab.name}</span>`;
      btn.addEventListener('click', () => {
        closePrefabsPanel();
        beginPrefabPlacement(prefab.id);
      });
      groupDiv.appendChild(btn);
    });
    container.appendChild(groupDiv);
  });
}

function closePrefabsPanel() {
  const panel = document.getElementById('prefabsPanel');
  if (panel) panel.classList.add('hidden');
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
  updatePlayToggleUi();
  setScreen('options');
}

function showCheats() {
  updateCheatsMasterUi();
  renderCheatsMenu();
  setScreen('cheats');
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
    // Paused: any tap resumes, which is what the overlay now promises.
    if (s && s.paused) {
      s.paused = false;
      e.preventDefault();
      e.stopPropagation();
      blockWorldInput();
      return;
    }
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

/**
 * Canvas-drawn panels (craft / bag / creative / chest) live inside #cv at
 * z-index 1, while the chrome row sits at 210 — so an open panel had five
 * buttons floating on top of it, overlapping its footer and still catching
 * taps meant for the panel. Hide the row while a panel owns the screen; every
 * panel draws its own ✕.
 */
function syncChromeForPanels(session) {
  const ui = session && session.ui;
  const open = !!(ui && (ui.craftOpen || ui.bagOpen || ui.creativeOpen || ui.chestOpen));
  const layer = document.getElementById('playChrome');
  if (layer) layer.classList.toggle('panel-open', open);
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

function syncCheatChrome(session) {
  const container = document.getElementById('cheatsChrome');
  if (!container) return;
  container.innerHTML = '';

  // Only render if we're in play mode
  if (screenName !== 'play') return;

  // Render active cheat icons dynamically from the catalog
  CHEATS.forEach(cheat => {
    // Skip if marked as coming soon or if the cheat is not active
    if (cheat.comingSoon || !isCheatActive(cheat.id)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn play-chrome cheat-icon';
    btn.id = 'cheatBtn' + cheat.id;
    btn.textContent = cheat.icon;
    btn.title = cheat.name;

    // Wire up the cheat action based on the id
    if (cheat.id === 'daytime') {
      // The button doubles as the readout: it shows the time it just set, so a
      // child can see that tapping again moves on rather than repeating.
      const s = getSession();
      const now = s ? TIME_PHASES[nearestTimePhase(s.timeOfDay)] : null;
      if (now) btn.textContent = now.icon;
      btn.addEventListener('click', () => {
        const phase = cheatSetDaytime();
        if (phase) {
          btn.textContent = phase.icon;
          btn.title = phase.name;
        }
      });
    } else if (cheat.id === 'heal') {
      btn.addEventListener('click', () => cheatHealFeed());
    } else if (cheat.id === 'build') {
      btn.addEventListener('click', () => {
        const panel = document.getElementById('prefabsPanel');
        if (panel) {
          renderPrefabsPanel();
          panel.classList.remove('hidden');
        }
      });
    }

    container.appendChild(btn);
  });
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
  try {
    frameBody(now);
  } catch (err) {
    // Nothing may escape: a single throw here would end the rAF chain forever
    // and freeze the game on a blank page (iPad "green screen").
    reportFatal('frame', err);
  } finally {
    requestAnimationFrame(frame);
  }
}

function frameBody(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (screenName === 'play') {
    const s = getSession();
    if (!s && !_noSessionReported) {
      // Play screen with no session: the world never renders and every chrome
      // button except ☰ Menu early-returns, so the game looks frozen.
      _noSessionReported = true;
      reportFatal('session', new Error('play screen entered with no session'));
    }
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
    syncUndoBuildButton(s);
    syncSignPanel();
    syncChromeForPanels(s);
    if (ctx) {
      // Always paint a base fill first — clearRect alone leaves body green through a failed frame
      try {
        ctx.fillStyle = '#142820';
        ctx.fillRect(0, 0, W, H);
      } catch (_) {}
      try {
        if (s) gameRender(ctx);
        else drawMenuBackdrop(ctx, now);
      } catch (err) {
        console.error('[blockbound] render error', err);
        try {
          ctx.fillStyle = '#1a2830';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#7dffa0';
          ctx.font = '700 18px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText('Drawing glitch', W / 2, H / 2 - 12);
          ctx.font = '600 14px system-ui';
          ctx.fillStyle = '#e8fff0';
          ctx.fillText('Tap ☰ Menu (bottom-left), then Fix/update', W / 2, H / 2 + 16);
          if (s && s.ui) {
            s.ui.toast = 'Render glitch — ☰ Menu → Fix / update game';
            s.ui.toastT = 4;
          }
        } catch (_) {}
      }
    }
  } else if (ctx) {
    drawMenuBackdrop(ctx, now);
    syncTouchActButton(null);
    syncUndoBuildButton(null);
  }
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

  document.getElementById('btnCheats').addEventListener('click', showCheats);
  document.getElementById('btnCheatsBack').addEventListener('click', showOptions);

  document.getElementById('btnCheatsMaster').addEventListener('click', () => {
    setCheatsEnabled();
    updateCheatsMasterUi();
    renderCheatsMenu();
    syncCheatChrome(getSession());
  });

  document.getElementById('btnClosePrefabs').addEventListener('click', () => {
    closePrefabsPanel();
    cancelPrefabPlacement();
  });

  document.getElementById('btnUndoBuild').addEventListener('click', () => {
    undoLastPrefab();
    closePrefabsPanel();
  });

  document.getElementById('btnSignSave').addEventListener('click', () => {
    closeSignPanel(document.getElementById('signInput').value);
  });
  document.getElementById('btnSignClear').addEventListener('click', () => closeSignPanel(''));
  document.getElementById('btnSignCancel').addEventListener('click', () => closeSignPanel(null));
  document.getElementById('signInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') closeSignPanel(e.target.value);
    else if (e.key === 'Escape') closeSignPanel(null);
  });

  document.getElementById('btnUndoLastBuild').addEventListener('click', () => {
    undoLastPrefab();
    syncUndoBuildButton(getSession());
  });

  document.getElementById('muteBtn').addEventListener('click', () => {
    save.muted = !save.muted;
    writeSave();
    updateMuteButtons();
  });
  for (const [btnId, key] of PLAY_TOGGLE_BUTTONS) {
    const btn = document.getElementById(btnId);
    if (!btn) continue;
    btn.addEventListener('click', () => {
      setPlayToggle(key);
      updatePlayToggleUi();
    });
  }
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
  /** iPad-safe chrome bind: pointerup so canvas cannot steal the tap. */
  function bindPlayChrome(id, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    let lastFire = 0;
    const fire = (e) => {
      const now = performance.now();
      if (now - lastFire < 350) return; // ignore click after pointerup
      lastFire = now;
      e.preventDefault();
      e.stopPropagation();
      try {
        handler(e);
      } catch (err) {
        console.error('[blockbound] chrome', id, err);
        alert('Button error: ' + (err && err.message ? err.message : err));
      }
    };
    el.addEventListener('pointerup', fire, { passive: false });
    el.addEventListener('click', fire);
  }

  function uiToast(s, msg) {
    if (!s || !s.ui) return;
    s.ui.toast = msg;
    s.ui.toastT = 1.6;
  }

  bindPlayChrome('btnMenu', () => {
    const s = getSession();
    if (s) {
      try {
        persistSession(
          s.world, s.player, s.inv, s.timeOfDay, s.stats, s.ents, s.difficultyId
        );
      } catch (_) {}
    }
    showWorlds();
  });
  bindPlayChrome('btnCraft', () => {
    const s = getSession();
    if (!s) {
      alert('No world loaded — open a world first');
      return;
    }
    s.ui.bagOpen = false;
    s.ui.creativeOpen = false;
    s.ui.chestOpen = null;
    s.ui.invPick = null;
    s.ui.craftOpen = !s.ui.craftOpen;
    if (s.ui.craftOpen) {
      s.ui.craftTab = 'all';
      s.ui.craftScroll = 0;
      uiToast(s, 'Craft open — tap a recipe, then CRAFT');
    } else {
      uiToast(s, 'Craft closed');
    }
  });
  bindPlayChrome('btnBag', () => {
    const s = getSession();
    if (!s) {
      alert('No world loaded — open a world first');
      return;
    }
    s.ui.craftOpen = false;
    s.ui.creativeOpen = false;
    s.ui.chestOpen = null;
    s.ui.invPick = null;
    s.ui.bagOpen = !s.ui.bagOpen;
    uiToast(s, s.ui.bagOpen ? 'Backpack open' : 'Backpack closed');
  });
  bindPlayChrome('btnCreative', () => {
    const s = getSession();
    if (!s) return;
    if (!s.ui.creative) {
      uiToast(s, 'Creative only — start a Creative world');
      return;
    }
    s.ui.craftOpen = false;
    s.ui.bagOpen = false;
    s.ui.chestOpen = null;
    s.ui.invPick = null;
    s.ui.creativeOpen = !s.ui.creativeOpen;
    if (s.ui.creativeOpen) s.ui.creativeScroll = s.ui.creativeScroll || 0;
    uiToast(s, s.ui.creativeOpen ? 'Creative blocks open' : 'Creative closed');
  });
  bindPlayChrome('btnFly', () => {
    const s = getSession();
    if (!s || !s.player) return;
    if (!s.player.canFly) {
      uiToast(s, 'Fly is Creative only');
      return;
    }
    s.input.flyToggle = true;
    uiToast(s, s.player.flying ? 'Toggling fly…' : 'Toggling fly…');
  });
  bindPlayChrome('btnTouchAct', () => {
    const s = getSession();
    if (!s || !s.ui || !s.ui.touchAct) return;
    const kind = s.ui.touchAct.kind;
    if (kind === 'use' || kind === 'eat') s.input.usePressed = true;
    else if (kind === 'attack') s.input.attackPressed = true;
  });

  const forceUp = document.getElementById('btnForceUpdate');
  if (forceUp) {
    forceUp.addEventListener('click', () => {
      location.replace('update.html?from=options');
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

// ---------- PWA auto-update (aggressive — iPads were stuck on 1.9.035) ----------

/**
 * Whether this page was already under a service worker when it loaded.
 *
 * This is the difference between "a new version took over" and "a worker
 * claimed a page that had none yet". Only the first is worth reloading for.
 * Reloading on a first claim is a loop: the reload lands on a page that once
 * again starts out uncontrolled, gets claimed, and reloads again.
 */
const HAD_CONTROLLER_AT_LOAD =
  'serviceWorker' in navigator && !!navigator.serviceWorker.controller;

/**
 * Reloads are capped per tab. Every auto-reload path here has, at some point,
 * managed to retrigger itself; a hard ceiling means the worst case is a stale
 * build instead of a title screen that flickers forever.
 */
const RELOAD_KEY = 'bb-sw-reloads';
const MAX_RELOADS = 2;

function reloadBudgetSpent() {
  try { return (parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10) || 0) >= MAX_RELOADS; }
  catch (_) { return false; }
}

function spendReloadBudget() {
  try {
    const n = parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10) || 0;
    sessionStorage.setItem(RELOAD_KEY, String(n + 1));
  } catch (_) {}
}

function safeReloadForUpdate() {
  if (window.__bbReloaded) return;
  if (!HAD_CONTROLLER_AT_LOAD) {
    // First claim on a fresh page, not an update. Nothing to reload for.
    console.info('[sw] first claim — no reload needed');
    return;
  }
  if (reloadBudgetSpent()) {
    console.warn('[sw] reload budget spent — staying on this build');
    return;
  }
  window.__bbReloaded = true;
  spendReloadBudget();
  location.reload();
}

/** Unregister SW + wipe caches, then reload. Fixes stuck iPad shells. */
async function hardResetAndReload() {
  if (window.__bbHardReset) return;
  window.__bbHardReset = true;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    try { localStorage.setItem('bb-build', GAME_VERSION); } catch (_) {}
  } catch (e) {
    console.warn('[sw] hard reset', e);
  }
  location.replace(location.pathname + '?fresh=' + GAME_VERSION + '&t=' + Date.now());
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

  navigator.serviceWorker.addEventListener('message', (e) => {
    if (!e.data) return;
    // BB_GOTO_UPDATE is an explicit "you are broken, go get fixed" signal and is
    // always honoured. BB_RELOAD fires on every activation, including the very
    // first one on a clean install — treating that as "go to the update page"
    // sends a perfectly healthy tab through the cleanup flow on every load.
    if (e.data.type === 'BB_GOTO_UPDATE') {
      location.replace('update.html?from=sw-msg');
    } else if (e.data.type === 'BB_RELOAD') {
      safeReloadForUpdate();
    }
  });

  // Abandon foreign registrations (especially the old sw.js?v=1.9.038), but
  // KEEP an existing sw-bb.js. Unregistering the good worker on every load and
  // immediately re-registering it forces a fresh install + claim each time,
  // which fires controllerchange, which reloads, which does it all again —
  // the flicker loop. Re-register only when it is genuinely missing.
  navigator.serviceWorker.getRegistrations().then((regs) => {
    const isOurs = (r) => {
      const w = r.active || r.waiting || r.installing;
      return !!(w && w.scriptURL && w.scriptURL.indexOf('sw-bb.js') !== -1);
    };
    const mine = regs.filter(isOurs);
    return Promise.all(regs.filter(r => !isOurs(r)).map(r => r.unregister()))
      .then(() => mine[0] || null);
  }).then((existing) => {
    if (!(window.caches && caches.keys)) return existing;
    return caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.indexOf('blockbound-') === 0 && k !== 'blockbound-' + GAME_VERSION)
        .map(k => caches.delete(k)))
    ).then(() => existing);
  }).then((existing) =>
    existing || navigator.serviceWorker.register('./sw-bb.js', { updateViaCache: 'none' })
  ).then(reg => {
    activateWaitingWorker(reg);
    if (reg.installing) watchInstallingWorker(reg);
    reg.addEventListener('updatefound', () => watchInstallingWorker(reg));
    const checkForUpdate = () => { reg.update().catch(() => {}); };
    checkForUpdate();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { checkForUpdate(); checkRemoteVersion(); }
    });
    window.addEventListener('focus', () => { checkForUpdate(); checkRemoteVersion(); });
    setInterval(checkForUpdate, 45 * 1000);
    setInterval(checkRemoteVersion, 60 * 1000);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      safeReloadForUpdate();
    });
    try { localStorage.setItem('bb-build', GAME_VERSION); } catch (_) {}
  }).catch(err => console.warn('[sw] register failed', err));
}

/**
 * How many times this tab may bounce through update.html before it gives up.
 * The cleanup either works on the first pass or it is not going to: a second
 * and third pass just re-run a wipe that already failed, and the visible result
 * is the title screen flashing forever with a new `&t=` on every hop.
 */
const UPDATE_ATTEMPT_KEY = 'bb-update-attempts';
const MAX_UPDATE_ATTEMPTS = 1;

function updateAttempts() {
  try { return parseInt(sessionStorage.getItem(UPDATE_ATTEMPT_KEY) || '0', 10) || 0; }
  catch (_) { return 0; }
}

/**
 * True when this load is the landing after a cleanup that targeted the version
 * we are already running. The cleanup did everything it knows how to do, so
 * another trip through update.html cannot change the outcome.
 */
function justCameFromUpdate() {
  try {
    return new URLSearchParams(location.search).get('fresh') === GAME_VERSION;
  } catch (_) { return false; }
}

/**
 * If the server has a newer GAME_VERSION than this running shell, send the tab
 * through the cleanup page. Runs even during play — stuck broken builds must
 * not keep kids offline forever.
 *
 * The redirect is deliberately capped. A stale shell that keeps reading its own
 * cached constants.js will report a mismatch on every single load, and without
 * a cap that mismatch turns into an infinite redirect loop. Playing a build one
 * version behind is a far better failure than never reaching the game at all.
 */
function checkRemoteVersion() {
  if (window.__bbUpdateGaveUp) return;
  fetch('js/core/constants.js?_=' + Date.now(), { cache: 'no-store' })
    .then(r => (r.ok ? r.text() : ''))
    .then(text => {
      const m = text.match(/GAME_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (!m || !m[1] || m[1] === GAME_VERSION) return;

      if (justCameFromUpdate() || updateAttempts() >= MAX_UPDATE_ATTEMPTS) {
        // Stop asking. Log it loudly for a grown-up looking at the console, and
        // let the child play the build that actually loaded.
        window.__bbUpdateGaveUp = true;
        console.warn('[blockbound] remote', m[1], 'local', GAME_VERSION,
          '— cleanup already ran and did not take; staying on this build');
        return;
      }

      try { sessionStorage.setItem(UPDATE_ATTEMPT_KEY, String(updateAttempts() + 1)); } catch (_) {}
      console.warn('[blockbound] remote', m[1], 'local', GAME_VERSION, '— update.html');
      location.replace('update.html?from=' + encodeURIComponent(GAME_VERSION));
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
updatePlayToggleUi();
setScreen('title');
registerSW();
checkRemoteVersion();

loadTextures().catch(err => console.warn('texture load', err));
requestAnimationFrame(frame);
