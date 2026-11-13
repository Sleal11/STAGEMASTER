/**
 * control.js — Teléfono del árbitro (control.html)
 *
 * Responsabilidad:
 *   1. Vincular el teléfono a UNA pista con su CÓDIGO (QR único de la estación)
 *   2. Mostrar siempre qué pista controla (barra de color fija)
 *   3. Leer la configuración del formulario de setup
 *   4. Enviar las acciones del árbitro al servidor (Socket.IO)
 *   5. Renderizar el estado que devuelve el servidor
 *   6. Confirmaciones para acciones peligrosas, estado de conexión y avisos
 *   7. Pausar / reanudar el partido (en pausa no se puede puntuar)
 *
 * El teléfono NO calcula el marcador: lo hace el servidor
 * (server/sports/padel/engine.js), así teléfono, pantallas y estación
 * muestran exactamente el mismo estado.
 *
 * VINCULACIÓN:
 *   Código de la pista → el servidor sabe qué pista es y devuelve un token → se guarda en el teléfono
 *   (localStorage) y se envía al reconectar. Si la estación desvincula el
 *   teléfono o otro lo reemplaza, llega 'controllerRevoked' y se vuelve a
 *   la pantalla de vinculación.
 *
 * FLUJO DE UNA ACCIÓN (ej: "Punto A" en la Pista 1):
 *   Botón "PUNTO A"
 *     → handlePointA() → dispatch('pointA')
 *       → sendRequest('matchAction', { matchId: 'pista-1', action, version })
 *         → servidor: ¿teléfono vinculado a pista-1? → Match → engine.js
 *         → 'matchUpdate' SOLO a la sala de pista-1 (este teléfono + sus pantallas)
 *       → applyServerState() → renderMatch()
 *       → ack { ok: true }   ← desbloquea los botones
 *
 * Módulo ES: comparte el formato del marcador, el logo y los iconos con
 * la estación y las pantallas (js/common/).
 */

import * as ScoreFormat from './common/score-format.js';
import { applyLogo }    from './common/brand.js';
import { icon, esc }    from './common/ui.js';
import { followTheme }  from './common/theme.js';

// ─────────────────────────────────────────────────────────────────
// ESTADO GLOBAL DEL PANEL
// ─────────────────────────────────────────────────────────────────

/** Clave donde el teléfono guarda su token de vinculación */
var TOKEN_STORAGE_KEY = 'stagemaster.controllerToken';

/** Pista que controla este teléfono: { matchId, label, color } o null si no está vinculado */
var myCourt = null;

/** Dígitos del código de pista tecleados */
var pinDigits = '';

/** Tiempo que se ve la confirmación «Conectado a PISTA X» */
var PAIRED_CONFIRM_MS = 1600;

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

/** Une los dos jugadores de una pareja: "Jose V / Santiago R" (el 2º es opcional) */
function readTeamName(firstId, secondId) {
  return [firstId, secondId]
    .map(function (id) { return document.getElementById(id).value.trim(); })
    .filter(Boolean)
    .join(' / ');
}

