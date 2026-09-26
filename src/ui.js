// ui.js — renderizado y manejo de eventos de la pantalla principal
// (después de iniciar sesión). Porta el diseño y la interacción de la v1
// (grid de códigos, selector de mes/acumulado, reporte, deslizar para
// eliminar) a la estructura modular de la v2: los datos vienen de
// db.js (Firestore) en vez de localStorage, y el desglose del convenio
// sale de calculo.js con los parámetros de configuracion/parametros en
// vez de una tabla fija en el código (spec, Fase 5).
//
// NOTA: la v1 también tenía "Exportar respaldo (.json)" y "Exportar a
// Excel", además de "Importar respaldo". Fase 7 (spec, sección 8) agrega
// acá solo la importación — es lo que hace falta para migrar el
// histórico de Ana a Firestore una vez. La exportación queda pendiente a
// propósito, no olvidada: no bloquea la migración y puede agregarse
// después sin tocar esta pantalla.

import { crearEntrada, listarTodasLasEntradas, editarEntrada, eliminarEntrada, importarEntradas } from "./db.js";
import { calcularMes, sumarBreakdowns } from "./calculo.js";
import { cerrarSesion } from "./auth.js";
import { mostrarToast, escapeHtml } from "./dom-utils.js";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mesKeyDeFecha(fechaISO) {
  return fechaISO.slice(0, 7);
}
function etiquetaMes(mesKey) {
  const [y, m] = mesKey.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
}
function fechaCorta(fechaISO) {
  const [, m, d] = fechaISO.split("-").map(Number);
  return `${d} ${MESES[m - 1].slice(0, 3)}`;
}
function formatoPesos(n) {
  const signo = n < 0 ? "-" : "";
  return `${signo}$${Math.round(Math.abs(n)).toLocaleString("es-CO")}`;
}

/* ============ estado en memoria (por usuaria activa) ============ */

let uidActual = null;
let entradasCache = [];
let cargandoEntradas = false;
let errorEntradas = null;

let vista = { mesSeleccionado: null, modo: "mes", editandoId: null, filaAbierta: null };
let ultimoEliminado = null;
let ultimoEliminadoTimer = null;

async function cargarEntradas() {
  cargandoEntradas = true;
  errorEntradas = null;
  const resultado = await listarTodasLasEntradas(uidActual);
  cargandoEntradas = false;
  if (resultado.ok) {
    entradasCache = resultado.entradas;
    errorEntradas = null;
  } else {
    errorEntradas = resultado.error;
  }
}

function mesesDisponibles() {
  const set = new Set(entradasCache.map((e) => mesKeyDeFecha(e.fecha)));
  set.add(mesKeyDeFecha(hoyISO()));
  return Array.from(set).sort().reverse();
}

/* ============ acciones (todas contra db.js, luego recargan y redibujan) ============ */

async function agregarEntrada(usuario, parametros, codigo) {
  const valor = parametros.codigos[codigo];
  const fecha = hoyISO();
  const resultado = await crearEntrada(uidActual, { codigo, valor, fecha, comentario: "" });
  if (!resultado.ok) {
    mostrarToast(resultado.error);
    return;
  }
  vista.mesSeleccionado = mesKeyDeFecha(fecha);
  await cargarEntradas();
  dibujar(usuario, { parametros, parametrosError: null });
  mostrarToast(`${codigo} agregado — ${formatoPesos(valor)}`);
}

async function pedirEliminar(usuario, parametros, id) {
  const entrada = entradasCache.find((e) => e.id === id);
  if (!entrada) return;

  const resultado = await eliminarEntrada(uidActual, id);
  if (!resultado.ok) {
    mostrarToast(resultado.error);
    return;
  }

  clearTimeout(ultimoEliminadoTimer);
  // Firestore ya borró el documento — "deshacer" recrea una entrada
  // equivalente (mismo código/valor/fecha/comentario), no revive el mismo
  // id. Desde la perspectiva de Ana el resultado es el mismo: reaparece.
  ultimoEliminado = { codigo: entrada.codigo, valor: entrada.valor, fecha: entrada.fecha, comentario: entrada.comentario };
  await cargarEntradas();
  dibujar(usuario, { parametros, parametrosError: null });
  mostrarToast(`${entrada.codigo} eliminado`, "Deshacer", () => deshacerEliminar(usuario, parametros));
  ultimoEliminadoTimer = setTimeout(() => { ultimoEliminado = null; }, 4200);
}

