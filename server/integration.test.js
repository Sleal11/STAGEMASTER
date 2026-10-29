'use strict';

/**
 * ─────────────────────────────────────────────────────────────────
 * STAGEMASTER — PRUEBAS DE INTEGRACIÓN (SISTEMA COMPLETO)
 * Archivo: server/integration.test.js
 *
 * Ejecutar con: node server/integration.test.js   (o npm test)
 *
 * Arranca el servidor REAL (server/index.js) como un proceso aparte y
 * conecta "dispositivos virtuales" por Socket.IO, igual que en el evento:
 *
 *   🖥  Estación operadora (portátil)
 *   📱 Teléfono árbitro Pista 1     📱 Teléfono árbitro Pista 2
 *   📺 Pantalla 1                   📺 Pantalla 2
 *
 * Verifica: dos partidos aislados, vinculación por PIN, intentos sobre el
 * partido equivocado, asignación de pantallas (incluida la misma pista en
 * las dos), publicidad, sincronización, desconexiones, reinicio del
 * servidor y uso intensivo.
 *
 * Usa carpetas TEMPORALES de datos y publicidad y un puerto libre.
 * ─────────────────────────────────────────────────────────────────
 */

const assert    = require('assert');
const fs        = require('fs');
const net       = require('net');
const os        = require('os');
const path      = require('path');
const { spawn } = require('child_process');
const { io }    = require('socket.io-client');

// ─────────────────────────────────────────────────────────────────
// MINI FRAMEWORK DE PRUEBAS (asíncrono)
// ─────────────────────────────────────────────────────────────────

const pruebas = [];
let pasadas   = 0;
let fallidas  = 0;
let omitidas  = 0;

function test(nombre, fn) {
  pruebas.push({ nombre, fn });
}

async function ejecutarPruebas() {
  for (const { nombre, fn } of pruebas) {
    try {
      const detalle = await fn();
      if (detalle && detalle.skip) {
        console.log(`  ⚪  ${nombre}  [OMITIDA: ${detalle.skip}]`);
        omitidas++;
        continue;
      }
      console.log(`  ✅  ${nombre}${detalle ? `  [${detalle}]` : ''}`);
      pasadas++;
    } catch (err) {
      console.log(`  ❌  ${nombre}`);
      console.log(`       → ${err.message}`);
      fallidas++;
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// SERVIDOR REAL EN UN PROCESO APARTE
// ─────────────────────────────────────────────────────────────────

const ROOT     = path.join(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stagemaster-int-'));
const ADS_DIR  = fs.mkdtempSync(path.join(os.tmpdir(), 'stagemaster-int-ads-'));
let PORT;
let serverProcess = null;

fs.mkdirSync(path.join(ADS_DIR, 'banner'));
fs.mkdirSync(path.join(ADS_DIR, 'pantalla-completa'));
fs.writeFileSync(path.join(ADS_DIR, 'banner', 'patrocinador.png'), 'imagen');
fs.writeFileSync(path.join(ADS_DIR, 'pantalla-completa', 'promo.jpg'), 'imagen');
fs.writeFileSync(path.join(ADS_DIR, 'pantalla-completa', 'anuncio.mp4'), Buffer.alloc(4096, 7));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), STAGEMASTER_DATA_DIR: DATA_DIR, STAGEMASTER_ADS_DIR: ADS_DIR },
    });
    let output = '';
    const timer = setTimeout(() => reject(new Error('El servidor no arrancó:\n' + output)), 8000);
    serverProcess.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('Esperando conexiones')) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProcess.stderr.on('data', (chunk) => { output += chunk; });
  });
}

function killServer() {
  return new Promise((resolve) => {
    if (!serverProcess || serverProcess.exitCode !== null) return resolve();
    serverProcess.once('exit', () => resolve());
    serverProcess.kill('SIGKILL');
  });
}

// ─────────────────────────────────────────────────────────────────
// DISPOSITIVOS VIRTUALES
// ─────────────────────────────────────────────────────────────────

const dispositivos = [];

/**
 * Crea un dispositivo con un rol y registra todo lo que recibe.
 * @param {Object} auth - { role, screenId, token }
 * @param {string} [host] - Dirección a la que conectar (por defecto localhost)
 */
function createDevice(nombre, auth, host = 'localhost') {
  const socket = io(`http://${host}:${PORT}`, {
    auth, forceNew: true, reconnectionDelay: 100, reconnectionDelayMax: 300,
  });
  const device = {
    nombre, socket,
    states: {},           // matchId → último estado recibido
    updates: {},          // matchId → nº de actualizaciones recibidas
    screenConfig: null,
    stationState: null,
    session: null,
    revoked: null,
    identified: 0,
  };
  socket.on('matchUpdate', ({ matchId, state }) => {
    device.states[matchId]  = state;
    device.updates[matchId] = (device.updates[matchId] || 0) + 1;
  });
  socket.on('screenConfig', (cfg) => { device.screenConfig = cfg; device.configs = (device.configs || 0) + 1; });
  socket.on('stationState', (st) => { device.stationState = st; });
  socket.on('controllerSession', (s) => { device.session = s; device.revoked = null; });
  socket.on('controllerRevoked', (r) => { device.revoked = r; device.session = null; });
  socket.on('identify', () => { device.identified++; });
  dispositivos.push(device);
  return device;
}

