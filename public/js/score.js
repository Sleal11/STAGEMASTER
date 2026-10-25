/**
 * score.js — Lógica de la Pantalla LED (score.html)
 *
 * Responsabilidad ÚNICA: PRESENTACIÓN.
 *   1. Conectarse al servidor por Socket.IO
 *   2. Escuchar el evento 'matchUpdate'
 *   3. Dibujar el estado recibido en el DOM
 *
 * Esta vista NUNCA modifica el partido ni emite acciones.
 * No usa el motor de reglas: solo interpreta el estado que calcula el servidor.
 *
 * FLUJO (ej: el operador pulsa "PUNTO A" en el iPhone):
 *   control.js → socket.emit('pointA')
 *     → server/index.js → matchManager → engine.js → nuevo estado
 *     → io.emit('matchUpdate', estado)
 *       → score.js: socket.on('matchUpdate') → renderScore(estado)
 *         → el DOM de la pantalla LED se actualiza
 *
 * Relación con otros archivos:
 *   ← server/index.js   emite 'matchUpdate' (también al conectar/reconectar)
 *   → score.html        IDs del DOM que se actualizan
 *   → css/score.css     clases de estado (is-serving, is-winner, ...)
 */

'use strict';

// ─────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────

/** Texto del badge para cada fase de desempate */
var PHASE_LABELS = {
  tiebreak:      'TIE BREAK',
  superTiebreak: 'SUPER TIE BREAK',
};

/** Tamaño mínimo del nombre (en % del tamaño CSS) al ajustarlo para que quepa */
var MIN_NAME_SCALE = 0.55;

// ─────────────────────────────────────────────────────────────────
// ESTADO DE LA VISTA
// ─────────────────────────────────────────────────────────────────

/** Último estado recibido. Se conserva si se pierde la conexión. */
var lastState = null;

/** Referencias al DOM (se rellenan una sola vez en cacheDom) */
var dom = {};

// ─────────────────────────────────────────────────────────────────
// INICIALIZACIÓN
// ─────────────────────────────────────────────────────────────────

/** Guarda las referencias a los elementos del DOM que se actualizan */
function cacheDom() {
  dom.waiting      = document.getElementById('sb-waiting');
  dom.board        = document.getElementById('sb-board');
  dom.badge        = document.getElementById('sb-badge');
  dom.dividerLabel = document.getElementById('sb-divider-label');
  dom.history      = document.getElementById('sb-history');

  ['A', 'B'].forEach(function (side) {
    var id = side.toLowerCase();
    dom[side] = {
      row:   document.getElementById('row-' + id),
      name:  document.getElementById('name-' + id),
      pts:   document.getElementById('pts-' + id),
      games: document.getElementById('games-' + id),
      sets:  document.getElementById('sets-' + id),
    };
  });
}

/**
 * Abre la conexión con el servidor.
 * Socket.IO reintenta automáticamente si se pierde la conexión, y el
 * servidor reenvía 'matchUpdate' al reconectar, así que no hace falta
 * lógica extra de recuperación aquí.
 */
function connectToServer() {
  // Si /socket.io/socket.io.js no cargó (servidor caído al abrir la página)
  if (typeof io !== 'function') {
    console.error('[Score] Socket.IO no disponible. Reintentando en 3 s...');
    setTimeout(function () { window.location.reload(); }, 3000);
    return;
  }

  var socket = io();

  socket.on('connect', function () {
    console.log('[Score] Conectado al servidor:', socket.id);
  });

  // Ante una desconexión NO borramos el marcador: el público sigue viendo
  // el último resultado mientras Socket.IO reconecta.
  socket.on('disconnect', function (reason) {
    console.warn('[Score] Desconectado (' + reason + '). Reconectando...');
  });

  socket.on('matchUpdate', function (state) {
    renderScore(state);
  });
}

// ─────────────────────────────────────────────────────────────────
// RENDERIZADO
// ─────────────────────────────────────────────────────────────────

