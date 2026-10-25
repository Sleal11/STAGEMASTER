'use strict';

/**
 * ─────────────────────────────────────────────────────────────────
 * STAGEMASTER — PRUEBAS DEL MOTOR DE PÁDEL
 * Archivo: server/sports/padel/engine.test.js
 *
 * Ejecutar con: node server/sports/padel/engine.test.js
 *
 * Usa únicamente el módulo 'assert' de Node.js (sin dependencias externas).
 * Cubre los 12 casos requeridos + pruebas adicionales.
 * ─────────────────────────────────────────────────────────────────
 */

const assert = require('assert');
const { createMatch, applyAction } = require('./engine');

// ─────────────────────────────────────────────────────────────────
// MINI FRAMEWORK DE PRUEBAS
// ─────────────────────────────────────────────────────────────────

let pasadas  = 0;
let fallidas = 0;

/**
 * Ejecuta una prueba individual y reporta el resultado.
 * @param {string}   nombre - Descripción de lo que se prueba
 * @param {Function} fn     - Función que contiene las aserciones
 */
function test(nombre, fn) {
  try {
    fn();
    console.log(`  ✅  ${nombre}`);
    pasadas++;
  } catch (err) {
    console.log(`  ❌  ${nombre}`);
    console.log(`       → ${err.message}`);
    fallidas++;
  }
}

