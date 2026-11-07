/**
 * matches.js — Tarjetas de los partidos (pistas) en la estación
 *
 * Cada tarjeta: marcador, estado, acciones del partido (configurar, pausar /
 * reanudar, finalizar, reiniciar), puntuación de respaldo, teléfono del
 * árbitro y código de la pista. Se puede minimizar (⌄): queda la cabecera
 * con un resumen del marcador.
 */

import * as ScoreFormat from '../common/score-format.js';
import { esc, icon } from '../common/ui.js';
import { ctx, send, findMatch, patch } from './context.js';
import { confirmDialog, openSetupDialog } from './dialogs.js';
import { collapseButton, isCollapsed } from './collapse.js';

const STATUS = {
  empty:    { text: 'Sin partido', kind: '' },
  playing:  { text: 'En juego',    kind: 'ok' },
  paused:   { text: 'En pausa',    kind: 'warn' },
  finished: { text: 'Finalizado',  kind: 'info' },
};

// Desplegable de respaldo abierto/cerrado por el moderador (por partido)
const backupOpen = {};

export function renderMatches(state) {
  const access = document.getElementById('st-referee-access');
  access.dataset.collapsible = 'acceso-arbitros';
  access.classList.toggle('is-collapsed', isCollapsed('acceso-arbitros'));
  patch(access, refereeAccessHtml(state));
  const container = document.getElementById('st-matches');
  state.matches.forEach((match) => {
    let card = container.querySelector(`[data-match-card="${match.id}"]`);
    if (!card) {
      card = document.createElement('article');
      card.className = 'st-card st-court';
      card.dataset.matchCard = match.id;
      card.dataset.collapsible = 'pista:' + match.id;
      container.appendChild(card);
    }
    card.style.setProperty('--court-color', match.color);
    card.classList.toggle('is-collapsed', isCollapsed('pista:' + match.id));
    patch(card, cardHtml(match));
  });
}

/** Resumen de la pista en una línea (se ve con la tarjeta minimizada) */
function miniHtml(state) {
  if (!state) return 'Sin partido';
  const { A, B } = state.players;
  if (state.status === 'finished') {
    const sets = state.setScores.map(ScoreFormat.formatSetScore).join(' · ');
    const winner = state.winner ? ScoreFormat.splitTeamName(state.players[state.winner].name)[0] : '';
    return `${winner ? `Ganan ${esc(winner)} · ` : ''}${esc(sets)}`;
  }
  return `Sets ${A.sets}-${B.sets} · Games ${A.games}-${B.games} · ${esc(String(A.points))}-${esc(String(B.points))}`;
}

function statusOf(state) {
  if (!state) return STATUS.empty;
  if (state.status === 'finished') return STATUS.finished;
  return state.paused ? STATUS.paused : STATUS.playing;
}

function cardHtml(match) {
  const state   = match.state;
  const status  = statusOf(state);
  const playing = !!state && state.status === 'playing';
  const btn = (action, iconName, text, cls = 'btn-secondary', disabled = false) =>
    `<button type="button" class="btn ${cls}" data-action="${action}" data-match="${match.id}"${disabled ? ' disabled' : ''}>` +
    `${icon(iconName)}${text}</button>`;

  return `
    <header class="st-card-head">
      <span class="st-card-name">${icon('court', 'st-card-icon')}${esc(match.label)}</span>
      <span class="st-card-mini">${miniHtml(state)}</span>
      <span class="st-card-tools"><span class="pill ${status.kind}">${status.text}</span>${collapseButton('pista:' + match.id, match.label)}</span>
    </header>
    <div class="st-card-body">
      ${scoreHtml(state)}
      <div class="st-actions">
        ${btn('setup', state ? 'plus' : 'sliders', state ? 'Nuevo partido…' : 'Configurar partido…', 'btn-primary')}
        ${playing && state.paused ? btn('resume', 'play', 'Reanudar', 'btn-warn') : ''}
        ${playing && !state.paused ? btn('pause', 'pause', 'Pausar') : ''}
        ${btn('finish', 'flag', 'Finalizar', 'btn-secondary', !playing)}
        ${btn('reset', 'reset', 'Reiniciar', 'btn-danger-ghost', !state)}
      </div>
      ${state ? backupHtml(match) : ''}
      ${phoneHtml(match)}
    </div>`;
}

