import { WORLD_H } from '../core/constants.js';
import { WORLD_W } from '../core/worldSize.js';

export function updateCamera(s, dt) {
  const { player, cam, ui } = s;
  const targetX = player.x;
  const targetY = player.y - 0.8;
  let dCam = targetX - cam.x;
  if (dCam > WORLD_W / 2) cam.x += WORLD_W;
  if (dCam < -WORLD_W / 2) cam.x -= WORLD_W;
  cam.x += (targetX - cam.x) * Math.min(1, dt * 8);
  cam.y += (targetY - cam.y) * Math.min(1, dt * 8);
  cam.y = Math.max(8, Math.min(WORLD_H - 8, cam.y));
  cam.zoom = ui.zoom || 1;
}
