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
      <linearGradient id="celMetal" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#BEE6FF"/><stop offset="1" stop-color="#5FA8E8"/>
      </linearGradient>
    </defs>
    <g class="cel-racket" transform="rotate(-18 80 110)">
      <path d="M80 10 C122 10 134 46 134 78 C134 116 108 140 92 150 L88 162 L72 162 L68 150 C52 140 26 116 26 78 C26 46 38 10 80 10 Z"
        fill="#0A2350" stroke="url(#celMetal)" stroke-width="7"/>
      <g fill="#06142C" stroke="#8FD3FF" stroke-opacity="0.6" stroke-width="1.5">
        ${[[62, 44], [80, 40], [98, 44], [53, 62], [71, 60], [89, 60], [107, 62], [53, 80], [71, 78], [89, 78], [107, 80],
          [58, 98], [76, 96], [94, 96], [102, 112], [67, 114], [84, 114]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.2"/>`).join('')}
      </g>
      <path d="M80 132 L80 150" stroke="url(#celMetal)" stroke-width="4"/>
      <rect x="69" y="160" width="22" height="52" rx="6" fill="url(#celMetal)"/>
      <path d="M69 172 L91 166 M69 184 L91 178 M69 196 L91 190" stroke="#2B5E9E" stroke-width="2.5"/>
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
      if (phase === 'stats') requestAnimationFrame(countUp);
    };
    cycleTimer = setTimeout(next, phase === 'score' ? SCORE_MS : STATS_MS);
  }

  /** Los números de las estadísticas cuentan desde 0 (como en televisión), uno tras otro */
  function countUp() {
    if (summary.classList.contains('hidden')) return;
    const start = performance.now();
    summary.querySelectorAll('.sum-val').forEach((el, k) => {
      const target = Number(el.dataset.value) || 0;
      const delay = 250 + Math.floor(k / 2) * 110;
      const step = (now) => {
        const p = Math.min(1, Math.max(0, (now - start - delay) / 900));
        el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  // Pruebas automáticas: ir a una fase sin esperar (window.dispatchEvent(new CustomEvent('stagemaster:fase-final', { detail: 'stats' })))
  window.addEventListener('stagemaster:fase-final', (event) => {
    if (!state || state.status !== 'finished' || celebrating) return;
    startCycle(event.detail === 'stats' ? 'stats' : 'score');
    onChange();
    if (phase === 'stats') requestAnimationFrame(countUp);
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
    fitCelebration();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCelebration);
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
      const name = `<span class="sum-name" data-full="${esc(sum.names[side])}" title="${esc(sum.names[side])}">${esc(sum.names[side])}</span>`;
      return `<div class="sum-team is-${side.toLowerCase()}${isWinner ? ' is-winner' : ''}">${side === 'A' ? trophy + name : name + trophy}</div>`;
    };
    // Cada dato: valores (cuentan hacia arriba al mostrarse) y una barra con el reparto entre las parejas
    const rows = sum.rows.map((r, i) => {
      const share = r.A + r.B ? Math.round((r.A / (r.A + r.B)) * 100) : 50;
      return `<div class="sum-row" data-stat="${r.key}" style="--i:${i};--a:${share}%">
        <span class="sum-val${r.A > r.B ? ' is-lead' : ''}" data-value="${r.A}">${r.A}</span>
        <div class="sum-mid"><span class="sum-label">${esc(r.label)}</span><span class="sum-bar"><i class="a"></i><i class="b"></i></span></div>
        <span class="sum-val${r.B > r.A ? ' is-lead' : ''}" data-value="${r.B}">${r.B}</span>
      </div>`;
    }).join('');
    const html = `
      <div class="sum-head">${team('A')}<div class="sum-title"><span>Estadísticas</span>` +
        `${sum.sets.length ? `<small>${esc(sum.sets.join(' · '))}</small>` : ''}</div>${team('B')}</div>
      <div class="sum-rows">${rows}</div>
      ${sum.duration ? `<div class="sum-foot"><svg aria-hidden="true"><use href="img/icons.svg#clock"></use></svg>Duración ${esc(sum.duration)}</div>` : ''}
      <div class="sum-progress" style="--dur:${STATS_MS}ms"><i></i></div>`;
    if (html !== summaryHtml) {
      summaryHtml = html;
      summary.innerHTML = html;
    }
    requestAnimationFrame(fit);
  }

  /**
   * Nombres de las parejas en las estadísticas: completos si caben; si no, se
   * abrevian («A. Tapia / A. Coello» y luego «Tapia / Coello») antes de reducir
   * mucho la letra; solo en último caso se recortan con «…».
   */
  function fitNames() {
    if (summary.classList.contains('hidden')) return;
    const els = Array.from(summary.querySelectorAll('.sum-name[data-full]'));
    if (!els.length) return;
    const shrinkTo = (el, minScale) => {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize);
      let size = base;
      while (el.scrollWidth > el.clientWidth + 1 && size > base * minScale) {
        size -= base * 0.04;
        el.style.fontSize = size + 'px';
      }
      return el.scrollWidth <= el.clientWidth + 1;
    };
    // Las dos parejas con la MISMA forma (completas, «A. Tapia» o solo apellidos)
    const variants = els.map((el) => ScoreFormat.teamNameVariants(el.dataset.full));
    const last = Math.max(...variants.map((v) => v.length - 1));
    let level = 0;
    for (; level < last; level++) {
      const ok = els.every((el, k) => {
        el.textContent = variants[k][Math.min(level, variants[k].length - 1)];
        return shrinkTo(el, 0.86);
      });
      if (ok) return;
    }
    els.forEach((el, k) => {
      el.textContent = variants[k][Math.min(level, variants[k].length - 1)];
      shrinkTo(el, 0.65);
    });
  }

  /**
   * Celebración: los nombres de los ganadores SIEMPRE completos. La letra se
   * ajusta para que el nombre más largo quepa en su línea; si fuera muy
   * pequeña, el nombre pasa a dos líneas (nunca «…»).
   */
  function fitCelebration() {
    const names = celebrate.querySelector('.cel-names');
    if (!names || celebrate.classList.contains('hidden')) return;
    const content = celebrate.querySelector('.cel-content');
    const emblem = celebrate.querySelector('.cel-emblem-wrap');
    const text = celebrate.querySelector('.cel-text');
    names.style.fontSize = '';
    names.classList.remove('is-wrapped');
    const base = parseFloat(getComputedStyle(names).fontSize);
    const gap = parseFloat(getComputedStyle(content).columnGap) || 0;
    const maxText = parseFloat(getComputedStyle(text).maxWidth) || Infinity;
    const available = Math.min(maxText, content.clientWidth - (emblem ? emblem.offsetWidth + gap : 0));
    const widest = Math.max(...Array.from(names.children, (span) => span.scrollWidth));
    if (!(available > 0) || !(widest > 0)) return;
    const scale = Math.min(1, (available * 0.98) / widest);
    if (scale >= 0.55) {
      names.style.fontSize = base * scale + 'px';
      return;
    }
    // Nombre larguísimo: dos líneas por jugador, con la letra que quepa
    names.classList.add('is-wrapped');
    names.style.fontSize = base * 0.6 + 'px';
    let size = base * 0.6;
    while (size > base * 0.3 && Array.from(names.children).some((span) => span.scrollWidth > span.clientWidth + 1)) {
      size *= 0.95;
      names.style.fontSize = size + 'px';
    }
  }

  /** Cambió el tamaño de la salida o se mostraron las estadísticas: reajustar los nombres */
  function fit() {
    fitNames();
    fitCelebration();
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
