// main.js — arranca la app. Fase 2: conecta auth.js con la pantalla de
// login/registro y una pantalla de bienvenida placeholder. Las Fases 3-5
// van a reemplazar esa pantalla placeholder por la app real conectada a
// Firestore (db.js), sin tocar nada de lo que hay acá.

import {
  registrarConCorreo,
  iniciarSesionConCorreo,
  iniciarSesionConGoogle,
  enviarCorreoRecuperacion,
  cerrarSesion,
  observarSesion,
} from "./auth.js";

const app = document.getElementById("app");

/** modo: "login" | "registro" */
let modo = "login";
let mensaje = null; // { tipo: "error"|"ok", texto: string }
let enviando = false;

function mostrarToast(texto) {
  const t = document.getElementById("toast");
  const m = document.getElementById("toast-msg");
  m.textContent = texto;
  t.classList.add("show");
  clearTimeout(mostrarToast._h);
  mostrarToast._h = setTimeout(() => t.classList.remove("show"), 2400);
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/* ============ pantalla de autenticación (sin sesión) ============ */

function renderAuth() {
  const esRegistro = modo === "registro";

  app.innerHTML = `
    <div class="auth-screen">
      <div class="gate">
        <h1>Bitácora AIDA</h1>
        <p class="subtitulo">Registra tus códigos de facturación y mirá el desglose real de descuentos del contrato sindical, mes a mes.</p>

        ${mensaje ? `<div class="${mensaje.tipo === "error" ? "error-msg" : "ok-msg"}">${escapeHtml(mensaje.texto)}</div>` : ""}

        <form id="form-auth">
          ${esRegistro ? `
            <div class="campo">
              <label for="input-nombre">Tu nombre</label>
              <input id="input-nombre" type="text" autocomplete="given-name" required>
            </div>
          ` : ""}
          <div class="campo">
            <label for="input-correo">Correo</label>
            <input id="input-correo" type="email" autocomplete="email" required>
          </div>
          <div class="campo">
            <label for="input-contrasena">Contraseña</label>
            <input id="input-contrasena" type="password" autocomplete="${esRegistro ? "new-password" : "current-password"}" minlength="6" required>
          </div>
          <button type="submit" class="btn" id="btn-submit" ${enviando ? "disabled" : ""}>
            ${enviando ? "Un momento…" : (esRegistro ? "Crear cuenta" : "Iniciar sesión")}
          </button>
        </form>

        <div class="separador-o">o</div>

        <button class="btn-google" id="btn-google" ${enviando ? "disabled" : ""}>
          ${iconoGoogle()} Continuar con Google
        </button>

        ${!esRegistro ? `<button class="enlace-texto" id="btn-olvide" style="margin-top:14px;">¿Olvidaste tu contraseña?</button>` : ""}

        <div class="auth-toggle">
          ${esRegistro
            ? `¿Ya tenés cuenta? <button id="btn-cambiar-modo">Iniciar sesión</button>`
            : `¿Primera vez acá? <button id="btn-cambiar-modo">Crear cuenta</button>`}
        </div>
      </div>
      <footer>Tus datos quedan asociados a tu cuenta, no al celular.</footer>
    </div>
  `;

  document.getElementById("form-auth").onsubmit = async (ev) => {
    ev.preventDefault();
    // Capturar TODOS los valores del formulario antes de volver a dibujar
    // nada: renderAuth() reemplaza los inputs por unos nuevos y vacíos, así
    // que leer un campo después de esa llamada siempre da un valor en blanco.
    const correo = document.getElementById("input-correo").value.trim();
    const contrasena = document.getElementById("input-contrasena").value;
    const nombre = esRegistro ? document.getElementById("input-nombre").value.trim() : "";

    if (esRegistro && !nombre) {
      mensaje = { tipo: "error", texto: "Contanos cómo te llamás." };
      renderAuth();
      return;
    }

    enviando = true;
    mensaje = null;
    renderAuth();

    const resultado = esRegistro
      ? await registrarConCorreo(nombre, correo, contrasena)
      : await iniciarSesionConCorreo(correo, contrasena);

    enviando = false;
    if (!resultado.ok) {
      mensaje = { tipo: "error", texto: resultado.error };
      renderAuth();
    }
    // Si resultado.ok, observarSesion() dispara el re-render a la pantalla
    // de bienvenida — no hace falta hacer nada más acá.
  };

  document.getElementById("btn-google").onclick = async () => {
    enviando = true;
    mensaje = null;
    renderAuth();
    const resultado = await iniciarSesionConGoogle();
    enviando = false;
    if (!resultado.ok) {
      mensaje = { tipo: "error", texto: resultado.error };
      renderAuth();
    }
  };

  const btnOlvide = document.getElementById("btn-olvide");
  if (btnOlvide) {
    btnOlvide.onclick = async () => {
      const correo = document.getElementById("input-correo").value.trim();
      if (!correo) {
        mensaje = { tipo: "error", texto: "Escribí tu correo arriba primero, y tocá de nuevo el enlace." };
        renderAuth();
        return;
      }
      const resultado = await enviarCorreoRecuperacion(correo);
      mensaje = resultado.ok
        ? { tipo: "ok", texto: "Te enviamos un correo para restablecer la contraseña." }
        : { tipo: "error", texto: resultado.error };
      renderAuth();
    };
  }

  document.getElementById("btn-cambiar-modo").onclick = () => {
    modo = esRegistro ? "login" : "registro";
    mensaje = null;
    renderAuth();
  };
}

function iconoGoogle() {
  return `<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97l3.05 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>`;
}

/* ============ pantalla post-login (placeholder hasta Fase 5) ============ */

function renderInicio(usuario) {
  const nombre = usuario.displayName || usuario.email || "";
  app.innerHTML = `
    <header><h1>Bitácora AIDA</h1></header>
    <div class="saludo">
      <span>Hola, ${escapeHtml(nombre)}</span>
      <button id="btn-cerrar-sesion">cerrar sesión</button>
    </div>
    <div class="placeholder-card">
      Sesión iniciada correctamente. La pantalla de códigos y reportes se conecta acá en la siguiente fase (Firestore).
    </div>
  `;

  document.getElementById("btn-cerrar-sesion").onclick = async () => {
    await cerrarSesion();
    mostrarToast("Sesión cerrada");
  };
}

/* ============ arranque: la sesión decide qué pantalla se ve ============ */

observarSesion((usuario) => {
  if (usuario) {
    renderInicio(usuario);
  } else {
    modo = "login";
    mensaje = null;
    renderAuth();
  }
});
