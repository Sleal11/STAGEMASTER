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
 */

const REQUEST_TIMEOUT_MS = 4000;
/** Errores que el módulo que envía la orden gestiona por su cuenta (con un diálogo) */
const HANDLED_CODES = ['MATCH_IN_PROGRESS'];

export const ctx = {
  socket:      null,
  state:       null,
  clockOffset: 0,     // hora del servidor − hora local
};

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
  return ctx.socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck(eventName, payload)
    .catch(() => ({ ok: false, message: 'El servidor no respondió' }))
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
