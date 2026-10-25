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
 *     → socket.emit('pointA')
 *       → index.js recibe el evento
 *         → matchManager.action('pointA')
 *           → engine.js calcula el nuevo estado
 *         → io.emit('matchUpdate', nuevoEstado)
 *           → iPhone actualiza su UI
 *           → Pantalla LED actualiza el marcador
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

/**
 * Emite el estado actual a todos los clientes conectados.
 * Se llama después de cada acción que cambia el estado.
 */
function broadcastState(state) {
  if (!state) return;
  io.emit('matchUpdate', state);
}

/**
 * Devuelve el número de clientes actualmente conectados.
 */
function getClientsCount() {
  return io.engine.clientsCount;
}

// ── Gestión de conexiones ─────────────────────────────────────────

io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;
  console.log(`[+] Conectado: ${socket.id} desde ${clientIp} | Total: ${getClientsCount()}`);

  // Al conectarse, enviar el estado actual (para reconexiones o llegada tardía)
  const state = matchManager.getState();
  if (state) {
    socket.emit('matchUpdate', state);
  }

  // Notificar al cliente que está conectado y cuántos hay
  socket.emit('serverConnected', {
    message:      'Conectado a StageMaster Server',
    clientsCount: getClientsCount(),
  });

  // Notificar a todos el nuevo conteo de clientes
  io.emit('clientsCount', getClientsCount());

  // ── Evento: Configurar e iniciar partido ───────────────────────
  // Recibe la configuración del formulario y crea el partido
  socket.on('setupMatch', (config) => {
    console.log(`[Event] setupMatch recibido de ${socket.id}`);
    try {
      const newState = matchManager.setup(config);
      broadcastState(newState);
    } catch (err) {
      console.error('[Error] setupMatch:', err.message);
      socket.emit('matchError', { message: err.message });
    }
  });

  // ── Eventos de puntuación ──────────────────────────────────────

  socket.on('pointA', () => {
    const newState = matchManager.action('pointA');
    broadcastState(newState);
  });

  socket.on('pointB', () => {
    const newState = matchManager.action('pointB');
    broadcastState(newState);
  });

  socket.on('undo', () => {
    const newState = matchManager.action('undo');
    broadcastState(newState);
  });

  socket.on('changeServer', () => {
    const newState = matchManager.action('changeServer');
    broadcastState(newState);
  });

  socket.on('finishMatch', () => {
    const newState = matchManager.action('finishMatch');
    broadcastState(newState);
  });

  // ── Evento: Reiniciar partido ──────────────────────────────────
  socket.on('resetMatch', () => {
    console.log(`[Event] resetMatch recibido de ${socket.id}`);
    const newState = matchManager.reset();
    broadcastState(newState);
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

server.listen(PORT, () => {
  // Obtener la IP local para mostrarla en consola
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIp = 'localhost';

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Buscar la IP IPv4 que no sea loopback
      if (net.family === 'IPv4' && !net.internal) {
        localIp = net.address;
        break;
      }
    }
    if (localIp !== 'localhost') break;
  }

  console.log('\n');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║         STAGEMASTER SERVER                ║');
  console.log('  ╠═══════════════════════════════════════════╣');
  console.log(`  ║  Puerto:     ${PORT}                          ║`);
  console.log(`  ║  Red local:  http://${localIp}:${PORT}      ║`);
  console.log('  ╠═══════════════════════════════════════════╣');
  console.log(`  ║  📱 iPhone:  http://${localIp}:${PORT}/control.html`);
  console.log(`  ║  🖥  LED:    http://${localIp}:${PORT}/score.html  `);
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('\n  Esperando conexiones...\n');
});
