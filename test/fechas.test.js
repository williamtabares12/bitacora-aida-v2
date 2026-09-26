import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangoDelMes } from '../src/fechas.js';

test('rangoDelMes: mes normal (julio) da el primer día de agosto como fin exclusivo', () => {
  const { inicio, finExclusivo } = rangoDelMes('2026-07');
  assert.equal(inicio, '2026-07-01');
  assert.equal(finExclusivo, '2026-08-01');
});

test('rangoDelMes: enero no se desborda hacia atrás', () => {
  const { inicio, finExclusivo } = rangoDelMes('2026-01');
  assert.equal(inicio, '2026-01-01');
  assert.equal(finExclusivo, '2026-02-01');
});

test('rangoDelMes: diciembre pasa correctamente al 1 de enero del año siguiente', () => {
  const { inicio, finExclusivo } = rangoDelMes('2026-12');
  assert.equal(inicio, '2026-12-01');
  assert.equal(finExclusivo, '2027-01-01');
});

test('rangoDelMes: una fecha dentro del mes cae en el rango, una del mes siguiente no', () => {
  const { inicio, finExclusivo } = rangoDelMes('2026-07');
  const dentro = '2026-07-15';
  const bordeInicio = '2026-07-01';
  const bordeFin = '2026-08-01';

  assert.ok(dentro >= inicio && dentro < finExclusivo);
  assert.ok(bordeInicio >= inicio && bordeInicio < finExclusivo);
  assert.ok(!(bordeFin >= inicio && bordeFin < finExclusivo));
});

test('rangoDelMes: rechaza formatos inválidos', () => {
  assert.throws(() => rangoDelMes('2026-7'));
  assert.throws(() => rangoDelMes('26-07'));
  assert.throws(() => rangoDelMes('2026-13'));
  assert.throws(() => rangoDelMes('2026-00'));
  assert.throws(() => rangoDelMes('julio 2026'));
});
