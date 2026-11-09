/**
 * One-to-one voice/video calls over WebRTC.
 *
 * Media flows directly between the two devices (or through a TURN relay that only sees encrypted
 * DTLS-SRTP packets). Every signalling message (offer, answer, ICE candidates, hang-up) is sealed with
 * the same end-to-end keys as chat messages before it is relayed, so the server can't read or alter
 * the call setup — which is what would let it insert itself into the media path.
 */

import { callsApi, usersApi } from '../api';
import type { IceServer, User } from '../types';
import { addCallLog, type CallLogEntry } from './prefs';
import type { Realtime } from './realtime';
import { startRingback, startRinging, stopRingback, stopRinging } from './sounds';
import type { SealedSignal, Vault } from './vault';

export type CallStatus = 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

export type CallView = {
  id: string;
  peer: User;
  video: boolean;
  direction: 'outgoing' | 'incoming';
  status: CallStatus;
  startedAt: number | null;
  endReason?: string;
  local: MediaStream | null;
  screen: MediaStream | null;
  remote: MediaStream | null;
  muted: boolean;
  cameraOn: boolean;
  sharing: boolean;
  remoteVideo: boolean;
  canShare: boolean;
  canFlip: boolean;
};

type Signal =
  | { kind: 'offer'; callId: string; ts: number; sdp: string; video: boolean }
  | { kind: 'answer'; callId: string; ts: number; sdp: string }
  | { kind: 'ice'; callId: string; ts: number; candidate: RTCIceCandidateInit }
  | { kind: 'decline' | 'hangup' | 'busy'; callId: string; ts: number };

const RING_MS = 45_000;
const MAX_SIGNAL_AGE_MS = 120_000;
const FALLBACK_ICE: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const isMobile = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

const END_TEXT: Record<CallLogEntry['status'], string> = {
  completed: 'Call ended', missed: 'Missed call', declined: 'Call declined', 'no-answer': 'No answer',
  failed: 'Call failed', busy: 'Busy on another call',
};

export class CallEngine {
  private view: CallView | null = null;
  private pc: RTCPeerConnection | null = null;
  private remoteOffer: string | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private videoSender: RTCRtpSender | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private facing: 'user' | 'environment' = 'user';
  private timer: number | undefined;
  private disconnectTimer: number | undefined;
  private unsubscribe: (() => void)[] = [];

  constructor(private vault: Vault, private rt: Realtime, private onChange: (v: CallView | null) => void) {
    this.unsubscribe.push(
      rt.on('signal', (e) => void this.onSignal(String(e.from), e.payload as SealedSignal)),
      rt.on('signal_failed', (e) => {
        if (this.view?.status === 'outgoing' && String(e.to) === this.view.peer.id) {
          void this.end('failed', e.reason === 'offline' ? `${this.view.peer.username} is offline` : 'Call could not be connected');
        }
      }),
    );
  }

  dispose() {
    this.unsubscribe.forEach((u) => u());
    if (this.view) void this.hangup();
  }

  get current() { return this.view; }

  private emit() {
    this.onChange(this.view ? { ...this.view } : null);
  }

  private patch(p: Partial<CallView>) {
    if (!this.view) return;
    this.view = { ...this.view, ...p };
    this.emit();
  }

  private async send(peer: User, kind: Signal['kind'], data: Record<string, unknown> = {}, hint?: string): Promise<boolean> {
    const callId = this.view?.id ?? String(data.callId);
    const payload = await this.vault.sealSignal(peer, { kind, callId, ts: Date.now(), ...data });
    return this.rt.send({ type: 'signal', to: peer.id, payload, ...(hint ? { hint } : {}), ...(kind === 'offer' ? { video: data.video } : {}) });
  }

  /* -------------------------------------------------------------- outgoing */

