/**
 * finale.js — Final del partido en la pantalla: celebración y resumen
 *
 *   1. CELEBRACIÓN (CELEBRATE_MS): al terminar el partido EN DIRECTO (de «en
 *      juego» a «terminado»), sobre todo el marcador, con estilo de retransmisión
 *      deportiva y todo en SVG/CSS (nítido en cualquier LED): una pista de pádel
 *      en perspectiva que se dibuja, franjas que barren la pantalla, la pala y la
 *      pelota, «GANADORES», la pareja ganadora, el resultado set a set y la
 *      firma de StageMaster. Una sola vez por final: no se repite al
 *      reconectar, al recargar ni al cambiar la configuración. Si se deshace el
 *      final y se vuelve a terminar, es otro final y se celebra.
 *   2. MARCADOR y ESTADÍSTICAS, alternándose mientras el partido está terminado:
 *      el marcador de siempre con el ganador destacado (trofeo y «GANADOR»,
 *      scoreboard.js) durante SCORE_MS, y las estadísticas REGISTRADAS solas y en
 *      grande (juegos, puntos, puntos de oro, breaks, mejor racha y duración; ver
 *      matchSummary en common/score-format.js) durante STATS_MS, y vuelta a empezar.
 *
 * Con la publicidad al terminar activada, la lista de reproducción empieza
 * cuando toca (main.js), pero nunca antes de que acabe la celebración.
 * Partido nuevo: el resumen desaparece y vuelve el marcador.
 */

import * as ScoreFormat from '../common/score-format.js';
import { esc } from '../common/ui.js';
import { applyLogo } from '../common/brand.js';

const CELEBRATE_MS = 6000;
const SCORE_MS = 10000;   // marcador con el ganador
const STATS_MS = 10000;   // estadísticas
const GLINTS = 14;   // destellos dorados que suben (discretos)

/** Pista de pádel en perspectiva (vista desde el fondo): las líneas se dibujan al empezar */
const COURT_SVG = `
  <svg class="cel-court" viewBox="0 0 1000 500" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs>
      <linearGradient id="celTurf" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0D3A8A" stop-opacity="0.15"/>
        <stop offset="1" stop-color="#1450B4" stop-opacity="0.55"/>
      </linearGradient>
    </defs>
    <polygon points="335,170 665,170 960,500 40,500" fill="url(#celTurf)"/>
    <g class="cel-lines" fill="none" stroke="#BEE6FF" stroke-width="3" stroke-linecap="round">
      <path pathLength="1" d="M335 170 L665 170 L960 500 L40 500 Z"/>
      <path pathLength="1" d="M297 212 L703 212"/>
      <path pathLength="1" d="M135 390 L865 390"/>
      <path pathLength="1" d="M500 212 L500 390"/>
    </g>
    <g class="cel-net">
      <path d="M222 297 L778 297" stroke="#FFFFFF" stroke-opacity="0.7" stroke-width="6" stroke-linecap="round"/>
      <path d="M222 297 L222 262 M778 297 L778 262" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
      <path d="M222 266 L778 266" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="2"/>
    </g>
    <g class="cel-glass" fill="none" stroke="#8FD3FF" stroke-opacity="0.35" stroke-width="2">
      <path d="M335 170 L335 70 M665 170 L665 70 M40 500 L40 240 M960 500 L960 240"/>
      <path d="M335 70 L40 240 M665 70 L960 240"/>
    </g>
  </svg>`;

