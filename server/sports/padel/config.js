'use strict';

/**
 * ─────────────────────────────────────────────────────────────────
 * STAGEMASTER — CONFIGURACIÓN DEL PARTIDO DE PÁDEL
 * Archivo: server/sports/padel/config.js
 *
 * Responsabilidad ÚNICA: validar y normalizar la configuración que
 * llega desde el Panel de Control ANTES de crear un partido.
 *
 * ¿Por qué en el servidor si el formulario ya valida?
 *   El servidor no puede confiar en el cliente: un error de red, un
 *   navegador antiguo o una petición manipulada podrían enviar datos
 *   inválidos (ej. totalSets: 2, scoringSystem: 'xyz') y dejar el
 *   motor en un estado imposible en pleno evento.
 *
 * Escalabilidad: cada deporte tendrá su propio config.js junto a su engine.js.
 * ─────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────
// OPCIONES PERMITIDAS
// ─────────────────────────────────────────────────────────────────

const GAMES_PER_SET_MIN = 1;
const GAMES_PER_SET_MAX = 6;

/**
 * Límite de sensatez para la cantidad de sets (no de arquitectura:
 * el motor funciona con cualquier número impar).
 */
const TOTAL_SETS_MAX = 9;

const SCORING_SYSTEMS = ['advantage', 'goldenPoint', 'starPoint'];
const TIEBREAK_TYPES  = ['tiebreak', 'superTiebreak', 'none'];
const SERVERS         = ['A', 'B'];

/**
 * Nombres: cada pareja tiene 1 o 2 jugadores, separados por "/"
 * (ej. "Jose V / Santiago R"). Igual que el maxlength de los formularios.
 */
const MAX_PLAYER_NAME_LENGTH = 24;
const MAX_PLAYERS_PER_TEAM   = 2;

// ─────────────────────────────────────────────────────────────────
// API PÚBLICA
// ─────────────────────────────────────────────────────────────────

/**
 * Valida la configuración recibida y devuelve una copia limpia.
 * Lanza un Error con code 'INVALID_CONFIG' y un mensaje en español
 * (pensado para mostrarse al operador) si algo no es válido.
 *
 * @param {Object} raw - Configuración tal como llega por el socket
 * @returns {Object} Configuración normalizada para createMatch()
 */
function validateConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    fail('Configuración del partido inválida');
  }

  const gamesPerSet = Number(raw.gamesPerSet);
  if (!Number.isInteger(gamesPerSet) ||
      gamesPerSet < GAMES_PER_SET_MIN || gamesPerSet > GAMES_PER_SET_MAX) {
    fail(`Games por set debe ser un número entre ${GAMES_PER_SET_MIN} y ${GAMES_PER_SET_MAX}`);
  }

  // Debe ser impar: con un número par (ej. 2) un partido podría
  // terminar empatado en sets y no habría set decisivo
  const totalSets = Number(raw.totalSets);
  if (!Number.isInteger(totalSets) || totalSets < 1 ||
      totalSets > TOTAL_SETS_MAX || totalSets % 2 === 0) {
    fail(`La cantidad de sets debe ser un número impar entre 1 y ${TOTAL_SETS_MAX}`);
  }

  return {
    nameA:         cleanName(raw.nameA, 'A'),
    nameB:         cleanName(raw.nameB, 'B'),
    gamesPerSet,
    totalSets,
    scoringSystem: requireOneOf(raw.scoringSystem, SCORING_SYSTEMS, 'Sistema de puntuación'),
    tiebreakType:  requireOneOf(raw.tiebreakType,  TIEBREAK_TYPES,  'Tipo de desempate'),
    initialServer: requireOneOf(raw.initialServer, SERVERS,         'Saque inicial'),
  };
}

// ─────────────────────────────────────────────────────────────────
// FUNCIONES AUXILIARES
// ─────────────────────────────────────────────────────────────────

/**
 * Normaliza el nombre de una pareja: jugadores separados por " / ",
 * sin espacios sobrantes, sin vacíos y con longitud máxima por jugador.
 * Ej. "  Jose V/Santiago   R " → "Jose V / Santiago R"
 */
function cleanName(value, side) {
  const players = (typeof value === 'string' ? value : '')
    .split('/')
    .map((player) => player.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

  if (players.length === 0) {
    fail(`Introduce el nombre del Equipo ${side}`);
  }
  if (players.length > MAX_PLAYERS_PER_TEAM) {
    fail(`El Equipo ${side} tiene más de ${MAX_PLAYERS_PER_TEAM} jugadores`);
  }
  if (players.some((player) => player.length > MAX_PLAYER_NAME_LENGTH)) {
    fail(`Cada jugador del Equipo ${side} puede tener como máximo ${MAX_PLAYER_NAME_LENGTH} caracteres`);
  }
  return players.join(' / ');
}

/** Comprueba que el valor esté en la lista de opciones permitidas */
function requireOneOf(value, options, label) {
  if (!options.includes(value)) {
    fail(`${label} inválido`);
  }
  return value;
}

/** Lanza un error de validación identificable por su código */
function fail(message) {
  const err = new Error(message);
  err.code  = 'INVALID_CONFIG';
  throw err;
}

module.exports = { validateConfig };
