'use strict';

/**
 * engine.random.test.js — Partidos ALEATORIOS en TODAS las modalidades
 *
 * Un «árbitro de referencia» escrito aparte (sencillo, con las reglas FIP
 * contadas a mano: puntos como números, no 15-30-40) juega los mismos puntos
 * que el motor y, después de CADA acción, se comparan:
 *   marcador (15-30-40-AD y puntos del desempate), games, sets, fase (normal,
 *   tie break, súper tie break), saque, estado, ganador, resultado de cada set,
 *   punto decisivo (punto de oro / FIP 2026) y SET POINT / MATCH POINT.
 * Al final de cada partido también las estadísticas (puntos, puntos de oro,
 * juegos con saque, breaks y mejor racha).
 *
 * Modalidades: games por set 1-6 × 1, 3, 5, 7 y 9 sets × ventaja, punto de oro
 * y FIP 2026 × tie break, súper tie break y sin desempate × saca A o B
 * (540 combinaciones), con partidos igualados y desiguales, y con «Deshacer»,
 * «Cambiar saque» y «Finalizar» al azar.
 *
 * Reproducible: semilla fija (otra semilla: SEED=123 node …).
 * Tres partidos por modalidad: igualado, desigual y muy desigual (~20 s).
 */

const assert = require('assert');
const { createMatch, applyAction, pointPressure } = require('./engine');

