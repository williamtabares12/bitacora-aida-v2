/**
 * calculo.js — lógica pura del convenio AIDA.
 *
 * Sin dependencias de Firebase ni del DOM: recibe datos, devuelve números.
 * Esto es deliberado (ver spec, sección 7): permite probar la cascada de
 * descuentos con datos de ejemplo, sin navegador ni base de datos.
 *
 * Los parámetros del convenio (porcentajes, valores fijos) NO viven aquí
 * hardcodeados: se reciben como argumento `parametros`, porque en la v2
 * salen del documento configuracion/parametros en Firestore (ver spec,
 * sección 4). Esto es lo que permite que AIDA actualice una tarifa sin
 * tocar código.
 */

/**
 * @typedef {Object} ParametrosConvenio
 * @property {number} cuotaExtraordinaria  - ej. 0.05
 * @property {number} ibcPorc              - ej. 0.40
 * @property {number} salud                - ej. 0.125
 * @property {number} pension              - ej. 0.16
 * @property {number} arl                  - ej. 0.035 (estimado)
 * @property {number} sostenimiento        - valor fijo mensual, ej. 44000
 * @property {number} sucursal             - valor fijo mensual, ej. 2294
 * @property {number} provisiones          - ej. 0.2183
 */

/**
 * @typedef {Object} Entrada
 * @property {string} codigo
 * @property {number} valor
 * @property {string} fecha        - "YYYY-MM-DD"
 * @property {string} [comentario]
 */

/**
 * El peso colombiano no maneja centavos en la práctica, y JavaScript
 * arrastra errores de precisión de punto flotante en cada multiplicación
 * (0.035 * 3040000 da 106400.00000000001, no 106400 exacto). Redondear al
 * peso entero en cada paso evita que ese ruido se acumule mes a mes en
 * el acumulado, y es además lo correcto para mostrarle cifras a alguien:
 * nadie factura ni descuenta fracciones de peso.
 * @param {number} n
 */
function redondear(n) {
  return Math.round(n);
}

/**
 * Calcula el desglose completo del convenio para un conjunto de entradas
 * (normalmente, las de un mes).
 *
 * @param {Entrada[]} entradas
 * @param {ParametrosConvenio} parametros
 */
function calcularMes(entradas, parametros) {
  const totalFacturado = entradas.reduce((suma, e) => suma + e.valor, 0);

  const cuotaExtraordinaria = redondear(totalFacturado * parametros.cuotaExtraordinaria);
  const facturacionFinal = totalFacturado - cuotaExtraordinaria;

  const ibc = redondear(facturacionFinal * parametros.ibcPorc);
  const salud = redondear(ibc * parametros.salud);
  const pension = redondear(ibc * parametros.pension);
  const arl = redondear(ibc * parametros.arl);
  const seguridadSocial = salud + pension + arl;

  const huboFacturacion = totalFacturado > 0;
  const sostenimiento = huboFacturacion ? parametros.sostenimiento : 0;
  const sucursal = huboFacturacion ? parametros.sucursal : 0;

  const provisiones = redondear(facturacionFinal * parametros.provisiones);

  const totalPagoNeto =
    facturacionFinal - seguridadSocial - sostenimiento - sucursal - provisiones;
  const totalConProvisiones = totalPagoNeto + provisiones;

  return {
    totalFacturado,
    cuotaExtraordinaria,
    facturacionFinal,
    ibc,
    salud,
    pension,
    arl,
    seguridadSocial,
    sostenimiento,
    sucursal,
    provisiones,
    totalPagoNeto,
    totalConProvisiones,
    meses: huboFacturacion ? 1 : 0,
  };
}

/** Campos numéricos de un breakdown que tiene sentido sumar entre meses. */
const CAMPOS_BREAKDOWN = [
  'totalFacturado',
  'cuotaExtraordinaria',
  'facturacionFinal',
  'ibc',
  'salud',
  'pension',
  'arl',
  'seguridadSocial',
  'sostenimiento',
  'sucursal',
  'provisiones',
  'totalPagoNeto',
  'totalConProvisiones',
  'meses',
];

/**
 * Suma varios breakdowns mensuales (de calcularMes) en un acumulado.
 * @param {ReturnType<typeof calcularMes>[]} breakdowns
 */
function sumarBreakdowns(breakdowns) {
  const acumulado = Object.fromEntries(CAMPOS_BREAKDOWN.map((c) => [c, 0]));
  for (const b of breakdowns) {
    for (const campo of CAMPOS_BREAKDOWN) {
      acumulado[campo] += b[campo];
    }
  }
  return acumulado;
}

module.exports = { calcularMes, sumarBreakdowns, CAMPOS_BREAKDOWN, redondear };
