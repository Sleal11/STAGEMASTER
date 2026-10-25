/**
 * engine-browser.js — Motor de Pádel para el navegador
 *
 * Es idéntico a server/sports/padel/engine.js en lógica.
 * La única diferencia: en lugar de `module.exports` (Node.js),
 * expone el API en `window.PadelEngine` (navegador).
 *
 * Esto permite que el Panel de Control funcione completamente
 * sin servidor (útil para testing y para la Fase 4).
 * En la Fase 7 se añadirá sincronización vía Socket.IO.
 */

(function () {
  'use strict';

  // ── Constantes ─────────────────────────────────────────────────
  var PUNTOS   = [0, 15, 30, 40];
  var VENTAJA  = 'AD';
  var MAX_HIST = 50;
  var IGUALES_PUNTO_ESTRELLA = 3;   // Punto Estrella: decisivo en el 3er 40-40

  // ── API Pública ────────────────────────────────────────────────

  function createMatch(config) {
    var setsToWin = Math.ceil(config.totalSets / 2);
    return {
      config: {
        sport:         'padel',
        gamesPerSet:   config.gamesPerSet,
        totalSets:     config.totalSets,
        setsToWin:     setsToWin,
        scoringSystem: config.scoringSystem,
        tiebreakType:  config.tiebreakType,
        initialServer: config.initialServer,
      },
      players: {
        A: { name: config.nameA || 'Equipo A', points: 0, games: 0, sets: 0 },
        B: { name: config.nameB || 'Equipo B', points: 0, games: 0, sets: 0 },
      },
      currentSet: 1,
      server:     config.initialServer,
      status:     'playing',
      phase:      'normal',
      winner:     null,
      deuceCount: 0,
      decisivePoint: false,
      setScores:  [],
      history:    [],
    };
  }

  function applyAction(state, action) {
    switch (action) {
      case 'pointA':       return applyPoint(state, 'A');
      case 'pointB':       return applyPoint(state, 'B');
      case 'undo':         return applyUndo(state);
      case 'changeServer': return applyChangeServer(state);
      case 'finishMatch':  return applyFinishMatch(state);
      default:
        throw new Error('[PadelEngine] Acción desconocida: "' + action + '"');
    }
  }

  // ── Acciones ───────────────────────────────────────────────────

  function applyPoint(state, scorer) {
    if (state.status !== 'playing') return state;

    var snapshot    = deepCopy(state);
    snapshot.history = [];

    var s    = deepCopy(state);
    s.history = [snapshot].concat(state.history).slice(0, MAX_HIST);

    if (s.phase === 'normal') {
      s = processNormalPoint(s, scorer);
    } else {
      s = processTiebreakPoint(s, scorer);
    }

    // Dato derivado para las interfaces (ver engine.js)
    s.decisivePoint = s.status === 'playing' &&
                      s.phase === 'normal' &&
                      s.players.A.points === 40 &&
                      s.players.B.points === 40 &&
                      isDecisivePoint(s);
    return s;
  }

  function applyUndo(state) {
    if (state.history.length === 0) return state;
    var prev = state.history[0];
    var rest = state.history.slice(1);
    return Object.assign({}, prev, { history: rest });
  }

  function applyChangeServer(state) {
    if (state.status !== 'playing') return state;
    var s    = deepCopy(state);
    s.server = toggleServer(s.server);
    return s;
  }

  function applyFinishMatch(state) {
    if (state.status === 'finished') return state;
    var s    = deepCopy(state);
    s.status        = 'finished';
    s.decisivePoint = false;
    if      (s.players.A.sets > s.players.B.sets) s.winner = 'A';
    else if (s.players.B.sets > s.players.A.sets) s.winner = 'B';
    return s;
  }

  // ── Lógica de Puntuación ───────────────────────────────────────

  function processNormalPoint(state, scorer) {
    var opp = opponent(scorer);
    var sp  = state.players[scorer].points;
    var op  = state.players[opp].points;

    if (sp === VENTAJA) return processGameWon(state, scorer);

    if (op === VENTAJA) {
      var s = deepCopy(state);
      s.players[scorer].points = 40;
      s.players[opp].points    = 40;
      s.deuceCount += 1;
      return s;
    }

    if (sp === 40 && op === 40) {
      if (isDecisivePoint(state)) return processGameWon(state, scorer);
      var s2 = deepCopy(state);
      s2.players[scorer].points = VENTAJA;
      return s2;
    }

    if (sp === 40) return processGameWon(state, scorer);

    var s3  = deepCopy(state);
    var idx = PUNTOS.indexOf(sp);
    s3.players[scorer].points = PUNTOS[idx + 1];
    if (s3.players[scorer].points === 40 && op === 40) s3.deuceCount += 1;
    return s3;
  }

  // Punto de oro siempre; Punto Estrella desde el 3er 40-40 (ver engine.js)
  function isDecisivePoint(state) {
    var sistema = state.config.scoringSystem;
    if (sistema === 'goldenPoint') return true;
    if (sistema === 'starPoint')   return state.deuceCount >= IGUALES_PUNTO_ESTRELLA;
    return false;
  }

  function processTiebreakPoint(state, scorer) {
    var s    = deepCopy(state);
    s.players[scorer].points += 1;

    var pA    = s.players.A.points;
    var pB    = s.players.B.points;
    var total = pA + pB;

    if (total % 2 === 1) s.server = toggleServer(s.server);

    var objetivo = s.phase === 'superTiebreak' ? 10 : 7;

    if (isTiebreakWon(pA, pB, objetivo)) {
      var ganadorTB = pA > pB ? 'A' : 'B';
      s.players[ganadorTB].games += 1;                          // 6-6 → 7-6
      s.server = opponent(tiebreakFirstServer(s.server, total)); // saca quien recibió primero
      return processSetWon(s, ganadorTB, { A: pA, B: pB });
    }
    return s;
  }

  function processGameWon(state, scorer) {
    var s    = deepCopy(state);
    s.players.A.points = 0;
    s.players.B.points = 0;
    s.deuceCount       = 0;
    s.players[scorer].games += 1;
    s.server = toggleServer(s.server);

    var gA  = s.players.A.games;
    var gB  = s.players.B.games;
    var gPS = s.config.gamesPerSet;

    if (gA >= gPS && gA - gB >= 2) return processSetWon(s, 'A');
    if (gB >= gPS && gB - gA >= 2) return processSetWon(s, 'B');

    if (gA === gPS && gB === gPS) {
      var esUltimo = isLastSet(s);
      if (esUltimo && s.config.tiebreakType === 'none') return s;
      return enterTiebreak(s);
    }
    return s;
  }

  function processSetWon(state, scorer, tiebreakScore) {
    var s    = deepCopy(state);
    var resultadoSet = { A: s.players.A.games, B: s.players.B.games };
    if (tiebreakScore) resultadoSet.tiebreak = tiebreakScore;
    if (isDecidingSuperTiebreak(s)) resultadoSet.superTiebreak = true;
    s.setScores.push(resultadoSet);
    s.players[scorer].sets += 1;
    s.players.A.games  = 0;
    s.players.B.games  = 0;
    s.players.A.points = 0;
    s.players.B.points = 0;
    s.phase            = 'normal';
    s.currentSet      += 1;

    if (s.players[scorer].sets >= s.config.setsToWin) {
      s.status = 'finished';
      s.winner = scorer;
      return s;
    }

    // Reglamento FIP: el Super Tie Break sustituye al set decisivo
    if (isDecidingSuperTiebreak(s)) s.phase = 'superTiebreak';
    return s;
  }

  function enterTiebreak(state) {
    var s       = deepCopy(state);
    var esUltimo = isLastSet(s);

    s.phase = (esUltimo && s.config.tiebreakType === 'superTiebreak')
      ? 'superTiebreak'
      : 'tiebreak';

    s.players.A.points = 0;
    s.players.B.points = 0;
    return s;
  }

  // ── Utilidades ─────────────────────────────────────────────────

  function isTiebreakWon(pA, pB, objetivo) {
    if (pA >= objetivo && pA - pB >= 2) return true;
    if (pB >= objetivo && pB - pA >= 2) return true;
    return false;
  }

  function isLastSet(state) {
    var needed = state.config.setsToWin;
    return (
      state.players.A.sets === needed - 1 &&
      state.players.B.sets === needed - 1
    );
  }

  // Super Tie Break decisivo en lugar del último set (ver engine.js)
  function isDecidingSuperTiebreak(state) {
    return state.config.tiebreakType === 'superTiebreak' &&
           state.config.setsToWin > 1 &&
           isLastSet(state);
  }

  // Primer servidor del tiebreak (ver explicación en engine.js)
  function tiebreakFirstServer(currentServer, totalPoints) {
    var cambios = Math.ceil(totalPoints / 2);
    return cambios % 2 === 1 ? toggleServer(currentServer) : currentServer;
  }

  function opponent(p)      { return p === 'A' ? 'B' : 'A'; }
  function toggleServer(sv) { return sv === 'A' ? 'B' : 'A'; }
  function deepCopy(obj)    { return JSON.parse(JSON.stringify(obj)); }

  // ── Exposición al navegador ────────────────────────────────────
  window.PadelEngine = { createMatch: createMatch, applyAction: applyAction };

})();
