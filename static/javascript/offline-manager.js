/**
 * offline-manager.js — Expense Manager Offline Engine & Sync Queue
 * 
 * Provides:
 *  1. Service Worker auto-registration
 *  2. Real-time online/offline network detection
 *  3. LocalStorage persistent caching for instant offline app loading
 *  4. Background Sync Queue for offline mutations (Add/Delete Expense, Budget, Profile, Preferences)
 *  5. User alerts & automatic flushing on reconnection
 */

(function () {
  'use strict';

  const QUEUE_KEY = 'em_offline_action_queue';
  const CACHE_PREFIX = 'em_cache_';

  // ── 1. Register Service Worker ───────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => console.log('[SW] Registered with scope:', reg.scope))
        .catch((err) => console.warn('[SW] Registration failed:', err));
    });
  }

  // ── 2. Offline Banner / Toast UI ─────────────────────────────────────────────
  let offlineBanner = null;

  function createOfflineBanner() {
    if (document.getElementById('offline-sync-banner')) return;
    offlineBanner = document.createElement('div');
    offlineBanner.id = 'offline-sync-banner';
    offlineBanner.className = 'offline-sync-banner';
    offlineBanner.innerHTML = `
      <div class="offline-banner-content">
        <span class="offline-banner-icon">📡</span>
        <span class="offline-banner-text" id="offline-banner-text">You are offline. Changes saved locally.</span>
      </div>
    `;
    document.body.appendChild(offlineBanner);
  }

  function showOfflineNotification(message, isSuccess = false) {
    createOfflineBanner();
    const banner = document.getElementById('offline-sync-banner');
    const text = document.getElementById('offline-banner-text');
    if (!banner || !text) return;

    text.textContent = message;
    banner.classList.remove('banner-success', 'banner-warning');
    banner.classList.add(isSuccess ? 'banner-success' : 'banner-warning');
    banner.classList.add('visible');

    if (isSuccess) {
      setTimeout(() => {
        banner.classList.remove('visible');
      }, 4000);
    }
  }

  function hideOfflineNotification() {
    const banner = document.getElementById('offline-sync-banner');
    if (banner) banner.classList.remove('visible');
  }

  // ── 3. Queue Management for Offline Actions ──────────────────────────────────
  const OfflineQueue = {
    getQueue: function () {
      try {
        const raw = localStorage.getItem(QUEUE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    },

    saveQueue: function (queue) {
      try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      } catch (e) {
        console.error('Failed to save offline queue:', e);
      }
    },

    enqueue: function (action) {
      const queue = this.getQueue();
      action.id = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      action.timestamp = new Date().toISOString();
      queue.push(action);
      this.saveQueue(queue);
      console.log('[OfflineQueue] Action enqueued:', action.type, action);

      // User requested exact message: "Ur changes have been made pls connect to the internet to save them"
      showOfflineNotification('⚠️ Your changes have been made locally. Please connect to the internet to save them.');
      if (typeof window.showMessage === 'function') {
        const msgEl = document.getElementById('account-msg') || document.getElementById('budget-msg');
        if (msgEl) {
          window.showMessage(msgEl, '⚠️ Changes made offline. Reconnect to internet to sync.', 'info');
        }
      }
    },

    clear: function () {
      localStorage.removeItem(QUEUE_KEY);
    },

    // Process all pending actions when connection is restored
    flush: async function () {
      const queue = this.getQueue();
      if (!queue.length) return;

      console.log(`[OfflineQueue] Flushing ${queue.length} pending actions...`);
      showOfflineNotification('🔄 Back online! Syncing your changes with the server...', true);

      const remaining = [];

      for (const action of queue) {
        try {
          let res;
          if (action.type === 'ADD_EXPENSE') {
            res = await fetch('/api/expenses', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': window.getCsrfToken ? window.getCsrfToken() : ''
              },
              body: JSON.stringify(action.payload)
            });
          } else if (action.type === 'DELETE_EXPENSE') {
            res = await fetch(`/api/expenses/${action.payload.id}`, {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': window.getCsrfToken ? window.getCsrfToken() : ''
              }
            });
          } else if (action.type === 'UPDATE_BUDGET') {
            res = await fetch('/api/expenses/budget', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': window.getCsrfToken ? window.getCsrfToken() : ''
              },
              body: JSON.stringify(action.payload)
            });
          } else if (action.type === 'SAVE_PREFERENCES') {
            res = await fetch('/api/account/preferences', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': window.getCsrfToken ? window.getCsrfToken() : ''
              },
              body: JSON.stringify(action.payload)
            });
          } else if (action.type === 'SAVE_PROFILE') {
            res = await fetch('/api/auth/account/profile', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': window.getCsrfToken ? window.getCsrfToken() : ''
              },
              body: JSON.stringify(action.payload)
            });
          }

          if (!res || !res.ok) {
            console.warn(`[OfflineQueue] Action failed to sync: ${action.type}`, action);
            // If server error, keep in queue for next retry
            remaining.push(action);
          }
        } catch (err) {
          console.error(`[OfflineQueue] Network error while flushing: ${action.type}`, err);
          remaining.push(action);
        }
      }

      this.saveQueue(remaining);

      if (remaining.length === 0) {
        showOfflineNotification('✅ All changes have been synchronized successfully!', true);
        // Refresh server data in dashboard or account
        if (typeof window.loadExpenses === 'function') window.loadExpenses();
        if (typeof window.loadBudget === 'function') window.loadBudget();
        if (typeof window.loadProfile === 'function') window.loadProfile();
      }
    }
  };

  // ── 4. Local Data Cache Layer ────────────────────────────────────────────────
  const LocalCache = {
    set: function (key, value) {
      try {
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
      } catch (e) {}
    },
    get: function (key) {
      try {
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }
  };

  // ── 5. Network Status Listeners ──────────────────────────────────────────────
  window.addEventListener('online', () => {
    console.log('[OfflineEngine] Connection restored');
    OfflineQueue.flush();
  });

  window.addEventListener('offline', () => {
    console.log('[OfflineEngine] Device went offline');
    showOfflineNotification('⚠️ You are currently offline. Changes will be saved locally.');
  });

  // Check queue immediately upon script load if online
  if (navigator.onLine) {
    setTimeout(() => OfflineQueue.flush(), 2000);
  }

  // ── 6. Expose Global API ─────────────────────────────────────────────────────
  window.OfflineManager = {
    isOnline: () => navigator.onLine,
    enqueueAction: (type, payload) => OfflineQueue.enqueue({ type, payload }),
    flushQueue: () => OfflineQueue.flush(),
    getQueueCount: () => OfflineQueue.getQueue().length,
    cache: LocalCache,
    notify: showOfflineNotification
  };

})();
