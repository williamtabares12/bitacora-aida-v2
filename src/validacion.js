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

/**
 * Campos numéricos obligatorios de configuracion/parametros, además de
 * `codigos` (spec, sección 4). Se valida esto al leer el documento desde
 * Firestore para fallar con un mensaje claro si Alejandro tipeó algo mal
 * en la consola, en vez de que la app se rompa de forma confusa más tarde
 * en la cascada de calculo.js.
 */
const CAMPOS_NUMERICOS_PARAMETROS = [
  "coordinacion",
  "cuotaExtraordinaria",
  "ibcPorc",
  "salud",
  "pension",
  "arl",
  "sostenimiento",
  "sucursal",
  "provisiones",
];

/**
 * Valida el documento configuracion/parametros completo (para
 * db.js#leerConfiguracion). Devuelve el primer mensaje de error
 * encontrado, o null si el documento está completo y bien formado.
 * @param {unknown} parametros
 */
function validarParametros(parametros) {
  if (!parametros || typeof parametros !== "object" || Array.isArray(parametros)) {
    return 'El documento "configuracion/parametros" no existe o no es válido.';
  }

  const { codigos } = parametros;
  if (!codigos || typeof codigos !== "object" || Array.isArray(codigos) || Object.keys(codigos).length === 0) {
    return 'Falta la tabla de códigos ("codigos") en configuracion/parametros, o está vacía.';
  }
  for (const [codigo, valor] of Object.entries(codigos)) {
    if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
      return `El código "${codigo}" en configuracion/parametros tiene un valor inválido.`;
    }
  }

  for (const campo of CAMPOS_NUMERICOS_PARAMETROS) {
    if (typeof parametros[campo] !== "number" || !Number.isFinite(parametros[campo])) {
      return `Falta o es inválido el parámetro "${campo}" en configuracion/parametros.`;
    }
  }

  return null;
}

export {
  validarEntrada,
  validarCambiosParciales,
  validarCodigo,
  validarValor,
  validarFecha,
  validarParametros,
  CAMPOS_NUMERICOS_PARAMETROS,
};
