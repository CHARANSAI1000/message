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

export type Plaintext = { text: string; sentAt: number };
