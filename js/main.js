'use strict';

const cv = document.getElementById('cv');
let ctx = null;
let last = performance.now();
let screenName = 'menu';

function resizeCanvas() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
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
  document.querySelectorAll('.screen').forEach(el => {
    el.classList.toggle('hidden', el.dataset.screen !== name);
  });
  document.querySelectorAll('.play-chrome').forEach(el => {
    el.classList.toggle('hidden', name !== 'play');
  });
}

function updateMenuStats() {
  const s = loadSave();
  const elM = document.getElementById('statMined');
  const elC = document.getElementById('statCirc');
  const elD = document.getElementById('statDist');
  if (elM) elM.textContent = String(s.blocksMined | 0);
  if (elC) elC.textContent = String(s.circumnavigations | 0);
  if (elD) elD.textContent = Math.floor(s.distanceWalked || 0) + 'm';
  const cont = document.getElementById('btnContinue');
  if (cont) {
    cont.classList.toggle('hidden', !s.hasWorld);
    if (s.hasWorld && s.world && s.world.w) {
      cont.textContent = '▶  Continue (' + s.world.w + ' wide)';
    } else if (s.hasWorld) {
      cont.textContent = '▶  Continue';
    }
  }
  const muteBtn = document.getElementById('muteBtn');
  if (muteBtn) muteBtn.textContent = s.muted ? '🔇 Sound off' : '🔊 Sound on';
  audioSetMuted(!!s.muted);
  renderSizeChips();
}

