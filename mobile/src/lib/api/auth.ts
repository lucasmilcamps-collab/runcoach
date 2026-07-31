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

/**
 * A first name from an email local-part ("lucas.milcamps" → "Lucas"), or null
 * when the local-part plainly isn't one ("lm2024", "contact42").
 *
 * There is no name field on the account — only an email. Guessing reads well
 * when it works and badly when it doesn't, so it only fires on a leading token
 * that is purely alphabetic: anything else falls back to the app's own name
 * rather than greeting someone as "Lm2024".
 */
export function displayNameFromEmail(email: string | undefined): string | null {
  if (!email) return null;
  const local = email.split('@')[0] ?? '';
  const first = local.split(/[.\-_+\d]/).filter(Boolean)[0];
  if (!first || first.length < 2 || !/^[a-zà-öø-ÿ]+$/i.test(first)) return null;
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
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
