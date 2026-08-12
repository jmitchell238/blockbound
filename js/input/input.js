import { W, H, TILE } from '../core/constants.js';
import { HOTBAR_SIZE } from '../inventory/inventory.js';

/**
 * Controls:
 *  - TAP world  → place / attack / (Kids: walk there)
 *  - HOLD world → mine the block under your finger
 *  - Kids mode: drag to pan free camera; no virtual stick
 */

/** Hold this long to dig (short press still places / attacks). */
export const HOLD_MINE_MS = 160;
/** Kids mode: longer hold before dig so little fingers can tap-to-walk. */
export const HOLD_MINE_KIDS_MS = 340;
/** Screen-space drag (stage px) before a press becomes free-camera pan in Kids mode. */
export const PAN_SLOP_PX = 16;

function holdMineThreshold(input) {
  return input.controlMode === 'kids' ? HOLD_MINE_KIDS_MS : HOLD_MINE_MS;
}

export function makeInput() {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    jumpPressed: false,
    /** True while on-screen JUMP is held (keyboard Space is polled separately). */
    _touchJump: false,
    stickX: 0,
    stickY: 0,
    mineTx: null,
    mineTy: null,
    placeTx: null,
    placeTy: null,
    /** One-shot place from a short tap */
    tapPlace: null, // { tx, ty }
    pointerDown: false,
    pointerX: 0,
    pointerY: 0,
    pressStart: 0,
    holdMining: false,
    craftToggle: false,
    modeToggle: false, // unused for mine/place; kept for compat
    usePressed: false,
    pauseToggle: false,
    bagToggle: false,
    attackPressed: false,
    /** Hold Shift (or full stick) to sprint when hunger allows */
    sprint: false,
    /** Creative mode: open block picker */
    creativeToggle: false,
    /** Creative: toggle fly mode */
    flyToggle: false,
    /** Touch: hold fly up / down pads */
    _touchFlyUp: false,
    _touchFlyDown: false,
    zoomDelta: 0,
    hotbarTap: -1,
    keys: Object.create(null),
    /** 'classic' | 'kids' — set each frame from session */
    controlMode: 'classic',
    /** Kids: walk-to point in world tiles { x, y } */
    moveTarget: null,
    /** Kids free-cam: user dragged this frame / session */
    camUserPanned: false,
    _panning: false,
    _panStartX: 0,
    _panStartY: 0,
    _panLastX: 0,
    _panLastY: 0,
    _navStuckT: 0,
    _navLastX: null,
    _navLastY: null,
  };
}

export function bindInput(input, canvas, getCam) {
  const onKey = (e, down) => {
    const k = e.key.toLowerCase();
    input.keys[k] = down;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd'].includes(k)) {
      e.preventDefault();
    }
    if (down) {
      if (k === 'c' || k === 'e') input.craftToggle = true;
      if (k === 'f' || k === 'enter') input.usePressed = true;
      if (k === 'escape' || k === 'p') input.pauseToggle = true;
      if (k === 'i' || k === 'b') input.bagToggle = true;
      if (k === 'x' || k === 'j' || k === 'control') input.attackPressed = true;
      if (k === 'g' || k === 'v') input.creativeToggle = true; // creative inventory
      if (k === 'z') input.flyToggle = true; // Z toggles creative fly
      if (k >= '1' && k <= '8') input.hotbarTap = parseInt(k, 10) - 1;
      if (k === ' ') input.jumpPressed = true;
      // Q no longer toggles mode — optional attack
      if (k === 'q') {
        e.preventDefault();
        input.attackPressed = true;
      }
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
    input._touchJump = false;
    input._touchFlyUp = false;
    input._touchFlyDown = false;
    input.pointerDown = false;
    input.holdMining = false;
    input.mineTx = null;
    input.mineTy = null;
    input.pressStart = 0;
  });

  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

