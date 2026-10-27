/**
 * score.js — Pantalla de score y publicidad (score.html?pantalla=N)
 *
 * Responsabilidad: PRESENTACIÓN. Nunca modifica el partido.
 *   1. Se conecta como pantalla N (role: 'display')
 *   2. Recibe su configuración ('screenConfig'): partido, modo, publicidad
 *   3. Recibe el estado de SU partido ('matchUpdate') y lo dibuja
 *   4. Rota la publicidad (franja inferior o pantalla completa)
 *   5. Informa a la estación de su resolución, de la versión dibujada
 *      (sincronización) y de los anuncios que fallan ('display:report')
 *
 * FLUJO (el árbitro de la Pista 1 suma un punto):
 *   teléfono → servidor → 'matchUpdate' a la sala match:pista-1
 *     → solo las pantallas que muestran la Pista 1 lo reciben
 *     → renderScore() → animaciones → 'display:report' (versión dibujada)
 *
 * Relación con otros archivos:
 *   ← server/realtime/socketServer.js
 *   → js/score-format.js (textos), css/score.css (clases de estado)
 */

'use strict';

// ─────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────

/** Tamaño mínimo de un nombre respecto a su tamaño normal antes de abreviarlo */
var NAME_SCALE_BEFORE_ABBREVIATING = 0.8;

/** Tamaño mínimo absoluto de un nombre (nunca más pequeño que esto) */
var NAME_SCALE_MIN = 0.6;

/** Duración del cartel de identificación */
var IDENTIFY_MS = 6000;

/** Duración máxima de un vídeo publicitario antes de pasar al siguiente */
var VIDEO_MAX_MS = 120000;

var ANIM = {
  point:  'anim-point',
  game:   'anim-game',
  set:    'anim-set',
  row:    'anim-row',
  chip:   'anim-chip',
  winner: 'anim-winner',
};

// ─────────────────────────────────────────────────────────────────
// ESTADO DE LA VISTA
// ─────────────────────────────────────────────────────────────────

var socket       = null;
var screenId     = readScreenId();
var screenConfig = null;   // Configuración recibida de la estación
var lastState    = null;   // Último estado del partido dibujado
var dom          = {};
var bannerAds    = null;   // Rotador de la franja
var fullAds      = null;   // Rotador de pantalla completa
var identifyTimer = null;

// ─────────────────────────────────────────────────────────────────
// INICIALIZACIÓN
// ─────────────────────────────────────────────────────────────────

/** ?pantalla=2 → 'pantalla-2' (por defecto la 1) */
function readScreenId() {
  var params = new URLSearchParams(window.location.search);
  var value  = params.get('pantalla') || params.get('screen') || '1';
  return /^pantalla-/.test(value) ? value : 'pantalla-' + value;
}

function cacheDom() {
  dom.display      = document.getElementById('display');
  dom.court        = document.getElementById('d-court');
  dom.badge        = document.getElementById('d-badge');
  dom.waiting      = document.getElementById('d-waiting');
  dom.waitingCourt = document.getElementById('d-waiting-court');
  dom.board        = document.getElementById('d-board');
  dom.dividerLabel = document.getElementById('d-divider-label');
  dom.history      = document.getElementById('d-history');
  dom.fullad       = document.getElementById('d-fullad');
  dom.banner       = document.getElementById('d-banner');
  dom.identify     = document.getElementById('d-identify');

  ['A', 'B'].forEach(function (side) {
    var id = side.toLowerCase();
    dom[side] = {
      row:   document.getElementById('row-' + id),
      names: document.getElementById('names-' + id),
      pts:   document.getElementById('pts-' + id),
      games: document.getElementById('games-' + id),
      sets:  document.getElementById('sets-' + id),
    };
  });
}

/**
 * Conexión con el servidor. Socket.IO reconecta solo; al reconectar el
 * servidor reenvía la configuración y el estado. Si se pierde la conexión
 * NO se borra nada: el público sigue viendo el último marcador.
 */
