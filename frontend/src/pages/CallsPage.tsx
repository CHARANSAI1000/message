import { PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Trash2, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { callLog, clearCallLog, type CallLogEntry } from '../services/prefs';
import type { User } from '../types';
import { formatTime } from '../utils/format';

type Props = { userId: string; users: Record<string, User>; onCall: (peerId: string, video: boolean) => void; inCall: boolean };

function describe(e: CallLogEntry) {
  const kind = e.video ? 'Video' : 'Voice';
  if (e.status === 'completed') {
    const m = Math.floor(e.duration / 60), s = e.duration % 60;
    return `${kind} · ${m ? `${m}m ` : ''}${s}s`;
  }
  const text = { missed: 'Missed', declined: 'Declined', 'no-answer': 'No answer', failed: 'Failed', busy: 'Busy' }[e.status];
  return `${kind} · ${text}`;
}

export function CallsPage({ userId, users, onCall, inCall }: Props) {
  const [log, setLog] = useState(() => callLog(userId));
  useEffect(() => {
    const update = () => setLog(callLog(userId));
    window.addEventListener('foryou:calls', update);
    return () => window.removeEventListener('foryou:calls', update);
  }, [userId]);

  return (
    <>
      <header className="pane-header">
        <h1>Calls</h1>
        {log.length > 0 && (
          <button className="icon-btn" onClick={() => clearCallLog(userId)} title="Clear call history" aria-label="Clear call history"><Trash2 size={18} /></button>
        )}
      </header>
      <div className="pane-scroll">
        {log.length === 0 ? (
          <EmptyState icon={<PhoneCall size={26} />} title="No calls yet">
            Start an end-to-end encrypted voice or video call from any chat. Call history stays on this device only.
          </EmptyState>
        ) : (
          <ul className="list">
            {log.map((e) => {
              const peer = users[e.peerId];
              const missed = e.status === 'missed' && e.direction === 'incoming';
              const Icon = missed ? PhoneMissed : e.direction === 'incoming' ? PhoneIncoming : PhoneOutgoing;
              return (
                <li key={e.id} className="list-item hoverable">
                  <Avatar name={e.peerName} userId={peer?.id} version={peer?.avatar_version} />
                  <span className="li-body">
                    <span className={`li-title ${missed ? 'missed' : ''}`}>{peer?.username ?? e.peerName}</span>
                    <span className={`li-sub ${missed ? 'missed' : ''}`}><Icon size={14} /><span>{describe(e)} · {formatTime(e.at)}</span></span>
                  </span>
                  <span className="li-actions">
                    <button className="icon-btn" disabled={inCall} onClick={() => onCall(e.peerId, false)} aria-label={`Voice call ${e.peerName}`}><PhoneCall size={18} /></button>
                    <button className="icon-btn" disabled={inCall} onClick={() => onCall(e.peerId, true)} aria-label={`Video call ${e.peerName}`}><Video size={19} /></button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
