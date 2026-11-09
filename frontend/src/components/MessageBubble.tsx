import { Ban, Copy, Download, FileText, Lock, MoreVertical, Pencil, Timer, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DISAPPEARING_TIMERS } from '../constants';
import { attachmentUrl, formatBytes } from '../services/media';
import type { AttachmentMeta, ChatMessage } from '../types';
import { formatClock } from '../utils/format';
import { Menu } from './Menu';

const timerLabel = (s: number | null) => DISAPPEARING_TIMERS.find((t) => t.value === s)?.label ?? '';

function useAttachment(att: AttachmentMeta | undefined, auto: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    if (!att) return;
    attachmentUrl(att).then(setUrl).catch((e) => setError(e instanceof Error ? e.message : 'Download failed'));
  };
  useEffect(() => { if (auto) load(); }, [att?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { url, error, load };
}

function ImageAttachment({ att, onOpen }: { att: AttachmentMeta; onOpen: (url: string) => void }) {
  const { url, error } = useAttachment(att, true);
  const ratio = att.w && att.h ? `${att.w} / ${att.h}` : undefined;
  return (
    <button type="button" className="bubble-image" onClick={() => url && onOpen(url)} aria-label="Open photo"
      style={ratio ? { aspectRatio: ratio } : undefined}>
      {url ? <img src={url} alt="Photo" /> : att.thumb ? <img src={att.thumb} alt="" className="blur" /> : null}
      {error && <span className="bubble-image-error">{error}</span>}
    </button>
  );
}

function AudioAttachment({ att }: { att: AttachmentMeta }) {
  const { url, error } = useAttachment(att, true);
  if (error) return <span className="xs">{error}</span>;
  return url ? <audio className="bubble-audio" controls src={url} preload="metadata" /> : <span className="xs">Loading voice message…</span>;
}

function FileAttachment({ att }: { att: AttachmentMeta }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    setBusy(true);
    try {
      const url = await attachmentUrl(att);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.name || 'file';
      a.click();
    } catch (e) { setError(e instanceof Error ? e.message : 'Download failed'); }
    setBusy(false);
  };
  return (
    <div className="bubble-file">
      <span className="file-icon"><FileText size={20} /></span>
      <span className="grow">
        <span className="file-name truncate">{att.name}</span>
        <span className="file-size">{error || formatBytes(att.size)}</span>
      </span>
      <button type="button" className="icon-btn" onClick={download} disabled={busy} aria-label={`Download ${att.name}`}><Download size={18} /></button>
    </div>
  );
}

type Props = {
  m: ChatMessage;
  gap: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onOpenImage: (url: string) => void;
};

export function MessageBubble({ m, gap, canEdit, onEdit, onDeleteForMe, onDeleteForEveryone, onOpenImage }: Props) {
  const att = m.attachment;
  const locked = m.text === null && !m.deleted;
  return (
    <div className={`msg ${m.outgoing ? 'out' : 'in'} ${gap ? 'gap' : ''}`}>
      <div className={`bubble ${locked ? 'locked' : ''} ${m.deleted ? 'deleted' : ''} ${att?.kind === 'image' ? 'has-image' : ''}`}>
        {m.deleted ? (
          <span className="row"><Ban size={14} /> {m.outgoing ? 'You deleted this message' : 'This message was deleted'}</span>
        ) : locked ? (
          <span className="row"><Lock size={13} /> {m.error ?? 'Cannot decrypt'}</span>
        ) : (
          <>
            {att?.kind === 'image' && <ImageAttachment att={att} onOpen={onOpenImage} />}
            {att?.kind === 'audio' && <AudioAttachment att={att} />}
            {att?.kind === 'file' && <FileAttachment att={att} />}
            {m.text && <div className="bubble-text">{m.text}</div>}
          </>
        )}
        <div className="bubble-meta">
          {m.ttlSeconds && !m.deleted && <><Timer size={11} /> {timerLabel(m.ttlSeconds)}<span className="sep">·</span></>}
          {m.edited && !m.deleted && <><span>edited</span><span className="sep">·</span></>}
          {formatClock(m.sentAt)}
        </div>
      </div>
      <Menu placement={m.outgoing ? 'bottom-end' : 'bottom-start'} trigger={({ toggle, open }) => (
        <button className={`msg-menu icon-btn ${open ? 'active' : ''}`} onClick={toggle} aria-label="Message options" aria-expanded={open}>
          <MoreVertical size={16} />
        </button>
      )}>
        {(close) => <>
          {m.text && !m.deleted && (
            <button className="menu-item" onClick={() => { void navigator.clipboard?.writeText(m.text ?? ''); close(); }}><Copy size={16} /> Copy</button>
          )}
          {canEdit && <button className="menu-item" onClick={() => { close(); onEdit(); }}><Pencil size={16} /> Edit</button>}
          <button className="menu-item" onClick={() => { close(); onDeleteForMe(); }}><Undo2 size={16} /> Delete for me</button>
          {m.outgoing && !m.deleted && (
            <button className="menu-item danger" onClick={() => { close(); onDeleteForEveryone(); }}><Trash2 size={16} /> Delete for everyone</button>
          )}
        </>}
      </Menu>
    </div>
  );
}