async function connectStation() {
  const station = createDevice('Estación', { role: 'station' });
  await waitFor(() => station.stationState, 'estado inicial de la estación');
  return station;
}

async function connectDisplay(n) {
  const display = createDevice(`Pantalla ${n}`, { role: 'display', screenId: `pantalla-${n}` });
  await waitFor(() => display.screenConfig && display.screenConfig.matchId in display.states, `configuración de la pantalla ${n}`);
  return display;
}

async function connectPhone(nombre, token) {
  const phone = createDevice(nombre, token ? { role: 'controller', token } : { role: 'controller' });
  await waitFor(() => phone.socket.connected, `conexión de ${nombre}`);
  if (token) await waitFor(() => phone.session || phone.revoked, `sesión de ${nombre}`);
  return phone;
}

function send(device, eventName, payload) {
  return device.socket.timeout(3000).emitWithAck(eventName, payload);
}

function pinOf(station, matchId) {
  return station.stationState.matches.find((m) => m.id === matchId).pin;
}

/** Vincula un teléfono con el PIN que muestra la estación */
async function pair(phone, matchId, { force = false, pin } = {}) {
  const res = await send(phone, 'pair', { matchId, pin: pin || pinOf(estacion, matchId), deviceName: phone.nombre, force });
  if (res.ok) {
    phone.token = res.token;
    phone.socket.auth.token = res.token;
    await waitFor(() => phone.states[matchId] !== undefined, 'estado tras vincular');
  }
  return res;
}

/** Acción del árbitro usando la versión que ve su teléfono */
function action(phone, matchId, actionName) {
  return send(phone, 'matchAction', { matchId, action: actionName, version: phone.states[matchId].version });
}