/** Pala de pádel y pelota (emblema de la celebración) */
const EMBLEM_SVG = `
  <svg class="cel-emblem" viewBox="0 0 160 220" aria-hidden="true">
    <defs>
      <linearGradient id="celGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FFE68A"/><stop offset="0.5" stop-color="#FFD54A"/><stop offset="1" stop-color="#E0A800"/>
      </linearGradient>
    </defs>
    <g class="cel-racket" transform="rotate(-18 80 110)">
      <path d="M80 10 C122 10 134 46 134 78 C134 116 108 140 92 150 L88 162 L72 162 L68 150 C52 140 26 116 26 78 C26 46 38 10 80 10 Z"
        fill="#0A2350" stroke="url(#celGold)" stroke-width="7"/>
      <g fill="#06142C" stroke="#FFD54A" stroke-opacity="0.55" stroke-width="1.5">
        ${[[62, 44], [80, 40], [98, 44], [53, 62], [71, 60], [89, 60], [107, 62], [53, 80], [71, 78], [89, 78], [107, 80],
          [58, 98], [76, 96], [94, 96], [102, 112], [67, 114], [84, 114]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.2"/>`).join('')}
      </g>
      <path d="M80 132 L80 150" stroke="url(#celGold)" stroke-width="4"/>
      <rect x="69" y="160" width="22" height="52" rx="6" fill="url(#celGold)"/>
      <path d="M69 172 L91 166 M69 184 L91 178 M69 196 L91 190" stroke="#8A6400" stroke-width="2.5"/>
    </g>
    <g class="cel-ball">
      <circle cx="132" cy="36" r="17" fill="#D4F21E"/>
      <path d="M118 26 C128 32 128 42 118 48 M146 26 C136 32 136 42 146 48" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>
    </g>
  </svg>`;

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
  let phase = 'score';      // 'score' (marcador) | 'stats' (estadísticas)
  let statsEnabled = true;  // opción de la pantalla: mostrar o no las estadísticas
  let cycleTimer = null;

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
    } else if (!celebrating && !cycleTimer) {
      startCycle();   // ya estaba terminado (recarga, otra pantalla…): sin celebración
    }
  }

  /** Marcador SCORE_MS → estadísticas STATS_MS → marcador… (empieza por `from`) */
  function startCycle(from = 'score') {
    clearTimeout(cycleTimer);
    phase = from;
    const next = () => {
      phase = phase === 'score' ? 'stats' : 'score';
      cycleTimer = setTimeout(next, phase === 'score' ? SCORE_MS : STATS_MS);
      onChange();
    };
    cycleTimer = setTimeout(next, phase === 'score' ? SCORE_MS : STATS_MS);
  }

  // Pruebas automáticas: ir a una fase sin esperar (window.dispatchEvent(new CustomEvent('stagemaster:fase-final', { detail: 'stats' })))
  window.addEventListener('stagemaster:fase-final', (event) => {
    if (!state || state.status !== 'finished' || celebrating) return;
    startCycle(event.detail === 'stats' ? 'stats' : 'score');
    onChange();
  });

  /** Otro partido en esta pantalla: sin celebrar lo anterior */
  function reset() {
    state = null;
    stop();
  }

  function start(s) {
    const winner = s.players[s.winner];
    const lines = ScoreFormat.splitTeamName(winner.name)
      .map((n, i) => `<span style="animation-delay:${(1.05 + i * 0.18).toFixed(2)}s">${esc(n)}</span>`).join('');
    const sets = s.setScores.map((set, i) =>
      `<span class="cel-set" style="animation-delay:${(1.7 + i * 0.15).toFixed(2)}s">${esc(ScoreFormat.formatSetScore(set))}</span>`).join('');
    const glints = Array.from({ length: GLINTS }, (_, i) => {
      const left = 6 + ((i * 41) % 88);
      const delay = 0.8 + ((i * 29) % 100) / 100 * 2.6;
      const size = 0.5 + ((i * 17) % 10) / 10;
      return `<i style="left:${left}%;animation-delay:${delay.toFixed(2)}s;--s:${size.toFixed(2)}"></i>`;
    }).join('');
    celebrate.innerHTML = `
      <div class="cel-spot" aria-hidden="true"></div>
      ${COURT_SVG}
      <div class="cel-sweep" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="cel-glints" aria-hidden="true">${glints}</div>
      <div class="cel-content">
        <div class="cel-emblem-wrap">${EMBLEM_SVG}</div>
        <div class="cel-text">
          <div class="cel-label"><span>Ganadores</span></div>
          <div class="cel-names">${lines}</div>
          <div class="cel-score">${sets}</div>
        </div>
      </div>
      <div class="cel-brand"><span class="cel-brand-logo" data-brand-logo>STAGE<span>MASTER</span></span><span class="cel-brand-text">Pádel</span></div>`;
    applyLogo(celebrate);
    celebrate.classList.remove('hidden');
    celebrating = true;
    clearTimeout(timer);
    clearTimeout(cycleTimer);
    cycleTimer = null;
    timer = setTimeout(() => {
      celebrating = false;
      celebrate.classList.add('hidden');
      startCycle();   // después de la celebración: primero el marcador con el ganador
      onChange();
    }, CELEBRATE_MS);
    onChange();
  }

  function stop() {
    clearTimeout(timer);
    clearTimeout(cycleTimer);
    cycleTimer = null;
    const was = celebrating || phase === 'stats';
    celebrating = false;
    phase = 'score';
    celebrate.classList.add('hidden');
    celebrate.innerHTML = '';
    if (was) onChange();
  }

  /** Estadísticas solas y en grande: cabecera con las parejas y una fila por dato */
  function renderSummary(s) {
    const sum = ScoreFormat.summaryFromState(s);
    const team = (side) => {
      const isWinner = sum.winner === side;
      const trophy = isWinner ? '<svg class="sum-trophy" aria-hidden="true"><use href="img/icons.svg#trophy"></use></svg>' : '';
      const name = `<span class="sum-name">${esc(sum.names[side])}</span>`;
      return `<div class="sum-team is-${side.toLowerCase()}${isWinner ? ' is-winner' : ''}">${side === 'A' ? trophy + name : name + trophy}</div>`;
    };
    const rows = sum.rows.map((r) => `<div class="sum-row" data-stat="${r.key}">
        <span class="sum-val${r.A > r.B ? ' is-lead' : ''}">${r.A}</span>
        <span class="sum-label">${esc(r.label)}</span>
        <span class="sum-val${r.B > r.A ? ' is-lead' : ''}">${r.B}</span>
      </div>`).join('');
    const html = `
      <div class="sum-head">${team('A')}<div class="sum-title">Estadísticas</div>${team('B')}</div>
      <div class="sum-rows">${rows}</div>
      ${sum.duration ? `<div class="sum-foot"><svg aria-hidden="true"><use href="img/icons.svg#clock"></use></svg>Duración ${esc(sum.duration)}</div>` : ''}`;
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
    /** El partido de esta pantalla está terminado */
    isFinished: () => !!state && state.status === 'finished',
    isCelebrating: () => celebrating,
    /** Toca ver las estadísticas (en lugar del marcador) */
    isShowingStats: () => statsEnabled && !!state && state.status === 'finished' && !celebrating && phase === 'stats',
    /** Opción de la pantalla: sin estadísticas, se queda el marcador con el ganador */
    setStatsEnabled: (enabled) => { statsEnabled = enabled !== false; },
    /** Cambió el tamaño de la salida o se mostraron las estadísticas: reajustar los nombres */
    fit,
  };
}
