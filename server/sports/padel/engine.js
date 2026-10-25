'use strict';

/**
 * ─────────────────────────────────────────────────────────────────
 * STAGEMASTER — MOTOR DE PUNTUACIÓN DE PÁDEL
 * Archivo: server/sports/padel/engine.js
 *
 * Responsabilidad: ÚNICA. Contiene exclusivamente la lógica de las
 * reglas del pádel. No conoce ni servidores, ni HTML, ni sockets.
 *
 * Principio de diseño: Funciones PURAS.
 *   → Recibe un estado + una acción.
 *   → Devuelve un NUEVO estado.
 *   → NUNCA modifica el estado original.
 *   → Testeable de forma completamente independiente.
 *
 * Escalabilidad: Cada deporte tendrá su propio engine.js en
 *   server/sports/<deporte>/engine.js
 * ─────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────

/** Secuencia de puntos en un game normal */
const PUNTOS = [0, 15, 30, 40];

/** Marcador especial para indicar que un jugador tiene ventaja */
const VENTAJA = 'AD';

/** Máximo de estados guardados en el historial (para undo) */
const MAX_HISTORIAL = 50;

// ─────────────────────────────────────────────────────────────────
// API PÚBLICA — Solo estas dos funciones se exportan
// ─────────────────────────────────────────────────────────────────

/**
 * Crea el estado inicial de un partido desde la configuración.
 *
 * @param {Object} config
 * @param {number} config.gamesPerSet    - Games para ganar un set (1–6)
 * @param {number} config.totalSets      - Total de sets del partido
 * @param {string} config.scoringSystem  - 'advantage' | 'goldenPoint'
 * @param {string} config.tiebreakType   - 'tiebreak' | 'superTiebreak' | 'none'
 * @param {string} config.initialServer  - 'A' | 'B'
 * @param {string} config.nameA          - Nombre del equipo A
 * @param {string} config.nameB          - Nombre del equipo B
 * @returns {Object} Estado inicial del partido
 */
function createMatch(config) {
  // setsToWin: cuántos sets hay que ganar para llevarse el partido
  // Ejemplo: best-of-3 → Math.ceil(3/2) = 2 sets para ganar
  const setsToWin = Math.ceil(config.totalSets / 2);

  return {
    config: {
      sport:         'padel',
      gamesPerSet:   config.gamesPerSet,
      totalSets:     config.totalSets,
      setsToWin,                           // Calculado automáticamente
      scoringSystem: config.scoringSystem, // 'advantage' | 'goldenPoint'
      tiebreakType:  config.tiebreakType,  // 'tiebreak' | 'superTiebreak' | 'none'
      initialServer: config.initialServer, // 'A' | 'B'
    },
    players: {
      A: { name: config.nameA || 'Equipo A', points: 0, games: 0, sets: 0 },
      B: { name: config.nameB || 'Equipo B', points: 0, games: 0, sets: 0 },
    },
    currentSet: 1,
    server:     config.initialServer,
    status:     'playing',   // 'playing' | 'finished'
    phase:      'normal',    // 'normal' | 'tiebreak' | 'superTiebreak'
    winner:     null,        // null | 'A' | 'B'
    setScores:  [],          // Historial: [{A: 6, B: 3}, {A: 4, B: 6}, ...]
    history:    [],          // Stack de estados anteriores (para undo)
  };
}

/**
 * Punto de entrada principal. Aplica una acción al estado del partido.
 * Es el ÚNICO lugar desde donde se cambia el estado.
 *
 * @param {Object} state  - Estado actual del partido
 * @param {string} action - Acción a aplicar
 * @returns {Object} Nuevo estado (el estado original NUNCA se modifica)
 */
function applyAction(state, action) {
  switch (action) {
    case 'pointA':       return applyPoint(state, 'A');
    case 'pointB':       return applyPoint(state, 'B');
    case 'undo':         return applyUndo(state);
    case 'changeServer': return applyChangeServer(state);
    case 'finishMatch':  return applyFinishMatch(state);
    default:
      throw new Error(`[PadelEngine] Acción desconocida: "${action}"`);
  }
}

// ─────────────────────────────────────────────────────────────────
// ACCIONES INTERNAS
// ─────────────────────────────────────────────────────────────────

/**
 * Otorga un punto al jugador/equipo indicado.
 * Guarda el estado actual en el historial antes de modificarlo.
 *
 * @param {Object} state  - Estado actual
 * @param {string} scorer - Jugador que ganó el punto: 'A' | 'B'
 */
