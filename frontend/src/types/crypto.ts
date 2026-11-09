export type StoredKey = { privateKey: CryptoKey; spki: string };

/** A contact's pinned keys (trust on first use + manual verification). */
export type Pin = {
  keys: Record<string, string>; // keyId -> spki seen for this contact
  currentKeyId: number;
  verified: boolean;
  changed: boolean; // a new key appeared and the user has not acknowledged it yet
};

export type EnvelopeMeta = {
  id: string;
  senderId: string;
  recipientId: string;
  senderKeyId: number;
  recipientKeyId: number;
  ttlSeconds: number | null;
};

/** Encrypted file reference carried inside a message; `key`/`iv` decrypt the uploaded bytes. */
export type AttachmentMeta = {
  id: string;
  key: string;
  iv: string;
  kind: 'image' | 'audio' | 'file';
  name: string;
  mime: string;
  size: number;
  w?: number;
  h?: number;
  dur?: number;    // seconds, voice notes
  thumb?: string;  // tiny JPEG data: URL preview for images
};

export type Plaintext = { text: string; sentAt: number; att?: AttachmentMeta };
