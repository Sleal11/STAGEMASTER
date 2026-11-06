/**
 * context.js — Estado compartido de la estación y comunicación con el servidor
 *
 * Lo usan todos los módulos de la estación:
 *   ctx            Conexión, último 'stationState' y desfase del reloj del servidor
 *   send()         Envía una orden y espera la respuesta; el botón pulsado muestra
 *                  "cargando" y se desactiva hasta entonces (evita dobles clics)
 *   toast()        Aviso breve abajo a la derecha
 *   patch()        Sustituye el HTML de un elemento SOLO si cambió (así un
 *                  redibujo nunca "se come" un clic del moderador)
 *   remoteToken    Estación abierta en un PORTÁTIL REMOTO enlazado: su token llega
 *                  en el enlace (station.html#remoto=TOKEN, no se envía en las
 *                  peticiones HTTP salvo en la cabecera de la publicidad)
 *   isRemoteViewer() Esta estación es la de un portátil remoto (el servidor lo
 *                  indica; lo reservado al principal no se muestra)
 */

const REQUEST_TIMEOUT_MS = 4000;
/**
 * Órdenes que esperan a Windows (PowerShell, permiso de administrador): pueden
 * tardar bastante más que el resto. Con 4 s salía «El servidor no respondió»
 * mientras Windows aún cambiaba la resolución (y el cambio sí se hacía).
 */
const SLOW_REQUESTS_MS = {
  'station:listModes':    30000,
  'station:applyMode':    45000,   // comprobar + cambiar el modo (el monitor se resincroniza)
  'station:confirmMode':  30000,
  'station:revertMode':   30000,
  'station:allowPhones': 120000,   // el operador tiene que aceptar el aviso de Windows
  'station:checkNetwork': 30000,
};
/** Errores que el módulo que envía la orden gestiona por su cuenta (con un diálogo) */
const HANDLED_CODES = ['MATCH_IN_PROGRESS'];

export const ctx = {
  socket:      null,
  state:       null,
  clockOffset: 0,     // hora del servidor − hora local
};

export const remoteToken = new URLSearchParams(window.location.hash.slice(1)).get('remoto') || null;
export const isRemoteViewer = () => !!ctx.state && ctx.state.viewer === 'remote';
/** Cabeceras para subir y borrar publicidad (el principal no las necesita) */
export const authHeaders = () => (remoteToken ? { 'X-StageMaster-Token': remoteToken } : {});

export const findMatch  = (id) => ctx.state.matches.find((m) => m.id === id);
export const findScreen = (id) => ctx.state.screens.find((s) => s.id === id);
export const serverNow  = () => Date.now() + ctx.clockOffset;

/**
 * @param {string} eventName
 * @param {Object} payload
 * @param {HTMLElement} [button] - Botón que muestra el estado "cargando"
 * @returns {Promise<{ ok: boolean, code?: string, message?: string }>}
 */
export function send(eventName, payload, button) {
  if (!ctx.socket || !ctx.socket.connected) {
    toast('Sin conexión con el servidor', true);
    return Promise.resolve({ ok: false, message: 'Sin conexión' });
  }
  setLoading(button, true);
  const slow = SLOW_REQUESTS_MS[eventName];
  return ctx.socket.timeout(slow || REQUEST_TIMEOUT_MS).emitWithAck(eventName, payload)
    .catch(() => ({ ok: false, message: slow ? 'Windows tardó demasiado en responder. Revisa la pantalla y vuelve a intentarlo' : 'El servidor no respondió' }))
    .then((response) => {
      setLoading(button, false);
      if (!response.ok && !HANDLED_CODES.includes(response.code)) {
        toast(response.message || 'No se pudo completar la acción', true);
      }
      return response;
    });
}

function setLoading(button, loading) {
  if (!button) return;
  button.classList.toggle('is-loading', loading);
  button.disabled = loading;
  button.toggleAttribute('aria-busy', loading);
}

let toastTimer = null;
export function toast(message, isError = false) {
  const el = document.getElementById('st-toast');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), isError ? 6000 : 4000);
}

const lastHtml = new WeakMap();
export function patch(el, html) {
  if (lastHtml.get(el) === html) return false;
  lastHtml.set(el, html);
  el.innerHTML = html;
  return true;
}
