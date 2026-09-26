// firebase-app.js — un único punto de inicialización de la app de Firebase.
//
// Tanto auth.js como db.js necesitan una instancia de la app (para pasarla
// a getAuth() y getFirestore() respectivamente). Si cada uno llamara a
// initializeApp() por su cuenta, la segunda llamada lanza:
//   Firebase: Firebase App named '[DEFAULT]' already exists (app/duplicate-app)
// porque initializeApp() no es idempotente. Por eso este archivo existe
// solo para esto: se llama una vez, y todo lo demás importa `app` de acá.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);

export { app };
