/**
 * station.js — Estación operadora (station.html)
 *
 * Responsabilidad:
 *   1. Conectarse como estación (solo funciona en el propio portátil)
 *   2. Dibujar el estado de los partidos y las pantallas ('stationState')
 *   3. Enviar las órdenes del operador: configurar partidos, asignar
 *      pantallas y publicidad, PIN, desvincular teléfonos, identificar
 *      pantallas y, como respaldo, puntuar desde el portátil
 *
 * El servidor envía 'stationState' cada vez que algo cambia (agrupado,
 * como mucho cada 100 ms), así que esta página siempre refleja el estado
 * real sin recargar.
 *
 * Detalle importante: los controles de cada pantalla (selects, casillas,
 * intervalo) solo se reconstruyen cuando cambia su configuración y nunca
 * mientras el operador los está usando; el estado (conexión, resolución,
 * sincronización) se actualiza siempre.
 */

'use strict';

var REQUEST_TIMEOUT_MS = 4000;

var MODE_LABELS = {
  scoreAds: 'Marcador + publicidad',
  score:    'Solo marcador',
  ads:      'Solo publicidad',
};

var STATUS_LABELS = {
  empty:    'Sin partido',
  playing:  'En juego',
  finished: 'Finalizado',
};

var socket      = null;
var lastState   = null;
var toastTimer  = null;
var setupTarget = null;   // Partido que se está configurando en el diálogo
var backupOpen  = {};     // Desplegable de respaldo abierto/cerrado por el operador (por partido)

// ─────────────────────────────────────────────────────────────────
// CONEXIÓN
// ─────────────────────────────────────────────────────────────────

function connectToServer() {
  if (typeof io !== 'function') {
    setConnection('bad', 'Servidor no disponible · Reintentando…');
    setTimeout(function () { window.location.reload(); }, 3000);
    return;
  }

  socket = io({ auth: { role: 'station' } });

  socket.on('connect', function () {
    setConnection('ok', 'Servidor conectado');
    document.getElementById('st-blocked').classList.add('hidden');
  });
  socket.on('disconnect', function () {
    setConnection('bad', 'Sin conexión con el servidor · Reconectando…');
  });
  socket.on('connect_error', function (err) {
    if (err.data && err.data.code === 'STATION_LOCAL_ONLY') {
      var blocked = document.getElementById('st-blocked');
      blocked.textContent = err.message;
      blocked.classList.remove('hidden');
    }
  });
  socket.on('stationState', function (state) {
    lastState = state;
    render(state);
  });
}

/** Envía una orden y devuelve la respuesta del servidor (o un error) */
function send(eventName, payload) {
  if (!socket || !socket.connected) {
    showToast('Sin conexión con el servidor', true);
    return Promise.resolve({ ok: false, message: 'Sin conexión' });
  }
  return socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck(eventName, payload)
    .catch(function () { return { ok: false, message: 'El servidor no respondió' }; })
    .then(function (response) {
      if (!response.ok && response.code !== 'MATCH_IN_PROGRESS') {
        showToast(response.message || 'No se pudo completar la acción', true);
      }
      return response;
    });
}

// ─────────────────────────────────────────────────────────────────
// DIBUJO
// ─────────────────────────────────────────────────────────────────

function render(state) {
  renderNetwork(state.network);
  document.getElementById('st-matches').innerHTML = state.matches.map(matchCardHtml).join('');
  renderScreens(state);
}

/** Dirección que deben abrir los teléfonos de los árbitros */
function renderNetwork(network) {
  var el = document.getElementById('st-network');
  if (!network.addresses.length) {
    el.innerHTML = '<span>⚠ El portátil no está conectado a ninguna red: los teléfonos no podrán entrar</span>';
    return;
  }
  el.innerHTML = network.addresses.map(function (a) {
    return '<span>📱 Árbitros (' + esc(a.name) + '): <strong>' + esc(a.controlUrl) + '</strong></span>';
  }).join('');
}

// ── Partidos ──────────────────────────────────────────────────────

