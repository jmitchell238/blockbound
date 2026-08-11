import { findSpawn } from '../player/index.js';
import { toast } from '../ui/toast.js';
import { sfxHurt } from '../audio/audio.js';

/** Hunger, energy, passive regen, death/respawn. */
export function updateSurvival(s, dt) {
  const { world, player, ui } = s;

  s.hungerTimer += dt;
  const moving = Math.abs(player.vx) > 0.15 || Math.abs(player.vy) > 0.5;
  player.hunger = Math.max(0, player.hunger - dt * (moving ? 1.1 : 0.45));
  if (player.hunger <= 0) {
    if (s.hungerTimer > 1.2) {
      s.hungerTimer = 0;
      player.hp -= 4;
      if (player.invuln <= 0) {
        player.invuln = 0.4;
        sfxHurt();
        toast(ui, 'Starving!');
      }
    }
  } else if (player.hunger > 50 && player.hp < player.maxHp && Math.abs(player.vx) < 0.1) {
    player.hp = Math.min(player.maxHp, player.hp + dt * 3);
  }

  if (moving) player.energy = Math.max(0, player.energy - dt * 1.4);
  else player.energy = Math.min(player.maxEnergy, player.energy + dt * 5);
  if (player.energy < 8) {
    player.vx *= 0.92;
  }

  if (player.hp <= 0) {
    player.hp = player.maxHp;
    player.energy = player.maxEnergy;
    player.hunger = Math.max(40, player.hunger);
    player.inBoat = false;
    const sp = findSpawn(world, player);
    player.x = sp.x + 0.5;
    player.y = sp.y;
    player.vx = 0;
    player.vy = 0;
    toast(ui, player.spawnX != null ? 'Respawned at your bed' : 'You collapsed — respawned at spawn');
  }
}
