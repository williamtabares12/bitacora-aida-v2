import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarEntrada, validarCambiosParciales, validarParametros } from '../src/validacion.js';

const PARAMETROS_VALIDOS = {
  codigos: {
    Consu: 153171, T1: 198077, T2: 264059, T3: 334620, Sin: 122728,
    Revis: 502616, Canc: 76937, VP: 135355, 'URG AM': 64122, 'URG pm': 192366, Txp: 87526,
  },
  cuotaExtraordinaria: 0.05,
  ibcPorc: 0.40,
  salud: 0.125,
  pension: 0.16,
  arl: 0.035,
  sostenimiento: 44000,
  sucursal: 2294,
  provisiones: 0.2183,
};

test('validarEntrada: una entrada completa y correcta no da error', () => {
  const error = validarEntrada({ codigo: 'T1', valor: 198077, fecha: '2026-07-15' });
  assert.equal(error, null);
});

test('validarEntrada: rechaza código vacío o ausente', () => {
  assert.ok(validarEntrada({ codigo: '', valor: 1000, fecha: '2026-07-15' }));
  assert.ok(validarEntrada({ valor: 1000, fecha: '2026-07-15' }));
  assert.ok(validarEntrada({ codigo: '   ', valor: 1000, fecha: '2026-07-15' }));
});

test('validarEntrada: rechaza valor cero, negativo, no numérico o ausente', () => {
  assert.ok(validarEntrada({ codigo: 'T1', valor: 0, fecha: '2026-07-15' }));
  assert.ok(validarEntrada({ codigo: 'T1', valor: -500, fecha: '2026-07-15' }));
  assert.ok(validarEntrada({ codigo: 'T1', valor: '198077', fecha: '2026-07-15' }));
  assert.ok(validarEntrada({ codigo: 'T1', fecha: '2026-07-15' }));
  assert.ok(validarEntrada({ codigo: 'T1', valor: NaN, fecha: '2026-07-15' }));
});

test('validarEntrada: rechaza fechas con formato incorrecto o ausentes', () => {
  assert.ok(validarEntrada({ codigo: 'T1', valor: 1000, fecha: '15/07/2026' }));
  assert.ok(validarEntrada({ codigo: 'T1', valor: 1000, fecha: '2026-7-15' }));
  assert.ok(validarEntrada({ codigo: 'T1', valor: 1000 }));
});

test('validarCambiosParciales: un merge que solo trae comentario es válido', () => {
  const error = validarCambiosParciales({ comentario: 'turno de la tarde' });
  assert.equal(error, null);
});

test('validarCambiosParciales: valida solo los campos presentes, no exige los demás', () => {
  assert.equal(validarCambiosParciales({ valor: 250000 }), null);
  assert.equal(validarCambiosParciales({ fecha: '2026-08-01' }), null);
  assert.ok(validarCambiosParciales({ valor: -10 }));
  assert.ok(validarCambiosParciales({ fecha: 'no-es-fecha' }));
});

test('validarCambiosParciales: un objeto de cambios vacío se rechaza (no hay nada que guardar)', () => {
  assert.ok(validarCambiosParciales({}));
});

test('validarParametros: el documento completo y correcto no da error', () => {
  assert.equal(validarParametros(PARAMETROS_VALIDOS), null);
});

test('validarParametros: rechaza ausencia, null o algo que no es un objeto', () => {
  assert.ok(validarParametros(undefined));
  assert.ok(validarParametros(null));
  assert.ok(validarParametros('no es un documento'));
  assert.ok(validarParametros([1, 2, 3]));
});

test('validarParametros: rechaza tabla de códigos ausente, vacía o mal tipada', () => {
  const { codigos, ...sinCodigos } = PARAMETROS_VALIDOS;
  assert.ok(validarParametros(sinCodigos));
  assert.ok(validarParametros({ ...PARAMETROS_VALIDOS, codigos: {} }));
  assert.ok(validarParametros({ ...PARAMETROS_VALIDOS, codigos: [1, 2] }));
});

test('validarParametros: rechaza un código individual con valor inválido', () => {
  assert.ok(validarParametros({ ...PARAMETROS_VALIDOS, codigos: { ...PARAMETROS_VALIDOS.codigos, T1: -5 } }));
  assert.ok(validarParametros({ ...PARAMETROS_VALIDOS, codigos: { ...PARAMETROS_VALIDOS.codigos, T1: '198077' } }));
  assert.ok(validarParametros({ ...PARAMETROS_VALIDOS, codigos: { ...PARAMETROS_VALIDOS.codigos, T1: 0 } }));
});

test('validarParametros: rechaza si falta cualquiera de los porcentajes/valores fijos', () => {
  for (const campo of ['cuotaExtraordinaria', 'ibcPorc', 'salud', 'pension', 'arl', 'sostenimiento', 'sucursal', 'provisiones']) {
    const { [campo]: _omitido, ...incompleto } = PARAMETROS_VALIDOS;
    assert.ok(validarParametros(incompleto), `debería rechazar sin "${campo}"`);
  }
});
