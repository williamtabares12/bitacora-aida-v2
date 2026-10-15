import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularMes, sumarBreakdowns } from '../src/calculo.js';

/**
 * Parámetros vigentes del convenio (spec, sección 12), los mismos que
 * usaba la v1. En producción estos vienen de configuracion/parametros
 * en Firestore, no de una constante — aquí se fijan a mano para que la
 * prueba sea determinista y no dependa de la base de datos.
 */
const PARAMETROS_VIGENTES = {
  coordinacion: 0.04,
  cuotaExtraordinaria: 0.05,
  ibcPorc: 0.40,
  salud: 0.125,
  pension: 0.16,
  arl: 0.035,
  sostenimiento: 44000,
  sucursal: 2294,
  provisiones: 0.2183,
};

/**
 * Regla vigente desde octubre de 2026: AIDA descuenta un 9% plano sobre el
 * total facturado (5% cuota extraordinaria + 4% coordinación, ambos sobre el
 * MISMO total). El 91% restante es la facturación final y de ahí sale el IBC.
 *
 * Ojo: la hoja oficial de AIDA que se usó antes para verificar (9.537.401 ->
 * TOTAL PAGO 5.639.660) calculaba la cuota sobre el subtotal ya sin
 * coordinación (91,2%). Con la regla nueva ese mismo monto da 5.627.192, así
 * que ya no coincide con esa hoja; el caso de regresión de acá abajo queda
 * fijado con la regla nueva.
 */
test('calcularMes: cascada completa con el 9% plano (9.537.401)', () => {
  const entradas = [{ codigo: 'EJEMPLO', valor: 9_537_401, fecha: '2026-01-01' }];

  const b = calcularMes(entradas, PARAMETROS_VIGENTES);

  assert.equal(b.totalFacturado, 9_537_401);
  assert.equal(b.coordinacion, 381_496);
  assert.equal(b.cuotaExtraordinaria, 476_870);
  assert.equal(b.facturacionFinal, 8_679_035);
  assert.equal(b.ibc, 3_471_614);
  assert.equal(b.sostenimiento, 44_000);
  assert.equal(b.sucursal, 2_294);
  assert.equal(b.provisiones, 1_894_633);
  assert.equal(b.totalPagoNeto, 5_627_192);
});

test('calcularMes: coordinación y cuota extraordinaria se calculan las dos sobre el total facturado (9% plano)', () => {
  const entradas = [{ codigo: 'EJEMPLO', valor: 8_000_000, fecha: '2026-01-01' }];
  const b = calcularMes(entradas, PARAMETROS_VIGENTES);

  assert.equal(b.coordinacion, 320_000);          // 4% del total facturado
  assert.equal(b.cuotaExtraordinaria, 400_000);   // 5% del total facturado, no de un subtotal
  assert.equal(b.facturacionFinal, 7_280_000);    // 91% del total
});

test('calcularMes: el IBC es el 40% de la facturación final (el 91%), no del total facturado', () => {
  const entradas = [{ codigo: 'EJEMPLO', valor: 8_000_000, fecha: '2026-01-01' }];
  const b = calcularMes(entradas, PARAMETROS_VIGENTES);

  assert.equal(b.ibc, 2_912_000);                  // 40% de 7.280.000
  assert.notEqual(b.ibc, 8_000_000 * 0.40);
});

test('calcularMes: desglose individual de salud, pensión y ARL sobre el IBC', () => {
  const entradas = [{ codigo: 'EJEMPLO', valor: 8_000_000, fecha: '2026-01-01' }];
  const b = calcularMes(entradas, PARAMETROS_VIGENTES);

  // IBC = 2.912.000 (40% del 91% del total facturado)
  assert.equal(b.salud, 364_000);   // 12,5%
  assert.equal(b.pension, 465_920); // 16%
  assert.equal(b.arl, 101_920);     // 3,5%
  assert.equal(b.salud + b.pension + b.arl, b.seguridadSocial);
});

test('calcularMes: mes sin ninguna entrada no cobra sostenimiento ni sucursal', () => {
  const b = calcularMes([], PARAMETROS_VIGENTES);

  assert.equal(b.totalFacturado, 0);
  assert.equal(b.sostenimiento, 0);
  assert.equal(b.sucursal, 0);
  assert.equal(b.totalPagoNeto, 0);
  assert.equal(b.meses, 0);
});

