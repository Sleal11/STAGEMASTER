'use strict';

/**
 * socketServer.js — Comunicación en tiempo real (Socket.IO)
 *
 * Responsabilidad: conectar dispositivos con partidos y pantallas, decidir
 * QUIÉN puede hacer QUÉ y enviar cada actualización SOLO a quien corresponde.
 *
 * ROLES (se indican al conectar: io({ auth: { role, ... } }))
 *   station     Estación operadora (station.html). Solo desde localhost.
 *               Configura partidos, pantallas y publicidad; ve todo.
 *   controller  Teléfono del árbitro (control.html). Controla UN partido,
 *               al que se vincula con el PIN de la pista (token).
 *   display     Pantalla de score/publicidad (score.html?pantalla=N).
 *               Solo lectura y solo desde localhost (van por cable al portátil).
 *
 * SALAS (aislamiento entre partidos)
 *   match:<id>   Teléfono y pantallas de ese partido → reciben sus 'matchUpdate'
 *   screen:<id>  Ventanas de una pantalla → reciben 'screenConfig' e 'identify'
 *   station      Estación → recibe 'stationState' (resumen de todo)
 *
 * EVENTOS cliente → servidor (todos responden con ack { ok, ... } o
 * { ok: false, code, message, state }):
 *   listCourts                                      cualquiera
 *   pair { matchId, pin, deviceName, force }        teléfono
 *   unpair                                          teléfono
 *   setupMatch { matchId, config, force }           teléfono vinculado / estación
 *   matchAction { matchId, action, version }        teléfono vinculado / estación
 *   resetMatch { matchId, version }                 teléfono vinculado / estación
 *   station:newPin { matchId }                      estación
 *   station:unpair { matchId }                      estación
 *   station:updateScreen { screenId, changes }      estación
 *   station:identify { screenId }                   estación
 *   station:refreshAds                              estación
 *   station:setMonitor { screenId, monitor }        estación (solo aplicación de escritorio)
 *   station:openScreen { screenId }                 estación (solo aplicación de escritorio)
 *   station:openAdsFolder                           estación (solo aplicación de escritorio)
 *   display:report { viewport, renderedMatchId, renderedVersion, adErrors }   pantalla
 *
 * EVENTOS servidor → cliente:
 *   matchUpdate { matchId, state }                  sala del partido
 *   controllerSession { matchId, label, color }     teléfono vinculado
 *   controllerRevoked { reason, message }           teléfono que pierde el permiso
 *   screenConfig { ... }                            pantalla
 *   identify { label }                              pantalla
 *   stationState { matches, screens, ads, network } estación
 */

const { appError }      = require('../core/errors');
const { MATCH_ACTIONS } = require('../core/Match');
const auth              = require('../core/auth');
const ads               = require('../core/ads');
const { getQrSvg }      = require('../core/network');

/** Tiempo tras el que una pantalla que no ha dibujado la última versión se considera desincronizada */
const SYNC_TOLERANCE_MS = 2000;

/**
 * @param {Server} io
 * @param {Object} deps
 * @param {Object} deps.registry  - core/matchRegistry.js
 * @param {Object} deps.screens   - core/screens.js
 * @param {Function} deps.getNetworkInfo - Direcciones del portátil (para la estación)
 * @param {Object}  [deps.desktop] - Adaptador de la aplicación de escritorio (monitores y
 *                                   carpetas). null cuando se arranca con `npm start`.
 */
