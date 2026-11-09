/** Synthesized tones (no audio files to download): message blip and three ringtones. */

import { getPrefs, type Ringtone } from './prefs';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

/** Browsers only allow sound after a user gesture; call this from any click to unlock audio early. */
export function unlockAudio() {
  audio();
}

function tone(freq: number, start: number, duration: number, gain = 0.18, type: OscillatorType = 'sine') {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = a.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.setValueAtTime(gain, t0 + duration - 0.05);
  g.gain.linearRampToValueAtTime(0, t0 + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export function vibrate(pattern: number | number[]) {
  const p = getPrefs();
  if (p.silent || !p.vibrate) return;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported (e.g. iPhone browsers) */ }
}

export function playMessageTone() {
  const p = getPrefs();
  if (p.silent) return;
  if (p.sounds) {
    tone(880, 0, 0.09, 0.12);
    tone(1320, 0.1, 0.12, 0.1);
  }
  vibrate(80);
}

const PATTERNS: Record<Ringtone, { every: number; play: () => void }> = {
  classic: { every: 3000, play: () => { [0, 0.45].forEach((s) => { tone(440, s, 0.4, 0.12); tone(480, s, 0.4, 0.12); }); } },
  chime: { every: 2400, play: () => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.16, 0.3, 0.13, 'triangle')); } },
  pulse: { every: 1600, play: () => { [0, 0.18, 0.36].forEach((s) => tone(880, s, 0.12, 0.12, 'square')); } },
};

let ringTimer: number | undefined;

/** Loop the chosen ringtone (and vibration) until stopRinging(). */
export function startRinging(ringtone?: Ringtone) {
  stopRinging();
  const p = getPrefs();
  if (p.silent) return;
  const pattern = PATTERNS[ringtone ?? p.ringtone];
  const ring = () => {
    if (getPrefs().sounds) pattern.play();
    vibrate([400, 200, 400]);
  };
  ring();
  ringTimer = window.setInterval(ring, pattern.every);
}

export function stopRinging() {
  window.clearInterval(ringTimer);
  ringTimer = undefined;
  try { navigator.vibrate?.(0); } catch { /* ignore */ }
}

/** Short preview for the settings screen. */
export function previewRingtone(ringtone: Ringtone) {
  unlockAudio();
  PATTERNS[ringtone].play();
}

/** Outgoing "ringing" tone the caller hears while waiting. */
let backTimer: number | undefined;
export function startRingback() {
  stopRingback();
  const play = () => { tone(440, 0, 1, 0.06); tone(480, 0, 1, 0.06); };
  play();
  backTimer = window.setInterval(play, 3000);
}

export function stopRingback() {
  window.clearInterval(backTimer);
  backTimer = undefined;
}