async function deshacerEliminar(usuario, parametros) {
  if (!ultimoEliminado) return;
  const datos = ultimoEliminado;
  ultimoEliminado = null;
  const resultado = await crearEntrada(uidActual, datos);
  if (!resultado.ok) {
    mostrarToast(resultado.error);
    return;
  }
  await cargarEntradas();
  dibujar(usuario, { parametros, parametrosError: null });
}

/**
 * Importa el respaldo .json de la v1 (spec, sección 8). `archivo` es el
 * File que entrega el <input type="file">, ya elegido por la usuaria.
 */
async function importarRespaldo(usuario, parametros, archivo) {
  let datos;
  try {
    const texto = await archivo.text();
    datos = JSON.parse(texto);
  } catch {
    mostrarToast("Ese archivo no es un .json válido.");
    return;
  }

  mostrarToast("Importando…");
  const resultado = await importarEntradas(uidActual, datos);
  if (!resultado.ok) {
    mostrarToast(resultado.error);
    return;
  }

  await cargarEntradas();
  dibujar(usuario, { parametros, parametrosError: null });

  const partes = [`${resultado.insertadas} nueva${resultado.insertadas === 1 ? "" : "s"}`];
  if (resultado.duplicadas > 0) partes.push(`${resultado.duplicadas} ya existían`);
  if (resultado.invalidas > 0) partes.push(`${resultado.invalidas} inválida${resultado.invalidas === 1 ? "" : "s"}`);
  mostrarToast(`Importación lista: ${partes.join(", ")}.`);
}

async function manejarCerrarSesion() {
  await cerrarSesion();
  mostrarToast("Sesión cerrada");
}

async function actualizarEntrada(usuario, parametros, id, fecha, comentario) {
  const resultado = await editarEntrada(uidActual, id, { fecha, comentario });
  if (!resultado.ok) {
    mostrarToast(resultado.error);
    return;
  }
  vista.editandoId = null;
  await cargarEntradas();
  dibujar(usuario, { parametros, parametrosError: null });
}

/* ============ render principal ============ */

/**
 * Punto de entrada de esta pantalla. main.js la llama cada vez que hay
 * usuaria autenticada y cada vez que cambia el estado de la configuración
 * (cargando / cargada / con error) — ver spec, sección 7 y Fase 4.
 * @param {{uid: string, displayName?: string, email?: string}} usuario
 * @param {{parametros: object|null, parametrosError: string|null}} config
 */
async function renderApp(usuario, { parametros, parametrosError }) {
  if (uidActual !== usuario.uid) {
    // cambió de usuaria (cerró sesión y entró con otra cuenta en la misma
    // pestaña): se reinicia todo el estado local, nada de la anterior
    // debe quedar visible ni mezclarse.
    uidActual = usuario.uid;
    entradasCache = [];
    errorEntradas = null;
    vista = { mesSeleccionado: null, modo: "mes", editandoId: null, filaAbierta: null };
    ultimoEliminado = null;
    if (parametros) await cargarEntradas();
  } else if (parametros && entradasCache.length === 0 && !cargandoEntradas && !errorEntradas) {
    // primera vez que hay parametros disponibles para esta misma usuaria
    // (Fase 4 los cargó después de este primer render).
    await cargarEntradas();
  }

  dibujar(usuario, { parametros, parametrosError });
}