/** Muestra el resumen final y termina el proceso con código de error si hay fallos. */
function resumen() {
  const total = pasadas + fallidas;
  console.log('\n' + '─'.repeat(50));
  console.log(`TOTAL: ${total}  |  ✅ Pasadas: ${pasadas}  |  ❌ Fallidas: ${fallidas}`);
  console.log('─'.repeat(50));
  if (fallidas > 0) process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// HELPERS DE PRUEBA
// ─────────────────────────────────────────────────────────────────

/** Aplica una lista de acciones en secuencia sobre un estado. */
function applyMany(state, actions) {
  return actions.reduce((s, action) => applyAction(s, action), state);
}

/**
 * Configuración por defecto para la mayoría de pruebas.
 * Permite sobreescribir propiedades individuales.
 */
function config(overrides = {}) {
  return {
    gamesPerSet:   6,
    totalSets:     3,
    scoringSystem: 'advantage',
    tiebreakType:  'tiebreak',
    initialServer: 'A',
    nameA:         'Equipo A',
    nameB:         'Equipo B',
    ...overrides,
  };
}

/**
 * Simula ganar un game completo para un jugador.
 * 4 puntos consecutivos desde 0-0 con goldenPoint activo.
 * Útil para avanzar rápidamente en el marcador durante las pruebas.
 */
function ganarGame(state, scorer) {
  // Con goldenPoint no hay riesgo de deuce, el game siempre termina en 4 puntos
  const accion = 'point' + scorer;
  return applyMany(state, [accion, accion, accion, accion]);
}

// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// LAS PRUEBAS
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────

console.log('\n🎾  STAGEMASTER — MOTOR DE PÁDEL — PRUEBAS COMPLETAS\n');

// ═════════════════════════════════════════════════════════════════
// CASO 1: Punto básico 0-0 → 15-0
// ═════════════════════════════════════════════════════════════════
console.log('CASO 1: Punto básico (0-0 → 15-0)');

test('A gana un punto desde 0-0 → resultado 15-0', () => {
  const estado = createMatch(config());
  const sig    = applyAction(estado, 'pointA');

  assert.strictEqual(sig.players.A.points, 15, 'A debe tener 15 puntos');
  assert.strictEqual(sig.players.B.points, 0,  'B debe seguir en 0 puntos');
});

// ═════════════════════════════════════════════════════════════════
// CASO 2: Punto en 30-30 → 40-30
// ═════════════════════════════════════════════════════════════════
console.log('\nCASO 2: 30-30 → A gana → 40-30');

test('A gana un punto desde 30-30 → resultado 40-30', () => {
  const estado = createMatch(config());
  // A: 0→15→30, B: 0→15→30, luego A: 30→40
  const s = applyMany(estado, ['pointA', 'pointA', 'pointB', 'pointB', 'pointA']);

  assert.strictEqual(s.players.A.points, 40, 'A debe tener 40');
  assert.strictEqual(s.players.B.points, 30, 'B debe tener 30');
});

// ═════════════════════════════════════════════════════════════════
// CASO 3: Deuce → Ventaja → Game (con sistema ventaja)
// ═════════════════════════════════════════════════════════════════
console.log('\nCASO 3: Deuce → Ventaja → Game (con sistema ventaja)');

test('40-40 con ventaja: A gana punto → Ventaja A (AD-40)', () => {
  const estado  = createMatch(config({ scoringSystem: 'advantage' }));
  // Llegar a 40-40: cada jugador gana 3 puntos
  const enDeuce = applyMany(estado, [
    'pointA', 'pointA', 'pointA',   // A: 15-30-40
    'pointB', 'pointB', 'pointB',   // B: 15-30-40
  ]);

  assert.strictEqual(enDeuce.players.A.points, 40, 'Debe estar en 40-40');
  assert.strictEqual(enDeuce.players.B.points, 40, 'Debe estar en 40-40');

  const conVentaja = applyAction(enDeuce, 'pointA');
  assert.strictEqual(conVentaja.players.A.points, 'AD', 'A debe tener Ventaja (AD)');
  assert.strictEqual(conVentaja.players.B.points, 40,   'B debe seguir en 40');
});

test('Ventaja A → A vuelve a ganar → Game A (points se resetean)', () => {
  const estado     = createMatch(config({ scoringSystem: 'advantage' }));
  const enDeuce    = applyMany(estado, ['pointA','pointA','pointA','pointB','pointB','pointB']);
  const conVentaja = applyAction(enDeuce, 'pointA');  // AD-40
  const gameGanado = applyAction(conVentaja, 'pointA'); // Game A

  assert.strictEqual(gameGanado.players.A.games,  1, 'A debe tener 1 game');
  assert.strictEqual(gameGanado.players.A.points, 0, 'Puntos de A deben resetearse a 0');
  assert.strictEqual(gameGanado.players.B.points, 0, 'Puntos de B deben resetearse a 0');
});

test('Ventaja A → B gana punto → vuelve a Deuce (40-40)', () => {
  const estado     = createMatch(config({ scoringSystem: 'advantage' }));
  const enDeuce    = applyMany(estado, ['pointA','pointA','pointA','pointB','pointB','pointB']);
  const conVentaja = applyAction(enDeuce, 'pointA');  // Ventaja A
  const vueltaDeuce = applyAction(conVentaja, 'pointB'); // B anula ventaja

  assert.strictEqual(vueltaDeuce.players.A.points, 40, 'A debe volver a 40');
  assert.strictEqual(vueltaDeuce.players.B.points, 40, 'B debe volver a 40');
});

// ═════════════════════════════════════════════════════════════════
// CASO 4: Deuce con Punto de Oro → Game inmediato
// ═════════════════════════════════════════════════════════════════
console.log('\nCASO 4: Deuce con Punto de Oro → Game inmediato');

test('40-40 con goldenPoint: A gana punto → Game A inmediato (sin ventaja)', () => {
  const estado  = createMatch(config({ scoringSystem: 'goldenPoint' }));
  const enDeuce = applyMany(estado, ['pointA','pointA','pointA','pointB','pointB','pointB']);
  const gameGanado = applyAction(enDeuce, 'pointA');

  assert.strictEqual(gameGanado.players.A.games,  1, 'A debe ganar el game inmediatamente');
  assert.strictEqual(gameGanado.players.A.points, 0, 'Puntos deben resetearse');
  assert.strictEqual(gameGanado.players.B.points, 0, 'Puntos deben resetearse');
});

// ═════════════════════════════════════════════════════════════════
// CASO 5: 6-6 en games → debe entrar en Tie Break
// ═════════════════════════════════════════════════════════════════
console.log('\nCASO 5: Al llegar a 6-6 → entra en Tie Break');

test('Ambos equipos llegan a 6 games → fase cambia a "tiebreak"', () => {
  // Usamos goldenPoint para simplificar la llegada a 6-6
  let estado = createMatch(config({ scoringSystem: 'goldenPoint' }));

  // Cada jugador gana 6 games
  for (let i = 0; i < 6; i++) {
    estado = ganarGame(estado, 'A');
    estado = ganarGame(estado, 'B');
  }

  assert.strictEqual(estado.players.A.games, 6, 'A debe tener 6 games');
  assert.strictEqual(estado.players.B.games, 6, 'B debe tener 6 games');
  assert.strictEqual(estado.phase, 'tiebreak',  'La fase debe ser "tiebreak"');
});

// ═════════════════════════════════════════════════════════════════
// CASO 6: Tie Break 6-6 → A gana → 7-6 → NO termina (diff = 1)
// ═════════════════════════════════════════════════════════════════
console.log('\nCASO 6: Tie Break 7-6 NO termina (diferencia insuficiente)');

test('En Tie Break: marcador 7-6 → el Tie Break NO debe terminar', () => {
  let estado = createMatch(config({ scoringSystem: 'goldenPoint' }));

  // Llegar a Tie Break
  for (let i = 0; i < 6; i++) {
    estado = ganarGame(estado, 'A');
    estado = ganarGame(estado, 'B');
  }
  assert.strictEqual(estado.phase, 'tiebreak', 'Debe estar en tiebreak');

  // Llevar el Tie Break a 6-6 (alternando puntos)
  for (let i = 0; i < 6; i++) {
    estado = applyAction(estado, 'pointA');
    estado = applyAction(estado, 'pointB');
  }
  assert.strictEqual(estado.players.A.points, 6, 'TB debe ir 6-6');
  assert.strictEqual(estado.players.B.points, 6, 'TB debe ir 6-6');

  // A anota → 7-6
  estado = applyAction(estado, 'pointA');

  assert.strictEqual(estado.players.A.points, 7,        'A debe tener 7 en TB');
  assert.strictEqual(estado.players.B.points, 6,        'B debe tener 6 en TB');
  assert.strictEqual(estado.phase,            'tiebreak','Debe SEGUIR en tiebreak');
  assert.strictEqual(estado.status,           'playing', 'Partido NO debe terminar');
});

// ═════════════════════════════════════════════════════════════════
// CASO 7: Tie Break 7-6 → A gana → 8-6 → SÍ termina (diff = 2)
// ═════════════════════════════════════════════════════════════════
console.log('\nCASO 7: Tie Break 8-6 SÍ termina (diferencia = 2)');

test('En Tie Break: marcador 7-6 → A vuelve a anotar → 8-6 → Tie Break termina', () => {
  // Usamos totalSets: 1 para que ganar el único set acabe el partido
  let estado = createMatch(config({ scoringSystem: 'goldenPoint', totalSets: 1 }));

  // Llegar a Tie Break en el único set
  for (let i = 0; i < 6; i++) {
    estado = ganarGame(estado, 'A');
    estado = ganarGame(estado, 'B');
  }

  // Llevar TB a 6-6
  for (let i = 0; i < 6; i++) {
    estado = applyAction(estado, 'pointA');
    estado = applyAction(estado, 'pointB');
  }

  estado = applyAction(estado, 'pointA'); // → 7-6 (no termina)
  assert.strictEqual(estado.status, 'playing', '7-6 no debe terminar el partido');

  estado = applyAction(estado, 'pointA'); // → 8-6 (sí termina)

  assert.strictEqual(estado.status, 'finished', 'Partido debe haber TERMINADO');
  assert.strictEqual(estado.winner, 'A',         'A debe ser el GANADOR');
});

// ═════════════════════════════════════════════════════════════════
// CASO 8: Super Tie Break 10-9 → NO termina (diff = 1)
// ═════════════════════════════════════════════════════════════════
console.log('\nCASO 8: Super Tie Break 10-9 NO termina');

test('Super Tie Break decisivo (1-1 en sets): 10-9 → partido NO debe terminar', () => {
  let estado = createMatch(config({
    scoringSystem: 'goldenPoint',
    totalSets:     3,
    tiebreakType:  'superTiebreak',
  }));

  // Set 1: A gana 6-0
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  // Set 2: B gana 6-0 → Empatados en sets (1-1) → próximo es el último set
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'B');

  assert.strictEqual(estado.players.A.sets, 1, 'A debe tener 1 set');
  assert.strictEqual(estado.players.B.sets, 1, 'B debe tener 1 set');

  // Reglamento FIP: con 1-1 en sets el Super Tie Break SUSTITUYE al tercer set
  assert.strictEqual(estado.phase, 'superTiebreak', 'Debe estar en superTiebreak');
  assert.strictEqual(estado.players.A.games, 0, 'No se juegan games en el set decisivo');

  // Llevar Super TB a 9-9
  for (let i = 0; i < 9; i++) {
    estado = applyAction(estado, 'pointA');
    estado = applyAction(estado, 'pointB');
  }
  assert.strictEqual(estado.players.A.points, 9, 'Super TB debe ir 9-9');
  assert.strictEqual(estado.players.B.points, 9, 'Super TB debe ir 9-9');

  // A anota → 10-9 (diferencia 1, NO termina)
  estado = applyAction(estado, 'pointA');

  assert.strictEqual(estado.players.A.points, 10,            'A debe tener 10');
  assert.strictEqual(estado.players.B.points, 9,             'B debe tener 9');
  assert.strictEqual(estado.status,           'playing',     'Partido NO debe terminar (diff=1)');
  assert.strictEqual(estado.phase,            'superTiebreak','Debe seguir en superTiebreak');
});

