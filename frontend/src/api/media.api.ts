import type { IceServer, Me } from '../types';
import { ApiError, request } from './client';

async function raw(method: string, path: string, body: BodyInit, type: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { method, body, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch', 'Content-Type': type } });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { detail?: string };
    throw new ApiError(res.status, typeof data.detail === 'string' ? data.detail : `Upload failed (${res.status})`);
  }
  return res;
}

export const attachmentsApi = {
  upload: async (ciphertext: Uint8Array<ArrayBuffer>) =>
    (await raw('POST', '/api/v1/attachments', ciphertext, 'application/octet-stream')).json() as Promise<{ id: string; size: number }>,
  download: async (id: string): Promise<ArrayBuffer> => {
    const res = await fetch(`/api/v1/attachments/${id}`, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'This file is no longer available' : 'Download failed');
    return res.arrayBuffer();
  },
};

export const profileApi = {
  rename: (username: string) => request<Me>('PATCH', '/api/v1/me', { username }),
  setAvatar: async (image: Blob) => (await raw('PUT', '/api/v1/me/avatar', image, image.type)).json() as Promise<Me>,
  removeAvatar: () => request<void>('DELETE', '/api/v1/me/avatar'),
  privacy: (patch: { show_presence?: boolean; read_receipts?: boolean; discoverable?: boolean }) =>
    request<Me>('PATCH', '/api/v1/me/privacy', patch),
};

export const callsApi = {
  iceServers: () => request<{ ice_servers: IceServer[] }>('GET', '/api/v1/calls/ice-servers'),
};

export const pushApi = {
  subscribe: (endpoint: string, p256dh: string, auth: string) =>
    request<void>('POST', '/api/v1/push/subscribe', { endpoint, p256dh, auth }),
  unsubscribe: (endpoint: string) => request<void>('POST', '/api/v1/push/unsubscribe', { endpoint }),
  registerDevice: (token: string, platform: 'android' | 'ios') => request<void>('POST', '/api/v1/push/device', { token, platform }),
};