function dibujar(usuario, { parametros, parametrosError }) {
  const contenedor = document.getElementById("app");
  const nombre = usuario.displayName || usuario.email || "";
  const hoy = new Date();
  const fechaLarga = hoy.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });

  const encabezado = `
    <header>
      <h1>Bitácora AIDA</h1>
      <span class="fecha">${fechaLarga}</span>
    </header>
    <div class="saludo">
      <span>Hola, ${escapeHtml(nombre)}</span>
      <button id="btn-cerrar-sesion">cerrar sesión</button>
    </div>
  `;

  if (parametrosError) {
    contenedor.innerHTML = `
      ${encabezado}
      <div class="placeholder-card">No se pudo cargar la configuración del convenio: ${escapeHtml(parametrosError)}</div>
    `;
    document.getElementById("btn-cerrar-sesion").onclick = manejarCerrarSesion;
    return;
  }
  if (!parametros) {
    contenedor.innerHTML = `${encabezado}<div class="placeholder-card">Cargando configuración del convenio…</div>`;
    document.getElementById("btn-cerrar-sesion").onclick = manejarCerrarSesion;
    return;
  }
  if (cargandoEntradas && entradasCache.length === 0) {
    contenedor.innerHTML = `${encabezado}<div class="placeholder-card">Cargando tus registros…</div>`;
    document.getElementById("btn-cerrar-sesion").onclick = manejarCerrarSesion;
    return;
  }
  if (errorEntradas) {
    contenedor.innerHTML = `
      ${encabezado}
      <div class="placeholder-card">No se pudieron cargar tus registros: ${escapeHtml(errorEntradas)}</div>
    `;
    document.getElementById("btn-cerrar-sesion").onclick = manejarCerrarSesion;
    return;
  }

  const codigos = Object.entries(parametros.codigos); // [ [nombre, valor], ... ]
  const meses = mesesDisponibles();
  if (!meses.includes(vista.mesSeleccionado)) vista.mesSeleccionado = meses[0];

  const entradasMesSel = entradasCache
    .filter((e) => mesKeyDeFecha(e.fecha) === vista.mesSeleccionado)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const breakdownMes = calcularMes(entradasMesSel, parametros);
  const breakdownsPorMes = meses.map((m) => calcularMes(entradasCache.filter((e) => mesKeyDeFecha(e.fecha) === m), parametros));
  const acumulado = sumarBreakdowns(breakdownsPorMes);
  const esAcumulado = vista.modo === "acumulado";
  const b = esAcumulado ? acumulado : breakdownMes;
  const tituloReporte = esAcumulado ? `Acumulado (${acumulado.meses} ${acumulado.meses === 1 ? "mes" : "meses"})` : etiquetaMes(vista.mesSeleccionado);

  contenedor.innerHTML = `
    ${encabezado}

    <section>
      <div class="section-title">Agregar código</div>
      <div class="grid-codigos">
        ${codigos.map(([nombreCodigo, valor]) => `
          <div class="codigo-btn" data-codigo="${escapeHtml(nombreCodigo)}">
            <span class="cod">${escapeHtml(nombreCodigo)}</span>
            <span class="val tabular">${formatoPesos(valor)}</span>
          </div>
        `).join("")}
      </div>
    </section>

    <section>
      <div class="barra-mes">
        <select id="select-mes">
          ${meses.map((m) => `<option value="${m}" ${m === vista.mesSeleccionado ? "selected" : ""}>${etiquetaMes(m)}</option>`).join("")}
        </select>
        <div class="segmented">
          <button data-modo="mes" class="${!esAcumulado ? "activo" : ""}">Mes</button>
          <button data-modo="acumulado" class="${esAcumulado ? "activo" : ""}">Acumulado</button>
        </div>
      </div>

      ${!esAcumulado ? `
        <div class="section-title">Registros de ${etiquetaMes(vista.mesSeleccionado)} (${entradasMesSel.length})</div>
        ${entradasMesSel.length === 0 ? `<div class="vacio">Sin registros todavía este mes.</div>` : entradasMesSel.map((e) => renderRegistro(e)).join("")}
      ` : ""}
    </section>

    <section>
      <div class="section-title">Reporte — ${tituloReporte}</div>

      ${esAcumulado ? `
        <div class="hero">
          <div class="etiqueta">Total facturado</div>
          <div class="cifra tabular">${formatoPesos(b.totalFacturado)}</div>
        </div>
      ` : ""}

      <div class="reporte">
        <div class="linea"><span class="etq">Total facturado</span><span class="val tabular">${formatoPesos(b.totalFacturado)}</span></div>
        <div class="linea resta"><span class="etq">Cuota extraordinaria AIDA (${formatoPorcentaje(parametros.cuotaExtraordinaria)})</span><span class="val tabular">−${formatoPesos(b.cuotaExtraordinaria)}</span></div>
        <div class="linea"><span class="etq">Facturación final</span><span class="val tabular">${formatoPesos(b.facturacionFinal)}</span></div>
        <div class="linea"><span class="etq">IBC seguridad social (${formatoPorcentaje(parametros.ibcPorc)})</span><span class="val tabular">${formatoPesos(b.ibc)}</span></div>
        <div class="subgrupo">
          <div class="linea resta"><span class="etq">Salud (${formatoPorcentaje(parametros.salud)})</span><span class="val tabular">−${formatoPesos(b.salud)}</span></div>
          <div class="linea resta"><span class="etq">Pensión (${formatoPorcentaje(parametros.pension)})</span><span class="val tabular">−${formatoPesos(b.pension)}</span></div>
          <div class="linea resta"><span class="etq">ARL (${formatoPorcentaje(parametros.arl)}, estimado)</span><span class="val tabular">−${formatoPesos(b.arl)}</span></div>
        </div>
        <div class="linea resta"><span class="etq">Sostenimiento</span><span class="val tabular">−${formatoPesos(b.sostenimiento)}</span></div>
        <div class="linea resta"><span class="etq">Sucursal</span><span class="val tabular">−${formatoPesos(b.sucursal)}</span></div>
        <div class="linea resta"><span class="etq">Provisiones (${formatoPorcentaje(parametros.provisiones)})<small>prima, cesantías, intereses y vacaciones — se recibe después</small></span><span class="val tabular">−${formatoPesos(b.provisiones)}</span></div>
        <div class="linea total">
          <span class="etq">${esAcumulado ? "Llevas facturado o ganado" : "Te llega este mes"}</span>
          <span class="val tabular">${formatoPesos(b.totalPagoNeto)}</span>
        </div>
        <div class="linea"><span class="etq">Con provisiones incluidas</span><span class="val tabular">${formatoPesos(b.totalConProvisiones)}</span></div>
        <div class="nota">La provisión no se pierde: vuelve como prima (junio y diciembre), cesantías (febrero) e intereses (enero), y como vacaciones cuando las solicites. La tarifa de ARL es un estimado; se ajusta desde la configuración si AIDA confirma la real.</div>
      </div>
    </section>

    <section>
      <button class="btn-fila" id="btn-importar">Importar respaldo (.json)</button>
      <input type="file" id="input-importar" accept="application/json,.json" style="display:none;">
    </section>

    <footer>Tus datos quedan asociados a tu cuenta, accesibles desde cualquier dispositivo.</footer>
  `;

  cablearEventos(usuario, { parametros, parametrosError });
}

