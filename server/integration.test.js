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
  socket.on('screenConfig', (cfg) => { device.screenConfig = cfg; });
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

test('Publicidad: la estación ve los archivos y los asigna a una pantalla en vivo', async () => {
  assert.deepStrictEqual(estacion.stationState.ads.banner.map((a) => a.name), ['patrocinador.png']);
  const res = await send(estacion, 'station:updateScreen', {
    screenId: 'pantalla-1', changes: { mode: 'scoreAds', adInterval: 8, ads: { banner: ['patrocinador.png'], fullscreen: ['promo.jpg'] } },
  });
  assert.ok(res.ok, res.message);
  await waitFor(() => pantalla1.screenConfig.ads.banner.length === 1, 'pantalla 1 con publicidad');
  assert.strictEqual(pantalla1.screenConfig.ads.banner[0].url, '/publicidad/banner/patrocinador.png');
  assert.strictEqual(pantalla1.screenConfig.adInterval, 8);

  const http = await fetch(`http://localhost:${PORT}/publicidad/banner/patrocinador.png`);
  assert.strictEqual(http.status, 200, 'El servidor sirve el archivo de publicidad');
});

test('Publicidad inexistente o modo inválido → INVALID_SCREEN_CONFIG', async () => {
  let res = await send(estacion, 'station:updateScreen', { screenId: 'pantalla-1', changes: { ads: { banner: ['no-existe.png'] } } });
  assert.strictEqual(res.code, 'INVALID_SCREEN_CONFIG');
  res = await send(estacion, 'station:updateScreen', { screenId: 'pantalla-1', changes: { mode: 'karaoke' } });
  assert.strictEqual(res.code, 'INVALID_SCREEN_CONFIG');
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
  assert.strictEqual(pantalla1.screenConfig.ads.banner.length, 1, 'La publicidad asignada se conserva');

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
