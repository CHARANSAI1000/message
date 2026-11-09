import type { Envelope, NewEnvelope, SyncPage } from '../types';
import { request } from './client';

export const messagesApi = {
  send: (body: NewEnvelope) => request<Envelope>('POST', '/api/v1/messages', body),
  sync: (after: number) => request<SyncPage>('GET', `/api/v1/messages/sync?after=${after}`),
};
