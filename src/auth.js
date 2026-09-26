// auth.js — toda la interacción con Firebase Authentication vive aquí.
// Nada fuera de este archivo debe importar cosas de "firebase/auth"
// directamente (spec, sección 7): el resto de la app solo conoce estas
// funciones, no los detalles de Firebase.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const proveedorGoogle = new GoogleAuthProvider();

/**
 * Traduce los códigos de error de Firebase Auth a mensajes en español
 * que tienen sentido para alguien sin formación técnica. Centralizado
 * acá para no repetir este switch en cada pantalla que use auth.js.
 * @param {unknown} error
 */
function mensajeDeError(error) {
  const codigo = error && typeof error === "object" && "code" in error ? error.code : "";
  switch (codigo) {
    case "auth/email-already-in-use":
      return "Ya existe una cuenta con ese correo. Iniciá sesión en vez de registrarte.";
    case "auth/invalid-email":
      return "Ese correo no parece válido.";
    case "auth/weak-password":
      return "La contraseña debe tener al menos 6 caracteres.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Correo o contraseña incorrectos.";
    case "auth/too-many-requests":
      return "Demasiados intentos. Esperá un momento y volvé a intentar.";
    case "auth/popup-closed-by-user":
      return "Se cerró la ventana de Google antes de terminar. Intentá de nuevo.";
    case "auth/network-request-failed":
      return "No hay conexión a internet en este momento.";
    default:
      return "Algo salió mal. Intentá de nuevo en un momento.";
  }
}

/**
 * Registra una cuenta nueva con correo y contraseña, y le pone el
 * nombre de pila como displayName (para saludarla sin una lectura
 * aparte a Firestore).
 * @param {string} nombre
 * @param {string} correo
 * @param {string} contrasena
 */
async function registrarConCorreo(nombre, correo, contrasena) {
  try {
    const credencial = await createUserWithEmailAndPassword(auth, correo, contrasena);
    await updateProfile(credencial.user, { displayName: nombre.trim() });
    return { ok: true, usuario: credencial.user };
  } catch (error) {
    return { ok: false, error: mensajeDeError(error) };
  }
}

/** @param {string} correo @param {string} contrasena */
async function iniciarSesionConCorreo(correo, contrasena) {
  try {
    const credencial = await signInWithEmailAndPassword(auth, correo, contrasena);
    return { ok: true, usuario: credencial.user };
  } catch (error) {
    return { ok: false, error: mensajeDeError(error) };
  }
}

async function iniciarSesionConGoogle() {
  try {
    const credencial = await signInWithPopup(auth, proveedorGoogle);
    return { ok: true, usuario: credencial.user };
  } catch (error) {
    return { ok: false, error: mensajeDeError(error) };
  }
}

/** @param {string} correo */
async function enviarCorreoRecuperacion(correo) {
  try {
    await sendPasswordResetEmail(auth, correo);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mensajeDeError(error) };
  }
}

async function cerrarSesion() {
  await signOut(auth);
}

/**
 * Se suscribe al estado de la sesión. `callback` recibe el objeto
 * `user` de Firebase, o `null` si no hay nadie autenticado. Esta es la
 * única fuente de verdad sobre si mostrar la pantalla de login o la
 * app — nada más debe decidir eso por su cuenta.
 * @param {(usuario: import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js").User | null) => void} callback
 */
function observarSesion(callback) {
  return onAuthStateChanged(auth, callback);
}

export {
  registrarConCorreo,
  iniciarSesionConCorreo,
  iniciarSesionConGoogle,
  enviarCorreoRecuperacion,
  cerrarSesion,
  observarSesion,
};
