'use strict';

/**
 * index.js — Servidor principal de StageMaster
 *
 * Responsabilidades:
 *   1. Servir los archivos estáticos (HTML, CSS, JS) del directorio public/
 *   2. Gestionar la comunicación en tiempo real con Socket.IO
 *   3. Recibir eventos del Panel de Control (iPhone)
 *   4. Emitir el estado actualizado a TODOS los clientes conectados
 *      (Panel de Control + Pantalla LED)
 *
 * Flujo de una acción:
 *
 *   iPhone (control.html)
 *     → socket.emit('pointA', { version }, ack)
 *       → index.js recibe el evento
 *         → matchManager.action('pointA', version)
 *           → engine.js calcula el nuevo estado
 *         → io.emit('matchUpdate', nuevoEstado)
 *           → iPhone actualiza su UI
 *           → Pantalla LED actualiza el marcador
 *         → ack({ ok: true })  ← el iPhone desbloquea sus botones
 *
 * Relación con otros archivos:
 *   ← matchManager.js gestiona el estado del partido
 *   → public/control.html  (cliente operador)
 *   → public/score.html    (cliente pantalla LED)
 */

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const matchManager = require('./matchManager');

// ─────────────────────────────────────────────────────────────────
// CONFIGURACIÓN DEL SERVIDOR
// ─────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);   // HTTP server que comparte puerto con Socket.IO
const io     = new Server(server, {
  // Permite conexiones desde cualquier origen (necesario en red local)
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────────
// ARCHIVOS ESTÁTICOS
// Express sirve todos los archivos de la carpeta public/
// Así, http://IP:3000/control.html entrega public/control.html
// ─────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..', 'public')));

// Ruta raíz → redirige al panel de control
app.get('/', (req, res) => {
  res.redirect('/control.html');
});

// ─────────────────────────────────────────────────────────────────
// SOCKET.IO — COMUNICACIÓN EN TIEMPO REAL
// ─────────────────────────────────────────────────────────────────

/** Acciones de partido que el panel puede enviar (lista blanca) */
const MATCH_ACTIONS = ['pointA', 'pointB', 'undo', 'changeServer', 'finishMatch'];

/**
 * Emite el estado actual a TODOS los clientes conectados
 * (panel de control + pantalla LED).
 */
function broadcastState(state) {
  io.emit('matchUpdate', state);
}

/**
 * Devuelve el número de clientes actualmente conectados.
 */
function getClientsCount() {
  return io.engine.clientsCount;
}

/**
 * Ejecuta una petición del panel y responde con un acuse de recibo (ack).
 *
 *   ✓ Éxito: emite el nuevo estado a todos y responde { ok: true }
 *   ✗ Error: responde { ok: false, code, message, state } solo a quien la envió
 *            (state = estado actual, para que el panel se resincronice)
 *
 * @param {Socket}   socket    - Cliente que envió la petición
 * @param {string}   eventName - Nombre del evento (para los logs)
 * @param {Function} operation - Llama a matchManager y devuelve el nuevo estado
 * @param {Function} [ack]     - Callback de Socket.IO para responder al cliente
 */
function handleRequest(socket, eventName, operation, ack) {
  // El cliente puede no enviar callback (ej. herramientas de prueba)
  const reply = typeof ack === 'function' ? ack : () => {};

  try {
    const newState = operation();
    broadcastState(newState);
    reply({ ok: true });
  } catch (err) {
    console.warn(`[Event] ${eventName} rechazado (${socket.id}): ${err.message}`);
    reply({
      ok:      false,
      code:    err.code || 'SERVER_ERROR',
      message: err.code ? err.message : 'Error interno del servidor',
      state:   matchManager.getState(),
    });
  }
}

/** Lee la versión enviada por el panel: socket.emit('pointA', { version: 12 }, ack) */
function versionOf(payload) {
  return payload && typeof payload === 'object' ? payload.version : undefined;
}

// ── Gestión de conexiones ─────────────────────────────────────────

io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;
  console.log(`[+] Conectado: ${socket.id} desde ${clientIp} | Total: ${getClientsCount()}`);

  // Al conectarse (o reconectarse), enviar SIEMPRE el estado actual.
  // null significa "no hay partido": la LED muestra la espera y el panel
  // vuelve al setup (ej. si el servidor se reinició).
  socket.emit('matchUpdate', matchManager.getState());

  // Notificar al cliente que está conectado y cuántos hay
  socket.emit('serverConnected', {
    message:      'Conectado a StageMaster Server',
    clientsCount: getClientsCount(),
  });

  // Notificar a todos el nuevo conteo de clientes
  io.emit('clientsCount', getClientsCount());

  // ── Evento: Configurar e iniciar partido ───────────────────────
  // payload: { config: {...}, force: boolean }
  //   force = true → el operador confirmó reemplazar un partido en curso
  socket.on('setupMatch', (payload, ack) => {
    console.log(`[Event] setupMatch recibido de ${socket.id}`);
    const { config, force } = payload && typeof payload === 'object' ? payload : {};
    handleRequest(socket, 'setupMatch', () => matchManager.setup(config, { force: force === true }), ack);
  });

  // ── Eventos del partido (puntos, undo, saque, finalizar) ───────
  // payload: { version: number }
  MATCH_ACTIONS.forEach((actionName) => {
    socket.on(actionName, (payload, ack) => {
      handleRequest(socket, actionName, () => matchManager.action(actionName, versionOf(payload)), ack);
    });
  });

  // ── Evento: Reiniciar partido ──────────────────────────────────
  socket.on('resetMatch', (payload, ack) => {
    console.log(`[Event] resetMatch recibido de ${socket.id}`);
    handleRequest(socket, 'resetMatch', () => matchManager.reset(versionOf(payload)), ack);
  });

  // ── Desconexión ───────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`[-] Desconectado: ${socket.id} | Razón: ${reason} | Restantes: ${getClientsCount()}`);
    // Notificar a los demás el nuevo conteo
    io.emit('clientsCount', getClientsCount());
  });
});

