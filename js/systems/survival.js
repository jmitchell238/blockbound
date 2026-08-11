import { findSpawn } from '../player/index.js';
import { toast } from '../ui/toast.js';
import { sfxHurt } from '../audio/audio.js';
import {
  getDifficulty, hungerDrainPerSec, starveHpPerSec, canSprint,
} from '../core/difficulty.js';

/** Hunger, energy, passive regen, death/respawn — scaled by difficulty. */
export function updateSurvival(s, dt) {
  const { world, player, ui } = s;
  const diff = getDifficulty(s.difficultyId);

  // Creative / invincible: keep vitals topped up, no death
  if (diff.invincible || diff.creative) {
    player.hp = player.maxHp;
    player.hunger = player.maxHunger;
    player.energy = player.maxEnergy;
    player.canSprint = true;
    return;
  }

  const moving = Math.abs(player.vx) > 0.15 || Math.abs(player.vy) > 0.5;
  const baseDrain = hungerDrainPerSec(diff, player.maxHunger);
  // Small move/idle variance around the target full-bar time
  const rate = baseDrain * (moving ? 1.12 : 0.88);
  if (rate > 0) {
    player.hunger = Math.max(0, player.hunger - dt * rate);
  }

  if (player.hunger <= 0 && diff.starveDamagesHp) {
    const dps = starveHpPerSec(diff, player.maxHp);
    if (dps > 0) {
      s.hungerTimer += dt;
      player.hp -= dps * dt;
      // Toast / sfx sparingly so 10-minute drain isn't spammy
      if (s.hungerTimer > 8) {
        s.hungerTimer = 0;
        if (player.invuln <= 0) {
          player.invuln = 0.35;
          sfxHurt();
          toast(ui, 'Starving!');
        }
      }
    }
  } else {
    s.hungerTimer = 0;
    if (player.hunger > 50 && player.hp < player.maxHp && Math.abs(player.vx) < 0.1) {
      player.hp = Math.min(player.maxHp, player.hp + dt * 3);
    }
  }

  // Sprint eligibility (also used by player movement)
  player.canSprint = canSprint(diff, player.hunger, player.maxHunger);

  // Energy: faster drain while sprinting
  const sprinting = !!(player.sprinting && player.canSprint);
  if (moving) {
    player.energy = Math.max(0, player.energy - dt * (sprinting ? 3.2 : 1.4));
  } else {
    player.energy = Math.min(player.maxEnergy, player.energy + dt * 5);
  }
  if (player.energy < 8) {
    player.vx *= 0.92;
    player.sprinting = false;
  }
  // Can't sprint without energy
  if (player.energy < 12) player.canSprint = false;

  if (player.hp <= 0) {
    player.hp = player.maxHp;
    player.energy = player.maxEnergy;
    player.hunger = Math.max(40, player.hunger);
    player.inBoat = false;
    player.sprinting = false;
    const sp = findSpawn(world, player);
    player.x = sp.x + 0.5;
    player.y = sp.y;
    player.vx = 0;
    player.vy = 0;
    toast(ui, player.spawnX != null ? 'Respawned at your bed' : 'You collapsed — respawned at spawn');
  }
}
