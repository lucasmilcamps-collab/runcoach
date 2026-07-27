import { apiClient } from '@/lib/api/client';

export type PushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function getVapidPublicKey() {
  return apiClient.get<{ public_key: string | null }>('/api/v1/push/public-key');
}

export function subscribePush(payload: PushSubscriptionPayload) {
  return apiClient.post<void>('/api/v1/push/subscribe', payload);
}

export function unsubscribePush(endpoint: string) {
  return apiClient.post<void>('/api/v1/push/unsubscribe', { endpoint });
}

export function sendTestPush() {
  return apiClient.post<{ sent: number }>('/api/v1/push/test');
}
