'use strict';

/**
 * index.js — Arranque del servidor de StageMaster
 *
 * Responsabilidad: poner en marcha el sistema y nada más.
 *   1. Servir las páginas (public/) y la publicidad (y recibir la que sube la estación)
 *   2. Crear los partidos (core/matchRegistry.js) y las pantallas (core/screens.js)
 *   3. Conectar la comunicación en tiempo real (realtime/socketServer.js)
 *
 * Dos formas de arrancarlo:
 *   - Aplicación de escritorio (desktop/main.js): llama a startServer() con un
 *     "adaptador de escritorio" que gestiona los monitores y las ventanas.
 *   - Desarrollo: `npm start` (node server/index.js), sin ventanas propias:
 *     las páginas se abren en el navegador.
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
const { Server } = require('socket.io');

const { createMatchRegistry } = require('./core/matchRegistry');
const { createScreenManager } = require('./core/screens');
const { adsDir }              = require('./core/ads');
const { isLocalAddress }      = require('./core/auth');
const { getLocalAddresses }   = require('./core/network');
const { attachSocketServer }  = require('./realtime/socketServer');
const { createAdsRouter }     = require('./http/adsApi');
const { getBuildInfo }        = require('./core/buildInfo');

/** Puertos que se prueban en orden si el anterior está ocupado */
const DEFAULT_PORTS = [3000, 3001, 3002, 3003, 3004, 3005];

/**
 * Arranca el servidor.
 *
 * @param {Object}   [options]
 * @param {number[]} [options.ports]   - Puertos a probar en orden (el primero libre)
 * @param {string}   [options.host]    - 0.0.0.0 = todas las redes (necesario para los teléfonos)
 * @param {Object}   [options.desktop] - Adaptador de la aplicación de escritorio (monitores, carpetas)
 * @param {boolean}  [options.logHttp] - Mostrar en consola cada página abierta
 * @returns {Promise<{ port: number, close: Function }>}
 */
async function startServer({ ports = DEFAULT_PORTS, host = '0.0.0.0', desktop = null, logHttp = true } = {}) {
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

  let port = null;
  const getNetworkInfo = () => {
    const addresses = getLocalAddresses().map(({ name, address }) => ({
      name,
      address,
      baseUrl:    `http://${address}:${port}`,
      controlUrl: `http://${address}:${port}/control.html`,
    }));
    return { port, addresses, primary: addresses[0] || null };
  };

  const realtime = attachSocketServer(io, { registry, screens, getNetworkInfo, desktop });

  // ── HTTP ─────────────────────────────────────────────────────────

  // Registro de visitas: si abres una página y aquí NO aparece, la petición
  // nunca llegó a este servidor (red, firewall u otro programa en el puerto).
  if (logHttp) {
    app.use((req, res, next) => {
      if (req.path === '/' || req.path.endsWith('.html') || req.path === '/health') {
        console.log(`[HTTP] ${req.method} ${req.path} ← ${req.ip}`);
      }
      next();
    });
  }

  // La estación operadora solo se abre en el propio portátil
  app.use('/station.html', (req, res, next) => {
    if (isLocalAddress(req.ip)) return next();
    res.status(403).type('text/plain; charset=utf-8')
      .send('La estación operadora solo puede abrirse en el portátil donde funciona StageMaster.');
  });

  // Páginas de la app: nunca desde la caché. Así, al actualizar StageMaster,
  // la estación, las pantallas y los teléfonos cargan siempre la versión nueva.
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.set('Cache-Control', 'no-store'),
  }));
  // La publicidad son archivos que trae el operador: nunca se ejecuta nada de
  // ellos (un SVG con código se muestra como imagen, sin ejecutar su código)
  app.use('/publicidad', express.static(adsDir(), {
    setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'"),
  }));

  // Subir y borrar publicidad desde la estación (solo en el portátil)
  app.use('/api/publicidad', createAdsRouter({
    onChange:  () => realtime.refreshAds(),
    onRemoved: (category, name) => screens.forgetAd(category, name),
  }));

  // Raíz: el portátil va a la estación; los teléfonos, al panel del árbitro
  app.get('/', (req, res) => {
    res.redirect(isLocalAddress(req.ip) ? '/station.html' : '/control.html');
  });

  // Diagnóstico: comprobar desde cualquier dispositivo que llega al servidor
  app.get('/health', (req, res) => {
    res.json({
      ok:      true,
      app:     'StageMaster',
      build:   getBuildInfo(),
      matches: registry.list().map((m) => ({ id: m.id, status: m.state ? m.state.status : 'empty', version: m.version })),
      clients: io.engine.clientsCount,
      yourIp:  req.ip,
    });
  });

  // ── Escuchar en el primer puerto libre ───────────────────────────
  port = await listenOnFirstFreePort(server, ports, host);

  return {
    port,
    registry,
    getNetworkInfo,
    close: () => new Promise((resolve) => { io.close(); server.close(() => resolve()); }),
  };
}

/** Prueba los puertos en orden; si todos están ocupados, lanza un error claro */
async function listenOnFirstFreePort(server, ports, host) {
  for (const port of ports) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => { server.off('listening', onListening); reject(err); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      return port;
    } catch (err) {
      if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
      console.warn(`[Servidor] El puerto ${port} está ocupado; probando el siguiente...`);
    }
  }
  const err = new Error(`Los puertos ${ports.join(', ')} están ocupados por otros programas.`);
  err.code = 'NO_FREE_PORT';
  throw err;
}

// ─────────────────────────────────────────────────────────────────
// ARRANQUE DESDE LA CONSOLA (npm start)
// ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  const fixedPort = Number(process.env.PORT);

  startServer({ ports: fixedPort ? [fixedPort] : DEFAULT_PORTS, host: process.env.HOST || '0.0.0.0' })
    .then(({ port, registry, getNetworkInfo }) => {
      const { addresses } = getNetworkInfo();

      console.log('\n');
      console.log('  ╔═══════════════════════════════════════════╗');
      console.log('  ║         STAGEMASTER SERVER                ║');
      console.log('  ╚═══════════════════════════════════════════╝');
      console.log(`\n  🖥  Estación operadora:  http://localhost:${port}/station.html`);
      console.log(`  📺 Pantalla 1:           http://localhost:${port}/score.html?pantalla=1`);
      console.log(`  📺 Pantalla 2:           http://localhost:${port}/score.html?pantalla=2`);

      if (addresses.length === 0) {
        console.log('\n  ⚠ No se detectó ninguna red. Conecta el portátil al Wi-Fi del evento.');
      }
      addresses.forEach(({ name, controlUrl }, index) => {
        console.log(`\n  📱 Teléfonos de árbitro (red "${name}")${index === 0 ? '' : ' [alternativa]'}: ${controlUrl}`);
      });
      registry.list().forEach((match) => console.log(`\n  🎾 ${match.label}: PIN ${match.pin}`));

      console.log('\n  🩺 Diagnóstico: abre /health desde un teléfono.');
      console.log('\n  Esperando conexiones...\n');
    })
    .catch((err) => {
      if (err.code === 'NO_FREE_PORT' || err.code === 'EADDRINUSE') {
        console.error(`\n  ❌ ${err.message}`);
        console.error('     - ¿Hay otra ventana con StageMaster abierta? Ciérrala.');
        console.error('     - Para ver qué programa usa el puerto (Windows): netstat -ano | findstr :3000\n');
      } else {
        console.error('\n  ❌ No se pudo arrancar el servidor:', err.message, '\n');
      }
      process.exit(1);
    });
}

module.exports = { startServer, DEFAULT_PORTS };
