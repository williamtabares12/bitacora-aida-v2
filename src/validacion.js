/**
 * validacion.js — reglas de validación de una entrada de facturación, a
 * nivel de datos (¿es un string de fecha con el formato correcto?, ¿es un
 * número mayor que cero?), no de negocio (eso vive en calculo.js). Sin
 * dependencias de Firebase ni del DOM, para poder probarla con node:test
 * igual que calculo.js y fechas.js (spec, sección 7).
 */

const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** @param {unknown} codigo */
function validarCodigo(codigo) {
  return typeof codigo === "string" && codigo.trim() ? null : "Falta el código de facturación.";
}

/** @param {unknown} valor */
function validarValor(valor) {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0
    ? null
    : "El valor debe ser un número mayor que cero.";
}

/** @param {unknown} fecha */
function validarFecha(fecha) {
  return typeof fecha === "string" && REGEX_FECHA.test(fecha)
    ? null
    : 'La fecha debe tener formato "YYYY-MM-DD".';
}

/**
 * Valida una entrada completa (para crearEntrada). Devuelve el primer
 * mensaje de error encontrado, o null si todo está bien.
 * @param {{codigo?: unknown, valor?: unknown, fecha?: unknown}} entrada
 */
function validarEntrada({ codigo, valor, fecha } = {}) {
  return validarCodigo(codigo) || validarValor(valor) || validarFecha(fecha) || null;
}

/**
 * Valida un merge parcial (para editarEntrada): solo revisa los campos que
 * efectivamente vienen en `cambios`, para no rechazar una edición que solo
 * toca `comentario` por no traer también codigo/valor/fecha.
 * @param {{codigo?: unknown, valor?: unknown, fecha?: unknown, comentario?: unknown}} cambios
 */
function validarCambiosParciales(cambios = {}) {
  if (Object.keys(cambios).length === 0) return "No hay ningún cambio para guardar.";
  if ("codigo" in cambios) {
    const error = validarCodigo(cambios.codigo);
    if (error) return error;
  }
  if ("valor" in cambios) {
    const error = validarValor(cambios.valor);
    if (error) return error;
  }
  if ("fecha" in cambios) {
    const error = validarFecha(cambios.fecha);
    if (error) return error;
  }
  return null;
}

export { validarEntrada, validarCambiosParciales, validarCodigo, validarValor, validarFecha };
