import React, { useRef, useState } from 'react';
import { StyleSheet, StatusBar, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';

// Required for expo-auth-session to complete OAuth redirect back to app
WebBrowser.maybeCompleteAuthSession();

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://expense-manager-ubm8.vercel.app';

// Google OAuth is handled by the backend (/api/auth/google/mobile).
// No native client IDs required for the Expo Go flow.

// ── Scripts injected into the WebView on every page load ──────────────────────
const INJECT_ON_LOAD = `
  (function () {
    'use strict';

    // 1. Fix viewport for mobile rendering
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';

    // 2. Intercept the web app's Google button click → tell React Native to
    //    handle it natively (bypasses WebView Google auth restriction).
    // 2. Intercept the web app's Google button click via document delegation
    //    so it works even if the button loads late.
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('#google-login-btn') || e.target.closest('#google-signin-btn');
      if (btn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        
        try {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'GOOGLE_SIGN_IN_CLICKED' }));
          } else {
            alert('Error: window.ReactNativeWebView is not available!');
          }
        } catch(err) {
          alert('PostMessage error: ' + err.message);
        }
      }
    }, true); // Use capture phase to intercept before anything else

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
    (function() {
      const token = '${safe}';
      
      // Preferred: reuse the web app's existing auth handler
      if (typeof window.handleCredentialResponse === 'function') {
        window.handleCredentialResponse({ credential: token });
        return;
      }

      // Fallback: manually POST to the backend
      fetch('${BASE_URL}/api/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ id_token: token })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          // Signal native side to navigate — avoids JS-fetch → JS-navigate cookie
          // timing race.  The native onMessage handler waits 300 ms and then
          // injects window.location.replace, by which point the native cookie
          // store has committed the session Set-Cookie from this fetch response.
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'AUTH_SUCCESS', url: '${BASE_URL}/dashboard' })
          );
        } else {
          alert('Backend Google Auth failed: ' + JSON.stringify(data));
        }
      })
      .catch(err => {
          alert('Network error during Google Auth fallback: ' + err.message);
          console.error(err);
      });
    })();
    true;
  `;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function App() {
  const webviewRef = useRef(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // ── Google Sign-In via backend OAuth flow (Expo Go compatible) ───────────
  // Opens BASE_URL/api/auth/google/mobile in a Chrome Custom Tab.
  // The backend exchanges the Google auth code for an id_token, then
  // redirects to expensemanager://auth?id_token=... which Chrome Custom Tab
  // hands back to this app (Expo Go registers the expensemanager:// scheme
  // from app.json, so this works on physical devices without a dev build).
  const handleGoogleSignIn = async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);

    try {
      const result = await WebBrowser.openAuthSessionAsync(
        `${BASE_URL}/api/auth/google/mobile`,
        'expensemanager://'  // Intercept this scheme when Chrome Tab redirects back
      );

      if (result.type === 'success' && result.url) {
        // Extract id_token from: expensemanager://auth?id_token=xxx
        const match = result.url.match(/[?&]id_token=([^&]+)/);
        const idToken = match ? decodeURIComponent(match[1]) : null;

        if (idToken) {
          // Hand off to existing injection flow → POST /api/auth/google →
          // sets session cookie → signals AUTH_SUCCESS → navigates to dashboard
          webviewRef.current?.injectJavaScript(buildTokenInjection(idToken));
          return; // Navigation driven by AUTH_SUCCESS in onMessage below
        }

        const errMatch = result.url.match(/[?&]error=([^&]+)/);
        const errMsg = errMatch ? decodeURIComponent(errMatch[1]) : 'unknown_error';
        alert(`Google Sign-In failed: ${errMsg}`);
      }
      // result.type === 'cancel' / 'dismiss' → user closed tab, no alert needed
    } catch (err) {
      alert(`Google Sign-In error: ${err.message}`);
    } finally {
      setIsAuthenticating(false);
    }
  };

  // ── WebView message handler ───────────────────────────────────────────────
  const onMessage = async (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      // Web app's Google button was clicked → open Chrome Custom Tab OAuth flow
      if (msg.type === 'GOOGLE_SIGN_IN_CLICKED') {
        handleGoogleSignIn();

      } else if (msg.type === 'AUTH_SUCCESS') {
        // Auth completed; navigate to dashboard via native-injected JS.
        // Waiting here (after the bridge roundtrip) gives the native cookie store
        // (Android CookieManager / iOS WKHTTPCookieStore) time to commit the
        // session Set-Cookie that was received during the auth fetch, so the
        // subsequent GET /dashboard request arrives with the session cookie.
        const target = msg.url || (BASE_URL + '/dashboard');
        setTimeout(() => {
          webviewRef.current?.injectJavaScript(
            `window.location.replace(${JSON.stringify(target)}); true;`
          );
        }, 300);

      } else if (msg.type === 'DEBUG_LOG') {
        console.log('[WebView]', msg.msg);
      }
    } catch (_) {}
  };

  const onNavigationStateChange = (navState) => {
    // Navigation state monitoring if needed
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