async function waitFor(condicion, descripcion, timeoutMs = 3000) {
  const inicio = Date.now();
  while (!condicion()) {
    if (Date.now() - inicio > timeoutMs) throw new Error(`Tiempo agotado esperando: ${descripcion}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function config(overrides = {}) {
  return {
    nameA: 'Jose V / Santiago R', nameB: 'Coello / Tapia',
    gamesPerSet: 6, totalSets: 3,
    scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak',
    initialServer: 'A',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// LAS PRUEBAS
// ─────────────────────────────────────────────────────────────────

let estacion, pantalla1, pantalla2, telefono1, telefono2;

test('Arranque sin teléfonos ni partidos: pantallas conectan y muestran "sin partido"', async () => {
  pantalla1 = await connectDisplay(1);
  pantalla2 = await connectDisplay(2);
  assert.strictEqual(pantalla1.screenConfig.matchId, 'pista-1');
  assert.strictEqual(pantalla2.screenConfig.matchId, 'pista-2');
  assert.strictEqual(pantalla1.states['pista-1'], null);
});

test('Estación operadora: ve 2 partidos con PIN y 2 pantallas conectadas', async () => {
  estacion = await connectStation();
  await waitFor(() => estacion.stationState.screens.every((s) => s.displays.length === 1), 'pantallas en la estación');
  const st = estacion.stationState;
  assert.deepStrictEqual(st.matches.map((m) => m.id), ['pista-1', 'pista-2']);
  st.matches.forEach((m) => assert.match(m.pin, /^\d{4}$/));
  assert.strictEqual(st.matches[0].controller, null, 'Ningún teléfono vinculado al inicio');
});

test('Pantalla desconocida (pantalla-9) se rechaza al conectar', async () => {
  const intruso = io(`http://localhost:${PORT}`, { auth: { role: 'display', screenId: 'pantalla-9' }, forceNew: true, reconnection: false });
  const err = await new Promise((resolve) => intruso.once('connect_error', resolve));
  intruso.close();
  assert.strictEqual(err.data.code, 'UNKNOWN_SCREEN');
});

test('La estación solo se acepta desde el propio portátil (localhost)', async () => {
  const lanIp = Object.values(os.networkInterfaces()).flat()
    .find((n) => n && n.family === 'IPv4' && !n.internal);
  if (!lanIp) return { skip: 'este equipo no tiene una IP de red local para simular un teléfono' };

  const remota = io(`http://${lanIp.address}:${PORT}`, { auth: { role: 'station' }, forceNew: true, reconnection: false });
  const err = await new Promise((resolve) => remota.once('connect_error', resolve));
  remota.close();
  assert.strictEqual(err.data.code, 'STATION_LOCAL_ONLY');
  return `rechazada desde ${lanIp.address}`;
});

test('Una pantalla solo se acepta desde el portátil; station.html desde la red → 403', async () => {
  const lanIp = Object.values(os.networkInterfaces()).flat()
    .find((n) => n && n.family === 'IPv4' && !n.internal);
  if (!lanIp) return { skip: 'este equipo no tiene una IP de red local para simular un teléfono' };

  const remota = io(`http://${lanIp.address}:${PORT}`, { auth: { role: 'display', screenId: 'pantalla-1' }, forceNew: true, reconnection: false });
  const err = await new Promise((resolve) => remota.once('connect_error', resolve));
  remota.close();
  assert.strictEqual(err.data.code, 'DISPLAY_LOCAL_ONLY');

  const page = await fetch(`http://${lanIp.address}:${PORT}/station.html`);
  assert.strictEqual(page.status, 403);
});

test('La estación configura los DOS partidos; cada pantalla recibe solo el suyo', async () => {
  let res = await send(estacion, 'setupMatch', { matchId: 'pista-1', config: config() });
  assert.ok(res.ok, res.message);
  res = await send(estacion, 'setupMatch', { matchId: 'pista-2', config: config({ nameA: 'Ana P / Lucía M', nameB: 'Sara G / Eva T' }) });
  assert.ok(res.ok, res.message);

  await waitFor(() => pantalla1.states['pista-1'] && pantalla2.states['pista-2'], 'ambas pantallas con su partido');
  assert.strictEqual(pantalla1.states['pista-1'].players.A.name, 'Jose V / Santiago R');
  assert.strictEqual(pantalla2.states['pista-2'].players.A.name, 'Ana P / Lucía M');
  assert.strictEqual(pantalla1.states['pista-2'], undefined, 'La pantalla 1 NO recibe la pista 2');
  assert.strictEqual(pantalla2.states['pista-1'], undefined, 'La pantalla 2 NO recibe la pista 1');
});

test('Teléfono sin vincular: ve las pistas pero no puede puntuar (NOT_PAIRED)', async () => {
  telefono1 = await connectPhone('Árbitro 1');
  const lista = await send(telefono1, 'listCourts');
  assert.deepStrictEqual(lista.courts.map((c) => c.id), ['pista-1', 'pista-2']);
  assert.ok(!('pin' in lista.courts[0]), 'La lista pública NO incluye el PIN');
  const res = await send(telefono1, 'matchAction', { matchId: 'pista-1', action: 'pointA', version: 1 });
  assert.strictEqual(res.code, 'NOT_PAIRED');
});

test('PIN incorrecto se rechaza indicando los intentos restantes', async () => {
  const res = await pair(telefono1, 'pista-1', { pin: '0000' === pinOf(estacion, 'pista-1') ? '1111' : '0000' });
  assert.strictEqual(res.code, 'INVALID_PIN');
  assert.match(res.message, /intento/);
});

test('Árbitro 1 se vincula a la Pista 1 con su PIN', async () => {
  const res = await pair(telefono1, 'pista-1');
  assert.ok(res.ok, res.message);
  assert.strictEqual(res.label, 'Pista 1');
  await waitFor(() => estacion.stationState.matches[0].controller?.connected, 'teléfono visible en la estación');
  return `estación ve: ${estacion.stationState.matches[0].controller.deviceName}`;
});

test('Árbitro 2 se vincula a la Pista 2', async () => {
  telefono2 = await connectPhone('Árbitro 2');
  const res = await pair(telefono2, 'pista-2');
  assert.ok(res.ok, res.message);
});

test('AISLAMIENTO: puntos del Árbitro 1 solo llegan a la Pista 1', async () => {
  const antesP2 = pantalla2.updates['pista-2'];
  const versionP2 = estacion.stationState.matches[1].state.version;
  for (const accion of ['pointA', 'pointA', 'pointB']) {
    const res = await action(telefono1, 'pista-1', accion);
    assert.ok(res.ok, res.message);
  }
  await waitFor(() => pantalla1.states['pista-1'].players.A.points === 30 &&
                      pantalla1.states['pista-1'].players.B.points === 15, 'pantalla 1 actualizada');
  await sleep(150);
  assert.strictEqual(pantalla2.updates['pista-2'], antesP2, 'La pantalla 2 no recibió nada');
  assert.strictEqual(telefono2.states['pista-1'], undefined, 'El teléfono 2 no recibió la pista 1');
  await waitFor(() => estacion.stationState.matches[0].state.version === pantalla1.states['pista-1'].version, 'estación al día');
  assert.strictEqual(estacion.stationState.matches[1].state.version, versionP2, 'La pista 2 no cambió de versión');
});

test('Intento de puntuar en el partido EQUIVOCADO → WRONG_MATCH y nada cambia', async () => {
  const p2 = pantalla2.states['pista-2'];
  const res = await send(telefono1, 'matchAction', { matchId: 'pista-2', action: 'pointA', version: p2.version });
  assert.strictEqual(res.code, 'WRONG_MATCH');
  assert.match(res.message, /Pista 1/);
  await sleep(100);
  assert.strictEqual(pantalla2.states['pista-2'].version, p2.version);
});

test('Un teléfono tampoco puede administrar (estación) → FORBIDDEN', async () => {
  const res = await send(telefono1, 'station:updateScreen', { screenId: 'pantalla-2', changes: { matchId: 'pista-1' } });
  assert.strictEqual(res.code, 'FORBIDDEN');
});

test('Doble pulsación: 3 toques simultáneos → 1 solo punto', async () => {
  const version = telefono2.states['pista-2'].version;
  const respuestas = await Promise.all([1, 2, 3].map(() =>
    send(telefono2, 'matchAction', { matchId: 'pista-2', action: 'pointB', version })));
  assert.strictEqual(respuestas.filter((r) => r.ok).length, 1);
  assert.ok(respuestas.filter((r) => !r.ok).every((r) => r.code === 'STALE_VERSION'));
  await waitFor(() => pantalla2.states['pista-2'].version === version + 1, 'pantalla 2 actualizada');
  assert.strictEqual(pantalla2.states['pista-2'].players.B.points, 15);
});

test('Segundo teléfono en una pista ocupada → pide confirmación (CONTROLLER_ACTIVE)', async () => {
  const intruso = await connectPhone('Teléfono extra');
  const res = await pair(intruso, 'pista-1');
  assert.strictEqual(res.code, 'CONTROLLER_ACTIVE');
  intruso.socket.disconnect();
});

test('Reemplazar el teléfono de una pista (force): el anterior pierde el permiso', async () => {
  const respaldo = await connectPhone('Respaldo 1');
  const res = await pair(respaldo, 'pista-1', { force: true });
  assert.ok(res.ok, res.message);
  await waitFor(() => telefono1.revoked, 'aviso de permiso retirado en el teléfono anterior');
  assert.strictEqual(telefono1.revoked.reason, 'replaced');

  const intento = await send(telefono1, 'matchAction', { matchId: 'pista-1', action: 'pointA', version: pantalla1.states['pista-1'].version });
  assert.strictEqual(intento.code, 'NOT_PAIRED', 'El teléfono reemplazado ya no puede puntuar');

  // El árbitro original recupera la pista para el resto de pruebas
  respaldo.socket.disconnect();
  await waitFor(() => !estacion.stationState.matches[0].controller?.connected, 'respaldo desconectado');
  const recupera = await pair(telefono1, 'pista-1');
  assert.ok(recupera.ok, recupera.message);
});

test('Estación asigna la Pista 1 a la Pantalla 2: ambas pantallas muestran el MISMO partido', async () => {
  const res = await send(estacion, 'station:updateScreen', { screenId: 'pantalla-2', changes: { matchId: 'pista-1' } });
  assert.ok(res.ok, res.message);
  await waitFor(() => pantalla2.screenConfig.matchId === 'pista-1' && pantalla2.states['pista-1'], 'pantalla 2 reasignada');

  await action(telefono1, 'pista-1', 'pointA');
  await waitFor(() => pantalla1.states['pista-1'].version === pantalla2.states['pista-1'].version &&
                      pantalla2.states['pista-1'].version === telefono1.states['pista-1'].version, 'ambas pantallas al día');

  // Y la Pista 2 ya no llega a la Pantalla 2
  const antes = pantalla2.updates['pista-2'];
  await action(telefono2, 'pista-2', 'pointA');
  await sleep(150);
  assert.strictEqual(pantalla2.updates['pista-2'], antes);

  // Se restaura la asignación por defecto
  await send(estacion, 'station:updateScreen', { screenId: 'pantalla-2', changes: { matchId: 'pista-2' } });
  await waitFor(() => pantalla2.screenConfig.matchId === 'pista-2', 'pantalla 2 restaurada');
});

test('Cinta publicitaria: imágenes y mensajes se aplican en vivo a la pantalla', async () => {
  assert.deepStrictEqual(estacion.stationState.ads.banner.map((a) => a.name), ['patrocinador.png']);
  const res = await send(estacion, 'station:updateScreen', {
    screenId: 'pantalla-1',
    changes: { ribbon: { enabled: true, images: ['patrocinador.png'], texts: ['  Gracias a   Bar Central ', ''], motion: 'scroll', interval: 8 } },
  });
  assert.ok(res.ok, res.message);
  await waitFor(() => pantalla1.screenConfig.ribbon.images.length === 1, 'cinta en la pantalla 1');
  const { ribbon } = pantalla1.screenConfig;
  assert.strictEqual(ribbon.images[0].url, '/publicidad/banner/patrocinador.png');
  assert.deepStrictEqual(ribbon.texts, ['Gracias a Bar Central'], 'Mensajes limpios (espacios y vacíos)');
  assert.strictEqual(ribbon.motion, 'scroll');
  assert.strictEqual(ribbon.interval, 8);

  const http = await fetch(`http://localhost:${PORT}/publicidad/banner/patrocinador.png`);
  assert.strictEqual(http.status, 200, 'El servidor sirve el archivo de publicidad');
});

test('Lista de reproducción con vídeo: la pantalla recibe imágenes y vídeos en orden; el vídeo se sirve por partes', async () => {
  const library = estacion.stationState.ads.fullscreen;
  assert.deepStrictEqual(library.map((a) => [a.name, a.kind]), [['anuncio.mp4', 'video'], ['promo.jpg', 'image']]);
  const res = await send(estacion, 'station:updateScreen', {
    screenId: 'pantalla-1', changes: { media: { items: ['promo.jpg', 'anuncio.mp4'], imageSeconds: 6, sound: true } },
  });
  assert.ok(res.ok, res.message);
  await waitFor(() => pantalla1.screenConfig.media.items.length === 2, 'lista en la pantalla 1');
  assert.deepStrictEqual(pantalla1.screenConfig.media.items.map((i) => i.kind), ['image', 'video']);
  assert.strictEqual(pantalla1.screenConfig.media.sound, true);

  // Los vídeos se piden por rangos (así se reproducen sin descargarlos enteros)
  const part = await fetch(`http://localhost:${PORT}/publicidad/pantalla-completa/anuncio.mp4`, { headers: { Range: 'bytes=0-99' } });
  assert.strictEqual(part.status, 206);
  assert.strictEqual(part.headers.get('content-type'), 'video/mp4');
  assert.strictEqual((await part.arrayBuffer()).byteLength, 100);
});

test('Reproductor: reproducir, pausar, reanudar y detener (vuelve al marcador)', async () => {
  const playId = pantalla1.screenConfig.media.playId;
  const steps = [
    ['play',   (c) => c.view === 'media' && c.media.playback === 'playing' && c.media.playId === playId + 1],
    ['pause',  (c) => c.view === 'media' && c.media.playback === 'paused'],
    ['resume', (c) => c.view === 'media' && c.media.playback === 'playing' && c.media.playId === playId + 1],
    ['stop',   (c) => c.view === 'score'],
  ];
  for (const [command, check] of steps) {
    const res = await send(estacion, 'station:media', { screenId: 'pantalla-1', command });
    assert.ok(res.ok, `${command}: ${res.message}`);
    await waitFor(() => check(pantalla1.screenConfig), `pantalla tras "${command}"`);
  }
  const res = await send(estacion, 'station:media', { screenId: 'pantalla-1', command: 'pause' });
  assert.strictEqual(res.code, 'INVALID_ACTION', 'No se puede pausar si no se está reproduciendo');
  assert.strictEqual(pantalla2.screenConfig.view, 'score', 'La otra pantalla no cambia');
});

test('Configuración inválida de pantalla → INVALID_SCREEN_CONFIG (nada cambia)', async () => {
  const invalid = [
    { ribbon: { images: ['no-existe.png'] } },
    { media: { items: ['../../secreto.mp4'] } },
    { view: 'karaoke' },
    { output: { format: 'led-gigante' } },
    { output: { x: -5 } },
    { ribbon: { texts: ['x'.repeat(121)] } },
    { endAds: { delay: 9999 } },
  ];
  for (const changes of invalid) {
    const res = await send(estacion, 'station:updateScreen', { screenId: 'pantalla-1', changes });
    assert.strictEqual(res.code, 'INVALID_SCREEN_CONFIG', JSON.stringify(changes));
  }
  const res = await send(estacion, 'station:media', { screenId: 'pantalla-1', command: 'rebobinar' });
  assert.strictEqual(res.code, 'INVALID_ACTION');
});

test('Formato LED: la pantalla recibe el tamaño exacto y la posición', async () => {
  let res = await send(estacion, 'station:updateScreen', { screenId: 'pantalla-2', changes: { output: { format: 'led-sm', x: 16, y: 8 } } });
  assert.ok(res.ok, res.message);
  await waitFor(() => pantalla2.screenConfig.output.format === 'led-sm', 'formato LED en la pantalla 2');
  assert.deepStrictEqual(pantalla2.screenConfig.output, { format: 'led-sm', width: 416, height: 208, x: 16, y: 8 });
  assert.ok(estacion.stationState.outputFormats.some((f) => f.id === 'led-xl' && f.width === 832 && f.height === 416));
  res = await send(estacion, 'station:updateScreen', { screenId: 'pantalla-2', changes: { output: { format: 'fill', x: 0, y: 0 } } });
  assert.ok(res.ok, res.message);
});

test('Identificar pantalla: solo la elegida recibe la orden', async () => {
  await send(estacion, 'station:identify', { screenId: 'pantalla-2' });
  await waitFor(() => pantalla2.identified === 1, 'identificación de la pantalla 2');
  assert.strictEqual(pantalla1.identified, 0);
});

test('Sincronización: la estación ve "al día" o "desincronizada" según lo que dibuja cada pantalla', async () => {
  const p1 = pantalla1.states['pista-1'];
  pantalla1.socket.emit('display:report', {
    viewport: { width: 1280, height: 720, dpr: 1 }, renderedMatchId: 'pista-1', renderedVersion: p1.version, adErrors: [],
  });
  await waitFor(() => estacion.stationState.screens[0].displays[0]?.sync === 'ok', 'pantalla 1 al día');
  assert.deepStrictEqual(estacion.stationState.screens[0].displays[0].viewport, { width: 1280, height: 720, dpr: 1 });

  // La pantalla 2 informa una versión vieja → tras la tolerancia aparece como desincronizada
  pantalla2.socket.emit('display:report', { viewport: { width: 1024, height: 768, dpr: 1 }, renderedMatchId: 'pista-2', renderedVersion: 0 });
  await waitFor(() => estacion.stationState.screens[1].displays[0]?.sync === 'stale', 'pantalla 2 desincronizada', 4000);
  return 'ok / stale detectados';
});

test('El teléfono pierde la conexión y al volver sigue vinculado y al día', async () => {
  telefono1.socket.disconnect();
  await waitFor(() => estacion.stationState.matches[0].controller && !estacion.stationState.matches[0].controller.connected,
    'la estación ve el teléfono desconectado');
  await send(estacion, 'matchAction', { matchId: 'pista-1', action: 'pointB', version: estacion.stationState.matches[0].state.version });

  telefono1.socket.connect();
  await waitFor(() => telefono1.session && telefono1.states['pista-1'].version === pantalla1.states['pista-1'].version,
    'teléfono resincronizado');
  const res = await action(telefono1, 'pista-1', 'pointA');
  assert.ok(res.ok, res.message);
});

test('REINICIO DEL SERVIDOR: partidos, PIN, teléfonos y pantallas se recuperan solos', async () => {
  const antes = {
    p1: JSON.parse(JSON.stringify(pantalla1.states['pista-1'])),
    p2: JSON.parse(JSON.stringify(pantalla2.states['pista-2'])),
    pin1: pinOf(estacion, 'pista-1'),
  };
  await killServer();
  await waitFor(() => !pantalla1.socket.connected && !telefono1.socket.connected, 'todos desconectados');
  pantalla1.screenConfig = null;
  await startServer();

  await waitFor(() => pantalla1.socket.connected && pantalla2.socket.connected &&
                      telefono1.socket.connected && telefono2.socket.connected && estacion.socket.connected,
  'reconexión automática de los 5 dispositivos', 6000);
  await waitFor(() => pantalla1.screenConfig && telefono1.session && telefono2.session, 'sesiones restauradas');

  assert.deepStrictEqual(pantalla1.states['pista-1'], antes.p1);
  assert.deepStrictEqual(pantalla2.states['pista-2'], antes.p2);
  assert.strictEqual(pinOf(estacion, 'pista-1'), antes.pin1);
  assert.strictEqual(pantalla1.screenConfig.ribbon.images.length, 1, 'La cinta asignada se conserva');
  assert.strictEqual(pantalla1.screenConfig.media.items.length, 2, 'La lista de reproducción se conserva');

  const res = await action(telefono2, 'pista-2', 'undo');
  assert.ok(res.ok, 'Se puede deshacer tras el reinicio: ' + res.message);
});

test('La estación desvincula un teléfono: queda sin permiso al instante', async () => {
  await send(estacion, 'station:unpair', { matchId: 'pista-2' });
  await waitFor(() => telefono2.revoked, 'aviso en el teléfono 2');
  const res = await send(telefono2, 'matchAction', { matchId: 'pista-2', action: 'pointA', version: pantalla2.states['pista-2'].version });
  assert.strictEqual(res.code, 'NOT_PAIRED');
  assert.ok(await pair(telefono2, 'pista-2').then((r) => r.ok), 'Vuelve a vincularse con el PIN');
});

test('Nuevo PIN: el PIN anterior deja de servir; el teléfono vinculado sigue funcionando', async () => {
  const viejo = pinOf(estacion, 'pista-1');
  await send(estacion, 'station:newPin', { matchId: 'pista-1' });
  await waitFor(() => pinOf(estacion, 'pista-1') !== viejo, 'PIN cambiado');
  const otro = await connectPhone('Otro');
  const res = await pair(otro, 'pista-1', { pin: viejo, force: true });
  assert.strictEqual(res.code, 'INVALID_PIN');
  otro.socket.disconnect();
  assert.ok((await action(telefono1, 'pista-1', 'pointA')).ok);
});

test('Fuerza bruta: tras 5 PIN fallidos se bloquea temporalmente (PIN_LOCKED)', async () => {
  const atacante = await connectPhone('Atacante');
  const correcto = pinOf(estacion, 'pista-2');
  const malo = correcto === '9999' ? '9998' : '9999';
  for (let i = 0; i < 5; i++) await pair(atacante, 'pista-2', { pin: malo });
  const res = await pair(atacante, 'pista-2', { pin: correcto, force: true });
  assert.strictEqual(res.code, 'PIN_LOCKED', 'Incluso con el PIN correcto debe esperar');
  atacante.socket.disconnect();
});

test('Uso intensivo: 2 árbitros puntuando a la vez (400 acciones) sin mezclar partidos', async () => {
  await send(estacion, 'setupMatch', { matchId: 'pista-1', config: config({ totalSets: 5, scoringSystem: 'starPoint' }), force: true });
  await send(estacion, 'setupMatch', { matchId: 'pista-2', config: config({ nameA: 'Ana P / Lucía M', totalSets: 5 }), force: true });
  await waitFor(() => telefono1.states['pista-1'].version === estacion.stationState.matches[0].state.version &&
                      telefono2.states['pista-2'].version === estacion.stationState.matches[1].state.version, 'partidos nuevos');

  const tiempos = [];
  const arbitro = async (phone, matchId, semilla) => {
    let s = semilla;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 200 && phone.states[matchId].status === 'playing'; i++) {
      const r = rnd();
      const accion = r < 0.48 ? 'pointA' : r < 0.96 ? 'pointB' : 'undo';
      const inicio = process.hrtime.bigint();
      const res = await action(phone, matchId, accion);
      tiempos.push(Number(process.hrtime.bigint() - inicio) / 1e6);
      assert.ok(res.ok, `${matchId} ${accion}: ${res.message}`);
    }
  };
  await Promise.all([arbitro(telefono1, 'pista-1', 3), arbitro(telefono2, 'pista-2', 11)]);

  await waitFor(() => pantalla1.states['pista-1'].version === telefono1.states['pista-1'].version &&
                      pantalla2.states['pista-2'].version === telefono2.states['pista-2'].version, 'pantallas al día');
  assert.deepStrictEqual(pantalla1.states['pista-1'], telefono1.states['pista-1']);
  assert.deepStrictEqual(pantalla2.states['pista-2'], telefono2.states['pista-2']);
  assert.strictEqual(pantalla1.states['pista-1'].players.A.name, 'Jose V / Santiago R');
  assert.strictEqual(pantalla2.states['pista-2'].players.A.name, 'Ana P / Lucía M');

  tiempos.sort((a, b) => a - b);
  const media = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
  const p99   = tiempos[Math.floor(tiempos.length * 0.99)];
  assert.ok(p99 < 250, `Respuesta demasiado lenta: p99 = ${p99.toFixed(1)} ms`);
  return `${tiempos.length} acciones · media ${media.toFixed(1)} ms · p99 ${p99.toFixed(1)} ms`;
});

