// firebase-config.js
//
// Configuración pública del SDK web de Firebase para el proyecto
// "bitacora-aida". Esta apiKey NO es un secreto: identifica el proyecto
// ante Firebase, pero quién puede leer o escribir qué dato lo deciden las
// reglas de seguridad de Firestore (ver firestore.rules), no esta clave.
// Es normal y seguro que quede visible en el código del navegador.
//
// Fuente: Firebase Console → Configuración del proyecto → General → Tus apps.

const firebaseConfig = {
  apiKey: "AIzaSyAKPXAKuou-ZbA0RKbmgmNobmsBF7wWAGA",
  authDomain: "bitacora-aida.firebaseapp.com",
  projectId: "bitacora-aida",
  storageBucket: "bitacora-aida.firebasestorage.app",
  messagingSenderId: "1084955519637",
  appId: "1:1084955519637:web:5b517d8545d347e432c99c",
  measurementId: "G-QSNBPC3R53",
};

export { firebaseConfig };
