import { keysApi, messagesApi } from '../api';
import type { ChatMessage, Envelope, EnvelopeMeta, Me, Pin, StoredKey, User } from '../types';
import {
  decryptMessage, deriveConversationKey, encryptMessage, exportPublic, generateIdentity, importPublic,
} from './crypto';
import { keystore } from './keystore';

export class KeyChangedError extends Error {}

/** Holds this browser's keys for one signed-in user and performs all E2EE operations. */
export class Vault {
  private peerKeys = new Map<number, CryptoKey>();
  private convKeys = new Map<string, CryptoKey>();

  private constructor(public me: Me, private own: StoredKey | undefined) {}

  static async open(me: Me): Promise<Vault> {
    const own = me.key_id === null ? undefined : await keystore.getKey(me.id, me.key_id);
    if (own && me.key_id !== null) {
      // The server must publish exactly the public key this browser holds.
      const published = await keysApi.get(me.key_id);
      if (published.spki !== own.spki || published.user_id !== me.id) {
        throw new Error('The server is publishing a different key for your account. Do not send messages.');
      }
    }
    return new Vault(me, own);
  }

  get hasKey(): boolean {
    return this.own !== undefined;
  }

  get ownSpki(): string | undefined {
    return this.own?.spki;
  }

  /** Create this browser's identity key. Replaces any key held by another browser. */
  async createKey(): Promise<void> {
    const pair = await generateIdentity();
    const spki = await exportPublic(pair.publicKey);
    const uploaded = await keysApi.upload(spki);
    const stored = { privateKey: pair.privateKey, spki };
    await keystore.putKey(this.me.id, uploaded.key_id, stored);
    this.me = { ...this.me, key_id: uploaded.key_id };
    this.own = stored;
  }

  /** Record a contact's key; detect new keys (warn) and substituted keys (hard fail). */
  private async observe(peerId: string, keyId: number, spki: string): Promise<Pin> {
    let pin = await keystore.getPin(this.me.id, peerId);
    const id = String(keyId);
    if (!pin) {
      pin = { keys: { [id]: spki }, currentKeyId: keyId, verified: false, changed: false };
    } else if (pin.keys[id] !== undefined) {
      if (pin.keys[id] !== spki) throw new Error('A contact key was altered. Possible interception; not decrypting.');
      return pin;
    } else {
      pin = {
        keys: { ...pin.keys, [id]: spki },
        currentKeyId: Math.max(pin.currentKeyId, keyId),
        verified: false,
        changed: true,
      };
    }
    await keystore.putPin(this.me.id, peerId, pin);
    return pin;
  }

  /** Pin a contact's current key as soon as their chat opens (trust on first use). */
  async track(peer: User): Promise<void> {
    if (peer.key) await this.observe(peer.id, peer.key.key_id, peer.key.spki);
  }

  pin(peerId: string): Promise<Pin | undefined> {
    return keystore.getPin(this.me.id, peerId);
  }

  async setTrust(peerId: string, verified: boolean): Promise<void> {
    const pin = await keystore.getPin(this.me.id, peerId);
    if (pin) await keystore.putPin(this.me.id, peerId, { ...pin, verified, changed: false });
  }

  private async peerKey(peerId: string, keyId: number, spki?: string): Promise<CryptoKey> {
    const cached = this.peerKeys.get(keyId);
    if (cached) return cached;
    let s = spki;
    if (!s) {
      const k = await keysApi.get(keyId);
      if (k.user_id !== peerId) throw new Error('Key does not belong to this contact');
      s = k.spki;
    }
    await this.observe(peerId, keyId, s);
    const key = await importPublic(s);
    this.peerKeys.set(keyId, key);
    return key;
  }

  private async conversationKey(myKeyId: number, peerId: string, peerKeyId: number, peerSpki?: string) {
    const cacheKey = `${myKeyId}:${peerKeyId}`;
    const cached = this.convKeys.get(cacheKey);
    if (cached) return cached;
    const mine = myKeyId === this.me.key_id ? this.own : await keystore.getKey(this.me.id, myKeyId);
    if (!mine) return null;
    const key = await deriveConversationKey(mine.privateKey, await this.peerKey(peerId, peerKeyId, peerSpki), myKeyId, peerKeyId);
    this.convKeys.set(cacheKey, key);
    return key;
  }

  async decrypt(env: Envelope): Promise<ChatMessage> {
    const outgoing = env.sender_id === this.me.id;
    const peerId = outgoing ? env.recipient_id : env.sender_id;
    const base = {
      id: env.id, seq: env.seq, peerId, outgoing, ttlSeconds: env.ttl_seconds,
      sentAt: Date.parse(env.created_at), expiresAt: Date.parse(env.expires_at),
    };
    const meta: EnvelopeMeta = {
      id: env.id, senderId: env.sender_id, recipientId: env.recipient_id,
      senderKeyId: env.sender_key_id, recipientKeyId: env.recipient_key_id, ttlSeconds: env.ttl_seconds,
    };
    try {
      const [myKeyId, peerKeyId] = outgoing ? [env.sender_key_id, env.recipient_key_id] : [env.recipient_key_id, env.sender_key_id];
      const key = await this.conversationKey(myKeyId, peerId, peerKeyId);
      if (!key) return { ...base, text: null, error: 'Encrypted for a key that is not on this browser' };
      const body = await decryptMessage(key, meta, env.iv, env.ciphertext);
      return { ...base, text: body.text };
    } catch (e) {
      return { ...base, text: null, error: e instanceof Error ? e.message : 'Could not decrypt' };
    }
  }

  async send(peer: User, text: string, ttlSeconds: number | null): Promise<ChatMessage> {
    if (!this.own || this.me.key_id === null) throw new Error('This browser has no encryption key');
    if (!peer.key) throw new Error(`${peer.username} has not set up encryption yet`);
    const pin = await this.observe(peer.id, peer.key.key_id, peer.key.spki);
    if (pin.changed) throw new KeyChangedError(`${peer.username}'s safety number changed. Review it before sending.`);
    const key = await this.conversationKey(this.me.key_id, peer.id, peer.key.key_id, peer.key.spki);
    if (!key) throw new Error('This browser has no encryption key');
    const meta: EnvelopeMeta = {
      id: crypto.randomUUID(), senderId: this.me.id, recipientId: peer.id,
      senderKeyId: this.me.key_id, recipientKeyId: peer.key.key_id, ttlSeconds,
    };
    const sealed = await encryptMessage(key, meta, { text, sentAt: Date.now() });
    const env = await messagesApi.send({
      id: meta.id, recipient_id: peer.id, sender_key_id: meta.senderKeyId, recipient_key_id: meta.recipientKeyId,
      iv: sealed.iv, ciphertext: sealed.ciphertext, ttl_seconds: ttlSeconds,
    });
    return { ...(await this.decrypt(env)), text };
  }
}
