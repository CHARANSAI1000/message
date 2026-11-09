/**
 * End-to-end encryption using only the browser's built-in WebCrypto API.
 *
 * - Each user has an ECDH P-256 key pair generated in the browser. The private key is
 *   created non-extractable, so page scripts can use it but cannot read or export it.
 * - Two users derive the same AES-256-GCM key: HKDF-SHA256(ECDH(myPrivate, theirPublic)).
 * - Every message uses a fresh random 96-bit IV. Envelope metadata (ids, keys, timer) is
 *   bound as AES-GCM additional data, so the server cannot re-route or alter it undetected.
 *
 * Limitation: static keys give no forward secrecy. See docs/security-architecture.md.
 */

import type { EnvelopeMeta, Plaintext } from '../types';

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function generateIdentity(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDH, false, ['deriveBits']) as Promise<CryptoKeyPair>;
}

export async function exportPublic(key: CryptoKey): Promise<string> {
  return toB64(await crypto.subtle.exportKey('spki', key));
}

export function importPublic(spkiB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', fromB64(spkiB64), ECDH, true, []);
}

export async function deriveConversationKey(
  myPrivate: CryptoKey, theirPublic: CryptoKey, keyIdA: number, keyIdB: number,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirPublic }, myPrivate, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const [lo, hi] = keyIdA < keyIdB ? [keyIdA, keyIdB] : [keyIdB, keyIdA];
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(`secure-messenger/v1/${lo}:${hi}`) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}


function aad(m: EnvelopeMeta): Uint8Array<ArrayBuffer> {
  return enc.encode(JSON.stringify([1, m.id, m.senderId, m.recipientId, m.senderKeyId, m.recipientKeyId, m.ttlSeconds]));
}

export async function encryptMessage(key: CryptoKey, meta: EnvelopeMeta, body: Plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(meta) }, key, enc.encode(JSON.stringify(body)),
  );
  return { iv: toB64(iv), ciphertext: toB64(ct) };
}

export async function decryptMessage(key: CryptoKey, meta: EnvelopeMeta, ivB64: string, ctB64: string): Promise<Plaintext> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64), additionalData: aad(meta) }, key, fromB64(ctB64),
  );
  const parsed = JSON.parse(dec.decode(pt)) as Partial<Plaintext>;
  if (typeof parsed.text !== 'string' || typeof parsed.sentAt !== 'number') throw new Error('Malformed message');
  const att = parsed.att;
  if (att !== undefined && !(typeof att === 'object' && typeof att.id === 'string' && typeof att.key === 'string'
    && typeof att.iv === 'string' && ['image', 'audio', 'file'].includes(att.kind))) throw new Error('Malformed attachment');
  return { text: parsed.text, sentAt: parsed.sentAt, ...(att ? { att } : {}) };
}

/* ------------------------------------------------------------------ attachments */

/** Encrypt file bytes with a fresh random AES-256-GCM key. The key travels inside the E2EE message. */
export async function encryptFile(data: ArrayBuffer) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return { ciphertext, key: toB64(await crypto.subtle.exportKey('raw', key)), iv: toB64(iv) };
}

export async function decryptFile(ciphertext: ArrayBuffer, keyB64: string, ivB64: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', fromB64(keyB64), 'AES-GCM', false, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, ciphertext);
}

/* ------------------------------------------------------------------ sealed JSON (call signalling) */

export async function sealJson(key: CryptoKey, aadParts: unknown[], value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(JSON.stringify(aadParts)) }, key, enc.encode(JSON.stringify(value)),
  );
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function openJson<T>(key: CryptoKey, aadParts: unknown[], ivB64: string, ctB64: string): Promise<T> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64), additionalData: enc.encode(JSON.stringify(aadParts)) }, key, fromB64(ctB64),
  );
  return JSON.parse(dec.decode(pt)) as T;
}

async function digestGroups(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const h = new DataView(await crypto.subtle.digest('SHA-256', data));
  const groups: string[] = [];
  for (let i = 0; i < 32; i += 4) groups.push(String(h.getUint32(i) % 100000).padStart(5, '0'));
  return groups.join(' ');
}

/** Same 40-digit number on both devices; compare it in person or over a call to rule out a fake key. */
export function safetyNumber(spkiA: string, spkiB: string): Promise<string> {
  const [a, b] = [fromB64(spkiA), fromB64(spkiB)];
  const [first, second] = toB64(a) < toB64(b) ? [a, b] : [b, a];
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return digestGroups(joined);
}

export function keyFingerprint(spki: string): Promise<string> {
  return digestGroups(fromB64(spki));
}
