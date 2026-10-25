/**
 * control.js — Lógica del Panel de Control (iPhone)
 *
 * Responsabilidad:
 *   1. Leer la configuración del formulario de setup
 *   2. Enviar acciones al motor de pádel (PadelEngine)
 *   3. Renderizar el estado actual en el DOM
 *   4. Gestionar confirmaciones para acciones peligrosas
 *
 * En la Fase 7 se añadirá aquí la comunicación con Socket.IO
 * para sincronizar con la pantalla LED en tiempo real.
 *
 * FLUJO DE UNA ACCIÓN (ej: "Punto A"):
 *   Botón "PUNTO A"
 *     → handlePoint('A')
 *       → PadelEngine.applyAction(matchState, 'pointA')
 *         → Nuevo estado calculado por el motor
 *       → matchState = nuevoEstado
 *       → renderMatch()  ← actualiza el DOM
 *       → [Fase 7] socket.emit('pointA')  ← notificará a la pantalla LED
 */

'use strict';

// ─────────────────────────────────────────────────────────────────
// ESTADO GLOBAL DEL PANEL
// ─────────────────────────────────────────────────────────────────

/** Texto del badge cuando el siguiente punto decide el game */
var DECISIVE_POINT_LABELS = {
  goldenPoint: 'PUNTO DE ORO',
  starPoint:   'PUNTO ESTRELLA',
};

/** Estado actual del partido. null = no hay partido iniciado. */
var matchState = null;

/** Callback pendiente en el modal de confirmación */
var modalCallback = null;

/** Timer para el doble-toque de DESHACER */
var undoConfirmTimer = null;

/** Si el botón DESHACER está esperando segunda confirmación */
var undoPendingConfirm = false;

// ─────────────────────────────────────────────────────────────────
// LECTURA DE CONFIGURACIÓN DEL FORMULARIO
// ─────────────────────────────────────────────────────────────────

/** Lee el valor actualmente seleccionado en un grupo de pill/toggle */
function getSelectedValue(groupId) {
  var group  = document.getElementById(groupId);
  var active = group.querySelector('.selected');
  return active ? active.getAttribute('data-value') : null;
}

/** Construye el objeto de configuración desde el formulario de setup */
function buildConfigFromForm() {
  return {
    nameA:         document.getElementById('input-name-a').value.trim(),
    nameB:         document.getElementById('input-name-b').value.trim(),
    gamesPerSet:   parseInt(getSelectedValue('group-games-per-set'), 10),
    totalSets:     parseInt(getSelectedValue('group-total-sets'), 10),
    scoringSystem: getSelectedValue('group-scoring'),
    tiebreakType:  getSelectedValue('group-tiebreak'),
    initialServer: getSelectedValue('group-server'),
  };
}

/** Valida la configuración y muestra errores si es necesario */
function validateConfig(cfg) {
  var valid = true;

  // Validar nombre equipo A
  var errA = document.getElementById('error-name-a');
  if (!cfg.nameA) {
    errA.classList.remove('hidden');
    document.getElementById('input-name-a').focus();
    valid = false;
  } else {
    errA.classList.add('hidden');
  }

  // Validar nombre equipo B
  var errB = document.getElementById('error-name-b');
  if (!cfg.nameB) {
    errB.classList.remove('hidden');
    if (valid) document.getElementById('input-name-b').focus();
    valid = false;
  } else {
    errB.classList.add('hidden');
  }

  return valid;
}

// ─────────────────────────────────────────────────────────────────
// GESTIÓN DE PANTALLAS
// ─────────────────────────────────────────────────────────────────