// ═════════════════════════════════════════════════════════════════
// CASO 9: Super Tie Break 11-9 → SÍ termina (diff = 2)
// ═════════════════════════════════════════════════════════════════
console.log('\nCASO 9: Super Tie Break 11-9 SÍ termina');

test('Super Tie Break: 10-9 → A vuelve a anotar → 11-9 → partido SÍ termina', () => {
  let estado = createMatch(config({
    scoringSystem: 'goldenPoint',
    totalSets:     3,
    tiebreakType:  'superTiebreak',
  }));

  // Preparar mismo escenario del caso 8 (1-1 en sets → Super Tie Break)
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'B');

  // Llevar Super TB a 9-9
  for (let i = 0; i < 9; i++) {
    estado = applyAction(estado, 'pointA');
    estado = applyAction(estado, 'pointB');
  }

  estado = applyAction(estado, 'pointA'); // 10-9 (no termina)
  estado = applyAction(estado, 'pointA'); // 11-9 (sí termina)

  assert.strictEqual(estado.status, 'finished', 'Partido debe haber TERMINADO');
  assert.strictEqual(estado.winner, 'A',         'A debe ser el GANADOR');
});

// ═════════════════════════════════════════════════════════════════
// CASO 10: Ganar el último set → ganador del partido
// ═════════════════════════════════════════════════════════════════
console.log('\nCASO 10: Ganador del partido al ganar el último set');

test('Best-of-3: A gana 2 sets → A es el ganador del partido', () => {
  let estado = createMatch(config({ totalSets: 3, scoringSystem: 'goldenPoint' }));

  // Set 1: A gana 6-0
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  assert.strictEqual(estado.players.A.sets, 1, 'A debe tener 1 set después del set 1');
  assert.strictEqual(estado.status, 'playing',  'Partido debe seguir');

  // Set 2: A gana 6-0 → A llega a 2 sets → partido terminado
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');

  assert.strictEqual(estado.players.A.sets, 2,  'A debe tener 2 sets');
  assert.strictEqual(estado.status,         'finished', 'Partido debe haber TERMINADO');
  assert.strictEqual(estado.winner,         'A',        'A debe ser el GANADOR');
  assert.strictEqual(estado.players.A.games, 0, 'El set 3 no debe haberse jugado (games=0)');
});

test('Best-of-5: setsToWin se calcula correctamente (3 de 5)', () => {
  const estado = createMatch(config({ totalSets: 5 }));
  assert.strictEqual(estado.config.setsToWin, 3, 'Best-of-5 necesita ganar 3 sets');
});