function applyPoint(state, scorer) {
  // Seguridad: no procesar puntos si el partido ya terminó
  if (state.status !== 'playing') return state;

  // ── 1. Guardar estado en historial (para permitir undo) ────────
  // Hacemos una copia del estado actual SIN su historial.
  // Esto mantiene el historial PLANO (sin anidamiento infinito).
  const snapshot = deepCopy(state);
  snapshot.history = []; // Limpiamos el historial del snapshot

  // ── 2. Crear estado de trabajo con historial actualizado ───────
  let s = deepCopy(state);
  s.history = [snapshot, ...state.history].slice(0, MAX_HISTORIAL);

  // ── 3. Aplicar lógica según la fase actual ─────────────────────
  if (s.phase === 'normal') {
    s = processNormalPoint(s, scorer);
  } else {
    // phase === 'tiebreak' o 'superTiebreak'
    s = processTiebreakPoint(s, scorer);
  }

  return s;
}

/**
 * Deshace el último punto, regresando exactamente al estado anterior.
 * No es un "reset": restaura el estado completo tal como era.
 */
function applyUndo(state) {
  // Si no hay historial, no hay nada que deshacer
  if (state.history.length === 0) return state;

  // El primer elemento del historial es el estado justo ANTES de la última acción
  const [estadoAnterior, ...historialRestante] = state.history;

  // Restauramos los datos del estado anterior + el historial que había en ese momento
  return { ...estadoAnterior, history: historialRestante };
}

/**
 * Cambia manualmente el servidor (corrección del operador).
 */
function applyChangeServer(state) {
  if (state.status !== 'playing') return state;
  const s = deepCopy(state);
  s.server = toggleServer(s.server);
  return s;
}

/**
 * Finaliza el partido manualmente (sin que un jugador haya ganado todos los sets).
 * Determina el ganador por número de sets ganados.
 */
function applyFinishMatch(state) {
  if (state.status === 'finished') return state;
  const s = deepCopy(state);
  s.status = 'finished';

  // Ganador: quien tenga más sets
  if (s.players.A.sets > s.players.B.sets)      s.winner = 'A';
  else if (s.players.B.sets > s.players.A.sets) s.winner = 'B';
  // Si están igualados en sets: winner queda null (empate forzado)

  return s;
}

// ─────────────────────────────────────────────────────────────────
// LÓGICA DE PUNTUACIÓN (funciones internas)
// ─────────────────────────────────────────────────────────────────

/**
 * Procesa un punto durante un game normal (fase 'normal').
 * Aplica la secuencia 0→15→30→40 y maneja deuce/ventaja/punto de oro.
 */
function processNormalPoint(state, scorer) {
  const opp = opponent(scorer);      // El otro jugador
  const sp   = state.players[scorer].points; // Puntos actuales del anotador
  const op   = state.players[opp].points;   // Puntos actuales del oponente

  // ── Caso 1: El anotador YA tenía ventaja → gana el game ───────
  if (sp === VENTAJA) {
    return processGameWon(state, scorer);
  }

  // ── Caso 2: El OPONENTE tenía ventaja → vuelven a DEUCE ───────
  if (op === VENTAJA) {
    const s = deepCopy(state);
    s.players[scorer].points = 40;
    s.players[opp].points    = 40;
    return s;
  }

  // ── Caso 3: Ambos en 40 → situación de DEUCE ──────────────────
  if (sp === 40 && op === 40) {
    if (state.config.scoringSystem === 'goldenPoint') {
      // Punto de oro: el anotador gana el game directamente
      return processGameWon(state, scorer);
    }
    // Ventaja: el anotador obtiene ventaja
    const s = deepCopy(state);
    s.players[scorer].points = VENTAJA;
    // El oponente se queda en 40 (no necesitamos cambiarlo, ya está en 40)
    return s;
  }

  // ── Caso 4: Anotador en 40, oponente NO en 40 → gana game ─────
  // (Si ambos estuvieran en 40, ya lo habríamos manejado arriba)
  if (sp === 40) {
    return processGameWon(state, scorer);
  }

  // ── Caso 5: Progresión normal (0→15→30→40) ────────────────────
  const s = deepCopy(state);
  const indice = PUNTOS.indexOf(sp);
  s.players[scorer].points = PUNTOS[indice + 1];
  return s;
}

/**
 * Procesa un punto durante un tiebreak (fase 'tiebreak' o 'superTiebreak').
 * Los puntos son numéricos (0, 1, 2, 3...).
 * El servidor cambia después de cada punto impar (1, 3, 5...).
 */
