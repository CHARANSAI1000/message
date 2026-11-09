import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, contactsApi, messagesApi, usersApi } from '../api';
import { POLL_HIDDEN_MS, POLL_VISIBLE_MS } from '../constants';
import { hiddenMessages, hideMessage } from '../services/prefs';
import type { Realtime } from '../services/realtime';
import { playMessageTone } from '../services/sounds';
import type { Vault } from '../services/vault';
import type { ChatMessage, User } from '../types';

const POLL_WITH_SOCKET_MS = 30_000; // safety net; the WebSocket nudges us instantly

/** All messenger state: encrypted sync, decrypted messages, contacts, blocks and profiles. */
export function useMessenger(vault: Vault, rt: Realtime | null, onSignedOut: () => void, activePeer: string | null) {
  const [messages, setMessages] = useState<Map<string, ChatMessage>>(new Map());
  const [users, setUsers] = useState<Record<string, User>>({});
  const [contacts, setContacts] = useState<User[]>([]);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(() => hiddenMessages(vault.me.id));
  const [now, setNow] = useState(Date.now());
  const [offline, setOffline] = useState(false);
  const cursor = useRef(0);
  const loaded = useRef(false);
  const known = useRef(new Set<string>());
  const active = useRef(activePeer);
  active.current = activePeer;

  const rememberUsers = useCallback((list: User[]) => {
    setUsers((u) => ({ ...u, ...Object.fromEntries(list.map((x) => [x.id, x])) }));
  }, []);

  const addMessages = useCallback((list: ChatMessage[]) => {
    if (!list.length) return;
    setMessages((m) => {
      const next = new Map(m);
      list.forEach((x) => {
        const prev = next.get(x.id);
        if (!prev || x.rev >= prev.rev) next.set(x.id, x);
      });
      return next;
    });
  }, []);

  const refreshContacts = useCallback(async () => {
    const [c, b] = await Promise.all([contactsApi.list(), contactsApi.blocked()]);
    setContacts(c);
    rememberUsers(c);
    setBlocked(new Set(b));
  }, [rememberUsers]);

  const hide = useCallback((id: string) => setHidden(new Set(hideMessage(vault.me.id, id))), [vault]);

  // Sync loop: one at a time; a nudge during a sync schedules another pass.
  const syncNow = useRef<() => void>(() => undefined);
  useEffect(() => {
    let stopped = false;
    let running = false;
    let again = false;
    let timer: number | undefined;

    const tick = async () => {
      if (running) { again = true; return; }
      running = true;
      window.clearTimeout(timer);
      try {
        let more = true;
        while (more && !stopped) {
          const page = await messagesApi.sync(cursor.current);
          more = page.has_more;
          if (page.messages.length) cursor.current = Math.max(cursor.current, ...page.messages.map((e) => e.rev));
          const decrypted = await Promise.all(page.messages.map((e) => vault.decrypt(e)));
          const fresh = decrypted.filter((m) => !known.current.has(m.id));
          decrypted.forEach((m) => known.current.add(m.id));
          addMessages(decrypted);
          if (loaded.current && fresh.some((m) => !m.outgoing && !m.deleted
              && (document.visibilityState !== 'visible' || active.current !== m.peerId))) {
            playMessageTone();
          }
        }
        loaded.current = true;
        setOffline(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) { onSignedOut(); return; }
        setOffline(true);
      } finally {
        running = false;
      }
      if (stopped) return;
      if (again) { again = false; void tick(); return; }
      const wait = rt?.connected ? POLL_WITH_SOCKET_MS : document.visibilityState === 'visible' ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
      timer = window.setTimeout(tick, wait);
    };
    syncNow.current = () => void tick();

    const wake = () => { if (document.visibilityState === 'visible') void tick(); };
    const offSync = rt?.on('sync', () => void tick()) ?? (() => undefined);
    void tick();
    void refreshContacts().catch(() => undefined);
    document.addEventListener('visibilitychange', wake);
    const clock = window.setInterval(() => setNow(Date.now()), 15000);
    return () => {
      stopped = true;
      offSync();
      window.clearTimeout(timer);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [vault, rt, addMessages, refreshContacts, onSignedOut]);

  // Disappearing messages vanish locally as soon as they expire; "deleted for me" are hidden.
  const visible = useMemo(
    () => [...messages.values()].filter((m) => m.expiresAt > now && !hidden.has(m.id)).sort((a, b) => a.seq - b.seq),
    [messages, now, hidden],
  );

  // Fetch profiles for people we have conversations with but no cached profile.
  useEffect(() => {
    const missing = [...new Set(visible.map((m) => m.peerId))].filter((id) => !users[id]);
    if (missing.length) {
      Promise.all(missing.map((id) => usersApi.get(id).catch(() => null)))
        .then((list) => rememberUsers(list.filter((u): u is User => u !== null)));
    }
  }, [visible, users, rememberUsers]);

  /** Latest message per conversation, newest first. */
  const threads = useMemo(() => {
    const last = new Map<string, ChatMessage>();
    visible.forEach((m) => last.set(m.peerId, m));
    return [...last.values()].sort((a, b) => b.seq - a.seq);
  }, [visible]);

  return {
    messages: visible, threads, users, contacts, blocked, offline,
    rememberUsers, addMessages, refreshContacts, hide, syncNow: () => syncNow.current(),
  };
}
