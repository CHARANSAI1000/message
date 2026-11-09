/** Shapes returned by the FastAPI backend (mirrors backend/app/schemas). */

export type Me = {
  id: string;
  username: string;
  email: string | null;
  email_verified: boolean;
  has_password: boolean;
  google_linked: boolean;
  avatar_version: number | null;
  key_id: number | null;
};
export type AuthConfig = { google: boolean; email_codes: boolean; push_public_key: string | null };
export type PendingVerification = { status: 'verification_required'; email: string };
export type PublicKey = { key_id: number; user_id: string; spki: string };
export type User = { id: string; username: string; key: PublicKey | null; avatar_version?: number | null };
export type SessionInfo = { id: string; user_agent: string; created_at: string; last_seen_at: string; current: boolean };

/** An encrypted message envelope as stored on the server. */
export type Envelope = {
  seq: number; rev: number; id: string; sender_id: string; recipient_id: string;
  sender_key_id: number; recipient_key_id: number; iv: string; ciphertext: string;
  ttl_seconds: number | null; attachment_id: string | null;
  created_at: string; edited_at: string | null; deleted: boolean; expires_at: string;
};

export type NewEnvelope = {
  id: string; recipient_id: string; sender_key_id: number; recipient_key_id: number;
  iv: string; ciphertext: string; ttl_seconds: number | null; attachment_id?: string | null;
};
export type IceServer = { urls: string | string[]; username?: string; credential?: string };
export type SyncPage = { messages: Envelope[]; has_more: boolean };