function processTiebreakPoint(state, scorer) {
  const s = deepCopy(state);

  // Sumar punto (numérico, no 15-30-40)
  s.players[scorer].points += 1;

  const pA    = s.players.A.points;
  const pB    = s.players.B.points;
  const total = pA + pB;

  // ── Cambio de servidor en tiebreak ────────────────────────────
  // Regla oficial: primer punto → 1 saque; luego alternancia cada 2 puntos.
  // Cambio ocurre cuando el total de puntos es IMPAR (1, 3, 5, 7...)
  if (total % 2 === 1) {
    s.server = toggleServer(s.server);
  }

  // ── Verificar si el tiebreak terminó ──────────────────────────
  // Regular: primero en llegar a 7 con diferencia de 2
  // Super:   primero en llegar a 10 con diferencia de 2
  const objetivo = s.phase === 'superTiebreak' ? 10 : 7;

  if (isTiebreakWon(pA, pB, objetivo)) {
    const ganadorTB = pA > pB ? 'A' : 'B';

    // El tiebreak cuenta como un game más para el ganador del set: 6-6 → 7-6
    s.players[ganadorTB].games += 1;

    // Regla oficial: el primer game del siguiente set lo saca quien
    // RECIBIÓ el primer punto del tiebreak
    s.server = opponent(tiebreakFirstServer(s.server, total));

    return processSetWon(s, ganadorTB, { A: pA, B: pB });
  }

  return s;
}

/**
 * Procesa el final de un game normal (no tiebreak).
 * Incrementa los games del ganador, rota el servidor, y verifica:
 *   a) Si el ganador del game ganó el set
 *   b) Si hay que entrar en tiebreak (empate de games)
 */
function processGameWon(state, scorer) {
  const s = deepCopy(state);

  // ── Resetear puntos para el próximo game ──────────────────────
  s.players.A.points = 0;
  s.players.B.points = 0;

  // ── Sumar game al ganador ─────────────────────────────────────
  s.players[scorer].games += 1;

  // ── Rotar servidor (en pádel cambia tras cada game) ───────────
  s.server = toggleServer(s.server);

  const gA  = s.players.A.games;
  const gB  = s.players.B.games;
  const gPS = s.config.gamesPerSet;

  // ── Verificar si alguien ganó el set ──────────────────────────
  // Condición: llegar a gamesPerSet Y llevar 2 games de ventaja
  // Ejemplos con gamesPerSet=6:
  //   6-4 → 6>=6, diferencia=2 → A gana el set ✓
  //   6-5 → 6>=6, diferencia=1 → continúa
  //   7-5 → 7>=6, diferencia=2 → A gana el set ✓
  //   6-6 → ambos en gamesPerSet → tiebreak (manejado abajo)
  if (gA >= gPS && gA - gB >= 2) return processSetWon(s, 'A');
  if (gB >= gPS && gB - gA >= 2) return processSetWon(s, 'B');

  // ── Verificar si hay que jugar tiebreak ───────────────────────
  // Ocurre cuando AMBOS llegan exactamente al número de games configurado
  if (gA === gPS && gB === gPS) {
    const esUltimoSet = isLastSet(s);

    // Caso especial: último set con desempate configurado como 'none'
    // → No se juega tiebreak; se sigue jugando hasta 2 games de diferencia
    // → Las condiciones de victoria arriba (diff >= 2) lo manejarán eventualmente
    if (esUltimoSet && s.config.tiebreakType === 'none') {
      return s; // Continúa normalmente
    }

    // En cualquier otro caso: entrar en tiebreak o super tiebreak
    return enterTiebreak(s);
  }

  return s;
}

/**
 * Registra la victoria de un set, prepara el partido para el siguiente,
 * y verifica si el ganador del set también ganó el partido.
 *
 * @param {Object} state
 * @param {string} scorer         - Ganador del set: 'A' | 'B'
 * @param {Object} [tiebreakScore] - Puntos del tiebreak {A, B}, si el set se decidió así
 */
function processSetWon(state, scorer, tiebreakScore) {
  const s = deepCopy(state);

  // ── Registrar el resultado del set terminado ───────────────────
  // Ej. set normal: {A: 6, B: 3}  |  set con tiebreak: {A: 7, B: 6, tiebreak: {A: 8, B: 6}}
  const resultadoSet = {
    A: s.players.A.games,
    B: s.players.B.games,
  };
  if (tiebreakScore) resultadoSet.tiebreak = tiebreakScore;
  // Si el "set" fue un Super Tie Break decisivo, se marca para mostrarlo como 10-8
  if (isDecidingSuperTiebreak(s)) resultadoSet.superTiebreak = true;
  s.setScores.push(resultadoSet);

  // ── Sumar set al ganador ───────────────────────────────────────
  s.players[scorer].sets += 1;

  // ── Preparar para el siguiente set ────────────────────────────
  s.players.A.games  = 0;
  s.players.B.games  = 0;
  s.players.A.points = 0;
  s.players.B.points = 0;
  s.phase            = 'normal';
  s.currentSet      += 1;

  // ── Verificar si el partido terminó ───────────────────────────
  // El partido termina cuando alguien alcanza setsToWin sets
  if (s.players[scorer].sets >= s.config.setsToWin) {
    s.status = 'finished';
    s.winner = scorer;
    return s;
  }

  // ── Reglamento FIP: el Super Tie Break SUSTITUYE al set decisivo ──
  // Con sets empatados (ej. 1-1 en best-of-3) no se juega un set completo:
  // se pasa directamente a un Super Tie Break a 10 puntos.
  if (isDecidingSuperTiebreak(s)) {
    s.phase = 'superTiebreak';
  }

  return s;
}