function matchCardHtml(match) {
  var state  = match.state;
  var status = state ? state.status : 'empty';

  return '' +
    '<article class="st-card" style="--court-color:' + esc(match.color) + '">' +
      '<div class="st-card-head">' +
        '<span class="st-card-name">' + esc(match.label) + '</span>' +
        '<span class="st-chip">' + STATUS_LABELS[status] + (state ? ' · v' + state.version : '') + '</span>' +
      '</div>' +
      '<div class="st-card-body">' +
        scoreHtml(state) +
        phoneHtml(match) +
        '<div class="st-row">' +
          '<button class="st-btn st-btn-primary" data-action="setup" data-match="' + match.id + '">' +
            (state ? 'Nuevo partido…' : 'Configurar partido…') + '</button>' +
          '<button class="st-btn" data-action="reset" data-match="' + match.id + '"' + (state ? '' : ' disabled') + '>Reiniciar</button>' +
          '<button class="st-btn" data-action="finish" data-match="' + match.id + '"' + (status === 'playing' ? '' : ' disabled') + '>Finalizar</button>' +
        '</div>' +
        (state ? backupHtml(match) : '') +
      '</div>' +
    '</article>';
}

function scoreHtml(state) {
  if (!state) return '<div class="st-score"><span class="st-empty">Sin partido configurado</span></div>';
  var finished = state.status === 'finished';

  var row = function (side) {
    var p = state.players[side];
    var cls = 'st-score-name' +
      (!finished && state.server === side ? ' is-serving' : '') +
      (finished && state.winner === side ? ' is-winner' : '');
    return '<span class="' + cls + '" title="' + esc(p.name) + '">' + esc(p.name) + '</span>' +
      '<span class="st-score-num">' + p.sets + '</span>' +
      '<span class="st-score-num">' + (finished ? '–' : p.games) + '</span>' +
      '<span class="st-score-num st-score-pts">' + (finished ? '–' : esc(String(p.points))) + '</span>';
  };

  var badge   = ScoreFormat.badgeFor(state);
  var history = state.setScores.map(ScoreFormat.formatSetScore).join(' · ');

  return '<div class="st-score">' +
      '<span></span><span class="st-score-h">SETS</span><span class="st-score-h">GAMES</span><span class="st-score-h">PUNTOS</span>' +
      row('A') + row('B') +
    '</div>' +
    '<div class="st-history">' + (history ? 'Sets: ' + esc(history) : 'Set 1 en juego') +
      (badge ? ' · <strong>' + badge.text + '</strong>' : '') + '</div>';
}

function phoneHtml(match) {
  var c = match.controller;
  var status;
  if (!c) {
    status = '<span class="st-dot"></span> Sin teléfono vinculado';
  } else if (c.connected) {
    status = '<span class="st-dot ok"></span> ' + esc(c.deviceName) + ' conectado';
  } else {
    status = '<span class="st-dot warn"></span> ' + esc(c.deviceName) + ' desconectado' +
      (c.lastSeen ? ' (hace ' + elapsed(c.lastSeen) + ')' : '');
  }

  return '<div class="st-row st-row-between">' +
      '<span class="st-label">Teléfono</span>' +
      '<span class="st-phone" style="flex:1">' + status + '</span>' +
      (c ? '<button class="st-btn st-btn-ghost" data-action="unpair" data-match="' + match.id + '">Desvincular</button>' : '') +
    '</div>' +
    '<div class="st-row">' +
      '<span class="st-label">PIN</span>' +
      '<span class="st-pin">' + esc(match.pin) + '</span>' +
      '<button class="st-btn st-btn-ghost" data-action="newPin" data-match="' + match.id + '">Nuevo PIN</button>' +
    '</div>';
}

