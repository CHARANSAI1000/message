import { Lock, MessageCirclePlus, MessagesSquare, Search, SquarePen } from 'lucide-react';
import { useMemo, useState } from 'react';
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
};

export function ChatsPage({ threads, users, activePeer, onOpen, onNewChat }: Props) {
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
                    <Avatar name={u?.username ?? '?'} />
                    <span className="li-body">
                      <span className="li-top">
                        <span className="li-title">{u?.username ?? 'Loading…'}</span>
                        <span className="li-time">{formatTime(m.sentAt)}</span>
                      </span>
                      <span className="li-sub">
                        {m.text === null && <Lock size={13} />}
                        <span>{m.outgoing ? 'You: ' : ''}{m.text ?? 'Encrypted message'}</span>
                      </span>
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
