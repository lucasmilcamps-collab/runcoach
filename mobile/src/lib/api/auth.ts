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

export type Me = { email: string };

export function getMe() {
  return apiClient.get<Me>('/api/v1/auth/me');
}

/** Two-letter initials from an email local-part ("lucas.milcamps" → "LM"). */
export function initialsFromEmail(email: string | undefined): string {
  if (!email) return '';
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[.\-_+]/).filter(Boolean);
  const letters =
    parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase();
}
