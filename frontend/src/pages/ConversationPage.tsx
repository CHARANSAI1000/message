import {
  ArrowLeft, Check, Lock, SendHorizontal, ShieldAlert, ShieldCheck, ShieldQuestion, Timer, TimerOff,
} from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { usersApi } from '../api';
import { Alert } from '../components/Alert';
import { Avatar } from '../components/Avatar';
import { Menu } from '../components/Menu';
import { Modal } from '../components/Modal';
import { DISAPPEARING_TIMERS as TIMERS, MAX_MESSAGE_CHARS } from '../constants';
import { safetyNumber } from '../services/crypto';
import { KeyChangedError, type Vault } from '../services/vault';
import type { ChatMessage, Pin, User } from '../types';
import { dayLabel, errorText, formatClock } from '../utils/format';

type Props = {
  vault: Vault; peer: User; messages: ChatMessage[]; blocked: boolean;
  onBack: () => void; onSent: (m: ChatMessage) => void; onPeerRefreshed: (u: User) => void;
};

const timerLabel = (s: number | null) => TIMERS.find((t) => t.value === s)?.label ?? 'Off';

export function ConversationPage({ vault, peer, messages, blocked, onBack, onSent, onPeerRefreshed }: Props) {
  const [draft, setDraft] = useState('');
  const [ttl, setTtl] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState<Pin | undefined>();
  const [showSafety, setShowSafety] = useState(false);
  const [number, setNumber] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const reloadPin = () => vault.track(peer).then(() => vault.pin(peer.id)).then(setPin).catch((e) => setError(e.message));
  useEffect(() => { void reloadPin(); }, [peer.id, messages.length]);
  useEffect(() => {
    const theirs = pin?.keys[String(pin.currentKeyId)];
    if (theirs && vault.ownSpki) void safetyNumber(vault.ownSpki, theirs).then(setNumber);
  }, [pin, vault]);
  useLayoutEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [messages.length]);
  useEffect(() => { input.current?.focus(); }, []);

  // Auto-grow the composer up to its CSS max-height.
  const autosize = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    try {
      const fresh = await usersApi.get(peer.id); // always encrypt to the contact's latest key
      onPeerRefreshed(fresh);
      onSent(await vault.send(fresh, text, ttl));
      setDraft('');
      requestAnimationFrame(autosize);
    } catch (err) {
      setError(errorText(err, 'Could not send'));
      if (err instanceof KeyChangedError) setShowSafety(true);
    } finally {
      setBusy(false);
      void reloadPin();
      input.current?.focus();
    }
  };

  const setTrust = async (verified: boolean) => {
    await vault.setTrust(peer.id, verified);
    await reloadPin();
    setError('');
  };

  const status = pin?.changed
    ? { cls: '', Icon: ShieldAlert, text: 'Safety number changed' }
    : pin?.verified
      ? { cls: 'verified', Icon: ShieldCheck, text: 'Verified · end-to-end encrypted' }
      : { cls: '', Icon: Lock, text: 'End-to-end encrypted' };

  return (
    <>
      <header className="chat-header">
        <button className="icon-btn back" onClick={onBack} aria-label="Back to chats"><ArrowLeft size={20} /></button>
        <Avatar name={peer.username} />
        <div className="grow">
          <div className="chat-title truncate">{peer.username}</div>
          <div className={`chat-status ${status.cls}`}><status.Icon size={13} /> {status.text}</div>
        </div>
        <button className={`btn btn-sm ${pin?.verified ? 'btn-ghost' : ''}`} onClick={() => setShowSafety(true)}>
          {pin?.verified ? <ShieldCheck size={16} /> : <ShieldQuestion size={16} />}
          <span>{pin?.verified ? 'Verified' : 'Verify'}</span>
        </button>
      </header>

      {pin?.changed && (
        <div className="banner banner-warning" role="alert">
          <ShieldAlert size={18} />
          <div>
            <strong>{peer.username}'s safety number changed.</strong> They may have signed in on a new device — or someone could be
            intercepting. Sending is paused until you review it.
            <div className="row-wrap">
              <button className="btn btn-sm" onClick={() => setShowSafety(true)}>Compare numbers</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setTrust(false)}>Accept new key</button>
            </div>
          </div>
        </div>
      )}

      <div className="chat-scroll" ref={scroller}>
        <div className="chat-inner">
          <div className="e2ee-note"><Lock size={15} /> Messages are end-to-end encrypted. Only you and {peer.username} can read them — not even the ForYou server.</div>
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.sentAt).toDateString() !== new Date(m.sentAt).toDateString();
            const gap = prev && prev.outgoing !== m.outgoing;
            return (
              <Fragment key={m.id}>
                {newDay && <div className="day-sep">{dayLabel(m.sentAt)}</div>}
                <div className={`msg ${m.outgoing ? 'out' : 'in'} ${gap ? 'gap' : ''}`}>
                  <div className={`bubble ${m.text === null ? 'locked' : ''}`}>
                    {m.text ?? <span className="row"><Lock size={13} /> {m.error ?? 'Cannot decrypt'}</span>}
                    <div className="bubble-meta">
                      {m.ttlSeconds && <><Timer size={11} /> {timerLabel(m.ttlSeconds)}<span className="sep">·</span></>}
                      {formatClock(m.sentAt)}
                    </div>
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {blocked ? (
        <p className="blocked-note">You blocked {peer.username}. Unblock them in Contacts to send messages.</p>
      ) : (
        <div className="composer-wrap">
          <form className="composer" onSubmit={send}>
            <Menu placement="top-start" trigger={({ toggle, open }) => ttl ? (
              <button type="button" className="timer-chip" onClick={toggle} aria-expanded={open} title="Disappearing messages">
                <Timer size={15} /> {timerLabel(ttl)}
              </button>
            ) : (
              <button type="button" className={`icon-btn ${open ? 'active' : ''}`} onClick={toggle} aria-expanded={open} title="Disappearing messages" aria-label="Disappearing messages">
                <Timer size={19} />
              </button>
            )}>
              {(close) => <>
                <div className="menu-label">Disappearing messages</div>
                {TIMERS.map((t) => (
                  <button key={t.label} type="button" className="menu-item" role="menuitemradio" aria-checked={ttl === t.value}
                    onClick={() => { setTtl(t.value); close(); input.current?.focus(); }}>
                    {t.value ? <Timer size={16} /> : <TimerOff size={16} />} {t.label}
                    {ttl === t.value && <Check size={16} className="check" />}
                  </button>
                ))}
              </>}
            </Menu>
            <textarea ref={input} rows={1} maxLength={MAX_MESSAGE_CHARS} placeholder={`Message ${peer.username}`} value={draft}
              aria-label="Message"
              onChange={(e) => { setDraft(e.target.value); autosize(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
            <button className="send-btn" disabled={busy || !draft.trim()} aria-label="Send"><SendHorizontal size={18} /></button>
          </form>
          {error && <div className="composer-note"><Alert kind="error">{error}</Alert></div>}
        </div>
      )}

      {showSafety && (
        <Modal title="Verify safety number" icon={<span className="card-icon"><ShieldCheck size={18} /></span>} onClose={() => setShowSafety(false)}
          footer={<>
            {pin?.verified && <button className="btn btn-ghost" onClick={() => setTrust(false)}>Clear verification</button>}
            <button className="btn" onClick={() => setShowSafety(false)}>Close</button>
            {number && !pin?.verified && (
              <button className="btn btn-primary" onClick={async () => { await setTrust(true); setShowSafety(false); }}>
                <Check size={16} /> They match — mark verified
              </button>
            )}
          </>}>
          <div className="safety-people">
            <Avatar name={vault.me.username} size="sm" /><span className="link" /><Avatar name={peer.username} size="sm" />
          </div>
          <p className="text-2 small">
            Compare these numbers with {peer.username} in person or on a call. If they're identical on both screens,
            nobody is intercepting your conversation.
          </p>
          {number
            ? <div className="safety-grid">{number.split(' ').map((g, i) => <span key={i}>{g}</span>)}</div>
            : <Alert kind="info">{peer.username} hasn't set up encryption yet.</Alert>}
          {pin?.verified && <Alert kind="success">You've verified {peer.username}.</Alert>}
        </Modal>
      )}
    </>
  );
}