/** Respaldo: puntuar desde el portátil si el teléfono del árbitro falla */
function backupHtml(match) {
  if (match.state.status !== 'playing' && !match.state.canUndo) return '';
  var names = match.state.players;
  var btn = function (action, text, disabled) {
    return '<button class="st-btn" data-action="score" data-score="' + action + '" data-match="' + match.id + '"' +
      (disabled ? ' disabled' : '') + '>' + text + '</button>';
  };
  var playing = match.state.status === 'playing';
  // Abierto por defecto si no hay teléfono conectado; después se respeta lo que elija el operador
  var open = match.id in backupOpen ? backupOpen[match.id] : !(match.controller && match.controller.connected);
  return '<details class="st-backup" data-match="' + match.id + '"' + (open ? ' open' : '') + '>' +
    '<summary>Puntuar desde la estación (respaldo si falla el teléfono)</summary>' +
    '<div class="st-row">' +
      btn('pointA', '+ ' + esc(ScoreFormat.splitTeamName(names.A.name)[0] || 'A'), !playing) +
      btn('pointB', '+ ' + esc(ScoreFormat.splitTeamName(names.B.name)[0] || 'B'), !playing) +
      btn('undo', '↩ Deshacer', !match.state.canUndo) +
      btn('changeServer', 'Cambiar saque', !playing) +
    '</div></details>';
}

// ── Pantallas ─────────────────────────────────────────────────────

function renderScreens(state) {
  var container = document.getElementById('st-screens');

  state.screens.forEach(function (screen) {
    var card = container.querySelector('[data-screen-card="' + screen.id + '"]');
    if (!card) {
      card = document.createElement('article');
      card.className = 'st-card';
      card.setAttribute('data-screen-card', screen.id);
      card.innerHTML = '<div class="st-card-head"><span class="st-card-name"></span><span class="st-chip"></span></div>' +
        '<div class="st-card-body"><div data-part="status"></div><div data-part="controls"></div></div>';
      container.appendChild(card);
    }

    var match = state.matches.find(function (m) { return m.id === screen.matchId; });
    card.style.setProperty('--court-color', match.color);
    card.querySelector('.st-card-name').textContent = screen.label;
    card.querySelector('.st-chip').textContent = 'Muestra ' + screen.matchLabel;
    card.querySelector('[data-part="status"]').innerHTML = screenStatusHtml(screen);

    // Controles: solo si cambió la configuración y el operador no los está usando
    var controls  = card.querySelector('[data-part="controls"]');
    var signature = JSON.stringify([screen.matchId, screen.mode, screen.ads, screen.adInterval, state.ads,
      state.matches.map(function (m) { return m.id; })]);
    if (controls.dataset.signature !== signature && !controls.contains(document.activeElement)) {
      controls.dataset.signature = signature;
      controls.innerHTML = screenControlsHtml(screen, state);
    }
  });
}

function screenStatusHtml(screen) {
  var parts = [];
  var displays = screen.displays;

  if (displays.length === 0) {
    parts.push('<div class="st-row st-row-between"><span class="st-status"><span class="st-dot bad"></span> Sin conexión</span>' +
      '<button class="st-btn st-btn-ghost" data-action="openScreen" data-screen="' + screen.id + '">Abrir ventana</button></div>');
  } else {
    var d = displays[0];
    var size = d.viewport ? d.viewport.width + ' × ' + d.viewport.height + ' px' : 'resolución desconocida';
    var sync = {
      ok:      '<span class="st-dot ok"></span> Marcador al día',
      pending: '<span class="st-dot warn"></span> Actualizando…',
      stale:   '<span class="st-dot bad"></span> ⚠ Desincronizada: no ha dibujado el último marcador',
    }[d.sync];
    parts.push('<div class="st-row st-row-between">' +
      '<span class="st-status"><span class="st-dot ok"></span> Conectada · ' + size + '</span>' +
      '<span class="st-status">' + sync + '</span>' +
      '<button class="st-btn st-btn-ghost" data-action="identify" data-screen="' + screen.id + '">Identificar</button></div>');
    if (displays.length > 1) {
      parts.push('<div class="st-warning">Hay ' + displays.length + ' ventanas abiertas para ' + esc(screen.label) +
        '. Cierra las que sobren.</div>');
    }
    var adErrors = [].concat.apply([], displays.map(function (x) { return x.adErrors; }));
    if (adErrors.length) {
      parts.push('<div class="st-warning">No se pudo mostrar: ' + adErrors.map(function (u) {
        return esc(fileNameOf(u));
      }).join(', ') + ' (archivo dañado o formato no compatible)</div>');
    }
  }
  if (screen.missingAds.length) {
    parts.push('<div class="st-warning">Publicidad asignada que ya no está en la carpeta: ' +
      esc(screen.missingAds.join(', ')) + '</div>');
  }
  return parts.join('');
}