function scoreHtml(state) {
  if (!state) return '<div class="st-score st-score-empty">Sin partido configurado</div>';
  const finished = state.status === 'finished';
  const row = (side) => {
    const p = state.players[side];
    const cls = (!finished && state.server === side ? ' is-serving' : '') + (finished && state.winner === side ? ' is-winner' : '');
    const mark = finished && state.winner === side ? icon('trophy', 'st-mark st-trophy') : (!finished && state.server === side ? icon('ball', 'st-mark') : '');
    return `<span class="st-score-name${cls}" title="${esc(p.name)}">${mark}<span>${esc(p.name)}</span></span>` +
      `<span class="st-score-num">${p.sets}</span>` +
      `<span class="st-score-num">${finished ? '–' : p.games}</span>` +
      `<span class="st-score-num st-score-pts">${finished ? '–' : esc(String(p.points))}</span>`;
  };
  const badge   = ScoreFormat.badgeFor(state);
  const history = state.setScores.map(ScoreFormat.formatSetScore).join(' · ');
  return `
    <div class="st-score">
      <span></span><span class="st-score-h">SETS</span><span class="st-score-h">GAMES</span><span class="st-score-h">PUNTOS</span>
      ${row('A')}${row('B')}
    </div>
    <div class="st-history">${history ? 'Sets: ' + esc(history) : 'Set 1 en juego'}
      ${badge ? `<span class="pill ${{ pause: 'warn', gold: 'gold', set: 'set', match: 'match' }[badge.kind] || 'info'}">${badge.text}</span>` : ''}</div>`;
}

/** Respaldo: puntuar desde el portátil si el teléfono del árbitro falla */
function backupHtml(match) {
  const { state } = match;
  const playing = state.status === 'playing';
  if (!playing && !state.canUndo) return '';
  const scoring = playing && !state.paused;
  const btn = (action, content, disabled) =>
    `<button type="button" class="btn btn-secondary btn-sm" data-action="score" data-score="${action}" data-match="${match.id}"` +
    `${disabled ? ' disabled' : ''}>${content}</button>`;
  // Abierto por defecto si no hay teléfono conectado; después manda lo que elija el moderador
  const open = match.id in backupOpen ? backupOpen[match.id] : !(match.controller && match.controller.connected);
  const first = (name) => esc(ScoreFormat.splitTeamName(name)[0] || '');
  return `
    <details class="st-backup" data-match="${match.id}"${open ? ' open' : ''}>
      <summary>Puntuar desde la estación <span class="muted">(respaldo si falla el teléfono)</span></summary>
      <div class="st-actions">
        ${btn('pointA', `${icon('plus')}${first(state.players.A.name)}`, !scoring)}
        ${btn('pointB', `${icon('plus')}${first(state.players.B.name)}`, !scoring)}
        ${btn('undo', `${icon('undo')}Deshacer`, !state.canUndo)}
        ${btn('changeServer', `${icon('swap')}Cambiar saque`, !scoring)}
      </div>
    </details>`;
}

function phoneHtml(match) {
  const c = match.controller;
  let status;
  if (!c) status = '<span class="dot"></span>Sin teléfono vinculado';
  else if (c.connected) status = `<span class="dot ok"></span>${esc(c.deviceName)} conectado`;
  else {
    status = `<span class="dot warn"></span>${esc(c.deviceName)} desconectado` +
      (c.lastSeen ? ` <span class="muted">(hace <span data-tick-since="${c.lastSeen}"></span>)</span>` : '');
  }
  return `
    <div class="st-access">
      <div class="st-code-box">
        <span class="st-code-label">Código de ${esc(match.label)}</span>
        <span class="st-pin" aria-label="Código de ${esc(match.label)}">${esc(match.pin)}</span>
      </div>
      <div class="st-access-text">
        <div class="st-phone">${icon('phone')}<span>${status}</span></div>
        <span class="muted">El árbitro escanea el QR de arriba y escribe este código.</span>
        <div class="st-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="newPin" data-match="${match.id}">${icon('key')}Nuevo código</button>
          ${c ? `<button type="button" class="btn btn-ghost btn-sm" data-action="unpair" data-match="${match.id}">${icon('unlink')}Desvincular teléfono</button>` : ''}
        </div>
      </div>
    </div>`;
}

/**
 * Un solo QR para todos los árbitros: abre la página del árbitro, que pide el
 * código de la pista (cada tarjeta muestra el suyo).
 */