function connectToServer() {
  if (typeof io !== 'function') {
    console.error('[Pantalla] Socket.IO no disponible. Reintentando en 3 s...');
    setTimeout(function () { window.location.reload(); }, 3000);
    return;
  }

  socket = io({ auth: { role: 'display', screenId: screenId } });

  socket.on('connect_error', function (err) {
    if (err.data && err.data.code === 'UNKNOWN_SCREEN') {
      dom.waitingCourt.textContent = 'Pantalla no válida';
      console.error('[Pantalla] ' + err.message + '. Usa score.html?pantalla=1 o ?pantalla=2');
    }
  });

  socket.on('screenConfig', applyScreenConfig);
  socket.on('matchUpdate', function (payload) {
    // Solo el partido asignado (protección extra; el servidor ya filtra por sala)
    if (!screenConfig || payload.matchId !== screenConfig.matchId) return;
    renderScore(payload.state);
  });
  socket.on('identify', showIdentify);
}

// ─────────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE LA PANTALLA (enviada por la estación, en vivo)
// ─────────────────────────────────────────────────────────────────

function applyScreenConfig(config) {
  var matchChanged = !screenConfig || screenConfig.matchId !== config.matchId;
  screenConfig = config;
  if (matchChanged) lastState = null;   // Otro partido: no animar el cambio

  dom.court.textContent = config.matchLabel;
  dom.court.style.setProperty('--court-color', config.matchColor);
  dom.waitingCourt.textContent = config.matchLabel;

  bannerAds.setItems(config.mode === 'scoreAds' ? config.ads.banner : [], config.adInterval);
  fullAds.setItems(config.mode === 'score' ? [] : config.ads.fullscreen, config.adInterval);
  updateLayout();
}

/**
 * Decide qué se ve según el modo, si hay partido y si hay publicidad
 * que funcione:
 *   'ads'      → publicidad a pantalla completa (o espera si no hay)
 *   'scoreAds' → marcador + franja; sin partido → publicidad completa
 *   'score'    → solo marcador
 */
function updateLayout() {
  if (!screenConfig) return;
  var hasMatch   = !!lastState;
  var mode       = screenConfig.mode;
  var showFullAd = fullAds.hasPlayable() && (mode === 'ads' || (mode === 'scoreAds' && !hasMatch));
  var showBanner = mode === 'scoreAds' && hasMatch && bannerAds.hasPlayable();

  dom.display.classList.toggle('is-fullad', showFullAd && mode === 'ads');
  dom.fullad.classList.toggle('hidden', !showFullAd);
  dom.display.classList.toggle('has-banner', showBanner);
  dom.banner.classList.toggle('hidden', !showBanner);
  dom.board.classList.toggle('hidden', !hasMatch || showFullAd);
  dom.waiting.classList.toggle('hidden', hasMatch || showFullAd);

  fullAds.setActive(showFullAd);
  bannerAds.setActive(showBanner);

  // El espacio del marcador cambió (aparece/desaparece la franja): reajustar nombres
  if (hasMatch && !showFullAd) fitAllNames();
  sendReport();
}

// ─────────────────────────────────────────────────────────────────
// MARCADOR
// ─────────────────────────────────────────────────────────────────

function renderScore(state) {
  var previous = lastState;
  lastState = isValidState(state) ? state : null;

  if (!lastState) {
    dom.badge.classList.add('hidden');
    updateLayout();
    return;
  }

  var finished = state.status === 'finished';
  renderTeam(state, 'A', finished);
  renderTeam(state, 'B', finished);
  renderBadge(state);
  dom.dividerLabel.textContent = finished ? (state.winner ? 'GANADOR' : 'PARTIDO FINALIZADO') : '';
  renderHistory(state, finished);
  updateLayout();
  animateChanges(previous, state);
}