/** Muestra una pantalla y oculta las demás */
function showScreen(screenName) {
  var screens = ['setup', 'match', 'finished'];
  screens.forEach(function (name) {
    var el = document.getElementById('screen-' + name);
    if (name === screenName) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// RENDERIZADO DEL PARTIDO
// ─────────────────────────────────────────────────────────────────

/** Convierte los puntos internos a texto para mostrar en el marcador */
function formatPoints(points, phase) {
  // En tiebreak, los puntos son numéricos directamente (0, 1, 2...)
  if (phase !== 'normal') return String(points);
  // En juego normal: 0, 15, 30, 40, AD
  return String(points); // El motor ya almacena 0/15/30/40/'AD'
}

/**
 * Texto de un set terminado para el historial:
 *   set normal → "6-3" | con tiebreak → "7-6 (8-6)" | Super TB decisivo → "STB 10-8"
 */
function formatSetScore(set) {
  if (set.superTiebreak) return 'STB ' + set.tiebreak.A + '-' + set.tiebreak.B;
  var text = set.A + '-' + set.B;
  if (set.tiebreak) text += ' (' + set.tiebreak.A + '-' + set.tiebreak.B + ')';
  return text;
}

/** Renderiza el estado completo del partido en la pantalla de control */
function renderMatch() {
  if (!matchState) return;

  var p      = matchState.players;
  var server = matchState.server;
  var phase  = matchState.phase;
  var status = matchState.status;

  // Si el partido terminó, ir a pantalla de ganador
  if (status === 'finished') {
    renderFinished();
    showScreen('finished');
    return;
  }

  // ── Nombres ──────────────────────────────────────────────────
  document.getElementById('team-name-a-match').textContent = p.A.name;
  document.getElementById('team-name-b-match').textContent = p.B.name;
  document.getElementById('btn-point-a-name').textContent  = p.A.name;
  document.getElementById('btn-point-b-name').textContent  = p.B.name;

  // ── Puntos ───────────────────────────────────────────────────
  document.getElementById('pts-a').textContent = formatPoints(p.A.points, phase);
  document.getElementById('pts-b').textContent = formatPoints(p.B.points, phase);

  // ── Games ────────────────────────────────────────────────────
  document.getElementById('games-a').textContent = p.A.games;
  document.getElementById('games-b').textContent = p.B.games;

  // ── Sets ─────────────────────────────────────────────────────
  document.getElementById('sets-a').textContent = p.A.sets;
  document.getElementById('sets-b').textContent = p.B.sets;

  // ── Indicador de saque ───────────────────────────────────────
  var iconA = document.getElementById('server-icon-a');
  var iconB = document.getElementById('server-icon-b');
  if (server === 'A') {
    iconA.classList.add('visible');
    iconB.classList.remove('visible');
  } else {
    iconA.classList.remove('visible');
    iconB.classList.add('visible');
  }

  // ── Etiqueta de fase (Tie Break / Super Tie Break) ───────────
  var badge     = document.getElementById('phase-badge');
  var setLabel  = document.getElementById('match-status-label');

  setLabel.textContent = phase === 'superTiebreak' && p.A.games === 0 && p.B.games === 0
    ? 'SUPER TIE BREAK DECISIVO'
    : 'SET ' + matchState.currentSet + ' · EN CURSO';

  if (phase === 'tiebreak') {
    badge.textContent = 'TIE BREAK';
    badge.classList.remove('hidden');
  } else if (phase === 'superTiebreak') {
    badge.textContent = 'SUPER TB';
    badge.classList.remove('hidden');
  } else if (matchState.decisivePoint) {
    // 40-40 decisivo: el siguiente punto gana el game
    badge.textContent = DECISIVE_POINT_LABELS[matchState.config.scoringSystem] || 'PUNTO DECISIVO';
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // ── Historial de sets ────────────────────────────────────────
  var historyEl = document.getElementById('set-history');
  if (matchState.setScores.length > 0) {
    historyEl.textContent = matchState.setScores
      .map(formatSetScore)
      .join('  ·  ');
  } else {
    historyEl.textContent = '';
  }
}

/** Renderiza la pantalla de partido finalizado */
function renderFinished() {
  if (!matchState || !matchState.winner) return;

  var winner     = matchState.winner;
  var winnerName = matchState.players[winner].name;

  document.getElementById('winner-name').textContent = winnerName;

  // Construir resultado de sets
  var setsStr = matchState.setScores
    .map(formatSetScore)
    .join(' · ');
  document.getElementById('final-sets').textContent = setsStr;
}

// ─────────────────────────────────────────────────────────────────
// MANEJADORES DE ACCIONES DEL PARTIDO
// ─────────────────────────────────────────────────────────────────

/** Aplica una acción al motor y actualiza la UI */
function dispatch(action) {
  if (!matchState) return;
  matchState = PadelEngine.applyAction(matchState, action);
  renderMatch();
  // [Fase 7] Aquí se añadirá: socket.emit('action', action);
}

/** Manejador del botón "Punto A" */
function handlePointA() {
  resetUndoConfirm(); // Cancela cualquier confirmación pendiente de undo
  dispatch('pointA');
}

/** Manejador del botón "Punto B" */
function handlePointB() {
  resetUndoConfirm();
  dispatch('pointB');
}

/**
 * Manejador del botón "Deshacer".
 * Primera pulsación: muestra confirmación visual.
 * Segunda pulsación (dentro de 3s): ejecuta undo.
 */
function handleUndo() {
  var btn = document.getElementById('btn-undo');

  if (!undoPendingConfirm) {
    // Primera pulsación: pedir confirmación
    undoPendingConfirm = true;
    btn.textContent = '⚠ CONFIRMAR DESHACER';
    btn.classList.add('confirming');

    // Auto-cancelar después de 3 segundos
    undoConfirmTimer = setTimeout(function () {
      resetUndoConfirm();
    }, 3000);
  } else {
    // Segunda pulsación: ejecutar undo
    resetUndoConfirm();
    dispatch('undo');
  }
}

/** Resetea el estado de confirmación del botón DESHACER */
function resetUndoConfirm() {
  undoPendingConfirm = false;
  clearTimeout(undoConfirmTimer);
  var btn = document.getElementById('btn-undo');
  if (btn) {
    btn.textContent = '↩ DESHACER ÚLTIMO PUNTO';
    btn.classList.remove('confirming');
  }
}

/** Manejador del botón "Cambiar Saque" */
function handleChangeServer() {
  dispatch('changeServer');
}

// ─────────────────────────────────────────────────────────────────
// INICIO Y REINICIO DE PARTIDO
// ─────────────────────────────────────────────────────────────────

/** Manejador del botón "Iniciar Partido" */
function handleStartMatch() {
  var cfg = buildConfigFromForm();

  if (!validateConfig(cfg)) return;

  // Crear el partido con el motor de pádel
  matchState = PadelEngine.createMatch(cfg);

  // Actualizar los labels del saque en el formulario de setup
  // con los nombres reales (para la próxima vez)
  document.getElementById('server-btn-a').textContent = cfg.nameA.split('/')[0].trim() || 'Equipo A';
  document.getElementById('server-btn-b').textContent = cfg.nameB.split('/')[0].trim() || 'Equipo B';

  showScreen('match');
  renderMatch();
}

/** Muestra el modal de confirmación para Reiniciar */
function handleResetConfirm() {
  showModal(
    'Reiniciar Partido',
    'El marcador volverá a 0. Se perderá el progreso actual.',
    function () {
      // Reiniciar con la misma configuración
      matchState = PadelEngine.createMatch(matchState.config);
      showScreen('match');
      renderMatch();
    }
  );
}

/** Muestra el modal de confirmación para Finalizar */
function handleFinishConfirm() {
  showModal(
    'Finalizar Partido',
    'El partido se dará por terminado con el marcador actual. El equipo con más sets ganados será el ganador.',
    function () {
      dispatch('finishMatch');
    }
  );
}

/** Manejador del botón "Nuevo Partido" (desde pantalla de finalizado) */
function handleNewMatch() {
  matchState = null;
  showScreen('setup');
}

/** Manejador del botón "Volver al Marcador" (desde pantalla de finalizado) */
function handleBackToMatch() {
  if (matchState) {
    showScreen('match');
    renderMatch();
  }
}

// ─────────────────────────────────────────────────────────────────
// MODAL DE CONFIRMACIÓN
// ─────────────────────────────────────────────────────────────────

/** Muestra el modal con título, mensaje y callback al confirmar */
function showModal(title, message, onConfirm) {
  document.getElementById('modal-title').textContent   = title;
  document.getElementById('modal-message').textContent = message;
  modalCallback = onConfirm;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

/** Cierra el modal sin ejecutar el callback */
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalCallback = null;
}

/** Cierra el modal y ejecuta el callback */
function confirmModal() {
  closeModal();
  if (typeof modalCallback === 'function') {
    modalCallback();
  }
  modalCallback = null;
}

// ─────────────────────────────────────────────────────────────────
// INICIALIZACIÓN DE GRUPOS DE SELECCIÓN (Pill / Toggle)
// ─────────────────────────────────────────────────────────────────

/**
 * Convierte un grupo de botones en un selector de opción única.
 * Al pulsar un botón, se le añade la clase 'selected' y se la
 * quita a los demás del grupo.
 */
function initSelectionGroup(groupId) {
  var group   = document.getElementById(groupId);
  var buttons = group.querySelectorAll('button');

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      buttons.forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');

      // Si el grupo es el de saque inicial, actualizar etiquetas
      // con el nombre del equipo cuando se escriban los inputs
      // (esto se hace automáticamente vía el input listener abajo)
    });
  });
}