function refereeAccessHtml(state) {
  const access = state.access;
  return `<div class="st-referee">
      ${access ? `<div class="st-qr" title="${esc(access.url)}">${access.qrSvg}</div>` : ''}
      <div class="st-referee-text">
        <div class="st-referee-head"><h3 class="st-referee-title">${icon('phone')}Acceso de los árbitros</h3>
          ${collapseButton('acceso-arbitros', 'el acceso de los árbitros')}</div>
        <ol class="st-steps">
          <li><strong>Escanea este QR</strong> con la cámara del teléfono.</li>
          <li>Escribe el <strong>código de su pista</strong> (está en cada tarjeta).</li>
          <li>Listo: el teléfono muestra la pista que controla.</li>
        </ol>
        ${accessHint()}
      </div>
    </div>`;
}

/**
 * Si el QR no abre: en qué Wi-Fi debe estar el teléfono y la dirección para
 * escribirla a mano (antes estaba en la cabecera de la estación).
 */
function accessHint() {
  const network = ctx.state.network;
  if (!network.primary) {
    return `<span class="st-access-hint is-bad">${icon('alert')}El portátil no está conectado a ninguna red: los teléfonos no podrán entrar</span>`;
  }
  const check = ctx.state.desktop && ctx.state.desktop.network;
  const wifi = check && check.wifi ? `la Wi-Fi <strong>«${esc(check.wifi)}»</strong>` : 'la misma Wi-Fi que este portátil';
  const others = network.addresses.slice(1).map((a) => `${a.address}:${network.port}`);
  const title = others.length ? ` title="Si no conecta, prueba también: ${esc(others.join(', '))}"` : '';
  return `<span class="st-access-hint"${title}>${icon('wifi')}<span>Teléfono en ${wifi} · o escribe <strong>${esc(network.primary.address)}:${network.port}</strong></span></span>`;
}

// ─────────────────────────────────────────────────────────────────
// ÓRDENES
// ─────────────────────────────────────────────────────────────────

function matchAction(matchId, action, button) {
  const match = findMatch(matchId);
  if (!match.state) return Promise.resolve({ ok: false });
  return send('matchAction', { matchId, action, version: match.state.version }, button);
}

/** Clic en una tarjeta de partido (delegación desde main.js) */
export function onMatchClick(event) {
  // Abrir/cerrar el respaldo: se recuerda en el mismo clic (el evento 'toggle'
  // llega más tarde y la tarjeta puede haberse redibujado entre medias)
  const summary = event.target.closest('details.st-backup > summary');
  if (summary) {
    const details = summary.parentElement;
    backupOpen[details.dataset.match] = !details.open;
    return;
  }

  const el = event.target.closest('button[data-action]');
  if (!el || el.disabled) return;
  const matchId = el.dataset.match;
  const match   = findMatch(matchId);

  switch (el.dataset.action) {
    case 'setup':
      openSetupDialog(match);
      break;
    case 'pause':
      matchAction(matchId, 'pause', el);
      break;
    case 'resume':
      matchAction(matchId, 'resume', el);
      break;
    case 'finish':
      confirmDialog(`Finalizar ${match.label}`,
        'Se dará por terminado con el marcador actual (gana quien tenga más sets). Si hay publicidad al terminar, empezará después.',
        'Finalizar')
        .then((ok) => { if (ok) matchAction(matchId, 'finishMatch'); });
      break;
    case 'reset':
      confirmDialog(`Reiniciar ${match.label}`, 'El marcador volverá a 0 con los mismos jugadores y reglas. No se puede deshacer.', 'Reiniciar')
        .then((ok) => { if (ok) send('resetMatch', { matchId, version: findMatch(matchId).state.version }); });
      break;
    case 'score':
      matchAction(matchId, el.dataset.score, el);
      break;
    case 'newPin':
      confirmDialog(`Nuevo código para ${match.label}`,
        'El código actual dejará de servir para conectar teléfonos. El teléfono ya conectado seguirá funcionando.', 'Cambiar código')
        .then((ok) => { if (ok) send('station:newPin', { matchId }); });
      break;
    case 'unpair':
      confirmDialog('Desvincular teléfono', `El teléfono de ${match.label} dejará de poder modificar el marcador.`, 'Desvincular')
        .then((ok) => { if (ok) send('station:unpair', { matchId }); });
      break;
  }
}
