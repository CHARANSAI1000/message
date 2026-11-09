import type { User } from '../types';
import { request } from './client';

export const usersApi = {
  lookup: (username: string) => request<User>('GET', `/api/v1/users/lookup?username=${encodeURIComponent(username)}`),
  get: (id: string) => request<User>('GET', `/api/v1/users/${id}`),
};
