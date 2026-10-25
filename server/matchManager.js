'use strict';

/**
 * matchManager.js — Gestor del partido activo
 *
 * Responsabilidad:
 *   - Guardar el estado del partido en memoria (RAM del servidor)
 *   - Servir de puente entre el servidor de sockets y el motor de reglas
 *   - Exponer una API simple: setup / action / reset / getState
 *
 * ¿Por qué en memoria y no en base de datos?
 *   Para un evento deportivo en vivo, la velocidad es prioritaria.
 *   El estado se perdería si el servidor se reinicia, pero el operador
 *   puede simplemente reiniciar el partido desde el panel.
 *   En versiones futuras se puede agregar persistencia fácilmente.
 *
 * Relación con otros archivos:
 *   ← index.js llama a matchManager cuando llega un evento de socket
 *   → matchManager llama a engine.js para aplicar la lógica de pádel
 *   → El resultado se devuelve a index.js para emitir a todos los clientes
 */

const { createMatch, applyAction } = require('./sports/padel/engine');

// Estado actual del partido. null = no hay partido iniciado.
let currentState = null;

/**
 * Crea un nuevo partido con la configuración recibida del operador.
 * @param {Object} config - Configuración enviada desde control.html
 * @returns {Object} Estado inicial del partido
 */
function setup(config) {
  // Validaciones básicas para evitar estados corruptos
  if (!config || typeof config !== 'object') {
    throw new Error('[MatchManager] Configuración inválida');
  }
  if (!config.nameA || !config.nameB) {
    throw new Error('[MatchManager] Los nombres de los equipos son requeridos');
  }

  currentState = createMatch(config);
  console.log(`[MatchManager] Partido creado: ${config.nameA} vs ${config.nameB}`);
  return currentState;
}

/**
 * Aplica una acción al partido actual.
 * @param {string} actionName - 'pointA' | 'pointB' | 'undo' | 'changeServer' | 'finishMatch'
 * @returns {Object|null} Nuevo estado, o null si no hay partido activo
 */
function action(actionName) {
  if (!currentState) {
    console.warn(`[MatchManager] Acción "${actionName}" ignorada: no hay partido activo`);
    return null;
  }

  currentState = applyAction(currentState, actionName);
  return currentState;
}

/**
 * Reinicia el partido con la misma configuración.
 * El estado vuelve a cero pero se conservan los nombres y reglas.
 * @returns {Object|null} Estado reseteado, o null si no hay partido previo
 */
function reset() {
  if (!currentState) {
    console.warn('[MatchManager] Reset ignorado: no hay partido activo');
    return null;
  }

  // Reutilizamos la config del partido actual
  const config = currentState.config;
  currentState = createMatch({
    ...config,
    nameA: currentState.players.A.name,
    nameB: currentState.players.B.name,
  });
  console.log('[MatchManager] Partido reiniciado');
  return currentState;
}

/**
 * Devuelve el estado actual sin modificarlo.
 * Útil para enviar el estado a un cliente que se acaba de conectar.
 * @returns {Object|null} Estado actual o null
 */
function getState() {
  return currentState;
}

module.exports = { setup, action, reset, getState };
