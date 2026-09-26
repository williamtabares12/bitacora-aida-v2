/**
 * exportacion.js — arma los datos del respaldo (.json y Excel) a partir de
 * las entradas que ya están en memoria (ui.js las trae de Firestore). Sin
 * DOM ni librerías externas: solo construye las estructuras de datos, para
 * poder probarlas con node:test. Quien llama (ui.js) decide cómo
 * convertirlas en un archivo descargable — ver dom-utils.js#descargarArchivo
 * y la generación del Excel con ExcelJS.
 */

/**
 * Mismo formato que generaba el botón "Exportar respaldo (.json)" de la
 * v1 — así un archivo exportado desde v2 se puede volver a importar en
 * cualquiera de las dos (o revisar a simple vista) sin sorpresas.
 * @param {string|null} nombre
 * @param {Array<{id?: string, codigo: string, valor: number, fecha: string, comentario?: string}>} entradas
 */
function construirRespaldoJSON(nombre, entradas) {
  return {
    nombre: nombre || null,
    entradas: [...entradas]
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .map((e) => ({
        id: e.id,
        codigo: e.codigo,
        valor: e.valor,
        fecha: e.fecha,
        comentario: e.comentario || "",
      })),
  };
}

/**
 * Filas listas para volcar en una hoja de cálculo: una fila por entrada,
 * ordenadas por fecha, con el valor como número (no como texto con "$")
 * para que Excel lo trate como una cifra de verdad.
 * @param {Array<{codigo: string, valor: number, fecha: string, comentario?: string}>} entradas
 */
function construirFilasExcel(entradas) {
  return [...entradas]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map((e) => ({
      Fecha: e.fecha,
      Codigo: e.codigo,
      Valor: e.valor,
      Comentario: e.comentario || "",
    }));
}

/**
 * Nombre de archivo del respaldo, igual de espíritu al de la v1
 * (`bitacora-aida-<nombre>-<fecha>.json`), saneando el nombre de la
 * usuaria para que sirva como nombre de archivo en cualquier sistema
 * operativo (sin espacios, tildes ni símbolos raros).
 * @param {string|null} nombre
 * @param {string} extension - "json" | "xlsx"
 * @param {string} fechaISO - "YYYY-MM-DD"
 */
function nombreArchivoRespaldo(nombre, extension, fechaISO) {
  const base = (nombre || "respaldo")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // quita tildes
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `bitacora-aida-${base || "respaldo"}-${fechaISO}.${extension}`;
}

export { construirRespaldoJSON, construirFilasExcel, nombreArchivoRespaldo };
