import {
  Mic, MicOff, MonitorUp, MonitorX, Phone, PhoneOff, RefreshCw, Video, VideoOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CallEngine, CallView } from '../services/calls';
import { Avatar } from './Avatar';

function MediaVideo({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function useTimer(startedAt: number | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return '';
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function CallOverlay({ call, engine }: { call: CallView; engine: CallEngine }) {
  const timer = useTimer(call.startedAt);
  const kind = call.video ? 'video' : 'voice';

  if (call.status === 'incoming') {
    return (
      <div className="call incoming" role="dialog" aria-label={`Incoming ${kind} call from ${call.peer.username}`}>
        <div className="call-center">
          <div className="ring-pulse"><Avatar name={call.peer.username} userId={call.peer.id} version={call.peer.avatar_version} size="xl" /></div>
          <h2>{call.peer.username}</h2>
          <p className="call-sub">Incoming {kind} call · end-to-end encrypted</p>
        </div>
        <div className="call-actions">
          <div className="call-action">
            <button className="call-btn decline" onClick={() => void engine.decline()} aria-label="Decline"><PhoneOff size={26} /></button>
            <span>Decline</span>
          </div>
          {call.video && (
            <div className="call-action">
              <button className="call-btn neutral" onClick={() => void engine.accept(false)} aria-label="Answer with audio only"><Phone size={24} /></button>
              <span>Voice only</span>
            </div>
          )}
          <div className="call-action">
            <button className="call-btn accept" onClick={() => void engine.accept()} aria-label="Accept">
              {call.video ? <Video size={26} /> : <Phone size={26} />}
            </button>
            <span>Accept</span>
          </div>
        </div>
      </div>
    );
  }

  const status = call.status === 'ended' ? call.endReason
    : call.status === 'outgoing' ? 'Ringing…'
    : call.status === 'connecting' ? 'Connecting…'
    : timer;
  const showRemoteVideo = call.remoteVideo && call.status === 'active';
  const localPreview = call.sharing ? call.screen : call.cameraOn ? call.local : null;

  return (
    <div className={`call ${showRemoteVideo ? 'has-video' : ''}`} role="dialog" aria-label={`Call with ${call.peer.username}`}>
      <RemoteAudio stream={call.remote} />
      {showRemoteVideo && <MediaVideo stream={call.remote} muted className="call-remote" />}
      <div className="call-top">
        <div className="call-name">{call.peer.username}</div>
        <div className="call-sub">{status}{call.sharing && call.status === 'active' ? ' · sharing your screen' : ''}</div>
      </div>
      {!showRemoteVideo && (
        <div className="call-center">
          <div className={call.status === 'outgoing' ? 'ring-pulse' : ''}>
            <Avatar name={call.peer.username} userId={call.peer.id} version={call.peer.avatar_version} size="xl" />
          </div>
          {call.status === 'active' && !call.video && <p className="call-sub">Voice call · end-to-end encrypted</p>}
        </div>
      )}
      {localPreview && call.status !== 'ended' && (
        <MediaVideo stream={localPreview} muted className={`call-local ${call.sharing ? '' : 'mirror'}`} />
      )}
      {call.status !== 'ended' && (
        <div className="call-controls">
          <button className={`call-btn small ${call.muted ? 'on' : ''}`} onClick={() => engine.toggleMute()} aria-pressed={call.muted} aria-label={call.muted ? 'Unmute' : 'Mute'} title={call.muted ? 'Unmute' : 'Mute'}>
            {call.muted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <button className={`call-btn small ${!call.cameraOn ? '' : 'on-soft'}`} onClick={() => void engine.toggleCamera()} aria-label={call.cameraOn ? 'Turn camera off' : 'Turn camera on'} title="Camera">
            {call.cameraOn ? <Video size={22} /> : <VideoOff size={22} />}
          </button>
          {call.canFlip && call.cameraOn && (
            <button className="call-btn small" onClick={() => void engine.switchCamera()} aria-label="Switch camera" title="Switch camera"><RefreshCw size={22} /></button>
          )}
          {call.canShare && call.status === 'active' && (
            <button className={`call-btn small ${call.sharing ? 'on-soft' : ''}`} onClick={() => void engine.toggleScreenShare()} aria-label={call.sharing ? 'Stop sharing' : 'Share screen'} title={call.sharing ? 'Stop sharing' : 'Share screen'}>
              {call.sharing ? <MonitorX size={22} /> : <MonitorUp size={22} />}
            </button>
          )}
          <button className="call-btn decline" onClick={() => void engine.hangup()} aria-label="End call" title="End call"><PhoneOff size={24} /></button>
        </div>
      )}
    </div>
  );
}
