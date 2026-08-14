/**
 * index.jsx — Expense Manager Mobile App
 *
 * Google Sign-In strategy (Expo Go compatible, no custom scheme needed):
 *
 *   1. User taps "Sign in with Google" on the login page.
 *   2. INJECT_ON_LOAD intercepts the click and posts GOOGLE_SIGN_IN_CLICKED.
 *   3. Native handler calls handleGoogleSignIn(), which navigates the MAIN
 *      WebView to /api/auth/google/mobile (implicit-flow OAuth, no client_secret).
 *   4. WebView follows Google's redirect: login page → accounts.google.com → callback.
 *   5. The callback page's JS reads the id_token from the URL fragment and
 *      calls window.ReactNativeWebView.postMessage({type:'GOOGLE_TOKEN', ...}).
 *      This works because the callback is loaded INSIDE our WebView.
 *   6. Native receives GOOGLE_TOKEN, injects buildTokenInjection(idToken).
 *   7. The injected script POSTs to /api/auth/google (existing endpoint),
 *      gets a session cookie, then posts AUTH_SUCCESS to native.
 *   8. Native navigates to dashboard via setWebviewSource (avoids black screen).
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  StyleSheet, StatusBar, Platform, Text, TouchableOpacity, View, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

// ── Config ─────────────────────────────────────────────────────────────────────
const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://expense-manager-ubm8.vercel.app';

// URL that kicks off the Google implicit-flow OAuth in the main WebView.
const GOOGLE_MOBILE_AUTH_URL = `${BASE_URL}/api/auth/google/mobile`;

// ── Scripts injected into the WebView on every page load ───────────────────────
const INJECT_ON_LOAD = `
  (function () {
    'use strict';

    // 1. Fix viewport for mobile rendering & prevent all auto-zooming
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

    // Prevent double-tap zoom and gesture zoom
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });

    // 2. Intercept Google Sign-In button click — delegate at document root so it
    //    fires even if google-auth.js renders/replaces the button after load.
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('#google-login-btn') || e.target.closest('#google-signin-btn');
      if (btn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'GOOGLE_SIGN_IN_CLICKED' }));
        }
      }
    }, true); // capture phase — fires before any bubble-phase listener

    // 3. Intercept /api/auth/google fetch response and force redirect → /dashboard.
    var _origFetch = window.fetch;
    window.fetch = function () {
      var args = arguments;
      return _origFetch.apply(this, args).then(function (res) {
        var url = typeof args[0] === 'string' ? args[0] : '';
        if (url.includes('/api/auth/google') && res.ok) {
          var _origJson = res.json.bind(res);
          res.json = function () {
            return _origJson().then(function (data) {
              if (data && data.success) { data.redirect = '/dashboard'; }
              return data;
            });
          };
        }
        return res;
      });
    };
  })();
  true;
`;

// ── Component ──────────────────────────────────────────────────────────────────
export default function App() {
  const webviewRef = useRef(null);

  // ── State-based navigation ─────────────────────────────────────────────────
  // Updating source via state triggers a proper native URL load, avoiding the
  // Android WebView black screen that appears after JS window.location.replace().
  const [webviewSource, setWebviewSource] = useState({
    uri: BASE_URL,
    headers: { 'X-Requested-With': '' },
  });

  const navigateTo = useCallback((url) => {
    setWebviewSource({ uri: url, headers: { 'X-Requested-With': '' } });
  }, []);

  // ── Google Sign-In (WebView-internal flow) ─────────────────────────────────
  // Navigate the main WebView to the backend OAuth endpoint.
  // The backend uses Google's implicit flow (response_type=id_token), which
  // returns the id_token in the URL fragment so no client_secret is needed.
  // After Google auth, the callback page reads the fragment and posts
  // GOOGLE_TOKEN to native via window.ReactNativeWebView.postMessage().
  const handleGoogleSignIn = useCallback(() => {
    navigateTo(GOOGLE_MOBILE_AUTH_URL);
  }, [navigateTo]);

  // ── WebView message handler ────────────────────────────────────────────────
  const onMessage = useCallback((event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      if (msg.type === 'GOOGLE_SIGN_IN_CLICKED') {
        // Google button tapped → start in-WebView OAuth flow
        handleGoogleSignIn();

      } else if (msg.type === 'GOOGLE_AUTH_BLOCKED') {
        // Google blocked the OAuth in WebView (shows policy error page).
        // Show alert and go back.
        Alert.alert(
          'Google Sign-In',
          'Google Sign-In was blocked in this browser view.\n\nPlease try again — on a second attempt Google often allows it.'
        );
        navigateTo(BASE_URL);

      } else if (msg.type === 'DEBUG_LOG') {
        console.log('[WebView]', msg.msg);
      }
    } catch (_) {}
  }, [handleGoogleSignIn, navigateTo]);

  // ── Error handling ─────────────────────────────────────────────────────────
  const [webviewError, setWebviewError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  // Auto-retry up to 3 times if the backend is temporarily down (HF Space cold start)
  const onHttpError = useCallback((synthEvent) => {
    const { nativeEvent } = synthEvent;
    const url = nativeEvent?.url || '';
    const code = nativeEvent?.statusCode;

    // Ignore sub-resources (static files, APIs) — only show overlay for page loads
    if (url.includes('/static/') || url.includes('/api/')) return;

    // Auto-retry the initial load (HF Space cold start can take 20–30 s)
    if ((url === BASE_URL || url === BASE_URL + '/') && retryCount < 4) {
      setRetryCount((c) => c + 1);
      setTimeout(() => navigateTo(BASE_URL), 5000); // retry after 5 s
      return;
    }

    setWebviewError({ url, statusCode: code });
  }, [retryCount, navigateTo]);

  const onError = useCallback((synthEvent) => {
    const { nativeEvent } = synthEvent;
    const desc = nativeEvent?.description || '';
    // ERR_ABORTED happens during redirects — not a real error
    if (desc.includes('net::ERR_ABORTED') || desc.includes('ERR_ABORTED')) return;
    setWebviewError({ url: nativeEvent?.url, description: desc });
  }, []);

  const handleRetry = useCallback(() => {
    setWebviewError(null);
    setRetryCount(0);
    navigateTo(BASE_URL);
  }, [navigateTo]);

  // ── Loading overlay while waiting for HF Space cold start ─────────────────
  const [showColdStartMsg, setShowColdStartMsg] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowColdStartMsg(true), 8000);
    return () => clearTimeout(t);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (webviewError) {
    const isOffline =
      !webviewError.statusCode ||
      (webviewError.description &&
        (webviewError.description.includes('ERR_INTERNET_DISCONNECTED') ||
          webviewError.description.includes('ERR_NAME_NOT_RESOLVED') ||
          webviewError.description.includes('ERR_CONNECTION_TIMED_OUT') ||
          webviewError.description.includes('ERR_ADDRESS_UNREACHABLE')));

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0f" />
        <View style={styles.overlay}>
          <Text style={styles.overlayIcon}>📡</Text>
          <Text style={styles.overlayTitle}>
            {isOffline ? 'You are Offline' : '⚠️ Connection Error'}
          </Text>
          <Text style={styles.overlayDesc}>
            {isOffline
              ? 'Could not connect to Expense Manager. Please check your Wi-Fi or mobile data, then tap Try Again.'
              : webviewError.statusCode
              ? `Server returned HTTP ${webviewError.statusCode}. Please try again shortly.`
              : 'Network request failed. Tap below to retry.'}
          </Text>
          <TouchableOpacity style={styles.btn} onPress={handleRetry} activeOpacity={0.8}>
            <Text style={styles.btnText}>🔄 Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0f" />

      <WebView
        key={`wv-${retryCount}`}     // remount on retry
        ref={webviewRef}
        source={webviewSource}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        originWhitelist={['*']}
        userAgent="Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        thirdPartyCookiesEnabled={true}
        sharedCookiesEnabled={true}
        setSupportMultipleWindows={false}
        cacheEnabled={true}
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        injectedJavaScript={INJECT_ON_LOAD}
        onMessage={onMessage}
        onHttpError={onHttpError}
        onError={onError}
        renderError={() => null}
        bounces={true}
        overScrollMode="always"
        scalesPageToFit={false}
        textZoom={100}
        pullToRefreshEnabled={true}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    // Workaround for Android WebView black screen after returning from background
    opacity: 0.99,
    overflow: 'hidden',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0f',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    zIndex: 10,
  },
  overlayIcon: {
    fontSize: 44,
    marginBottom: 16,
  },
  overlayTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  overlayDesc: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  btn: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
  },
  btnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