function formatoPorcentaje(n) {
  const texto = (n * 100).toLocaleString("es-CO", { maximumFractionDigits: 2 });
  return `${texto}%`;
}

function renderRegistro(e) {
  if (vista.editandoId === e.id) {
    return `
      <div class="editar-panel">
        <div class="cod-val"><span>${escapeHtml(e.codigo)}</span><span class="tabular">${formatoPesos(e.valor)}</span></div>
        <input type="date" id="fecha-${e.id}" value="${e.fecha}">
        <input type="text" id="coment-${e.id}" placeholder="Comentario (opcional)" value="${escapeHtml(e.comentario || "")}">
        <div class="editar-acciones">
          <button class="btn-cancelar-edit" data-cancelar-edicion="${e.id}">Cancelar</button>
          <button class="btn-guardar-edit" data-guardar-edicion="${e.id}">Guardar</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="registro-card" data-id="${e.id}">
      <div class="registro-eliminar-fondo"><button data-eliminar="${e.id}">Eliminar</button></div>
      <div class="registro-front" data-front="${e.id}">
        <div class="izq">
          <span class="cod">${escapeHtml(e.codigo)}</span>
          <span class="meta">${fechaCorta(e.fecha)}${e.comentario ? ` · ${escapeHtml(e.comentario)}` : ""}</span>
        </div>
        <div class="der">
          <span class="val tabular">${formatoPesos(e.valor)}</span>
          <button class="lapiz" data-editar="${e.id}" title="Editar">✎</button>
        </div>
      </div>
    </div>
  `;
}

function cablearEventos(usuario, config) {
  const { parametros } = config;

  document.getElementById("btn-cerrar-sesion").onclick = manejarCerrarSesion;

  document.querySelectorAll(".codigo-btn").forEach((el) => {
    el.onclick = () => agregarEntrada(usuario, parametros, el.dataset.codigo);
  });
  document.getElementById("select-mes").onchange = (ev) => {
    vista.mesSeleccionado = ev.target.value;
    dibujar(usuario, config);
  };
  document.querySelectorAll(".segmented button").forEach((el) => {
    el.onclick = () => { vista.modo = el.dataset.modo; dibujar(usuario, config); };
  });

  document.querySelectorAll("[data-editar]").forEach((el) => {
    el.onclick = () => { vista.editandoId = el.dataset.editar; dibujar(usuario, config); };
  });
  document.querySelectorAll("[data-guardar-edicion]").forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.guardarEdicion;
      const fecha = document.getElementById(`fecha-${id}`).value;
      const comentario = document.getElementById(`coment-${id}`).value;
      actualizarEntrada(usuario, parametros, id, fecha, comentario);
    };
  });
  document.querySelectorAll("[data-cancelar-edicion]").forEach((el) => {
    el.onclick = () => { vista.editandoId = null; dibujar(usuario, config); };
  });
  document.querySelectorAll("[data-eliminar]").forEach((el) => {
    el.onclick = () => pedirEliminar(usuario, parametros, el.dataset.eliminar);
  });

  const inputImportar = document.getElementById("input-importar");
  document.getElementById("btn-importar").onclick = () => inputImportar.click();
  inputImportar.onchange = () => {
    const archivo = inputImportar.files[0];
    inputImportar.value = ""; // permite elegir el mismo archivo dos veces seguidas
    if (archivo) importarRespaldo(usuario, parametros, archivo);
  };

  activarSwipe();
}

