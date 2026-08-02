/*
 * Mosa service worker — Web Push + offline reads.
 *
 * ── Why there is an offline story at all ──────────────────────────────────
 * The web build IS the product: an installed PWA on iOS. DESIGN.md says this
 * app is read "at 6am before a run", which is precisely when a phone is most
 * likely to be on a dead network. Without a cache that moment is an error
 * screen, and the plan the user is about to run is unreachable.
 *
 * ── Strategies ───────────────────────────────────────────────────────────
 * Static build assets (/_expo/**, /assets/**, icons, fonts)
 *     stale-while-revalidate. Expo's static export fingerprints every JS and
 *     asset filename, so a cached URL is immutable by construction and can be
 *     served instantly; the background refetch only matters for the few
 *     unhashed files.
 *
 * Navigations (the HTML shell)
 *     network-first, falling back to the cached document, then to "/". A stale
 *     document is only dangerous if it points at a bundle we no longer hold —
 *     and the shell cache is versioned as one unit, so a document and the
 *     assets it shipped with are evicted together.
 *
 * Reads that must survive offline (OFFLINE_READS: today's session, the current
 * plan, week progress)
 *     network-first, cache as fallback — never the reverse. A stale session
 *     shown as if it were current is worse than no session at all: the whole
 *     premise of this app is that the plan adapts to what actually happened.
 *     So the network always gets the first word, and anything served off the
 *     shelf is stamped with X-Mosa-Cached-At (when it was stored) so the UI can
 *     say "hors-ligne, données du …" rather than lie by omission.
 *
 * Everything else — every write (validate, skip, link an activity), auth, and
 * every read not listed above
 *     untouched. Requests pass straight through and fail honestly when there is
 *     no network. Queueing writes for later is a real feature with real
 *     conflict semantics; pretending a POST succeeded is not, so this worker
 *     does not go near them.
 *
 * ── Versioning ───────────────────────────────────────────────────────────
 * A mis-versioned service worker serves dead assets forever, and an installed
 * PWA has no visible reload button to break the loop. So: every cache name
 * carries CACHE_VERSION, `activate` deletes every mosa- cache outside the
 * current set, and skipWaiting + clients.claim let a new worker take over on
 * the next load instead of waiting for every tab to close.
 *
 * BUMP CACHE_VERSION whenever the rules below change — adding a route to
 * OFFLINE_READS counts.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `mosa-shell-${CACHE_VERSION}`;
const DATA_CACHE = `mosa-data-${CACHE_VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, DATA_CACHE];

/** Stamped on a response served from the data cache: when it was stored, as an
 * ISO date. Read by lib/api/client.ts, which drives the offline banner. */
const CACHED_AT_HEADER = 'X-Mosa-Cached-At';
/** Written alongside the cached copy so the above can be answered without
 * keeping a second index in sync with the cache. */
const STORED_AT_HEADER = 'X-Mosa-Stored-At';

/**
 * The API reads worth holding for a network-less morning. Deliberately short:
 * the session you are about to run, the plan week it belongs to, and where that
 * week sits — which is exactly what the Séances screen renders.
 */
const OFFLINE_READS = ['/api/v1/plans/today', '/api/v1/plans/current', '/api/v1/plans/progress'];

/** The unhashed files the app cannot boot without. Everything else is
 * fingerprinted and gets cached on first use — listing hashed bundle names here
 * would mean regenerating this file on every build. */
const SHELL_PRECACHE = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // One at a time and tolerant of failure: a single 404 in this list must
      // not abort the install and leave the app with no worker at all.
      .then((cache) =>
        Promise.all(SHELL_PRECACHE.map((url) => cache.add(url).catch(() => undefined))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('mosa-') && !CURRENT_CACHES.includes(name))
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_expo/') ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(js|css|png|jpg|jpeg|svg|webp|woff2?|ttf|otf)$/i.test(url.pathname)
  );
}

function isOfflineRead(url) {
  return OFFLINE_READS.includes(url.pathname);
}

/** Rebuild a response with one extra header. `Response.headers` is immutable
 * once constructed, so there is no lighter way to annotate a cached body. */
async function withHeader(response, name, value) {
  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Serve from cache immediately, refresh in the background. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  // Only awaited when there is nothing cached — otherwise returning early is
  // the entire point.
  return cached ?? (await network) ?? Response.error();
}

/** Network first; the cached document, then the app root, as fallbacks. */
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match('/')) ?? Response.error();
  }
}

/** Network first, cache as the fallback — and never silently. */
async function handleOfflineRead(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const stamped = await withHeader(
        response.clone(),
        STORED_AT_HEADER,
        new Date().toISOString(),
      );
      await cache.put(request, stamped);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    // Nothing cached: let the client see the network failure it would have seen
    // anyway, rather than inventing an error response of our own.
    if (!cached) throw error;
    const storedAt = cached.headers.get(STORED_AT_HEADER) ?? new Date().toISOString();
    return withHeader(cached, CACHED_AT_HEADER, storedAt);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Writes are none of this worker's business.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.origin === self.location.origin && isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // The API may live on another origin (EXPO_PUBLIC_API_URL), so this matches
  // on path alone rather than on same-origin.
  if (isOfflineRead(url)) {
    event.respondWith(handleOfflineRead(request));
  }
});

/* ── Web Push ─────────────────────────────────────────────────────────────
   Receives pushes from the backend (VAPID) and shows the notification; a tap
   focuses the app on the right screen. */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || 'Mosa';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            if ('navigate' in client) client.navigate(target);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
        return undefined;
      })
  );
});
