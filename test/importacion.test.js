import test from "node:test";
import assert from "node:assert/strict";
import { prepararImportacion, validarArchivoImportacion } from "../src/importacion.js";

const ARCHIVO_VALIDO = {
  nombre: "Ana",
  entradas: [
    { id: "e1", codigo: "Consu", valor: 153171, fecha: "2026-01-05", comentario: "" },
    { id: "e2", codigo: "T1", valor: 198077, fecha: "2026-01-10", comentario: "turno tarde" },
  ],
};

test("validarArchivoImportacion: rechaza null, arreglos y objetos sin entradas", () => {
  assert.ok(validarArchivoImportacion(null));
  assert.ok(validarArchivoImportacion([]));
  assert.ok(validarArchivoImportacion({ nombre: "Ana" }));
  assert.ok(validarArchivoImportacion({ entradas: "no es un arreglo" }));
});

test("validarArchivoImportacion: acepta el formato de la v1", () => {
  assert.equal(validarArchivoImportacion(ARCHIVO_VALIDO), null);
});

test("prepararImportacion: archivo con forma inválida devuelve ok:false", () => {
  const resultado = prepararImportacion({ entradas: "no es un arreglo" }, []);
  assert.equal(resultado.ok, false);
  assert.ok(resultado.error);
});

test("prepararImportacion: importa todo cuando no hay nada existente", () => {
  const resultado = prepararImportacion(ARCHIVO_VALIDO, []);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.aInsertar.length, 2);
  assert.equal(resultado.invalidas, 0);
  assert.equal(resultado.duplicadas, 0);
  // el id de la v1 se guarda como origenImportacionId, no como "id" —
  // Firestore genera el suyo propio al crear el documento.
  assert.equal(resultado.aInsertar[0].origenImportacionId, "e1");
});

test("prepararImportacion: no reimporta una entrada cuyo id de la v1 ya se importó antes", () => {
  const existentes = [{ codigo: "Consu", valor: 153171, fecha: "2026-01-05", origenImportacionId: "e1" }];
  const resultado = prepararImportacion(ARCHIVO_VALIDO, existentes);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.aInsertar.length, 1);
  assert.equal(resultado.aInsertar[0].codigo, "T1");
  assert.equal(resultado.duplicadas, 1);
});

test("prepararImportacion: importar el mismo archivo dos veces seguidas no duplica nada", () => {
  const primera = prepararImportacion(ARCHIVO_VALIDO, []);
  assert.equal(primera.aInsertar.length, 2);

  // simulamos que esas 2 entradas ya quedaron en Firestore (con su
  // origenImportacionId puesto, como haría db.js#importarEntradas)
  const segunda = prepararImportacion(ARCHIVO_VALIDO, primera.aInsertar);
  assert.equal(segunda.aInsertar.length, 0);
  assert.equal(segunda.duplicadas, 2);
});

test("prepararImportacion: el mismo código y valor repetido el mismo día (id distinto) NO se trata como duplicado", () => {
  // Caso real encontrado en el archivo de Ana: el mismo procedimiento
  // puede repetirse más de una vez el mismo día. Deduplicar por
  // fecha+código+valor (en vez de por id) perdería estas entradas.
  const archivoConRepeticionLegitima = {
    nombre: "Ana",
    entradas: [
      { id: "import-92", codigo: "T3", valor: 334620, fecha: "2026-09-03" },
      { id: "import-94", codigo: "T3", valor: 334620, fecha: "2026-09-03" },
      { id: "import-97", codigo: "T3", valor: 334620, fecha: "2026-09-03" },
    ],
  };
  const resultado = prepararImportacion(archivoConRepeticionLegitima, []);
  assert.equal(resultado.aInsertar.length, 3);
  assert.equal(resultado.duplicadas, 0);
});

test("prepararImportacion: descarta entradas repetidas dentro del propio archivo (mismo id dos veces)", () => {
  const archivoConIdRepetido = {
    nombre: "Ana",
    entradas: [
      { id: "e1", codigo: "Consu", valor: 153171, fecha: "2026-01-05" },
      { id: "e1", codigo: "Consu", valor: 153171, fecha: "2026-01-05" }, // mismo id, archivo corrupto/duplicado
    ],
  };
  const resultado = prepararImportacion(archivoConIdRepetido, []);
  assert.equal(resultado.aInsertar.length, 1);
  assert.equal(resultado.duplicadas, 1);
});

test("prepararImportacion: sin id (export viejo), cae de vuelta a deduplicar por fecha+código+valor", () => {
  const archivoSinId = {
    nombre: "Ana",
    entradas: [
      { codigo: "Consu", valor: 153171, fecha: "2026-01-05" },
      { codigo: "Consu", valor: 153171, fecha: "2026-01-05" },
    ],
  };
  const resultado = prepararImportacion(archivoSinId, []);
  assert.equal(resultado.aInsertar.length, 1);
  assert.equal(resultado.duplicadas, 1);
});

test("prepararImportacion: descarta entradas sin código, valor o fecha válidos", () => {
  const archivoConBasura = {
    nombre: "Ana",
    entradas: [
      { id: "e1", codigo: "", valor: 100, fecha: "2026-01-05" },
      { id: "e2", codigo: "Consu", valor: -5, fecha: "2026-01-05" },
      { id: "e3", codigo: "Consu", valor: 100, fecha: "05/01/2026" },
      null,
      { id: "e4", codigo: "Consu", valor: 100, fecha: "2026-01-06" },
    ],
  };
  const resultado = prepararImportacion(archivoConBasura, []);
  assert.equal(resultado.aInsertar.length, 1);
  assert.equal(resultado.invalidas, 4);
});

test("prepararImportacion: convierte valor string numérico (por si el json lo trae así)", () => {
  const archivo = { nombre: "Ana", entradas: [{ id: "e1", codigo: "Consu", valor: "153171", fecha: "2026-01-05" }] };
  const resultado = prepararImportacion(archivo, []);
  assert.equal(resultado.aInsertar.length, 1);
  assert.equal(resultado.aInsertar[0].valor, 153171);
});
