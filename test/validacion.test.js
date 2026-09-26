import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarEntrada, validarCambiosParciales } from '../src/validacion.js';

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
