import { DAY_LEN } from '../core/constants.js';
import { flushLight, tickGravityNear } from '../world/index.js';
import { persistSession } from '../save/save.js';
import { updateParticles } from '../particles/particles.js';

export function updateWorldServices(s, dt) {
  const { world, player, inv, stats, ents } = s;

  updateParticles(s.particles, dt);
  s.timeOfDay = (s.timeOfDay + dt / DAY_LEN) % 1;

  s.gravTimer = (s.gravTimer || 0) + dt;
  if (s.gravTimer > 0.25) {
    s.gravTimer = 0;
    tickGravityNear(world, player.x, player.y, 12);
  }

  s.lightTimer += dt;
  if (world.dirtyLight && s.lightTimer > 0.08) {
    flushLight(world);
    s.lightTimer = 0;
  }

  s.saveTimer += dt;
  if (s.saveTimer > 12) {
    s.saveTimer = 0;
    persistSession(world, player, inv, s.timeOfDay, stats, ents);
  }
}
