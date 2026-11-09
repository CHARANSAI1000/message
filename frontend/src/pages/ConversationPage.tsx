import { ArrowLeft, Check, Lock, Phone, ShieldAlert, ShieldCheck, ShieldQuestion, Video } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usersApi } from '../api';
import { Alert } from '../components/Alert';
import { Avatar } from '../components/Avatar';
import { Composer } from '../components/Composer';
import { MessageBubble } from '../components/MessageBubble';
import { Modal } from '../components/Modal';
import { safetyNumber } from '../services/crypto';
import { preparePhoto, uploadEncrypted } from '../services/media';
import { KeyChangedError, type Vault } from '../services/vault';
import type { ChatMessage, Pin, User } from '../types';
import { dayLabel, errorText } from '../utils/format';

const EDIT_WINDOW_MS = 15 * 60 * 1000;

type Props = {
  vault: Vault; peer: User; messages: ChatMessage[]; blocked: boolean;
  onBack: () => void; onSent: (m: ChatMessage) => void; onPeerRefreshed: (u: User) => void;
  onHide: (id: string) => void; onCall: (video: boolean) => void; inCall: boolean;
};

export function ConversationPage({ vault, peer, messages, blocked, onBack, onSent, onPeerRefreshed, onHide, onCall, inCall }: Props) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState('');
  const [pin, setPin] = useState<Pin | undefined>();
  const [showSafety, setShowSafety] = useState(false);
  const [number, setNumber] = useState('');
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChatMessage | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const reloadPin = () => vault.track(peer).then(() => vault.pin(peer.id)).then(setPin).catch((e) => setError(e.message));
  useEffect(() => { void reloadPin(); }, [peer.id, messages.length]);
  useEffect(() => {
    const theirs = pin?.keys[String(pin.currentKeyId)];
    if (theirs && vault.ownSpki) void safetyNumber(vault.ownSpki, theirs).then(setNumber);
  }, [pin, vault]);
  useLayoutEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [messages.length, uploading]);

  /** Shared send path: always encrypt to the contact's latest key. */
  const run = async (fn: (fresh: User) => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      const fresh = await usersApi.get(peer.id);
      onPeerRefreshed(fresh);
      await fn(fresh);
    } catch (err) {
      setError(errorText(err, 'Could not send'));
      if (err instanceof KeyChangedError) setShowSafety(true);
    } finally {
      setBusy(false);
      setUploading('');
      void reloadPin();
    }
  };

  const sendText = (text: string, ttl: number | null) => run(async (fresh) => onSent(await vault.send(fresh, text, ttl)));

  const sendFile = (file: File, kind: 'image' | 'file', caption: string, ttl: number | null) => run(async (fresh) => {
    setUploading(kind === 'image' ? 'Encrypting photo…' : `Encrypting ${file.name}…`);
    if (kind === 'image') {
      const { blob, w, h, thumb } = await preparePhoto(file);
      const att = await uploadEncrypted(blob, { kind: 'image', name: 'photo.jpg', mime: 'image/jpeg', w, h, thumb });
      onSent(await vault.send(fresh, caption, ttl, att));
    } else {
      const att = await uploadEncrypted(file, { kind: 'file', name: file.name.slice(0, 200), mime: file.type || 'application/octet-stream' });
      onSent(await vault.send(fresh, caption, ttl, att));
    }
  });

  const sendVoice = (blob: Blob, seconds: number, ttl: number | null) => run(async (fresh) => {
    setUploading('Sending voice message…');
    const att = await uploadEncrypted(blob, { kind: 'audio', name: 'voice-message', mime: blob.type || 'audio/webm', dur: seconds });
    onSent(await vault.send(fresh, '', ttl, att));
  });

  const saveEdit = async (text: string) => {
    const target = editing;
    if (!target) return;
    setBusy(true);
    try {
      onSent(await vault.edit(target, text));
      setEditing(null);
    } catch (e) { setError(errorText(e, 'Could not edit')); }
    setBusy(false);
  };

  const deleteEveryone = async (m: ChatMessage) => {
    setConfirmDelete(null);
    try { onSent(await vault.deleteForEveryone(m)); } catch (e) { setError(errorText(e, 'Could not delete')); }
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
        <Avatar name={peer.username} userId={peer.id} version={peer.avatar_version} />
        <div className="grow">
          <div className="chat-title truncate">{peer.username}</div>
          <div className={`chat-status ${status.cls}`}><status.Icon size={13} /> {status.text}</div>
        </div>
        <button className="icon-btn" onClick={() => onCall(false)} disabled={blocked || inCall || !peer.key} aria-label="Voice call" title="Voice call"><Phone size={19} /></button>
        <button className="icon-btn" onClick={() => onCall(true)} disabled={blocked || inCall || !peer.key} aria-label="Video call" title="Video call"><Video size={20} /></button>
        <button className={`icon-btn ${pin?.verified ? 'verified-btn' : ''}`} onClick={() => setShowSafety(true)} aria-label="Verify safety number" title="Verify safety number">
          {pin?.verified ? <ShieldCheck size={19} /> : <ShieldQuestion size={19} />}
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
          <div className="e2ee-note"><Lock size={15} /> Messages, photos, voice notes and calls are end-to-end encrypted. Only you and {peer.username} can see them — not even the ForYou server.</div>
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.sentAt).toDateString() !== new Date(m.sentAt).toDateString();
            const canEdit = m.outgoing && !m.deleted && m.text !== null && Date.now() - m.sentAt < EDIT_WINDOW_MS && m.attachment?.kind !== 'audio';
            return (
              <Fragment key={m.id}>
                {newDay && <div className="day-sep">{dayLabel(m.sentAt)}</div>}
                <MessageBubble m={m} gap={Boolean(prev && prev.outgoing !== m.outgoing)} canEdit={canEdit}
                  onEdit={() => setEditing(m)} onDeleteForMe={() => onHide(m.id)} onDeleteForEveryone={() => setConfirmDelete(m)}
                  onOpenImage={setLightbox} />
              </Fragment>
            );
          })}
          {uploading && <div className="msg out"><div className="bubble uploading">{uploading}</div></div>}
        </div>
      </div>

      {blocked ? (
        <p className="blocked-note">You blocked {peer.username}. Unblock them in Contacts to send messages.</p>
      ) : (
        <div className="composer-wrap">
          <Composer peerName={peer.username} busy={busy} editingText={editing?.text ?? null} onCancelEdit={() => setEditing(null)}
            onSendText={sendText} onSaveEdit={saveEdit} onSendFile={sendFile} onSendVoice={sendVoice} />
          {error && <div className="composer-note"><Alert kind="error">{error}</Alert></div>}
        </div>
      )}

      {confirmDelete && (
        <Modal title="Delete for everyone?" onClose={() => setConfirmDelete(null)} footer={<>
          <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => deleteEveryone(confirmDelete)}>Delete for everyone</button>
        </>}>
          <p className="small text-2">The message and any photo or file in it will be removed from {peer.username}'s devices and from the server.</p>
        </Modal>
      )}

      {lightbox && (
        <div className="lightbox" role="dialog" aria-label="Photo" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
          <a className="btn btn-sm lightbox-save" href={lightbox} download="photo.jpg" onClick={(e) => e.stopPropagation()}>Save</a>
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
            <Avatar name={vault.me.username} size="sm" userId={vault.me.id} version={vault.me.avatar_version} />
            <span className="link" />
            <Avatar name={peer.username} size="sm" userId={peer.id} version={peer.avatar_version} />
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
