export const DISAPPEARING_TIMERS: { label: string; value: number | null }[] = [
  { label: 'Off', value: null },
  { label: '5 min', value: 300 },
  { label: '1 hour', value: 3600 },
  { label: '1 day', value: 86400 },
  { label: '1 week', value: 604800 },
];

export const POLL_VISIBLE_MS = 3000;
export const POLL_HIDDEN_MS = 20000;
export const MAX_MESSAGE_CHARS = 4000;