test('Publicidad al terminar: se activa UNA vez por final, solo en las pantallas con la opción activada', async () => {
  await send(estacion, 'setupMatch', { matchId: 'pista-1', config: config(), force: true });
  await send(estacion, 'station:updateScreen', { screenId: 'pantalla-1', changes: { endAds: { enabled: true, delay: 1 } } });
  await send(estacion, 'station:updateScreen', { screenId: 'pantalla-2', changes: { matchId: 'pista-1', endAds: { enabled: false } } });
  await waitFor(() => pantalla1.screenConfig.view === 'score' && pantalla2.screenConfig.matchId === 'pista-1' &&
    telefono1.states['pista-1'].status === 'playing', 'pantallas preparadas');

  await action(telefono1, 'pista-1', 'pointA');
  await waitFor(() => telefono1.states['pista-1'].players.A.points === 15, 'punto');
  assert.strictEqual(pantalla1.screenConfig.postMatch, null, 'Durante el partido no hay publicidad final');

  const configsBefore = pantalla1.configs;
  await action(telefono1, 'pista-1', 'finishMatch');
  await waitFor(() => pantalla1.screenConfig.postMatch, 'publicidad final en la pantalla 1');
  const { remainingMs } = pantalla1.screenConfig.postMatch;
  assert.ok(remainingMs > 0 && remainingMs <= 1000, `El resultado se ve primero (${remainingMs} ms)`);
  assert.strictEqual(pantalla2.screenConfig.postMatch, null, 'Pantalla 2 tiene la opción desactivada');

  // Repetir "finalizar" sobre el partido ya terminado NO la vuelve a activar
  await action(telefono1, 'pista-1', 'finishMatch');
  await sleep(200);
  assert.strictEqual(pantalla1.configs, configsBefore + 1, 'Una sola activación por final');
  await waitFor(() => estacion.stationState.screens[0].postMatch, 'la estación lo ve');

  // Deshacer el final → vuelve el marcador; volver a terminar → nuevo final, se activa otra vez
  await action(telefono1, 'pista-1', 'undo');
  await waitFor(() => pantalla1.screenConfig.postMatch === null, 'marcador tras deshacer');
  await action(telefono1, 'pista-1', 'finishMatch');
  await waitFor(() => pantalla1.screenConfig.postMatch, 'publicidad tras el nuevo final');

  // "Volver al marcador" desde la estación
  await send(estacion, 'station:media', { screenId: 'pantalla-1', command: 'stop' });
  await waitFor(() => pantalla1.screenConfig.postMatch === null && pantalla1.screenConfig.view === 'score', 'vuelta al marcador');
  assert.strictEqual(telefono1.states['pista-1'].status, 'finished', 'La publicidad no cambia el marcador');

  // Con la opción desactivada, terminar el partido no cambia la pantalla
  await send(estacion, 'station:updateScreen', { screenId: 'pantalla-1', changes: { endAds: { enabled: false } } });
  await action(telefono1, 'pista-1', 'undo');
  await waitFor(() => telefono1.states['pista-1'].status === 'playing', 'partido reabierto');
  await action(telefono1, 'pista-1', 'finishMatch');
  await waitFor(() => telefono1.states['pista-1'].status === 'finished', 'partido terminado');
  await sleep(200);
  assert.strictEqual(pantalla1.screenConfig.postMatch, null);
  await send(estacion, 'station:updateScreen', { screenId: 'pantalla-2', changes: { matchId: 'pista-2' } });
});

