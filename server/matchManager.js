'use strict';

/**
 * matchManager.js — Gestor del partido activo
 *
 * Responsabilidad:
 *   - Guardar el estado del partido en memoria (RAM del servidor)
 *   - Servir de puente entre el servidor de sockets y el motor de reglas
 *   - Proteger el partido de peticiones inválidas o desactualizadas
 *   - Exponer una API simple: setup / action / reset / getState
 *
 * Memoria + disco:
 *   El estado vive en memoria (rápido) y además se guarda en disco tras
 *   cada cambio (storage.js). Al arrancar, el servidor recupera el
 *   partido guardado: un reinicio en pleno evento no pierde el marcador.
 *
 * VERSIÓN DEL ESTADO (control de concurrencia):
 *   Cada cambio del partido incrementa `version`. El panel envía la versión
 *   que estaba viendo junto con cada acción; si no coincide con la actual,
 *   la acción se rechaza. Esto evita:
 *     - Doble pulsación: el 2º toque llega con una versión ya superada.
 *     - Dos dispositivos controlando a la vez: si otro iPhone sumó un punto,
 *       el primero no puede aplicar una acción basada en un marcador viejo.
 *
 * ESTADO PÚBLICO:
 *   A los clientes se les envía el estado SIN el historial de undo
 *   (hasta 50 copias del partido) y con dos datos extra: version y canUndo.
 *
 * Relación con otros archivos:
 *   ← index.js llama a matchManager cuando llega un evento de socket
 *   → sports/padel/config.js valida la configuración
 *   → sports/padel/engine.js aplica la lógica de pádel
 *   → storage.js guarda/recupera el partido en disco
 *   → El resultado se devuelve a index.js para emitir a todos los clientes
 */

const { createMatch, applyAction } = require('./sports/padel/engine');
const { validateConfig }           = require('./sports/padel/config');
const storage                      = require('./storage');

// Estado completo del partido actual (con historial). null = no hay partido.
let currentState = null;

// Se incrementa con cada cambio del partido
let version = 0;

// ── Recuperar el partido guardado (si el servidor se reinició) ──
const saved = storage.load();
if (saved) {
  currentState = saved.state;
  version      = saved.version;
  console.log(`[MatchManager] Partido recuperado del disco: ` +
    `${currentState.players.A.name} vs ${currentState.players.B.name} (v${version})`);
}

/**
 * Crea un nuevo partido con la configuración recibida del operador.
 *
 * @param {Object}  rawConfig       - Configuración enviada desde control.html
 * @param {Object}  [options]
 * @param {boolean} [options.force] - true para reemplazar un partido en curso
 * @returns {Object} Estado público del nuevo partido
 */
function setup(rawConfig, options = {}) {
  // Protección: no pisar un partido que se está jugando sin confirmación
  if (currentState && currentState.status === 'playing' && !options.force) {
    throw managerError('MATCH_IN_PROGRESS',
      `Hay un partido en curso: ${currentState.players.A.name} vs ${currentState.players.B.name}`);
  }

  const config = validateConfig(rawConfig);
  commit(createMatch(config));

  console.log(`[MatchManager] Partido creado: ${config.nameA} vs ${config.nameB} (v${version})`);
  return getState();
}

/**
 * Aplica una acción al partido actual.
 *
 * @param {string} actionName      - 'pointA' | 'pointB' | 'undo' | 'changeServer' | 'finishMatch'
 * @param {number} expectedVersion - Versión que veía el panel al pulsar el botón
 * @returns {Object} Estado público tras la acción
 */
function action(actionName, expectedVersion) {
  requireMatch();
  requireVersion(expectedVersion);

  const nextState = applyAction(currentState, actionName);

  // El motor devuelve el MISMO objeto si la acción no cambió nada
  // (ej. undo sin historial): en ese caso la versión no avanza
  if (nextState !== currentState) commit(nextState);
  return getState();
}

/**
 * Reinicia el partido con la misma configuración y nombres.
 *
 * @param {number} expectedVersion - Versión que veía el panel al confirmar
 * @returns {Object} Estado público del partido reiniciado
 */
function reset(expectedVersion) {
  requireMatch();
  requireVersion(expectedVersion);

  const config = currentState.config;
  commit(createMatch({
    ...config,
    nameA: currentState.players.A.name,
    nameB: currentState.players.B.name,
  }));

  console.log(`[MatchManager] Partido reiniciado (v${version})`);
  return getState();
}

/**
 * Devuelve el estado PÚBLICO actual (sin historial), o null si no hay partido.
 * Es lo que se envía a los clientes.
 */
function getState() {
  if (!currentState) return null;

  const { history, ...publicState } = currentState;
  return {
    ...publicState,
    version,
    canUndo: history.length > 0,
  };
}

/**
 * ÚNICO punto donde cambia el partido: actualiza el estado, avanza la
 * versión y lo guarda en disco.
 */
function commit(newState) {
  currentState = newState;
  version += 1;
  storage.save(currentState, version);
}

// ─────────────────────────────────────────────────────────────────
// VALIDACIONES INTERNAS
// ─────────────────────────────────────────────────────────────────

function requireMatch() {
  if (!currentState) {
    throw managerError('NO_MATCH', 'No hay ningún partido activo');
  }
}

/**
 * Rechaza acciones basadas en una versión antigua del marcador.
 * Si el cliente no envía versión (ej. herramientas de prueba), se acepta.
 */
function requireVersion(expectedVersion) {
  if (expectedVersion !== undefined && expectedVersion !== version) {
    throw managerError('STALE_VERSION',
      'El marcador cambió antes de aplicar la acción. Revisa el marcador y vuelve a intentarlo.');
  }
}

/** Crea un Error con un código que index.js reenvía al cliente */
function managerError(code, message) {
  const err = new Error(message);
  err.code  = code;
  return err;
}

module.exports = { setup, action, reset, getState };
