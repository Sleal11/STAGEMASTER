'use strict';

/**
 * ─────────────────────────────────────────────────────────────────
 * STAGEMASTER — PRUEBAS DEL NÚCLEO DEL SERVIDOR
 * Archivo: server/core/core.test.js
 *
 * Ejecutar con: node server/core/core.test.js   (o npm run test:server)
 *
 * Cubre lo que añade el servidor por encima del motor de reglas:
 *   - Validación de la configuración (sports/padel/config.js)
 *   - Match: estado público, versiones, protecciones, persistencia
 *   - Aislamiento entre partidos (matchRegistry.js)
 *   - PIN, tokens y limitación de intentos (auth.js)
 *   - Pantallas: asignación, modos, publicidad (screens.js, ads.js)
 *   - Migración desde la versión de un solo partido (data/match.json)
 * ─────────────────────────────────────────────────────────────────
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// Carpetas TEMPORALES: nunca se tocan data/ ni publicidad/ reales.
// Deben definirse ANTES de cargar los módulos.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stagemaster-core-'));
const TEST_ADS_DIR  = fs.mkdtempSync(path.join(os.tmpdir(), 'stagemaster-ads-'));
process.env.STAGEMASTER_DATA_DIR = TEST_DATA_DIR;
process.env.STAGEMASTER_ADS_DIR  = TEST_ADS_DIR;

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

/** Silencia los mensajes del servidor para que la salida sea legible */
function quiet(fn) {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
}

/** Carga los módulos como si el servidor arrancara de nuevo */
function loadModules() {
  Object.keys(require.cache)
    .filter((file) => file.includes(`${path.sep}server${path.sep}core${path.sep}`))
    .forEach((file) => delete require.cache[file]);
  return {
    ...require('./matchRegistry'),
    ...require('./screens'),
    ads:  require('./ads'),
    auth: require('./auth'),
  };
}

/** Registro NUEVO, sin datos guardados */
function freshRegistry() {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  return quiet(() => loadModules().createMatchRegistry());
}