// ═════════════════════════════════════════════════════════════════
// CASO 11: Deshacer punto → estado exactamente anterior
// ═════════════════════════════════════════════════════════════════
console.log('\nCASO 11: Undo → regresa exactamente al estado anterior');

test('Undo después de un punto: puntos vuelven a 0-0', () => {
  const inicial   = createMatch(config());
  const conPunto  = applyAction(inicial, 'pointA'); // 15-0
  const deshecho  = applyAction(conPunto, 'undo');  // de vuelta a 0-0

  assert.strictEqual(deshecho.players.A.points, 0, 'A debe volver a 0 puntos');
  assert.strictEqual(deshecho.players.B.points, 0, 'B debe volver a 0 puntos');
  assert.strictEqual(deshecho.players.A.games,  0, 'Games no deben haber cambiado');
  assert.strictEqual(deshecho.players.A.sets,   0, 'Sets no deben haber cambiado');
  assert.strictEqual(deshecho.server,           'A', 'Servidor debe ser el mismo');
});

test('Undo de un game completo: vuelve al estado antes del último punto del game', () => {
  let estado = createMatch(config({ scoringSystem: 'goldenPoint' }));
  estado = applyMany(estado, ['pointA', 'pointA', 'pointA']); // A en 40
  const antesDeGame = estado; // A tiene 40 puntos, 0 games

  estado = applyAction(estado, 'pointA'); // A gana el game (games = 1)
  assert.strictEqual(estado.players.A.games, 1, 'A debe tener 1 game antes del undo');

  estado = applyAction(estado, 'undo'); // Deshace el game

  assert.strictEqual(estado.players.A.games,  0,  'Games deben volver a 0');
  assert.strictEqual(estado.players.A.points, 40, 'Puntos deben volver a 40 (estado antes del último punto)');
});

test('Undo encadenado: permite deshacer múltiples puntos en secuencia', () => {
  const inicial  = createMatch(config());
  const s1 = applyAction(inicial, 'pointA'); // 15-0
  const s2 = applyAction(s1, 'pointB');      // 15-15
  const s3 = applyAction(s2, 'pointA');      // 30-15

  const back2 = applyAction(s3, 'undo');     // vuelve a 15-15
  const back1 = applyAction(back2, 'undo');  // vuelve a 15-0
  const back0 = applyAction(back1, 'undo');  // vuelve a 0-0

  assert.strictEqual(back2.players.A.points, 15, 'Después de 1 undo: A en 15');
  assert.strictEqual(back2.players.B.points, 15, 'Después de 1 undo: B en 15');
  assert.strictEqual(back1.players.A.points, 15, 'Después de 2 undos: A en 15');
  assert.strictEqual(back1.players.B.points, 0,  'Después de 2 undos: B en 0');
  assert.strictEqual(back0.players.A.points, 0,  'Después de 3 undos: A en 0');
  assert.strictEqual(back0.players.B.points, 0,  'Después de 3 undos: B en 0');
});

test('Undo cuando no hay historial → el estado no cambia ni se rompe', () => {
  const estado = createMatch(config()); // historial vacío
  const mismo  = applyAction(estado, 'undo');

  assert.strictEqual(mismo.players.A.points, 0, 'Estado no debe cambiar');
  assert.strictEqual(mismo.status, 'playing',    'Status no debe cambiar');
});

// ═════════════════════════════════════════════════════════════════
// CASO 12: Cambio manual de servidor
// ═════════════════════════════════════════════════════════════════
console.log('\nCASO 12: Cambio manual de servidor');

test('changeServer: el servidor cambia de A a B correctamente', () => {
  const estado   = createMatch(config({ initialServer: 'A' }));
  const cambiado = applyAction(estado, 'changeServer');

  assert.strictEqual(estado.server,   'A', 'Servidor original debe ser A');
  assert.strictEqual(cambiado.server, 'B', 'Servidor debe haber cambiado a B');
});

test('Undo después de changeServer: restaura el servidor sin tocar los puntos', () => {
  let estado = applyMany(createMatch(config({ initialServer: 'A' })), ['pointA', 'changeServer']);
  assert.strictEqual(estado.server, 'B');
  estado = applyAction(estado, 'undo');
  assert.strictEqual(estado.server, 'A', 'El undo revierte la corrección de saque');
  assert.strictEqual(estado.players.A.points, 15, 'El punto anterior se conserva');
});

test('Undo después de finishMatch: el partido vuelve a jugarse con los puntos intactos', () => {
  let estado = applyMany(createMatch(config()), ['pointA', 'pointA', 'finishMatch']);
  assert.strictEqual(estado.status, 'finished');
  estado = applyAction(estado, 'undo');
  assert.strictEqual(estado.status, 'playing', 'El final se deshace');
  assert.strictEqual(estado.winner, null);
  assert.strictEqual(estado.players.A.points, 30, 'Los puntos válidos NO se pierden');
});

test('finishMatch sin puntos previos también se puede deshacer', () => {
  let estado = applyAction(createMatch(config()), 'finishMatch');
  estado = applyAction(estado, 'undo');
  assert.strictEqual(estado.status, 'playing');
});

test('changeServer doble: regresa al servidor original', () => {
  const estado  = createMatch(config({ initialServer: 'A' }));
  const paso1   = applyAction(estado, 'changeServer'); // A → B
  const paso2   = applyAction(paso1, 'changeServer');  // B → A

  assert.strictEqual(paso2.server, 'A', 'Después de 2 cambios debe volver a A');
});