/** Actualiza las etiquetas del grupo de saque con los nombres escritos */
function updateServerButtonLabels() {
  var nameA = document.getElementById('input-name-a').value.trim();
  var nameB = document.getElementById('input-name-b').value.trim();

  // Mostrar nombre corto (primer elemento antes del '/')
  var shortA = nameA ? nameA.split('/')[0].trim() : 'Equipo A';
  var shortB = nameB ? nameB.split('/')[0].trim() : 'Equipo B';

  document.getElementById('server-btn-a').textContent = shortA;
  document.getElementById('server-btn-b').textContent = shortB;
}

// ─────────────────────────────────────────────────────────────────
// INICIALIZACIÓN PRINCIPAL (se ejecuta al cargar la página)
// ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {

  // ── Inicializar grupos de selección del formulario ────────────
  initSelectionGroup('group-games-per-set');
  initSelectionGroup('group-total-sets');
  initSelectionGroup('group-scoring');
  initSelectionGroup('group-tiebreak');
  initSelectionGroup('group-server');

  // ── Actualizar etiquetas de saque al escribir nombres ─────────
  document.getElementById('input-name-a').addEventListener('input', updateServerButtonLabels);
  document.getElementById('input-name-b').addEventListener('input', updateServerButtonLabels);

  // ── Botones del formulario de setup ──────────────────────────
  document.getElementById('btn-start-match').addEventListener('click', handleStartMatch);

  // ── Botones del partido ───────────────────────────────────────
  document.getElementById('btn-point-a').addEventListener('click', handlePointA);
  document.getElementById('btn-point-b').addEventListener('click', handlePointB);
  document.getElementById('btn-undo').addEventListener('click', handleUndo);
  document.getElementById('btn-change-server').addEventListener('click', handleChangeServer);
  document.getElementById('btn-reset').addEventListener('click', handleResetConfirm);
  document.getElementById('btn-finish').addEventListener('click', handleFinishConfirm);

  // ── Botones de pantalla "finalizado" ─────────────────────────
  document.getElementById('btn-new-match').addEventListener('click', handleNewMatch);
  document.getElementById('btn-back-to-match').addEventListener('click', handleBackToMatch);

  // ── Modal ────────────────────────────────────────────────────
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-confirm').addEventListener('click', confirmModal);

  // Cerrar modal al pulsar fuera del cuadro
  document.getElementById('modal-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });

  // ── Pantalla inicial ──────────────────────────────────────────
  showScreen('setup');

  // Indicar en la barra de estado que estamos en modo local
  document.getElementById('status-text').textContent = 'Modo local · Sin servidor (Fase 4)';

});