function screenControlsHtml(screen, state) {
  var matchOptions = state.matches.map(function (m) {
    return '<option value="' + m.id + '"' + (m.id === screen.matchId ? ' selected' : '') + '>' + esc(m.label) + '</option>';
  }).join('');

  var modes = Object.keys(MODE_LABELS).map(function (mode) {
    return '<button data-action="mode" data-mode="' + mode + '" data-screen="' + screen.id + '"' +
      (mode === screen.mode ? ' class="is-active"' : '') + '>' + MODE_LABELS[mode] + '</button>';
  }).join('');

  var adList = function (category, title) {
    var items = state.ads[category];
    var body = items.length ? items.map(function (ad) {
      var checked = screen.ads[category].indexOf(ad.name) !== -1 ? ' checked' : '';
      return '<label><input type="checkbox" data-action="ad" data-category="' + category + '" data-screen="' + screen.id +
        '" value="' + esc(ad.name) + '"' + checked + '> ' + (ad.kind === 'video' ? '🎬 ' : '🖼 ') + esc(ad.name) + '</label>';
    }).join('') : '<span class="st-empty">Carpeta vacía</span>';
    return '<div class="st-ads-box"><h4>' + title + '</h4>' + body + '</div>';
  };

  return '' +
    '<div class="st-row"><span class="st-label">Partido</span>' +
      '<select class="st-select" data-action="match" data-screen="' + screen.id + '">' + matchOptions + '</select></div>' +
    '<div class="st-row"><span class="st-label">Modo</span><div class="st-segmented">' + modes + '</div></div>' +
    '<div class="st-ads">' + adList('banner', 'Franja (bajo el marcador)') + adList('fullscreen', 'Pantalla completa') + '</div>' +
    '<div class="st-row"><span class="st-label">Cada imagen</span>' +
      '<input class="st-input st-input-small" type="number" min="3" max="120" value="' + screen.adInterval +
      '" data-action="interval" data-screen="' + screen.id + '"> segundos</div>';
}

// ─────────────────────────────────────────────────────────────────
// ÓRDENES DEL OPERADOR
// ─────────────────────────────────────────────────────────────────

function findMatch(id) {
  return lastState.matches.find(function (m) { return m.id === id; });
}

function findScreen(id) {
  return lastState.screens.find(function (s) { return s.id === id; });
}

function updateScreen(screenId, changes) {
  return send('station:updateScreen', { screenId: screenId, changes: changes }).then(function (res) {
    if (!res.ok) {
      // Restaurar los controles con la configuración real
      var card = document.querySelector('[data-screen-card="' + screenId + '"] [data-part="controls"]');
      if (card) card.dataset.signature = '';
      if (lastState) renderScreens(lastState);
    }
  });
}

