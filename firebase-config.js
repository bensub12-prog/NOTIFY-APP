// Firebase initialization
// Uses the Firebase Web SDK loaded straight from Google's CDN as ES modules,
// so this app needs no build step and can be hosted as-is on GitHub Pages.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCKgznBW-8v0NxXpOavcoyMrWL3ipfldhQ",
  authDomain: "notepad-eb5f5.firebaseapp.com",
  projectId: "notepad-eb5f5",
  storageBucket: "notepad-eb5f5.firebasestorage.app",
  messagingSenderId: "23333060543",
  appId: "1:23333060543:web:6b6686e8ee063aefd9ab0a",
  measurementId: "G-2R150FFJRT",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Keep the person signed in between visits (important for an installed PWA).
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Auth persistence could not be set:", err);
});

// Cache notes locally so the app keeps working offline on an iPad,
// and so edits made offline sync automatically once back online.
enableIndexedDbPersistence(db).catch((err) => {
  // Fails if multiple tabs are open at once, or the browser doesn't support it.
  // The app still works, it just won't cache for offline use in that tab.
  console.warn("Offline persistence not enabled:", err.code || err);
});
