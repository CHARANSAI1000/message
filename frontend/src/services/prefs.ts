/** Per-device preferences (sounds, vibration, ringtone) and small per-user lists, in localStorage. */

export type Ringtone = 'classic' | 'chime' | 'pulse';
export type Prefs = { sounds: boolean; vibrate: boolean; silent: boolean; ringtone: Ringtone };

const DEFAULTS: Prefs = { sounds: true, vibrate: true, silent: false, ringtone: 'classic' };
const KEY = 'foryou:prefs';
const listeners = new Set<(p: Prefs) => void>();

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } as T : fallback;
  } catch { return fallback; }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function getPrefs(): Prefs {
  return read(KEY, DEFAULTS);
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...getPrefs(), ...patch };
  write(KEY, next);
  listeners.forEach((l) => l(next));
  return next;
}

export function onPrefs(l: (p: Prefs) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/* "Delete for me": message ids hidden on this device. */
export function hiddenMessages(userId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(`foryou:hidden:${userId}`) ?? '[]') as string[]); } catch { return new Set(); }
}

export function hideMessage(userId: string, messageId: string): Set<string> {
  const set = hiddenMessages(userId);
  set.add(messageId);
  write(`foryou:hidden:${userId}`, [...set].slice(-5000));
  return set;
}

/* Call history lives only on this device (the server never learns call outcomes). */
export type CallLogEntry = {
  id: string; peerId: string; peerName: string; video: boolean;
  direction: 'outgoing' | 'incoming';
  status: 'completed' | 'missed' | 'declined' | 'no-answer' | 'failed' | 'busy';
  at: number; duration: number;
};

export function callLog(userId: string): CallLogEntry[] {
  try { return JSON.parse(localStorage.getItem(`foryou:calls:${userId}`) ?? '[]') as CallLogEntry[]; } catch { return []; }
}

export function addCallLog(userId: string, entry: CallLogEntry): CallLogEntry[] {
  const next = [entry, ...callLog(userId).filter((e) => e.id !== entry.id)].slice(0, 200);
  write(`foryou:calls:${userId}`, next);
  window.dispatchEvent(new Event('foryou:calls'));
  return next;
}

export function clearCallLog(userId: string) {
  write(`foryou:calls:${userId}`, []);
  window.dispatchEvent(new Event('foryou:calls'));
}