function attachSocketServer(io, { registry, screens, getNetworkInfo, desktop = null }) {
  const pinGuard = auth.createPinGuard();

  // La aplicación de escritorio avisa cuando cambian los monitores o las ventanas
  if (desktop) desktop.onChange(() => scheduleStationState());

  // Teléfonos conectados por partido: matchId → { sockets: Set, lastSeen }
  const controllerPresence = new Map(registry.ids().map((id) => [id, { sockets: new Set(), lastSeen: null }]));

  // ─────────────────────────────────────────────────────────────
  // IDENTIFICACIÓN DEL ROL (antes de aceptar la conexión)
  // ─────────────────────────────────────────────────────────────

  io.use((socket, next) => {
    const params = socket.handshake.auth || {};
    const role   = ['station', 'display', 'controller'].includes(params.role) ? params.role : 'controller';
    socket.data.role = role;

    if (role === 'station' && !auth.isLocalAddress(socket.handshake.address)) {
      return next(connectionError('STATION_LOCAL_ONLY',
        'La estación operadora solo puede abrirse en el propio portátil (http://localhost:3000)'));
    }
    if (role === 'display') {
      // Las pantallas van por cable al portátil: solo se aceptan desde localhost
      // (así ningún dispositivo de la red puede hacerse pasar por una pantalla).
      // STAGEMASTER_REMOTE_DISPLAYS=1 lo permite si algún día se usa una pantalla en otro equipo.
      if (!auth.isLocalAddress(socket.handshake.address) && process.env.STAGEMASTER_REMOTE_DISPLAYS !== '1') {
        return next(connectionError('DISPLAY_LOCAL_ONLY',
          'Las pantallas se abren en el portátil (http://localhost:3000/score.html?pantalla=N)'));
      }
      if (!screens.has(params.screenId)) {
        return next(connectionError('UNKNOWN_SCREEN', `Pantalla desconocida: ${params.screenId}`));
      }
      socket.data.screenId = params.screenId;
    }
    if (role === 'controller' && typeof params.token === 'string') {
      socket.data.token = params.token;
    }
    next();
  });

  io.on('connection', (socket) => {
    const { role } = socket.data;
    console.log(`[+] ${roleLabel(socket)} conectado (${socket.handshake.address})`);

    if (role === 'station')    onStationConnected(socket);
    if (role === 'display')    onDisplayConnected(socket);
    if (role === 'controller') onControllerConnected(socket);

    // ── Eventos comunes ──────────────────────────────────────────
    handle(socket, 'listCourts', () => ({ courts: registry.list().map(courtSummary) }));

    // ── Marcador (teléfono vinculado o estación) ─────────────────
    handle(socket, 'setupMatch', ({ matchId, config, force } = {}) => {
      const match = authorizeMatch(socket, matchId);
      match.setup(config, { force: force === true });
      publishMatch(match);
    });

    handle(socket, 'matchAction', ({ matchId, action, version } = {}) => {
      if (!MATCH_ACTIONS.includes(action)) throw appError('INVALID_ACTION', `Acción no permitida: ${action}`);
      const match = authorizeMatch(socket, matchId);
      match.applyAction(action, version);
      publishMatch(match);
    });

    handle(socket, 'resetMatch', ({ matchId, version } = {}) => {
      const match = authorizeMatch(socket, matchId);
      match.reset(version);
      publishMatch(match);
    });

    // ── Teléfono: vincular / desvincular ─────────────────────────
    handle(socket, 'pair', (payload) => pairController(socket, payload));

    handle(socket, 'unpair', () => {
      const { matchId, token } = socket.data;
      if (matchId && registry.get(matchId).verifyToken(token)) {
        registry.get(matchId).unpairController();
      }
      unbindController(socket);
      scheduleStationState();
    });

    // ── Estación operadora ───────────────────────────────────────
    handle(socket, 'station:newPin', ({ matchId } = {}) => {
      requireStation(socket);
      registry.get(matchId).regeneratePin();
      scheduleStationState();
    });

    handle(socket, 'station:unpair', ({ matchId } = {}) => {
      requireStation(socket);
      registry.get(matchId).unpairController();
      revokeControllers(matchId, 'unpaired', 'La estación operadora desvinculó este teléfono.');
      scheduleStationState();
    });

    handle(socket, 'station:updateScreen', ({ screenId, changes } = {}) => {
      requireStation(socket);
      const { config, previousMatchId } = screens.update(screenId, changes, ads.listAds());
      if (config.matchId !== previousMatchId) {
        // La pantalla pasa a mostrar otro partido: cambia de sala
        io.in(`screen:${screenId}`).socketsLeave(`match:${previousMatchId}`);
        io.in(`screen:${screenId}`).socketsJoin(`match:${config.matchId}`);
      }
      pushScreenConfig(screenId);
      scheduleStationState();
    });

    handle(socket, 'station:identify', ({ screenId } = {}) => {
      requireStation(socket);
      const { label } = screens.get(screenId);
      io.to(`screen:${screenId}`).emit('identify', { label });
    });

    handle(socket, 'station:refreshAds', () => {
      requireStation(socket);
      screens.list().forEach((screen) => pushScreenConfig(screen.id));
      scheduleStationState();
      return { ads: ads.listAds() };
    });

    // ── Aplicación de escritorio: monitores y carpeta de publicidad ──
    handle(socket, 'station:setMonitor', ({ screenId, monitor } = {}) => {
      requireStation(socket);
      requireDesktop();
      screens.get(screenId);   // UNKNOWN_SCREEN si no existe
      desktop.setMonitor(screenId, monitor);
      scheduleStationState();
    });

    handle(socket, 'station:openScreen', ({ screenId } = {}) => {
      requireStation(socket);
      requireDesktop();
      screens.get(screenId);
      desktop.openScreen(screenId);
    });

    handle(socket, 'station:openAdsFolder', () => {
      requireStation(socket);
      requireDesktop();
      desktop.openAdsFolder();
    });

    // ── Pantalla: informe tras dibujar ───────────────────────────
    socket.on('display:report', (data) => {
      if (socket.data.role !== 'display') return;
      screens.report(socket.data.screenId, socket.id, data);
      scheduleStationState();
    });

    socket.on('disconnect', (reason) => {
      console.log(`[-] ${roleLabel(socket)} desconectado (${reason})`);
      if (role === 'display') screens.detach(socket.data.screenId, socket.id);
      if (role === 'controller') unbindController(socket);
      scheduleStationState();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CONEXIÓN DE CADA ROL
  // ─────────────────────────────────────────────────────────────

  function onStationConnected(socket) {
    socket.join('station');
    socket.emit('stationState', buildStationState());
  }

  function onDisplayConnected(socket) {
    const { screenId } = socket.data;
    const config = screens.get(screenId);
    screens.attach(screenId, socket.id);
    socket.join(`screen:${screenId}`);
    socket.join(`match:${config.matchId}`);
    socket.emit('screenConfig', buildScreenConfig(screenId));
    socket.emit('matchUpdate', matchPayload(registry.get(config.matchId)));
    scheduleStationState();
  }

  function onControllerConnected(socket) {
    const { token } = socket.data;
    if (!token) return;   // Teléfono sin vincular: verá la pantalla de vinculación

    const match = registry.list().find((m) => m.verifyToken(token));
    if (!match) {
      // El token ya no vale (otro teléfono lo reemplazó o la estación lo desvinculó)
      socket.data.token = undefined;
      socket.emit('controllerRevoked', {
        reason:  'invalid',
        message: 'Este teléfono ya no está vinculado a ninguna pista. Vuelve a introducir el PIN.',
      });
      return;
    }
    bindController(socket, match);
  }

  // ─────────────────────────────────────────────────────────────
  // TELÉFONOS: VINCULACIÓN Y PERMISOS
  // ─────────────────────────────────────────────────────────────

  function pairController(socket, { matchId, pin, deviceName, force } = {}) {
    if (socket.data.role !== 'controller') {
      throw appError('FORBIDDEN', 'Solo un teléfono árbitro puede vincularse a una pista');
    }
    const ip = socket.handshake.address;
    pinGuard.check(ip);

    const match = registry.get(matchId);
    if (!match.checkPin(pin)) {
      const left = pinGuard.fail(ip);
      throw appError('INVALID_PIN', left > 0
        ? `PIN incorrecto para ${match.label}. Te quedan ${left} intento(s).`
        : 'PIN incorrecto. Demasiados intentos: espera un minuto.');
    }
    pinGuard.success(ip);

    // ¿Hay OTRO teléfono controlando ahora mismo esta pista?
    const others = [...controllerPresence.get(match.id).sockets].filter((id) => id !== socket.id);
    if (match.controller && others.length > 0 && force !== true) {
      throw appError('CONTROLLER_ACTIVE',
        `${match.label} ya tiene un teléfono conectado (${match.controller.deviceName}). ¿Quieres reemplazarlo?`);
    }

    // Si este teléfono controlaba otra pista, la libera
    if (socket.data.matchId && socket.data.matchId !== match.id) {
      const previous = registry.get(socket.data.matchId);
      if (previous.verifyToken(socket.data.token)) previous.unpairController();
      unbindController(socket);
    }

    revokeControllers(match.id, 'replaced', `Otro teléfono ha pasado a controlar ${match.label}.`, socket.id);
    const token = match.pairController(deviceName);
    socket.data.token = token;
    bindController(socket, match);

    return { token, matchId: match.id, label: match.label, color: match.color };
  }

  /** Asocia la conexión de un teléfono a su partido */
  function bindController(socket, match) {
    socket.data.matchId = match.id;
    socket.join(`match:${match.id}`);
    controllerPresence.get(match.id).sockets.add(socket.id);
    socket.emit('controllerSession', { matchId: match.id, label: match.label, color: match.color });
    socket.emit('matchUpdate', matchPayload(match));
    scheduleStationState();
  }

  function unbindController(socket) {
    const { matchId } = socket.data;
    if (!matchId) return;
    const presence = controllerPresence.get(matchId);
    if (presence.sockets.delete(socket.id)) presence.lastSeen = Date.now();
    socket.leave(`match:${matchId}`);
    socket.data.matchId = undefined;
  }

  /** Retira el permiso a los teléfonos conectados de una pista (excepto exceptSocketId) */
  function revokeControllers(matchId, reason, message, exceptSocketId) {
    [...controllerPresence.get(matchId).sockets].forEach((socketId) => {
      if (socketId === exceptSocketId) return;
      const target = io.sockets.sockets.get(socketId);
      if (!target) return;
      unbindController(target);
      target.data.token = undefined;
      target.emit('controllerRevoked', { reason, message });
    });
  }

  /**
   * ÚNICO punto que decide si una conexión puede modificar un partido.
   *   - Estación: cualquier partido.
   *   - Teléfono: solo el partido al que está vinculado y con token válido.
   */
  function authorizeMatch(socket, matchId) {
    const match = registry.get(matchId);   // UNKNOWN_MATCH si no existe
    const { role } = socket.data;

    if (role === 'station') return match;
    if (role !== 'controller') throw appError('FORBIDDEN', 'Las pantallas no pueden modificar el marcador');

    if (!socket.data.matchId) {
      throw appError('NOT_PAIRED', 'Este teléfono no está vinculado a ninguna pista. Introduce el PIN.');
    }
    if (socket.data.matchId !== matchId) {
      const own = registry.get(socket.data.matchId);
      throw appError('WRONG_MATCH', `Este teléfono controla ${own.label}, no ${match.label}.`);
    }
    if (!match.verifyToken(socket.data.token)) {
      unbindController(socket);
      socket.emit('controllerRevoked', { reason: 'invalid', message: 'Este teléfono ya no está vinculado. Introduce el PIN.' });
      throw appError('NOT_PAIRED', 'Este teléfono ya no está vinculado a la pista.');
    }
    return match;
  }

  function requireDesktop() {
    if (!desktop) {
      throw appError('FORBIDDEN', 'Disponible solo en la aplicación de escritorio de StageMaster');
    }
  }

  function requireStation(socket) {
    if (socket.data.role !== 'station') {
      throw appError('FORBIDDEN', 'Acción reservada a la estación operadora');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // DIFUSIÓN (cada cosa solo a quien le corresponde)
  // ─────────────────────────────────────────────────────────────

  function matchPayload(match) {
    return { matchId: match.id, state: match.getPublicState() };
  }

  /** Nuevo estado de un partido → SOLO a su sala (teléfono + pantallas que lo muestran) */
  function publishMatch(match) {
    io.to(`match:${match.id}`).emit('matchUpdate', matchPayload(match));
    scheduleStationState();
    // Segunda revisión pasada la tolerancia: detecta pantallas que no dibujaron la versión nueva
    setTimeout(scheduleStationState, SYNC_TOLERANCE_MS + 200);
  }

  function buildScreenConfig(screenId) {
    const config   = screens.get(screenId);
    const match    = registry.get(config.matchId);
    const resolved = ads.resolveSelection(config.ads);
    return {
      id:         config.id,
      label:      config.label,
      matchId:    match.id,
      matchLabel: match.label,
      matchColor: match.color,
      mode:       config.mode,
      adInterval: config.adInterval,
      ads:        { banner: resolved.banner, fullscreen: resolved.fullscreen },
      missingAds: resolved.missing,
    };
  }

  function pushScreenConfig(screenId) {
    const config = screens.get(screenId);
    io.to(`screen:${screenId}`).emit('screenConfig', buildScreenConfig(screenId));
    io.to(`screen:${screenId}`).emit('matchUpdate', matchPayload(registry.get(config.matchId)));
  }

  // ── Estado para la estación (agrupado: como mucho 1 envío cada 100 ms) ──

  let stationTimer = null;
  function scheduleStationState() {
    if (stationTimer) return;
    stationTimer = setTimeout(() => {
      stationTimer = null;
      io.to('station').emit('stationState', buildStationState());
    }, 100);
  }

  function buildStationState() {
    const now     = Date.now();
    const network = getNetworkInfo();
    return {
      matches: registry.list().map((match) => {
        const presence = controllerPresence.get(match.id);
        // QR para el teléfono del árbitro: abre directamente el PIN de esta pista
        const qrUrl = network.primary ? `${network.primary.controlUrl}?pista=${match.id}` : null;
        return {
          id:     match.id,
          label:  match.label,
          color:  match.color,
          pin:    match.pin,
          qrUrl,
          qrSvg:  qrUrl ? getQrSvg(qrUrl, scheduleStationState) : null,
          state:  match.getPublicState(),
          controller: match.controller && {
            deviceName: match.controller.deviceName,
            pairedAt:   match.controller.pairedAt,
            connected:  presence.sockets.size > 0,
            lastSeen:   presence.lastSeen,
          },
        };
      }),
      screens: screens.list().map((config) => {
        const match = registry.get(config.matchId);
        const resolved = ads.resolveSelection(config.ads);
        return {
          ...config,
          matchLabel: match.label,
          missingAds: resolved.missing,
          displays: screens.presenceOf(config.id).map((display) => ({
            viewport: display.viewport,
            adErrors: display.adErrors,
            sync:     syncStatus(display, match, now),
          })),
        };
      }),
      ads:     ads.listAds(),
      network,
      desktop: desktop ? desktop.getState() : null,
      serverTime: now,
    };
  }

  /** 'ok' | 'pending' (aún dentro de la tolerancia) | 'stale' (desincronizada) */
  function syncStatus(display, match, now) {
    const upToDate = display.renderedMatchId === match.id &&
      display.renderedVersion === (match.state ? match.version : null);
    if (upToDate) return 'ok';
    return now - match.changedAt > SYNC_TOLERANCE_MS ? 'stale' : 'pending';
  }

  function courtSummary(match) {
    const state = match.getPublicState();
    return {
      id:          match.id,
      label:       match.label,
      color:       match.color,
      status:      state ? state.status : 'empty',
      names:       state ? [state.players.A.name, state.players.B.name] : null,
      hasController: !!match.controller,
      controllerConnected: controllerPresence.get(match.id).sockets.size > 0,
    };
  }

  return { buildStationState };
}

// ─────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────

/**
 * Registra un evento con respuesta (ack). El manejador devuelve un objeto
 * con datos extra (opcional) o lanza un AppError.
 */
function handle(socket, eventName, handler) {
  socket.on(eventName, (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const result = handler(payload && typeof payload === 'object' ? payload : {});
      reply({ ok: true, ...(result || {}) });
    } catch (err) {
      if (!err.code) console.error(`[Error] ${eventName}:`, err);
      else console.warn(`[Event] ${eventName} rechazado (${roleLabel(socket)}): ${err.code}`);
      reply({
        ok:      false,
        code:    err.code || 'SERVER_ERROR',
        message: err.code ? err.message : 'Error interno del servidor',
      });
    }
  });
}

function connectionError(code, message) {
  const err = new Error(message);
  err.data  = { code };
  return err;
}

function roleLabel(socket) {
  const { role, screenId, matchId } = socket.data;
  if (role === 'display') return `Pantalla ${screenId}`;
  if (role === 'station') return 'Estación';
  return matchId ? `Teléfono (${matchId})` : 'Teléfono sin vincular';
}

module.exports = { attachSocketServer };
