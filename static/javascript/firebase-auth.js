// Firebase Auth Module - Optional Firebase Integration
let firebaseInitialized = false;
let auth = null;
let provider = null;

// Function to initialize Firebase if available
async function initializeFirebase() {
    if (firebaseInitialized) return true;

    try {
        // Dynamic imports to make Firebase optional
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { 
            getAuth, 
            GoogleAuthProvider, 
            setPersistence, 
            browserLocalPersistence 
        } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');

        // Firebase configuration
        const firebaseConfig = {
            apiKey: "AIzaSyAs8Fx1206dodmcRGbCpLgE-P1ybEVn3LY",
            authDomain: "expense-2-63a15.firebaseapp.com",
            projectId: "expense-2-63a15",
            storageBucket: "expense-2-63a15.appspot.com",
            messagingSenderId: "359684919711",
            appId: "1:359684919711:web:8c8e3c3e3e3e3e3e3e3e3e"
        };

        // Get client ID from environment variable or use default
        const clientId = window.ENV?.GOOGLE_CLIENT_ID || 
            "359684919711-q7ehjfbsapj9tenm4h3e4q2f678igong.apps.googleusercontent.com";
        firebaseConfig.clientId = clientId;

        // Initialize Firebase
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        
        // Set persistence
        await setPersistence(auth, browserLocalPersistence);
        
        // Configure Google Auth Provider
        provider = new GoogleAuthProvider();
        provider.addScope('profile');
        provider.addScope('email');
        provider.setCustomParameters({
            'prompt': 'select_account',
            'client_id': clientId
        });

        firebaseInitialized = true;
        console.log('Firebase initialized successfully');
        return true;
    } catch (error) {
        console.warn('Firebase initialization failed, falling back to alternative auth:', error);
        return false;
    }
}

// Global function to get Firebase ID token (if available)
window.getFirebaseIdToken = async () => {
    const isInitialized = await initializeFirebase();
    if (!isInitialized || !auth?.currentUser) {
        throw new Error('No Firebase user is signed in or Firebase is not available');
    }
    return await auth.currentUser.getIdToken();
};

// Handle Google Sign-In
export async function handleGoogleSignIn() {
    try {
        const isInitialized = await initializeFirebase();
        
        // If Firebase is not available, throw a specific error
        if (!isInitialized || !auth || !provider) {
            throw { 
                code: 'auth/firebase-not-available',
                message: 'Firebase authentication is not available. Using alternative auth method.'
            };
        }

        console.log('Starting Firebase Google Sign-In process...');
        const { signInWithPopup } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        
        const result = await signInWithPopup(auth, provider);
        const idToken = await result.user.getIdToken();
        
        if (!idToken) {
            throw new Error('Failed to get ID token from Google');
        }

        console.log('Successfully obtained Firebase ID token');
        return idToken;

    } catch (error) {
        console.error('Firebase Google Sign-In error:', error);
        
        // If Firebase auth fails, we can still proceed with direct Google Sign-In
        if (error.code === 'auth/firebase-not-available' || 
            error.code === 'auth/operation-not-supported-in-this-environment') {
            console.log('Falling back to direct Google Sign-In');
            throw new Error('FALLBACK_TO_GOOGLE_SIGNIN');
        }

        // Handle specific Firebase auth errors
        let errorMessage = 'Failed to sign in with Google';
        
        if (error.code) {
            switch (error.code) {
                case 'auth/account-exists-with-different-credential':
                    errorMessage = 'An account already exists with the same email but different sign-in credentials.';
                    break;
                case 'auth/popup-closed-by-user':
                    errorMessage = 'Sign in was canceled. Please try again.';
                    break;
                case 'auth/cancelled-popup-request':
                case 'auth/popup-blocked':
                    errorMessage = 'Sign in popup was blocked. Please allow popups and try again.';
                    break;
                case 'auth/network-request-failed':
                    errorMessage = 'Network error. Please check your internet connection and try again.';
                    break;
                default:
                    errorMessage = error.message || errorMessage;
            }
        }

        // Show error to user
        if (typeof window.showError === 'function') {
            window.showError(errorMessage);
        } else {
            console.error(errorMessage);
        }

        throw error;
    }
}

// Initialize Firebase when the module loads (but don't block)
initializeFirebase().catch(console.warn);

// Export the initialization function for manual control if needed
window.initializeFirebaseAuth = initializeFirebase;