test('Pausa: el partido no admite puntos hasta reanudarlo; las pantallas lo muestran', async () => {
  let res = await action(telefono1, 'pista-1', 'pause');
  assert.strictEqual(res.code, 'INVALID_ACTION', 'Un partido terminado no se pausa');

  await send(estacion, 'setupMatch', { matchId: 'pista-1', config: config(), force: true });
  await waitFor(() => telefono1.states['pista-1'].status === 'playing' && telefono1.states['pista-1'].version > 0, 'partido nuevo');
  res = await action(telefono1, 'pista-1', 'pause');
  assert.ok(res.ok, res.message);
  await waitFor(() => pantalla1.states['pista-1'].paused === true, 'pantalla en pausa');

  res = await action(telefono1, 'pista-1', 'pointA');
  assert.strictEqual(res.code, 'MATCH_PAUSED');
  await waitFor(() => estacion.stationState.matches[0].state.version === telefono1.states['pista-1'].version, 'estación al día');
  res = await send(estacion, 'matchAction', { matchId: 'pista-1', action: 'resume', version: estacion.stationState.matches[0].state.version });
  assert.ok(res.ok, res.message);
  await waitFor(() => telefono1.states['pista-1'].paused === false, 'reanudado');
  assert.ok((await action(telefono1, 'pista-1', 'pointA')).ok);
});

