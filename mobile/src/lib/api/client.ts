import { useAuthStore } from '@/lib/stores/auth-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

/** Mirrors the backend's `HTTPException(detail={code, message})` shape (api-conventions). */
export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
};

async function parseErrorDetail(response: Response): Promise<{ code: string; message: string }> {
  try {
    const data = await response.json();
    const detail = data?.detail;
    if (detail && typeof detail === 'object') {
      return { code: detail.code ?? 'UNKNOWN', message: detail.message ?? response.statusText };
    }
    return { code: 'UNKNOWN', message: typeof detail === 'string' ? detail : response.statusText };
  } catch {
    return { code: 'UNKNOWN', message: response.statusText };
  }
}

async function request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = useAuthStore.getState().accessToken;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && auth && !isRetry) {
    const refreshed = await tryRefreshToken();
    if (refreshed) return request<T>(path, options, true);
    // Refresh token is dead: the stored session can't recover itself, so
    // stop presenting the user as authenticated.
    await useAuthStore.getState().signOut();
  }

  if (!response.ok) {
    const { code, message } = await parseErrorDetail(response);
    throw new ApiError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    await useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
};