function renderTeam(state, side, finished) {
  var player = state.players[side];
  var el     = dom[side];

  renderNames(el.names, player.name);
  el.sets.textContent  = player.sets;
  el.games.textContent = finished ? '–' : player.games;
  el.pts.textContent   = finished ? '–' : String(player.points);
  el.games.classList.toggle('is-empty', finished);
  el.pts.classList.toggle('is-empty', finished);
  el.pts.classList.toggle('is-advantage', !finished && player.points === 'AD');

  el.row.classList.toggle('is-serving', !finished && state.server === side);
  el.row.classList.toggle('is-winner',  finished && state.winner === side);
  el.row.classList.toggle('is-loser',   finished && state.winner !== null && state.winner !== side);
}

function renderBadge(state) {
  var badge = ScoreFormat.badgeFor(state);
  dom.badge.classList.toggle('hidden', !badge);
  if (!badge) return;
  dom.badge.textContent = badge.text;
  dom.badge.classList.toggle('is-gold', badge.gold);
}

/**
 * Historial: [SET 1 6-3] [SET 2 7-6 (8-6)] [SET 3 · EN JUEGO]
 * El Súper Tie Break decisivo se muestra como [SUPER TB 10-8].
 */
function renderHistory(state, finished) {
  dom.history.innerHTML = '';
  state.setScores.forEach(function (set, index) {
    if (set.superTiebreak) {
      dom.history.appendChild(buildChip('SUPER TB', set.tiebreak.A + '-' + set.tiebreak.B, null, false));
    } else {
      var detail = set.tiebreak ? '(' + set.tiebreak.A + '-' + set.tiebreak.B + ')' : null;
      dom.history.appendChild(buildChip('SET ' + (index + 1), set.A + '-' + set.B, detail, false));
    }
  });

  if (!finished) {
    var label = ScoreFormat.isDecidingSuperTiebreak(state) ? 'SUPER TB' : 'SET ' + (state.setScores.length + 1);
    dom.history.appendChild(buildChip(label, 'EN JUEGO', null, true));
  }
}

function buildChip(label, score, detail, isCurrent) {
  var chip = document.createElement('div');
  chip.className = 'd-set-chip' + (isCurrent ? ' is-current' : '');
  [[label, 'd-set-chip-label'], [score, ''], [detail, 'd-set-chip-detail']].forEach(function (part) {
    if (!part[0]) return;
    var span = document.createElement('span');
    span.className   = part[1];
    span.textContent = part[0];
    chip.appendChild(span);
  });
  return chip;
}

function isValidState(state) {
  return !!(state && state.players && state.players.A && state.players.B && Array.isArray(state.setScores));
}

// ─────────────────────────────────────────────────────────────────
// NOMBRES: una línea por jugador, ajuste INDIVIDUAL de cada línea
// ─────────────────────────────────────────────────────────────────

/** Crea una línea por jugador ("Jose V / Santiago R" → 2 líneas) */
function renderNames(container, teamName) {
  var players = ScoreFormat.splitTeamName(teamName);
  var key     = players.join('|');
  if (container.dataset.key === key) return;   // Sin cambios: no rehacer

  container.dataset.key = key;
  container.innerHTML   = '';
  container.classList.toggle('is-single', players.length === 1);
  players.forEach(function (player) {
    var line = document.createElement('span');
    line.className    = 'd-name-line';
    line.dataset.full = player;
    container.appendChild(line);
  });
  fitNames(container);
}

function fitAllNames() {
  fitNames(dom.A.names);
  fitNames(dom.B.names);
}

function fitNames(container) {
  Array.prototype.forEach.call(container.children, fitNameLine);
}

/**
 * Ajusta UNA línea sin afectar a las demás (un nombre excepcionalmente
 * largo no encoge a todos):
 *   1. Nombre completo a su tamaño normal
 *   2. Nombre completo reduciendo hasta el 80 %
 *   3. Formato abreviado "Nombre I" ("Santiago R") a tamaño normal → 80 %
 *   4. Reducción hasta el 60 % (mínimo legible)
 *   5. Si aun así no cabe, el CSS corta con "…" (nunca se sale de la caja)
 */
