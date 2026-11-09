import type { Envelope, NewEnvelope, SyncPage } from '../types';
import { request } from './client';

export const messagesApi = {
  send: (body: NewEnvelope) => request<Envelope>('POST', '/api/v1/messages', body),
  edit: (id: string, iv: string, ciphertext: string) => request<Envelope>('PUT', `/api/v1/messages/${id}`, { iv, ciphertext }),
  deleteForEveryone: (id: string) => request<Envelope>('DELETE', `/api/v1/messages/${id}`),
  sync: (after: number) => request<SyncPage>('GET', `/api/v1/messages/sync?after=${after}`),
};