test('/health responde con el estado de ambos partidos', async () => {
  const body = await (await fetch(`http://localhost:${PORT}/health`)).json();
  assert.strictEqual(body.ok, true);
  assert.deepStrictEqual(body.matches.map((m) => m.id), ['pista-1', 'pista-2']);
});

test('station.html solo se sirve en el portátil; la raíz lleva a la estación en localhost', async () => {
  const res = await fetch(`http://localhost:${PORT}/`, { redirect: 'manual' });
  assert.strictEqual(res.headers.get('location'), '/station.html');
  const page = await fetch(`http://localhost:${PORT}/station.html`);
  assert.strictEqual(page.status, 200);
});

test('Sin aplicación de escritorio (npm start), las órdenes de monitor se rechazan', async () => {
  assert.strictEqual(estacion.stationState.desktop, null);
  const res = await send(estacion, 'station:setMonitor', { screenId: 'pantalla-1', monitor: 'window' });
  assert.strictEqual(res.code, 'FORBIDDEN');
});

test('Código QR por pista: lleva directo al PIN de esa pista', async () => {
  await waitFor(() => estacion.stationState.matches.every((m) => m.qrSvg), 'QR generados');
  const [p1, p2] = estacion.stationState.matches;
  if (!p1.qrUrl) return { skip: 'este equipo no tiene red local' };
  assert.match(p1.qrUrl, /\/control\.html\?pista=pista-1$/);
  assert.match(p2.qrUrl, /\/control\.html\?pista=pista-2$/);
  assert.ok(p1.qrSvg.startsWith('<svg'));
});

