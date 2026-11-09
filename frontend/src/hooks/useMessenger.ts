import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, contactsApi, messagesApi, usersApi } from '../api';
import { POLL_HIDDEN_MS, POLL_VISIBLE_MS } from '../constants';
import type { Vault } from '../services/vault';
import type { ChatMessage, User } from '../types';

/** All messenger state: encrypted sync polling, decrypted messages, contacts, blocks and profiles. */
export function useMessenger(vault: Vault, onSignedOut: () => void) {
  const [messages, setMessages] = useState<Map<string, ChatMessage>>(new Map());
  const [users, setUsers] = useState<Record<string, User>>({});
  const [contacts, setContacts] = useState<User[]>([]);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [offline, setOffline] = useState(false);
  const cursor = useRef(0);

  const rememberUsers = useCallback((list: User[]) => {
    setUsers((u) => ({ ...u, ...Object.fromEntries(list.map((x) => [x.id, x])) }));
  }, []);

  const addMessages = useCallback((list: ChatMessage[]) => {
    if (list.length) setMessages((m) => { const next = new Map(m); list.forEach((x) => next.set(x.id, x)); return next; });
  }, []);

  const refreshContacts = useCallback(async () => {
    const [c, b] = await Promise.all([contactsApi.list(), contactsApi.blocked()]);
    setContacts(c);
    rememberUsers(c);
    setBlocked(new Set(b));
  }, [rememberUsers]);

  // Poll for new encrypted envelopes. Faster while the tab is visible.
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        let more = true;
        while (more && !stopped) {
          const page = await messagesApi.sync(cursor.current);
          more = page.has_more;
          if (page.messages.length) cursor.current = page.messages[page.messages.length - 1].seq;
          addMessages(await Promise.all(page.messages.map((e) => vault.decrypt(e))));
        }
        setOffline(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) { onSignedOut(); return; }
        setOffline(true);
      }
      if (!stopped) timer = window.setTimeout(tick, document.visibilityState === 'visible' ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
    };
    const wake = () => { if (document.visibilityState === 'visible') { window.clearTimeout(timer); void tick(); } };
    void tick();
    void refreshContacts().catch(() => undefined);
    document.addEventListener('visibilitychange', wake);
    const clock = window.setInterval(() => setNow(Date.now()), 15000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [vault, addMessages, refreshContacts, onSignedOut]);

  // Disappearing messages vanish locally as soon as they expire.
  const visible = useMemo(
    () => [...messages.values()].filter((m) => m.expiresAt > now).sort((a, b) => a.seq - b.seq),
    [messages, now],
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

  return { messages: visible, threads, users, contacts, blocked, offline, rememberUsers, addMessages, refreshContacts };
}
