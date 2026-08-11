let actx = null;
let muted = false;

export function audioSetMuted(m) {
  muted = !!m;
}

export function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

export function beep(freq, dur, type, gain) {
  if (muted) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type || 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain || 0.04, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export function sfxMine() {
  beep(120 + Math.random() * 40, 0.06, 'triangle', 0.05);
}

export function sfxPlace() {
  beep(320, 0.05, 'square', 0.03);
}

export function sfxCraft() {
  beep(440, 0.08, 'sine', 0.04);
  setTimeout(() => beep(550, 0.1, 'sine', 0.04), 80);
}

export function sfxHurt() {
  beep(90, 0.15, 'sawtooth', 0.05);
}

export function sfxPickup() {
  beep(520, 0.05, 'sine', 0.035);
  setTimeout(() => beep(680, 0.06, 'sine', 0.03), 40);
}

export function sfxJump() {
  beep(180, 0.05, 'square', 0.025);
  beep(260, 0.06, 'square', 0.02);
}

export function sfxDoor() {
  beep(140, 0.08, 'triangle', 0.04);
  setTimeout(() => beep(100, 0.06, 'triangle', 0.03), 50);
}

export function sfxSleep() {
  beep(320, 0.12, 'sine', 0.03);
  setTimeout(() => beep(240, 0.18, 'sine', 0.025), 100);
}
