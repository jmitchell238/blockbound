import { DAY_LEN } from '../core/constants.js';
import { flushLight, tickGravity } from '../world/index.js';
import { persistSession } from '../save/save.js';
import { toast } from '../ui/toast.js';
import { updateParticles } from '../particles/particles.js';

export function updateWorldServices(s, dt) {
  const { world, player, inv, stats, ents } = s;

  updateParticles(s.particles, dt);
  s.timeOfDay = (s.timeOfDay + dt / DAY_LEN) % 1;

  // Only disturbed blocks fall, and only until they land. Nothing here depends
  // on where the player is standing.
  s.gravTimer = (s.gravTimer || 0) + dt;
  if (s.gravTimer > 0.25) {
    s.gravTimer = 0;
    tickGravity(world);
  }

  s.lightTimer += dt;
  if (world.dirtyLight && s.lightTimer > 0.08) {
    flushLight(world);
    s.lightTimer = 0;
  }

  s.saveTimer += dt;
  if (s.saveTimer > 12) {
    s.saveTimer = 0;
    const ok = persistSession(world, player, inv, s.timeOfDay, stats, ents, s.difficultyId);
    // localStorage is ~5 MB for the whole origin and a heavily dug world can be
    // 1.7 MB. When it fills, the write throws and everything built since the
    // last good save is gone. Say so — loudly, and keep saying it, because the
    // child will otherwise keep building into a world nobody is writing down.
    if (ok === false) {
      s._saveFailT = (s._saveFailT || 0) + 1;
      if (s._saveFailT === 1 || s._saveFailT % 5 === 0) {
        toast(s.ui, '⚠ Could not save — device storage is full');
      }
    } else if (s._saveFailT) {
      s._saveFailT = 0;
      toast(s.ui, 'Saved again ✓');
    }
  }
}
