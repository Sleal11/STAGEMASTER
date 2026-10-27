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
 * Uso: window.ScoreFormat.formatSetScore(set), etc.
 */

'use strict';

(function () {

  /** Texto del badge para cada fase de desempate */
  var PHASE_LABELS = {
    tiebreak:      'TIE BREAK',
    superTiebreak: 'SUPER TIE BREAK',
  };

  /**
   * Texto del badge cuando el siguiente punto decide el game (40-40 decisivo).
   * Con Punto Estrella, el punto decisivo del 3.er iguales se anuncia también
   * como PUNTO DE ORO: es el término que entiende el público.
   */
  var DECISIVE_POINT_LABELS = {
    goldenPoint: 'PUNTO DE ORO',
    starPoint:   'PUNTO DE ORO',
  };

  /**
   * Texto de un set terminado:
   *   normal → "6-3" | con tie break → "7-6 (8-6)" | súper TB decisivo → "STB 10-8"
   */
  function formatSetScore(set) {
    if (set.superTiebreak) return 'STB ' + set.tiebreak.A + '-' + set.tiebreak.B;
    var text = set.A + '-' + set.B;
    if (set.tiebreak) text += ' (' + set.tiebreak.A + '-' + set.tiebreak.B + ')';
    return text;
  }

  /** true si se juega el Súper Tie Break que sustituye al set decisivo (sin games jugados) */
  function isDecidingSuperTiebreak(state) {
    return state.phase === 'superTiebreak' &&
           state.players.A.games === 0 &&
           state.players.B.games === 0;
  }

  /** Badge del momento: TIE BREAK, SUPER TIE BREAK, PUNTO DE ORO / ESTRELLA, o null */
  function badgeFor(state) {
    if (!state || state.status !== 'playing') return null;
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
    var words = String(name).trim().split(/\s+/);
    if (words.length < 2) return words[0] || '';
    return words[0] + ' ' + words[1].charAt(0).toUpperCase();
  }

  /** Resumen corto para la estación: "40-15 · 3-2 · 1-0" (puntos · games · sets) */
  function compactScore(state) {
    if (!state) return '';
    var p = state.players;
    return p.A.points + '-' + p.B.points + ' · ' + p.A.games + '-' + p.B.games + ' · ' + p.A.sets + '-' + p.B.sets;
  }

  window.ScoreFormat = {
    PHASE_LABELS:          PHASE_LABELS,
    DECISIVE_POINT_LABELS: DECISIVE_POINT_LABELS,
    formatSetScore:        formatSetScore,
    isDecidingSuperTiebreak: isDecidingSuperTiebreak,
    badgeFor:              badgeFor,
    splitTeamName:         splitTeamName,
    abbreviateName:        abbreviateName,
    compactScore:          compactScore,
  };
})();
