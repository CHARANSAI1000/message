/** Client-side, decrypted view of a message. Lives only in memory. */
import type { AttachmentMeta, EnvelopeMeta } from './crypto';

export type ChatMessage = {
  id: string;
  seq: number;
  rev: number;
  meta: EnvelopeMeta;           // needed to re-encrypt on edit
  attachment?: AttachmentMeta;
  edited: boolean;
  deleted: boolean;
  status: 'sent' | 'delivered' | 'read';  // for your own messages: ✓ / ✓✓ / blue ✓✓
  peerId: string;
  outgoing: boolean;
  text: string | null; // null = cannot be decrypted on this browser
  error?: string;
  sentAt: number;
  expiresAt: number;
  ttlSeconds: number | null;
};

export type Tab = 'chats' | 'calls' | 'contacts' | 'settings';
