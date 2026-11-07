/**
 * init.js — starts Firebase and re-exports the SDK functions we use
 * ---------------------------------------------------------------------------
 * This is the ONLY file in the project that imports from the Firebase CDN.
 * Everything else imports from here instead. Two reasons:
 *   1. If we upgrade Firebase, we change the version in one place.
 *   2. Every Firebase URL MUST use the same version number (11.0.2 here).
 *      Mixing versions makes the SDK break at runtime in confusing ways.
 *
 * We load Firebase straight from Google's CDN (gstatic.com) as ES modules,
 * so the project needs no npm install and no bundler. The browser downloads
 * these files the first time the page loads.
 *
 * Firebase products used in this project:
 *   - Authentication     → who is the user? (Google sign-in)
 *   - Cloud Firestore    → stores the todos (documents in collections)
 *   - Realtime Database  → live "who's online" presence (a big JSON tree)
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  getDatabase,
  ref,
  onValue,
  push,
  set,
  update,
  remove,
  onDisconnect,
  serverTimestamp as rtdbServerTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";
import { firebaseConfig, hasRealtimeDatabase } from "./config.js";

// initializeApp() connects this web page to your Firebase project.
// We only pass databaseURL when it is filled in. An empty string would make
// the Realtime Database SDK throw an error.
const { databaseURL, ...baseConfig } = firebaseConfig;
const app = initializeApp(
  hasRealtimeDatabase() ? { ...baseConfig, databaseURL } : baseConfig,
);

// Each get*() call returns a "service" object. Most SDK functions take that
// object as their first argument, for example collection(db, 'users').
export const auth = getAuth(app);
export const db = getFirestore(app);

// The Realtime Database is optional. When databaseURL is empty, `rtdb` is null
// and presenceService.js simply turns the feature off.
export const rtdb = hasRealtimeDatabase() ? getDatabase(app) : null;

// Re-export the individual functions so the services can import them from
// one local file: import { addDoc } from '../firebase/init.js'
export {
  // Auth
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  // Firestore
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  serverTimestamp,
  // Realtime Database
  ref,
  onValue,
  push,
  set,
  update,
  remove,
  onDisconnect,
  rtdbServerTimestamp,
};
