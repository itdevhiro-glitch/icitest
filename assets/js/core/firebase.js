export const firebaseConfig = {
  apiKey: "AIzaSyAkV4bmhAyNxuB13Oz1WnvPHtfLjZldGLQ",
  authDomain: "icikiwircommunity-a9900.firebaseapp.com",
  databaseURL: "https://icikiwircommunity-a9900-default-rtdb.firebaseio.com",
  projectId: "icikiwircommunity-a9900",
  storageBucket: "icikiwircommunity-a9900.firebasestorage.app",
  messagingSenderId: "855027081992",
  appId: "1:855027081992:web:b25b700e5e79e021ec82bd",
  measurementId: "G-XH1LBP84QW"
};

export const ADMIN_UID = "KMvEgDWkxfYVGjpNbqHijeHAPTz2";

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const database = firebase.database();
export const serverTimestamp = firebase.database.ServerValue.TIMESTAMP;
