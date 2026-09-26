import test from "node:test";
import assert from "node:assert/strict";
import { construirRespaldoJSON, construirFilasExcel, nombreArchivoRespaldo } from "../src/exportacion.js";

const ENTRADAS = [
  { id: "b", codigo: "T1", valor: 198077, fecha: "2026-09-10", comentario: "" },
  { id: "a", codigo: "Consu", valor: 153171, fecha: "2026-09-01", comentario: "turno tarde" },
];

test("construirRespaldoJSON: ordena por fecha ascendente", () => {
  const resultado = construirRespaldoJSON("Ana", ENTRADAS);
  assert.equal(resultado.entradas[0].fecha, "2026-09-01");
  assert.equal(resultado.entradas[1].fecha, "2026-09-10");
});

test("construirRespaldoJSON: conserva nombre, id y comentario vacío como string", () => {
  const resultado = construirRespaldoJSON("Ana", ENTRADAS);
  assert.equal(resultado.nombre, "Ana");
  assert.equal(resultado.entradas[0].id, "a");
  assert.equal(resultado.entradas[1].comentario, "");
});

test("construirRespaldoJSON: nombre null si no hay nombre", () => {
  const resultado = construirRespaldoJSON(null, []);
  assert.equal(resultado.nombre, null);
  assert.deepEqual(resultado.entradas, []);
});

test("construirFilasExcel: ordena por fecha y usa el valor como número", () => {
  const filas = construirFilasExcel(ENTRADAS);
  assert.equal(filas[0].Fecha, "2026-09-01");
  assert.equal(typeof filas[0].Valor, "number");
  assert.equal(filas[1].Codigo, "T1");
});

test("nombreArchivoRespaldo: sanea espacios y tildes en el nombre", () => {
  const nombre = nombreArchivoRespaldo("Ana María", "json", "2026-09-26");
  assert.equal(nombre, "bitacora-aida-ana-maria-2026-09-26.json");
});

test("nombreArchivoRespaldo: usa 'respaldo' si no hay nombre", () => {
  const nombre = nombreArchivoRespaldo(null, "xlsx", "2026-09-26");
  assert.equal(nombre, "bitacora-aida-respaldo-2026-09-26.xlsx");
});

test("nombreArchivoRespaldo: quita símbolos que no sirven en un nombre de archivo", () => {
  const nombre = nombreArchivoRespaldo("ana@x.com", "json", "2026-09-26");
  assert.equal(nombre, "bitacora-aida-ana-x-com-2026-09-26.json");
});
