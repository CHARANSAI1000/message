import type { PublicKey } from '../types';
import { request } from './client';

export const keysApi = {
  upload: (spki: string) => request<PublicKey>('POST', '/api/v1/keys', { spki }),
  get: (keyId: number) => request<PublicKey>('GET', `/api/v1/keys/${keyId}`),
};