function fitNameLine(line) {
  var full = line.dataset.full;
  line.textContent    = full;
  line.title          = full;
  line.style.fontSize = '';
  if (line.clientWidth === 0) return;   // No visible ahora: se reajusta al mostrarse

  var base = parseFloat(window.getComputedStyle(line).fontSize);
  if (fits(line) || shrinkUntilFits(line, base, NAME_SCALE_BEFORE_ABBREVIATING)) return;

  var short = ScoreFormat.abbreviateName(full);
  if (short !== full) {
    line.textContent    = short;
    line.style.fontSize = '';
    if (fits(line) || shrinkUntilFits(line, base, NAME_SCALE_BEFORE_ABBREVIATING)) return;
  }
  shrinkUntilFits(line, base, NAME_SCALE_MIN);
}

function fits(el) {
  return el.scrollWidth <= el.clientWidth + 1;
}

/** Reduce la letra en pasos del 4 % hasta que quepa o llegue a minScale */
function shrinkUntilFits(el, base, minScale) {
  var size = parseFloat(el.style.fontSize) || base;
  while (!fits(el) && size > base * minScale) {
    size = Math.max(size * 0.96, base * minScale);
    el.style.fontSize = size + 'px';
  }
  return fits(el);
}

// ─────────────────────────────────────────────────────────────────
// PUBLICIDAD
// ─────────────────────────────────────────────────────────────────

/**
 * Rotador de anuncios dentro de un contenedor.
 *   - Imágenes: se muestran adInterval segundos.
 *   - Vídeos: sin sonido, hasta que terminan (máx. 2 min).
 *   - Un anuncio que falla al cargar se salta y se informa a la estación.
 *   - Si todos fallan, el contenedor se oculta y el marcador ocupa su espacio.
 */
function createAdRotator(container) {
  var items = [], intervalMs = 10000, index = -1, timer = null;
  var active = false, signature = '', errors = {}, current = null;

  function playable() {
    return items.filter(function (item) { return !errors[item.url]; });
  }

  function setItems(newItems, seconds) {
    var newSignature = JSON.stringify(newItems.map(function (i) { return i.url; })) + '|' + seconds;
    if (newSignature === signature) return;
    signature  = newSignature;
    items      = newItems.slice();
    intervalMs = seconds * 1000;
    errors     = {};
    restart();
  }

  function setActive(isActive) {
    if (isActive === active) return;
    active = isActive;
    restart();
  }

  function restart() {
    clearTimeout(timer);
    container.innerHTML = '';
    current = null;
    index = -1;
    if (active) next();
  }

  function next() {
    clearTimeout(timer);
    var list = playable();
    if (!active || list.length === 0) return;

    // Un único anuncio que ya se está viendo: no hace falta recargarlo
    if (list.length === 1 && current && current.dataset.url === list[0].url) return;

    do { index = (index + 1) % items.length; } while (errors[items[index].url]);
    show(items[index]);
  }

  function show(item) {
    var el = document.createElement(item.kind === 'video' ? 'video' : 'img');
    el.className   = 'ad-media';
    el.dataset.url = item.url;

    el.onerror = function () {
      errors[item.url] = true;
      el.remove();
      if (current === el) current = null;
      updateLayout();   // Si ya no queda ninguno, se oculta la zona de publicidad
      next();
    };

    var reveal = function () {
      var previous = current;
      current = el;
      el.classList.add('is-visible');
      if (previous) setTimeout(function () { previous.remove(); }, 650);
    };

    if (item.kind === 'video') {
      el.muted = true;
      el.playsInline = true;
      el.autoplay = true;
      el.loop = playable().length === 1;
      el.onloadeddata = reveal;
      el.onended = next;
      timer = setTimeout(next, VIDEO_MAX_MS);
    } else {
      el.onload = reveal;
      timer = setTimeout(next, intervalMs);
    }
    el.src = item.url;
    container.appendChild(el);
  }

  return {
    setItems:    setItems,
    setActive:   setActive,
    hasPlayable: function () { return playable().length > 0; },
    errors:      function () { return Object.keys(errors); },
  };
}

// ─────────────────────────────────────────────────────────────────
// INFORME A LA ESTACIÓN (resolución, sincronización, errores)
// ─────────────────────────────────────────────────────────────────