// ── Aplicación de escritorio: el servidor con un adaptador de monitores SIMULADO ──

test('Escritorio: la estación ve los monitores y elige dónde va cada pantalla', async () => {
  const desktopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagemaster-desk-'));
  process.env.STAGEMASTER_DATA_DIR = desktopDir;
  process.env.STAGEMASTER_ADS_DIR  = ADS_DIR;

  const calls = [];
  let notify = () => {};
  const fakeDesktop = {
    onChange: (fn) => { notify = fn; },
    getState: () => ({
      monitors: [{ key: '1', label: 'Pantalla del portátil', width: 1920, height: 1080, primary: true },
                 { key: '2', label: 'Monitor 2', width: 1280, height: 720, primary: false }],
      preferences: {}, assignments: { 'pantalla-1': calls.length ? 'window' : '2', 'pantalla-2': null },
      closed: [], adsFolder: ADS_DIR,
    }),
    setMonitor: (screenId, monitor) => { calls.push(['setMonitor', screenId, monitor]); notify(); },
    openScreen: (screenId) => calls.push(['openScreen', screenId]),
    openAdsFolder: () => calls.push(['openAdsFolder']),
  };

  const { startServer } = require('./index');
  const desktopPort = await getFreePort();
  const app = await startServer({ ports: [desktopPort], desktop: fakeDesktop, logHttp: false });
  const station = io(`http://localhost:${desktopPort}`, { auth: { role: 'station' }, forceNew: true });
  let state = null;
  station.on('stationState', (st) => { state = st; });
  try {
    await waitFor(() => state, 'estado de la estación (escritorio)');
    assert.strictEqual(state.desktop.monitors.length, 2);
    assert.strictEqual(state.desktop.assignments['pantalla-1'], '2');

    const ask = (ev, payload) => station.timeout(3000).emitWithAck(ev, payload);
    assert.ok((await ask('station:setMonitor', { screenId: 'pantalla-1', monitor: 'window' })).ok);
    assert.ok((await ask('station:openScreen', { screenId: 'pantalla-2' })).ok);
    assert.ok((await ask('station:openAdsFolder', {})).ok);
    assert.strictEqual((await ask('station:setMonitor', { screenId: 'pantalla-9', monitor: '2' })).code, 'UNKNOWN_SCREEN');
    assert.deepStrictEqual(calls, [['setMonitor', 'pantalla-1', 'window'], ['openScreen', 'pantalla-2'], ['openAdsFolder']]);
    await waitFor(() => state.desktop.assignments['pantalla-1'] === 'window', 'la estación recibe el cambio');
  } finally {
    station.close();
    await app.close();
    fs.rmSync(desktopDir, { recursive: true, force: true });
  }
});