function renderSizeChips() {
  const row = document.getElementById('sizeRow');
  if (!row) return;
  const cur = save.worldSizeId || 'standard';
  row.innerHTML = '';
  WORLD_SIZE_PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-chip' + (p.id === cur ? ' active' : '');
    btn.dataset.size = p.id;
    btn.innerHTML = p.name + '<small>' + p.w.toLocaleString() + ' · ' + p.blurb + '</small>';
    btn.addEventListener('click', () => {
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

function showMenu() {
  enterMenu();
  updateMenuStats();
  setScreen('menu');
  if (window.__pendingReload) {
    window.__pendingReload = false;
    window.__reloaded = true;
    location.reload();
  }
}

const liveInput = makeInput();
let listenersReady = false;

function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;
  bindInput(liveInput, cv, () => {
    const s = getSession();
    return s ? s.cam : { x: WORLD_W / 2, y: SURFACE_Y };
  });

  cv.addEventListener('pointerdown', e => {
    if (screenName !== 'play') return;
    const s = getSession();
    if (!s) return;
    const p = eventToStage(e);
    // Craft / chest / bag capture all taps so mining doesn't steal them
    if (s.ui.craftOpen || s.ui.chestOpen || s.ui.bagOpen) {
      gameClickCraft(p.x, p.y);
      e.preventDefault();
      e.stopPropagation();
      // Cancel any mine/place from the shared input binder
      liveInput.pointerDown = false;
      liveInput.mineTx = null;
      liveInput.mineTy = null;
      liveInput.placeTx = null;
      liveInput.placeTy = null;
    }
  }, true); // capture phase — run before mine/place binder
}

async function startPlay(continueSave) {
  ensureAudio();
  ensureListeners();
  liveInput.pointerDown = false;
  liveInput.mineTx = null;
  liveInput.mineTy = null;
  liveInput.stickX = 0;
  liveInput.stickY = 0;
  liveInput.jump = false;

  const sizeId = save.worldSizeId || 'standard';
  if (!continueSave) {
    applyWorldSize(worldSizePreset(sizeId).w);
  }

  const width = continueSave && save.world && save.world.w
    ? save.world.w
    : worldSizePreset(sizeId).w;
  const needsProgress = !continueSave && width >= 2048;
  if (needsProgress) setGenProgress(0);
  // Disable buttons while generating
  const playBtn = document.getElementById('btnPlay');
  const contBtn = document.getElementById('btnContinue');
  if (playBtn) playBtn.disabled = true;
  if (contBtn) contBtn.disabled = true;

  try {
    await enterPlay(continueSave, {
      worldSizeId: sizeId,
      onProgress: needsProgress ? setGenProgress : null,
    });
    setGenProgress(null);
    setScreen('play');
  } catch (err) {
    console.error(err);
    setGenProgress(null);
    alert('Could not create world: ' + (err && err.message ? err.message : err));
  } finally {
    if (playBtn) playBtn.disabled = false;
    if (contBtn) contBtn.disabled = false;
  }
}

function syncInput(session) {
  if (!session) return;
  const a = session.input;
  const b = liveInput;
  a.left = b.left;
  a.right = b.right;
  a.up = b.up;
  a.down = b.down;
  a.jump = b.jump;
  a.stickX = b.stickX;
  a.stickY = b.stickY;
  a.mineTx = b.mineTx;
  a.mineTy = b.mineTy;
  a.placeTx = b.placeTx;
  a.placeTy = b.placeTy;
  a.pointerDown = b.pointerDown;
  if (b.craftToggle) { a.craftToggle = true; b.craftToggle = false; }
  if (b.modeToggle) { a.modeToggle = true; b.modeToggle = false; }
  if (b.usePressed) { a.usePressed = true; b.usePressed = false; }
  if (b.pauseToggle) { a.pauseToggle = true; b.pauseToggle = false; }
  if (b.bagToggle) { a.bagToggle = true; b.bagToggle = false; }
  if (b.zoomDelta) { a.zoomDelta = (a.zoomDelta || 0) + b.zoomDelta; b.zoomDelta = 0; }
  if (b.hotbarTap >= 0) { a.hotbarTap = b.hotbarTap; b.hotbarTap = -1; }
  if (b.jumpPressed) { a.jumpPressed = true; b.jumpPressed = false; }
  a.keys = b.keys;
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (screenName === 'play') {
    const s = getSession();
    if (s) syncInput(s);
    try {
      if (s) gameUpdate(dt);
    } catch (err) {
      console.error('[blockbound] update error', err);
      // Keep loop alive — show toast if possible
      if (s && s.ui) {
        s.ui.toast = 'Update glitch (see console)';
        s.ui.toastT = 2;
      }
    }
    if (ctx) {
      try {
        ctx.clearRect(0, 0, W, H);
        if (s) gameRender(ctx);
        else {
          // No session — bounce to menu instead of blank sky
          drawMenuBackdrop(ctx, now);
        }
      } catch (err) {
        console.error('[blockbound] render error', err);
      }
    }
  } else if (ctx) {
    // Idle menu backdrop
    drawMenuBackdrop(ctx, now);
  }

  requestAnimationFrame(frame);
}

function drawMenuBackdrop(ctx, now) {
  const t = (now / 1000 / 60) % 1;
  const sky = skyColors(0.3 + Math.sin(now / 8000) * 0.05);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, sky.top);
  g.addColorStop(0.5, sky.mid);
  g.addColorStop(1, sky.bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  drawParallax(ctx, now / 1000, sky.day);
  // Decorative blocks
  for (let i = 0; i < 14; i++) {
    const x = (i * 32 + (now / 50) * 0.2) % (W + 40) - 20;
    const y = H * 0.62 + Math.sin(i + now / 900) * 8;
    drawBlock(ctx, x, y, 28, [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.WOOD][i % 4], 1, i, 0);
  }
}

// UI buttons
function wireUI() {
  document.getElementById('btnPlay').addEventListener('click', () => {
    clearWorldSave();
    startPlay(false);
  });
  document.getElementById('btnContinue').addEventListener('click', () => {
    startPlay(true);
  });
  document.getElementById('btnHow').addEventListener('click', () => {
    document.getElementById('howPanel').classList.toggle('hidden');
  });
  document.getElementById('muteBtn').addEventListener('click', () => {
    save.muted = !save.muted;
    writeSave();
    audioSetMuted(save.muted);
    updateMenuStats();
  });
  document.getElementById('btnHub').addEventListener('click', () => {
    window.location.href = 'https://jmitchell238.github.io/arcade-hub/';
  });
  document.getElementById('btnMenu').addEventListener('click', () => {
    const s = getSession();
    if (s) persistSession(s.world, s.player, s.inv, s.timeOfDay, s.stats, s.ents);
    showMenu();
  });
  document.getElementById('btnCraft').addEventListener('click', () => {
    const s = getSession();
    if (s) s.ui.craftOpen = !s.ui.craftOpen;
  });
  document.getElementById('btnMode').addEventListener('click', () => {
    const s = getSession();
    if (!s) return;
    s.ui.mode = s.ui.mode === 'mine' ? 'place' : 'mine';
    document.getElementById('btnMode').textContent = s.ui.mode === 'mine' ? '⛏ Mine' : '🧱 Place';
    toast(s.ui, s.ui.mode === 'place' ? 'Place mode' : 'Mine mode');
  });
  const useBtn = document.getElementById('btnUse');
  if (useBtn) {
    useBtn.addEventListener('click', () => {
      const s = getSession();
      if (s) s.input.usePressed = true;
    });
  }

  // Version tags
  const ver = GAME_VERSION_LABEL;
  ['versionTag', 'versionMenu'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = ver;
  });
}

// PWA SW
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

loadSave();
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
wireUI();
updateMenuStats();
setScreen('menu');

// Load textures in background; menu uses fallbacks until ready
if (typeof loadTextures === 'function') {
  loadTextures().catch(err => console.warn('texture load', err));
}
requestAnimationFrame(frame);
