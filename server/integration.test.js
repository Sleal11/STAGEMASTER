'use strict';

/**
 * ─────────────────────────────────────────────────────────────────
 * STAGEMASTER — PRUEBAS DE INTEGRACIÓN (SISTEMA COMPLETO)
 * Archivo: server/integration.test.js
 *
 * Ejecutar con: node server/integration.test.js   (o npm test)
 *
 * A diferencia de las otras pruebas, aquí NO se llama a funciones
 * sueltas: se arranca el servidor REAL (server/index.js) como un
 * proceso aparte y se conectan "dispositivos virtuales" por Socket.IO,
 * exactamente como lo hacen el iPhone (control) y el PC (pantalla LED).
 *
 * Simula situaciones de un evento real:
 *   - Partido completo de principio a fin
 *   - Doble pulsación y dos iPhones a la vez
 *   - Pérdida de conexión del iPhone y reconexión
 *   - Reinicio del servidor en pleno partido
 *   - Uso intensivo (cientos de puntos) midiendo la latencia
 *
 * Usa una carpeta de datos TEMPORAL y un puerto libre: no interfiere
 * con un servidor que esté funcionando ni con data/match.json.
 * ─────────────────────────────────────────────────────────────────
 */

const assert   = require('assert');
const fs       = require('fs');
const net      = require('net');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');
const { io }   = require('socket.io-client');

// ─────────────────────────────────────────────────────────────────
// MINI FRAMEWORK DE PRUEBAS (versión asíncrona)
// ─────────────────────────────────────────────────────────────────

const pruebas = [];
let pasadas   = 0;
let fallidas  = 0;

/** Registra una prueba; se ejecutan en orden al final del archivo */
function test(nombre, fn) {
  pruebas.push({ nombre, fn });
}

