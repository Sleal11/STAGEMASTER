/**
 * score-format.js — Formato del marcador (compartido)
 *
 * Funciones de PRESENTACIÓN que usan las tres interfaces (teléfono,
 * pantallas y estación). Antes estaban duplicadas en control.js y
 * score.js; ahora hay una sola versión.
 *
 * No contiene reglas del pádel: solo convierte el estado que envía el
 * servidor en textos para mostrar.
 *
 * Uso (módulo ES):  import * as ScoreFormat from './common/score-format.js';
 */

/** Texto del badge para cada fase de desempate */
const PHASE_LABELS = {
  tiebreak:      'TIE BREAK',
  superTiebreak: 'SUPER TIE BREAK',
};

/**
 * Nombre de cada sistema de puntuación en TODAS las interfaces (estación,
 * teléfono, historial). El valor interno 'starPoint' se conserva (partidos
 * guardados e historial); su nombre visible es «FIP 2026».
 */
export const SCORING_NAMES = {
  advantage:   'Ventaja',
  goldenPoint: 'Punto de oro',
  starPoint:   'FIP 2026',
};

/**
 * Texto del badge cuando el siguiente punto decide el game (40-40 decisivo).
 * Con FIP 2026, el punto decisivo del 3.er iguales se anuncia también
 * como PUNTO DE ORO: es el término que entiende el público.
 */
const DECISIVE_POINT_LABELS = {
  goldenPoint: 'PUNTO DE ORO',
  starPoint:   'PUNTO DE ORO',
};

/**
 * Explicación de cada sistema de puntuación (reglamento FIP), para que el
 * moderador y el árbitro sepan qué eligen. Punto de oro y FIP 2026 NO son
 * lo mismo: cambian en qué 40-40 se juega el punto decisivo.
 */
const SCORING_HELP = {
  advantage:   'Ventaja: en cada 40-40 se juega ventaja; hay que ganar el game por 2 puntos.',
  goldenPoint: 'Punto de oro: en el PRIMER 40-40, el siguiente punto gana el game (no hay ventaja).',
  starPoint:   'FIP 2026 (reglamento actual): ventaja en el 1.er y el 2.º 40-40; en el TERCER 40-40, ' +
               'el siguiente punto gana el game. La pantalla lo anuncia como PUNTO DE ORO.',
};

/**
 * Texto de un set terminado:
 *   normal → "6-3" | con tie break → "7-6 (8-6)" | súper TB decisivo → "STB 10-8"
 */
function formatSetScore(set) {
  if (set.superTiebreak) return 'STB ' + set.tiebreak.A + '-' + set.tiebreak.B;
  let text = set.A + '-' + set.B;
  if (set.tiebreak) text += ' (' + set.tiebreak.A + '-' + set.tiebreak.B + ')';
  return text;
}

/** true si se juega el Súper Tie Break que sustituye al set decisivo (sin games jugados) */
function isDecidingSuperTiebreak(state) {
  return state.phase === 'superTiebreak' &&
         state.players.A.games === 0 &&
         state.players.B.games === 0;
}

/**
 * Quién tiene SET POINT o MATCH POINT (state.pressure lo calcula el servidor
 * jugando el siguiente punto con el motor).
 * @returns {{ kind: 'match'|'set', sides: string[] } | null}
 */
function pressureOf(state) {
  const p = state && state.pressure;
  if (!p) return null;
  const sides = (kind) => ['A', 'B'].filter((side) => p[side] === kind);
  if (sides('match').length) return { kind: 'match', sides: sides('match') };
  if (sides('set').length) return { kind: 'set', sides: sides('set') };
  return null;
}

/**
 * Badge del momento, por prioridad: EN PAUSA · MATCH POINT · SET POINT ·
 * PUNTO DE ORO · TIE BREAK / SUPER TIE BREAK · nada.
 * kind: 'pause' | 'match' | 'set' | 'gold' | 'phase' (el color de cada interfaz)
 */
function badgeFor(state) {
  if (!state || state.status !== 'playing') return null;
  if (state.paused) return { text: 'EN PAUSA', kind: 'pause', gold: false, pause: true };
  const pressure = pressureOf(state);
  if (pressure) return { text: pressure.kind === 'match' ? 'MATCH POINT' : 'SET POINT', kind: pressure.kind, sides: pressure.sides, gold: false };
  if (state.decisivePoint) {
    return { text: DECISIVE_POINT_LABELS[state.config.scoringSystem] || 'PUNTO DECISIVO', kind: 'gold', gold: true };
  }
  if (PHASE_LABELS[state.phase]) return { text: PHASE_LABELS[state.phase], kind: 'phase', gold: false };
  return null;
}

/**
 * Jugadores de una pareja: "Jose V / Santiago R" → ["Jose V", "Santiago R"].
 * Un nombre sin "/" (ej. "Equipo Azul") devuelve un solo elemento.
 */
function splitTeamName(name) {
  return String(name || '')
    .split('/')
    .map(function (part) { return part.trim(); })
    .filter(Boolean);
}

/**
 * Formato abreviado "Nombre I" (inicial del apellido), el que usa el
 * proyecto cuando un nombre no cabe: "Santiago Rodríguez" → "Santiago R".
 * Un nombre de una sola palabra no se modifica.
 */
function abbreviateName(name) {
  const words = String(name).trim().split(/\s+/);
  if (words.length < 2) return words[0] || '';
  return words[0] + ' ' + words[1].charAt(0).toUpperCase();
}

