// ui.js — renderizado y manejo de eventos de la pantalla principal
// (después de iniciar sesión). Porta el diseño y la interacción de la v1
// (grid de códigos, selector de mes/acumulado, reporte, deslizar para
// eliminar) a la estructura modular de la v2: los datos vienen de
// db.js (Firestore) en vez de localStorage, y el desglose del convenio
// sale de calculo.js con los parámetros de configuracion/parametros en
// vez de una tabla fija en el código (spec, Fase 5).
//
// Exportación de respaldo (además de la importación de Fase 7): un botón
// pregunta el formato (.json o Excel) en vez de imponer uno, y aparte hay
// un respaldo automático silencioso — ver la nota junto a
// verificarRespaldoAutomatico() más abajo sobre cómo funciona y por qué
// es así (sin servidor, sin plan pago de Firebase).

import { crearEntrada, listarTodasLasEntradas, editarEntrada, eliminarEntrada, importarEntradas } from "./db.js";
import { calcularMes, sumarBreakdowns } from "./calculo.js";
import { cerrarSesion } from "./auth.js";
import { mostrarToast, escapeHtml, descargarArchivo } from "./dom-utils.js";
import { construirRespaldoJSON, construirFilasExcel, nombreArchivoRespaldo } from "./exportacion.js";
import { abrirModalPrivacidad } from "./aviso.js";

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

let vista = { mesSeleccionado: null, modo: "mes", editandoId: null, filaAbierta: null, eligiendoFormatoExportar: false };
let ultimoEliminado = null;
let ultimoEliminadoTimer = null;

// Si el grid de "Agregar código" queda abierto o colapsado — se recuerda
// por usuaria y por dispositivo (localStorage), no solo durante la sesión:
// si Ana lo cierra hoy, mañana lo vuelve a encontrar cerrado, en vez de
// tener que cerrarlo de nuevo cada vez que entra.
let seccionCodigosAbierta = true;

function claveColapsoCodigos(uid) {
  return `bitacora_aida_codigos_abierto_${uid}`;
}
function cargarEstadoColapso(uid) {
  try {
    const guardado = localStorage.getItem(claveColapsoCodigos(uid));
    seccionCodigosAbierta = guardado === null ? true : guardado === "1";
  } catch {
    seccionCodigosAbierta = true; // almacenamiento no disponible: se queda abierto, sin recordar entre sesiones
  }
}
function guardarEstadoColapso(uid, abierta) {
  seccionCodigosAbierta = abierta;
  try {
    localStorage.setItem(claveColapsoCodigos(uid), abierta ? "1" : "0");
  } catch { /* sin almacenamiento disponible: no se recuerda para la próxima, no es grave */ }
}

// Trae TODO el historial de Firestore de una sola vez. Se usa al abrir
// sesión (o al cambiar de usuaria) y después de una importación masiva —
// nunca después de agregar/editar/eliminar UN registro: esas acciones ya
// saben exactamente qué cambió, así que actualizan entradasCache
// directamente en memoria (ver agregarEntrada, actualizarEntrada,
// pedirEliminar, deshacerEliminar) en vez de volver a pedirle a
// Firestore algo que ya sabemos. Sin esto, cada código agregado o
// borrado multiplicaba las lecturas por el tamaño completo del
// historial de esa usuaria — con varias usuarias activas y meses de
// datos acumulados, eso se acerca rápido al cupo gratis de Firestore.
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
  const comentario = "";
  const resultado = await crearEntrada(uidActual, { codigo, valor, fecha, comentario });
  if (!resultado.ok) {
    mostrarToast(resultado.error);
    return;
  }
  // Ya sabemos exactamente qué se guardó (lo acabamos de enviar
  // nosotros mismos) — se agrega directo al caché en memoria, sin
  // volver a traer todo el historial de Firestore.
  entradasCache = [...entradasCache, { id: resultado.id, codigo, valor, fecha, comentario }];
  vista.mesSeleccionado = mesKeyDeFecha(fecha);
  dibujar(usuario, { parametros, parametrosError: null });
  mostrarToast(`${codigo} agregado — ${formatoPesos(valor)}`);
}

