import { useEffect, useState } from 'react';
import type { Realtime } from '../services/realtime';
import type { Presence } from '../types';

const TYPING_TTL_MS = 6000;

/** "typing…" and "online / last seen" for the open chat (respecting both people's privacy settings). */
export function usePeerStatus(rt: Realtime | null, peerId: string) {
  const [typing, setTyping] = useState(false);
  const [presence, setPresence] = useState<Presence | null>(null);

  useEffect(() => {
    if (!rt) return;
    let clear: number | undefined;
    const watch = () => rt.send({ type: 'presence_watch', user: peerId });
    const offs = [
      rt.on('open', watch),
      rt.on('presence', (e) => { if (e.user === peerId) setPresence(e as unknown as Presence); }),
      rt.on('typing', (e) => {
        if (e.from !== peerId) return;
        window.clearTimeout(clear);
        setTyping(Boolean(e.state));
        if (e.state) clear = window.setTimeout(() => setTyping(false), TYPING_TTL_MS);
      }),
      rt.on('sync', () => setTyping(false)),
    ];
    watch();
    return () => {
      offs.forEach((off) => off());
      window.clearTimeout(clear);
      rt.send({ type: 'presence_unwatch', user: peerId });
    };
  }, [rt, peerId]);

  return { typing, presence };
}

/** Throttled "I'm typing" signal: at most every 3 s, and "stopped" after 4 s idle or on send. */
export function useTypingSender(rt: Realtime | null, peerId: string) {
  const [state] = useState(() => ({ last: 0, idle: 0 as number | undefined }));
  const stop = () => {
    window.clearTimeout(state.idle);
    if (state.last) { rt?.send({ type: 'typing', to: peerId, state: false }); state.last = 0; }
  };
  const typing = () => {
    const now = Date.now();
    if (now - state.last > 3000) { rt?.send({ type: 'typing', to: peerId, state: true }); state.last = now; }
    window.clearTimeout(state.idle);
    state.idle = window.setTimeout(stop, 4000);
  };
  useEffect(() => () => stop(), [peerId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { typing, stop };
}
