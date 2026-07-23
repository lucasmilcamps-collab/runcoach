import { apiClient } from '@/lib/api/client';

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
};

export function login(email: string, password: string) {
  return apiClient.post<AuthTokens>('/api/v1/auth/login', { email, password }, { auth: false });
}

export function register(email: string, password: string) {
  return apiClient.post<AuthTokens>('/api/v1/auth/register', { email, password }, { auth: false });
}
