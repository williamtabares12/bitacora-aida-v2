/**
 * importacion.js — lógica pura para migrar el respaldo .json de la v1
 * (spec, sección 8). Sin Firebase ni DOM: solo valida el archivo y decide
 * qué entradas hay que insertar, dejando el propio insertar (Firestore) a
 * db.js. Separado así para poder probar la deduplicación con node:test sin
 * necesitar Firestore ni un navegador.
 *
 * Formato esperado del archivo (el que genera el botón "Exportar
 * respaldo (.json)" de la v1): { nombre: string|null, entradas: [...] }.
 * Cada entrada de la v1 trae { id, codigo, valor, fecha, comentario }.
 *
 * Deduplicación — corrección sobre lo que decía la sección 8 de la spec:
 * ahí se proponía deduplicar por fecha+código+valor, asumiendo que el "id"
 * de la v1 no serviría de nada porque no coincide con los ids que genera
 * Firestore. Pero un archivo real de Ana (septiembre 2026) mostró el
 * problema: es normal que el mismo código se repita el mismo día (el
 * mismo procedimiento más de una vez en la jornada) — con esa regla, la
 * segunda y tercera repetición se habrían descartado como si ya
 * existieran, perdiendo entradas reales.
 *
 * Por eso acá se guarda el "id" de la v1 como un campo aparte
 * (origenImportacionId) en la entrada que se escribe en Firestore, y ESE
 * es el que se usa para deduplicar — no para que coincida con el id de
 * Firestore (Firestore sigue generando el suyo propio), sino como huella
 * de "esta entrada ya se importó". Si dos entradas del archivo tienen
 * fecha y código y valor iguales pero id distinto, son dos entradas
 * reales y las dos se importan. Si el archivo no trae "id" (un export muy
 * viejo), se cae de vuelta a comparar por fecha+código+valor, que es lo
 * único disponible en ese caso.
 */

import { validarCodigo, validarValor, validarFecha } from "./validacion.js";

/** Clave de deduplicación: por id de la v1 si está disponible, si no por contenido. */
function claveDeduplicacion(entrada) {
  if (entrada.origenImportacionId) return `id:${entrada.origenImportacionId}`;
  return `contenido:${entrada.fecha}|${entrada.codigo}|${entrada.valor}`;
}

/**
 * @param {unknown} datos - el .json ya parseado
 * @returns {string|null} mensaje de error, o null si la forma es válida
 */
function validarArchivoImportacion(datos) {
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
    return "El archivo no tiene el formato esperado (se esperaba un objeto con nombre y entradas).";
  }
  if (!Array.isArray(datos.entradas)) {
    return 'El archivo no tiene una lista de "entradas".';
  }
  return null;
}

/**
 * Decide qué entradas del archivo hay que insertar en Firestore: descarta
 * las que no tienen forma de entrada válida, y las que ya existen (por
 * id de la v1, o por fecha+código+valor si no hay id) en
 * `entradasExistentes` o repetidas dentro del mismo archivo.
 *
 * @param {unknown} datos - el .json ya parseado (formato v1)
 * @param {Array<{codigo: string, valor: number, fecha: string, origenImportacionId?: string}>} entradasExistentes - lo que la usuaria ya tiene en Firestore
 * @returns {{ ok: true, aInsertar: Array<{codigo: string, valor: number, fecha: string, comentario: string, origenImportacionId?: string}>, invalidas: number, duplicadas: number } | { ok: false, error: string }}
 */
function prepararImportacion(datos, entradasExistentes = []) {
  const errorForma = validarArchivoImportacion(datos);
  if (errorForma) return { ok: false, error: errorForma };

  const clavesExistentes = new Set(entradasExistentes.map(claveDeduplicacion));
  const aInsertar = [];
  let invalidas = 0;
  let duplicadas = 0;

  for (const cruda of datos.entradas) {
    if (!cruda || typeof cruda !== "object") {
      invalidas++;
      continue;
    }
    const codigo = cruda.codigo;
    const valor = typeof cruda.valor === "number" ? cruda.valor : Number(cruda.valor);
    const fecha = cruda.fecha;

    if (validarCodigo(codigo) || validarValor(valor) || validarFecha(fecha)) {
      invalidas++;
      continue;
    }

    const origenImportacionId = typeof cruda.id === "string" && cruda.id ? cruda.id : null;
    const entrada = {
      codigo: codigo.trim(),
      valor,
      fecha,
      comentario: typeof cruda.comentario === "string" ? cruda.comentario.trim() : "",
      ...(origenImportacionId ? { origenImportacionId } : {}),
    };
    const clave = claveDeduplicacion(entrada);
    if (clavesExistentes.has(clave)) {
      duplicadas++;
      continue;
    }

    clavesExistentes.add(clave); // también deduplica dentro del propio archivo
    aInsertar.push(entrada);
  }

  return { ok: true, aInsertar, invalidas, duplicadas };
}

export { prepararImportacion, validarArchivoImportacion, claveDeduplicacion };
