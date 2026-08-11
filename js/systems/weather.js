import { spawnBurst } from '../particles/particles.js';
import { unlockMilestone } from '../interact/milestones.js';

export function updateWeather(s, dt) {
  const { player, ui, world, stats } = s;
  const dayAmt = Math.sin(s.timeOfDay * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
  const rainWave = Math.sin(s.timeOfDay * Math.PI * 4 + (s.seed || 0) * 0.001);
  ui.weather = dayAmt > 0.2 && rainWave > 0.55 ? Math.min(1, (rainWave - 0.55) * 3) : Math.max(0, ui.weather - dt * 0.3);
  if (ui.weather > 0.3 && Math.random() < dt * 20) {
    spawnBurst(s.particles, player.x + (Math.random() - 0.5) * 8, player.y - 4 - Math.random() * 6, '#8ec8ff', 1);
  }

  const isNight = dayAmt < 0.35;
  if (ui.wasNight && !isNight) unlockMilestone(world.meta, stats, ui, 'survived_night');
  ui.wasNight = isNight;
}