/** Punto de entrada: dibuja el estado completo del partido */
function renderScore(state) {
  if (!isValidState(state)) {
    showWaiting();
    return;
  }

  lastState = state;
  dom.waiting.classList.add('hidden');
  dom.board.classList.remove('hidden');

  var finished = state.status === 'finished';

  renderTeam(state, 'A', finished);
  renderTeam(state, 'B', finished);
  renderBadge(state, finished);
  renderDivider(state, finished);
  renderHistory(state, finished);
}

/** Muestra la pantalla de espera (no hay partido activo) */
function showWaiting() {
  lastState = null;
  dom.board.classList.add('hidden');
  dom.badge.classList.add('hidden');
  dom.history.innerHTML = '';
  dom.waiting.classList.remove('hidden');
}

/** Dibuja la fila de un equipo: nombre, puntos, games, sets e icono */
function renderTeam(state, side, finished) {
  var player = state.players[side];
  var el     = dom[side];

  el.name.textContent  = player.name;
  el.sets.textContent  = player.sets;

  // Al terminar, puntos y games dejan de tener sentido → guion
  el.pts.textContent   = finished ? '-' : formatPoints(player.points);
  el.games.textContent = finished ? '-' : player.games;
  el.pts.classList.toggle('is-advantage', !finished && player.points === 'AD');

  // Saque: solo mientras se juega. Estrella: solo si hay ganador.
  el.row.classList.toggle('is-serving', !finished && state.server === side);
  el.row.classList.toggle('is-winner',  finished && state.winner === side);
  el.row.classList.toggle('is-loser',   finished && state.winner !== null && state.winner !== side);

  fitText(el.name);
}

/**
 * Badge superior:
 *   - TIE BREAK / SUPER TIE BREAK durante el desempate
 *   - PUNTO DE ORO cuando hay 40-40 con sistema de punto de oro
 */
function renderBadge(state, finished) {
  var label  = null;
  var isGold = false;

  if (!finished) {
    if (PHASE_LABELS[state.phase]) {
      label = PHASE_LABELS[state.phase];
    } else if (isGoldenPoint(state)) {
      label  = 'PUNTO DE ORO';
      isGold = true;
    }
  }

  dom.badge.classList.toggle('hidden', label === null);
  dom.badge.classList.toggle('is-gold', isGold);
  if (label !== null) dom.badge.textContent = label;
}

/** Texto del separador entre filas: solo aparece al terminar el partido */
function renderDivider(state, finished) {
  var text = '';
  if (finished) {
    text = state.winner ? 'GANADOR DEL PARTIDO' : 'PARTIDO FINALIZADO';
  }
  dom.dividerLabel.textContent = text;
}

/**
 * Historial de sets en la parte inferior.
 * Ej. en juego:     [SET 1 6-3] [SET 2 4-6] [SET 3 · EN CURSO]
 * Ej. finalizado:   [SET 1 6-3] [SET 2 4-6] [SET 3 7-6 (8-6)]
 */
function renderHistory(state, finished) {
  var chips = state.setScores.map(function (set, index) {
    // Super Tie Break decisivo (sustituye al set): se muestran sus puntos, ej. 10-8
    if (set.superTiebreak) {
      return buildSetChip('SUPER TB', set.tiebreak.A + '-' + set.tiebreak.B, false);
    }
    // Si el set se decidió en tiebreak, se añade el detalle: 7-6 (8-6)
    var detail = set.tiebreak ? '(' + set.tiebreak.A + '-' + set.tiebreak.B + ')' : null;
    return buildSetChip('SET ' + (index + 1), set.A + '-' + set.B, false, detail);
  });

  var current = state.players;
  var setNumber = state.setScores.length + 1;

  if (!finished) {
    var currentLabel = isDecidingSuperTiebreak(state) ? 'SUPER TB' : 'SET ' + setNumber;
    chips.push(buildSetChip(currentLabel, 'EN CURSO', true));
  } else if (current.A.games > 0 || current.B.games > 0) {
    // Partido finalizado manualmente a mitad de set: mostramos el parcial
    chips.push(buildSetChip('SET ' + setNumber, current.A.games + '-' + current.B.games, false));
  }

  dom.history.innerHTML = '';
  chips.forEach(function (chip) { dom.history.appendChild(chip); });
}

