// db.js — todas las lecturas/escrituras a Firestore para las entradas de
// facturación viven acá. Nada de Firestore se toca fuera de este archivo
// (spec, sección 7): ui.js y main.js solo conocen estas funciones.
//
// Las entradas de cada usuaria viven en usuarios/{uid}/entradas (spec,
// sección 4) — una subcolección bajo su propio documento, no una colección
// plana con un campo uid. Eso es justo lo que hace innecesaria una
// condición extra de seguridad tipo "where uid == miUid": la ruta misma ya
// aísla los datos de cada usuaria (las reglas de Fase 6 lo refuerzan).

import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { app } from "./firebase-app.js";
import { rangoDelMes } from "./fechas.js";
import { validarEntrada, validarCambiosParciales } from "./validacion.js";

const firestore = getFirestore(app);

function coleccionEntradas(uid) {
  return collection(firestore, "usuarios", uid, "entradas");
}

function refEntrada(uid, entradaId) {
  return doc(firestore, "usuarios", uid, "entradas", entradaId);
}

function mensajeDeError(error) {
  // eslint-disable-next-line no-console
  console.error("[db.js]", error);
  return "No se pudo completar la operación. Revisá tu conexión e intentá de nuevo.";
}

/**
 * Crea una entrada nueva para la usuaria `uid`.
 * @param {string} uid
 * @param {{codigo: string, valor: number, fecha: string, comentario?: string}} entrada
 */
async function crearEntrada(uid, entrada) {
  const error = validarEntrada(entrada);
  if (error) return { ok: false, error };

  try {
    const ref = await addDoc(coleccionEntradas(uid), {
      codigo: entrada.codigo.trim(),
      valor: entrada.valor,
      fecha: entrada.fecha,
      comentario: entrada.comentario ? entrada.comentario.trim() : "",
      creadoEn: serverTimestamp(),
    });
    return { ok: true, id: ref.id };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) };
  }
}

/**
 * Lista las entradas de la usuaria `uid` para un mes dado, ordenadas por
 * fecha ascendente.
 * @param {string} uid
 * @param {string} mes - "YYYY-MM"
 */
async function listarEntradasPorMes(uid, mes) {
  try {
    const { inicio, finExclusivo } = rangoDelMes(mes);
    const q = query(
      coleccionEntradas(uid),
      where("fecha", ">=", inicio),
      where("fecha", "<", finExclusivo),
      orderBy("fecha"),
    );
    const snapshot = await getDocs(q);
    const entradas = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, entradas };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) };
  }
}

/**
 * Edita una entrada existente. `cambios` solo debe traer los campos que
 * cambian (codigo, valor, fecha y/o comentario) — updateDoc hace un merge
 * parcial, no reemplaza el documento completo.
 * @param {string} uid
 * @param {string} entradaId
 * @param {Partial<{codigo: string, valor: number, fecha: string, comentario: string}>} cambios
 */
async function editarEntrada(uid, entradaId, cambios) {
  if (!entradaId) return { ok: false, error: "Falta el identificador de la entrada." };

  const error = validarCambiosParciales(cambios);
  if (error) return { ok: false, error };

  try {
    await updateDoc(refEntrada(uid, entradaId), cambios);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) };
  }
}

/**
 * Elimina una entrada.
 * @param {string} uid
 * @param {string} entradaId
 */
async function eliminarEntrada(uid, entradaId) {
  if (!entradaId) return { ok: false, error: "Falta el identificador de la entrada." };
  try {
    await deleteDoc(refEntrada(uid, entradaId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) };
  }
}

export { crearEntrada, listarEntradasPorMes, editarEntrada, eliminarEntrada };
