/**
 * matches.js — Tarjetas de los partidos (pistas) en la estación
 *
 * Cada tarjeta: marcador, estado, acciones del partido (configurar, pausar /
 * reanudar, finalizar, reiniciar), puntuación de respaldo, teléfono del
 * árbitro y acceso por QR + PIN.
 */

import * as ScoreFormat from '../common/score-format.js';
import { esc, icon } from '../common/ui.js';
import { send, findMatch, patch } from './context.js';
import { confirmDialog, openSetupDialog } from './dialogs.js';

const STATUS = {
  empty:    { text: 'Sin partido', kind: '' },
  playing:  { text: 'En juego',    kind: 'ok' },
  paused:   { text: 'En pausa',    kind: 'warn' },
  finished: { text: 'Finalizado',  kind: 'info' },
};

// Desplegable de respaldo abierto/cerrado por el moderador (por partido)
const backupOpen = {};

export function renderMatches(state) {
  const container = document.getElementById('st-matches');
  state.matches.forEach((match) => {
    let card = container.querySelector(`[data-match-card="${match.id}"]`);
    if (!card) {
      card = document.createElement('article');
      card.className = 'st-card';
      card.dataset.matchCard = match.id;
      container.appendChild(card);
    }
    card.style.setProperty('--court-color', match.color);
    patch(card, cardHtml(match));
  });
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
      <span class="st-card-name">${esc(match.label)}</span>
      <span class="pill ${status.kind}">${status.text}${state ? ` · v${state.version}` : ''}</span>
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
      ${badge ? `<span class="pill ${badge.pause ? 'warn' : badge.gold ? 'gold' : 'info'}">${badge.text}</span>` : ''}</div>`;
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
      ${match.qrSvg ? `<div class="st-qr" title="${esc(match.qrUrl)}">${match.qrSvg}</div>` : ''}
      <div class="st-access-text">
        <div class="st-phone">${icon('phone')}<span>${status}</span></div>
        <span class="muted">${match.qrSvg ? 'El árbitro escanea el código con la cámara del teléfono y escribe el PIN:'
          : `El árbitro abre la dirección de arriba, elige ${esc(match.label)} y escribe el PIN:`}</span>
        <div class="st-actions">
          <span class="st-pin" aria-label="PIN">${esc(match.pin)}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-action="newPin" data-match="${match.id}">${icon('key')}Nuevo PIN</button>
          ${c ? `<button type="button" class="btn btn-ghost btn-sm" data-action="unpair" data-match="${match.id}">${icon('unlink')}Desvincular</button>` : ''}
        </div>
      </div>
    </div>`;
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
      confirmDialog(`Nuevo PIN para ${match.label}`,
        'El PIN actual dejará de servir para vincular teléfonos. El teléfono ya vinculado seguirá funcionando.', 'Cambiar PIN')
        .then((ok) => { if (ok) send('station:newPin', { matchId }); });
      break;
    case 'unpair':
      confirmDialog('Desvincular teléfono', `El teléfono de ${match.label} dejará de poder modificar el marcador.`, 'Desvincular')
        .then((ok) => { if (ok) send('station:unpair', { matchId }); });
      break;
  }
}
