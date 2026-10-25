/**
 * control.js — Lógica del Panel de Control (iPhone)
 *
 * Responsabilidad:
 *   1. Leer la configuración del formulario de setup
 *   2. Enviar las acciones del operador al servidor (Socket.IO)
 *   3. Renderizar el estado que devuelve el servidor
 *   4. Gestionar confirmaciones para acciones peligrosas
 *   5. Mostrar el estado de la conexión y avisos de error
 *
 * El panel NO calcula el marcador: el único que lo hace es el servidor
 * (server/sports/padel/engine.js). Así el iPhone y la pantalla LED
 * siempre muestran exactamente el mismo estado.
 *
 * FLUJO DE UNA ACCIÓN (ej: "Punto A"):
 *   Botón "PUNTO A"
 *     → handlePointA() → dispatch('pointA')
 *       → sendRequest('pointA', { version })   ← bloquea nuevos toques
 *         → servidor: matchManager → engine.js → nuevo estado
 *         → io.emit('matchUpdate', estado)     ← a TODOS (iPhone + LED)
 *       → socket.on('matchUpdate') → applyServerState() → renderMatch()
 *       → ack { ok: true }                     ← desbloquea los botones
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

/** Estado actual del partido (recibido del servidor). null = no hay partido. */
var matchState = null;

/** Conexión Socket.IO con el servidor (null si no se pudo cargar) */
var socket = null;

/** Tiempo máximo de espera de la respuesta del servidor */
var REQUEST_TIMEOUT_MS = 4000;

/** Retardo antes de atenuar los botones mientras se espera respuesta */
var PENDING_FEEDBACK_DELAY_MS = 250;

/** true mientras una petición espera respuesta (evita doble pulsación) */
var requestPending = false;

/** Timer del aviso visual de "esperando respuesta" */
var pendingFeedbackTimer = null;

/** Timer para ocultar el aviso flotante */
var toastTimer = null;

/** true si el operador pulsó "Nuevo partido": se queda en el setup aunque lleguen actualizaciones */
var editingNewMatch = false;

/** true si el operador volvió al marcador de un partido ya finalizado (para poder deshacer) */
var reviewingFinished = false;

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

  // ── Deshacer: solo si el servidor tiene historial ─────────────
  document.getElementById('btn-undo').disabled = !matchState.canUndo;

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
  if (!matchState) return;

  // Si se finalizó manualmente con empate en sets no hay ganador
  var winner     = matchState.winner;
  var winnerName = winner ? matchState.players[winner].name : 'Sin ganador (empate en sets)';

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

/**
 * Envía una acción del partido al servidor.
 * Incluye la versión del marcador que ve el operador: si otro toque u
 * otro dispositivo ya lo cambió, el servidor la rechaza.
 * La UI se actualiza cuando llega 'matchUpdate'.
 */
function dispatch(action) {
  if (!matchState) return;
  sendRequest(action, { version: matchState.version });
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
    btn.textContent = '↩ DESHACER ÚLTIMA ACCIÓN';
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

  requestStartMatch(cfg, false);
}

/**
 * Pide al servidor que cree el partido.
 * @param {Object}  cfg   - Configuración del formulario
 * @param {boolean} force - true si el operador confirmó reemplazar un partido en curso
 */
function requestStartMatch(cfg, force) {
  sendRequest('setupMatch', { config: cfg, force: force }, {
    onSuccess: function () {
      editingNewMatch = false;
      routeToScreen();
    },
    onError: function (response) {
      // Ya hay un partido jugándose: pedir confirmación antes de pisarlo
      if (response.code === 'MATCH_IN_PROGRESS') {
        showModal(
          'Partido en curso',
          response.message + '. ¿Quieres reemplazarlo por el nuevo? El marcador actual se perderá.',
          function () { requestStartMatch(cfg, true); }
        );
        return true;   // error gestionado aquí
      }
      return false;
    },
  });
}