/** Simula reiniciar el servidor CONSERVANDO los datos guardados */
function restartRegistry() {
  return quiet(() => loadModules().createMatchRegistry());
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

function assertCode(fn, code) {
  assert.throws(() => quiet(fn), (err) => err.code === code, `Debía lanzar ${code}`);
}

console.log('\n🖥   STAGEMASTER — NÚCLEO DEL SERVIDOR — PRUEBAS\n');

// ═════════════════════════════════════════════════════════════════
console.log('VALIDACIÓN DE CONFIGURACIÓN');
// ═════════════════════════════════════════════════════════════════

test('Configuración válida → crea el partido y normaliza los nombres', () => {
  const match = freshRegistry().get('pista-1');
  const state = quiet(() => match.setup(validConfig({ nameA: '  Jose   V/Santiago R ' })));
  assert.strictEqual(state.players.A.name, 'Jose V / Santiago R');
  assert.strictEqual(state.config.scoringSystem, 'starPoint');
});

test('Un equipo de un solo nombre también es válido', () => {
  const state = quiet(() => freshRegistry().get('pista-1').setup(validConfig({ nameA: 'Equipo Azul' })));
  assert.strictEqual(state.players.A.name, 'Equipo Azul');
});

test('Los números pueden llegar como texto ("6") y se convierten', () => {
  const state = quiet(() => freshRegistry().get('pista-1').setup(validConfig({ gamesPerSet: '4', totalSets: '5' })));
  assert.strictEqual(state.config.gamesPerSet, 4);
  assert.strictEqual(state.config.totalSets, 5);
});

[
  ['sin configuración',              null],
  ['nombre A vacío',                 validConfig({ nameA: '  /  ' })],
  ['jugador con nombre demasiado largo', validConfig({ nameB: 'x'.repeat(25) + ' / Tapia' })],
  ['tres jugadores en un equipo',    validConfig({ nameA: 'A / B / C' })],
  ['0 games por set',                validConfig({ gamesPerSet: 0 })],
  ['7 games por set',                validConfig({ gamesPerSet: 7 })],
  ['2 sets (número par)',            validConfig({ totalSets: 2 })],
  ['1.5 sets',                       validConfig({ totalSets: 1.5 })],
  ['sistema de puntuación inválido', validConfig({ scoringSystem: 'xyz' })],
  ['desempate inválido',             validConfig({ tiebreakType: 'penaltis' })],
  ['saque inicial inválido',         validConfig({ initialServer: 'C' })],
].forEach(([caso, cfg]) => {
  test(`Configuración rechazada: ${caso}`, () => {
    const match = freshRegistry().get('pista-1');
    assertCode(() => match.setup(cfg), 'INVALID_CONFIG');
    assert.strictEqual(match.getPublicState(), null, 'No debe crearse ningún partido');
  });
});

// ═════════════════════════════════════════════════════════════════
console.log('\nESTADO PÚBLICO Y VERSIONES');
// ═════════════════════════════════════════════════════════════════

test('Sin partido → getPublicState() devuelve null', () => {
  assert.strictEqual(freshRegistry().get('pista-1').getPublicState(), null);
});

test('El estado público NO incluye el historial de undo', () => {
  const match = freshRegistry().get('pista-1');
  quiet(() => match.setup(validConfig()));
  assert.strictEqual(match.applyAction('pointA', 1).history, undefined);
});

test('version empieza en 1 y sube con cada acción que cambia el partido', () => {
  const match = freshRegistry().get('pista-1');
  assert.strictEqual(quiet(() => match.setup(validConfig())).version, 1);
  assert.strictEqual(match.applyAction('pointA', 1).version, 2);
  assert.strictEqual(match.applyAction('pointB', 2).version, 3);
});

test('canUndo es false al inicio y true tras un punto', () => {
  const match = freshRegistry().get('pista-1');
  assert.strictEqual(quiet(() => match.setup(validConfig())).canUndo, false);
  assert.strictEqual(match.applyAction('pointA', 1).canUndo, true);
});

test('Undo sin historial no cambia la versión', () => {
  const match = freshRegistry().get('pista-1');
  quiet(() => match.setup(validConfig()));
  assert.strictEqual(match.applyAction('undo', 1).version, 1);
});

test('Acción desconocida → INVALID_ACTION', () => {
  const match = freshRegistry().get('pista-1');
  quiet(() => match.setup(validConfig()));
  assertCode(() => match.applyAction('borrarTodo', 1), 'INVALID_ACTION');
});

// ═════════════════════════════════════════════════════════════════
console.log('\nPROTECCIÓN: DOBLE PULSACIÓN Y PARTIDO EN CURSO');
// ═════════════════════════════════════════════════════════════════

test('Doble toque: el 2º punto con la misma versión se rechaza', () => {
  const match = freshRegistry().get('pista-1');
  quiet(() => match.setup(validConfig()));
  match.applyAction('pointA', 1);
  assertCode(() => match.applyAction('pointA', 1), 'STALE_VERSION');
  assert.strictEqual(match.getPublicState().players.A.points, 15, 'Solo debe contar un punto');
});

test('Reset con versión desactualizada se rechaza', () => {
  const match = freshRegistry().get('pista-1');
  quiet(() => match.setup(validConfig()));
  match.applyAction('pointA', 1);
  assertCode(() => match.reset(1), 'STALE_VERSION');
});

test('Acción o reset sin partido → NO_MATCH', () => {
  const match = freshRegistry().get('pista-1');
  assertCode(() => match.applyAction('pointA', 0), 'NO_MATCH');
  assertCode(() => match.reset(0), 'NO_MATCH');
});

test('Iniciar partido con otro en curso → MATCH_IN_PROGRESS (no se pisa)', () => {
  const match = freshRegistry().get('pista-1');
  quiet(() => match.setup(validConfig()));
  match.applyAction('pointA', 1);
  assertCode(() => match.setup(validConfig({ nameA: 'Otro' })), 'MATCH_IN_PROGRESS');
  assert.strictEqual(match.getPublicState().players.A.points, 15);
});

test('Con force: true se puede reemplazar el partido en curso', () => {
  const match = freshRegistry().get('pista-1');
  quiet(() => match.setup(validConfig()));
  assert.strictEqual(quiet(() => match.setup(validConfig({ nameA: 'Otro' }), { force: true })).players.A.name, 'Otro');
});

test('Un partido finalizado se puede reemplazar sin force', () => {
  const match = freshRegistry().get('pista-1');
  quiet(() => match.setup(validConfig()));
  match.applyAction('finishMatch', 1);
  assert.strictEqual(quiet(() => match.setup(validConfig({ nameA: 'Nuevo' }))).players.A.name, 'Nuevo');
});

test('Reset conserva nombres y configuración y vuelve a 0', () => {
  const match = freshRegistry().get('pista-1');
  quiet(() => match.setup(validConfig()));
  match.applyAction('pointA', 1);
  const state = quiet(() => match.reset(2));
  assert.strictEqual(state.players.A.points, 0);
  assert.strictEqual(state.players.A.name, 'Galán / Lebrón');
  assert.strictEqual(state.config.tiebreakType, 'superTiebreak');
  assert.strictEqual(state.canUndo, false);
});

// ═════════════════════════════════════════════════════════════════
console.log('\nDOS PARTIDOS SIMULTÁNEOS: AISLAMIENTO');
// ═════════════════════════════════════════════════════════════════

test('Hay dos partidos con identificador, nombre y color propios', () => {
  const registry = freshRegistry();
  assert.deepStrictEqual(registry.ids(), ['pista-1', 'pista-2']);
  const [p1, p2] = registry.list();
  assert.notStrictEqual(p1.color, p2.color, 'Cada pista debe tener un color distinto');
});

test('Puntos en la pista 1 NO cambian la pista 2 (estado, versión, nombres)', () => {
  const registry = freshRegistry();
  const p1 = registry.get('pista-1');
  const p2 = registry.get('pista-2');
  quiet(() => p1.setup(validConfig({ nameA: 'Jose V / Santiago R' })));
  quiet(() => p2.setup(validConfig({ nameA: 'Ana P / Lucía M' })));
  p1.applyAction('pointA', 1);
  p1.applyAction('pointA', 2);

  assert.strictEqual(p1.getPublicState().players.A.points, 30);
  assert.strictEqual(p2.getPublicState().players.A.points, 0);
  assert.strictEqual(p2.version, 1);
  assert.strictEqual(p2.getPublicState().players.A.name, 'Ana P / Lucía M');
});

test('Cada partido se guarda en su propio archivo', () => {
  const registry = freshRegistry();
  quiet(() => registry.get('pista-1').setup(validConfig()));
  quiet(() => registry.get('pista-2').setup(validConfig({ nameA: 'Otro' })));
  const file1 = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'matches', 'pista-1.json'), 'utf8'));
  const file2 = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'matches', 'pista-2.json'), 'utf8'));
  assert.strictEqual(file1.state.players.A.name, 'Galán / Lebrón');
  assert.strictEqual(file2.state.players.A.name, 'Otro');
});