test('El servidor cambia automáticamente al terminar cada game', () => {
  const estado     = createMatch(config({ initialServer: 'A', scoringSystem: 'goldenPoint' }));
  const trasGame   = ganarGame(estado, 'A'); // A gana el game

  assert.strictEqual(trasGame.server, 'B', 'Servidor debe haber cambiado a B tras el game');
});

test('El servidor cambia cada 2 puntos en el Tie Break', () => {
  let estado = createMatch(config({ scoringSystem: 'goldenPoint' }));

  // Llegar a Tie Break
  for (let i = 0; i < 6; i++) {
    estado = ganarGame(estado, 'A');
    estado = ganarGame(estado, 'B');
  }
  const servidorInicialTB = estado.server;

  // Punto 1 (total=1, impar) → debe cambiar servidor
  const tras1 = applyAction(estado, 'pointA');
  assert.notStrictEqual(tras1.server, servidorInicialTB, 'Servidor debe cambiar tras el punto 1 del TB');

  // Punto 2 (total=2, par) → NO debe cambiar servidor
  const tras2 = applyAction(tras1, 'pointB');
  assert.strictEqual(tras2.server, tras1.server, 'Servidor NO debe cambiar tras el punto 2 del TB');

  // Punto 3 (total=3, impar) → debe cambiar servidor
  const tras3 = applyAction(tras2, 'pointA');
  assert.notStrictEqual(tras3.server, tras2.server, 'Servidor debe cambiar tras el punto 3 del TB');
});

// ═════════════════════════════════════════════════════════════════
// PRUEBAS ADICIONALES
// ═════════════════════════════════════════════════════════════════
console.log('\nPRUEBAS ADICIONALES');

test('Progresión completa de puntos: 0 → 15 → 30 → 40', () => {
  const e0 = createMatch(config());
  const e1 = applyAction(e0, 'pointA');
  const e2 = applyAction(e1, 'pointA');
  const e3 = applyAction(e2, 'pointA');

  assert.strictEqual(e1.players.A.points, 15, '1er punto: 15');
  assert.strictEqual(e2.players.A.points, 30, '2do punto: 30');
  assert.strictEqual(e3.players.A.points, 40, '3er punto: 40');
});

test('El partido no termina antes de ganar suficientes sets', () => {
  // Best-of-3: no debe terminar al ganar 1 solo set
  let estado = createMatch(config({ totalSets: 3, scoringSystem: 'goldenPoint' }));
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A'); // A gana set 1

  assert.strictEqual(estado.players.A.sets, 1,   'A debe tener 1 set');
  assert.strictEqual(estado.status, 'playing',    'Partido NO debe terminar todavía');
  assert.strictEqual(estado.winner, null,          'No debe haber ganador todavía');
});

test('El historial de sets se registra correctamente', () => {
  let estado = createMatch(config({ totalSets: 3, scoringSystem: 'goldenPoint' }));

  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A'); // Set 1: A gana 6-0
  for (let i = 0; i < 3; i++) {
    estado = ganarGame(estado, 'B');
    estado = ganarGame(estado, 'A');
  }
  for (let i = 0; i < 3; i++) estado = ganarGame(estado, 'A'); // Set 2: A gana 6-3

  assert.strictEqual(estado.setScores.length, 2,  '2 sets deben estar registrados');
  assert.strictEqual(estado.setScores[0].A,   6,  'Set 1: A tuvo 6 games');
  assert.strictEqual(estado.setScores[0].B,   0,  'Set 1: B tuvo 0 games');
  assert.strictEqual(estado.setScores[1].A,   6,  'Set 2: A tuvo 6 games');
  assert.strictEqual(estado.setScores[1].B,   3,  'Set 2: B tuvo 3 games');
});

test('Con tiebreakType="none" en último set: NO entra en tiebreak', () => {
  let estado = createMatch(config({
    totalSets:     1,  // Un solo set → siempre es el "último"
    scoringSystem: 'goldenPoint',
    tiebreakType:  'none',
  }));

  // Llevar a 6-6 en games
  for (let i = 0; i < 6; i++) {
    estado = ganarGame(estado, 'A');
    estado = ganarGame(estado, 'B');
  }

  // Con 'none', la fase debe seguir siendo 'normal' (sin tiebreak)
  assert.strictEqual(estado.phase, 'normal', 'Con tiebreakType="none" NO debe entrar en tiebreak');

  // A gana 2 games más → 8-6 → A gana el set (diff >= 2)
  estado = ganarGame(estado, 'A'); // 7-6
  assert.strictEqual(estado.status, 'playing', '7-6 aún no termina (diff=1)');

  estado = ganarGame(estado, 'A'); // 8-6 → A gana el set y el partido
  assert.strictEqual(estado.status, 'finished', '8-6 → partido terminado');
  assert.strictEqual(estado.winner,  'A',         'A debe ser el ganador');
});

test('El estado no muta: el estado original no cambia al aplicar una acción', () => {
  const original = createMatch(config());
  const copia    = JSON.parse(JSON.stringify(original)); // copia de referencia

  applyAction(original, 'pointA'); // Aplicar acción

  // El estado original no debe haber cambiado
  assert.strictEqual(original.players.A.points, copia.players.A.points,
    'El estado original NO debe mutarse');
});