test('calcularMes: varios códigos en el mismo mes se suman antes de aplicar la cascada', () => {
  const entradas = [
    { codigo: 'T1', valor: 198_077, fecha: '2026-07-01' },
    { codigo: 'T3', valor: 334_620, fecha: '2026-07-02' },
    { codigo: 'VP', valor: 135_355, fecha: '2026-07-02' },
  ];
  const b = calcularMes(entradas, PARAMETROS_VIGENTES);

  assert.equal(b.totalFacturado, 198_077 + 334_620 + 135_355);
  assert.equal(b.meses, 1);
});

test('sumarBreakdowns: el acumulado de varios meses coincide con sumar sus totales', () => {
  const mesA = calcularMes(
    [{ codigo: 'T1', valor: 198_077, fecha: '2026-07-01' }],
    PARAMETROS_VIGENTES,
  );
  const mesB = calcularMes(
    [{ codigo: 'T3', valor: 334_620, fecha: '2026-08-01' }],
    PARAMETROS_VIGENTES,
  );

  const acumulado = sumarBreakdowns([mesA, mesB]);

  assert.equal(acumulado.totalFacturado, mesA.totalFacturado + mesB.totalFacturado);
  assert.equal(acumulado.totalPagoNeto, mesA.totalPagoNeto + mesB.totalPagoNeto);
  assert.equal(acumulado.meses, 2);
});

test('sumarBreakdowns: lista vacía da un acumulado en ceros, no un error', () => {
  const acumulado = sumarBreakdowns([]);
  assert.equal(acumulado.totalFacturado, 0);
  assert.equal(acumulado.meses, 0);
});

/* ============================================================
 * Invariantes: propiedades que TIENEN que cumplirse sin importar
 * el monto facturado. No dependen de conocer el resultado exacto
 * de antemano — si algún día alguien reordena la cascada o cambia
 * una fórmula sin querer, estas revientan solas.
 * ============================================================ */

test('calcularMes: invariante — facturación final + cuota extraordinaria + coordinación = total facturado', () => {
  for (const total of [0, 1, 100, 8_000_000, 5_950_228, 333_333, 999_999_999]) {
    const b = calcularMes(total > 0 ? [{ codigo: 'X', valor: total, fecha: '2026-01-01' }] : [], PARAMETROS_VIGENTES);
    assert.equal(b.facturacionFinal + b.cuotaExtraordinaria + b.coordinacion, b.totalFacturado, `total=${total}`);
  }
});

test('calcularMes: invariante — salud + pensión + ARL = seguridad social', () => {
  for (const total of [1, 198_077, 5_950_228, 333_333]) {
    const b = calcularMes([{ codigo: 'X', valor: total, fecha: '2026-01-01' }], PARAMETROS_VIGENTES);
    assert.equal(b.salud + b.pension + b.arl, b.seguridadSocial, `total=${total}`);
  }
});

test('calcularMes: invariante — la cascada completa cuadra con el pago neto (nada se pierde ni sobra)', () => {
  for (const total of [1, 198_077, 5_950_228, 333_333, 999_999_999]) {
    const b = calcularMes([{ codigo: 'X', valor: total, fecha: '2026-01-01' }], PARAMETROS_VIGENTES);
    assert.equal(
      b.totalPagoNeto + b.seguridadSocial + b.sostenimiento + b.sucursal + b.provisiones,
      b.facturacionFinal,
      `total=${total}`,
    );
  }
});

test('calcularMes: invariante — total con provisiones = pago neto + provisiones', () => {
  const b = calcularMes([{ codigo: 'X', valor: 5_950_228, fecha: '2026-01-01' }], PARAMETROS_VIGENTES);
  assert.equal(b.totalConProvisiones, b.totalPagoNeto + b.provisiones);
});

test('calcularMes: nunca deja centavos — todos los campos de plata son enteros, incluso con montos "feos"', () => {
  const montosFeos = [1, 3, 7, 33_333, 333_333, 1_234_567, 5_950_228, 999_999_999];
  const camposDePlata = [
    'totalFacturado', 'coordinacion', 'cuotaExtraordinaria', 'facturacionFinal', 'ibc',
    'salud', 'pension', 'arl', 'seguridadSocial', 'sostenimiento', 'sucursal',
    'provisiones', 'totalPagoNeto', 'totalConProvisiones',
  ];
  for (const total of montosFeos) {
    const b = calcularMes([{ codigo: 'X', valor: total, fecha: '2026-01-01' }], PARAMETROS_VIGENTES);
    for (const campo of camposDePlata) {
      assert.ok(Number.isInteger(b[campo]), `${campo} no es entero para total=${total} (dio ${b[campo]})`);
    }
  }
});