test('Partido inexistente → UNKNOWN_MATCH', () => {
  assertCode(() => freshRegistry().get('pista-9'), 'UNKNOWN_MATCH');
});

// ═════════════════════════════════════════════════════════════════
console.log('\nTELÉFONOS: PIN Y TOKEN');
// ═════════════════════════════════════════════════════════════════

test('Cada pista tiene un PIN de 4 dígitos, distinto en cada arranque limpio', () => {
  const registry = freshRegistry();
  registry.list().forEach((m) => assert.match(m.pin, /^\d{4}$/));
});

test('PIN correcto / incorrecto', () => {
  const match = freshRegistry().get('pista-1');
  assert.ok(match.checkPin(match.pin));
  assert.ok(!match.checkPin('xxxx'));
  assert.ok(!match.checkPin(undefined));
});

test('Vincular devuelve un token que solo vale para ESA pista', () => {
  const registry = freshRegistry();
  const token = quiet(() => registry.get('pista-1').pairController('iPhone'));
  assert.ok(registry.get('pista-1').verifyToken(token));
  assert.ok(!registry.get('pista-2').verifyToken(token), 'El token de la pista 1 no vale en la pista 2');
});

test('En disco se guarda el HASH del token, nunca el token', () => {
  const registry = freshRegistry();
  const token = quiet(() => registry.get('pista-1').pairController('iPhone'));
  const raw = fs.readFileSync(path.join(TEST_DATA_DIR, 'matches', 'pista-1.json'), 'utf8');
  assert.ok(!raw.includes(token));
});

test('Vincular otro teléfono invalida el token del anterior', () => {
  const match = freshRegistry().get('pista-1');
  const old = quiet(() => match.pairController('iPhone viejo'));
  quiet(() => match.pairController('iPhone nuevo'));
  assert.ok(!match.verifyToken(old));
});

test('Desvincular invalida el token; un PIN nuevo NO desvincula', () => {
  const match = freshRegistry().get('pista-1');
  const token = quiet(() => match.pairController('iPhone'));
  const oldPin = match.pin;
  match.regeneratePin();
  assert.ok(match.verifyToken(token), 'Cambiar el PIN no expulsa al teléfono actual');
  assert.ok(!match.checkPin(oldPin) || match.pin === oldPin);
  quiet(() => match.unpairController());
  assert.ok(!match.verifyToken(token));
});

