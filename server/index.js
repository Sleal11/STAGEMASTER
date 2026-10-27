'use strict';

/**
 * index.js — Arranque del servidor de StageMaster
 *
 * Responsabilidad: poner en marcha el sistema y nada más.
 *   1. Servir las páginas (public/) y la publicidad (publicidad/)
 *   2. Crear los partidos (core/matchRegistry.js) y las pantallas (core/screens.js)
 *   3. Conectar la comunicación en tiempo real (realtime/socketServer.js)
 *   4. Mostrar en consola las direcciones para los teléfonos
 *
 * Páginas:
 *   http://localhost:3000/station.html            Estación operadora (solo en el portátil)
 *   http://localhost:3000/score.html?pantalla=1   Pantalla 1 (score + publicidad)
 *   http://localhost:3000/score.html?pantalla=2   Pantalla 2
 *   http://IP-DEL-PORTÁTIL:3000/control.html      Teléfono del árbitro
 *
 * Flujo de una acción:
 *   Teléfono árbitro → socket 'matchAction' { matchId, action, version }
 *     → socketServer: ¿teléfono vinculado a ESE partido? → Match.applyAction()
 *       → engine.js calcula el nuevo estado → se guarda en disco
 *     → 'matchUpdate' SOLO a la sala de ese partido (teléfono + sus pantallas)
 *     → 'stationState' a la estación operadora
 */

const express = require('express');
const http    = require('http');
const path    = require('path');
const os      = require('os');
const { Server } = require('socket.io');

const { createMatchRegistry } = require('./core/matchRegistry');
const { createScreenManager } = require('./core/screens');
const { adsDir }              = require('./core/ads');
const { isLocalAddress }      = require('./core/auth');
const { attachSocketServer }  = require('./realtime/socketServer');

const PORT = Number(process.env.PORT) || 3000;

// 0.0.0.0 = escuchar en TODAS las redes del portátil (Wi-Fi, Ethernet...),
// imprescindible para que los teléfonos puedan entrar.
const HOST = process.env.HOST || '0.0.0.0';

// ─────────────────────────────────────────────────────────────────
// MÓDULOS DEL SISTEMA
// ─────────────────────────────────────────────────────────────────

const registry = createMatchRegistry();
const screens  = createScreenManager({ matchIds: registry.ids() });

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  // Al conectar/reconectar se reenvía el estado completo, así que no hace
  // falta recuperar mensajes perdidos; sí detectar rápido las caídas.
  pingInterval: 10000,
  pingTimeout:  8000,
});

attachSocketServer(io, { registry, screens, getNetworkInfo });

// ─────────────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────────────

// Registro de visitas: si abres una página y aquí NO aparece, la petición
// nunca llegó a este servidor (red, firewall u otro programa en el puerto).
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html') || req.path === '/health') {
    console.log(`[HTTP] ${req.method} ${req.path} ← ${req.ip}`);
  }
  next();
});

// La estación operadora solo se abre en el propio portátil
app.use('/station.html', (req, res, next) => {
  if (isLocalAddress(req.ip)) return next();
  res.status(403).type('text/plain; charset=utf-8')
    .send('La estación operadora solo puede abrirse en el portátil: http://localhost:' + PORT + '/station.html');
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/publicidad', express.static(adsDir()));

// Raíz: el portátil va a la estación; los teléfonos, al panel del árbitro
app.get('/', (req, res) => {
  res.redirect(isLocalAddress(req.ip) ? '/station.html' : '/control.html');
});

// Diagnóstico: comprobar desde cualquier dispositivo que llega al servidor
app.get('/health', (req, res) => {
  res.json({
    ok:      true,
    app:     'StageMaster',
    matches: registry.list().map((m) => ({ id: m.id, status: m.state ? m.state.status : 'empty', version: m.version })),
    clients: io.engine.clientsCount,
    yourIp:  req.ip,
  });
});

// ─────────────────────────────────────────────────────────────────
// RED
// ─────────────────────────────────────────────────────────────────

/**
 * Todas las IPv4 de la red local del portátil. Windows suele tener varias
 * (Wi-Fi, Ethernet y adaptadores virtuales de Hyper-V, WSL, VirtualBox o
 * VPN): los teléfonos deben usar la del adaptador conectado a su red.
 */
function getLocalAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addresses.push({ name, address: net.address });
    }
  }
  return addresses;
}

/** Datos de red que muestra la estación (dirección para los teléfonos) */
function getNetworkInfo() {
  return {
    port: PORT,
    addresses: getLocalAddresses().map(({ name, address }) => ({
      name,
      address,
      controlUrl: `http://${address}:${PORT}/control.html`,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────

// Puerto ocupado: mensaje claro (si no, el navegador hablaría con OTRO
// programa y mostraría errores como ERR_EMPTY_RESPONSE)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ❌ El puerto ${PORT} ya está en uso por otro programa.`);
    console.error('     - ¿Hay otra ventana con el servidor de StageMaster abierta? Ciérrala.');
    console.error(`     - Para ver qué programa lo usa (Windows): netstat -ano | findstr :${PORT}`);
    console.error('     - O arranca en otro puerto (PowerShell): $env:PORT=3001; node server/index.js\n');
  } else if (err.code === 'EACCES') {
    console.error(`\n  ❌ Sin permiso para usar el puerto ${PORT}. Prueba con otro, ej. 3001.\n`);
  } else {
    console.error('\n  ❌ No se pudo arrancar el servidor:', err.message, '\n');
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const addresses = getLocalAddresses();

  console.log('\n');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║         STAGEMASTER SERVER                ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log(`\n  Puerto: ${PORT}`);
  console.log(`\n  🖥  Estación operadora:  http://localhost:${PORT}/station.html`);
  console.log(`  📺 Pantalla 1:           http://localhost:${PORT}/score.html?pantalla=1`);
  console.log(`  📺 Pantalla 2:           http://localhost:${PORT}/score.html?pantalla=2`);

  if (addresses.length === 0) {
    console.log('\n  ⚠ No se detectó ninguna red. Conecta el portátil al Wi-Fi del evento.');
  }
  addresses.forEach(({ name, address }) => {
    console.log(`\n  📱 Teléfonos de árbitro (red "${name}"): http://${address}:${PORT}/control.html`);
  });
  if (addresses.length > 1) {
    console.log('\n  ℹ Hay varias redes: usa la del adaptador conectado al mismo Wi-Fi que');
    console.log('    los teléfonos (normalmente empieza por 192.168.).');
  }

  registry.list().forEach((match) => {
    console.log(`\n  🎾 ${match.label}: PIN ${match.pin}`);
  });

  console.log('\n  🩺 Diagnóstico: abre /health (ej. http://IP:' + PORT + '/health) desde un teléfono.');
  console.log('\n  Esperando conexiones...\n');
});
