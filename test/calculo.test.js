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
  cuotaExtraordinaria: 0.05,
  ibcPorc: 0.40,
  salud: 0.125,
  pension: 0.16,
  arl: 0.035,
  sostenimiento: 44000,
  sucursal: 2294,
  provisiones: 0.2183,
};

test('calcularMes: cascada completa contra el ejemplo verificado con AIDA (8.000.000)', () => {
  const entradas = [{ codigo: 'EJEMPLO', valor: 8_000_000, fecha: '2026-01-01' }];

  const b = calcularMes(entradas, PARAMETROS_VIGENTES);

  assert.equal(b.totalFacturado, 8_000_000);
  assert.equal(b.cuotaExtraordinaria, 400_000);
  assert.equal(b.facturacionFinal, 7_600_000);
  assert.equal(b.ibc, 3_040_000);
  assert.equal(b.seguridadSocial, 972_800);
  assert.equal(b.provisiones, 1_659_080);
  assert.equal(b.totalPagoNeto, 4_921_826);
  assert.equal(b.totalConProvisiones, 6_580_906);
});

test('calcularMes: desglose individual de salud, pensión y ARL sobre el IBC', () => {
  const entradas = [{ codigo: 'EJEMPLO', valor: 8_000_000, fecha: '2026-01-01' }];
  const b = calcularMes(entradas, PARAMETROS_VIGENTES);

  // IBC = 3.040.000
  assert.equal(b.salud, 380_000);   // 12,5%
  assert.equal(b.pension, 486_400); // 16%
  assert.equal(b.arl, 106_400);     // 3,5%
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

test('calcularMes: invariante — facturación final + cuota extraordinaria = total facturado', () => {
  for (const total of [0, 1, 100, 8_000_000, 5_950_228, 333_333, 999_999_999]) {
    const b = calcularMes(total > 0 ? [{ codigo: 'X', valor: total, fecha: '2026-01-01' }] : [], PARAMETROS_VIGENTES);
    assert.equal(b.facturacionFinal + b.cuotaExtraordinaria, b.totalFacturado, `total=${total}`);
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
    'totalFacturado', 'cuotaExtraordinaria', 'facturacionFinal', 'ibc',
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
 * parámetros vigentes del convenio. El número queda fijado acá
 * como caso de regresión, pero lo que de verdad lo valida es que
 * Ana lo compare contra su colilla de pago real de ese mes — ver
 * conversación.
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
  assert.equal(b.cuotaExtraordinaria, 297_511);
  assert.equal(b.facturacionFinal, 5_652_717);
  assert.equal(b.ibc, 2_261_087);
  assert.equal(b.salud, 282_636);
  assert.equal(b.pension, 361_774);
  assert.equal(b.arl, 79_138);
  assert.equal(b.seguridadSocial, 723_548);
  assert.equal(b.sostenimiento, 44_000);
  assert.equal(b.sucursal, 2_294);
  assert.equal(b.provisiones, 1_233_988);
  assert.equal(b.totalPagoNeto, 3_648_887);
  assert.equal(b.totalConProvisiones, 4_882_875);
});