/** Clics en botones de las tarjetas (delegación de eventos) */
function onClick(event) {
  // Abrir/cerrar el respaldo: se recuerda en el mismo clic (el evento 'toggle'
  // llega más tarde y la tarjeta puede haberse redibujado entre medias)
  var summary = event.target.closest('details.st-backup > summary');
  if (summary) {
    var details = summary.parentElement;
    backupOpen[details.getAttribute('data-match')] = !details.open;
    return;
  }

  var el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  var matchId  = el.getAttribute('data-match');
  var screenId = el.getAttribute('data-screen');
  var match    = matchId && findMatch(matchId);

  switch (el.getAttribute('data-action')) {
    case 'setup':
      openSetupDialog(match);
      break;
    case 'reset':
      confirmDialog('Reiniciar ' + match.label, 'El marcador volverá a 0 con los mismos jugadores y reglas.', 'Reiniciar')
        .then(function (ok) { if (ok) send('resetMatch', { matchId: matchId, version: findMatch(matchId).state.version }); });
      break;
    case 'finish':
      confirmDialog('Finalizar ' + match.label, 'Se dará por terminado con el marcador actual (gana quien tenga más sets).', 'Finalizar')
        .then(function (ok) { if (ok) scoreAction(matchId, 'finishMatch'); });
      break;
    case 'score':
      scoreAction(matchId, el.getAttribute('data-score'));
      break;
    case 'newPin':
      confirmDialog('Nuevo PIN para ' + match.label,
        'El PIN actual dejará de servir para vincular teléfonos. El teléfono ya vinculado seguirá funcionando.', 'Cambiar PIN')
        .then(function (ok) { if (ok) send('station:newPin', { matchId: matchId }); });
      break;
    case 'unpair':
      confirmDialog('Desvincular teléfono', 'El teléfono de ' + match.label + ' dejará de poder modificar el marcador.', 'Desvincular')
        .then(function (ok) { if (ok) send('station:unpair', { matchId: matchId }); });
      break;
    case 'identify':
      send('station:identify', { screenId: screenId });
      break;
    case 'openScreen':
      window.open('/score.html?pantalla=' + screenId.replace('pantalla-', ''), screenId);
      showToast('Lleva la ventana nueva a su monitor y pulsa F11 (pantalla completa)');
      break;
    case 'mode':
      updateScreen(screenId, { mode: el.getAttribute('data-mode') });
      break;
  }
}

/** Cambios en selects, casillas e intervalo de las pantallas */
function onChange(event) {
  var el = event.target;
  var screenId = el.getAttribute('data-screen');
  if (!screenId) return;

  switch (el.getAttribute('data-action')) {
    case 'match':
      updateScreen(screenId, { matchId: el.value });
      break;
    case 'interval':
      updateScreen(screenId, { adInterval: parseInt(el.value, 10) });
      break;
    case 'ad': {
      var category = el.getAttribute('data-category');
      var boxes = document.querySelectorAll('input[data-action="ad"][data-screen="' + screenId + '"][data-category="' + category + '"]');
      var names = Array.prototype.filter.call(boxes, function (b) { return b.checked; }).map(function (b) { return b.value; });
      var ads = {};
      ads[category] = names;
      updateScreen(screenId, { ads: ads });
      break;
    }
  }
  el.blur();   // Permite que el siguiente estado del servidor redibuje los controles
}

function scoreAction(matchId, action) {
  var match = findMatch(matchId);
  if (!match.state) return;
  send('matchAction', { matchId: matchId, action: action, version: match.state.version });
}

// ─────────────────────────────────────────────────────────────────
// DIÁLOGOS
// ─────────────────────────────────────────────────────────────────

/** Abre el formulario de partido, precargado con el partido actual si existe */
function openSetupDialog(match) {
  setupTarget = match.id;
  var form = document.getElementById('form-setup');
  document.getElementById('dlg-setup-title').textContent = 'Partido de ' + match.label;
  document.getElementById('dlg-setup-error').classList.add('hidden');

  if (match.state) {
    var cfg = match.state.config;
    var a = ScoreFormat.splitTeamName(match.state.players.A.name);
    var b = ScoreFormat.splitTeamName(match.state.players.B.name);
    form.a1.value = a[0] || ''; form.a2.value = a[1] || '';
    form.b1.value = b[0] || ''; form.b2.value = b[1] || '';
    form.gamesPerSet.value   = cfg.gamesPerSet;
    form.totalSets.value     = cfg.totalSets;
    form.scoringSystem.value = cfg.scoringSystem;
    form.tiebreakType.value  = cfg.tiebreakType;
    form.initialServer.value = cfg.initialServer;
  }
  document.getElementById('dlg-setup').showModal();
  form.a1.focus();
}

