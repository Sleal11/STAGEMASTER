/**
 * scoreboard.js — Marcador de la pantalla (presentación pura)
 *
 * Dibuja el estado que envía el servidor; nunca lo modifica.
 *   - Una línea por jugador, cada una ajustada por separado ("Santiago R")
 *   - Saque, ganador, badge (EN PAUSA, TIE BREAK, PUNTO DE ORO…)
 *   - Historial de sets y animaciones SOLO de lo que cambió
 */

import * as ScoreFormat from '../common/score-format.js';

/** Tamaño mínimo de un nombre respecto a su tamaño normal antes de abreviarlo */
const NAME_SCALE_BEFORE_ABBREVIATING = 0.8;
/** Tamaño mínimo absoluto de un nombre */
const NAME_SCALE_MIN = 0.6;

const ANIM = {
  point: 'anim-point', game: 'anim-game', set: 'anim-set', row: 'anim-row', chip: 'anim-chip', winner: 'anim-winner',
};

/** @param {HTMLElement} root - Elemento que contiene el marcador (#display) */
export function createScoreboard(root) {
  const $ = (selector) => root.querySelector(selector);
  const dom = {
    badge:        $('#d-badge'),
    dividerLabel: $('#d-divider-label'),
    history:      $('#d-history'),
  };
  ['A', 'B'].forEach((side) => {
    const id = side.toLowerCase();
    dom[side] = {
      row: $('#row-' + id), names: $('#names-' + id), pts: $('#pts-' + id), games: $('#games-' + id), sets: $('#sets-' + id),
    };
  });

  let last = null;

  /** Dibuja un estado (o null = sin partido). Devuelve true si hay partido */
  function render(state) {
    const previous = last;
    last = isValidState(state) ? state : null;
    if (!last) {
      dom.badge.classList.add('hidden');
      return false;
    }
    const finished = state.status === 'finished';
    renderTeam(state, 'A', finished);
    renderTeam(state, 'B', finished);
    renderBadge(state);
    dom.dividerLabel.textContent = finished ? (state.winner ? 'GANADOR' : 'PARTIDO FINALIZADO') : '';
    root.classList.toggle('is-paused', !!state.paused && !finished);
    renderHistory(state, finished);
    animateChanges(previous, state);
    return true;
  }

  /** Olvida el estado anterior (otro partido): el siguiente dibujo no se anima */
  function forget() {
    last = null;
  }

  function renderTeam(state, side, finished) {
    const player = state.players[side];
    const el = dom[side];
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
    const badge = ScoreFormat.badgeFor(state);
    dom.badge.classList.toggle('hidden', !badge);
    if (!badge) return;
    dom.badge.textContent = badge.text;
    dom.badge.classList.toggle('is-gold', badge.gold);
    dom.badge.classList.toggle('is-pause', !!badge.pause);
  }

  /** [SET 1 6-3] [SET 2 7-6 (8-6)] [SET 3 · EN JUEGO]; súper TB decisivo: [SUPER TB 10-8] */
  function renderHistory(state, finished) {
    dom.history.innerHTML = '';
    state.setScores.forEach((set, i) => {
      if (set.superTiebreak) {
        dom.history.appendChild(buildChip('SUPER TB', set.tiebreak.A + '-' + set.tiebreak.B, null, false));
      } else {
        const detail = set.tiebreak ? '(' + set.tiebreak.A + '-' + set.tiebreak.B + ')' : null;
        dom.history.appendChild(buildChip('SET ' + (i + 1), set.A + '-' + set.B, detail, false));
      }
    });
    if (!finished) {
      const label = ScoreFormat.isDecidingSuperTiebreak(state) ? 'SUPER TB' : 'SET ' + (state.setScores.length + 1);
      dom.history.appendChild(buildChip(label, 'EN JUEGO', null, true));
    }
  }

  function buildChip(label, score, detail, isCurrent) {
    const chip = document.createElement('div');
    chip.className = 'd-set-chip' + (isCurrent ? ' is-current' : '');
    [[label, 'd-set-chip-label'], [score, ''], [detail, 'd-set-chip-detail']].forEach(([text, cls]) => {
      if (!text) return;
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      chip.appendChild(span);
    });
    return chip;
  }

  // ── Nombres: una línea por jugador, ajuste INDIVIDUAL ───────────

  function renderNames(container, teamName) {
    const players = ScoreFormat.splitTeamName(teamName);
    const key = players.join('|');
    if (container.dataset.key === key) return;
    container.dataset.key = key;
    container.innerHTML = '';
    container.classList.toggle('is-single', players.length === 1);
    players.forEach((player) => {
      const line = document.createElement('span');
      line.className = 'd-name-line';
      line.dataset.full = player;
      container.appendChild(line);
    });
    fitNames(container);
  }

  function fitAll() {
    if (!last) return;
    fitNames(dom.A.names);
    fitNames(dom.B.names);
  }

  function fitNames(container) {
    Array.prototype.forEach.call(container.children, fitNameLine);
  }

  /**
   * Ajusta UNA línea: nombre completo → reducido hasta 80 % → "Nombre I"
   * → reducido hasta 60 % → "…" (nunca se sale de su caja).
   */
  function fitNameLine(line) {
    const full = line.dataset.full;
    line.textContent = full;
    line.title = full;
    line.style.fontSize = '';
    if (line.clientWidth === 0) return;   // No visible ahora: se reajusta al mostrarse

    const base = parseFloat(getComputedStyle(line).fontSize);
    if (fits(line) || shrinkUntilFits(line, base, NAME_SCALE_BEFORE_ABBREVIATING)) return;
    const short = ScoreFormat.abbreviateName(full);
    if (short !== full) {
      line.textContent = short;
      line.style.fontSize = '';
      if (fits(line) || shrinkUntilFits(line, base, NAME_SCALE_BEFORE_ABBREVIATING)) return;
    }
    shrinkUntilFits(line, base, NAME_SCALE_MIN);
  }

  const fits = (el) => el.scrollWidth <= el.clientWidth + 1;

  function shrinkUntilFits(el, base, minScale) {
    let size = parseFloat(el.style.fontSize) || base;
    while (!fits(el) && size > base * minScale) {
      size = Math.max(size * 0.96, base * minScale);
      el.style.fontSize = size + 'px';
    }
    return fits(el);
  }

  // ── Animaciones (solo lo que cambió; nunca al deshacer) ─────────

  function animateChanges(previous, state) {
    if (!previous || state.version <= previous.version || !isSameMatch(previous, state)) return;
    ['A', 'B'].forEach((side) => {
      const before = previous.players[side];
      const now = state.players[side];
      const el = dom[side];
      if (now.points !== before.points) play(el.pts, ANIM.point);
      if (now.sets > before.sets) {
        play(el.sets, ANIM.set);
        play(el.row, ANIM.row);
      } else if (now.games > before.games) {
        play(el.games, ANIM.game);
        play(el.row, ANIM.row);
      }
    });
    if (state.setScores.length > previous.setScores.length) {
      const chip = dom.history.children[state.setScores.length - 1];
      if (chip) play(chip, ANIM.chip);
    }
    if (state.status === 'finished' && previous.status !== 'finished' && state.winner) {
      play(dom[state.winner].row, ANIM.winner);
    }
  }

  return { render, forget, fitAll, version: () => (last ? last.version : null), hasMatch: () => !!last };
}

function isValidState(state) {
  return !!(state && state.players && state.players.A && state.players.B && Array.isArray(state.setScores));
}

function isSameMatch(a, b) {
  return a.players.A.name === b.players.A.name &&
         a.players.B.name === b.players.B.name &&
         JSON.stringify(a.config) === JSON.stringify(b.config);
}

/** Reproduce una animación CSS desde el principio */
function play(el, className) {
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