// ids con un borrado en curso ahora mismo — solo por si dos toques llegan
// a alcanzar a correr antes de que el primero termine de redibujar (ver
// la nota más abajo, en la práctica ya no debería poder pasar, pero es
// una protección barata).
const idsEliminando = new Set();

async function pedirEliminar(usuario, parametros, id) {
  if (idsEliminando.has(id)) return;
  const idx = entradasCache.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const entrada = entradasCache[idx];

  // Borrado OPTIMISTA: la fila desaparece de la pantalla apenas se toca
  // "Eliminar", sin esperar la ida y vuelta a Firestore. Antes se
  // esperaba `await eliminarEntrada(...)` antes de tocar la pantalla — en
  // una red real (a diferencia de las pruebas locales) eso puede tardar
  // lo suficiente como para parecer que no pasó nada, así que Ana
  // terminaba tocando "Eliminar" en el código de al lado mientras el
  // primer borrado todavía estaba en camino. Ambos terminaban
  // completándose (cada uno sobre un documento distinto, sin
  // conflicto), pero ella solo veía desaparecer las dos filas juntas al
  // final, como si el primer toque no hubiese hecho nada por sí solo.
  // Mostrando el cambio al instante, ya no hay ventana en la que un
  // segundo toque pueda superponerse con uno anterior sin que se note.
  idsEliminando.add(id);
  entradasCache = entradasCache.filter((e) => e.id !== id);
  clearTimeout(ultimoEliminadoTimer);
  // Firestore todavía no confirmó el borrado en este punto — "deshacer"
  // recrea una entrada equivalente (mismo código/valor/fecha/comentario),
  // no revive el mismo id. Desde la perspectiva de Ana el resultado es
  // el mismo: reaparece.
  ultimoEliminado = { codigo: entrada.codigo, valor: entrada.valor, fecha: entrada.fecha, comentario: entrada.comentario };
  dibujar(usuario, { parametros, parametrosError: null });
  mostrarToast(`${entrada.codigo} eliminado`, "Deshacer", () => deshacerEliminar(usuario, parametros));
  ultimoEliminadoTimer = setTimeout(() => { ultimoEliminado = null; }, 4200);

  const resultado = await eliminarEntrada(uidActual, id);
  idsEliminando.delete(id);

  if (!resultado.ok) {
    // No se pudo borrar de verdad (sin conexión, error de Firestore...):
    // reponer la fila que se había quitado de la pantalla y avisar.
    entradasCache = [...entradasCache, entrada];
    clearTimeout(ultimoEliminadoTimer);
    ultimoEliminado = null;
    dibujar(usuario, { parametros, parametrosError: null });
    mostrarToast(`No se pudo eliminar ${entrada.codigo}: ${resultado.error}`);
    return;
  }
  // Ya confirmado en el servidor y el caché local ya refleja el borrado
  // (se quitó arriba, de forma optimista) — no hace falta volver a
  // traer todo el historial solo para confirmar algo que ya sabemos.
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
  entradasCache = [...entradasCache, { id: resultado.id, ...datos }];
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

/* ============ exportar respaldo (manual, con elección de formato) ============ */

function nombreParaArchivo(usuario) {
  return usuario.displayName || usuario.email || null;
}

function descargarRespaldoJSON(usuario) {
  const datos = construirRespaldoJSON(nombreParaArchivo(usuario), entradasCache);
  const texto = JSON.stringify(datos, null, 2);
  descargarArchivo(nombreArchivoRespaldo(nombreParaArchivo(usuario), "json", hoyISO()), texto, "application/json");
  mostrarToast("Respaldo (.json) descargado");
}

// El generador de Excel (ExcelJS) no viene incluido en el proyecto — se
// carga desde una red de distribución de contenido (CDN) solo la primera
// vez que alguien realmente pide un Excel, no en cada carga de la app.
// Así el 90% de las visitas (que no tocan ese botón) no pagan el costo de
// bajar una librería que no van a usar.
let excelJSCargando = null;
function cargarExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (excelJSCargando) return excelJSCargando;
  excelJSCargando = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
    script.onload = () => resolve(window.ExcelJS);
    script.onerror = () => reject(new Error("No se pudo cargar el generador de Excel — revisá tu conexión e intentá de nuevo."));
    document.head.appendChild(script);
  });
  return excelJSCargando;
}