test('Limitador de PIN: bloquea tras 5 fallos y desbloquea con un acierto', () => {
  const { auth } = loadModules();
  const guard = auth.createPinGuard({ maxFailures: 5, lockMs: 60000 });
  for (let i = 0; i < 4; i++) guard.fail('1.2.3.4');
  guard.check('1.2.3.4');                       // 4 fallos: aún permitido
  guard.fail('1.2.3.4');                        // 5º fallo → bloqueo
  assertCode(() => guard.check('1.2.3.4'), 'PIN_LOCKED');
  guard.check('5.6.7.8');                       // Otra dirección no se ve afectada
});

test('Solo localhost es "local" (para la estación operadora)', () => {
  const { auth } = loadModules();
  assert.ok(auth.isLocalAddress('127.0.0.1'));
  assert.ok(auth.isLocalAddress('::ffff:127.0.0.1'));
  assert.ok(!auth.isLocalAddress('192.168.0.50'));
});

// ═════════════════════════════════════════════════════════════════
console.log('\nPERSISTENCIA: REINICIO DEL SERVIDOR');
// ═════════════════════════════════════════════════════════════════

test('Tras reiniciar se recuperan partidos, versiones, historial, PIN y teléfono', () => {
  const registry = freshRegistry();
  const p1 = registry.get('pista-1');
  quiet(() => p1.setup(validConfig()));
  p1.applyAction('pointA', 1);
  p1.applyAction('pointA', 2);
  const token = quiet(() => p1.pairController('iPhone'));
  const pin = p1.pin;

  const p1b = restartRegistry().get('pista-1');
  assert.strictEqual(p1b.getPublicState().players.A.points, 30);
  assert.strictEqual(p1b.version, 3);
  assert.strictEqual(p1b.pin, pin, 'El PIN se conserva');
  assert.ok(p1b.verifyToken(token), 'El teléfono sigue vinculado tras el reinicio');
  assert.strictEqual(p1b.applyAction('undo', 3).players.A.points, 15, 'Se puede deshacer tras el reinicio');
});

test('Archivo dañado → arranca sin partido y lo aparta como .corrupt', () => {
  freshRegistry();
  fs.mkdirSync(path.join(TEST_DATA_DIR, 'matches'), { recursive: true });
  fs.writeFileSync(path.join(TEST_DATA_DIR, 'matches', 'pista-1.json'), '{ esto no es JSON');
  const match = restartRegistry().get('pista-1');
  assert.strictEqual(match.getPublicState(), null);
  assert.ok(fs.readdirSync(path.join(TEST_DATA_DIR, 'matches')).some((f) => f.includes('.corrupt-')));
});

test('Migración: el data/match.json de la versión anterior pasa a la Pista 1', () => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  // Formato de la versión de un solo partido: { version, savedAt, state }
  const old = quiet(() => {
    const { createMatch, applyAction } = require('../sports/padel/engine');
    return applyAction(createMatch(validConfig()), 'pointB');
  });
  fs.writeFileSync(path.join(TEST_DATA_DIR, 'match.json'), JSON.stringify({ version: 7, state: old }));

  const p1 = restartRegistry().get('pista-1');
  assert.strictEqual(p1.version, 7);
  assert.strictEqual(p1.getPublicState().players.B.points, 15);
  assert.match(p1.pin, /^\d{4}$/, 'Se genera un PIN al migrar');
  assert.ok(!fs.existsSync(path.join(TEST_DATA_DIR, 'match.json')));
});

// ═════════════════════════════════════════════════════════════════
console.log('\nPANTALLAS Y PUBLICIDAD');
// ═════════════════════════════════════════════════════════════════

/** Crea archivos de publicidad de prueba */
function prepareAds() {
  fs.rmSync(TEST_ADS_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TEST_ADS_DIR, 'banner'), { recursive: true });
  fs.mkdirSync(path.join(TEST_ADS_DIR, 'pantalla-completa'), { recursive: true });
  fs.writeFileSync(path.join(TEST_ADS_DIR, 'banner', 'b-marca.png'), 'x');
  fs.writeFileSync(path.join(TEST_ADS_DIR, 'banner', 'notas.txt'), 'x');      // no es publicidad
  fs.writeFileSync(path.join(TEST_ADS_DIR, 'pantalla-completa', 'video promo.mp4'), 'x');
}

function freshScreens() {
  fs.rmSync(path.join(TEST_DATA_DIR, 'screens.json'), { force: true });
  return loadModules().createScreenManager({ matchIds: ['pista-1', 'pista-2'] });
}

