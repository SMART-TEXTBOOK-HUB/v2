// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDLoEi1hQouFJkpJ-thSbX2v8qeab-tlr4",
    authDomain: "smart-shopping-assistant-65f10.firebaseapp.com",
    projectId: "smart-shopping-assistant-65f10",
    storageBucket: "smart-shopping-assistant-65f10.firebasestorage.app",
    messagingSenderId: "87037518072",
    appId: "1:87037518072:web:213942f29decc033759b0d",
    measurementId: "G-5KHKVHHNR6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, analytics, auth, db };