async function ejecutarPruebas() {
  for (const { nombre, fn } of pruebas) {
    try {
      const detalle = await fn();
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
let PORT;
let serverProcess = null;

/** Pide al sistema operativo un puerto libre */
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

/** Arranca server/index.js y espera a que diga "Esperando conexiones" */
function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), STAGEMASTER_DATA_DIR: DATA_DIR },
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

/** Detiene el servidor como si se cerrara la ventana de golpe */
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
 * Conecta un dispositivo y guarda el último estado recibido.
 * Reconexión rápida (100-300 ms) para que las pruebas no tarden.
 */
function connectDevice(nombre) {
  return new Promise((resolve, reject) => {
    const socket = io(`http://localhost:${PORT}`, {
      reconnectionDelay:    100,
      reconnectionDelayMax: 300,
      forceNew:             true,
    });
    const device = { nombre, socket, state: undefined, updates: 0 };

    socket.on('matchUpdate', (state) => {
      device.state = state;
      device.updates++;
    });
    socket.once('connect_error', reject);
    // El servidor envía 'matchUpdate' justo al conectar: esperamos a tenerlo
    socket.once('matchUpdate', () => resolve(device));

    dispositivos.push(device);
  });
}

/** Envía una petición como lo hace control.js y devuelve la respuesta (ack) */
function send(device, eventName, payload) {
  return device.socket.timeout(3000).emitWithAck(eventName, payload);
}

/** Envía una acción del partido con la versión que ve el dispositivo */
function action(device, actionName) {
  return send(device, actionName, { version: device.state.version });
}

/** Espera hasta que se cumpla una condición (o falla tras el tiempo dado) */
async function waitFor(condicion, descripcion, timeoutMs = 3000) {
  const inicio = Date.now();
  while (!condicion()) {
    if (Date.now() - inicio > timeoutMs) throw new Error(`Tiempo agotado esperando: ${descripcion}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function config(overrides = {}) {
  return {
    nameA: 'Galán / Lebrón', nameB: 'Coello / Tapia',
    gamesPerSet: 6, totalSets: 3,
    scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak',
    initialServer: 'A',
    ...overrides,
  };
}

/** Inicia un partido nuevo (reemplazando el que haya) y espera a que la LED lo reciba */
async function nuevoPartido(control, led, overrides) {
  const res = await send(control, 'setupMatch', { config: config(overrides), force: true });
  assert.ok(res.ok, 'setupMatch debería responder ok: ' + res.message);
  await waitFor(() => led.state && led.state.version === control.state.version, 'LED sincronizada');
}

// ─────────────────────────────────────────────────────────────────
// LAS PRUEBAS
// ─────────────────────────────────────────────────────────────────

let iphone, iphone2, led;

test('Arranque: la LED recibe "sin partido" (null) al conectarse', async () => {
  led    = await connectDevice('LED');
  iphone = await connectDevice('iPhone');
  assert.strictEqual(led.state, null);
});

test('/health responde desde la red', async () => {
  const res  = await fetch(`http://localhost:${PORT}/health`);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.app, 'StageMaster');
});

test('Iniciar partido desde el iPhone → la LED lo recibe', async () => {
  await nuevoPartido(iphone, led);
  assert.strictEqual(led.state.players.A.name, 'Galán / Lebrón');
  assert.strictEqual(led.state.status, 'playing');
});

test('El estado que viaja por la red NO lleva historial y es ligero', async () => {
  for (let i = 0; i < 30; i++) await action(iphone, i % 2 ? 'pointA' : 'pointB');
  await waitFor(() => led.state.version === iphone.state.version, 'LED sincronizada');
  const bytes = Buffer.byteLength(JSON.stringify(led.state));
  assert.strictEqual(led.state.history, undefined);
  assert.ok(bytes < 2000, `El estado ocupa ${bytes} bytes`);
  return `${bytes} bytes por actualización`;
});

test('Partido COMPLETO (best-of-3 con Súper Tie Break): LED y iPhone terminan idénticos', async () => {
  await nuevoPartido(iphone, led);
  const game = (p) => Array(4).fill('point' + p);
  const set  = (p) => Array(6).fill(0).flatMap(() => game(p));
  const secuencia = [...set('A'), ...set('B'), ...Array(10).fill('pointA')]; // 6-0, 0-6, STB 10-0

  for (const accion of secuencia) {
    const res = await action(iphone, accion);
    assert.ok(res.ok, `${accion} rechazado: ${res.message}`);
  }
  await waitFor(() => led.state.status === 'finished', 'fin del partido en la LED');

  assert.strictEqual(led.state.winner, 'A');
  assert.deepStrictEqual(led.state.setScores[2], { A: 1, B: 0, tiebreak: { A: 10, B: 0 }, superTiebreak: true });
  assert.deepStrictEqual(led.state, iphone.state, 'LED e iPhone deben tener exactamente el mismo estado');
  return `${secuencia.length} puntos`;
});

test('Doble pulsación: 3 toques simultáneos con la misma versión → 1 solo punto', async () => {
  await nuevoPartido(iphone, led);
  const version = iphone.state.version;
  const respuestas = await Promise.all([1, 2, 3].map(() => send(iphone, 'pointA', { version })));

  assert.strictEqual(respuestas.filter((r) => r.ok).length, 1, 'Solo un toque debe aplicarse');
  assert.ok(respuestas.filter((r) => !r.ok).every((r) => r.code === 'STALE_VERSION'));
  await waitFor(() => led.state.version === version + 1, 'LED sincronizada');
  assert.strictEqual(led.state.players.A.points, 15);
});

test('Dos iPhones a la vez: ambos ven siempre lo mismo y no se pisan', async () => {
  iphone2 = await connectDevice('iPhone 2');
  assert.deepStrictEqual(iphone2.state, iphone.state, 'El 2º iPhone entra viendo el partido actual');

  // Ambos pulsan "a la vez" basándose en la misma versión
  const version = iphone.state.version;
  const [r1, r2] = await Promise.all([
    send(iphone,  'pointB', { version }),
    send(iphone2, 'pointA', { version }),
  ]);
  assert.strictEqual([r1, r2].filter((r) => r.ok).length, 1, 'Solo una de las dos acciones se aplica');
  await waitFor(() => iphone.state.version === iphone2.state.version &&
                      led.state.version === iphone.state.version, 'los 3 dispositivos sincronizados');
  assert.deepStrictEqual(iphone2.state, led.state);
});

test('Iniciar partido sin confirmar con otro en curso → se rechaza y la LED no cambia', async () => {
  const antes = led.state.version;
  const res   = await send(iphone2, 'setupMatch', { config: config({ nameA: 'Otro' }) });
  assert.strictEqual(res.code, 'MATCH_IN_PROGRESS');
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(led.state.version, antes);
});

test('Configuración manipulada (ej. 2 sets) → el servidor la rechaza', async () => {
  const res = await send(iphone, 'setupMatch', { config: config({ totalSets: 2 }), force: true });
  assert.strictEqual(res.code, 'INVALID_CONFIG');
});

test('El iPhone pierde la conexión, se suman puntos desde otro y al volver se resincroniza', async () => {
  iphone.socket.disconnect();
  await action(iphone2, 'pointA');
  await action(iphone2, 'pointA');

  iphone.socket.connect();
  await waitFor(() => iphone.state.version === iphone2.state.version, 'iPhone resincronizado al reconectar');
  assert.deepStrictEqual(iphone.state, led.state);
});

test('REINICIO DEL SERVIDOR en pleno partido: todos reconectan y el marcador sigue igual', async () => {
  const antes = JSON.parse(JSON.stringify(led.state));

  await killServer();
  await waitFor(() => !led.socket.connected && !iphone.socket.connected, 'dispositivos desconectados');
  await startServer();

  await waitFor(() => led.socket.connected && iphone.socket.connected && iphone2.socket.connected,
    'reconexión automática de los 3 dispositivos', 6000);
  await waitFor(() => led.updates > 0 && led.state && led.state.version === antes.version, 'estado recuperado');
  assert.deepStrictEqual(led.state, antes, 'El marcador debe ser idéntico tras el reinicio');

  // Y se puede seguir jugando sin recargar nada
  const res = await action(iphone, 'pointB');
  assert.ok(res.ok, res.message);
  await waitFor(() => led.state.version === antes.version + 1, 'punto tras el reinicio');
});

test('Deshacer tras el reinicio del servidor (el historial también se guardó)', async () => {
  const puntosB = led.state.players.B.points;
  const res = await action(iphone, 'undo');
  assert.ok(res.ok, res.message);
  await waitFor(() => led.state.players.B.points !== puntosB, 'undo aplicado');
});

test('Uso intensivo: hasta 500 acciones seguidas (partido a 5 sets), LED siempre sincronizada', async () => {
  await nuevoPartido(iphone, led, { scoringSystem: 'starPoint', tiebreakType: 'tiebreak', totalSets: 5 });
  const tiempos = [];
  let semilla = 7;
  const aleatorio = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (let i = 0; i < 500 && iphone.state.status === 'playing'; i++) {
    const r = aleatorio();
    const accion = r < 0.47 ? 'pointA' : r < 0.94 ? 'pointB' : r < 0.98 ? 'undo' : 'changeServer';
    const inicio = process.hrtime.bigint();
    const res = await action(iphone, accion);
    tiempos.push(Number(process.hrtime.bigint() - inicio) / 1e6);
    assert.ok(res.ok, `${accion} rechazado: ${res.message}`);
  }
  await waitFor(() => led.state.version === iphone.state.version, 'LED sincronizada al final');
  assert.deepStrictEqual(led.state, iphone.state);

  tiempos.sort((a, b) => a - b);
  const media = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
  const p99   = tiempos[Math.floor(tiempos.length * 0.99)];
  assert.ok(p99 < 250, `Respuesta demasiado lenta: p99 = ${p99.toFixed(1)} ms`);
  return `${tiempos.length} acciones · media ${media.toFixed(1)} ms · p99 ${p99.toFixed(1)} ms`;
});

// ─────────────────────────────────────────────────────────────────
// EJECUCIÓN
// ─────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n🔌  STAGEMASTER — PRUEBAS DE INTEGRACIÓN (servidor real + dispositivos virtuales)\n');

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
  }

  const total = pasadas + fallidas;
  console.log('\n' + '─'.repeat(50));
  console.log(`TOTAL: ${total}  |  ✅ Pasadas: ${pasadas}  |  ❌ Fallidas: ${fallidas}`);
  console.log('─'.repeat(50));
  process.exit(fallidas > 0 ? 1 : 0);
})();
