/**
 * console-cleaner.js
 * 
 * Suppresses excessive noise from third-party scripts (Firebase, reCAPTCHA)
 * in development. In production, console methods are left unchanged so that
 * server-side log collectors (Sentry, Datadog, etc.) can capture errors.
 * 
 * Also provides a keyboard shortcut (Ctrl+Shift+L) to clear the console.
 */
(function () {
  'use strict';

  // Only apply in development — leave console untouched in production
  var isDev = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );

  if (!isDev) return;

  // Keyboard shortcut: Ctrl+Shift+L to clear console
  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      console.clear();
    }
  });
})();