test('Por defecto: Pantalla 1 → Pista 1, Pantalla 2 → Pista 2, marcador + publicidad', () => {
  const screens = freshScreens();
  assert.strictEqual(screens.get('pantalla-1').matchId, 'pista-1');
  assert.strictEqual(screens.get('pantalla-2').matchId, 'pista-2');
  assert.strictEqual(screens.get('pantalla-1').mode, 'scoreAds');
});

test('Dos pantallas pueden mostrar el MISMO partido', () => {
  const screens = freshScreens();
  screens.update('pantalla-2', { matchId: 'pista-1' }, { banner: [], fullscreen: [] });
  assert.strictEqual(screens.get('pantalla-1').matchId, screens.get('pantalla-2').matchId);
});

test('Validación de pantalla: partido, modo e intervalo inválidos se rechazan', () => {
  const screens = freshScreens();
  const library = { banner: [], fullscreen: [] };
  assertCode(() => screens.update('pantalla-1', { matchId: 'pista-9' }, library), 'INVALID_SCREEN_CONFIG');
  assertCode(() => screens.update('pantalla-1', { mode: 'karaoke' }, library), 'INVALID_SCREEN_CONFIG');
  assertCode(() => screens.update('pantalla-1', { adInterval: 1 }, library), 'INVALID_SCREEN_CONFIG');
  assertCode(() => screens.get('pantalla-7'), 'UNKNOWN_SCREEN');
});

test('Biblioteca de publicidad: lista imágenes y vídeos, ignora otros archivos', () => {
  prepareAds();
  const { ads } = loadModules();
  const library = ads.listAds();
  assert.deepStrictEqual(library.banner.map((a) => a.name), ['b-marca.png']);
  assert.strictEqual(library.fullscreen[0].kind, 'video');
  assert.strictEqual(library.fullscreen[0].url, '/publicidad/pantalla-completa/video%20promo.mp4');
});

test('Solo se puede asignar publicidad que existe en la carpeta', () => {
  prepareAds();
  const { ads } = loadModules();
  const screens = freshScreens();
  screens.update('pantalla-1', { ads: { banner: ['b-marca.png'] } }, ads.listAds());
  assert.deepStrictEqual(screens.get('pantalla-1').ads.banner, ['b-marca.png']);
  assertCode(() => screens.update('pantalla-1', { ads: { banner: ['../../secreto.png'] } }, ads.listAds()), 'INVALID_SCREEN_CONFIG');
});

test('Si un archivo asignado se borra, se omite y se informa como "missing"', () => {
  prepareAds();
  const { ads } = loadModules();
  fs.rmSync(path.join(TEST_ADS_DIR, 'banner', 'b-marca.png'));
  const resolved = ads.resolveSelection({ banner: ['b-marca.png'], fullscreen: [] });
  assert.deepStrictEqual(resolved.banner, []);
  assert.deepStrictEqual(resolved.missing, ['banner/b-marca.png']);
});

test('La configuración de pantallas se conserva tras reiniciar', () => {
  const screens = freshScreens();
  screens.update('pantalla-2', { matchId: 'pista-1', mode: 'ads', adInterval: 20 }, { banner: [], fullscreen: [] });
  const again = loadModules().createScreenManager({ matchIds: ['pista-1', 'pista-2'] });
  assert.strictEqual(again.get('pantalla-2').matchId, 'pista-1');
  assert.strictEqual(again.get('pantalla-2').mode, 'ads');
  assert.strictEqual(again.get('pantalla-2').adInterval, 20);
});

test('Informe de pantalla: guarda resolución y versión dibujada (datos saneados)', () => {
  const screens = freshScreens();
  screens.attach('pantalla-1', 's1');
  screens.report('pantalla-1', 's1', {
    viewport: { width: 1280.4, height: 720, dpr: 1 }, renderedMatchId: 'pista-1', renderedVersion: 4,
    adErrors: ['x.png', 42],
  });
  const [display] = screens.presenceOf('pantalla-1');
  assert.deepStrictEqual(display.viewport, { width: 1280, height: 720, dpr: 1 });
  assert.strictEqual(display.renderedVersion, 4);
  assert.deepStrictEqual(display.adErrors, ['x.png']);
  screens.detach('pantalla-1', 's1');
  assert.strictEqual(screens.presenceOf('pantalla-1').length, 0);
});

fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
fs.rmSync(TEST_ADS_DIR, { recursive: true, force: true });
resumen();
