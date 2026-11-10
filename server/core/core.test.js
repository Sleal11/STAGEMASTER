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
 *   - Pantallas: asignación, cinta, lista de reproducción, reproductor,
 *     publicidad al terminar, formato LED, migración (screens.js, screenConfig.js, ads.js)
 *   - Pausa del partido
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
    history: require('./history'),
    remotes: require('./remotes'),
    formats: require('./formats'),
    screenConfig: require('./screenConfig'),
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

test('Código de pista: nunca se repite entre pistas (también si dos guardados coincidían)', () => {
  let registry = freshRegistry();
  quiet(() => registry.get('pista-1').setup(validConfig()));
  quiet(() => registry.get('pista-2').setup(validConfig({ nameA: 'Otro' })));
  // Datos de una versión anterior con el MISMO código en las dos pistas
  const dir = path.join(TEST_DATA_DIR, 'matches');
  const f2 = JSON.parse(fs.readFileSync(path.join(dir, 'pista-2.json'), 'utf8'));
  f2.pin = registry.get('pista-1').pin;
  fs.writeFileSync(path.join(dir, 'pista-2.json'), JSON.stringify(f2));
  registry = restartRegistry();
  assert.notStrictEqual(registry.get('pista-1').pin, registry.get('pista-2').pin);
  assert.strictEqual(registry.get('pista-2').getPublicState().players.A.name, 'Otro', 'El partido se conserva');
  // Nuevo código: siempre distinto del de la otra pista; findByCode encuentra la pista
  for (let i = 0; i < 200; i++) quiet(() => registry.newPin('pista-1'));
  assert.notStrictEqual(registry.get('pista-1').pin, registry.get('pista-2').pin);
  assert.strictEqual(registry.findByCode(registry.get('pista-2').pin).id, 'pista-2');
  assert.strictEqual(registry.findByCode('abcd'), null);
  assert.strictEqual(registry.findByCode(undefined), null);
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
  fs.writeFileSync(path.join(TEST_ADS_DIR, 'banner', 'notas.txt'), 'x');        // no es publicidad
  fs.writeFileSync(path.join(TEST_ADS_DIR, 'banner', 'clip.mp4'), 'x');         // la cinta también admite vídeos
  fs.writeFileSync(path.join(TEST_ADS_DIR, 'banner', 'logo.svg'), '<svg/>');    // y logos SVG
  fs.writeFileSync(path.join(TEST_ADS_DIR, 'pantalla-completa', 'promo grande.png'), 'x');
  fs.writeFileSync(path.join(TEST_ADS_DIR, 'pantalla-completa', 'video.mp4'), 'x');
  fs.writeFileSync(path.join(TEST_ADS_DIR, 'pantalla-completa', 'clip.webm'), 'x');
  fs.writeFileSync(path.join(TEST_ADS_DIR, 'pantalla-completa', 'iphone.mov'), 'x');  // no compatible
}

const EMPTY_LIBRARY = { banner: [], fullscreen: [] };

/** Pantallas con un reloj controlable (para la publicidad de fin de partido) */
function freshScreens(clock = { t: 1000 }) {
  fs.rmSync(path.join(TEST_DATA_DIR, 'screens.json'), { force: true });
  return loadModules().createScreenManager({ matchIds: ['pista-1', 'pista-2'], now: () => clock.t });
}

test('Por defecto: Pantalla 1 → Pista 1, Pantalla 2 → Pista 2, marcador con cinta, monitor completo', () => {
  const screens = freshScreens();
  const p1 = screens.get('pantalla-1');
  assert.strictEqual(p1.matchId, 'pista-1');
  assert.strictEqual(screens.get('pantalla-2').matchId, 'pista-2');
  assert.strictEqual(p1.view, 'score');
  assert.strictEqual(p1.ribbon.enabled, true);
  assert.strictEqual(p1.endAds.enabled, false, 'La publicidad final empieza desactivada');
  assert.deepStrictEqual([p1.ribbon.motion, p1.ribbon.background, p1.ribbon.height, p1.ribbon.sizes], ['rotate', 'dark', 0, {}],
    'Cinta: uno cada vez, fondo oscuro, alto automático, tamaños automáticos');
  assert.deepStrictEqual(p1.output, { format: 'fill', x: 0, y: 0, brightness: 100, width: 832, height: 416, fit: 'auto' });
});

test('Dos pantallas pueden mostrar el MISMO partido', () => {
  const screens = freshScreens();
  screens.update('pantalla-2', { matchId: 'pista-1' }, EMPTY_LIBRARY);
  assert.strictEqual(screens.get('pantalla-1').matchId, screens.get('pantalla-2').matchId);
});

test('Pantallas dinámicas: añadir (hasta 8, primer número libre), quitar (queda al menos una) y se guardan', () => {
  const screens = freshScreens();
  const p3 = screens.add();
  assert.strictEqual(p3.id, 'pantalla-3');
  assert.strictEqual(p3.label, 'Pantalla 3');
  assert.strictEqual(p3.matchId, 'pista-1', 'Sin pista 3: muestra la primera');
  for (let i = 4; i <= 8; i++) screens.add();
  assertCode(() => screens.add(), 'SCREEN_LIMIT');
  screens.remove('pantalla-2');
  assert.strictEqual(screens.add().id, 'pantalla-2', 'Reutiliza el número libre');
  screens.remove('pantalla-5');
  assert.deepStrictEqual(screens.ids(), ['pantalla-1', 'pantalla-2', 'pantalla-3', 'pantalla-4', 'pantalla-6', 'pantalla-7', 'pantalla-8']);
  assertCode(() => screens.remove('pantalla-5'), 'UNKNOWN_SCREEN');
  const again = loadModules().createScreenManager({ matchIds: ['pista-1', 'pista-2'] });
  assert.deepStrictEqual(again.ids(), screens.ids(), 'Se conserva tras reiniciar');
  ['pantalla-2', 'pantalla-3', 'pantalla-4', 'pantalla-6', 'pantalla-7', 'pantalla-8'].forEach((id) => again.remove(id));
  assertCode(() => again.remove('pantalla-1'), 'INVALID_ACTION');
});

test('Espejo: muestra el contenido de su origen con su propia salida; sin cadenas; al quitar el origen sigue igual', () => {
  const clock = { t: 1000 };
  const screens = freshScreens(clock);
  screens.add();
  screens.update('pantalla-1', { view: 'media', ribbon: { enabled: false } }, EMPTY_LIBRARY);
  screens.update('pantalla-2', { mirrorOf: 'pantalla-1', output: { format: 'led-xl' } }, EMPTY_LIBRARY);
  const mirror = screens.effective('pantalla-2');
  assert.strictEqual(mirror.matchId, 'pista-1');
  assert.strictEqual(mirror.view, 'media');
  assert.strictEqual(mirror.ribbon.enabled, false);
  assert.strictEqual(mirror.output.format, 'led-xl', 'Salida propia');
  assert.strictEqual(screens.effective('pantalla-1').output.format, 'fill');
  assert.deepStrictEqual(screens.withMirrors(['pantalla-1']), ['pantalla-1', 'pantalla-2']);

  // Su contenido se cambia en el origen; el reproductor también es el del origen
  assertCode(() => screens.update('pantalla-2', { view: 'score' }, EMPTY_LIBRARY), 'INVALID_SCREEN_CONFIG');
  const playId = screens.get('pantalla-1').playId;
  screens.command('pantalla-2', 'play');
  assert.strictEqual(screens.get('pantalla-1').playId, playId + 1);
  assert.strictEqual(screens.effective('pantalla-2').playId, playId + 1, 'Origen y espejo, sincronizados');

  // Sin cadenas ni bucles
  assertCode(() => screens.update('pantalla-3', { mirrorOf: 'pantalla-2' }, EMPTY_LIBRARY), 'INVALID_SCREEN_CONFIG');
  assertCode(() => screens.update('pantalla-1', { mirrorOf: 'pantalla-3' }, EMPTY_LIBRARY), 'INVALID_SCREEN_CONFIG');
  assertCode(() => screens.update('pantalla-3', { mirrorOf: 'pantalla-3' }, EMPTY_LIBRARY), 'INVALID_SCREEN_CONFIG');
  assertCode(() => screens.update('pantalla-3', { mirrorOf: 'pantalla-9' }, EMPTY_LIBRARY), 'INVALID_SCREEN_CONFIG');
  // Un cambio inválido junto al espejo: no se guarda nada
  assertCode(() => screens.update('pantalla-3', { mirrorOf: 'pantalla-1', output: { brightness: 1 } }, EMPTY_LIBRARY), 'INVALID_SCREEN_CONFIG');
  assert.strictEqual(screens.get('pantalla-3').mirrorOf, null);

  // Publicidad automática: solo se activa en el origen (el espejo la ve por él)
  screens.update('pantalla-1', { view: 'score', endAds: { enabled: true } }, EMPTY_LIBRARY);
  assert.deepStrictEqual(screens.matchFinished('pista-1', '7'), ['pantalla-1']);
  assert.ok(screens.effective('pantalla-2').postMatch, 'El espejo también muestra la publicidad final');

  // Se conserva tras reiniciar
  const again = loadModules().createScreenManager({ matchIds: ['pista-1', 'pista-2'] });
  assert.strictEqual(again.get('pantalla-2').mirrorOf, 'pantalla-1');

  // Quitar el origen: el espejo pasa a independiente mostrando lo mismo
  const { released } = screens.remove('pantalla-1');
  assert.deepStrictEqual(released, ['pantalla-2']);
  const freed = screens.get('pantalla-2');
  assert.strictEqual(freed.mirrorOf, null);
  assert.strictEqual(freed.endAds.enabled, true);
  assert.strictEqual(freed.output.format, 'led-xl');

  // Volver a independiente conserva lo que mostraba
  screens.update('pantalla-3', { mirrorOf: 'pantalla-2' }, EMPTY_LIBRARY);
  screens.update('pantalla-3', { mirrorOf: null }, EMPTY_LIBRARY);
  assert.strictEqual(screens.get('pantalla-3').endAds.enabled, true);
});

test('Validación de pantalla: partido, vista, tiempos, formato y posición inválidos se rechazan', () => {
  const screens = freshScreens();
  [
    { matchId: 'pista-9' }, { view: 'karaoke' }, { ribbon: { interval: 1 } }, { ribbon: { motion: 'zigzag' } },
    { ribbon: { enabled: 'si' } }, { ribbon: { texts: Array(11).fill('x') } }, { media: { imageSeconds: 500 } },
    { ribbon: { background: 'rosa' } }, { ribbon: { height: 50 } }, { ribbon: { height: 10 } }, { ribbon: { sizes: [] } },
    { ribbon: { sizes: { 'x.png': 20 } } }, { ribbon: { sizes: { 'x.png': 300 } } }, { output: { brightness: 5 } }, { output: { brightness: 101 } }, { pauseAds: { enabled: 1 } },
    { media: { sound: 1 } }, { endAds: { delay: -1 } }, { output: { format: '4k' } }, { output: { y: 1.5 } },
    { output: { fit: 'zoom' } }, { output: { fit: true } }, { endStats: { enabled: 'no' } },
    { ribbon: { effects: [] } }, { ribbon: { effects: { 'x.png': 'neon' } } },
    { ribbon: 'todo' }, null,
  ].forEach((changes) => assertCode(() => screens.update('pantalla-1', changes, EMPTY_LIBRARY), 'INVALID_SCREEN_CONFIG'));
  assertCode(() => screens.get('pantalla-7'), 'UNKNOWN_SCREEN');
  assert.strictEqual(screens.get('pantalla-1').view, 'score', 'Nada cambió');
});

test('Biblioteca: cinta y lista = imágenes y vídeos MP4/WEBM (ignora .mov, .txt)', () => {
  prepareAds();
  const { ads } = loadModules();
  const library = ads.listAds();
  assert.deepStrictEqual(library.banner.map((a) => [a.name, a.kind]), [['b-marca.png', 'image'], ['clip.mp4', 'video'], ['logo.svg', 'image']]);
  assert.deepStrictEqual(library.fullscreen.map((a) => [a.name, a.kind]),
    [['clip.webm', 'video'], ['promo grande.png', 'image'], ['video.mp4', 'video']]);
  assert.strictEqual(library.fullscreen[1].url, '/publicidad/pantalla-completa/promo%20grande.png');
});

test('Solo se puede asignar publicidad que existe; la cinta en el orden elegido y la lista en orden alfabético', () => {
  prepareAds();
  const { ads } = loadModules();
  const screens = freshScreens();
  screens.update('pantalla-1', { ribbon: { items: ['clip.mp4', 'b-marca.png', 'clip.mp4'] }, media: { items: ['video.mp4', 'promo grande.png', 'video.mp4'] } }, ads.listAds());
  assert.deepStrictEqual(screens.get('pantalla-1').ribbon.items, ['clip.mp4', 'b-marca.png'], 'La cinta admite vídeos y conserva el orden (sin repetidos)');
  assert.deepStrictEqual(screens.get('pantalla-1').media.items, ['promo grande.png', 'video.mp4']);
  assertCode(() => screens.update('pantalla-1', { ribbon: { items: ['../../secreto.png'] } }, ads.listAds()), 'INVALID_SCREEN_CONFIG');
  assertCode(() => screens.update('pantalla-1', { media: { items: ['iphone.mov'] } }, ads.listAds()), 'INVALID_SCREEN_CONFIG');
});

test('Cinta: tamaño de cada logo, alto, fondo y logos fijos; solo se guardan los tamaños de los logos de la cinta', () => {
  prepareAds();
  const { ads } = loadModules();
  const screens = freshScreens();
  const lib = ads.listAds();
  screens.update('pantalla-1', { ribbon: { items: ['logo.svg', 'b-marca.png'], sizes: { 'logo.svg': 150, 'b-marca.png': 60 } } }, lib);
  assert.deepStrictEqual(screens.get('pantalla-1').ribbon.sizes, { 'logo.svg': 150, 'b-marca.png': 60 });
  screens.update('pantalla-1', { ribbon: { sizes: { 'b-marca.png': null } } }, lib);
  assert.deepStrictEqual(screens.get('pantalla-1').ribbon.sizes, { 'logo.svg': 150 }, 'null = vuelve al tamaño automático');
  screens.update('pantalla-1', { ribbon: { sizes: { 'logo.svg': 100 } } }, lib);
  assert.deepStrictEqual(screens.get('pantalla-1').ribbon.sizes, {}, '100 % es el automático: no se guarda');
  screens.update('pantalla-1', { ribbon: { sizes: { 'logo.svg': 130 } } }, lib);
  screens.update('pantalla-1', { ribbon: { items: ['b-marca.png'] } }, lib);
  assert.deepStrictEqual(screens.get('pantalla-1').ribbon.sizes, {}, 'Al quitar un logo de la cinta se olvida su tamaño');
  screens.update('pantalla-1', { ribbon: { motion: 'fixed', height: 24, background: 'light' } }, lib);
  const r = screens.get('pantalla-1').ribbon;
  assert.deepStrictEqual([r.motion, r.height, r.background], ['fixed', 24, 'light']);
  screens.update('pantalla-1', { ribbon: { height: 0 } }, lib);
  assert.strictEqual(screens.get('pantalla-1').ribbon.height, 0, '0 = alto automático');
  const { normalizeSaved } = require('./screenConfig');
  const base = { id: 'pantalla-1', label: 'Pantalla 1', matchId: 'pista-1', matchIds: ['pista-1', 'pista-2'] };
  const old = normalizeSaved({ ribbon: { cleanLogos: false, items: ['a.png'] } }, base).ribbon;
  assert.ok(!('cleanLogos' in old) && old.background === 'dark' && old.items[0] === 'a.png', 'Configuraciones de 2.8: la opción antigua desaparece');
  const broken = normalizeSaved({ ribbon: { sizes: { 'a.png': 999, 'b.png': 120 }, height: 99, background: 'x' } }, base).ribbon;
  assert.deepStrictEqual([broken.sizes, broken.height, broken.background], [{ 'b.png': 120 }, 0, 'dark'], 'Valores dañados → por defecto');
  // Realce de cada logo (2.10): 'auto' no se guarda; se olvida al quitar el logo
  screens.update('pantalla-1', { ribbon: { items: ['logo.svg', 'b-marca.png'], effects: { 'logo.svg': 'outline', 'b-marca.png': 'define' } } }, lib);
  assert.deepStrictEqual(screens.get('pantalla-1').ribbon.effects, { 'logo.svg': 'outline', 'b-marca.png': 'define' });
  screens.update('pantalla-1', { ribbon: { effects: { 'logo.svg': 'auto', 'b-marca.png': 'both' } } }, lib);
  assert.deepStrictEqual(screens.get('pantalla-1').ribbon.effects, { 'b-marca.png': 'both' }, 'Automático = sin guardar');
  screens.update('pantalla-1', { ribbon: { items: ['logo.svg'] } }, lib);
  assert.deepStrictEqual(screens.get('pantalla-1').ribbon.effects, {}, 'Al quitar un logo se olvida su realce');
  const fx = normalizeSaved({ ribbon: { effects: { 'a.png': 'both', 'b.png': 'neon', 'c.png': 'auto' } } }, base).ribbon;
  assert.deepStrictEqual(fx.effects, { 'a.png': 'both' }, 'Realces dañados → automático');
});

test('Nombres de archivo subidos: seguros, sin carpetas ni caracteres prohibidos; nunca pisan otro', () => {
  prepareAds();
  const { ads } = loadModules();
  const safe = (name, category = 'fullscreen') => ads.safeFileName(category, name);
  assert.strictEqual(safe('Promo Verano.PNG'), 'Promo Verano.PNG');
  assert.strictEqual(safe('../../windows/evil.png'), 'evil.png');
  assert.strictEqual(safe('C:\\Users\\x\\anuncio.mp4'), 'anuncio.mp4');
  assert.strictEqual(safe('a<b>:c?.webm'), 'abc.webm');
  assert.strictEqual(safe('.oculto.png'), 'oculto.png');
  assert.strictEqual(safe('x'.repeat(300) + '.mp4').length, 120);
  [null, '', 'virus.exe', 'video.mov', '.png', 'sin-extension'].forEach((n) => assert.strictEqual(safe(n), null, String(n)));
  assert.strictEqual(safe('logo.png', 'otra'), null, 'Categoría desconocida');
  assert.strictEqual(ads.uniqueFileName('fullscreen', 'promo grande.png'), 'promo grande (2).png');
  assert.strictEqual(ads.uniqueFileName('fullscreen', 'nuevo.png'), 'nuevo.png');
  assert.ok(ads.existingFile('banner', 'b-marca.png'));
  assert.strictEqual(ads.existingFile('banner', '../../core.test.js'), null);
});

test('Archivo borrado de la carpeta: se quita de la cinta y de la lista de todas las pantallas', () => {
  prepareAds();
  const { ads } = loadModules();
  const screens = freshScreens();
  screens.update('pantalla-1', { ribbon: { items: ['b-marca.png'] }, media: { items: ['video.mp4'] } }, ads.listAds());
  screens.update('pantalla-2', { media: { items: ['video.mp4', 'clip.webm'] } }, ads.listAds());
  assert.deepStrictEqual(screens.forgetAd('fullscreen', 'video.mp4').sort(), ['pantalla-1', 'pantalla-2']);
  assert.deepStrictEqual(screens.get('pantalla-2').media.items, ['clip.webm']);
  assert.deepStrictEqual(screens.get('pantalla-1').ribbon.items, ['b-marca.png'], 'La cinta no cambia');
  assert.deepStrictEqual(screens.forgetAd('banner', 'b-marca.png'), ['pantalla-1']);
});

test('Si un archivo asignado se borra, se omite y se informa como "missing"', () => {
  prepareAds();
  const { ads } = loadModules();
  fs.rmSync(path.join(TEST_ADS_DIR, 'pantalla-completa', 'video.mp4'));
  const resolved = ads.resolve('fullscreen', ['video.mp4', 'clip.webm']);
  assert.deepStrictEqual(resolved.items.map((i) => i.name), ['clip.webm']);
  assert.deepStrictEqual(resolved.missing, ['pantalla-completa/video.mp4']);
});

test('Mensajes de la cinta: se limpian espacios y se descartan los vacíos', () => {
  const screens = freshScreens();
  screens.update('pantalla-1', { ribbon: { texts: ['  Bar   Central ', '', '   ', 'Club Pádel'] } }, EMPTY_LIBRARY);
  assert.deepStrictEqual(screens.get('pantalla-1').ribbon.texts, ['Bar Central', 'Club Pádel']);
});

test('La configuración de pantallas se conserva tras reiniciar', () => {
  const screens = freshScreens();
  screens.update('pantalla-2', {
    matchId: 'pista-1', ribbon: { motion: 'scroll', speed: 'slow' }, output: { format: 'led-sm', x: 32, y: 0, fit: 'cover' },
    endAds: { enabled: true, delay: 20 },
  }, EMPTY_LIBRARY);
  const again = loadModules().createScreenManager({ matchIds: ['pista-1', 'pista-2'] }).get('pantalla-2');
  assert.strictEqual(again.matchId, 'pista-1');
  assert.strictEqual(again.ribbon.motion, 'scroll');
  assert.strictEqual(again.ribbon.speed, 'slow');
  assert.deepStrictEqual(again.output, { format: 'led-sm', x: 32, y: 0, brightness: 100, width: 416, height: 208, fit: 'cover' });
  assert.deepStrictEqual(again.endAds, { enabled: true, delay: 20 });
});

test('Migración desde la versión 2.0 (mode / ads / adInterval)', () => {
  fs.writeFileSync(path.join(TEST_DATA_DIR, 'screens.json'), JSON.stringify({ screens: [
    { id: 'pantalla-1', matchId: 'pista-2', mode: 'scoreAds', adInterval: 12, ads: { banner: ['b.png'], fullscreen: ['f.png'] } },
    { id: 'pantalla-2', matchId: 'pista-1', mode: 'ads', adInterval: 7, ads: { banner: [], fullscreen: ['x.png'] } },
  ] }));
  const screens = loadModules().createScreenManager({ matchIds: ['pista-1', 'pista-2'] });
  const [p1, p2] = [screens.get('pantalla-1'), screens.get('pantalla-2')];
  assert.strictEqual(p1.matchId, 'pista-2');
  assert.strictEqual(p1.view, 'score');
  assert.deepStrictEqual([p1.ribbon.enabled, p1.ribbon.items, p1.ribbon.interval], [true, ['b.png'], 12]);
  assert.deepStrictEqual(p1.media.items, ['f.png']);
  assert.strictEqual(p2.view, 'media', '"Solo publicidad" pasa a la lista de reproducción');
  assert.strictEqual(p2.media.imageSeconds, 7);
});

test('Migración desde la versión 2.1 (ribbon.images → ribbon.items)', () => {
  fs.writeFileSync(path.join(TEST_DATA_DIR, 'screens.json'), JSON.stringify({ screens: [
    { id: 'pantalla-1', matchId: 'pista-1', view: 'score', ribbon: { enabled: true, images: ['logo.png'], texts: ['Hola'] } },
  ] }));
  const p1 = loadModules().createScreenManager({ matchIds: ['pista-1', 'pista-2'] }).get('pantalla-1');
  assert.deepStrictEqual(p1.ribbon.items, ['logo.png']);
  assert.deepStrictEqual(p1.ribbon.texts, ['Hola']);
  assert.strictEqual('images' in p1.ribbon, false);
});

test('Reproductor: play reinicia la lista, pause/resume solo si se reproduce, stop vuelve al marcador', () => {
  const screens = freshScreens();
  assertCode(() => screens.command('pantalla-1', 'pause'), 'INVALID_ACTION');
  assertCode(() => screens.command('pantalla-1', 'rebobinar'), 'INVALID_ACTION');
  const playId = screens.get('pantalla-1').playId;
  screens.command('pantalla-1', 'play');
  assert.deepStrictEqual([screens.get('pantalla-1').view, screens.get('pantalla-1').playId], ['media', playId + 1]);
  screens.command('pantalla-1', 'pause');
  assert.strictEqual(screens.get('pantalla-1').playback, 'paused');
  screens.command('pantalla-1', 'resume');
  assert.strictEqual(screens.get('pantalla-1').playback, 'playing');
  screens.command('pantalla-1', 'stop');
  assert.strictEqual(screens.get('pantalla-1').view, 'score');
  assert.strictEqual(screens.get('pantalla-2').view, 'score', 'La otra pantalla no cambia');
});

test('Publicidad final: una vez por final, solo con la opción activada y en la vista de marcador', () => {
  const clock = { t: 5000 };
  const screens = freshScreens(clock);
  screens.update('pantalla-1', { endAds: { enabled: true } }, EMPTY_LIBRARY);
  screens.update('pantalla-2', { matchId: 'pista-1' }, EMPTY_LIBRARY);   // misma pista, opción desactivada

  assert.deepStrictEqual(screens.matchFinished('pista-1', '40'), ['pantalla-1']);
  assert.deepStrictEqual(screens.get('pantalla-1').postMatch, { key: 'pista-1:40', since: 5000 });
  assert.strictEqual(screens.get('pantalla-2').postMatch, null);

  clock.t = 9000;
  assert.deepStrictEqual(screens.matchFinished('pista-1', '40'), [], 'El mismo final no se repite');
  assert.strictEqual(screens.get('pantalla-1').postMatch.since, 5000);

  // Activarla DESPUÉS de un final no la dispara con ese final
  screens.update('pantalla-2', { endAds: { enabled: true } }, EMPTY_LIBRARY);
  assert.deepStrictEqual(screens.matchFinished('pista-1', '40'), []);

  // El partido vuelve a jugarse (deshacer) → marcador; nuevo final → se activa otra vez
  assert.deepStrictEqual(screens.matchActive('pista-1'), ['pantalla-1']);
  assert.strictEqual(screens.get('pantalla-1').postMatch, null);
  assert.deepStrictEqual(screens.matchFinished('pista-1', '42').sort(), ['pantalla-1', 'pantalla-2']);

  // Volver al marcador, desactivar la opción o cambiar de partido la terminan
  screens.command('pantalla-1', 'stop');
  assert.strictEqual(screens.get('pantalla-1').postMatch, null);
  screens.update('pantalla-2', { endAds: { enabled: false } }, EMPTY_LIBRARY);
  assert.strictEqual(screens.get('pantalla-2').postMatch, null);

  // Otra pista no afecta
  assert.deepStrictEqual(screens.matchFinished('pista-2', '3'), []);
});

test('Publicidad en la pausa: activa por defecto, vuelve al reanudar, sin repetirse y respetando "Volver al marcador"', () => {
  const screens = freshScreens();
  screens.update('pantalla-2', { matchId: 'pista-1', pauseAds: { enabled: false } }, EMPTY_LIBRARY);
  assert.strictEqual(screens.get('pantalla-1').pauseAds.enabled, true, 'Activada por defecto');

  const playId = screens.get('pantalla-1').playId;
  assert.deepStrictEqual(screens.matchPauseChanged('pista-1', 'u:1'), ['pantalla-1'], 'Solo la que la tiene activada');
  assert.deepStrictEqual(screens.get('pantalla-1').pauseMedia, { key: 'u:1' });
  assert.strictEqual(screens.get('pantalla-1').playId, playId + 1, 'La lista empieza desde el principio');
  assert.deepStrictEqual(screens.matchPauseChanged('pista-1', 'u:1'), [], 'El mismo aviso no cambia nada');

  // "Volver al marcador" en plena pausa: no vuelve a salir en ESTA pausa
  screens.command('pantalla-1', 'stop');
  assert.strictEqual(screens.get('pantalla-1').pauseMedia, null);
  assert.deepStrictEqual(screens.matchPauseChanged('pista-1', 'u:1'), []);
  // Reanudar y volver a pausar: sí
  assert.deepStrictEqual(screens.matchPauseChanged('pista-1', null), ['pantalla-1']);
  assert.deepStrictEqual(screens.matchPauseChanged('pista-1', 'u:2'), ['pantalla-1']);
  assert.deepStrictEqual(screens.matchPauseChanged('pista-1', null), ['pantalla-1'], 'Al reanudar vuelve al marcador');
  assert.strictEqual(screens.get('pantalla-1').pauseMedia, null);

  // En "Publicidad y vídeos" ya se ve la lista: nada que hacer
  screens.command('pantalla-1', 'play');
  assert.deepStrictEqual(screens.matchPauseChanged('pista-1', 'u:3'), []);
});

test('Publicidad final pendiente sobrevive a un reinicio y no se repite', () => {
  const screens = freshScreens({ t: 100 });
  screens.update('pantalla-1', { endAds: { enabled: true } }, EMPTY_LIBRARY);
  screens.matchFinished('pista-1', '9');
  const again = loadModules().createScreenManager({ matchIds: ['pista-1', 'pista-2'], now: () => 200 });
  assert.deepStrictEqual(again.get('pantalla-1').postMatch, { key: 'pista-1:9', since: 100 });
  assert.deepStrictEqual(again.matchFinished('pista-1', '9'), []);
});

test('Pausa: bloquea puntos y saque; deshacer y finalizar siguen disponibles; se guarda en disco', () => {
  const match = freshRegistry().get('pista-1');
  quiet(() => match.setup(validConfig()));
  quiet(() => match.applyAction('pointA', match.version));
  const v = match.version;
  quiet(() => match.applyAction('pause', v));
  assert.strictEqual(match.getPublicState().paused, true);
  assert.strictEqual(match.version, v + 1, 'La pausa crea una versión nueva (las pantallas se enteran)');
  ['pointA', 'pointB', 'changeServer'].forEach((a) => assertCode(() => match.applyAction(a, match.version), 'MATCH_PAUSED'));
  assert.strictEqual(restartRegistry().get('pista-1').getPublicState().paused, true, 'La pausa sobrevive a un reinicio');

  quiet(() => match.applyAction('undo', match.version));
  assert.strictEqual(match.getPublicState().players.A.points, 0, 'Deshacer funciona en pausa');
  quiet(() => match.applyAction('finishMatch', match.version));
  assert.strictEqual(match.getPublicState().paused, false, 'Al terminar se quita la pausa');
  assertCode(() => match.applyAction('pause', match.version), 'INVALID_ACTION');
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

// ═════════════════════════════════════════════════════════════════
console.log('\nHISTORIAL DE PARTIDOS');
// ═════════════════════════════════════════════════════════════════

function record(over = {}) {
  return {
    uid: 'u1', matchId: 'pista-1', court: 'Pista 1', startedAt: 1000, finishedAt: 5000, durationMs: 4000, pausedMs: 0,
    finishType: 'normal', teams: { A: 'Agustín Tapia / Arturo Coello', B: 'Ale Galán / Federico Chingotto' },
    winner: 'A', sets: { A: 2, B: 0 }, setScores: [], unfinishedSet: null, config: {}, version: 30, ...over,
  };
}

function freshHistory() {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  return loadModules().history.createHistory();
}

test('Un partido terminado se guarda y se lee (los más recientes primero)', () => {
  const h = quiet(() => freshHistory());
  quiet(() => h.recordFinish(record({ uid: 'a', finishedAt: 1000 })));
  quiet(() => h.recordFinish(record({ uid: 'b', finishedAt: 3000 })));
  quiet(() => h.recordFinish(record({ uid: 'c', finishedAt: 2000 })));
  assert.deepStrictEqual(h.list().records.map((r) => r.uid), ['b', 'c', 'a']);
});

test('Sin duplicados: el mismo final dos veces → un solo registro (ni se escribe dos veces)', () => {
  const h = quiet(() => freshHistory());
  assert.strictEqual(quiet(() => h.recordFinish(record())), true);
  assert.strictEqual(quiet(() => h.recordFinish(record())), false);
  assert.strictEqual(h.list().total, 1);
  assert.strictEqual(fs.readFileSync(h.file, 'utf8').trim().split('\n').length, 1);
});

test('Deshacer el final lo anula; volver a terminar guarda el resultado nuevo', () => {
  const h = quiet(() => freshHistory());
  quiet(() => h.recordFinish(record({ version: 30 })));
  quiet(() => h.cancelFinish('u1'));
  assert.strictEqual(h.list().total, 0, 'Anulado');
  quiet(() => h.recordFinish(record({ version: 34, sets: { A: 2, B: 1 } })));
  const { records } = h.list();
  assert.deepStrictEqual([records.length, records[0].sets], [1, { A: 2, B: 1 }]);
  assert.strictEqual(quiet(() => h.cancelFinish('no-existe')), false);
});

test('Filtros: rango de fechas, pista y nombre (sin tildes ni mayúsculas)', () => {
  const h = quiet(() => freshHistory());
  quiet(() => h.recordFinish(record({ uid: 'x', finishedAt: 100, matchId: 'pista-1' })));
  quiet(() => h.recordFinish(record({ uid: 'y', finishedAt: 200, matchId: 'pista-2', teams: { A: 'Juan Lebrón', B: 'Paquito Navarro' } })));
  quiet(() => h.recordFinish(record({ uid: 'z', finishedAt: 300, matchId: 'pista-1' })));
  assert.deepStrictEqual(h.list({ from: 150, to: 300 }).records.map((r) => r.uid), ['y'], 'Desde incluido, hasta excluido');
  assert.deepStrictEqual(h.list({ matchId: 'pista-1' }).records.map((r) => r.uid), ['z', 'x']);
  assert.deepStrictEqual(h.list({ text: 'GALAN tapia' }).records.map((r) => r.uid), ['z', 'x']);
  assert.deepStrictEqual(h.list({ text: 'lebron' }).records.map((r) => r.uid), ['y']);
  assert.strictEqual(h.list({ limit: 1 }).records.length, 1);
  assert.strictEqual(h.list({ limit: 1 }).total, 3, 'El total cuenta todos aunque se limite la lista');
});

test('Se conserva tras reiniciar y una línea dañada (corte de luz) no rompe el resto', () => {
  const h = quiet(() => freshHistory());
  quiet(() => h.recordFinish(record({ uid: 'a' })));
  fs.appendFileSync(h.file, '{"type":"final","uid":"rot');   // escritura cortada a medias
  const again = loadModules().history.createHistory();
  assert.deepStrictEqual(again.list().records.map((r) => r.uid), ['a']);
  quiet(() => again.recordFinish(record({ uid: 'b', finishedAt: 9000 })));
  // La línea cortada no se mezcla con la siguiente
  assert.deepStrictEqual(loadModules().history.createHistory().list().records.map((r) => r.uid).sort(), ['a', 'b']);
});

test('Match: inicio, uid, tiempo en pausa y registro del historial', () => {
  const match = freshRegistry().get('pista-1');
  quiet(() => match.setup(validConfig()));
  const uid = match.uid;
  assert.ok(uid && Number.isFinite(match.startedAt));
  quiet(() => match.applyAction('pause', match.version));
  match.pausedSince -= 5000;   // simula 5 s en pausa
  quiet(() => match.applyAction('resume', match.version));
  assert.ok(match.pausedMs >= 5000 && match.pausedMs < 6000, `pausa ${match.pausedMs}`);
  quiet(() => match.applyAction('pointA', match.version));
  const rec = match.historyRecord('manual');
  assert.strictEqual(rec.uid, uid);
  assert.strictEqual(rec.finishType, 'manual');
  assert.deepStrictEqual(rec.teams, { A: 'Galán / Lebrón', B: 'Coello / Tapia' });
  assert.ok(rec.durationMs >= 0);
  assert.strictEqual(restartRegistry().get('pista-1').uid, uid, 'Se conserva tras reiniciar');
  quiet(() => match.reset(match.version));
  assert.notStrictEqual(match.uid, uid, 'Reiniciar = partido nuevo');
});

console.log('\nRESOLUCIONES PERSONALIZADAS');

test('Formato personalizado: ancho × alto a mano, validado; la pantalla lo recibe tal cual', () => {
  const screens = freshScreens();
  const { screenConfig } = loadModules();
  screens.update('pantalla-1', { output: { format: 'custom', width: 1536, height: 768, x: 10, y: 20 } }, EMPTY_LIBRARY);
  assert.deepStrictEqual(screenConfig.resolveOutput(screens.get('pantalla-1').output),
    { format: 'custom', width: 1536, height: 768, x: 10, y: 20, brightness: 100, fit: 'auto' });
  [{ width: 8 }, { width: 9000 }, { height: 5000 }, { width: 100.5 }, { format: 'f-00000000' }].forEach((output) =>
    assertCode(() => screens.update('pantalla-1', { output }, EMPTY_LIBRARY), 'INVALID_SCREEN_CONFIG'));
  // Los formatos fijos copian su tamaño: al pasar a personalizado (lo que hace la
  // estación, que ya no los ofrece por separado) la pantalla queda igual
  screens.update('pantalla-1', { output: { format: 'led-sm' } }, EMPTY_LIBRARY);
  assert.strictEqual(screenConfig.resolveOutput(screens.get('pantalla-1').output).width, 416);
  screens.update('pantalla-1', { output: { format: 'custom' } }, EMPTY_LIBRARY);
  assert.deepStrictEqual([screens.get('pantalla-1').output.width, screens.get('pantalla-1').output.height], [416, 208]);
  // Cambiar el tamaño de un formato fijo lo convierte en personalizado (nunca se ignora el cambio)
  screens.update('pantalla-1', { output: { format: 'led-xl' } }, EMPTY_LIBRARY);
  screens.update('pantalla-1', { output: { width: 900 } }, EMPTY_LIBRARY);
  const out = screenConfig.resolveOutput(screens.get('pantalla-1').output);
  assert.deepStrictEqual([out.format, out.width, out.height], ['custom', 900, 416]);
});

test('Estadísticas al terminar: activadas por defecto, se pueden quitar por pantalla y los espejos siguen a su origen', () => {
  const screens = freshScreens();
  assert.strictEqual(screens.get('pantalla-1').endStats.enabled, true, 'Activadas por defecto');
  screens.update('pantalla-1', { endStats: { enabled: false } }, EMPTY_LIBRARY);
  assert.strictEqual(screens.get('pantalla-1').endStats.enabled, false);
  assert.strictEqual(screens.get('pantalla-2').endStats.enabled, true, 'Cada pantalla tiene la suya');
  screens.update('pantalla-2', { mirrorOf: 'pantalla-1' }, EMPTY_LIBRARY);
  assert.strictEqual(screens.effective('pantalla-2').endStats.enabled, false, 'Un espejo muestra lo mismo que su origen');
  const { normalizeSaved } = require('./screenConfig');
  const BASE = { id: 'pantalla-1', label: 'Pantalla 1', matchId: 'pista-1', matchIds: ['pista-1', 'pista-2'] };
  assert.strictEqual(normalizeSaved({ endStats: { enabled: false } }, BASE).endStats.enabled, false, 'Se guarda');
  assert.strictEqual(normalizeSaved({}, BASE).endStats.enabled, true, 'Configuraciones antiguas: activadas');
});

test('Formatos guardados: con nombre y validados; elegir uno copia su tamaño; borrarlo deja la pantalla igual', () => {
  fs.rmSync(path.join(TEST_DATA_DIR, 'formatos.json'), { force: true });
  const { formats, screenConfig } = loadModules();
  const library = formats.createFormatLibrary();
  const led = library.add({ label: '  LED   pista central ', width: 1536, height: 768 });
  assert.strictEqual(led.label, 'LED pista central');
  assertCode(() => library.add({ label: 'led PISTA central', width: 10, height: 10 }), 'INVALID_FORMAT');
  assertCode(() => library.add({ label: 'Otro', width: 10, height: 10 }), 'INVALID_FORMAT');
  assertCode(() => library.add({ label: '', width: 100, height: 100 }), 'INVALID_FORMAT');
  assert.strictEqual(formats.createFormatLibrary().list().length, 1, 'Se conserva tras reiniciar');

  const screens = freshScreens();
  screens.update('pantalla-2', { output: { format: led.id } }, EMPTY_LIBRARY, library.list());
  assert.deepStrictEqual(screenConfig.resolveOutput(screens.get('pantalla-2').output).width, 1536);
  // Cambiar el tamaño a mano → personalizado
  screens.update('pantalla-2', { output: { height: 760 } }, EMPTY_LIBRARY, library.list());
  assert.strictEqual(screens.get('pantalla-2').output.format, 'custom');
  // Borrarlo: quien lo usaba pasa a personalizado con el mismo tamaño
  screens.update('pantalla-2', { output: { format: led.id } }, EMPTY_LIBRARY, library.list());
  library.remove(led.id);
  assert.deepStrictEqual(screens.forgetFormat(led.id), ['pantalla-2']);
  const out = screenConfig.resolveOutput(screens.get('pantalla-2').output);
  assert.deepStrictEqual([out.format, out.width, out.height], ['custom', 1536, 768]);
  assertCode(() => library.remove(led.id), 'INVALID_FORMAT');
});

console.log('\nPORTÁTILES REMOTOS');

test('Enlace de portátiles: código de 6 cifras, token (solo se guarda su hash), nuevo código y desvincular', () => {
  fs.rmSync(path.join(TEST_DATA_DIR, 'remotes.json'), { force: true });
  const { remotes } = loadModules();
  const registry = remotes.createRemoteRegistry();
  const code = registry.code();
  assert.ok(/^[1-9]\d{5}$/.test(code), code);
  assertCode(() => registry.pair('123', 'Portátil 2'), 'INVALID_CODE');
  const paired = registry.pair(code, '  Portátil   pista 1 ');
  assert.strictEqual(paired.name, 'Portátil pista 1');
  assert.strictEqual(registry.verify(paired.token).id, paired.id);
  assert.strictEqual(registry.verify('otro'), null);
  assert.strictEqual(registry.verify(undefined), null);
  const disk = fs.readFileSync(path.join(TEST_DATA_DIR, 'remotes.json'), 'utf8');
  assert.ok(!disk.includes(paired.token), 'El token no se guarda en disco');

  // Reiniciar: se conserva el enlace y el código
  const again = loadModules().remotes.createRemoteRegistry();
  assert.strictEqual(again.verify(paired.token).name, 'Portátil pista 1');
  assert.strictEqual(again.code(), code);
  // El mismo portátil se vuelve a enlazar: sustituye al anterior (no se duplica)
  const repaired = again.pair(code, 'Portátil pista 1');
  assert.strictEqual(again.list().length, 1);
  assert.strictEqual(again.verify(paired.token), null);
  // Código nuevo: el viejo no sirve, el enlazado sigue
  const fresh = again.newCode();
  assert.notStrictEqual(fresh, code);
  assertCode(() => again.pair(code, 'Intruso'), 'INVALID_CODE');
  assert.ok(again.verify(repaired.token));
  again.unlink(repaired.id);
  assert.strictEqual(again.verify(repaired.token), null);
  assertCode(() => again.unlink(repaired.id), 'UNKNOWN_REMOTE');
});

test('Descubrimiento: direcciones de difusión de cada red', () => {
  const discovery = require('./discovery');
  const list = discovery.broadcastAddresses();
  assert.ok(list.includes('255.255.255.255'));
  assert.ok(list.every((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)));
});

/** El anuncio del portátil principal llega a quien escucha (red local real) */
async function discoveryRoundTrip() {
  const discovery = require('./discovery');
  const port = 41000 + Math.floor(Math.random() * 500);
  const found = [];
  const listener = discovery.listen((info) => found.push(info), { port });
  const beacon = discovery.startBeacon(() => ({ name: 'Principal', port: 3000, version: '9.9.9' }), { port, intervalMs: 100 });
  const start = Date.now();
  while (!found.length && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 50));
  beacon.stop();
  listener.stop();
  try {
    assert.ok(found.length > 0, 'No llegó ningún anuncio');
    assert.strictEqual(found[0].port, 3000);
    assert.strictEqual(found[0].name, 'Principal');
    console.log(`  ✅  Descubrimiento: el anuncio del principal llega por la red (${found[0].address})`);
    pasadas++;
  } catch (err) {
    console.log('  ❌  Descubrimiento: el anuncio del principal llega por la red');
    console.log(`       → ${err.message}`);
    fallidas++;
  }
}

discoveryRoundTrip().then(() => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_ADS_DIR, { recursive: true, force: true });
  resumen();
});