/** Construye el objeto de configuración desde el formulario de setup */
function buildConfigFromForm() {
  return {
    nameA:         readTeamName('input-name-a', 'input-name-a2'),
    nameB:         readTeamName('input-name-b', 'input-name-b2'),
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
  var screens = ['pair', 'setup', 'match', 'finished'];
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

/** Renderiza el estado completo del partido en la pantalla de control */
function renderMatch() {
  if (!matchState) return;

  var p      = matchState.players;
  var server = matchState.server;
  var paused = !!matchState.paused;

  // ── Nombres ──────────────────────────────────────────────────
  document.getElementById('team-name-a-match').textContent = p.A.name;
  document.getElementById('team-name-b-match').textContent = p.B.name;
  document.getElementById('btn-point-a-name').textContent  = p.A.name;
  document.getElementById('btn-point-b-name').textContent  = p.B.name;

  // ── Puntos ───────────────────────────────────────────────────
  // El motor ya guarda 0/15/30/40/'AD' (y números en el tie break)
  document.getElementById('pts-a').textContent = String(p.A.points);
  document.getElementById('pts-b').textContent = String(p.B.points);

  // ── Games ────────────────────────────────────────────────────
  document.getElementById('games-a').textContent = p.A.games;
  document.getElementById('games-b').textContent = p.B.games;

  // ── Sets ─────────────────────────────────────────────────────
  document.getElementById('sets-a').textContent = p.A.sets;
  document.getElementById('sets-b').textContent = p.B.sets;

  // ── Deshacer: solo si el servidor tiene historial ─────────────
  document.getElementById('btn-undo').disabled = !matchState.canUndo;

  // ── Pausa (o partido ya terminado): sin puntos ni cambio de saque ──
  var finished = matchState.status === 'finished';
  ['btn-point-a', 'btn-point-b', 'btn-change-server'].forEach(function (id) {
    document.getElementById(id).disabled = paused || finished;
  });
  var pauseBtn = document.getElementById('btn-pause');
  pauseBtn.innerHTML = paused ? icon('play') + 'Reanudar' : icon('pause') + 'Pausar';
  pauseBtn.classList.toggle('is-resume', paused);
  pauseBtn.disabled = finished;
  document.getElementById('paused-banner').classList.toggle('hidden', !paused);

  // Partido terminado (revisando el marcador): "Finalizar" pasa a "Resultado"
  // para volver a la pantalla final y desde ahí empezar un partido nuevo
  document.getElementById('btn-finish').innerHTML = icon('flag') + (finished ? 'Resultado' : 'Finalizar');

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

  setLabel.textContent = ScoreFormat.isDecidingSuperTiebreak(matchState)
    ? 'SUPER TIE BREAK DECISIVO'
    : 'SET ' + matchState.currentSet + ' · EN CURSO';

  // MATCH POINT / SET POINT / PUNTO DE ORO / TIE BREAK (texto compartido con las pantallas)
  var badgeInfo = ScoreFormat.badgeFor(matchState);
  badge.classList.toggle('hidden', !badgeInfo);
  ['set', 'match', 'gold'].forEach(function (kind) {
    badge.classList.toggle('is-' + kind, !!badgeInfo && badgeInfo.kind === kind);
  });
  if (badgeInfo) badge.textContent = badgeInfo.text;

  // ── Historial de sets ────────────────────────────────────────
  var historyEl = document.getElementById('set-history');
  if (matchState.setScores.length > 0) {
    historyEl.textContent = matchState.setScores
      .map(ScoreFormat.formatSetScore)
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

  // Resultado por set y estadísticas: el mismo resumen que la pantalla
  var sum = ScoreFormat.summaryFromState(matchState);
  document.getElementById('final-sets').textContent = sum.sets.join(' · ');
  var head = '<div class="fs-row fs-head"><span>' + esc(ScoreFormat.splitTeamName(sum.names.A)[0]) + '</span><span></span><span>' +
    esc(ScoreFormat.splitTeamName(sum.names.B)[0]) + '</span></div>';
  var rows = sum.rows.map(function (r) {
    return '<div class="fs-row"><span class="fs-val' + (r.A > r.B ? ' is-lead' : '') + '">' + r.A + '</span>' +
      '<span class="fs-label">' + esc(r.label) + '</span>' +
      '<span class="fs-val' + (r.B > r.A ? ' is-lead' : '') + '">' + r.B + '</span></div>';
  }).join('');
  var duration = sum.duration
    ? '<div class="fs-duration">' + icon('clock') + 'Duración: ' + esc(sum.duration) + '</div>' : '';
  document.getElementById('final-stats').innerHTML = head + rows + duration;
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
  if (!matchState || !myCourt) return;
  sendRequest('matchAction', { matchId: myCourt.matchId, action: action, version: matchState.version });
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
    btn.innerHTML = icon('alert') + 'CONFIRMAR DESHACER';
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
    btn.innerHTML = icon('undo') + 'DESHACER ÚLTIMA ACCIÓN';
    btn.classList.remove('confirming');
  }
}

/** Manejador del botón "Cambiar Saque" */
function handleChangeServer() {
  dispatch('changeServer');
}

/** Pausar / Reanudar (lesión, lluvia, revisión…): en pausa no se puede puntuar */
function handlePause() {
  if (!matchState) return;
  resetUndoConfirm();
  dispatch(matchState.paused ? 'resume' : 'pause');
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
  if (!myCourt) return;
  sendRequest('setupMatch', { matchId: myCourt.matchId, config: cfg, force: force }, {
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
      if (!matchState || !myCourt) return;
      sendRequest('resetMatch', { matchId: myCourt.matchId, version: matchState.version });
    }
  );
}

/** Muestra el modal de confirmación para Finalizar (o el resultado, si ya terminó) */
function handleFinishConfirm() {
  if (matchState && matchState.status === 'finished') {
    reviewingFinished = false;
    routeToScreen();
    return;
  }
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

  // El token (si lo hay) se envía al conectar y en cada reconexión
  var token = readToken();
  socket = io({ auth: token ? { role: 'controller', token: token } : { role: 'controller' } });

  followTheme(socket, 'ui');
  socket.on('connect', function () {
    setConnectionStatus('connected', myCourt ? 'Conectado · ' + myCourt.label : 'Conectado');
    // Sin token: código de pista. Con token: el servidor responderá con
    // 'controllerSession' (sigue vinculado) o 'controllerRevoked'.
    if (!socket.auth.token) showPairing();
  });

  socket.on('disconnect', function () {
    setConnectionStatus('offline', 'Desconectado · Reconectando…');
    showToast('Conexión perdida. Reconectando…', true);
  });

  // El servidor confirma la pista de este teléfono (al vincular y al reconectar)
  socket.on('controllerSession', function (session) {
    myCourt = session;
    showCourtBanner();
    setConnectionStatus('connected', 'Conectado · ' + session.label);
  });

  // Este teléfono perdió el permiso (desvinculado o reemplazado por otro)
  socket.on('controllerRevoked', function (data) {
    forgetPairing();
    showToast(data.message || 'Este teléfono ya no controla ninguna pista.', true);
    showPairing();
  });

  socket.on('matchUpdate', function (payload) {
    // Solo el partido de ESTE teléfono (el servidor ya filtra; doble protección)
    if (!myCourt || payload.matchId !== myCourt.matchId) return;
    applyServerState(payload.state);
  });
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
    if (handlers.onResult) handlers.onResult({ ok: false });
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
    if (handlers.onResult) handlers.onResult(response);
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
  // Sin permiso: volver a vincular (el servidor también envía 'controllerRevoked')
  if (response.code === 'NOT_PAIRED') {
    forgetPairing();
    showPairing();
  }
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
  // Teléfono sin vincular: primero el código de la pista
  if (!myCourt) {
    showPairing();
    return;
  }

  // El árbitro está preparando un partido nuevo: no interrumpirle
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
  // Hay dos barras de estado: la del marcador y la de vinculación
  [['status-dot', 'status-text'], ['pair-status-dot', 'pair-status-text']].forEach(function (ids) {
    var dot = document.getElementById(ids[0]);
    dot.classList.toggle('connected', kind === 'connected');
    dot.classList.toggle('offline',   kind === 'offline');
    document.getElementById(ids[1]).textContent = text;
  });
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
// VINCULACIÓN CON UNA PISTA (PIN)
// ─────────────────────────────────────────────────────────────────

/** El token se guarda en el teléfono; si el navegador lo impide, se pide el PIN otra vez */
function readToken() {
  try { return window.localStorage.getItem(TOKEN_STORAGE_KEY); } catch (e) { return null; }
}

function saveToken(token) {
  try { window.localStorage.setItem(TOKEN_STORAGE_KEY, token); } catch (e) { /* solo esta sesión */ }
}

/** Olvida la vinculación (token, pista y partido) */
function forgetPairing() {
  try { window.localStorage.removeItem(TOKEN_STORAGE_KEY); } catch (e) { /* sin acción */ }
  if (socket) socket.auth = { role: 'controller' };
  myCourt    = null;
  matchState = null;
  editingNewMatch   = false;
  reviewingFinished = false;
  document.getElementById('court-banner').classList.add('hidden');
}

/** Barra fija con el nombre y el color de la pista de este teléfono */
function showCourtBanner() {
  var banner = document.getElementById('court-banner');
  banner.style.setProperty('--court-color', myCourt.color);
  document.getElementById('court-banner-name').textContent = myCourt.label;
  banner.classList.remove('hidden');
}

/** Pantalla de acceso: el código de la pista */
function showPairing() {
  showScreen('pair');
  pinDigits = '';
  renderPin();
}

function renderPin() {
  var cells = document.querySelectorAll('#pin-display .pin-digit');
  Array.prototype.forEach.call(cells, function (cell, i) {
    var filled = !!pinDigits.charAt(i);
    cell.textContent = pinDigits.charAt(i);
    cell.classList.toggle('is-filled', filled);
  });
}

/** Teclado numérico del código; al completar 4 dígitos se envía solo */
function handlePinKey(key) {
  if (key === 'back') pinDigits = pinDigits.slice(0, -1);
  else if (key === 'clear') pinDigits = '';
  else if (pinDigits.length < 4) pinDigits += key;
  document.getElementById('pin-error').classList.add('hidden');
  renderPin();
  if (pinDigits.length === 4) submitPin(pinDigits, false);
}

/**
 * Envía el código de pista al servidor: él decide la pista.
 * @param {string}  code  - Código de 4 cifras
 * @param {boolean} force - true si el árbitro confirmó reemplazar a otro teléfono conectado
 */
function submitPin(code, force) {
  var keypad = document.getElementById('pin-keypad');
  keypad.classList.add('is-busy');

  sendRequest('pair', {
    code:       code,
    deviceName: guessDeviceName(),
    force:      force,
  }, {
    // La respuesta con el token llega en onResult
    onResult: function (response) {
      keypad.classList.remove('is-busy');
      if (!response.ok) return;
      saveToken(response.token);
      socket.auth = { role: 'controller', token: response.token };
      // 'controllerSession' y 'matchUpdate' llegan del servidor: abrir el marcador
      myCourt = { matchId: response.matchId, label: response.label, color: response.color };
      showCourtBanner();
      showPairedConfirmation(myCourt);
    },
    onError: function (response) {
      keypad.classList.remove('is-busy');
      if (response.code === 'CONTROLLER_ACTIVE') {
        // Se vacía el código: si cancela, puede escribir otro
        pinDigits = '';
        renderPin();
        showModal('Pista ocupada', response.message, function () { submitPin(code, true); });
        return true;
      }
      showPinError(response.message);
      return true;
    },
  });
}

/** «Conectado a PISTA X» en grande, con su color; después, su marcador */
function showPairedConfirmation(court) {
  var overlay = document.getElementById('paired-overlay');
  overlay.style.setProperty('--court-color', court.color);
  document.getElementById('paired-court').textContent = court.label;
  overlay.classList.remove('hidden');
  setTimeout(function () {
    overlay.classList.add('hidden');
    routeToScreen();
  }, PAIRED_CONFIRM_MS);
}

function showPinError(message) {
  pinDigits = '';
  renderPin();
  var display = document.getElementById('pin-display');
  display.classList.remove('is-error');
  void display.offsetWidth;
  display.classList.add('is-error');
  var error = document.getElementById('pin-error');
  error.textContent = message;
  error.classList.remove('hidden');
}

/** Nombre del teléfono que verá la estación (orientativo) */
function guessDeviceName() {
  var ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  return 'Teléfono';
}

/** "Cambiar de pista": desvincula este teléfono (con confirmación) */
function handleChangeCourt() {
  if (!myCourt) return;
  showModal(
    'Cambiar de pista',
    'Este teléfono dejará de controlar ' + myCourt.label + '. Para dirigir otra pista (o volver a esta) escribirás su código.',
    function () {
      sendRequest('unpair', {}, {
        onSuccess: function () {
          forgetPairing();
          showPairing();
        },
      });
    }
  );
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

/** Explica el sistema de puntuación elegido */
function updateScoringHelp() {
  document.getElementById('scoring-help').textContent = ScoreFormat.SCORING_HELP[getSelectedValue('group-scoring')];
}

/** Actualiza las etiquetas del grupo de saque con los nombres escritos */
function updateServerButtonLabels() {
  // Nombre corto: el primer jugador de cada pareja
  var shortA = document.getElementById('input-name-a').value.trim() || 'Pareja A';
  var shortB = document.getElementById('input-name-b').value.trim() || 'Pareja B';

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
  document.getElementById('group-scoring').addEventListener('click', updateScoringHelp);
  updateScoringHelp();

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
  document.getElementById('btn-pause').addEventListener('click', handlePause);
  document.getElementById('btn-reset').addEventListener('click', handleResetConfirm);
  document.getElementById('btn-finish').addEventListener('click', handleFinishConfirm);

  document.getElementById('btn-change-court').addEventListener('click', handleChangeCourt);

  // ── Acceso: teclado del código de pista ───────────────────────
  document.querySelectorAll('#pin-keypad .pin-key').forEach(function (key) {
    key.addEventListener('click', function () { handlePinKey(key.getAttribute('data-key')); });
  });

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
  // Con token guardado, el servidor devolverá la pista y su marcador;
  // sin token, 'connect' muestra la vinculación.
  showScreen('pair');
  applyLogo();
  connectToServer();

});
