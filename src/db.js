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
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { app } from "./firebase-app.js";
import { rangoDelMes } from "./fechas.js";
import { validarEntrada, validarCambiosParciales, validarParametros } from "./validacion.js";
import { prepararImportacion } from "./importacion.js";

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
 *
 * `origenImportacionId` es opcional y solo lo usa importarEntradas() más
 * abajo: guarda el id que la entrada tenía en el respaldo .json de la v1,
 * para poder reconocer "esta entrada ya se importó" si el mismo archivo
 * se vuelve a importar más adelante (spec, sección 8) — no reemplaza el
 * id que Firestore genera para el documento, que sigue siendo el propio.
 *
 * @param {string} uid
 * @param {{codigo: string, valor: number, fecha: string, comentario?: string, origenImportacionId?: string}} entrada
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
      ...(entrada.origenImportacionId ? { origenImportacionId: entrada.origenImportacionId } : {}),
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
 * Lista TODAS las entradas de la usuaria `uid`, sin filtrar por mes,
 * ordenadas por fecha ascendente. La vista "Acumulado" (y el selector de
 * meses disponibles) necesita ver todos los meses a la vez, igual que en
 * la v1 (que tenía todo en un único array en memoria, cargado de
 * localStorage) — acá se trae todo una vez y ui.js agrupa por mes en
 * memoria, en vez de hacer una consulta separada por cada mes.
 * @param {string} uid
 */
async function listarTodasLasEntradas(uid) {
  try {
    const q = query(coleccionEntradas(uid), orderBy("fecha"));
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

/**
 * Lee configuracion/parametros (spec, sección 4): la tabla de códigos y
 * los porcentajes/valores fijos del convenio. Nunca hardcodeados en
 * JavaScript — esto es lo que permite que AIDA actualice una tarifa desde
 * la consola de Firebase sin tocar ni redesplegar código (spec, Fase 4).
 *
 * Valida la forma del documento antes de devolverlo: si Alejandro tipeó
 * algo mal en la consola (falta un campo, un código con valor no
 * numérico), es mejor fallar acá con un mensaje claro que dejar que
 * calculo.js reciba un valor inválido y produzca un desglose incorrecto
 * sin ningún aviso.
 */
async function leerConfiguracion() {
  try {
    const snap = await getDoc(doc(firestore, "configuracion", "parametros"));
    if (!snap.exists()) {
      return { ok: false, error: 'No existe el documento "configuracion/parametros" en Firestore.' };
    }
    const parametros = snap.data();
    const error = validarParametros(parametros);
    if (error) return { ok: false, error };
    return { ok: true, parametros };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) };
  }
}

/**
 * Importa el respaldo .json de la v1 (spec, sección 8) a la cuenta de la
 * usuaria `uid`. Trae primero todo lo que ya tiene en Firestore, deja que
 * la lógica pura de importacion.js decida qué entradas son nuevas
 * (deduplicando por fecha+código+valor, no por el id de la v1, que no
 * tiene por qué coincidir con ningún id de Firestore), y solo entonces
 * escribe — así importar el mismo archivo dos veces seguidas no duplica
 * nada (criterio de aceptación de la Fase 7).
 *
 * Las escrituras van una por una (no hay una operación de "batch" en la
 * capa que usa el resto de db.js): para un respaldo de meses de una sola
 * usuaria esto es unas pocas docenas de escrituras, nada que justifique la
 * complejidad extra de un batch de Firestore acá.
 *
 * @param {string} uid
 * @param {unknown} datos - el .json ya parseado
 */
async function importarEntradas(uid, datos) {
  const existentesResultado = await listarTodasLasEntradas(uid);
  if (!existentesResultado.ok) return existentesResultado;

  const preparado = prepararImportacion(datos, existentesResultado.entradas);
  if (!preparado.ok) return preparado;

  let insertadas = 0;
  for (const entrada of preparado.aInsertar) {
    const resultado = await crearEntrada(uid, entrada);
    if (!resultado.ok) {
      // Nos detenemos ante el primer error real de Firestore (ej. sin
      // conexión a mitad de la importación) en vez de seguir intentando
      // el resto a ciegas — lo ya insertado queda bien (no hay
      // duplicados posibles al reintentar, según el mismo criterio de
      // deduplicación), y la usuaria puede volver a importar el archivo.
      return { ok: false, error: resultado.error, insertadas };
    }
    insertadas++;
  }

  return {
    ok: true,
    insertadas,
    invalidas: preparado.invalidas,
    duplicadas: preparado.duplicadas,
  };
}

export {
  crearEntrada,
  listarEntradasPorMes,
  listarTodasLasEntradas,
  editarEntrada,
  eliminarEntrada,
  leerConfiguracion,
  importarEntradas,
};