const SEED = Number(process.env.SEED) || 20261111;
let seed = SEED >>> 0;
/** Generador pseudoaleatorio (mulberry32): mismo resultado en cada ejecución */
function random() {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const other = (side) => (side === 'A' ? 'B' : 'A');
const copy = (o) => JSON.parse(JSON.stringify(o));
const HISTORY = 50;   // el motor guarda las 50 últimas acciones para «Deshacer»

// ─────────────────────────────────────────────────────────────────
// ÁRBITRO DE REFERENCIA
// ─────────────────────────────────────────────────────────────────

function newReferee(cfg) {
  return {
    cfg, setsToWin: (cfg.totalSets + 1) / 2,
    raw: { A: 0, B: 0 },          // puntos del game (números) o del desempate
    games: { A: 0, B: 0 }, sets: { A: 0, B: 0 },
    phase: 'normal', server: cfg.initialServer, tbFirst: null,
    setScores: [], status: 'playing', winner: null,
    stats: { points: { A: 0, B: 0 }, decisive: { A: 0, B: 0 }, holds: { A: 0, B: 0 }, breaks: { A: 0, B: 0 },
      best: { A: 0, B: 0 }, streak: { side: null, n: 0 } },
  };
}

const lastSet = (r) => r.sets.A === r.setsToWin - 1 && r.sets.B === r.setsToWin - 1;
const decidingSuper = (r) => r.cfg.tiebreakType === 'superTiebreak' && r.setsToWin > 1 && lastSet(r);

/** 40-40 en el que el siguiente punto gana el game */
function decisive(r) {
  if (r.status !== 'playing' || r.phase !== 'normal') return false;
  const { A, B } = r.raw;
  if (A < 3 || A !== B) return false;
  if (r.cfg.scoringSystem === 'goldenPoint') return true;
  if (r.cfg.scoringSystem === 'starPoint') return A >= 5;   // 3-3, 4-4 → ventaja; 5-5 = 3.er 40-40
  return false;
}

/** Marcador que se ve: 0/15/30/40/AD, o los puntos del desempate */
function shown(r) {
  if (r.phase !== 'normal') return { ...r.raw };
  const { A, B } = r.raw;
  if (A >= 3 && B >= 3) {
    if (A === B) return { A: 40, B: 40 };
    return A > B ? { A: 'AD', B: 40 } : { A: 40, B: 'AD' };
  }
  const L = [0, 15, 30, 40];
  return { A: L[A], B: L[B] };
}

function winSet(r, side, tiebreak) {
  const score = { A: r.games.A, B: r.games.B };
  if (tiebreak) score.tiebreak = tiebreak;
  if (decidingSuper(r)) score.superTiebreak = true;
  r.setScores.push(score);
  r.sets[side] += 1;
  r.games = { A: 0, B: 0 };
  r.raw = { A: 0, B: 0 };
  r.phase = 'normal';
  if (r.sets[side] === r.setsToWin) { r.status = 'finished'; r.winner = side; return; }
  if (decidingSuper(r)) { r.phase = 'superTiebreak'; r.tbFirst = r.server; }
}

function point(r, side) {
  if (r.status !== 'playing') return;
  const st = r.stats;
  st.points[side] += 1;
  if (decisive(r)) st.decisive[side] += 1;
  st.streak = { side, n: st.streak.side === side ? st.streak.n + 1 : 1 };
  st.best[side] = Math.max(st.best[side], st.streak.n);

  if (r.phase !== 'normal') {
    r.raw[side] += 1;
    const total = r.raw.A + r.raw.B;
    if (total % 2 === 1) r.server = other(r.server);   // 1 saque y luego cada 2
    const target = r.phase === 'superTiebreak' ? 10 : 7;
    if (r.raw[side] >= target && r.raw[side] - r.raw[other(side)] >= 2) {
      const tb = { ...r.raw };
      r.games[side] += 1;
      r.server = other(r.tbFirst);   // saca el set siguiente quien recibió el 1.er punto
      winSet(r, side, tb);
    }
    return;
  }

  const wasDecisive = decisive(r);
  r.raw[side] += 1;
  const a = r.raw[side];
  const b = r.raw[other(side)];
  const won = wasDecisive || (a >= 4 && a - b >= 2);
  if (!won) return;
  r.raw = { A: 0, B: 0 };
  st[side === r.server ? 'holds' : 'breaks'][side] += 1;
  r.games[side] += 1;
  r.server = other(r.server);
  const N = r.cfg.gamesPerSet;
  if (r.games[side] >= N && r.games[side] - r.games[other(side)] >= 2) return winSet(r, side);
  if (r.games.A === N && r.games.B === N) {
    if (lastSet(r) && r.cfg.tiebreakType === 'none') return;   // se sigue hasta 2 de diferencia
    r.phase = lastSet(r) && r.cfg.tiebreakType === 'superTiebreak' ? 'superTiebreak' : 'tiebreak';
    r.tbFirst = r.server;
  }
}

function finish(r) {
  if (r.status === 'finished') return;
  r.status = 'finished';
  r.winner = r.sets.A > r.sets.B ? 'A' : r.sets.B > r.sets.A ? 'B' : null;
}

/** SET POINT / MATCH POINT: qué pasaría si `side` gana el siguiente punto */
function pressure(r) {
  const out = { A: null, B: null };
  if (r.status !== 'playing') return out;
  ['A', 'B'].forEach((side) => {
    const next = copy(r);
    point(next, side);
    if (next.status === 'finished') out[side] = 'match';
    else if (next.sets[side] > r.sets[side]) out[side] = 'set';
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────
// COMPARACIÓN
// ─────────────────────────────────────────────────────────────────

function compare(s, r, where) {
  const got = {
    points: { A: s.players.A.points, B: s.players.B.points },
    games: { A: s.players.A.games, B: s.players.B.games },
    sets: { A: s.players.A.sets, B: s.players.B.sets },
    phase: s.phase, status: s.status, winner: s.winner || null, setScores: s.setScores,
    decisive: !!s.decisivePoint, pressure: pointPressure(s),
  };
  const want = {
    points: r.status === 'playing' ? shown(r) : got.points,   // terminado: el marcador ya no importa
    games: r.status === 'playing' ? r.games : got.games,
    sets: r.sets, phase: r.status === 'playing' ? r.phase : got.phase, status: r.status, winner: r.winner,
    setScores: r.setScores, decisive: decisive(r), pressure: pressure(r),
  };
  assert.deepStrictEqual(got, want, where);
  if (r.status === 'playing') assert.strictEqual(s.server, r.server, `${where}: saque`);
}

function compareStats(s, r, where) {
  const st = s.stats;
  assert.deepStrictEqual(
    { points: st.points, decisive: st.decisive, holds: st.holds, breaks: st.breaks, best: st.bestStreak },
    { points: r.stats.points, decisive: r.stats.decisive, holds: r.stats.holds, breaks: r.stats.breaks, best: r.stats.best },
    `${where}: estadísticas`);
}

// ─────────────────────────────────────────────────────────────────
// PARTIDOS
// ─────────────────────────────────────────────────────────────────

const CONFIGS = [];
for (const gamesPerSet of [1, 2, 3, 4, 5, 6]) {
  for (const totalSets of [1, 3, 5, 7, 9]) {
    for (const scoringSystem of ['advantage', 'goldenPoint', 'starPoint']) {
      for (const tiebreakType of ['tiebreak', 'superTiebreak', 'none']) {
        for (const initialServer of ['A', 'B']) {
          CONFIGS.push({ gamesPerSet, totalSets, scoringSystem, tiebreakType, initialServer, nameA: 'Equipo A', nameB: 'Equipo B' });
        }
      }
    }
  }
}

let matches = 0, actions = 0, undos = 0, finishedByRule = 0, manual = 0;
const seen = { tiebreak: 0, superTiebreak: 0, deciding: 0, noTiebreakLong: 0, star3: 0, golden: 0, matchPoint: 0, setPoint: 0 };
let failures = 0;

/**
 * Un partido: puntos al azar (probabilidad de A = pA), con a veces «Deshacer»
 * (1 a 4 seguidos), «Cambiar saque» o «Finalizar». El árbitro deshace con su
 * propia pila de estados.
 */
function play(cfg, pA, label) {
  let s = createMatch(cfg);
  const r = newReferee(cfg);
  let stack = [];   // estados del árbitro antes de cada acción (como el historial del motor)
  const save = () => { stack = [copy(r), ...stack].slice(0, HISTORY); };
  const restore = () => { if (stack.length) { Object.assign(r, stack[0]); stack = stack.slice(1); } };
  compare(s, r, `${label} inicio`);
  for (let i = 0; i < 4000 && r.status === 'playing'; i++) {
    const roll = random();
    let action;
    if (roll < 0.05) {
      const n = 1 + Math.floor(random() * 4);
      for (let k = 0; k < n; k++) { s = applyAction(s, 'undo'); restore(); undos++; }
      action = `undo×${n}`;
    } else if (roll < 0.06) {
      // Corrección del saque: en un desempate cambia también quién lo empezó a sacar
      s = applyAction(s, 'changeServer'); save();
      if (r.status === 'playing') { r.server = other(r.server); if (r.phase !== 'normal') r.tbFirst = other(r.tbFirst); }
      action = 'changeServer';
    } else if (roll < 0.0615) {
      s = applyAction(s, 'finishMatch'); save(); finish(r); action = 'finishMatch'; manual++;
    } else {
      const side = random() < pA ? 'A' : 'B';
      const p = pressure(r);
      if (p[side] === 'match') seen.matchPoint++;
      if (p[side] === 'set') seen.setPoint++;
      if (decisive(r)) seen[cfg.scoringSystem === 'starPoint' ? 'star3' : 'golden']++;
      s = applyAction(s, 'point' + side); save(); point(r, side); action = 'point' + side;
    }
    actions++;
    compare(s, r, `${label} acción ${i} (${action})`);
    if (r.status === 'finished' && action !== 'finishMatch') {
      // A veces se deshace el final y se sigue jugando (el motor debe volver atrás igual)
      if (random() < 0.15) { s = applyAction(s, 'undo'); restore(); undos++; compare(s, r, `${label} deshacer el final`); }
    }
  }
  if (r.status === 'finished' && r.winner && r.sets[r.winner] === r.setsToWin) finishedByRule++;
  r.setScores.forEach((set) => {
    if (set.superTiebreak) seen.deciding++;
    else if (set.tiebreak && (set.A + set.B === 2 * cfg.gamesPerSet + 1)) seen[set.tiebreak.A >= 10 || set.tiebreak.B >= 10 || cfg.tiebreakType === 'superTiebreak' && cfg.totalSets === 1 ? 'superTiebreak' : 'tiebreak']++;
    if (!set.tiebreak && Math.max(set.A, set.B) > cfg.gamesPerSet + 1) seen.noTiebreakLong++;
  });
  if (stack.length === HISTORY || r.status === 'finished') compareStats(s, r, label);
  matches++;
}

console.log(`\n🎲  PARTIDOS ALEATORIOS EN TODAS LAS MODALIDADES (semilla ${SEED})\n`);
const started = Date.now();
CONFIGS.forEach((cfg, n) => {
  const label = `[${cfg.gamesPerSet} games · ${cfg.totalSets} sets · ${cfg.scoringSystem} · ${cfg.tiebreakType} · saca ${cfg.initialServer}]`;
  // Igualado, desigual y muy desigual
  [0.5, 0.62, 0.3].forEach((pA, k) => {
    try {
      play(cfg, pA, `${label} partido ${k + 1}`);
    } catch (err) {
      failures++;
      if (failures <= 5) console.log(`  ❌  ${err.message.split('\n')[0]}\n${err.message.split('\n').slice(1, 30).join('\n')}`);
    }
  });
  if ((n + 1) % 90 === 0) console.log(`  … ${n + 1}/${CONFIGS.length} modalidades`);
});

console.log(`\n  Modalidades: ${CONFIGS.length} · partidos: ${matches} · acciones comparadas: ${actions} · «Deshacer»: ${undos}`);
console.log(`  Ganados por reglamento: ${finishedByRule} · finalizados a mano: ${manual}`);
console.log(`  Sets con tie break: ${seen.tiebreak} · súper tie break a 1 set: ${seen.superTiebreak} · súper tie break decisivo: ${seen.deciding}` +
  ` · sets largos sin desempate: ${seen.noTiebreakLong}`);
console.log(`  Puntos de oro jugados: ${seen.golden} · 3.er 40-40 FIP 2026: ${seen.star3} · set points: ${seen.setPoint} · match points: ${seen.matchPoint}`);
console.log(`  Tiempo: ${((Date.now() - started) / 1000).toFixed(1)} s`);

// Que de verdad se hayan jugado todos los casos difíciles
const covered = seen.tiebreak > 300 && seen.superTiebreak > 20 && seen.deciding > 20 && seen.noTiebreakLong > 10 &&
  seen.golden > 1000 && seen.star3 > 200 && seen.setPoint > 2000 && seen.matchPoint > 800 && manual > 100 && undos > 10000;
console.log('\n' + '─'.repeat(50));
console.log(`${failures === 0 && covered ? '✅' : '❌'}  ${matches} partidos aleatorios: el motor coincide con el árbitro de referencia` +
  `${failures ? ` (${failures} con diferencias)` : ''}${covered ? '' : ' · faltan casos por cubrir'}`);
console.log('─'.repeat(50));
if (failures || !covered) process.exit(1);
