/**
 * fechas.js — utilidades puras sobre fechas en formato "YYYY-MM-DD" /
 * "YYYY-MM". Sin dependencias de Firebase ni del DOM, para poder probarlas
 * con node:test igual que calculo.js (ver spec, sección 7).
 */

/**
 * Dado un mes en formato "YYYY-MM", devuelve el rango [inicio, finExclusivo)
 * en formato "YYYY-MM-DD" que cubre exactamente ese mes. Sirve para construir
 * queries de rango sobre el campo `fecha` (string) en Firestore:
 * where('fecha', '>=', inicio) && where('fecha', '<', finExclusivo).
 *
 * La comparación de strings ISO ("2026-07-31" < "2026-08-01") coincide con
 * el orden cronológico, así que Firestore puede filtrar por rango sin que
 * `fecha` sea un Timestamp — sólo hace falta calcular bien cuál es el
 * primer día del mes siguiente, incluyendo el caso de fin de año.
 *
 * @param {string} mes - "YYYY-MM", ej. "2026-07"
 * @returns {{ inicio: string, finExclusivo: string }}
 */
function rangoDelMes(mes) {
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    throw new Error(`Formato de mes inválido: "${mes}" (se espera "YYYY-MM")`);
  }
  const [anio, mesNum] = mes.split("-").map(Number);
  if (mesNum < 1 || mesNum > 12) {
    throw new Error(`Mes fuera de rango en "${mes}": debe ser 01-12`);
  }

  const inicio = `${mes}-01`;

  // Date.UTC normaliza el desborde: pasarle el mes 12 (0-indexado) para un
  // "mes" de diciembre (mesNum = 12) da automáticamente el 1 de enero del
  // año siguiente, sin tener que escribir el caso especial a mano.
  const siguiente = new Date(Date.UTC(anio, mesNum, 1));
  const anioSig = siguiente.getUTCFullYear();
  const mesSig = String(siguiente.getUTCMonth() + 1).padStart(2, "0");
  const finExclusivo = `${anioSig}-${mesSig}-01`;

  return { inicio, finExclusivo };
}

export { rangoDelMes };
