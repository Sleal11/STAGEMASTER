'use strict';

/**
 * remotes.js — Portátiles remotos enlazados (pantallas en otro ordenador)
 *
 * Escenario: la pista está lejos del portátil principal. Otro portátil, junto
 * a la pantalla LED, abre StageMaster en modo «pantalla remota» y muestra
 * una o varias pantallas conectándose por la red al portátil principal.
 *
 * El portátil PRINCIPAL es la única autoridad: tiene los partidos, la
 * configuración y la publicidad. Un remoto muestra pantallas y, con su token,
 * puede abrir la ESTACIÓN del principal (rol station, socketServer.js) para
 * controlar a la vez; enlazar y desvincular portátiles es solo del principal.
 *
 * Enlace (una vez por portátil):
 *   1. La estación del principal muestra un CÓDIGO DE ENLACE de 6 cifras.
 *   2. El remoto lo envía ('remote:pair') y recibe un TOKEN que guarda.
 *   3. Con ese token sus pantallas pueden conectarse desde la red (sin token,
 *      las pantallas solo se aceptan desde el propio portátil principal).
 *
 * Se guarda en data/remotes.json: nombre, fecha y el HASH del token (nunca
 * el token). La estación puede desvincular un portátil en cualquier momento.
 */

const crypto = require('crypto');
const { createStore } = require('./storage');
const { appError }    = require('./errors');
const auth            = require('./auth');

const MAX_REMOTES  = 8;
const NAME_LENGTH  = 40;

/** Código de 6 cifras (no empieza por 0: así no se pierde al teclear) */
function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function cleanName(name) {
  const text = String(name || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_LENGTH);
  return text || 'Portátil remoto';
}

/**
 * @param {Object}   [options]
 * @param {Function} [options.now] - Reloj (las pruebas lo sustituyen)
 */
function createRemoteRegistry({ now = Date.now } = {}) {
  const store = createStore('remotes.json', { validate: (data) => Array.isArray(data.remotes) });
  const saved = store.load() || { remotes: [] };
  let code = typeof saved.code === 'string' && /^\d{6}$/.test(saved.code) ? saved.code : generateCode();
  const remotes = new Map(saved.remotes
    .filter((r) => r && typeof r.id === 'string' && typeof r.tokenHash === 'string')
    .map((r) => [r.id, { id: r.id, name: cleanName(r.name), tokenHash: r.tokenHash, pairedAt: r.pairedAt || null }]));

  function persist() {
    store.save({ code, remotes: [...remotes.values()] });
  }
  persist();

  /**
   * Enlaza un portátil con el código. Si ya había uno con el mismo nombre,
   * se sustituye (el mismo portátil que se vuelve a enlazar).
   * @returns {{ id: string, token: string, name: string }}
   */
  function pair(givenCode, name) {
    if (!auth.safeEqual(String(givenCode || '').trim(), code)) {
      throw appError('INVALID_CODE', 'Código de enlace incorrecto. Míralo en la estación del portátil principal.');
    }
    const clean = cleanName(name);
    [...remotes.values()].filter((r) => r.name === clean).forEach((r) => remotes.delete(r.id));
    if (remotes.size >= MAX_REMOTES) throw appError('REMOTE_LIMIT', `Como máximo ${MAX_REMOTES} portátiles remotos`);
    const token = auth.generateToken();
    const id = 'remoto-' + crypto.randomBytes(4).toString('hex');
    remotes.set(id, { id, name: clean, tokenHash: auth.hashToken(token), pairedAt: now() });
    persist();
    return { id, token, name: clean };
  }

  /** Portátil al que pertenece un token, o null */
  function verify(token) {
    if (typeof token !== 'string' || !token) return null;
    const hash = auth.hashToken(token);
    return [...remotes.values()].find((r) => auth.safeEqual(r.tokenHash, hash)) || null;
  }

  /** La estación desvincula un portátil: su token deja de valer */
  function unlink(id) {
    if (!remotes.delete(id)) throw appError('UNKNOWN_REMOTE', 'Ese portátil ya no está enlazado');
    persist();
  }

  /** Código nuevo (el anterior deja de servir; los portátiles ya enlazados siguen) */
  function newCode() {
    code = generateCode();
    persist();
    return code;
  }

  return {
    pair,
    verify,
    unlink,
    newCode,
    code: () => code,
    get:  (id) => remotes.get(id) || null,
    list: () => [...remotes.values()].map(({ id, name, pairedAt }) => ({ id, name, pairedAt })),
  };
}

module.exports = { createRemoteRegistry };