function sendReport() {
  if (!socket || !socket.connected || !screenConfig) return;
  socket.emit('display:report', {
    viewport:        { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    renderedMatchId: screenConfig.matchId,
    renderedVersion: lastState ? lastState.version : null,
    adErrors:        bannerAds.errors().concat(fullAds.errors()),
  });
}

// ─────────────────────────────────────────────────────────────────
// IDENTIFICACIÓN ("¿cuál es la Pantalla 2?")
// ─────────────────────────────────────────────────────────────────

function showIdentify(data) {
  dom.identify.innerHTML = '';
  [
    [data.label.toUpperCase(), 'd-identify-title'],
    ['Muestra: ' + (screenConfig ? screenConfig.matchLabel : '—'), 'd-identify-sub'],
    [window.innerWidth + ' × ' + window.innerHeight + ' px', 'd-identify-sub'],
  ].forEach(function (part) {
    var div = document.createElement('div');
    div.className   = part[1];
    div.textContent = part[0];
    dom.identify.appendChild(div);
  });
  dom.identify.classList.remove('hidden');
  clearTimeout(identifyTimer);
  identifyTimer = setTimeout(function () { dom.identify.classList.add('hidden'); }, IDENTIFY_MS);
}

// ─────────────────────────────────────────────────────────────────
// ANIMACIONES (solo lo que cambió; nunca al deshacer ni al redimensionar)
// ─────────────────────────────────────────────────────────────────

function animateChanges(previous, state) {
  if (!previous || state.version <= previous.version || !isSameMatch(previous, state)) return;

  ['A', 'B'].forEach(function (side) {
    var before = previous.players[side];
    var now    = state.players[side];
    var el     = dom[side];

    if (now.points !== before.points) playAnimation(el.pts, ANIM.point);
    if (now.sets > before.sets) {
      playAnimation(el.sets, ANIM.set);
      playAnimation(el.row, ANIM.row);
    } else if (now.games > before.games) {
      playAnimation(el.games, ANIM.game);
      playAnimation(el.row, ANIM.row);
    }
  });

  if (state.setScores.length > previous.setScores.length) {
    var chip = dom.history.children[state.setScores.length - 1];
    if (chip) playAnimation(chip, ANIM.chip);
  }
  if (state.status === 'finished' && previous.status !== 'finished' && state.winner) {
    playAnimation(dom[state.winner].row, ANIM.winner);
  }
}

function isSameMatch(a, b) {
  return a.players.A.name === b.players.A.name &&
         a.players.B.name === b.players.B.name &&
         JSON.stringify(a.config) === JSON.stringify(b.config);
}

/** Reproduce una animación CSS desde el principio */
function playAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  el.addEventListener('animationend', function onEnd(event) {
    // 'animationend' sube desde los hijos: solo cuenta la del propio elemento
    if (event.target !== el || event.pseudoElement) return;
    el.classList.remove(className);
    el.removeEventListener('animationend', onEnd);
  });
}

// ─────────────────────────────────────────────────────────────────
// PANTALLA SIEMPRE ENCENDIDA
// ─────────────────────────────────────────────────────────────────

/** Wake Lock: solo disponible en localhost/HTTPS (las pantallas usan localhost) */
function keepScreenAwake() {
  if (!('wakeLock' in navigator)) return;
  function request() {
    navigator.wakeLock.request('screen').catch(function (err) {
      console.warn('[Pantalla] Wake Lock no disponible:', err.message);
    });
  }
  request();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') request();
  });
}

// ─────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  cacheDom();
  bannerAds = createAdRotator(dom.banner);
  fullAds   = createAdRotator(dom.fullad);
  connectToServer();
  keepScreenAwake();

  // Al cambiar la resolución (o entrar en pantalla completa): reajustar e informar
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (lastState) fitAllNames();
      sendReport();
    }, 150);
  });

  // Las tipografías cargan después del primer dibujo: reajustar al terminar
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { if (lastState) fitAllNames(); });
  }
});
