import React, { useRef, useState, useEffect } from 'react';
import { StyleSheet, StatusBar, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

// Required for expo-auth-session to complete OAuth redirect back to app
WebBrowser.maybeCompleteAuthSession();

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://ghost993-expensemanager.hf.space';

const GOOGLE_WEB_CLIENT_ID =
  '359684919711-q7ehjfbsapj9tenm4h3e4q2f678igong.apps.googleusercontent.com';

// ── Scripts injected into the WebView on every page load ──────────────────────
const INJECT_ON_LOAD = `
  (function () {
    'use strict';

    // 1. Fix viewport for mobile rendering
    var existing = document.querySelector('meta[name="viewport"]');
    if (!existing) {
      var meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
      document.head.appendChild(meta);
    }

    // 2. Intercept the web app's Google button click → tell React Native to
    //    handle it natively (bypasses WebView Google auth restriction).
    function hijackGoogleButton() {
      var btn = document.getElementById('google-login-btn');
      if (!btn || btn.__nativeHijacked) return;
      btn.__nativeHijacked = true;

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: 'GOOGLE_SIGN_IN_CLICKED' })
        );
      }, true);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hijackGoogleButton);
    } else {
      hijackGoogleButton();
    }
    window.addEventListener('load', hijackGoogleButton);

    // 3. Intercept /api/auth/google fetch response to force redirect → /dashboard.
    //    Backend returns redirect:"/" which shows login page again — override it.
    var _origFetch = window.fetch;
    window.fetch = function () {
      var args = arguments;
      return _origFetch.apply(this, args).then(function (res) {
        var url = typeof args[0] === 'string' ? args[0] : '';
        if (url.includes('/api/auth/google') && res.ok) {
          var _origJson = res.json.bind(res);
          res.json = function () {
            return _origJson().then(function (data) {
              if (data && data.success) {
                data.redirect = '/dashboard';
              }
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

// ── Build JS to inject the Google id_token back into the WebView ──────────────
function buildTokenInjection(idToken) {
  const safe = idToken.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `
    (function () {
      var token = '${safe}';

      // Preferred: reuse the web app's existing auth handler
      if (typeof handleCredentialResponse === 'function') {
        handleCredentialResponse({ credential: token });
        return;
      }

      // Fallback: direct fetch (WebView has session cookie jar)
      var csrfMeta = document.querySelector('meta[name="csrf-token"]');
      var csrf = csrfMeta ? csrfMeta.getAttribute('content') : '';

      fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        credentials: 'include',
        body: JSON.stringify({ id_token: token, _csrf: csrf }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          window.location.href = (data && data.redirect) ? data.redirect : '/dashboard';
        })
        .catch(function () {
          window.location.href = '/dashboard';
        });
    })();
    true;
  `;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function App() {
  const webviewRef = useRef(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    responseType: 'id_token',
    // Uncomment when you have native OAuth client IDs from Google Cloud Console:
    // androidClientId: 'REPLACE_WITH_ANDROID_CLIENT_ID.apps.googleusercontent.com',
    // iosClientId:     'REPLACE_WITH_IOS_CLIENT_ID.apps.googleusercontent.com',
  });

  // ── Handle OAuth response ─────────────────────────────────────────────────
  useEffect(() => {
    if (!response) return;

    if (response.type === 'success') {
      const idToken = response.params?.id_token;
      if (idToken) {
        webviewRef.current?.injectJavaScript(buildTokenInjection(idToken));
      }
    }
    setIsAuthenticating(false);
  }, [response]);

  // ── WebView message handler ───────────────────────────────────────────────
  const onMessage = async (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      // Web app's Google button was clicked → trigger native OAuth
      if (msg.type === 'GOOGLE_SIGN_IN_CLICKED') {
        if (!request || isAuthenticating) return;
        setIsAuthenticating(true);
        await promptAsync();
      }
    } catch (_) {}
  };

  // ── Navigation state handler ──────────────────────────────────────────────
  const onNavigationStateChange = (navState) => {
    const url = navState.url || '';

    // Force broken /login redirect back to root
    if (url.endsWith('/login') && url.includes('hf.space')) {
      webviewRef.current?.stopLoading();
      webviewRef.current?.injectJavaScript(
        `window.location.href = '${BASE_URL}'; true;`
      );
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0f" />
      <WebView
        ref={webviewRef}
        source={{ uri: BASE_URL, headers: { 'X-Requested-With': '' } }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        originWhitelist={['*']}
        userAgent="Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        thirdPartyCookiesEnabled={true}
        sharedCookiesEnabled={true}
        setSupportMultipleWindows={false}
        onNavigationStateChange={onNavigationStateChange}
        injectedJavaScript={INJECT_ON_LOAD}
        onMessage={onMessage}
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
});
