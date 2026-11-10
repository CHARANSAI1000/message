import { Ban, Check, CheckCheck, FileText, Image as ImageIcon, Lock, MessageCirclePlus, MessagesSquare, Mic, Search, Share, SquarePen, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { needsIosInstall } from '../services/native';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import type { ChatMessage, User } from '../types';
import { formatTime } from '../utils/format';

type Props = {
  threads: ChatMessage[];
  users: Record<string, User>;
  activePeer: string | null;
  onOpen: (peerId: string) => void;
  onNewChat: () => void;
  typing?: string[];
};

const IOS_TIP_KEY = 'foryou:ios-tip-dismissed';
const iosTipDismissed = () => { try { return localStorage.getItem(IOS_TIP_KEY) === '1'; } catch { return false; } };

export function ChatsPage({ threads, users, activePeer, onOpen, onNewChat, typing = [] }: Props) {
  const [showIosTip, setShowIosTip] = useState(() => needsIosInstall() && !iosTipDismissed());
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? threads.filter((m) => users[m.peerId]?.username.includes(q)) : threads;
  }, [threads, users, query]);

  return (
    <>
      <header className="pane-header">
        <h1>Chats</h1>
        <button className="icon-btn" onClick={onNewChat} title="New chat" aria-label="New chat"><SquarePen size={19} /></button>
      </header>
      <div className="pane-tools">
        <div className="input-wrap">
          <Search size={16} />
          <input className="input input-filled" type="search" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      {showIosTip && (
        <div className="tip-card">
          <Share size={18} />
          <span className="grow small">To get call and message notifications on iPhone, tap <strong>Share</strong> then <strong>Add to Home Screen</strong>, and open ForYou from there.</span>
          <button className="icon-btn icon-btn-sm" aria-label="Dismiss" onClick={() => { setShowIosTip(false); try { localStorage.setItem(IOS_TIP_KEY, '1'); } catch { /* ignore */ } }}><X size={14} /></button>
        </div>
      )}
      <div className="pane-scroll">
        {threads.length === 0 ? (
          <EmptyState icon={<MessagesSquare size={26} />} title="No conversations yet"
            action={<button className="btn btn-primary btn-sm" onClick={onNewChat}><MessageCirclePlus size={16} /> Start a chat</button>}>
            Add someone by their exact username to start an encrypted conversation.
          </EmptyState>
        ) : shown.length === 0 ? (
          <p className="no-results">No chats match “{query}”.</p>
        ) : (
          <ul className="list">
            {shown.map((m) => {
              const u = users[m.peerId];
              return (
                <li key={m.peerId}>
                  <button className={`list-item ${activePeer === m.peerId ? 'active' : ''}`} onClick={() => onOpen(m.peerId)} disabled={!u}>
                    <Avatar name={u?.username ?? '?'} userId={u?.id} version={u?.avatar_version} />
                    <span className="li-body">
                      <span className="li-top">
                        <span className="li-title">{u?.username ?? 'Loading…'}</span>
                        <span className="li-time">{formatTime(m.sentAt)}</span>
                      </span>
                      <span className="li-sub">{typing.includes(m.peerId) ? <span className="typing-text">typing…</span> : <Preview m={m} />}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function Ticks({ m }: { m: ChatMessage }) {
  if (!m.outgoing || m.deleted) return null;
  return <span className={`ticks ${m.status}`}>{m.status === 'sent' ? <Check size={14} /> : <CheckCheck size={14} />}</span>;
}

function Preview({ m }: { m: ChatMessage }) {
  return <><Ticks m={m} /><PreviewText m={m} /></>;
}

function PreviewText({ m }: { m: ChatMessage }) {
  const you = m.outgoing ? 'You: ' : '';
  if (m.deleted) return <><Ban size={13} /><span>{m.outgoing ? 'You deleted this message' : 'This message was deleted'}</span></>;
  if (m.text === null) return <><Lock size={13} /><span>Encrypted message</span></>;
  const att = m.attachment;
  if (att?.kind === 'image') return <><ImageIcon size={13} /><span>{you}{m.text || 'Photo'}</span></>;
  if (att?.kind === 'audio') return <><Mic size={13} /><span>{you}Voice message</span></>;
  if (att?.kind === 'file') return <><FileText size={13} /><span>{you}{m.text || att.name}</span></>;
  return <span>{you}{m.text}</span>;
}