test('finishMatch: termina el partido manualmente con el líder en sets como ganador', () => {
  let estado = createMatch(config({ totalSets: 3, scoringSystem: 'goldenPoint' }));

  // A gana un set, B no ha ganado ninguno
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  assert.strictEqual(estado.players.A.sets, 1);

  const finalizado = applyAction(estado, 'finishMatch');
  assert.strictEqual(finalizado.status, 'finished', 'Partido debe estar finalizado');
  assert.strictEqual(finalizado.winner, 'A',         'A debe ser el ganador por más sets');
});

test('No se pueden registrar puntos en un partido finalizado', () => {
  let estado = createMatch(config({ totalSets: 1, scoringSystem: 'goldenPoint' }));

  // A gana el único set
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  assert.strictEqual(estado.status, 'finished');

  // Intentar añadir un punto después de que terminó
  const mismo = applyAction(estado, 'pointA');
  assert.strictEqual(mismo.players.A.points, 0, 'No se deben registrar puntos en partido terminado');
  assert.strictEqual(mismo.status, 'finished',    'Status debe seguir siendo "finished"');
});

// ═════════════════════════════════════════════════════════════════
// CORRECCIÓN 1: Un set ganado en tiebreak se registra como 7-6
// ═════════════════════════════════════════════════════════════════
console.log('\nCORRECCIÓN 1: Resultado del set decidido en tiebreak');

/** Lleva un partido nuevo hasta 6-6 en games (inicio del tiebreak del set 1) */
function llegarATiebreak(overrides = {}) {
  let estado = createMatch(config({ scoringSystem: 'goldenPoint', ...overrides }));
  for (let i = 0; i < 6; i++) {
    estado = ganarGame(estado, 'A');
    estado = ganarGame(estado, 'B');
  }
  return estado;
}

test('Tie Break 8-6 → el set se registra como 7-6 con el detalle del tiebreak', () => {
  let estado = llegarATiebreak();
  for (let i = 0; i < 6; i++) estado = applyMany(estado, ['pointA', 'pointB']); // 6-6
  estado = applyMany(estado, ['pointA', 'pointA']);                              // 8-6

  assert.deepStrictEqual(estado.setScores[0], { A: 7, B: 6, tiebreak: { A: 8, B: 6 } });
  assert.strictEqual(estado.players.A.sets, 1, 'A debe sumar el set');
  assert.strictEqual(estado.phase, 'normal',   'El set siguiente empieza en fase normal');
});

test('Tie Break ganado por B (5-7) → el set se registra como 6-7', () => {
  let estado = llegarATiebreak();
  for (let i = 0; i < 5; i++) estado = applyMany(estado, ['pointA', 'pointB']); // 5-5
  estado = applyMany(estado, ['pointB', 'pointB']);                              // 5-7

  assert.deepStrictEqual(estado.setScores[0], { A: 6, B: 7, tiebreak: { A: 5, B: 7 } });
  assert.strictEqual(estado.players.B.sets, 1);
});

