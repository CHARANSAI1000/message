/** Client-side, decrypted view of a message. Lives only in memory. */
export type ChatMessage = {
  id: string;
  seq: number;
  peerId: string;
  outgoing: boolean;
  text: string | null; // null = cannot be decrypted on this browser
  error?: string;
  sentAt: number;
  expiresAt: number;
  ttlSeconds: number | null;
};

export type Tab = 'chats' | 'contacts' | 'settings';