/** Muestra el modal de confirmación para Reiniciar */
function handleResetConfirm() {
  showModal(
    'Reiniciar Partido',
    'El marcador volverá a 0. Se perderá el progreso actual.',
    function () {
      // El servidor reinicia con la misma configuración y nombres
      if (!matchState) return;
      sendRequest('resetMatch', { version: matchState.version });
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
  // El partido finalizado sigue en el servidor (y en la LED) hasta
  // que el operador inicie el siguiente
  editingNewMatch   = true;
  reviewingFinished = false;
  showScreen('setup');
}

/** Manejador del botón "Volver al Marcador" (desde pantalla de finalizado) */
function handleBackToMatch() {
  // Permite ver el marcador final y, si hubo un error, DESHACER el último punto
  reviewingFinished = true;
  routeToScreen();
}

// ─────────────────────────────────────────────────────────────────
// COMUNICACIÓN CON EL SERVIDOR (Socket.IO)
// ─────────────────────────────────────────────────────────────────

/**
 * Abre la conexión y registra los eventos del servidor.
 * Socket.IO reconecta solo; al reconectar, el servidor reenvía
 * 'matchUpdate' con el estado actual, así el panel se resincroniza.
 */
function connectToServer() {
  // /socket.io/socket.io.js no cargó → el servidor no estaba disponible
  if (typeof io !== 'function') {
    setConnectionStatus('offline', 'Servidor no disponible · Reintentando…');
    setTimeout(function () { window.location.reload(); }, 3000);
    return;
  }

  socket = io();

  socket.on('connect', function () {
    setConnectionStatus('connected', 'Conectado');
  });

  socket.on('disconnect', function () {
    setConnectionStatus('offline', 'Desconectado · Reconectando…');
    showToast('Conexión perdida. Reconectando…', true);
  });

  socket.on('serverConnected', function (data) {
    setConnectionStatus('connected', 'Conectado · ' + data.clientsCount + ' dispositivo(s)');
  });

  socket.on('clientsCount', function (count) {
    if (socket.connected) {
      setConnectionStatus('connected', 'Conectado · ' + count + ' dispositivo(s)');
    }
  });

  socket.on('matchUpdate', applyServerState);
}

/**
 * Envía una petición al servidor y espera su acuse de recibo (ack).
 *
 * Protecciones:
 *   - Sin conexión → no se envía (Socket.IO la guardaría y la enviaría
 *     tarde, al reconectar, cuando el marcador ya podría ser otro).
 *   - Petición en curso → se ignoran nuevos toques (doble pulsación).
 *   - Sin respuesta en REQUEST_TIMEOUT_MS → aviso al operador.
 *
 * @param {string} eventName - Evento de Socket.IO ('pointA', 'setupMatch'...)
 * @param {Object} payload   - Datos a enviar
 * @param {Object} [handlers]
 * @param {Function} [handlers.onSuccess] - Si el servidor respondió ok
 * @param {Function} [handlers.onError]   - Recibe la respuesta de error;
 *                                          devuelve true si la gestionó
 */
function sendRequest(eventName, payload, handlers) {
  handlers = handlers || {};

  if (!socket || !socket.connected) {
    showToast('Sin conexión con el servidor. Espera a que se reconecte.', true);
    return;
  }
  if (requestPending) return;

  setRequestPending(true);

  socket.timeout(REQUEST_TIMEOUT_MS).emit(eventName, payload, function (err, response) {
    setRequestPending(false);

    if (err) {
      // La acción pudo aplicarse o no: el siguiente 'matchUpdate' lo aclarará
      showToast('El servidor no respondió. Revisa el marcador antes de seguir.', true);
      return;
    }
    if (response.ok) {
      if (handlers.onSuccess) handlers.onSuccess();
      return;
    }
    if (handlers.onError && handlers.onError(response)) return;
    handleRequestError(response);
  });
}

/** Gestión por defecto de una respuesta de error del servidor */
function handleRequestError(response) {
  showToast(response.message || 'No se pudo completar la acción', true);

  // El servidor envía su estado actual para que el panel se resincronice
  if (response.state !== undefined) applyServerState(response.state);
}

/** Bloquea/desbloquea nuevas peticiones y muestra feedback si tarda */
function setRequestPending(isPending) {
  requestPending = isPending;
  clearTimeout(pendingFeedbackTimer);

  if (isPending) {
    pendingFeedbackTimer = setTimeout(function () {
      document.body.classList.add('is-pending');
    }, PENDING_FEEDBACK_DELAY_MS);
  } else {
    document.body.classList.remove('is-pending');
  }
}

/**
 * Punto de entrada de TODO estado que llega del servidor.
 * @param {Object|null} state - null si el servidor no tiene partido
 */
function applyServerState(state) {
  // El servidor ya no tiene partido (ej. se reinició) pero el panel mostraba uno
  if (!state && matchState) {
    showToast('No hay ningún partido activo en el servidor', true);
  }

  matchState = state || null;
  routeToScreen();
}

/** Decide qué pantalla mostrar según el estado del partido */
function routeToScreen() {
  // El operador está preparando un partido nuevo: no interrumpirle
  if (editingNewMatch || !matchState) {
    showScreen('setup');
    return;
  }

  if (matchState.status === 'finished' && !reviewingFinished) {
    renderFinished();
    showScreen('finished');
    return;
  }

  // Si se deshizo el final del partido, ya no estamos "revisando"
  if (matchState.status !== 'finished') reviewingFinished = false;

  renderMatch();
  showScreen('match');
}

/** Actualiza el punto y el texto de la barra de estado */
function setConnectionStatus(kind, text) {
  var dot = document.getElementById('status-dot');
  dot.classList.toggle('connected', kind === 'connected');
  dot.classList.toggle('offline',   kind === 'offline');
  document.getElementById('status-text').textContent = text;
  document.body.classList.toggle('is-offline', kind === 'offline');
}

/** Muestra un aviso flotante durante unos segundos */
function showToast(message, isError) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', !!isError);
  toast.classList.remove('hidden');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.classList.add('hidden');
  }, 3500);
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
  // Guardamos el callback ANTES de cerrar: closeModal() lo pone a null
  var callback = modalCallback;
  closeModal();
  if (typeof callback === 'function') {
    callback();
  }
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

  // ── Pantalla inicial y conexión ──────────────────────────────
  // Si hay un partido en el servidor, 'matchUpdate' llevará al marcador
  showScreen('setup');
  connectToServer();

});
