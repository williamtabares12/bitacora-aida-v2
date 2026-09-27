// main.js — arranca la app: conecta auth.js, db.js y ui.js (spec, sección
// 7). Dibuja la pantalla de login/registro mientras no hay sesión: en
// cuanto la hay, delega toda la pantalla principal a ui.js, pasándole la
// usuaria y el estado de configuracion/parametros (Fase 4).

import {
  registrarConCorreo,
  iniciarSesionConCorreo,
  iniciarSesionConGoogle,
  anularRegistroGoogleSinAceptar,
  enviarCorreoRecuperacion,
  observarSesion,
} from "./auth.js";
import { leerConfiguracion } from "./db.js";
import { renderApp } from "./ui.js";
import { escapeHtml } from "./dom-utils.js";
import { textoAvisoTratamiento, CORREO_CONTACTO_DEFECTO } from "./aviso.js";

const app = document.getElementById("app");

/** modo: "login" | "registro" */
let modo = "login";
let mensaje = null; // { tipo: "error"|"ok", texto: string }
let enviando = false;

// Aceptación del aviso de tratamiento de datos (Ley 1581/2012). Solo se
// exige para CREAR una cuenta nueva, no para iniciar sesión con una que ya
// existe — la ley pide el consentimiento en el momento de recolectar los
// datos, no en cada inicio de sesión posterior. Se reinicia cada vez que
// se cambia de modo, para que nadie quede "aceptando de memoria" sin
// haberlo marcado en la pantalla que tiene al frente ahora mismo.
let aceptoTratamiento = false;

/**
 * Caché en memoria de configuracion/parametros (spec, sección 4): se lee
 * una sola vez por sesión, la primera vez que hay una usuaria autenticada
 * (antes de eso las reglas de Firestore igual lo negarían, y no hay nada
 * que mostrar sin sesión). Fase 5 la va a consumir para calcular los
 * desgloses en vez de tener códigos/porcentajes escritos en el código.
 */
let parametrosConvenio = null;
let parametrosError = null;
let cargandoParametros = false;

// Espejo de "quién está autenticada ahora mismo", actualizado desde
// observarSesion() más abajo. main.js no debe leer el estado de sesión de
// ningún otro lado (spec, sección 7: auth.js encapsula todo lo de
// Firebase Auth), así que esta variable propia reemplaza cualquier
// intento de mirar directamente adentro de auth.js.
let usuarioActivo = null;

async function cargarConfiguracionSiHaceFalta(usuario) {
  if (parametrosConvenio || cargandoParametros) return;
  cargandoParametros = true;
  const resultado = await leerConfiguracion();
  cargandoParametros = false;

  if (resultado.ok) {
    parametrosConvenio = resultado.parametros;
    parametrosError = null;
  } else {
    parametrosError = resultado.error;
    // eslint-disable-next-line no-console
    console.error("[main.js] No se pudo cargar configuracion/parametros:", resultado.error);
  }

  // Re-renderizar solo si seguimos en la pantalla de esa misma usuaria —
  // pudo cerrar sesión mientras esta lectura estaba en vuelo.
  if (usuarioActivo && usuarioActivo.uid === usuario.uid) {
    renderApp(usuarioActivo, { parametros: parametrosConvenio, parametrosError });
  }
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
          ${esRegistro ? `
            <details class="aviso-tratamiento">
              <summary>Aviso de tratamiento de datos personales</summary>
              ${textoAvisoTratamiento(CORREO_CONTACTO_DEFECTO)}
            </details>
            <label class="campo-check">
              <input type="checkbox" id="check-aviso" ${aceptoTratamiento ? "checked" : ""}>
              Acepto el tratamiento de mis datos personales, como se explica arriba.
            </label>
          ` : ""}

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
    aceptoTratamiento = esRegistro ? document.getElementById("check-aviso").checked : aceptoTratamiento;

    if (esRegistro && !nombre) {
      mensaje = { tipo: "error", texto: "Contanos cómo te llamás." };
      renderAuth();
      return;
    }

    // Sin la aceptación del aviso no se crea la cuenta — spec: el registro
    // queda anulado, no solo "recomendado".
    if (esRegistro && !aceptoTratamiento) {
      mensaje = { tipo: "error", texto: "Para crear tu cuenta primero tenés que aceptar el tratamiento de datos personales (la casilla de abajo)." };
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
    // Con Google, Firebase puede crear la cuenta en el mismo paso (si el
    // correo nunca se había usado acá), así que este botón también queda
    // sujeto al aviso mientras estamos en la pantalla de "Crear cuenta".
    const aceptoAntesDeAbrir = esRegistro && document.getElementById("check-aviso").checked;
    if (esRegistro) {
      aceptoTratamiento = aceptoAntesDeAbrir;
      if (!aceptoTratamiento) {
        mensaje = { tipo: "error", texto: "Para crear tu cuenta primero tenés que aceptar el tratamiento de datos personales (la casilla de abajo)." };
        renderAuth();
        return;
      }
    }
    enviando = true;
    mensaje = null;
    renderAuth();
    const resultado = await iniciarSesionConGoogle();
    enviando = false;

    if (!resultado.ok) {
      mensaje = { tipo: "error", texto: resultado.error };
      renderAuth();
      return;
    }

    // Firebase acaba de CREAR la cuenta (era un correo de Google nunca
    // usado acá) y no veníamos de la pantalla de "Crear cuenta" con la
    // casilla marcada — pasa cuando alguien intenta Google por primera
    // vez desde "Iniciar sesión". Se deshace el registro (no solo se
    // cierra sesión) y se manda a aceptar el aviso primero.
    if (resultado.esNuevo && !aceptoAntesDeAbrir) {
      await anularRegistroGoogleSinAceptar();
      modo = "registro";
      mensaje = { tipo: "error", texto: "Ese correo de Google no tenía cuenta acá todavía. Para crearla, primero aceptá el tratamiento de datos personales." };
      renderAuth();
    }
    // Si resultado.ok y (no era nueva, o era nueva y sí se había
    // aceptado antes) observarSesion() ya dispara el render principal —
    // no hace falta hacer nada más acá.
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
    aceptoTratamiento = false;
    renderAuth();
  };
}

function iconoGoogle() {
  return `<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97l3.05 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>`;
}

/* ============ arranque: la sesión decide qué pantalla se ve ============ */

observarSesion((usuario) => {
  usuarioActivo = usuario;
  if (usuario) {
    renderApp(usuario, { parametros: parametrosConvenio, parametrosError });
    cargarConfiguracionSiHaceFalta(usuario);
  } else {
    modo = "login";
    mensaje = null;
    renderAuth();
  }
});