test('Partido a 1 set con Super TB: a 6-6 se juega Super Tie Break y se registra 7-6 (11-9)', () => {
  let estado = createMatch(config({ scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak', totalSets: 1 }));
  for (let i = 0; i < 6; i++) {
    estado = ganarGame(estado, 'A');
    estado = ganarGame(estado, 'B');
  }
  assert.strictEqual(estado.phase, 'superTiebreak');
  for (let i = 0; i < 9; i++) estado = applyMany(estado, ['pointA', 'pointB']); // 9-9
  estado = applyMany(estado, ['pointA', 'pointA']);                              // 11-9

  assert.deepStrictEqual(estado.setScores[0], { A: 7, B: 6, tiebreak: { A: 11, B: 9 } });
  assert.strictEqual(estado.winner, 'A');
});

test('Un set normal (6-3) NO incluye el campo tiebreak', () => {
  let estado = createMatch(config({ scoringSystem: 'goldenPoint' }));
  for (let i = 0; i < 3; i++) estado = ganarGame(estado, 'B');
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  assert.deepStrictEqual(estado.setScores[0], { A: 6, B: 3 });
});

// ═════════════════════════════════════════════════════════════════
// CORRECCIÓN 2: Saque del set siguiente a un tiebreak
// Regla: saca primero quien RECIBIÓ el primer punto del tiebreak
// ═════════════════════════════════════════════════════════════════
console.log('\nCORRECCIÓN 2: Saque después de un tiebreak');

test('A saca el primer punto del Tie Break → B saca el primer game del set siguiente', () => {
  let estado = llegarATiebreak({ initialServer: 'A' });
  // 12 games jugados → el servidor rotó 12 veces → vuelve a A
  assert.strictEqual(estado.server, 'A', 'A debe sacar el primer punto del tiebreak');
  estado = applyMany(estado, Array(7).fill('pointA')); // 7-0 (total impar)
  assert.strictEqual(estado.server, 'B', 'B debe sacar el set 2');
});

test('El saque posterior no depende del total de puntos del tiebreak (8-6, total par)', () => {
  let estado = llegarATiebreak({ initialServer: 'A' });
  for (let i = 0; i < 6; i++) estado = applyMany(estado, ['pointA', 'pointB']);
  estado = applyMany(estado, ['pointA', 'pointA']); // 8-6
  assert.strictEqual(estado.server, 'B', 'B debe sacar el set 2');
});

test('B saca el primer punto del Tie Break → A saca el set siguiente', () => {
  let estado = llegarATiebreak({ initialServer: 'B' });
  assert.strictEqual(estado.server, 'B', 'B debe sacar el primer punto del tiebreak');
  for (let i = 0; i < 5; i++) estado = applyMany(estado, ['pointA', 'pointB']);
  estado = applyMany(estado, ['pointB', 'pointB']); // 5-7
  assert.strictEqual(estado.server, 'A', 'A debe sacar el set 2');
});

test('Corrección manual de saque durante el Tie Break también se respeta al terminar', () => {
  let estado = llegarATiebreak({ initialServer: 'A' });
  // El operador corrige: en realidad el tiebreak lo empezó sacando B
  estado = applyAction(estado, 'changeServer');
  estado = applyMany(estado, Array(7).fill('pointA'));
  assert.strictEqual(estado.server, 'A', 'Recibió primero A → A saca el set 2');
});

test('Undo del punto que cierra el Tie Break → vuelve exactamente a 6-6 en tiebreak', () => {
  let estado = llegarATiebreak();
  for (let i = 0; i < 6; i++) estado = applyMany(estado, ['pointA', 'pointB']);
  estado = applyAction(estado, 'pointA');      // 7-6
  const antes = estado;
  estado = applyAction(estado, 'pointA');      // 8-6 → set
  estado = applyAction(estado, 'undo');

  assert.strictEqual(estado.phase, 'tiebreak');
  assert.strictEqual(estado.players.A.games, 6);
  assert.strictEqual(estado.players.A.points, 7);
  assert.strictEqual(estado.server, antes.server);
  assert.strictEqual(estado.setScores.length, 0);
});

// ═════════════════════════════════════════════════════════════════
// REGLAMENTO FIP: el Super Tie Break sustituye al set decisivo
// ═════════════════════════════════════════════════════════════════
console.log('\nREGLAMENTO FIP: Super Tie Break en lugar del set decisivo');

test('Best-of-3: con 1-0 en sets NO hay Super Tie Break (el set 2 es normal)', () => {
  let estado = createMatch(config({ scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak' }));
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  assert.strictEqual(estado.phase, 'normal', 'El set 2 debe jugarse con games normales');
});

test('Best-of-3: 6-6 en el set 2 → Tie Break normal (a 7), no súper', () => {
  let estado = createMatch(config({ scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak' }));
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  for (let i = 0; i < 6; i++) {
    estado = ganarGame(estado, 'A');
    estado = ganarGame(estado, 'B');
  }
  assert.strictEqual(estado.phase, 'tiebreak');
});

test('Super Tie Break decisivo 10-8 → se registra como {1-0, tiebreak 10-8, superTiebreak}', () => {
  let estado = createMatch(config({ scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak' }));
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'B');
  for (let i = 0; i < 8; i++) estado = applyMany(estado, ['pointA', 'pointB']); // 8-8
  estado = applyMany(estado, ['pointB', 'pointB']);                              // 8-10

  assert.deepStrictEqual(estado.setScores[2], { A: 0, B: 1, tiebreak: { A: 8, B: 10 }, superTiebreak: true });
  assert.strictEqual(estado.winner, 'B');
  assert.strictEqual(estado.players.B.sets, 2);
});

test('Best-of-5: el Super Tie Break solo llega con 2-2 en sets', () => {
  let estado = createMatch(config({ scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak', totalSets: 5 }));
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'B');
  assert.strictEqual(estado.phase, 'normal', 'Con 1-1 en best-of-5 sigue un set normal');
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'B');
  assert.strictEqual(estado.phase, 'superTiebreak', 'Con 2-2 empieza el Super Tie Break');
});

test('Undo del primer punto del Super Tie Break no rompe la fase', () => {
  let estado = createMatch(config({ scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak' }));
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'B');
  estado = applyMany(estado, ['pointA', 'undo']);
  assert.strictEqual(estado.phase, 'superTiebreak');
  assert.strictEqual(estado.players.A.points, 0);
  // Un undo más vuelve al último punto del set 2 (fase normal, B a 40)
  estado = applyAction(estado, 'undo');
  assert.strictEqual(estado.phase, 'normal');
  assert.strictEqual(estado.players.B.sets, 0);
});

// ═════════════════════════════════════════════════════════════════
// REGLAMENTO FIP 2026: PUNTO ESTRELLA
// 1er y 2º 40-40 → se juega ventaja | 3er 40-40 → punto decisivo
// ═════════════════════════════════════════════════════════════════
console.log('\nREGLAMENTO FIP 2026: Punto Estrella');

/** Partido con Punto Estrella en el primer 40-40 del primer game */
function primerIguales() {
  const estado = createMatch(config({ scoringSystem: 'starPoint' }));
  return applyMany(estado, ['pointA', 'pointA', 'pointA', 'pointB', 'pointB', 'pointB']);
}

test('Primer 40-40 → deuceCount = 1 y A gana punto → Ventaja A (no decisivo)', () => {
  let estado = primerIguales();
  assert.strictEqual(estado.deuceCount, 1);
  estado = applyAction(estado, 'pointA');
  assert.strictEqual(estado.players.A.points, 'AD');
  assert.strictEqual(estado.players.A.games, 0);
});

test('Segundo 40-40 → todavía se juega ventaja', () => {
  let estado = applyMany(primerIguales(), ['pointA', 'pointB']); // AD A → 2º 40-40
  assert.strictEqual(estado.deuceCount, 2);
  estado = applyAction(estado, 'pointB');
  assert.strictEqual(estado.players.B.points, 'AD', 'En el 2º iguales sigue habiendo ventaja');
});

test('Tercer 40-40 → el siguiente punto (Punto Estrella) gana el game', () => {
  let estado = applyMany(primerIguales(), ['pointA', 'pointB', 'pointB', 'pointA']); // 3er 40-40
  assert.strictEqual(estado.deuceCount, 3);
  assert.strictEqual(estado.players.A.points, 40);
  assert.strictEqual(estado.players.B.points, 40);
  estado = applyAction(estado, 'pointB');
  assert.strictEqual(estado.players.B.games, 1, 'B gana el game con el Punto Estrella');
  assert.strictEqual(estado.players.B.points, 0);
});

test('El game más largo posible con Punto Estrella dura 11 puntos', () => {
  let estado = applyMany(primerIguales(), ['pointA', 'pointB', 'pointA', 'pointB']); // 10 puntos
  assert.strictEqual(estado.players.A.games + estado.players.B.games, 0, '10 puntos: aún sin game');
  estado = applyAction(estado, 'pointA'); // punto 11
  assert.strictEqual(estado.players.A.games, 1);
});

test('Ganar con ventaja antes del 3er iguales funciona normal', () => {
  const estado = applyMany(primerIguales(), ['pointA', 'pointA']); // AD A → game A
  assert.strictEqual(estado.players.A.games, 1);
});

test('El contador de iguales se reinicia en cada game nuevo', () => {
  let estado = applyMany(primerIguales(), ['pointA', 'pointB', 'pointB', 'pointA', 'pointB']); // game B
  assert.strictEqual(estado.deuceCount, 0, 'Tras el game el contador vuelve a 0');
  estado = applyMany(estado, ['pointA', 'pointA', 'pointA', 'pointB', 'pointB', 'pointB', 'pointA']);
  assert.strictEqual(estado.players.A.points, 'AD', 'En el nuevo game el 1er iguales vuelve a tener ventaja');
});

test('Undo desde el 3er 40-40 restaura el contador de iguales', () => {
  let estado = applyMany(primerIguales(), ['pointA', 'pointB', 'pointB', 'pointA']); // 3er iguales
  estado = applyAction(estado, 'undo');
  assert.strictEqual(estado.deuceCount, 2);
  assert.strictEqual(estado.players.B.points, 'AD');
});

test('decisivePoint: solo es true en el 3er 40-40 (estrella) o en cualquier 40-40 (oro)', () => {
  let estrella = primerIguales();
  assert.strictEqual(estrella.decisivePoint, false, '1er iguales con estrella: no decisivo');
  estrella = applyMany(estrella, ['pointA', 'pointB', 'pointB', 'pointA']);
  assert.strictEqual(estrella.decisivePoint, true, '3er iguales con estrella: decisivo');
  estrella = applyAction(estrella, 'pointA');
  assert.strictEqual(estrella.decisivePoint, false, 'Game nuevo: ya no es decisivo');

  const oro = applyMany(createMatch(config({ scoringSystem: 'goldenPoint' })),
    ['pointA', 'pointA', 'pointA', 'pointB', 'pointB', 'pointB']);
  assert.strictEqual(oro.decisivePoint, true, '40-40 con punto de oro: decisivo');
});

test('Con sistema Ventaja el 3er 40-40 NO es decisivo', () => {
  let estado = createMatch(config({ scoringSystem: 'advantage' }));
  estado = applyMany(estado, ['pointA', 'pointA', 'pointA', 'pointB', 'pointB', 'pointB',
                              'pointA', 'pointB', 'pointB', 'pointA', 'pointB']);
  assert.strictEqual(estado.players.B.points, 'AD');
});

// ═════════════════════════════════════════════════════════════════
// SINCRONÍA: engine.js y engine-browser.js deben comportarse igual
// ═════════════════════════════════════════════════════════════════
console.log('\nSINCRONÍA: motor del servidor vs motor del navegador');

test('Ambos motores producen el mismo estado en 4000 acciones aleatorias', () => {
  const fs   = require('fs');
  const path = require('path');
  const vm   = require('vm');

  // Cargamos engine-browser.js en un "navegador" falso que solo tiene window
  const codigo  = fs.readFileSync(path.join(__dirname, '../../../public/js/engine-browser.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(codigo, sandbox);
  const browser = sandbox.window.PadelEngine;

  // Generador pseudoaleatorio con semilla fija → la prueba es reproducible
  let semilla = 12345;
  const aleatorio = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
  const acciones  = ['pointA', 'pointA', 'pointB', 'pointB', 'undo', 'changeServer'];

  const configs = [
    config(),
    config({ scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak' }),
    config({ gamesPerSet: 2, totalSets: 5, tiebreakType: 'none' }),
    config({ scoringSystem: 'starPoint', tiebreakType: 'superTiebreak', totalSets: 5 }),
  ];

  configs.forEach((cfg) => {
    let sNode    = createMatch(cfg);
    let sBrowser = browser.createMatch(cfg);
    for (let i = 0; i < 1000; i++) {
      const accion = acciones[Math.floor(aleatorio() * acciones.length)];
      sNode    = applyAction(sNode, accion);
      sBrowser = browser.applyAction(sBrowser, accion);
      // JSON para comparar ignorando el "mundo" (vm) en el que se creó cada objeto
      assert.strictEqual(JSON.stringify(sBrowser), JSON.stringify(sNode),
        `Divergencia en la acción #${i} (${accion})`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// RESUMEN FINAL
// ─────────────────────────────────────────────────────────────────
resumen();
