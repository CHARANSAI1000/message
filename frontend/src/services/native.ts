/**
 * Native (Capacitor) integrations. Every function is a no-op in a normal browser.
 * - Firebase push so the installed app rings for calls while closed (custom ringtone channel)
 * - Phone contacts (emails) for "Find friends"
 */

import { Capacitor } from '@capacitor/core';
import { pushApi } from '../api';

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform() as 'android' | 'ios' | 'web';

let pushStarted = false;

export async function registerNativePush(): Promise<void> {
  if (!isNative() || pushStarted) return;
  pushStarted = true;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  if (platform() === 'android') {
    // Android plays the channel's sound/vibration even when the app is closed.
    await PushNotifications.createChannel({
      id: 'calls', name: 'Calls', description: 'Incoming voice and video calls', importance: 5, visibility: 1,
      sound: 'ringtone', vibration: true, lights: true,
    }).catch(() => undefined);
    await PushNotifications.createChannel({
      id: 'messages', name: 'Messages', description: 'New messages', importance: 4, visibility: 0, vibration: true,
    }).catch(() => undefined);
  }
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;
  await PushNotifications.addListener('registration', (t) => {
    void pushApi.registerDevice(t.value, platform() === 'ios' ? 'ios' : 'android').catch(() => undefined);
  });
  await PushNotifications.register();
}

/** Email addresses from the phone's address book (native app) or the browser's contact picker (Android Chrome). */
export async function pickContactEmails(): Promise<string[] | null> {
  if (isNative()) {
    const { Contacts } = await import('@capacitor-community/contacts');
    const perm = await Contacts.requestPermissions();
    if (perm.contacts !== 'granted') return null;
    const { contacts } = await Contacts.getContacts({ projection: { emails: true } });
    return contacts.flatMap((c) => (c.emails ?? []).map((e) => e.address ?? '')).filter(Boolean);
  }
  const picker = (navigator as Navigator & { contacts?: { select: (p: string[], o: { multiple: boolean }) => Promise<{ email?: string[] }[]> } }).contacts;
  if (!picker) return null;
  const chosen = await picker.select(['email'], { multiple: true });
  return chosen.flatMap((c) => c.email ?? []);
}

export const canPickContacts = () => isNative() || 'contacts' in navigator;

/** SHA-256 (hex) of each normalized email — the server matches hashes and never stores them. */
export async function hashEmails(emails: string[]): Promise<string[]> {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))].slice(0, 2000);
  return Promise.all(unique.map(async (e) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(e));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }));
}

/** iPhone Safari (not installed to the Home Screen) can't receive push notifications. */
export function needsIosInstall(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone && !isNative();
}