/**
 * Formas de escribir una pareja, de la más larga a la más corta, para cuando
 * no cabe (estadísticas de la pantalla). Se supone «Nombre Apellido1 Apellido2»:
 *   "Agustin Tapia / Arturo Coello" → "A. Tapia / A. Coello" → "Tapia / Coello"
 *   "Federico Chingotto Ruiz" → "F. Chingotto Ruiz" → "F. Chingotto" → "Chingotto"
 * Un jugador de una sola palabra se queda igual en todas.
 */
function teamNameVariants(name) {
  const players = splitTeamName(name);
  if (!players.length) return [String(name || '')];
  const form = (fn) => players.map((p) => {
    const words = p.split(/\s+/);
    return words.length < 2 ? p : fn(words);
  }).join(' / ');
  const initial = (w) => w[0].charAt(0).toUpperCase() + '.';
  const variants = [
    players.join(' / '),
    form((w) => initial(w) + ' ' + w.slice(1).join(' ')),
    form((w) => initial(w) + ' ' + w[1]),
    form((w) => w[1]),
  ];
  return variants.filter((v, i) => variants.indexOf(v) === i);
}

// ─────────────────────────────────────────────────────────────────
// RESUMEN FINAL DEL PARTIDO (pantalla, teléfono e historial)
// ─────────────────────────────────────────────────────────────────

/** "1 h 12 min" · "48 min" · "menos de 1 min" */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'menos de 1 min';
  const h = Math.floor(min / 60);
  return h ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

/**
 * Resumen del partido terminado. SOLO datos registrados: si el partido no
 * tiene estadísticas completas (empezó con una versión anterior), solo se
 * muestran el resultado, los juegos y la duración.
 *
 * @param {Object} m - { names: {A,B}, winner, setsWon: {A,B}, setScores, unfinishedSet,
 *                       stats, scoringSystem, startedAt, finishedAt, pausedMs }
 * @returns {{ winner, loser, names, setsWon, sets: string[], duration: string,
 *            rows: Array<{ key, label, A, B }> }}
 */
function matchSummary(m) {
  const winner = m.winner === 'A' || m.winner === 'B' ? m.winner : null;
  const sets = (m.setScores || []).map(formatSetScore);
  if (m.unfinishedSet) sets.push(`${m.unfinishedSet.A}-${m.unfinishedSet.B}`);
  // Juegos ganados: los de cada set (un súper tie break decisivo cuenta como 1 juego)
  const games = { A: 0, B: 0 };
  (m.setScores || []).forEach((set) => {
    if (set.superTiebreak) games[set.tiebreak.A > set.tiebreak.B ? 'A' : 'B'] += 1;
    else { games.A += set.A; games.B += set.B; }
  });
  if (m.unfinishedSet) { games.A += m.unfinishedSet.A; games.B += m.unfinishedSet.B; }

  const rows = [{ key: 'games', label: 'Juegos ganados', A: games.A, B: games.B }];
  const st = m.stats && !m.stats.partial ? m.stats : null;
  if (st) {
    rows.push({ key: 'points', label: 'Puntos ganados', A: st.points.A, B: st.points.B });
    if (m.scoringSystem && m.scoringSystem !== 'advantage') {
      rows.push({ key: 'decisive', label: 'Puntos de oro ganados', A: st.decisive.A, B: st.decisive.B });
    }
    rows.push({ key: 'breaks', label: 'Breaks (juegos al resto)', A: st.breaks.A, B: st.breaks.B });
    rows.push({ key: 'streak', label: 'Mejor racha de puntos', A: st.bestStreak.A, B: st.bestStreak.B });
  }
  const played = m.startedAt && m.finishedAt ? m.finishedAt - m.startedAt - (m.pausedMs || 0) : null;
  return {
    winner,
    loser: winner ? (winner === 'A' ? 'B' : 'A') : null,
    names: m.names,
    setsWon: m.setsWon,
    sets,
    duration: formatDuration(played),
    rows,
  };
}

/** Resumen desde el estado del partido (pantalla y teléfono) */
function summaryFromState(state) {
  const t = state.timing || {};
  const current = { A: state.players.A.games, B: state.players.B.games };
  return matchSummary({
    names: { A: state.players.A.name, B: state.players.B.name },
    winner: state.winner,
    setsWon: { A: state.players.A.sets, B: state.players.B.sets },
    setScores: state.setScores,
    unfinishedSet: current.A || current.B ? current : null,
    stats: state.stats,
    scoringSystem: state.config && state.config.scoringSystem,
    startedAt: t.startedAt, finishedAt: t.finishedAt, pausedMs: t.pausedMs,
  });
}

/** Resumen desde un registro del historial (estación) */
function summaryFromRecord(r) {
  return matchSummary({
    names: r.teams, winner: r.winner, setsWon: r.sets, setScores: r.setScores, unfinishedSet: r.unfinishedSet,
    stats: r.stats, scoringSystem: (r.config || {}).scoringSystem,
    startedAt: r.startedAt, finishedAt: r.finishedAt, pausedMs: r.pausedMs,
  });
}

export {
  SCORING_HELP, formatSetScore, isDecidingSuperTiebreak, badgeFor, splitTeamName, abbreviateName, teamNameVariants,
  summaryFromState, summaryFromRecord,
};
