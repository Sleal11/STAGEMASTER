'use strict';

/**
 * ─────────────────────────────────────────────────────────────────
 * STAGEMASTER — PRUEBAS DE ASIGNACIÓN DE MONITORES
 * Archivo: desktop/monitors.test.js
 *
 * Ejecutar con: node desktop/monitors.test.js
 *
 * Simula portátiles con 0, 1 y 2 monitores externos, conexiones y
 * desconexiones en caliente, y las elecciones del operador.
 * ─────────────────────────────────────────────────────────────────
 */

const assert = require('assert');
const {
  describeMonitors, resolveAssignments, stickAutoAssignments, choosePreference,
} = require('./monitors');

let pasadas = 0;
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

const SCREENS = ['pantalla-1', 'pantalla-2'];

/** Monitores simulados: portátil (id 1) + externos a su derecha */
const LAPTOP = { id: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 }, scaleFactor: 1.25 };
const LED_A  = { id: 2, bounds: { x: 1536, y: 0, width: 1280, height: 720 }, scaleFactor: 1 };
const LED_B  = { id: 3, bounds: { x: 2816, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };

const monitors = (...displays) => describeMonitors(displays, 1);

console.log('\n🖥   STAGEMASTER — ASIGNACIÓN DE MONITORES — PRUEBAS\n');

test('Describe los monitores: portátil primero, resolución real con el escalado de Windows', () => {
  const list = monitors(LED_B, LAPTOP, LED_A);
  assert.deepStrictEqual(list.map((m) => m.label), ['Pantalla del portátil', 'Monitor 2', 'Monitor 3']);
  assert.deepStrictEqual([list[0].width, list[0].height], [1920, 1080], '1536×864 al 125 % = 1920×1080');
  assert.strictEqual(list[1].key, '2');
});

test('Sin monitores externos: ninguna pantalla se abre sobre la estación', () => {
  const result = resolveAssignments(SCREENS, monitors(LAPTOP), {});
  assert.deepStrictEqual(result, { 'pantalla-1': null, 'pantalla-2': null });
});

test('Un monitor externo: la Pantalla 1 va en él, la 2 queda sin monitor', () => {
  const result = resolveAssignments(SCREENS, monitors(LAPTOP, LED_A), {});
  assert.deepStrictEqual(result, { 'pantalla-1': '2', 'pantalla-2': null });
});

test('Dos monitores externos: cada pantalla en uno, de izquierda a derecha', () => {
  const result = resolveAssignments(SCREENS, monitors(LAPTOP, LED_A, LED_B), {});
  assert.deepStrictEqual(result, { 'pantalla-1': '2', 'pantalla-2': '3' });
});

test('Conectar el 2º monitor NO mueve la Pantalla 1 (aunque quede a su izquierda)', () => {
  let prefs = {};
  const before = resolveAssignments(SCREENS, monitors(LAPTOP, LED_B), prefs);
  prefs = stickAutoAssignments(prefs, before);
  assert.strictEqual(before['pantalla-1'], '3');

  // Se conecta LED_A, que queda a la IZQUIERDA del que ya se usaba
  const after = resolveAssignments(SCREENS, monitors(LAPTOP, LED_A, LED_B), prefs);
  assert.strictEqual(after['pantalla-1'], '3', 'La Pantalla 1 sigue en su monitor');
  assert.strictEqual(after['pantalla-2'], '2', 'La Pantalla 2 ocupa el monitor nuevo');
});

test('Desconectar el monitor de la Pantalla 2 no afecta a la Pantalla 1', () => {
  let prefs = stickAutoAssignments({}, resolveAssignments(SCREENS, monitors(LAPTOP, LED_A, LED_B), {}));
  const after = resolveAssignments(SCREENS, monitors(LAPTOP, LED_A), prefs);
  assert.deepStrictEqual(after, { 'pantalla-1': '2', 'pantalla-2': null });
});

test('Al volver a conectar el monitor, la pantalla vuelve a él', () => {
  const prefs = stickAutoAssignments({}, resolveAssignments(SCREENS, monitors(LAPTOP, LED_A, LED_B), {}));
  resolveAssignments(SCREENS, monitors(LAPTOP, LED_A), prefs);           // se desconecta
  const back = resolveAssignments(SCREENS, monitors(LAPTOP, LED_A, LED_B), prefs);
  assert.deepStrictEqual(back, { 'pantalla-1': '2', 'pantalla-2': '3' });
});

test('Si el monitor preferido falta y hay otro libre, se usa ese (sin perder la preferencia)', () => {
  const prefs = { 'pantalla-1': '3', 'pantalla-2': 'none' };
  const result = resolveAssignments(SCREENS, monitors(LAPTOP, LED_A), prefs);
  assert.strictEqual(result['pantalla-1'], '2');
  assert.strictEqual(prefs['pantalla-1'], '3');
});

test('Elegir el monitor de la otra pantalla las INTERCAMBIA (nunca comparten)', () => {
  const list  = monitors(LAPTOP, LED_A, LED_B);
  const prefs = stickAutoAssignments({}, resolveAssignments(SCREENS, list, {}));
  const next  = choosePreference(SCREENS, list, prefs, 'pantalla-1', '3');
  assert.deepStrictEqual(resolveAssignments(SCREENS, list, next), { 'pantalla-1': '3', 'pantalla-2': '2' });
});

test('Modo "ventana" (para probar sin monitores) y "ninguno"', () => {
  const list = monitors(LAPTOP);
  let prefs = choosePreference(SCREENS, list, {}, 'pantalla-1', 'window');
  prefs = choosePreference(SCREENS, list, prefs, 'pantalla-2', 'none');
  assert.deepStrictEqual(resolveAssignments(SCREENS, list, prefs), { 'pantalla-1': 'window', 'pantalla-2': null });
});

test('El portátil solo se usa si se elige expresamente', () => {
  const list = monitors(LAPTOP);
  const prefs = choosePreference(SCREENS, list, {}, 'pantalla-1', '1');
  assert.strictEqual(resolveAssignments(SCREENS, list, prefs)['pantalla-1'], '1');
});

test('Elegir un monitor inexistente → INVALID_MONITOR', () => {
  assert.throws(() => choosePreference(SCREENS, monitors(LAPTOP), {}, 'pantalla-1', '99'),
    (err) => err.code === 'INVALID_MONITOR');
});

console.log('\n' + '─'.repeat(50));
console.log(`TOTAL: ${pasadas + fallidas}  |  ✅ Pasadas: ${pasadas}  |  ❌ Fallidas: ${fallidas}`);
console.log('─'.repeat(50));
if (fallidas > 0) process.exit(1);
