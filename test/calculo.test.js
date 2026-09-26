const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularMes, sumarBreakdowns } = require('../src/calculo.js');

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
