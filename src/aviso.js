// aviso.js — texto del aviso de tratamiento de datos personales (Ley 1581
// de 2012, Habeas Data). Vive en su propio módulo, sin DOM, para poder
// reusarlo desde main.js (pantalla de registro) y desde ui.js (enlace
// permanente dentro de la app) sin duplicar el texto en los dos lugares.
//
// Se pide su aceptación una sola vez, en el momento de crear la cuenta
// (spec: Ley 1581 exige el consentimiento en el momento de la recolección,
// no en cada inicio de sesión posterior).

/**
 * @param {string} correoContacto - a quién escribirle para ejercer los
 *   derechos de habeas data (corregir/eliminar datos).
 */
function textoAvisoTratamiento(correoContacto) {
  return `
    <p><strong>Qué guardamos:</strong> tu correo electrónico, el nombre que escribís al registrarte, y los códigos de facturación que vayas ingresando (código, valor, fecha y el comentario que quieras agregar).</p>
    <p><strong>Para qué lo usamos:</strong> únicamente para calcular el desglose de tus descuentos según el contrato sindical vigente y mostrarte el acumulado de tus propios registros, mes a mes.</p>
    <p><strong>Dónde queda guardado:</strong> en Firebase (Google Cloud), con reglas que hacen que solo vos, con tu propia cuenta, puedas ver o modificar tus registros — ni otras usuarias, ni la clínica, ni el sindicato tienen acceso a tus datos a través de esta app.</p>
    <p><strong>Qué no hacemos:</strong> no vendemos ni compartimos tu información, ni la usamos para nada distinto a lo descrito acá.</p>
    <p><strong>Tus derechos:</strong> podés pedir en cualquier momento que se corrijan o se eliminen todos tus datos, escribiendo a ${correoContacto}. También podés exportar tu propio historial completo desde la app cuando quieras (respaldo en .json o Excel).</p>
    <p><strong>Una aclaración importante:</strong> esta herramienta es un apoyo para estimar tus descuentos según el contrato — no reemplaza tu colilla de pago oficial. Ante cualquier diferencia, tu colilla de nómina es la que vale.</p>
  `;
}

const CORREO_CONTACTO_DEFECTO = "williamtabares.12@gmail.com";

export { textoAvisoTratamiento, CORREO_CONTACTO_DEFECTO };
