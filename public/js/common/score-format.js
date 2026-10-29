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
 * Texto del badge cuando el siguiente punto decide el game (40-40 decisivo).
 * Con Punto Estrella, el punto decisivo del 3.er iguales se anuncia también
 * como PUNTO DE ORO: es el término que entiende el público.
 */
const DECISIVE_POINT_LABELS = {
  goldenPoint: 'PUNTO DE ORO',
  starPoint:   'PUNTO DE ORO',
};

/**
 * Explicación de cada sistema de puntuación (reglamento FIP), para que el
 * moderador y el árbitro sepan qué eligen. Punto de oro y Punto Estrella NO son
 * lo mismo: cambian en qué 40-40 se juega el punto decisivo.
 */
const SCORING_HELP = {
  advantage:   'Ventaja: en cada 40-40 se juega ventaja; hay que ganar el game por 2 puntos.',
  goldenPoint: 'Punto de oro: en el PRIMER 40-40, el siguiente punto gana el game (no hay ventaja).',
  starPoint:   'Punto Estrella (FIP 2026): ventaja en el 1.er y el 2.º 40-40; en el TERCER 40-40, ' +
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

/** Badge del momento: EN PAUSA, TIE BREAK, SUPER TIE BREAK, PUNTO DE ORO, o null */
function badgeFor(state) {
  if (!state || state.status !== 'playing') return null;
  if (state.paused) return { text: 'EN PAUSA', gold: false, pause: true };
  if (PHASE_LABELS[state.phase]) return { text: PHASE_LABELS[state.phase], gold: false };
  if (state.decisivePoint) {
    return { text: DECISIVE_POINT_LABELS[state.config.scoringSystem] || 'PUNTO DECISIVO', gold: true };
  }
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

/** Resumen corto para la estación: "40-15 · 3-2 · 1-0" (puntos · games · sets) */
function compactScore(state) {
  if (!state) return '';
  const p = state.players;
  return p.A.points + '-' + p.B.points + ' · ' + p.A.games + '-' + p.B.games + ' · ' + p.A.sets + '-' + p.B.sets;
}

export {
  PHASE_LABELS, DECISIVE_POINT_LABELS, SCORING_HELP, formatSetScore, isDecidingSuperTiebreak,
  badgeFor, splitTeamName, abbreviateName, compactScore,
};
