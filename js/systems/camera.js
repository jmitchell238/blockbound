import { W, H, TILE, WORLD_H } from '../core/constants.js';
import { WORLD_W } from '../core/worldSize.js';
import { wrapDeltaX } from '../world/index.js';

/**
 * Soft lag-follow camera (Blockheads-style).
 * Kids mode: free pan — camera stays where you drag it, only reels in
 * when the player drifts near the edge of the screen.
 */
export function updateCamera(s, dt) {
  const { player, cam, ui } = s;
  cam.zoom = ui.zoom || 1;

  if (ui.controlMode === 'kids') {
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
 * - Drag pans (applied in input)
 * - Soft edge-follow keeps the child on-screen without hard lock
 * - Optional gentle follow while auto-walking if user hasn't panned away
 */
function updateKidsCamera(s, dt) {
  const { player, cam, ui, input } = s;
  const zoom = cam.zoom || 1;
  const ts = TILE * zoom;
  const halfW = (W / 2) / ts;
  const halfH = (H / 2) / ts;

  // Keep cam.x in a sane wrap band near the player
  let dx = wrapDeltaX(cam.x, player.x);
  // If cam and player are more than half a world apart in stored coords, nudge cam
  if (Math.abs((player.x - cam.x) - dx) > 1) {
    cam.x = player.x - dx;
  }

  // Soft safe rectangle — only pull when near leaving the view
  const edgeX = halfW * 0.62;
  const edgeY = halfH * 0.62;
  let pullX = 0;
  let pullY = 0;
  if (dx > edgeX) pullX = dx - edgeX;
  else if (dx < -edgeX) pullX = dx + edgeX;

  const dy = (player.y - 0.8) - cam.y;
  if (dy > edgeY) pullY = dy - edgeY;
  else if (dy < -edgeY) pullY = dy + edgeY;

  // While auto-walking and user hasn't dragged recently, slowly track
  const autoWalk = !!(input && input.moveTarget) && !input.camUserPanned;
  const edgePull = Math.min(1, dt * 3.2);
  cam.x += pullX * edgePull;
  cam.y += pullY * edgePull;

  if (autoWalk) {
    const targetX = player.x + (player.vx || 0) * 0.1;
    const targetY = player.y - 1.4;
    let d = wrapDeltaX(cam.x, targetX);
    // Convert to absolute target with wrap
    const ax = cam.x + d;
    const follow = Math.min(1, dt * 1.6);
    cam.x += (ax - cam.x) * follow;
    cam.y += (targetY - cam.y) * follow;
  }

  // If user panned, decay the "stay put" flag once player is comfortably on screen
  if (input && input.camUserPanned && Math.abs(pullX) < 0.05 && Math.abs(pullY) < 0.05
      && !(input.moveTarget)) {
    // keep camUserPanned so free look persists until they issue a new walk
  }

  cam.y = Math.max(8, Math.min(WORLD_H - 8, cam.y));
  ui.cam = cam; // handy for debug
}
