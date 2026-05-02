import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
    apiKey:     window.FIREBASE_API_KEY,
    authDomain: window.FIREBASE_AUTH_DOMAIN,
    projectId:  window.FIREBASE_PROJECT_ID,
};

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();

async function loginWithGoogle() {
    if (window._setLoading) window._setLoading(true);
    try {
        const result  = await signInWithPopup(auth, provider);
        const idToken = await result.user.getIdToken();

        const res = await fetch("/auth/verify", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ token: idToken }),
        });

        if (res.ok) {
            window.location.href = "/dashboard";
        } else {
            if (window._showError) window._showError();
            if (window._setLoading) window._setLoading(false);
        }
    } catch (err) {
        console.error("Login error:", err);
        if (window._showError)  window._showError();
        if (window._setLoading) window._setLoading(false);
    }
}

async function logout() {
    await signOut(auth);
    await fetch("/auth/logout", { method: "POST" });
    window.location.href = "/login";
}

onAuthStateChanged(auth, (user) => {
    if (user && window.location.pathname === "/login") {
        window.location.href = "/dashboard";
    }
});

window.loginWithGoogle = loginWithGoogle;
window.logout          = logout;

export { auth, loginWithGoogle, logout };