/**
 * Crea el elemento DOM de una "chip" del historial de sets.
 * @param {string} [detail] - Texto secundario opcional, ej. "(8-6)" del tiebreak
 */
function buildSetChip(label, score, isCurrent, detail) {
  var chip = document.createElement('div');
  chip.className = 'sb-set-chip' + (isCurrent ? ' is-current' : '');

  var labelEl = document.createElement('span');
  labelEl.className   = 'sb-set-chip-label';
  labelEl.textContent = label;

  var scoreEl = document.createElement('span');
  scoreEl.className   = 'sb-set-chip-score';
  scoreEl.textContent = score;

  chip.appendChild(labelEl);
  chip.appendChild(scoreEl);

  if (detail) {
    var detailEl = document.createElement('span');
    detailEl.className   = 'sb-set-chip-detail';
    detailEl.textContent = detail;
    chip.appendChild(detailEl);
  }
  return chip;
}

// ─────────────────────────────────────────────────────────────────
// FUNCIONES AUXILIARES
// ─────────────────────────────────────────────────────────────────

/** Comprobación mínima de que el estado recibido tiene la forma esperada */
function isValidState(state) {
  return !!(state && state.players && state.players.A && state.players.B &&
            Array.isArray(state.setScores));
}

/** El motor ya guarda 0/15/30/40/'AD' (normal) o 0,1,2... (tie break) */
function formatPoints(points) {
  return String(points);
}

/**
 * true si se está jugando un Super Tie Break que sustituye al set decisivo
 * (reglamento FIP). Se distingue del súper tie break a 6-6 de un partido
 * a 1 set porque en el decisivo no se ha jugado ningún game.
 */
function isDecidingSuperTiebreak(state) {
  return state.phase === 'superTiebreak' &&
         state.players.A.games === 0 &&
         state.players.B.games === 0;
}

/** true si el próximo punto decide el game por punto de oro */
function isGoldenPoint(state) {
  return state.phase === 'normal' &&
         state.config && state.config.scoringSystem === 'goldenPoint' &&
         state.players.A.points === 40 &&
         state.players.B.points === 40;
}

/**
 * Reduce el tamaño de letra de un elemento hasta que su texto quepa
 * en una línea (nombres largos como "García / Martínez").
 * Si aun al mínimo no cabe, el CSS lo corta con "…".
 */
function fitText(el) {
  el.style.fontSize = '';   // volver al tamaño definido en score.css
  var baseSize = parseFloat(window.getComputedStyle(el).fontSize);
  var size     = baseSize;

  while (el.scrollWidth > el.clientWidth && size > baseSize * MIN_NAME_SCALE) {
    size *= 0.92;
    el.style.fontSize = size + 'px';
  }
}

/**
 * Intenta impedir que la pantalla se apague por inactividad.
 * La Wake Lock API solo existe en contextos seguros (localhost/HTTPS);
 * si no está disponible, se ignora (en la Fase 10 se configura el SO).
 */
function keepScreenAwake() {
  if (!('wakeLock' in navigator)) return;

  function request() {
    navigator.wakeLock.request('screen').catch(function (err) {
      console.warn('[Score] Wake Lock no disponible:', err.message);
    });
  }

  request();
  // El navegador libera el bloqueo al ocultar la pestaña; lo pedimos de nuevo
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') request();
  });
}

// ─────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  cacheDom();
  showWaiting();
  connectToServer();
  keepScreenAwake();

  // Al cambiar la resolución (o entrar en F11) reajustamos los nombres
  window.addEventListener('resize', function () {
    if (lastState) renderScore(lastState);
  });
});
