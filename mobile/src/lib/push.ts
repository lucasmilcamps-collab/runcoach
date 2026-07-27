/**
 * Web Push glue (browser/PWA only). Everything here is guarded by pushSupported()
 * so it's a no-op on native — the app runs the same codebase on iOS/Android where
 * these Web APIs don't exist. On iPhone, push requires the PWA to be installed
 * to the home screen (iOS 16.4+).
 */
import { Platform } from 'react-native';

import { getVapidPublicKey, subscribePush, unsubscribePush } from '@/lib/api/push';

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied';

export function pushSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission(): PushState {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission as PushState;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js');
}

/** Register the service worker early so a later subscribe is instant. Safe to
 * call on every web load; no-op on native. */
export async function registerServiceWorker(): Promise<void> {
  if (!pushSupported()) return;
  try {
    await ensureRegistration();
  } catch {
    // A failed SW registration must never break app startup.
  }
}

/** Request permission, subscribe, and persist the subscription server-side.
 * Returns the resulting state so the UI can explain what happened. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission as PushState;

  const { public_key: publicKey } = await getVapidPublicKey();
  if (!publicKey) return 'unsupported'; // push not configured on the backend

  const registration = await ensureRegistration();
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  const json = subscription.toJSON();
  if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
    await subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
  }
  return 'granted';
}

/** Unsubscribe locally and server-side. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await unsubscribePush(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  }
}
