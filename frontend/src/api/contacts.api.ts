import type { User } from '../types';
import { request } from './client';

export const contactsApi = {
  list: () => request<User[]>('GET', '/api/v1/contacts'),
  add: (username: string) => request<User>('POST', '/api/v1/contacts', { username }),
  remove: (id: string) => request<void>('DELETE', `/api/v1/contacts/${id}`),
  blocked: () => request<string[]>('GET', '/api/v1/blocks'),
  block: (id: string) => request<void>('PUT', `/api/v1/blocks/${id}`),
  discover: (hashes: string[]) => request<User[]>('POST', '/api/v1/contacts/discover', { hashes }),
  unblock: (id: string) => request<void>('DELETE', `/api/v1/blocks/${id}`),
};