test('calcularMes: el orden de las entradas no cambia el total facturado', () => {
  const entradas = [
    { codigo: 'T1', valor: 198_077, fecha: '2026-09-01' },
    { codigo: 'T3', valor: 334_620, fecha: '2026-09-03' },
    { codigo: 'Revis', valor: 502_616, fecha: '2026-09-09' },
  ];
  const enOrden = calcularMes(entradas, PARAMETROS_VIGENTES);
  const alReves = calcularMes([...entradas].reverse(), PARAMETROS_VIGENTES);
  assert.equal(enOrden.totalFacturado, alReves.totalFacturado);
  assert.equal(enOrden.totalPagoNeto, alReves.totalPagoNeto);
});

/* ============================================================
 * Simulación con datos reales: las 25 entradas de septiembre de
 * Ana (el mismo archivo que se usó para la Fase 7), contra los
 * parámetros vigentes del convenio — ya con la coordinación del 4%
 * incluida (confirmado que a Ana sí le aplica, ver conversación).
 * El número queda fijado acá como caso de regresión, pero lo que
 * de verdad lo valida es compararlo contra la colilla de pago real
 * de ese mes, que recién llega en noviembre.
 * ============================================================ */

test('calcularMes: septiembre real de Ana (25 entradas) da el desglose esperado', () => {
  const entradasSeptiembre = [
    { codigo: 'T1', valor: 198_077, fecha: '2026-09-01' },
    { codigo: 'VP', valor: 135_355, fecha: '2026-09-01' },
    { codigo: 'T1', valor: 198_077, fecha: '2026-09-01' },
    { codigo: 'T2', valor: 264_059, fecha: '2026-09-01' },
    { codigo: 'T3', valor: 334_620, fecha: '2026-09-03' },
    { codigo: 'VP', valor: 135_355, fecha: '2026-09-03' },
    { codigo: 'T3', valor: 334_620, fecha: '2026-09-03' },
    { codigo: 'Sin', valor: 122_728, fecha: '2026-09-03' },
    { codigo: 'Canc', valor: 76_937, fecha: '2026-09-03' },
    { codigo: 'T3', valor: 334_620, fecha: '2026-09-03' },
    { codigo: 'T2', valor: 264_059, fecha: '2026-09-07' },
    { codigo: 'VP', valor: 135_355, fecha: '2026-09-07' },
    { codigo: 'T1', valor: 198_077, fecha: '2026-09-07' },
    { codigo: 'T3', valor: 334_620, fecha: '2026-09-09' },
    { codigo: 'VP', valor: 135_355, fecha: '2026-09-09' },
    { codigo: 'Revis', valor: 502_616, fecha: '2026-09-09' },
    { codigo: 'T2', valor: 264_059, fecha: '2026-09-09' },
    { codigo: 'T3', valor: 334_620, fecha: '2026-09-10' },
    { codigo: 'VP', valor: 135_355, fecha: '2026-09-10' },
    { codigo: 'T2', valor: 264_059, fecha: '2026-09-10' },
    { codigo: 'T3', valor: 334_620, fecha: '2026-09-13' },
    { codigo: 'Canc', valor: 76_937, fecha: '2026-09-13' },
    { codigo: 'T1', valor: 198_077, fecha: '2026-09-14' },
    { codigo: 'Revis', valor: 502_616, fecha: '2026-09-15' },
    { codigo: 'VP', valor: 135_355, fecha: '2026-09-15' },
  ];

  const b = calcularMes(entradasSeptiembre, PARAMETROS_VIGENTES);

  assert.equal(b.totalFacturado, 5_950_228);
  assert.equal(b.coordinacion, 238_009);
  assert.equal(b.cuotaExtraordinaria, 297_511);
  assert.equal(b.facturacionFinal, 5_414_708);
  assert.equal(b.ibc, 2_165_883);
  assert.equal(b.salud, 270_735);
  assert.equal(b.pension, 346_541);
  assert.equal(b.arl, 75_806);
  assert.equal(b.seguridadSocial, 693_082);
  assert.equal(b.sostenimiento, 44_000);
  assert.equal(b.sucursal, 2_294);
  assert.equal(b.provisiones, 1_182_031);
  assert.equal(b.totalPagoNeto, 3_493_301);
  assert.equal(b.totalConProvisiones, 4_675_332);
});
