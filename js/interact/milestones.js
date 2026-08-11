import { MILESTONES } from '../content/milestones.js';
import { toast } from '../ui/toast.js';

/**
 * Unlock a one-shot milestone. Uses toast notifier (DIP — UI side effect isolated).
 */
export function unlockMilestone(meta, stats, ui, id) {
  if (!meta.milestones) meta.milestones = Object.create(null);
  if (meta.milestones[id]) return false;
  meta.milestones[id] = true;
  if (stats) {
    stats.milestones = (stats.milestones | 0) + 1;
  }
  if (ui && MILESTONES[id]) toast(ui, MILESTONES[id]);
  return true;
}
