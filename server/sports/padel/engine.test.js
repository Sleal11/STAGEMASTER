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

test('Super Tie Break en último set: 10-9 → partido NO debe terminar', () => {
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

  // En el último set: llevar a 6-6 → debe entrar en Super Tie Break
  for (let i = 0; i < 6; i++) {
    estado = ganarGame(estado, 'A');
    estado = ganarGame(estado, 'B');
  }
  assert.strictEqual(estado.phase, 'superTiebreak', 'Debe estar en superTiebreak');

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

  // Preparar mismo escenario del caso 8
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'A');
  for (let i = 0; i < 6; i++) estado = ganarGame(estado, 'B');
  for (let i = 0; i < 6; i++) {
    estado = ganarGame(estado, 'A');
    estado = ganarGame(estado, 'B');
  }

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

// ─────────────────────────────────────────────────────────────────
// RESUMEN FINAL
// ─────────────────────────────────────────────────────────────────
resumen();
