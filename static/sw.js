/**
 * Service Worker: Expense Manager
 * Provides offline caching, network-first fallbacks, and offline app shell loading.
 */

const CACHE_NAME = 'expense-manager-cache-v1';
const OFFLINE_URL = '/static/offline.html';

// Core assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/dashboard',
  '/account',
  '/static/css/style.css',
  '/static/css/account.css',
  '/static/javascript/common.js',
  '/static/javascript/dashboard.js',
  '/static/javascript/account.js',
  '/static/javascript/offline-manager.js',
  '/static/javascript/yolo-handler.js',
  '/static/javascript/jquerry.js',
  '/static/javascript/utils.js',
  '/static/images/logo.png',
  '/static/images/pfp.jpg',
  '/static/offline.html',
  '/manifest.json'
];

// Install: Pre-cache core app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching offline app shell');
      return cache.addAll(PRECACHE_ASSETS.map(url => new Request(url, { cache: 'reload' }))).catch(err => {
        console.warn('[SW] Some assets failed to precache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Removing old cache version:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strategy based on request type
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests and external third-party requests (e.g. Google Analytics / reCAPTCHA)
  if (request.method !== 'GET' || !url.origin.includes(self.location.origin)) {
    return;
  }

  // 1. Navigation (HTML pages): Network-First, fallback to cached page or offline.html
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(async () => {
          console.log('[SW] Serving cached page for navigation:', request.url);
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;
          
          // If navigating to dashboard or account without cache, return cached dashboard or offline fallback
          const dashboardCache = await caches.match('/dashboard');
          if (dashboardCache) return dashboardCache;

          return caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  // 2. Read-only API Endpoints (/api/expenses, /api/expenses/summary, /api/expenses/charts, /api/expenses/budget, /api/account/preferences, /api/auth/account/profile)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(async () => {
          console.log('[SW] Serving cached API response for:', url.pathname);
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // 3. Static Assets (CSS, JS, Images, Fonts): Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
