import { describe, expect, it } from 'vitest';
import {
  decryptFile, decryptMessage, deriveConversationKey, encryptFile, encryptMessage, exportPublic, generateIdentity,
  importPublic, keyFingerprint, openJson, safetyNumber, sealJson,
} from './crypto';
import type { EnvelopeMeta } from '../types';

async function party() {
  const pair = await generateIdentity();
  return { pair, spki: await exportPublic(pair.publicKey) };
}

const meta: EnvelopeMeta = {
  id: '6f1c1f5e-8a8e-4f43-9b9c-5f3a1c2d4e5f', senderId: 'alice', recipientId: 'bob',
  senderKeyId: 1, recipientKeyId: 2, ttlSeconds: null,
};

describe('end-to-end crypto', () => {
  it('private keys are not extractable', async () => {
    const { pair } = await party();
    expect(pair.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow();
  });

  it('both sides derive the same key and round-trip a message', async () => {
    const alice = await party();
    const bob = await party();
    const kA = await deriveConversationKey(alice.pair.privateKey, await importPublic(bob.spki), 1, 2);
    const kB = await deriveConversationKey(bob.pair.privateKey, await importPublic(alice.spki), 2, 1);
    const sealed = await encryptMessage(kA, meta, { text: 'hello 👋', sentAt: 1 });
    expect(sealed.ciphertext).not.toContain('hello');
    expect(await decryptMessage(kB, meta, sealed.iv, sealed.ciphertext)).toEqual({ text: 'hello 👋', sentAt: 1 });
    // The sender can read their own sent message too.
    expect((await decryptMessage(kA, meta, sealed.iv, sealed.ciphertext)).text).toBe('hello 👋');
  });

  it('uses a fresh IV per message', async () => {
    const alice = await party();
    const bob = await party();
    const k = await deriveConversationKey(alice.pair.privateKey, await importPublic(bob.spki), 1, 2);
    const a = await encryptMessage(k, meta, { text: 'same', sentAt: 1 });
    const b = await encryptMessage(k, meta, { text: 'same', sentAt: 1 });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects tampered ciphertext, re-routed metadata and a third party', async () => {
    const alice = await party();
    const bob = await party();
    const eve = await party();
    const kA = await deriveConversationKey(alice.pair.privateKey, await importPublic(bob.spki), 1, 2);
    const sealed = await encryptMessage(kA, meta, { text: 'secret', sentAt: 1 });

    const bytes = Uint8Array.from(atob(sealed.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] ^= 1;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decryptMessage(kA, meta, sealed.iv, tampered)).rejects.toThrow();
    await expect(decryptMessage(kA, { ...meta, recipientId: 'carol' }, sealed.iv, sealed.ciphertext)).rejects.toThrow();
    await expect(decryptMessage(kA, { ...meta, ttlSeconds: 300 }, sealed.iv, sealed.ciphertext)).rejects.toThrow();

    const kEve = await deriveConversationKey(eve.pair.privateKey, await importPublic(alice.spki), 3, 1);
    await expect(decryptMessage(kEve, meta, sealed.iv, sealed.ciphertext)).rejects.toThrow();
  });

  it('safety numbers match on both sides and change with keys', async () => {
    const alice = await party();
    const bob = await party();
    const eve = await party();
    const ab = await safetyNumber(alice.spki, bob.spki);
    expect(ab).toBe(await safetyNumber(bob.spki, alice.spki));
    expect(ab).toMatch(/^(\d{5} ){7}\d{5}$/);
    expect(ab).not.toBe(await safetyNumber(alice.spki, eve.spki));
    expect(await keyFingerprint(alice.spki)).not.toBe(await keyFingerprint(bob.spki));
  });
});

describe('attachments and sealed signals', () => {
  it('file round trip, tamper detection, and wrong key', async () => {
    const data = crypto.getRandomValues(new Uint8Array(5000)).buffer;
    const { ciphertext, key, iv } = await encryptFile(data);
    expect(new Uint8Array(await decryptFile(ciphertext.buffer, key, iv))).toEqual(new Uint8Array(data));
    ciphertext[10] ^= 1;
    await expect(decryptFile(ciphertext.buffer, key, iv)).rejects.toThrow();
    const other = await encryptFile(data);
    await expect(decryptFile(other.ciphertext.buffer, key, iv)).rejects.toThrow();
  });

  it('sealed JSON is bound to its additional data', async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    const k = await deriveConversationKey(a.privateKey, await importPublic(await exportPublic(b.publicKey)), 1, 2);
    const sealed = await sealJson(k, ['sig', 'a', 'b'], { kind: 'offer', sdp: 'v=0' });
    expect(await openJson(k, ['sig', 'a', 'b'], sealed.iv, sealed.ct)).toEqual({ kind: 'offer', sdp: 'v=0' });
    await expect(openJson(k, ['sig', 'a', 'c'], sealed.iv, sealed.ct)).rejects.toThrow();
  });

  it('messages may carry attachment metadata', async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    const k = await deriveConversationKey(a.privateKey, await importPublic(await exportPublic(b.publicKey)), 1, 2);
    const att = { id: 'x', key: 'k', iv: 'i', kind: 'image' as const, name: 'p.jpg', mime: 'image/jpeg', size: 10 };
    const sealed = await encryptMessage(k, meta, { text: '', sentAt: 1, att });
    expect((await decryptMessage(k, meta, sealed.iv, sealed.ciphertext)).att).toEqual(att);
  });
});
