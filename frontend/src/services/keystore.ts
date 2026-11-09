/**
 * IndexedDB storage for this browser's private keys (stored as non-extractable CryptoKey
 * objects) and for pinned contact keys (trust-on-first-use + manual verification).
 * Message plaintext is never written to disk.
 */

import type { Pin, StoredKey } from '../types';

const DB = 'secure-messenger';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('keys');
      req.result.createObjectStore('pins');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(store: 'keys' | 'pins', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const keystore = {
  getKey: (userId: string, keyId: number) =>
    tx<StoredKey | undefined>('keys', 'readonly', (s) => s.get(`${userId}:${keyId}`)),
  putKey: (userId: string, keyId: number, value: StoredKey) =>
    tx('keys', 'readwrite', (s) => s.put(value, `${userId}:${keyId}`)),
  getPin: (ownerId: string, contactId: string) =>
    tx<Pin | undefined>('pins', 'readonly', (s) => s.get(`${ownerId}:${contactId}`)),
  putPin: (ownerId: string, contactId: string, pin: Pin) =>
    tx('pins', 'readwrite', (s) => s.put(pin, `${ownerId}:${contactId}`)),
};
