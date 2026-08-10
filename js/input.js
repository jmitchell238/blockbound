'use strict';

/**
 * Keyboard + touch controls for platformer sandbox.
 * Touch: left stick, jump button, tap world to mine/place, hotbar taps.
 */

function makeInput() {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    jumpPressed: false,
    stickX: 0,
    stickY: 0,
    mineTx: null,
    mineTy: null,
    placeTx: null,
    placeTy: null,
    pointerDown: false,
    pointerX: 0,
    pointerY: 0,
    craftToggle: false,
    modeToggle: false,
    usePressed: false,
    pauseToggle: false,
    zoomDelta: 0,
    hotbarTap: -1,
    keys: Object.create(null),
  };
}

function bindInput(input, canvas, getCam) {
  const onKey = (e, down) => {
    const k = e.key.toLowerCase();
    input.keys[k] = down;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd'].includes(k)) {
      e.preventDefault();
    }
    if (down) {
      if (k === 'c' || k === 'e') input.craftToggle = true;
      if (k === 'q' || k === 'tab') {
        e.preventDefault();
        input.modeToggle = true;
      }
      if (k === 'f' || k === 'enter') input.usePressed = true;
      if (k === 'escape' || k === 'p') input.pauseToggle = true;
      if (k >= '1' && k <= '8') input.hotbarTap = parseInt(k, 10) - 1;
      if (k === ' ') input.jumpPressed = true;
    }
  };
  window.addEventListener('keydown', e => onKey(e, true));
  window.addEventListener('keyup', e => onKey(e, false));
  canvas.addEventListener('wheel', e => {
    input.zoomDelta += e.deltaY > 0 ? -1 : 1;
    e.preventDefault();
  }, { passive: false });

  const pointers = new Map();

  function stagePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
      id: e.pointerId,
    };
  }

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const p = stagePos(e);
    pointers.set(e.pointerId, p);
    handlePointer(input, p, 'down', getCam);
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const p = stagePos(e);
    pointers.set(e.pointerId, p);
    handlePointer(input, p, 'move', getCam);
    if (input._rightHeld) mapPointerToTile(input, p, getCam());
  });
  canvas.addEventListener('pointerup', e => {
    const p = stagePos(e);
    handlePointer(input, p, 'up', getCam);
    pointers.delete(e.pointerId);
  });
  canvas.addEventListener('pointercancel', e => {
    pointers.delete(e.pointerId);
    input.stickX = 0;
    input.stickY = 0;
    input.jump = false;
    input.pointerDown = false;
    input.mineTx = null;
    input.mineTy = null;
  });

  // Right-click = place (desktop); left-click = mine
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const p = stagePos(e);
    const cam = getCam();
    const tx = Math.floor(cam.x + (p.x - W / 2) / TILE);
    const ty = Math.floor(cam.y + (p.y - H / 2) / TILE);
    input.placeTx = tx;
    input.placeTy = ty;
    input._rightPlace = true;
  });
  canvas.addEventListener('mousedown', e => {
    if (e.button === 2) {
      input._rightHeld = true;
      const p = stagePos(e);
      mapPointerToTile(input, p, getCam());
      input._rightPlace = true;
    }
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 2) {
      input._rightHeld = false;
      input._rightPlace = false;
    }
  });
}

function handlePointer(input, p, phase, getCam) {
  // Virtual controls zones
  const inStick = p.x < 140 && p.y > H - 240;
  const inJump = p.x > W - 130 && p.y > H - 230 && p.y < H - 90;
  const inHotbar = p.y > H - 70;

  if (phase === 'down') {
    if (inHotbar) {
      const slot = 40;
      const gap = 4;
      const total = HOTBAR_SIZE * slot + (HOTBAR_SIZE - 1) * gap;
      const hx = (W - total) / 2;
      const i = Math.floor((p.x - hx) / (slot + gap));
      if (i >= 0 && i < HOTBAR_SIZE) input.hotbarTap = i;
      return;
    }
    if (inJump) {
      input.jump = true;
      input.jumpPressed = true;
      return;
    }
    if (inStick) {
      input._stickId = p.id;
      updateStick(input, p);
      return;
    }
    // World interact
    input.pointerDown = true;
    input.pointerX = p.x;
    input.pointerY = p.y;
    input._worldId = p.id;
    mapPointerToTile(input, p, getCam());
  }

  if (phase === 'move') {
    if (input._stickId === p.id) updateStick(input, p);
    if (input._worldId === p.id && input.pointerDown) {
      input.pointerX = p.x;
      input.pointerY = p.y;
      mapPointerToTile(input, p, getCam());
    }
  }

  if (phase === 'up') {
    if (input._stickId === p.id) {
      input.stickX = 0;
      input.stickY = 0;
      input._stickId = null;
    }
    if (input._worldId === p.id) {
      input.pointerDown = false;
      input.mineTx = null;
      input.mineTy = null;
      input.placeTx = null;
      input.placeTy = null;
      input._worldId = null;
    }
    if (inJump || input.jump) input.jump = false;
  }
}

function updateStick(input, p) {
  const cx = 70;
  const cy = H - 160;
  const dx = (p.x - cx) / 48;
  const dy = (p.y - cy) / 48;
  const len = Math.hypot(dx, dy) || 1;
  const m = Math.min(1, len);
  input.stickX = (dx / len) * m;
  input.stickY = (dy / len) * m;
}

function mapPointerToTile(input, p, cam) {
  const ts = TILE * ((cam && cam.zoom) || 1);
  const tx = Math.floor(cam.x + (p.x - W / 2) / ts);
  const ty = Math.floor(cam.y + (p.y - H / 2) / ts);
  input.mineTx = tx;
  input.mineTy = ty;
  input.placeTx = tx;
  input.placeTy = ty;
}

/**
 * Poll keyboard into input each frame. mode: 'mine' | 'place'
 */
function pollInput(input, mode, cam) {
  const k = input.keys;
  input.left = !!(k['a'] || k['arrowleft']);
  input.right = !!(k['d'] || k['arrowright']);
  input.up = !!(k['w'] || k['arrowup']);
  input.down = !!(k['s'] || k['arrowdown']);
  if (k[' '] || k['w'] || k['arrowup']) {
    // jump also from space; climb uses up
  }
  input.jump = !!(k[' '] || input.jump);

  // Desktop mouse held mining via pointer already set
  // Right-click place: if buttons — use mode toggle instead for simplicity
  if (mode === 'place' && input.pointerDown) {
    // place handled in game loop via placeTx
  }

  // Mouse position continuous for hover mine when button held — already in mapPointerToTile
}
