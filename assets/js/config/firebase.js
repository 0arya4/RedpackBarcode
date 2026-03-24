// ============================================================
// Firebase Configuration
// Replace these values with your actual Firebase project config
// Go to: Firebase Console > Project Settings > Your Apps
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDhNsRdNQUy6IOLt3aAu_cqa9xfspQElIk",
  authDomain: "redpackbarcode.firebaseapp.com",
  projectId: "redpackbarcode",
  storageBucket: "redpackbarcode.firebasestorage.app",
  messagingSenderId: "620552788445",
  appId: "1:620552788445:web:f86383a796262d11cd3e34",
  measurementId: "G-906R4KTKH2"
};

// Initialize primary Firebase app
firebase.initializeApp(firebaseConfig);

// Initialize a secondary app (used to create driver accounts without logging out admin)
const secondaryApp = firebase.initializeApp(firebaseConfig, "secondary");

// Firebase services
const auth = firebase.auth();
const db = firebase.firestore();
const secondaryAuth = secondaryApp.auth();

// Enable Firestore offline persistence
db.enablePersistence().catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore persistence failed: multiple tabs open.');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore persistence not supported in this browser.');
  }
});
