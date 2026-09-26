// dom-utils.js — helpers de DOM compartidos entre main.js y ui.js (toast,
// escape de HTML). Sin lógica de negocio ni de Firebase, así que no hace
// falta node:test acá — es manipulación directa del DOM, y probarla
// exige un navegador (ver los flujos de Playwright usados en las fases
// anteriores). Vive aparte para que main.js y ui.js no dupliquen esta
// lógica ni terminen escribiendo cada uno por su cuenta al mismo #toast.

/**
 * @param {string} texto
 * @param {string} [accionTexto] - ej. "Deshacer"
 * @param {() => void} [accionFn]
 */
function mostrarToast(texto, accionTexto, accionFn) {
  const t = document.getElementById("toast");
  const m = document.getElementById("toast-msg");
  m.textContent = texto;

  const existente = t.querySelector("button");
  if (existente) existente.remove();
  if (accionTexto) {
    const b = document.createElement("button");
    b.textContent = accionTexto;
    b.onclick = () => {
      accionFn();
      t.classList.remove("show");
    };
    t.appendChild(b);
  }

  t.classList.add("show");
  clearTimeout(mostrarToast._h);
  mostrarToast._h = setTimeout(() => t.classList.remove("show"), accionTexto ? 4200 : 1800);
}

/** @param {string} str */
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : str;
  return d.innerHTML;
}

/**
 * Dispara la descarga de un archivo generado en memoria (sin pasar por
 * ningún servidor): crea un Blob, un link temporal con el atributo
 * "download", lo clickea solo, y lo saca del DOM. Usado por el respaldo
 * manual y el automático (ver ui.js#exportacion).
 * @param {string} nombre - nombre de archivo, con extensión
 * @param {string|ArrayBuffer|Uint8Array} contenido
 * @param {string} tipoMime
 */
function descargarArchivo(nombre, contenido, tipoMime) {
  const blob = new Blob([contenido], { type: tipoMime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { mostrarToast, escapeHtml, descargarArchivo };