  async start(peer: User, video: boolean): Promise<void> {
    if (this.view) throw new Error('You are already in a call');
    if (!this.rt.connected) throw new Error('Not connected — check your internet connection and try again');
    if (!peer.key) throw new Error(`${peer.username} hasn't set up encryption yet`);
    this.view = this.newView(crypto.randomUUID(), peer, video, 'outgoing');
    this.emit();
    try {
      const local = await this.getMedia(video);
      this.patch({ local, cameraOn: video });
      const pc = await this.createPeer();
      local.getAudioTracks().forEach((t) => pc.addTrack(t, local));
      const cam = local.getVideoTracks()[0] ?? null;
      this.cameraTrack = cam;
      // Always negotiate a video channel, so camera/screen share can start later without renegotiation.
      this.videoSender = cam ? pc.addTrack(cam, local) : pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!(await this.send(peer, 'offer', { sdp: offer.sdp, video }, 'offer'))) throw new Error('Not connected');
      startRingback();
      this.timer = window.setTimeout(() => {
        if (this.view?.status === 'outgoing') void this.send(peer, 'hangup', {}, 'end').finally(() => this.end('no-answer'));
      }, RING_MS);
    } catch (e) {
      await this.end('failed', mediaError(e));
      throw e;
    }
  }

  /* -------------------------------------------------------------- incoming */

  async accept(withVideo?: boolean): Promise<void> {
    const view = this.view;
    if (!view || view.status !== 'incoming' || !this.remoteOffer) return;
    stopRinging();
    window.clearTimeout(this.timer);
    const video = withVideo ?? view.video;
    this.patch({ status: 'connecting', video });
    try {
      const local = await this.getMedia(video);
      this.patch({ local, cameraOn: video });
      const pc = await this.createPeer();
      await pc.setRemoteDescription({ type: 'offer', sdp: this.remoteOffer });
      local.getAudioTracks().forEach((t) => pc.addTrack(t, local));
      const transceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === 'video');
      const cam = local.getVideoTracks()[0] ?? null;
      this.cameraTrack = cam;
      if (transceiver) {
        transceiver.direction = 'sendrecv';
        if (cam) await transceiver.sender.replaceTrack(cam);
        this.videoSender = transceiver.sender;
      }
      await this.flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.send(view.peer, 'answer', { sdp: answer.sdp });
    } catch (e) {
      await this.send(view.peer, 'hangup', {}, 'end').catch(() => undefined);
      await this.end('failed', mediaError(e));
    }
  }

  async decline() {
    const view = this.view;
    if (!view || view.status !== 'incoming') return;
    await this.send(view.peer, 'decline', {}, 'end').catch(() => undefined);
    await this.end('declined');
  }

  async hangup() {
    const view = this.view;
    if (!view || view.status === 'ended') return;
    await this.send(view.peer, 'hangup', {}, 'end').catch(() => undefined);
    await this.end(view.status === 'active' ? 'completed' : view.direction === 'outgoing' ? 'no-answer' : 'declined');
  }

  /* -------------------------------------------------------------- in-call controls */

  toggleMute() {
    if (!this.view?.local) return;
    const muted = !this.view.muted;
    this.view.local.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    this.patch({ muted });
  }

  async toggleCamera() {
    if (!this.view) return;
    if (this.cameraTrack) {
      const on = !this.view.cameraOn;
      this.cameraTrack.enabled = on;
      if (!this.view.sharing) await this.videoSender?.replaceTrack(on ? this.cameraTrack : null);
      this.patch({ cameraOn: on });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing } });
      this.cameraTrack = stream.getVideoTracks()[0];
      this.view.local?.addTrack(this.cameraTrack);
      if (!this.view.sharing) await this.videoSender?.replaceTrack(this.cameraTrack);
      this.patch({ cameraOn: true, video: true, local: this.view.local ? new MediaStream(this.view.local.getTracks()) : stream });
    } catch (e) {
      this.patch({ endReason: mediaError(e) });
    }
  }

  async switchCamera() {
    if (!this.view?.local || !this.cameraTrack) return;
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing } });
    const next = stream.getVideoTracks()[0];
    const old = this.cameraTrack;
    this.view.local.removeTrack(old);
    this.view.local.addTrack(next);
    old.stop();
    this.cameraTrack = next;
    if (!this.view.sharing && this.view.cameraOn) await this.videoSender?.replaceTrack(next);
    this.patch({ local: new MediaStream(this.view.local.getTracks()) });
  }

  async toggleScreenShare() {
    if (!this.view || !this.videoSender) return;
    if (this.view.screen) {
      this.view.screen.getTracks().forEach((t) => t.stop());
      await this.videoSender.replaceTrack(this.view.cameraOn ? this.cameraTrack : null);
      this.patch({ screen: null, sharing: false });
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      track.onended = () => { if (this.view?.sharing) void this.toggleScreenShare(); };
      await this.videoSender.replaceTrack(track);
      this.patch({ screen, sharing: true });
    } catch { /* user cancelled the picker */ }
  }

  /* -------------------------------------------------------------- internals */

  private newView(id: string, peer: User, video: boolean, direction: 'outgoing' | 'incoming'): CallView {
    return {
      id, peer, video, direction, status: direction, startedAt: null, local: null, screen: null, remote: null,
      muted: false, cameraOn: video, sharing: false, remoteVideo: false,
      canShare: !isMobile() && typeof navigator.mediaDevices?.getDisplayMedia === 'function',
      canFlip: isMobile(),
    };
  }

  private async getMedia(video: boolean): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode: this.facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  }

  private async createPeer(): Promise<RTCPeerConnection> {
    const iceServers = await callsApi.iceServers().then((r) => r.ice_servers).catch(() => FALLBACK_ICE);
    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
    this.pc = pc;
    const remote = new MediaStream();
    this.patch({ remote });

    pc.onicecandidate = (e) => {
      if (e.candidate && this.view) void this.send(this.view.peer, 'ice', { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      remote.addTrack(e.track);
      if (e.track.kind === 'video') {
        const update = () => this.patch({ remoteVideo: !e.track.muted });
        e.track.onmute = update;
        e.track.onunmute = update;
        update();
      }
      this.patch({ remote: new MediaStream(remote.getTracks()) });
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        window.clearTimeout(this.disconnectTimer);
        stopRingback();
        if (this.view && this.view.status !== 'active') this.patch({ status: 'active', startedAt: Date.now(), endReason: undefined });
      } else if (s === 'failed') {
        void this.end(this.view?.startedAt ? 'completed' : 'failed', 'Connection lost');
      } else if (s === 'disconnected') {
        this.disconnectTimer = window.setTimeout(() => {
          if (pc.connectionState !== 'connected') void this.end(this.view?.startedAt ? 'completed' : 'failed', 'Connection lost');
        }, 10_000);
      }
    };
    return pc;
  }

  private async flushIce() {
    const pc = this.pc;
    if (!pc?.remoteDescription) return;
    for (const c of this.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => undefined);
  }

  private async onSignal(fromId: string, payload: SealedSignal) {
    let msg: Signal;
    try {
      msg = await this.vault.openSignal<Signal>(fromId, payload);
    } catch {
      return; // not for this device's key, or tampered
    }
    if (Math.abs(Date.now() - msg.ts) > MAX_SIGNAL_AGE_MS) return;
    const view = this.view;

    if (msg.kind === 'offer') {
      const peer = await usersApi.get(fromId).catch(() => null);
      if (!peer) return;
      if (view) {
        if (view.id !== msg.callId) await this.send(peer, 'busy', { callId: msg.callId }).catch(() => undefined);
        return;
      }
      this.view = this.newView(msg.callId, peer, msg.video, 'incoming');
      this.remoteOffer = msg.sdp;
      this.pendingIce = [];
      this.emit();
      startRinging();
      this.timer = window.setTimeout(() => { if (this.view?.status === 'incoming') void this.end('missed'); }, RING_MS);
      return;
    }
    if (!view || view.id !== msg.callId || view.peer.id !== fromId) return;

    switch (msg.kind) {
      case 'answer':
        if (view.status !== 'outgoing' || !this.pc) return;
        stopRingback();
        window.clearTimeout(this.timer);
        this.patch({ status: 'connecting' });
        await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        await this.flushIce();
        break;
      case 'ice':
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(msg.candidate).catch(() => undefined);
        else this.pendingIce.push(msg.candidate);
        break;
      case 'decline':
        await this.end('declined');
        break;
      case 'busy':
        await this.end('busy');
        break;
      case 'hangup':
        await this.end(view.status === 'incoming' ? 'missed' : view.status === 'active' ? 'completed' : 'no-answer');
        break;
    }
  }

  private async end(status: CallLogEntry['status'], reason?: string) {
    const view = this.view;
    if (!view || view.status === 'ended') return;
    stopRinging();
    stopRingback();
    window.clearTimeout(this.timer);
    window.clearTimeout(this.disconnectTimer);
    this.pc?.close();
    this.pc = null;
    view.local?.getTracks().forEach((t) => t.stop());
    view.screen?.getTracks().forEach((t) => t.stop());
    this.cameraTrack?.stop();
    this.cameraTrack = null;
    this.videoSender = null;
    this.remoteOffer = null;
    this.pendingIce = [];

    const duration = view.startedAt ? Math.round((Date.now() - view.startedAt) / 1000) : 0;
    addCallLog(this.vault.me.id, {
      id: view.id, peerId: view.peer.id, peerName: view.peer.username, video: view.video,
      direction: view.direction, status, at: Date.now(), duration,
    });
    this.patch({ status: 'ended', endReason: reason ?? END_TEXT[status], local: null, screen: null });
    window.setTimeout(() => {
      if (this.view?.id === view.id) { this.view = null; this.emit(); }
    }, 1800);
  }
}

function mediaError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') return 'Camera or microphone permission was denied';
    if (e.name === 'NotFoundError') return 'No camera or microphone found';
    if (e.name === 'NotReadableError') return 'Camera or microphone is in use by another app';
  }
  return e instanceof Error ? e.message : 'Call failed';
}
