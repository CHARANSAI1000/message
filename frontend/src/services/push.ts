/** Browser push notifications (ring and notify while ForYou is closed). */

import { pushApi } from '../api';

export type PushState = 'unsupported' | 'denied' | 'on' | 'off';

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

let registration: Promise<ServiceWorkerRegistration> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration> | null {
  if (!pushSupported()) return null;
  registration ??= navigator.serviceWorker.register('/sw.js');
  return registration;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registerServiceWorker();
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

export async function enablePush(vapidPublicKey: string): Promise<PushState> {
  const reg = await registerServiceWorker();
  if (!reg) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await pushApi.subscribe(json.endpoint, json.keys.p256dh, json.keys.auth);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await pushApi.unsubscribe(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  }
  return 'off';
}

/** Keep the server's copy of this browser's subscription fresh after sign-in. */
export async function refreshPushSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await pushApi.subscribe(json.endpoint, json.keys.p256dh, json.keys.auth).catch(() => undefined);
}
