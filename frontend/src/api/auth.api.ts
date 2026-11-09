import type { AuthConfig, Me, PendingVerification, SessionInfo } from '../types';
import { request } from './client';

type Sent = { status: 'sent' };

export const authApi = {
  config: () => request<AuthConfig>('GET', '/api/v1/auth/config'),
  me: () => request<Me>('GET', '/api/v1/auth/me'),

  // email + password
  register: (email: string, username: string, password: string) =>
    request<PendingVerification>('POST', '/api/v1/auth/register', { email, username, password }),
  verifyEmail: (email: string, code: string) => request<Me>('POST', '/api/v1/auth/verify-email', { email, code }),
  resendVerification: (email: string) => request<Sent>('POST', '/api/v1/auth/resend-verification', { email }),
  login: (identifier: string, password: string) => request<Me>('POST', '/api/v1/auth/login', { identifier, password }),

  // passwordless + recovery
  requestCode: (email: string) => request<Sent>('POST', '/api/v1/auth/code/request', { email }),
  loginWithCode: (email: string, code: string) => request<Me>('POST', '/api/v1/auth/code/verify', { email, code }),
  forgotPassword: (email: string) => request<Sent>('POST', '/api/v1/auth/password/forgot', { email }),
  resetPassword: (email: string, code: string, new_password: string) =>
    request<Me>('POST', '/api/v1/auth/password/reset', { email, code, new_password }),

  // Google
  google: (credential: string, state: string, username?: string) =>
    request<Me>('POST', '/api/v1/auth/google', { credential, state, username }),

  // signed in
  logout: () => request<void>('POST', '/api/v1/auth/logout'),
  sessions: () => request<SessionInfo[]>('GET', '/api/v1/auth/sessions'),
  revokeSession: (id: string) => request<void>('DELETE', `/api/v1/auth/sessions/${id}`),
  changePassword: (current_password: string, new_password: string) =>
    request<void>('POST', '/api/v1/auth/password', { current_password, new_password }),
  requestDeleteCode: () => request<Sent>('POST', '/api/v1/auth/account/delete-code'),
  deleteAccount: (proof: { password?: string; code?: string }) => request<void>('DELETE', '/api/v1/auth/account', proof),
};
