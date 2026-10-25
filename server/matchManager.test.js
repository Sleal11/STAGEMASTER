'use strict';

/**
 * ─────────────────────────────────────────────────────────────────
 * STAGEMASTER — PRUEBAS DEL GESTOR DE PARTIDO Y DE LA CONFIGURACIÓN
 * Archivo: server/matchManager.test.js
 *
 * Ejecutar con: node server/matchManager.test.js
 *
 * Cubre lo que añade el servidor por encima del motor:
 *   - Validación de la configuración (sports/padel/config.js)
 *   - Estado público sin historial, con version y canUndo
 *   - Rechazo de acciones con versión desactualizada (doble toque / 2 dispositivos)
 *   - Protección contra reemplazar un partido en curso
 * ─────────────────────────────────────────────────────────────────
 */

const assert = require('assert');

// ─────────────────────────────────────────────────────────────────
// MINI FRAMEWORK DE PRUEBAS (mismo formato que engine.test.js)
// ─────────────────────────────────────────────────────────────────

let pasadas  = 0;
let fallidas = 0;

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

function resumen() {
  const total = pasadas + fallidas;
  console.log('\n' + '─'.repeat(50));
  console.log(`TOTAL: ${total}  |  ✅ Pasadas: ${pasadas}  |  ❌ Fallidas: ${fallidas}`);
  console.log('─'.repeat(50));
  if (fallidas > 0) process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Devuelve un matchManager NUEVO (sin partido) en cada llamada.
 * matchManager guarda el estado en una variable del módulo, así que
 * borramos la caché de require para empezar cada prueba desde cero.
 */
function freshManager() {
  delete require.cache[require.resolve('./matchManager')];
  return require('./matchManager');
}

function validConfig(overrides = {}) {
  return {
    nameA:         'Galán / Lebrón',
    nameB:         'Coello / Tapia',
    gamesPerSet:   6,
    totalSets:     3,
    scoringSystem: 'starPoint',
    tiebreakType:  'superTiebreak',
    initialServer: 'A',
    ...overrides,
  };
}

/** Comprueba que fn lance un error con el código indicado */
function assertCode(fn, code) {
  assert.throws(fn, (err) => err.code === code, `Debía lanzar ${code}`);
}

// Silenciar los console.log del gestor para que la salida sea legible
const originalLog = console.log;
function quiet(fn) {
  console.log = () => {};
  try { return fn(); } finally { console.log = originalLog; }
}

console.log('\n🖥   STAGEMASTER — GESTOR DE PARTIDO — PRUEBAS\n');

// ═════════════════════════════════════════════════════════════════
console.log('VALIDACIÓN DE CONFIGURACIÓN');
// ═════════════════════════════════════════════════════════════════

test('Configuración válida → crea el partido y normaliza los nombres', () => {
  const mm    = freshManager();
  const state = quiet(() => mm.setup(validConfig({ nameA: '  Galán   /  Lebrón ' })));
  assert.strictEqual(state.players.A.name, 'Galán / Lebrón');
  assert.strictEqual(state.config.scoringSystem, 'starPoint');
});

test('Los números pueden llegar como texto ("6") y se convierten', () => {
  const mm    = freshManager();
  const state = quiet(() => mm.setup(validConfig({ gamesPerSet: '4', totalSets: '5' })));
  assert.strictEqual(state.config.gamesPerSet, 4);
  assert.strictEqual(state.config.totalSets, 5);
});

[
  ['sin configuración',              null],
  ['nombre A vacío',                 validConfig({ nameA: '   ' })],
  ['nombre B demasiado largo',       validConfig({ nameB: 'x'.repeat(31) })],
  ['0 games por set',                validConfig({ gamesPerSet: 0 })],
  ['7 games por set',                validConfig({ gamesPerSet: 7 })],
  ['2 sets (número par)',            validConfig({ totalSets: 2 })],
  ['1.5 sets',                       validConfig({ totalSets: 1.5 })],
  ['sistema de puntuación inválido', validConfig({ scoringSystem: 'xyz' })],
  ['desempate inválido',             validConfig({ tiebreakType: 'penaltis' })],
  ['saque inicial inválido',         validConfig({ initialServer: 'C' })],
].forEach(([caso, cfg]) => {
  test(`Configuración rechazada: ${caso}`, () => {
    const mm = freshManager();
    assertCode(() => mm.setup(cfg), 'INVALID_CONFIG');
    assert.strictEqual(mm.getState(), null, 'No debe crearse ningún partido');
  });
});

// ═════════════════════════════════════════════════════════════════
console.log('\nESTADO PÚBLICO');
// ═════════════════════════════════════════════════════════════════

test('Sin partido → getState() devuelve null', () => {
  assert.strictEqual(freshManager().getState(), null);
});

test('El estado público NO incluye el historial de undo', () => {
  const mm = freshManager();
  quiet(() => mm.setup(validConfig()));
  const state = mm.action('pointA', 1);
  assert.strictEqual(state.history, undefined);
});

test('version empieza en 1 y sube con cada acción que cambia el partido', () => {
  const mm = freshManager();
  assert.strictEqual(quiet(() => mm.setup(validConfig())).version, 1);
  assert.strictEqual(mm.action('pointA', 1).version, 2);
  assert.strictEqual(mm.action('pointB', 2).version, 3);
});

test('canUndo es false al inicio y true tras un punto', () => {
  const mm = freshManager();
  assert.strictEqual(quiet(() => mm.setup(validConfig())).canUndo, false);
  assert.strictEqual(mm.action('pointA', 1).canUndo, true);
});

test('Undo sin historial no cambia la versión', () => {
  const mm = freshManager();
  quiet(() => mm.setup(validConfig()));
  assert.strictEqual(mm.action('undo', 1).version, 1);
});

// ═════════════════════════════════════════════════════════════════
console.log('\nPROTECCIÓN: DOBLE PULSACIÓN Y VARIOS DISPOSITIVOS');
// ═════════════════════════════════════════════════════════════════

test('Doble toque: el 2º punto con la misma versión se rechaza', () => {
  const mm = freshManager();
  quiet(() => mm.setup(validConfig()));
  mm.action('pointA', 1);                                // 1er toque → 15-0
  assertCode(() => mm.action('pointA', 1), 'STALE_VERSION'); // 2º toque duplicado
  assert.strictEqual(mm.getState().players.A.points, 15, 'Solo debe contar un punto');
});

test('Dos dispositivos: el que tiene un marcador viejo no puede actuar', () => {
  const mm = freshManager();
  quiet(() => mm.setup(validConfig()));
  mm.action('pointB', 1);                                // iPhone 1 suma a B
  assertCode(() => mm.action('undo', 1), 'STALE_VERSION');   // iPhone 2 (desactualizado)
  assert.strictEqual(mm.getState().players.B.points, 15);
});

test('Reset con versión desactualizada se rechaza', () => {
  const mm = freshManager();
  quiet(() => mm.setup(validConfig()));
  mm.action('pointA', 1);
  assertCode(() => quiet(() => mm.reset(1)), 'STALE_VERSION');
});

test('Acción o reset sin partido → NO_MATCH', () => {
  const mm = freshManager();
  assertCode(() => mm.action('pointA', 0), 'NO_MATCH');
  assertCode(() => mm.reset(0), 'NO_MATCH');
});

test('Iniciar partido con otro en curso → MATCH_IN_PROGRESS (no se pisa)', () => {
  const mm = freshManager();
  quiet(() => mm.setup(validConfig()));
  mm.action('pointA', 1);
  assertCode(() => mm.setup(validConfig({ nameA: 'Otro' })), 'MATCH_IN_PROGRESS');
  assert.strictEqual(mm.getState().players.A.points, 15, 'El partido original sigue intacto');
});

test('Con force: true el operador puede reemplazar el partido en curso', () => {
  const mm    = freshManager();
  quiet(() => mm.setup(validConfig()));
  const state = quiet(() => mm.setup(validConfig({ nameA: 'Otro' }), { force: true }));
  assert.strictEqual(state.players.A.name, 'Otro');
});

test('Un partido finalizado se puede reemplazar sin force', () => {
  const mm = freshManager();
  quiet(() => mm.setup(validConfig()));
  mm.action('finishMatch', 1);
  const state = quiet(() => mm.setup(validConfig({ nameA: 'Nuevo' })));
  assert.strictEqual(state.players.A.name, 'Nuevo');
});

test('Reset conserva nombres y configuración y vuelve a 0', () => {
  const mm = freshManager();
  quiet(() => mm.setup(validConfig()));
  mm.action('pointA', 1);
  const state = quiet(() => mm.reset(2));
  assert.strictEqual(state.players.A.points, 0);
  assert.strictEqual(state.players.A.name, 'Galán / Lebrón');
  assert.strictEqual(state.config.tiebreakType, 'superTiebreak');
  assert.strictEqual(state.canUndo, false);
});

resumen();
