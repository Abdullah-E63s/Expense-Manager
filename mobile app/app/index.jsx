import React, { useRef, useState, useEffect } from 'react';
import { StyleSheet, StatusBar, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

// Required for expo-auth-session to complete OAuth redirect back to app
WebBrowser.maybeCompleteAuthSession();

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://expense-manager-ubm8.vercel.app';

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

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
      .then(async data => {
        if (data.success) {
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Test if session cookie works
          try {
             const profileRes = await fetch('${BASE_URL}/api/auth/account/profile', { credentials: 'include' });
             const profileData = await profileRes.json();
             window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'DEBUG_LOG', msg: 'Profile after auth: ' + JSON.stringify(profileData) }));
          } catch (e) {
             window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'DEBUG_LOG', msg: 'Profile fetch error: ' + e.message }));
          }

          window.location.replace('${BASE_URL}/dashboard');
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

  const redirectUri = AuthSession.makeRedirectUri();
  
  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    responseType: 'id_token',
    redirectUri,
    // Uncomment when you have native OAuth client IDs from Google Cloud Console:
    // androidClientId: 'REPLACE_WITH_ANDROID_CLIENT_ID.apps.googleusercontent.com',
    // iosClientId:     'REPLACE_WITH_IOS_CLIENT_ID.apps.googleusercontent.com',
  });

  // ── Handle OAuth response ─────────────────────────────────────────────────
  useEffect(() => {
    if (!response) return;

    if (response.type === 'success') {
      const idToken = response.params?.id_token || response.authentication?.idToken;
      
      if (idToken) {
        webviewRef.current?.injectJavaScript(buildTokenInjection(idToken));
      } else {
        alert("Google auth succeeded but no id_token was found in response! Response: " + JSON.stringify(response));
      }
    } else {
      if (response.type !== 'dismiss') {
        alert("Google auth failed: " + JSON.stringify(response));
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
      } else if (msg.type === 'DEBUG_LOG') {
        alert(msg.msg);
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
