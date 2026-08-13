import { W, H, TILE, WORLD_H } from '../core/constants.js';
import { WORLD_W } from '../core/worldSize.js';
import { wrapDeltaX } from '../world/index.js';
import { HOTBAR_SLOT, BAR_H, BAR_LIFT } from '../render/hudLayout.js';

/**
 * Soft lag-follow camera (Blockheads-style).
 * Kids mode: free pan — drag the screen to look around; camera only
 * reels in when the player walks off the edge (or after free-look ends).
 */
export function updateCamera(s, dt) {
  const { player, cam, ui } = s;
  if (!player || !cam) return;
  cam.zoom = (ui && ui.zoom) || cam.zoom || 1;

  // Recover from bad state (NaN cam → blank world)
  if (!Number.isFinite(cam.x) || !Number.isFinite(cam.y)
      || !Number.isFinite(player.x) || !Number.isFinite(player.y)) {
    if (Number.isFinite(player.x)) cam.x = player.x;
    if (Number.isFinite(player.y)) cam.y = player.y - 1.2;
    if (!Number.isFinite(cam.x)) cam.x = 0;
    if (!Number.isFinite(cam.y)) cam.y = 40;
  }

  if (ui && ui.controlMode === 'kids') {
    updateKidsCamera(s, dt);
    return;
  }

  // Classic: sit player a bit higher than center; mild velocity look-ahead
  const vx = player.vx || 0;
  const vy = player.vy || 0;
  const targetX = player.x + vx * 0.15;
  const targetY = player.y - 1.55 + Math.max(-1.2, Math.min(1.8, vy * 0.1));
  let dCam = targetX - cam.x;
  if (dCam > WORLD_W / 2) cam.x += WORLD_W;
  if (dCam < -WORLD_W / 2) cam.x -= WORLD_W;
  const follow = Math.min(1, dt * 2.4);
  cam.x += (targetX - cam.x) * follow;
  cam.y += (targetY - cam.y) * follow;
  cam.y = Math.max(8, Math.min(WORLD_H - 8, cam.y));
}

/**
 * Free camera for Kids mode.
 * - Drag pans the map (applied live in input.js)
 * - While dragging / free-look timer: no auto-follow, no edge pull
 * - After free-look ends: soft edge-follow keeps the child on-screen
 * - Auto-walk gently tracks only if they haven't panned
 */
function updateKidsCamera(s, dt) {
  const { player, cam, ui, input } = s;
  const zoom = cam.zoom || 1;
  const ts = TILE * zoom;
  const halfW = (W / 2) / ts;
  const halfH = (H / 2) / ts;

  // Tick free-look timer (set by drag pan)
  if (input) {
    if (input._panning) {
      // Keep free-look alive the whole time a finger is dragging
      input.panFreelookT = Math.max(input.panFreelookT || 0, 0.5);
    } else if (input.panFreelookT > 0) {
      input.panFreelookT = Math.max(0, input.panFreelookT - dt);
    }
  }

  const freelook = !!(input && (input._panning || (input.panFreelookT || 0) > 0));

  // Keep cam.x in a sane wrap band near the player (coordinate hygiene only)
  let dx = wrapDeltaX(cam.x, player.x);
  if (Math.abs((player.x - cam.x) - dx) > 1) {
    cam.x = player.x - dx;
    dx = wrapDeltaX(cam.x, player.x);
  }

  // Free-look: leave the camera where they dragged it
  if (freelook) {
    cam.y = Math.max(8, Math.min(WORLD_H - 8, cam.y));
    if (ui) ui.cam = cam;
    return;
  }

  // Soft safe rectangle — only pull when near leaving the view
  const edgeX = halfW * 0.72; // more room before auto-reel
  // Asymmetric vertical dead zone: allow upward drift (doesn't interfere with
  // jumping), but keep the player well clear of the bottom HUD. Downward edge
  // accounts for the hotbar + bars + margin so the player's sprite is fully
  // visible above the UI.
  const edgeY_up = halfH * 0.72;
  const hudHeightPx = BAR_H + BAR_LIFT + HOTBAR_SLOT + TILE; // include margin
  const edgeY_down = hudHeightPx / ts; // convert to game tiles
  let pullX = 0;
  let pullY = 0;
  if (dx > edgeX) pullX = dx - edgeX;
  else if (dx < -edgeX) pullX = dx + edgeX;

  const dy = (player.y - 0.8) - cam.y;
  if (dy > edgeY_down) pullY = dy - edgeY_down;
  else if (dy < -edgeY_up) pullY = dy + edgeY_up;

  // Soft edge pull (slow so it doesn't feel locked)
  const edgePull = Math.min(1, dt * 2.2);
  cam.x += pullX * edgePull;
  cam.y += pullY * edgePull;

  // While walking (and they haven't dragged), tighten the horizontal box so a
  // long walk can't leave the character hugging the screen edge. Still a box
  // pull, never a re-center: kids jump and place a block under themselves, and
  // a centering camera yanks the view out from under that. Vertical stays on
  // the wide edge pull above, so jumping alone never moves the camera.
  //
  // Two things were wrong here. It only engaged while a tap-to-walk target was
  // set, so nothing else moved the camera; and a pure proportional pull settles
  // at a *constant* error rather than catching up — at walking speed the
  // character parked ~6 tiles off-centre on an 11.4-tile half-screen and stayed
  // there. Matching the walker's speed first removes that standing error, so
  // the box edge is where they actually end up.
  const walking = Math.abs(player.vx || 0) > 0.6;
  if (walking && !(input && input.camUserPanned)) {
    const walkEdge = halfW * 0.28;
    const wd = wrapDeltaX(cam.x, player.x);
    let walkPull = 0;
    if (wd > walkEdge) walkPull = wd - walkEdge;
    else if (wd < -walkEdge) walkPull = wd + walkEdge;
    if (walkPull !== 0) {
      cam.x += (player.vx || 0) * dt;              // keep pace — no drift
      cam.x += walkPull * Math.min(1, dt * 3.0);   // then close the gap
    }
  }

  // If player issues a new walk target, allow soft follow again
  // (camUserPanned cleared when setMoveTarget runs)

  cam.y = Math.max(8, Math.min(WORLD_H - 8, cam.y));
  if (ui) ui.cam = cam;
}
