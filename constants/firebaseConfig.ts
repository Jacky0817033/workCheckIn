import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyD9_OK2yvupQ98A3ATSC6oMc6i1mv0hZeQ",
    authDomain: "employeedata-24d1f.firebaseapp.com",
    projectId: "employeedata-24d1f",
    storageBucket: "employeedata-24d1f.firebasestorage.app",
    messagingSenderId: "133016674861",
    appId: "1:133016674861:web:ddc053e3855f0ab5f80ea4",
    measurementId: "G-8148B0TQ9M"
};

const app = initializeApp(firebaseConfig);
// 導出 Firestore 資料庫實例
export const db = getFirestore(app);