export function handlePointer(input, p, phase, getCam) {
  const kids = input.controlMode === 'kids';
  // Kids mode: no virtual stick — whole lower-left is free for taps / pan
  const inStick = !kids && p.x < 145 && p.y > H - 245;
  // Slightly larger hit zone matching the bright JUMP pad
  const inJump = p.x > W - 130 && p.y > H - 235 && p.y < H - 85;
  // Creative fly: DOWN pad to the LEFT of JUMP (keeps clear of hotbar)
  const inFlyDown = !!input._flyPads
    && p.x > W - 220 && p.x < W - 130
    && p.y > H - 220 && p.y < H - 100;
  const inHotbar = p.y > H - 70;
  // Stick + jump only — HTML chrome buttons are separate DOM and don't need a canvas dead-zone.
  // (A wide dead-zone here blocked mining/placing on the lower world.)

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
      input._touchJump = true;
      input.jump = true;
      input.jumpPressed = true;
      input._touchFlyUp = true;
      return;
    }
    if (inFlyDown) {
      input._touchFlyDown = true;
      input.down = true;
      return;
    }
    if (inStick) {
      input._stickId = p.id;
      updateStick(input, p);
      return;
    }

    // World press — may become hold-mine, free-cam pan (kids), or tap-place/go
    input.pointerDown = true;
    input.holdMining = false;
    input._panning = false;
    input.pressStart = performance.now();
    input.pointerX = p.x;
    input.pointerY = p.y;
    input._panStartX = p.x;
    input._panStartY = p.y;
    input._panLastX = p.x;
    input._panLastY = p.y;
    input._worldId = p.id;
    mapPointerToTile(input, p, getCam());
    // Don't mine yet until hold threshold
    input.mineTx = null;
    input.mineTy = null;
  }

  if (phase === 'move') {
    if (input._stickId === p.id) updateStick(input, p);
    if (input._worldId === p.id && input.pointerDown) {
      input.pointerX = p.x;
      input.pointerY = p.y;

      // Kids free camera: drag to pan the world (Blockheads-style)
      if (kids && !input.holdMining) {
        const drag = Math.hypot(p.x - input._panStartX, p.y - input._panStartY);
        if (input._panning || drag > PAN_SLOP_PX) {
          if (!input._panning) {
            input._panning = true;
            input._panLastX = p.x;
            input._panLastY = p.y;
          }
          const cam = getCam();
          const ts = TILE * ((cam && cam.zoom) || 1);
          const ddx = (p.x - input._panLastX) / ts;
          const ddy = (p.y - input._panLastY) / ts;
          // Finger moves content with it
          cam.x -= ddx;
          cam.y -= ddy;
          input._panLastX = p.x;
          input._panLastY = p.y;
          input.camUserPanned = true;
          // Cancel any mine intent while panning
          input.mineTx = null;
          input.mineTy = null;
          input.placeTx = null;
          input.placeTy = null;
          return;
        }
      }

      mapPointerToTile(input, p, getCam());
      // If already hold-mining, keep mine target updated
      if (input.holdMining) {
        input.mineTx = input.placeTx;
        input.mineTy = input.placeTy;
      }
    }
  }

  if (phase === 'up') {
    if (input._stickId === p.id) {
      input.stickX = 0;
      input.stickY = 0;
      input._stickId = null;
    }
    if (input._worldId === p.id) {
      const held = performance.now() - (input.pressStart || 0);
      const tx = input.placeTx;
      const ty = input.placeTy;
      const wasPan = input._panning;

      const holdLim = holdMineThreshold(input);
      if (!wasPan && !input.holdMining && held < holdLim && tx != null && ty != null) {
        // Short tap → place / interact / (kids) walk-to
        input.tapPlace = { tx, ty };
      }

      input.pointerDown = false;
      input.holdMining = false;
      input._panning = false;
      input.mineTx = null;
      input.mineTy = null;
      input.placeTx = null;
      input.placeTy = null;
      input.pressStart = 0;
      input._worldId = null;
    }
    // End touch jump (and clear sticky jump if this release is the jump pad)
    if (inJump || input._touchJump) {
      input._touchJump = false;
      input._touchFlyUp = false;
      // Only clear jump if Space isn't still held — pollInput will re-apply keys
      if (!input.keys[' ']) input.jump = false;
    }
    if (inFlyDown || input._touchFlyDown) {
      input._touchFlyDown = false;
      if (!input.keys['s'] && !input.keys['arrowdown']) input.down = false;
    }
  }
}

export function updateStick(input, p) {
  const cx = 70;
  const cy = H - 160;
  const dx = (p.x - cx) / 48;
  const dy = (p.y - cy) / 48;
  const len = Math.hypot(dx, dy) || 1;
  const m = Math.min(1, len);
  input.stickX = (dx / len) * m;
  input.stickY = (dy / len) * m;
}

export function mapPointerToTile(input, p, cam) {
  const ts = TILE * ((cam && cam.zoom) || 1);
  const tx = Math.floor(cam.x + (p.x - W / 2) / ts);
  const ty = Math.floor(cam.y + (p.y - H / 2) / ts);
  // placeTx always tracks finger tile; mineTx only while hold-mining
  input.placeTx = tx;
  input.placeTy = ty;
  if (input.holdMining) {
    input.mineTx = tx;
    input.mineTy = ty;
  }
}

/**
 * Call each frame: promote long press to mining.
 */
export function updateHoldMine(input) {
  if (!input.pointerDown || input.holdMining || input._panning) return;
  if (!input.pressStart) return;
  if (performance.now() - input.pressStart >= holdMineThreshold(input)) {
    input.holdMining = true;
    input.mineTx = input.placeTx;
    input.mineTy = input.placeTy;
  }
}

export function pollInput(input, mode, cam) {
  const k = input.keys;
  input.left = !!(k['a'] || k['arrowleft']);
  input.right = !!(k['d'] || k['arrowright']);
  input.up = !!(k['w'] || k['arrowup']);
  input.down = !!(k['s'] || k['arrowdown'] || input._touchFlyDown);
  // Space held OR on-screen JUMP held — never latch from previous frame
  // (old bug: jump = space || jump → infinite bunny-hop after one press)
  input.jump = !!(k[' '] || input._touchJump || input._touchFlyUp);
  // Sprint: left/right Shift
  input.sprint = !!(k['shift'] || k['shifts'] || k['shiftleft'] || k['shiftright']);
  updateHoldMine(input);
}
