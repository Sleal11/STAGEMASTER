'use strict';

/**
 * auth.js — Autorización básica de dispositivos
 *
 * Modelo de seguridad (pensado para una red local de evento, sin Internet):
 *
 *   ESTACIÓN OPERADORA  Solo desde el propio portátil (localhost). Un teléfono
 *                       de la red Wi-Fi no puede administrar nada.
 *   TELÉFONO ÁRBITRO    Se vincula a UN partido introduciendo el PIN de 4
 *                       dígitos que muestra la estación. Recibe un token
 *                       aleatorio que guarda y reutiliza al reconectar.
 *                       El servidor solo guarda el HASH del token.
 *   PANTALLAS           Solo lectura: muestran el partido que les asigna la estación.
 *
 * Además se limita la prueba de PIN por fuerza bruta: tras varios fallos
 * desde la misma dirección se bloquea temporalmente.
 *
 * No es un sistema de cuentas de usuario (no hace falta en la primera
 * versión), pero deja la arquitectura preparada: todos los permisos se
 * deciden en un único sitio (realtime/socketServer.js → authorizeMatch).
 */

const crypto = require('crypto');
const { appError } = require('./errors');

/** PIN numérico de 4 dígitos, fácil de teclear en el teléfono */
function generatePin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

/** Token aleatorio (192 bits) que identifica a un teléfono vinculado */
function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Hash del token: es lo único que se guarda en disco */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Compara dos textos en tiempo constante (evita deducir el PIN por tiempos) */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/** true si la conexión viene del propio portátil */
function isLocalAddress(address) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(address));
}

/**
 * Limitador de intentos de PIN por dirección.
 *
 * @param {Object} [options]
 * @param {number} [options.maxFailures=5] - Fallos permitidos antes del bloqueo
 * @param {number} [options.lockMs=60000]  - Duración del bloqueo
 */
function createPinGuard({ maxFailures = 5, lockMs = 60000 } = {}) {
  const attempts = new Map();   // dirección → { failures, lockedUntil }

  return {
    /** Lanza PIN_LOCKED si la dirección está bloqueada */
    check(key) {
      const entry = attempts.get(key);
      if (entry && entry.lockedUntil > Date.now()) {
        const seconds = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
        throw appError('PIN_LOCKED', `Demasiados intentos. Espera ${seconds} s y vuelve a intentarlo.`);
      }
    },
    /** Registra un fallo; devuelve los intentos que quedan antes del bloqueo */
    fail(key) {
      const entry = attempts.get(key) || { failures: 0, lockedUntil: 0 };
      entry.failures += 1;
      if (entry.failures >= maxFailures) {
        entry.failures    = 0;
        entry.lockedUntil = Date.now() + lockMs;
      }
      attempts.set(key, entry);
      return entry.lockedUntil > Date.now() ? 0 : maxFailures - entry.failures;
    },
    /** PIN correcto: se olvidan los fallos de esa dirección */
    success(key) {
      attempts.delete(key);
    },
  };
}

module.exports = { generatePin, generateToken, hashToken, safeEqual, isLocalAddress, createPinGuard };
