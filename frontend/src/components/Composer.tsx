import { Check, FileUp, Image as ImageIcon, Mic, Paperclip, SendHorizontal, Square, Timer, TimerOff, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DISAPPEARING_TIMERS as TIMERS, MAX_MESSAGE_CHARS } from '../constants';
import { Menu } from './Menu';

type Props = {
  peerName: string;
  busy: boolean;
  editingText: string | null;
  onCancelEdit: () => void;
  onSendText: (text: string, ttl: number | null) => void;
  onSaveEdit: (text: string) => void;
  onSendFile: (file: File, kind: 'image' | 'file', caption: string, ttl: number | null) => void;
  onSendVoice: (blob: Blob, seconds: number, ttl: number | null) => void;
};

const timerLabel = (s: number | null) => TIMERS.find((t) => t.value === s)?.label ?? 'Off';

function pickRecorderType(): string {
  const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  return types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
}

export function Composer({ peerName, busy, editingText, onCancelEdit, onSendText, onSaveEdit, onSendFile, onSendVoice }: Props) {
  const [draft, setDraft] = useState('');
  const [ttl, setTtl] = useState<number | null>(null);
  const [recording, setRecording] = useState<{ start: number; rec: MediaRecorder; stream: MediaStream } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [micError, setMicError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (editingText !== null) { setDraft(editingText); requestAnimationFrame(() => { autosize(); input.current?.focus(); }); }
  }, [editingText]);
  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - recording.start) / 1000)), 250);
    return () => window.clearInterval(t);
  }, [recording]);

  const autosize = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (editingText !== null) onSaveEdit(text); else onSendText(text, ttl);
    setDraft('');
    requestAnimationFrame(autosize);
  };

  const startRecording = async () => {
    setMicError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = pickRecorderType();
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      discard.current = false;
      const start = Date.now();
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const seconds = Math.max(1, Math.round((Date.now() - start) / 1000));
        if (!discard.current && chunks.current.length) onSendVoice(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }), seconds, ttl);
        setRecording(null);
        setElapsed(0);
      };
      rec.start(250);
      setRecording({ start, rec, stream });
    } catch {
      setMicError('Microphone permission is needed for voice messages.');
    }
  };

  const stopRecording = (send: boolean) => {
    if (!recording) return;
    discard.current = !send;
    recording.rec.stop();
  };

  const pick = (kind: 'image' | 'file') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) { onSendFile(f, kind, draft.trim(), ttl); setDraft(''); }
  };

  if (recording) {
    return (
      <div className="composer recording">
        <button type="button" className="icon-btn" onClick={() => stopRecording(false)} aria-label="Discard voice message"><Trash2 size={19} /></button>
        <span className="rec-dot" aria-hidden />
        <span className="grow rec-time">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} · Recording…</span>
        <button type="button" className="send-btn" onClick={() => stopRecording(true)} aria-label="Send voice message"><Square size={14} fill="currentColor" /></button>
      </div>
    );
  }

  const editing = editingText !== null;
  return (
    <>
      {editing && (
        <div className="composer-edit">
          <span className="grow"><strong>Editing message</strong></span>
          <button className="icon-btn" onClick={() => { setDraft(''); onCancelEdit(); }} aria-label="Cancel editing"><X size={16} /></button>
        </div>
      )}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {!editing && (
          <Menu placement="top-start" trigger={({ toggle, open }) => (
            <button type="button" className={`icon-btn ${open ? 'active' : ''}`} onClick={toggle} aria-label="Attach" title="Attach"><Paperclip size={19} /></button>
          )}>
            {(close) => <>
              <button type="button" className="menu-item" onClick={() => { close(); photo.current?.click(); }}><ImageIcon size={16} /> Photo</button>
              <button type="button" className="menu-item" onClick={() => { close(); file.current?.click(); }}><FileUp size={16} /> Document</button>
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
        )}
        {ttl && !editing && <button type="button" className="timer-chip" onClick={() => setTtl(null)} title="Turn off disappearing"><Timer size={14} /> {timerLabel(ttl)}</button>}
        <textarea ref={input} rows={1} maxLength={MAX_MESSAGE_CHARS} placeholder={editing ? 'Edit message' : `Message ${peerName}`} value={draft}
          aria-label="Message"
          onChange={(e) => { setDraft(e.target.value); autosize(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            if (e.key === 'Escape' && editing) { setDraft(''); onCancelEdit(); }
          }} />
        {draft.trim() || editing ? (
          <button className="send-btn" disabled={busy || !draft.trim()} aria-label={editing ? 'Save edit' : 'Send'}>
            {editing ? <Check size={18} /> : <SendHorizontal size={18} />}
          </button>
        ) : (
          <button type="button" className="send-btn mic" onClick={startRecording} disabled={busy} aria-label="Record voice message" title="Voice message"><Mic size={18} /></button>
        )}
        <input ref={photo} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic" hidden onChange={pick('image')} />
        <input ref={file} type="file" hidden onChange={pick('file')} />
      </form>
      {micError && <div className="composer-note"><span className="xs text-3">{micError}</span></div>}
    </>
  );
}