// ─────────────────────────────────────────────────────────────────
// ARRANQUE DEL SERVIDOR
// ─────────────────────────────────────────────────────────────────

/**
 * Devuelve todas las IPv4 de la red local de este PC, con el nombre del
 * adaptador. Un PC con Windows suele tener varias (Wi-Fi, Ethernet y
 * adaptadores virtuales de Hyper-V, WSL, VirtualBox o VPN): hay que usar
 * la del adaptador conectado a la misma red que el iPhone.
 */
function getLocalAddresses() {
  const { networkInterfaces } = require('os');
  const nets      = networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // IPv4 que no sea loopback (127.0.0.1)
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ name, address: net.address });
      }
    }
  }
  return addresses;
}

server.listen(PORT, () => {
  const addresses = getLocalAddresses();

  console.log('\n');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║         STAGEMASTER SERVER                ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log(`\n  Puerto: ${PORT}`);

  if (addresses.length === 0) {
    console.log('\n  ⚠ No se detectó ninguna red. Conecta el PC al Wi-Fi o al router.');
    console.log(`  Solo en este PC: http://localhost:${PORT}/score.html`);
  }

  addresses.forEach(({ name, address }) => {
    console.log(`\n  Red "${name}":`);
    console.log(`    📱 iPhone:  http://${address}:${PORT}/control.html`);
    console.log(`    🖥  LED:     http://${address}:${PORT}/score.html`);
  });

  if (addresses.length > 1) {
    console.log('\n  ℹ Hay varias redes: usa la del adaptador Wi-Fi/Ethernet conectado');
    console.log('    al mismo router que el iPhone (normalmente empieza por 192.168.).');
  }

  console.log('\n  Esperando conexiones...\n');
});
