import React, { useRef, useState, useEffect } from 'react';
import {
  StyleSheet,
  StatusBar,
  Platform,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

// Required for expo-auth-session to complete OAuth redirect back to app
WebBrowser.maybeCompleteAuthSession();

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://ghost993-expensemanager.hf.space';

// Web OAuth Client ID (from Google Cloud Console → "Web application" type)
// This is used for Expo Go development. For production APK/IPA, also add:
//   androidClientId: 'YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com'
//   iosClientId:     'YOUR_IOS_CLIENT_ID.apps.googleusercontent.com'
// Both Android and iOS client IDs must be created in Google Cloud Console.
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

    // 2. Hide the web app's own Google button — we handle Google Sign-In natively.
    //    Run immediately and again on load to catch dynamically rendered buttons.
    function hideWebGoogleButton() {
      var btn = document.getElementById('google-login-btn');
      if (btn) {
        btn.style.display = 'none';
        // Also hide the <div class="divider"> that sits directly before it
        var prev = btn.previousElementSibling;
        if (prev && prev.classList && prev.classList.contains('divider')) {
          prev.style.display = 'none';
        }
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hideWebGoogleButton);
    } else {
      hideWebGoogleButton();
    }
    window.addEventListener('load', hideWebGoogleButton);

    // 3. Intercept /api/auth/google responses to force redirect → /dashboard.
    //    The backend returns redirect:"/" which shows the login page again.
    //    This fix was in the original app and must be kept.
    var _origFetch = window.fetch;
    window.fetch = function() {
      var args = arguments;
      return _origFetch.apply(this, args).then(function(res) {
        var url = typeof args[0] === 'string' ? args[0] : '';
        if (url.includes('/api/auth/google') && res.ok) {
          var _origJson = res.json.bind(res);
          res.json = function() {
            return _origJson().then(function(data) {
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

    // 4. Tell the native layer what kind of page this is.
    function notifyPageType() {
      var isLogin =
        !!document.getElementById('login-form') ||
        !!document.getElementById('google-login-btn') ||
        !!document.querySelector('.login-container');

      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: 'PAGE_TYPE', isLogin: isLogin, url: window.location.href })
      );
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', notifyPageType);
    } else {
      notifyPageType();
    }
    window.addEventListener('load', notifyPageType);
  })();
  true;
`;

// ── Build a JS snippet to inject the Google id_token into the WebView ─────────
// The web app's google-auth.js exposes handleCredentialResponse() globally.
// We call it with the token obtained from native OAuth – the WebView then POSTs
// to /api/auth/google itself, receives the session cookie, and redirects.
function buildTokenInjection(idToken) {
  // Safely escape backslashes and single-quotes in the JWT
  const safe = idToken.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `
    (function () {
      var token = '${safe}';

      // Preferred path: reuse the web app's existing auth handler
      if (typeof handleCredentialResponse === 'function') {
        console.log('[Mobile] Calling handleCredentialResponse with native token');
        handleCredentialResponse({ credential: token });
        return;
      }

      // Fallback: direct fetch from inside the WebView (gets the session cookie)
      console.log('[Mobile] Fallback: direct POST to /api/auth/google');
      var csrfMeta = document.querySelector('meta[name="csrf-token"]');
      var csrf = csrfMeta ? csrfMeta.getAttribute('content') : '';

      fetch('/api/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrf,
        },
        credentials: 'include',
        body: JSON.stringify({ id_token: token, _csrf: csrf }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && data.success) {
            window.location.href = data.redirect || '/';
          } else {
            window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: 'AUTH_ERROR', message: data.message || 'Auth failed' })
            );
          }
        })
        .catch(function (err) {
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'AUTH_ERROR', message: err.toString() })
          );
        });
    })();
    true;
  `;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function App() {
  const webviewRef = useRef(null);

  // Whether the WebView is currently showing the login page
  const [isLoginPage, setIsLoginPage] = useState(false);
  // Whether we're mid-auth flow (button spinner / disabled)
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  // Whether the WebView has finished its first load
  const [webviewReady, setWebviewReady] = useState(false);

  // ── expo-auth-session Google hook ─────────────────────────────────────────
  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    responseType: 'id_token',
    // ⬇️ Uncomment + fill in once you create native OAuth clients in Google Console:
    // androidClientId: 'REPLACE_WITH_ANDROID_CLIENT_ID.apps.googleusercontent.com',
    // iosClientId:     'REPLACE_WITH_IOS_CLIENT_ID.apps.googleusercontent.com',
  });

  // ── Handle OAuth response ─────────────────────────────────────────────────
  useEffect(() => {
    if (!response) return;

    if (response.type === 'success') {
      const idToken = response.params?.id_token;
      if (idToken) {
        console.log('[Mobile] Got id_token from Google OAuth, injecting into WebView...');
        // Inject the token into the WebView so the web app can complete the login
        webviewRef.current?.injectJavaScript(buildTokenInjection(idToken));
        // Keep spinner until WebView confirms auth or navigation changes
      } else {
        console.warn('[Mobile] OAuth success but no id_token in params:', response.params);
        setIsAuthenticating(false);
      }
    } else if (response.type === 'error') {
      console.error('[Mobile] Google OAuth error:', response.error);
      setIsAuthenticating(false);
    } else {
      // dismissed / cancel
      setIsAuthenticating(false);
    }
  }, [response]);

  // ── WebView message handler ───────────────────────────────────────────────
  const onMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      if (msg.type === 'PAGE_TYPE') {
        setIsLoginPage(msg.isLogin);
        // If we navigated away from login page, auth is done
        if (!msg.isLogin) setIsAuthenticating(false);
      }

      if (msg.type === 'AUTH_ERROR') {
        console.error('[Mobile] WebView auth error:', msg.message);
        setIsAuthenticating(false);
      }
    } catch (_) {
      // Non-JSON message from WebView — ignore
    }
  };

  // ── Navigation state handler ──────────────────────────────────────────────
  const onNavigationStateChange = (navState) => {
    const url = navState.url || '';

    // Any page that is NOT the login page means auth succeeded — clear states
    const isDashboard =
      url.includes('/dashboard') ||
      url.includes('/home') ||
      url.includes('/account') ||
      url.includes('/expenses');

    if (isDashboard) {
      setIsLoginPage(false);
      setIsAuthenticating(false);
    }

    // The Flask app may redirect to /login which can 404 in HF Spaces.
    // Force it back to the root URL instead.
    if (url.endsWith('/login') && url.includes('hf.space')) {
      webviewRef.current?.stopLoading();
      webviewRef.current?.injectJavaScript(
        `window.location.href = '${BASE_URL}'; true;`
      );
    }
  };

  // ── Trigger native Google Sign-In ─────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    if (!request || isAuthenticating) return;
    try {
      setIsAuthenticating(true);
      await promptAsync();
    } catch (err) {
      console.error('[Mobile] promptAsync error:', err);
      setIsAuthenticating(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0f" />

      {/* ── Main WebView ── */}
      <WebView
        ref={webviewRef}
        source={{ uri: BASE_URL, headers: { 'X-Requested-With': '' } }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        originWhitelist={['*']}
        // Spoof a standard Chrome mobile UA so the web app renders correctly
        userAgent="Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        thirdPartyCookiesEnabled={true}
        sharedCookiesEnabled={true}
        // Keep false so Google popup doesn't open a new window (we handle it natively)
        setSupportMultipleWindows={false}
        onNavigationStateChange={onNavigationStateChange}
        injectedJavaScript={INJECT_ON_LOAD}
        onMessage={onMessage}
        onLoad={() => setWebviewReady(true)}
      />

      {/* ── Native Google Sign-In button (floats above WebView on login page) ── */}
      {isLoginPage && webviewReady && (
        <View style={styles.nativeAuthOverlay}>
          <TouchableOpacity
            id="native-google-signin-btn"
            style={[
              styles.googleBtn,
              (isAuthenticating || !request) && styles.googleBtnDisabled,
            ]}
            onPress={handleGoogleSignIn}
            disabled={isAuthenticating || !request}
            activeOpacity={0.82}
          >
            {isAuthenticating ? (
              <ActivityIndicator
                color="#4285F4"
                size="small"
                style={{ marginRight: 10 }}
              />
            ) : (
              <Text style={styles.googleIcon}>G</Text>
            )}
            <Text style={styles.googleBtnLabel}>
              {isAuthenticating ? 'Signing in…' : 'Sign in with Google'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },

  // Floating overlay at the bottom of the screen (above the WebView)
  nativeAuthOverlay: {
    position: 'absolute',
    bottom: 28,
    left: 20,
    right: 20,
    alignItems: 'center',
  },

  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 22,
    width: '100%',
    // Shadow (iOS)
    shadowColor: '#4285F4',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    // Shadow (Android)
    elevation: 8,
  },
  googleBtnDisabled: {
    opacity: 0.65,
  },
  googleIcon: {
    fontSize: 19,
    fontWeight: '800',
    color: '#4285F4',
    marginRight: 10,
    letterSpacing: -0.5,
  },
  googleBtnLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a2e',
    letterSpacing: 0.2,
  },
});