test('Escritorio: un teléfono no puede cambiar monitores ni abrir carpetas', async () => {
  // Con el servidor normal la orden ya se rechaza por no ser estación (antes de mirar el escritorio)
  const res = await send(telefono1, 'station:setMonitor', { screenId: 'pantalla-1', monitor: 'window' });
  assert.strictEqual(res.code, 'FORBIDDEN');
});

// ─────────────────────────────────────────────────────────────────
// EJECUCIÓN
// ─────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n🔌  STAGEMASTER — INTEGRACIÓN (servidor real · estación · 2 árbitros · 2 pantallas)\n');

  try {
    PORT = await getFreePort();
    await startServer();
    await ejecutarPruebas();
  } catch (err) {
    console.log(`  ❌  Error preparando las pruebas: ${err.message}`);
    fallidas++;
  } finally {
    dispositivos.forEach((d) => d.socket.disconnect());
    await killServer();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(ADS_DIR, { recursive: true, force: true });
  }

  const total = pasadas + fallidas + omitidas;
  console.log('\n' + '─'.repeat(50));
  console.log(`TOTAL: ${total}  |  ✅ Pasadas: ${pasadas}  |  ❌ Fallidas: ${fallidas}${omitidas ? `  |  ⚪ Omitidas: ${omitidas}` : ''}`);
  console.log('─'.repeat(50));
  process.exit(fallidas > 0 ? 1 : 0);
})();
