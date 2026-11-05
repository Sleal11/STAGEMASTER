/**
 * finale.js — Final del partido en la pantalla: celebración y resumen
 *
 *   1. CELEBRACIÓN (CELEBRATE_MS): al terminar el partido EN DIRECTO (de «en
 *      juego» a «terminado»), sobre todo el marcador: trofeo, «GANADORES», la
 *      pareja ganadora y el resultado. Una sola vez por final: no se repite al
 *      reconectar, al recargar ni al cambiar la configuración. Si se deshace el
 *      final y se vuelve a terminar, es otro final y se celebra.
 *   2. RESUMEN: sustituye al marcador mientras el partido está terminado
 *      (ganadores, resultado por set y estadísticas REGISTRADAS: juegos, puntos,
 *      puntos de oro, breaks, mejor racha y duración; ver ScoreFormat.matchSummary).
 *
 * Con la publicidad al terminar activada, la lista de reproducción empieza
 * cuando toca (main.js), pero nunca antes de que acabe la celebración.
 * Partido nuevo: el resumen desaparece y vuelve el marcador.
 */

import * as ScoreFormat from '../common/score-format.js';
import { esc } from '../common/ui.js';

const CELEBRATE_MS = 6000;
const CONFETTI = 26;

/**
 * @param {Object} dom - { summary, celebrate }
 * @param {Function} onChange - Empezó o terminó la celebración (redibujar capas)
 */
export function createFinale({ summary, celebrate }, onChange) {
  let state = null;
  let celebratedKey = null;
  let celebrating = false;
  let timer = null;
  let summaryHtml = '';

  /** Nuevo estado del partido que muestra la pantalla (null = sin partido) */
  function update(next, matchId) {
    const wasPlaying = !!state && state.status === 'playing';
    state = next;
    const finished = !!next && next.status === 'finished';
    if (!finished) {
      stop();
      return;
    }
    renderSummary(next);
    const key = `${matchId}:${(next.timing && next.timing.finishedAt) || next.version}`;
    if (wasPlaying && next.winner && key !== celebratedKey) {
      celebratedKey = key;
      start(next);
    }
  }

  /** Otro partido en esta pantalla: sin celebrar lo anterior */
  function reset() {
    state = null;
    stop();
  }

  function start(s) {
    const winner = s.players[s.winner];
    const lines = ScoreFormat.splitTeamName(winner.name).map((n) => `<span>${esc(n)}</span>`).join('');
    const confetti = Array.from({ length: CONFETTI }, (_, i) => {
      const left = (i * 37) % 100;
      const delay = ((i * 53) % 100) / 100 * 1.6;
      const hue = ['#FFD54A', '#8FD3FF', '#FFFFFF', '#22D3EE'][i % 4];
      return `<i style="left:${left}%;animation-delay:${delay.toFixed(2)}s;background:${hue}"></i>`;
    }).join('');
    celebrate.innerHTML = `
      <div class="cel-rays" aria-hidden="true"></div>
      <div class="cel-confetti" aria-hidden="true">${confetti}</div>
      <div class="cel-content">
        <svg class="cel-trophy" aria-hidden="true"><use href="img/icons.svg#trophy"></use></svg>
        <div class="cel-label">Ganadores</div>
        <div class="cel-names">${lines}</div>
        <div class="cel-score">${esc(s.setScores.map(ScoreFormat.formatSetScore).join('  ·  '))}</div>
      </div>`;
    celebrate.classList.remove('hidden');
    celebrating = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      celebrating = false;
      celebrate.classList.add('hidden');
      summary.classList.add('is-entering');
      onChange();
    }, CELEBRATE_MS);
    onChange();
  }

  function stop() {
    clearTimeout(timer);
    const was = celebrating;
    celebrating = false;
    celebrate.classList.add('hidden');
    celebrate.innerHTML = '';
    summary.classList.remove('is-entering');
    if (was) onChange();
  }

  function renderSummary(s) {
    const sum = ScoreFormat.summaryFromState(s);
    const team = (side) => {
      const isWinner = sum.winner === side;
      return `<div class="sum-team${isWinner ? ' is-winner' : ''}">
          ${isWinner ? '<svg class="sum-trophy" aria-hidden="true"><use href="img/icons.svg#trophy"></use></svg>' : '<span class="sum-trophy"></span>'}
          <span class="sum-name">${esc(sum.names[side])}</span>
          <span class="sum-sets">${sum.setsWon[side]}</span>
        </div>`;
    };
    const bar = (a, b, side) => {
      const total = a + b;
      return total ? Math.round(((side === 'A' ? a : b) / total) * 100) : 0;
    };
    const rows = sum.rows.map((r) => `<div class="sum-row" data-stat="${r.key}">
        <span class="sum-val${r.A > r.B ? ' is-lead' : ''}">${r.A}</span>
        <span class="sum-bar"><i style="width:${bar(r.A, r.B, 'A')}%"></i></span>
        <span class="sum-label">${esc(r.label)}</span>
        <span class="sum-bar is-b"><i style="width:${bar(r.A, r.B, 'B')}%"></i></span>
        <span class="sum-val${r.B > r.A ? ' is-lead' : ''}">${r.B}</span>
      </div>`).join('');
    const html = `
      <div class="sum-left">
        <div class="sum-kicker">${sum.winner ? 'Resultado final' : 'Partido finalizado · sin ganador'}</div>
        ${team('A')}${team('B')}
        <div class="sum-sets-list">${sum.sets.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
        ${sum.duration ? `<div class="sum-duration"><svg aria-hidden="true"><use href="img/icons.svg#clock"></use></svg>${esc(sum.duration)}</div>` : ''}
      </div>
      <div class="sum-right">
        <div class="sum-title">Estadísticas del partido</div>
        ${rows}
      </div>`;
    if (html !== summaryHtml) {
      summaryHtml = html;
      summary.innerHTML = html;
    }
    requestAnimationFrame(fit);
  }

  /** Nombres largos: se reduce la letra (hasta un 65 %) antes de recortarlos con «…» */
  function fit() {
    if (summary.classList.contains('hidden')) return;
    summary.querySelectorAll('.sum-name').forEach((el) => {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize);
      let size = base;
      while (el.scrollWidth > el.clientWidth + 1 && size > base * 0.65) {
        size -= base * 0.05;
        el.style.fontSize = size + 'px';
      }
    });
  }

  return {
    update,
    reset,
    /** El partido de esta pantalla está terminado (se ve el resumen) */
    isFinished: () => !!state && state.status === 'finished',
    isCelebrating: () => celebrating,
    /** Cambió el tamaño de la salida o se mostró el resumen: reajustar los nombres */
    fit,
  };
}