async function descargarRespaldoExcel(usuario) {
  mostrarToast("Generando Excel…");
  let ExcelJS;
  try {
    ExcelJS = await cargarExcelJS();
  } catch (e) {
    mostrarToast(e.message);
    return;
  }

  const filas = construirFilasExcel(entradasCache);
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Bitácora AIDA");
  hoja.columns = [
    { header: "Fecha", key: "Fecha", width: 14 },
    { header: "Código", key: "Codigo", width: 16 },
    { header: "Valor", key: "Valor", width: 14 },
    { header: "Comentario", key: "Comentario", width: 32 },
  ];
  hoja.getRow(1).font = { bold: true, color: { argb: "FF1C1C1E" } };
  hoja.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E5EA" } };
  filas.forEach((fila) => hoja.addRow(fila));
  hoja.getColumn("Valor").numFmt = "#,##0";

  hoja.addRow({});
  const filaTotal = hoja.addRow({ Fecha: "", Codigo: "Total", Valor: filas.reduce((suma, f) => suma + f.Valor, 0), Comentario: "" });
  filaTotal.font = { bold: true };
  filaTotal.getCell("Valor").numFmt = "#,##0";

  const buffer = await libro.xlsx.writeBuffer();
  const nombreArchivo = nombreArchivoRespaldo(nombreParaArchivo(usuario), "xlsx", hoyISO());
  descargarArchivo(nombreArchivo, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  mostrarToast("Excel descargado");
}

/* ============ respaldo automático (silencioso, sin servidor) ============
 *
 * Un respaldo que corra solo "en el servidor" cada cierto tiempo, sin que
 * nadie abra la app, necesitaría una función programada de Firebase — y
 * eso exige pasar del plan gratuito (Spark) al de pago por uso (Blaze),
 * aunque el costo real termine siendo $0. Para no imponerle eso a Ana, el
 * respaldo automático es más simple: la primera vez que abre la app cada
 * semana, se descarga sola una copia .json a su celular/computador, sin
 * que tenga que acordarse de nada ni tocar ningún botón. Siempre en .json
 * (liviano, no depende de cargar el generador de Excel desde internet).
 * Se guarda la fecha del último respaldo en este dispositivo (localStorage,
 * por eso "por dispositivo": si usa el celular y la tablet, cada uno lleva
 * su propia cuenta — inofensivo, en el peor caso se descarga un poco más
 * seguido de lo estrictamente necesario).
 */
const DIAS_ENTRE_RESPALDOS_AUTOMATICOS = 7;
let respaldoAutomaticoVerificadoEstaSesion = false;

function verificarRespaldoAutomatico(usuario) {
  if (respaldoAutomaticoVerificadoEstaSesion || cargandoEntradas) return;
  // Ojo: no marcar "ya verificado" hasta acá abajo. Si todavía no hay
  // ninguna entrada (usuaria nueva, recién entrando), no hay nada que
  // respaldar — pero eso puede cambiar en cualquier momento de la misma
  // sesión (agrega su primer código), así que hay que seguir
  // reintentando en cada render hasta que de verdad haya algo, en vez de
  // darlo por hecho una sola vez y no volver a mirar en toda la sesión.
  if (entradasCache.length === 0) return;
  respaldoAutomaticoVerificadoEstaSesion = true;

  const clave = `bitacora_aida_ultimo_respaldo_${usuario.uid}`;
  let ultimo = null;
  try {
    ultimo = localStorage.getItem(clave);
  } catch {
    return; // almacenamiento no disponible (navegación privada, etc.): sin respaldo automático esta vez
  }

  const ahora = Date.now();
  const diasDesdeUltimo = ultimo ? (ahora - Number(ultimo)) / 86400000 : Infinity;
  if (diasDesdeUltimo < DIAS_ENTRE_RESPALDOS_AUTOMATICOS) return;

  descargarRespaldoJSON(usuario);
  try {
    localStorage.setItem(clave, String(ahora));
  } catch { /* si falla el guardado, en la próxima visita se vuelve a intentar */ }
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
  // Ya sabemos qué cambió — se aplica directo al caché en memoria, sin
  // volver a traer todo el historial.
  entradasCache = entradasCache.map((e) => (e.id === id ? { ...e, fecha, comentario } : e));
  vista.editandoId = null;
  // Si la edición cambió la fecha a otro mes, el registro se movió: sin
  // esto la vista se queda mirando el mes viejo, donde el registro ya no
  // está, y parece que la edición no hizo nada aunque sí se guardó.
  vista.mesSeleccionado = mesKeyDeFecha(fecha);
  dibujar(usuario, { parametros, parametrosError: null });
  mostrarToast("Registro actualizado");
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
    vista = { mesSeleccionado: null, modo: "mes", editandoId: null, filaAbierta: null, eligiendoFormatoExportar: false };
    ultimoEliminado = null;
    cargarEstadoColapso(usuario.uid);
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
      <details class="seccion-colapsable" id="detalle-codigos" ${seccionCodigosAbierta ? "open" : ""}>
        <summary>Agregar código<span class="chevron"><svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5l3.5 3.5l3.5-3.5"/></svg></span></summary>
        <div class="grid-codigos">
          ${codigos.map(([nombreCodigo, valor]) => `
            <div class="codigo-btn" data-codigo="${escapeHtml(nombreCodigo)}">
              <span class="cod">${escapeHtml(nombreCodigo)}</span>
              <span class="val tabular">${formatoPesos(valor)}</span>
            </div>
          `).join("")}
        </div>
      </details>
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
        <div class="linea resta"><span class="etq">Coordinación (${formatoPorcentaje(parametros.coordinacion)})</span><span class="val tabular">−${formatoPesos(b.coordinacion)}</span></div>
        <div class="linea"><span class="etq">Subtotal</span><span class="val tabular">${formatoPesos(b.subtotal)}</span></div>
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
      ${vista.eligiendoFormatoExportar ? `
        <div class="editar-panel">
          <div class="cod-val"><span>¿En qué formato querés el respaldo?</span></div>
          <div class="editar-acciones exportar-acciones">
            <button class="btn-guardar-edit" id="btn-exportar-json">.json</button>
            <button class="btn-guardar-edit" id="btn-exportar-excel">Excel (.xlsx)</button>
            <button class="btn-cancelar-edit" id="btn-exportar-cancelar">Cancelar</button>
          </div>
        </div>
      ` : `
        <button class="btn-fila" id="btn-exportar">Exportar respaldo</button>
      `}
      <button class="btn-fila" id="btn-importar">Importar respaldo (.json)</button>
      <input type="file" id="input-importar" accept="application/json,.json" style="display:none;">
      <div class="nota">Además, cada ${DIAS_ENTRE_RESPALDOS_AUTOMATICOS} días, la primera vez que abrís la app se descarga sola una copia de respaldo (.json) a este celular o computador — sin que tengas que acordarte de nada.</div>
    </section>

    <footer>
      Tus datos quedan asociados a tu cuenta, accesibles desde cualquier dispositivo.
      <button class="enlace-privacidad" id="btn-privacidad">Política de privacidad</button>
    </footer>
  `;

  verificarRespaldoAutomatico(usuario);

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
  document.getElementById("btn-privacidad").onclick = abrirModalPrivacidad;

  document.querySelectorAll(".codigo-btn").forEach((el) => {
    el.onclick = () => agregarEntrada(usuario, parametros, el.dataset.codigo);
  });
  document.getElementById("detalle-codigos").addEventListener("toggle", (ev) => {
    guardarEstadoColapso(usuario.uid, ev.target.open);
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

  if (vista.eligiendoFormatoExportar) {
    document.getElementById("btn-exportar-cancelar").onclick = () => { vista.eligiendoFormatoExportar = false; dibujar(usuario, config); };
    document.getElementById("btn-exportar-json").onclick = () => { vista.eligiendoFormatoExportar = false; dibujar(usuario, config); descargarRespaldoJSON(usuario); };
    document.getElementById("btn-exportar-excel").onclick = () => { vista.eligiendoFormatoExportar = false; dibujar(usuario, config); descargarRespaldoExcel(usuario); };
  } else {
    document.getElementById("btn-exportar").onclick = () => { vista.eligiendoFormatoExportar = true; dibujar(usuario, config); };
  }

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

// Cuánto hay que moverse horizontalmente antes de considerar que esto es
// un gesto de deslizar y no un simple clic/toque sobre un botón de la
// fila (lápiz, eliminar). Por debajo de esto no se llama a
// setPointerCapture — ver la nota de más abajo sobre por qué eso importa.
const UMBRAL_ARRASTRE_PX = 8;

function activarSwipe() {
  document.querySelectorAll(".registro-front").forEach((front) => {
    const id = front.dataset.front;
    let startX = 0;
    let dragging = false;
    let startedOpen = false;
    let pointerIdActivo = null;

    // front.setPointerCapture() en pointerdown rompía los clics reales de
    // MOUSE sobre los botones hijos (lápiz, eliminar): apenas se presiona
    // el botón del mouse, el navegador redirige los eventos de puntero
    // siguientes hacia "front" en vez del botón, y el clic sintetizado
    // nunca llega al botón — confirmado con clics reales (no solo
    // simulados) en computador, que es justo el bug que reportó Ana. En
    // mouse, entonces, la captura se pide recién cuando el movimiento
    // supera UMBRAL_ARRASTRE_PX (ver pointermove más abajo), es decir,
    // una vez que de verdad es un arrastre y no un clic.
    //
    // En TOUCH, en cambio, sí conviene capturar de entrada (como hacía la
    // v1, con años de uso real de Ana en el celular sin este problema):
    // sin la captura inmediata, un dedo real casi nunca se mueve
    // perfectamente horizontal, y ese desvío vertical antes de superar
    // el umbral puede hacer que los eventos de puntero se "escapen" hacia
    // la fila de al lado (el navegador redirige por hit-testing normal
    // mientras no hay captura), confundiendo cuál fila se estaba tocando.
    front.addEventListener("pointerdown", (ev) => {
      dragging = false;
      startX = ev.clientX;
      startedOpen = vista.filaAbierta === id;
      pointerIdActivo = ev.pointerId;
      front.style.transition = "none";
      if (ev.pointerType !== "mouse") {
        try { front.setPointerCapture(ev.pointerId); } catch { /* ignorar */ }
      }
    });
    front.addEventListener("pointermove", (ev) => {
      if (ev.pointerId !== pointerIdActivo) return;
      const delta = ev.clientX - startX;
      if (!dragging) {
        if (Math.abs(delta) < UMBRAL_ARRASTRE_PX) return;
        dragging = true;
        try { front.setPointerCapture(ev.pointerId); } catch { /* ignorar */ }
      }
      const base = startedOpen ? -84 : 0;
      const x = Math.min(0, Math.max(-84, base + delta));
      front.style.transform = `translateX(${x}px)`;
    });
    const soltar = (ev) => {
      pointerIdActivo = null;
      // Nunca se superó el umbral: fue un clic/toque normal, no un
      // arrastre — no se tocó el transform ni se pidió captura, así que
      // no hay nada que deshacer acá; se deja que el navegador procese el
      // clic sobre lo que sea que esté debajo (el propio front, el lápiz,
      // el botón de eliminar).
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
