const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Short timestamp for lists: time today, weekday this week, otherwise date. */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 6) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function describeAgent(ua: string): { name: string; mobile: boolean } {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return { name: os ? `${browser} on ${os}` : browser, mobile: /iPhone|iPad|Android|Mobile/.test(ua) };
}

export function errorText(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof Error ? e.message : fallback;
}

/** 0–4 rough strength score for the sign-up meter (the server enforces the real policy). */
export function passwordScore(pw: string): number {
  if (pw.length < 12) return pw.length ? 1 : 0;
  let score = 2;
  if (pw.length >= 16) score++;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes >= 3) score++;
  return Math.min(score, 4);
}
