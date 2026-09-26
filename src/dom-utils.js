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

export { mostrarToast, escapeHtml };