/* ============ deslizar para eliminar (idéntico a la v1: gestos de
   puntero puros, sin datos — nada que cambiar al migrar a Firestore) ============ */

// La v1 volvía a agregar el listener de document en cada render() sin
// quitar el anterior, acumulando uno más por cada clic durante toda la
// sesión (agregar un código, cambiar de mes, editar... todo re-renderiza).
// Inofensivo en la práctica (cerrarSiFuera es barato e idempotente) pero
// es un descuido real, así que acá se agrega una sola vez.
let listenerDocumentoActivo = false;

function activarSwipe() {
  document.querySelectorAll(".registro-front").forEach((front) => {
    const id = front.dataset.front;
    let startX = 0;
    let dragging = false;
    let startedOpen = false;

    front.addEventListener("pointerdown", (ev) => {
      dragging = true;
      startX = ev.clientX;
      startedOpen = vista.filaAbierta === id;
      front.style.transition = "none";
      try { front.setPointerCapture(ev.pointerId); } catch { /* ignorar */ }
    });
    front.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      const delta = ev.clientX - startX;
      const base = startedOpen ? -84 : 0;
      const x = Math.min(0, Math.max(-84, base + delta));
      front.style.transform = `translateX(${x}px)`;
    });
    const soltar = (ev) => {
      if (!dragging) return;
      dragging = false;
      front.style.transition = "transform 0.2s ease";
      const delta = (ev.clientX || startX) - startX;
      const base = startedOpen ? -84 : 0;
      const x = Math.min(0, Math.max(-84, base + delta));
      if (x < -42) {
        front.style.transform = "translateX(-84px)";
        cerrarFilaAbierta(id);
        vista.filaAbierta = id;
      } else {
        front.style.transform = "translateX(0)";
        if (vista.filaAbierta === id) vista.filaAbierta = null;
      }
    };
    front.addEventListener("pointerup", soltar);
    front.addEventListener("pointercancel", soltar);

    if (vista.filaAbierta === id) front.style.transform = "translateX(-84px)";
  });

  if (!listenerDocumentoActivo) {
    document.addEventListener("pointerdown", cerrarSiFuera, { capture: true });
    listenerDocumentoActivo = true;
  }
}
function cerrarFilaAbierta(exceptoId) {
  document.querySelectorAll(".registro-front").forEach((front) => {
    if (front.dataset.front !== exceptoId) {
      front.style.transition = "transform 0.2s ease";
      front.style.transform = "translateX(0)";
    }
  });
}
function cerrarSiFuera(ev) {
  if (!vista.filaAbierta) return;
  const dentro = ev.target.closest(".registro-card");
  const esFilaAbierta = dentro && dentro.dataset.id === vista.filaAbierta;
  if (!esFilaAbierta) {
    cerrarFilaAbierta(null);
    vista.filaAbierta = null;
  }
}

export { renderApp };