function submitSetup(event) {
  event.preventDefault();
  var form = event.target;
  var team = function (x, y) {
    return [form[x].value.trim(), form[y].value.trim()].filter(Boolean).join(' / ');
  };
  var config = {
    nameA:         team('a1', 'a2'),
    nameB:         team('b1', 'b2'),
    gamesPerSet:   parseInt(form.gamesPerSet.value, 10),
    totalSets:     parseInt(form.totalSets.value, 10),
    scoringSystem: form.scoringSystem.value,
    tiebreakType:  form.tiebreakType.value,
    initialServer: form.initialServer.value,
  };
  requestSetup(setupTarget, config, false);
}

function requestSetup(matchId, config, force) {
  send('setupMatch', { matchId: matchId, config: config, force: force }).then(function (res) {
    if (res.ok) {
      document.getElementById('dlg-setup').close();
      showToast('Partido iniciado en ' + findMatch(matchId).label);
      return;
    }
    if (res.code === 'MATCH_IN_PROGRESS') {
      confirmDialog('Partido en curso', res.message + '. ¿Reemplazarlo? El marcador actual se perderá.', 'Reemplazar')
        .then(function (ok) { if (ok) requestSetup(matchId, config, true); });
      return;
    }
    var error = document.getElementById('dlg-setup-error');
    error.textContent = res.message;
    error.classList.remove('hidden');
  });
}

/** Diálogo de confirmación: devuelve una promesa con true/false */
function confirmDialog(title, message, okText) {
  var dialog = document.getElementById('dlg-confirm');
  document.getElementById('dlg-confirm-title').textContent   = title;
  document.getElementById('dlg-confirm-message').textContent = message;
  document.getElementById('dlg-confirm-ok').textContent      = okText || 'Confirmar';

  return new Promise(function (resolve) {
    var ok     = document.getElementById('dlg-confirm-ok');
    var cancel = document.getElementById('dlg-confirm-cancel');
    var done = function (value) {
      ok.onclick = cancel.onclick = dialog.oncancel = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    ok.onclick       = function () { done(true); };
    cancel.onclick   = function () { done(false); };
    dialog.oncancel  = function () { done(false); };
    dialog.showModal();
  });
}

// ─────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────

/** Escapa texto para insertarlo en HTML (los nombres los escriben personas) */
function esc(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Nombre de archivo legible a partir de su URL (tolera URLs mal codificadas) */
function fileNameOf(url) {
  var name = String(url).split('/').pop();
  try { return decodeURIComponent(name); } catch (e) { return name; }
}

/** "12 s", "3 min", "2 h" */
function elapsed(timestamp) {
  var seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return seconds + ' s';
  if (seconds < 3600) return Math.round(seconds / 60) + ' min';
  return Math.round(seconds / 3600) + ' h';
}

function setConnection(kind, text) {
  document.getElementById('st-conn-dot').className = 'st-dot ' + kind;
  document.getElementById('st-conn-text').textContent = text;
}

function showToast(message, isError) {
  var toast = document.getElementById('st-toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', !!isError);
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.add('hidden'); }, 4000);
}

// ─────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('st-matches').addEventListener('click', onClick);
  document.getElementById('st-screens').addEventListener('click', onClick);
  document.getElementById('st-screens').addEventListener('change', onChange);
  document.getElementById('form-setup').addEventListener('submit', submitSetup);
  document.getElementById('dlg-setup-cancel').addEventListener('click', function () {
    document.getElementById('dlg-setup').close();
  });
  document.getElementById('st-refresh-ads').addEventListener('click', function () {
    send('station:refreshAds', {}).then(function (res) {
      if (res.ok) showToast('Publicidad actualizada: ' + res.ads.banner.length + ' de franja, ' +
        res.ads.fullscreen.length + ' de pantalla completa');
    });
  });

  // El "hace X s" del teléfono desconectado se refresca aunque no lleguen cambios
  setInterval(function () { if (lastState) render(lastState); }, 5000);

  connectToServer();
});