/**
 * Transiciona la fase del partido a 'tiebreak' o 'superTiebreak'.
 * Se llama cuando ambos jugadores llegan al número de games del set.
 */
function enterTiebreak(state) {
  const s       = deepCopy(state);
  const esUltimo = isLastSet(s);

  // Super Tie Break a 6-6 solo ocurre en partidos de UN set (no hay set
  // decisivo que sustituir). Con más sets, el Super Tie Break ya empezó
  // directamente al empatar en sets (ver processSetWon).
  if (esUltimo && s.config.tiebreakType === 'superTiebreak') {
    s.phase = 'superTiebreak';
  } else {
    // Cualquier otro set, o último set con 'tiebreak' configurado → Tie Break regular
    s.phase = 'tiebreak';
  }

  // Los puntos del tiebreak empiezan en 0 (numérico, no 15-30-40)
  s.players.A.points = 0;
  s.players.B.points = 0;

  return s;
}

// ─────────────────────────────────────────────────────────────────
// FUNCIONES AUXILIARES
// ─────────────────────────────────────────────────────────────────

/**
 * Verifica si un tiebreak ha terminado.
 * Condición: llegar al objetivo Y tener al menos 2 puntos de ventaja.
 *
 * Ejemplos (objetivo=7):
 *   7-5 → 7>=7, diff=2 → SÍ termina ✓
 *   7-6 → 7>=7, diff=1 → NO termina ✓
 *   8-6 → 8>=7, diff=2 → SÍ termina ✓
 *
 * Ejemplos (objetivo=10):
 *   10-8 → SÍ ✓  |  10-9 → NO ✓  |  11-9 → SÍ ✓
 */
function isTiebreakWon(pA, pB, objetivo) {
  if (pA >= objetivo && pA - pB >= 2) return true;
  if (pB >= objetivo && pB - pA >= 2) return true;
  return false;
}

/**
 * Determina si el partido está en el ÚLTIMO SET POSIBLE.
 * El último set ocurre cuando ambos jugadores necesitan exactamente 1 set más para ganar.
 *
 * Ejemplo best-of-3 (setsToWin=2): último set cuando A.sets=1 y B.sets=1
 * Ejemplo best-of-5 (setsToWin=3): último set cuando A.sets=2 y B.sets=2
 */
function isLastSet(state) {
  const needed = state.config.setsToWin;
  return (
    state.players.A.sets === needed - 1 &&
    state.players.B.sets === needed - 1
  );
}

/**
 * true si el set actual se juega como Super Tie Break decisivo (reglamento FIP):
 *   - el desempate configurado es 'superTiebreak'
 *   - es el último set posible (sets empatados)
 *   - hace falta ganar más de un set (en partidos a 1 set no hay set que sustituir)
 */
function isDecidingSuperTiebreak(state) {
  return state.config.tiebreakType === 'superTiebreak' &&
         state.config.setsToWin > 1 &&
         isLastSet(state);
}

/**
 * Calcula quién sacó el PRIMER punto del tiebreak, a partir del servidor
 * actual y del total de puntos jugados (sin guardar un campo extra en el estado).
 *
 * En el tiebreak el servidor cambia tras cada punto impar (1, 3, 5...),
 * es decir, ha cambiado Math.ceil(total / 2) veces. Si ese número es impar,
 * el primer servidor es el contrario del actual; si es par, el mismo.
 *
 * Ejemplo: primer servidor A, total=1 → 1 cambio → actual B → primero = A ✓
 */
function tiebreakFirstServer(currentServer, totalPoints) {
  const cambios = Math.ceil(totalPoints / 2);
  return cambios % 2 === 1 ? toggleServer(currentServer) : currentServer;
}

/** Devuelve el jugador contrario */
function opponent(player) {
  return player === 'A' ? 'B' : 'A';
}

/** Alterna el servidor entre A y B */
function toggleServer(server) {
  return server === 'A' ? 'B' : 'A';
}

/**
 * Crea una copia profunda del objeto usando JSON.
 * Funciona correctamente con nuestro modelo de datos (objetos planos, arrays, strings, números).
 * IMPORTANTE: No usar con objetos que tengan funciones, Dates, o referencias circulares.
 */
function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ─────────────────────────────────────────────────────────────────
// EXPORTACIONES
// ─────────────────────────────────────────────────────────────────

module.exports = { createMatch, applyAction };
