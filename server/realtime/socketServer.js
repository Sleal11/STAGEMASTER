'use strict';

/**
 * socketServer.js — Comunicación en tiempo real (Socket.IO)
 *
 * Responsabilidad: conectar dispositivos con partidos y pantallas, decidir
 * QUIÉN puede hacer QUÉ y enviar cada actualización SOLO a quien corresponde.
 *
 * ROLES (se indican al conectar: io({ auth: { role, ... } }))
 *   station     Estación operadora (station.html). Desde localhost (portátil
 *               principal) o desde un portátil remoto ENLAZADO (auth.remoteToken):
 *               configura partidos, pantallas y publicidad; ve todo. Lo que solo
 *               puede hacer el PRINCIPAL (MAIN_ONLY): enlazar y desvincular
 *               portátiles, su código, y el hardware del principal (resolución,
 *               firewall, carpeta, pasar a modo remoto). Un remoto no ve el código.
 *   controller  Teléfono del árbitro (control.html). Controla UN partido,
 *               al que se vincula con el PIN de la pista (token).
 *   display     Pantalla de score/publicidad (score.html?pantalla=N).
 *               Solo lectura. Desde localhost, o desde la red si trae el token
 *               de un portátil remoto enlazado (auth.remoteToken).
 *   preview     Vista previa de una pantalla en la estación (pestaña «En vivo»,
 *               score.html?vista=previa). Desde localhost o un portátil remoto
 *               enlazado (como la estación). Recibe lo mismo
 *               que la pantalla, pero NO cuenta como ventana conectada ni informa.
 *   remote      Portátil en modo «pantalla remota» (aplicación de escritorio).
 *               Se enlaza con el código de la estación; informa de qué
 *               pantallas muestra y en qué monitor. Este rol nunca modifica nada
 *               (para configurar, ese portátil abre la estación con su token).
 *
 * SALAS (aislamiento entre partidos)
 *   match:<id>   Teléfono y pantallas de ese partido → reciben sus 'matchUpdate'
 *   screen:<id>  Ventanas de una pantalla → reciben 'screenConfig' e 'identify'
 *   station      Estación del principal → recibe 'stationState' (resumen de todo)
 *   station-remote  Estación abierta en un portátil remoto → el mismo resumen,
 *               sin el código de enlace (remoteView)
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
 *   station:updateScreen { screenId, changes }      estación (ver core/screenConfig.js; mirrorOf: espejo)
 *   station:addScreen                               estación: añade una pantalla (máximo 8)
 *   station:saveFormat { label, width, height, screenId }  estación: guarda un tamaño con nombre
 *   station:deleteFormat { formatId }               estación: borra un formato guardado
 *   station:removeScreen { screenId }               estación: quita una pantalla
 *   station:media { screenId, command }             estación: play | pause | resume | stop
 *   station:history { from, to, text, matchId }     estación: partidos terminados (historial)
 *   station:identify { screenId }                   estación
 *   station:refreshAds                              estación
 *   station:setMonitor { screenId, monitor }        estación (solo aplicación de escritorio)
 *   station:openScreen { screenId }                 estación (solo aplicación de escritorio)
 *   station:openAdsFolder                           estación (solo aplicación de escritorio)
 *   station:checkNetwork / station:allowPhones      estación: ¿entran los teléfonos? / ajustar firewall (Windows)
 *   station:listModes { screenId }                  estación: modos del monitor de esa pantalla (Windows)
 *   station:applyMode { screenId, mode }            estación: prueba un modo (vuelve solo en 15 s)
 *   station:confirmMode / station:revertMode        estación: mantener o deshacer el modo probado
 *   station:remoteCode                              estación: código de enlace nuevo
 *   station:unlinkRemote { remoteId }               estación: desvincula un portátil remoto
 *   station:useAsRemote                             estación: este portátil pasa a modo remoto (escritorio)
 *   remote:pair { code, name }                      portátil remoto → { token, remoteId, name }
 *   remote:report { monitors, screens }             portátil remoto: dónde muestra cada pantalla
 *   display:report { viewport, renderedMatchId, renderedVersion, adErrors, playing, soundBlocked }   pantalla
 *
 * EVENTOS servidor → cliente:
 *   matchUpdate { matchId, state }                  sala del partido (state.paused: partido en pausa)
 *   controllerSession { matchId, label, color }     teléfono vinculado
 *   controllerRevoked { reason, message }           teléfono que pierde el permiso
 *   screenConfig { ... }                            pantalla
 *   identify { label }                              pantalla
 *   screenRemoved                                   pantalla que el operador ha quitado
 *   stationState { matches, screens, ads, network } estación
 *   historyChanged                                  estación: se guardó o anuló un partido del historial
 *   remoteState { serverName, screens }             portátil remoto: pantallas que puede mostrar
 *   remoteRevoked { message }                       portátil remoto desvinculado (token inválido)
 *   stationRevoked { message }                      estación de un portátil remoto desvinculado
 */

const { appError }      = require('../core/errors');
const { MATCH_ACTIONS } = require('../core/Match');
const auth              = require('../core/auth');
const ads               = require('../core/ads');
const { getQrSvg }      = require('../core/network');
const { getBuildInfo }  = require('../core/buildInfo');
const os                = require('os');
const { OUTPUT_FORMATS, LIMITS, resolveOutput } = require('../core/screenConfig');
const { MAX_SCREENS }   = require('../core/screens');

/**
 * Órdenes que solo puede dar la estación del PORTÁTIL PRINCIPAL (no la de un
 * portátil remoto): quién se enlaza, y el hardware del propio principal
 * (cambiar su resolución, su firewall con permiso de administrador, abrir su
 * carpeta o pasarlo a modo remoto ocurriría en un portátil que quizá nadie mira).
 */
const MAIN_ONLY = new Set([
  'station:remoteCode', 'station:unlinkRemote', 'station:useAsRemote',
  'station:listModes', 'station:applyMode', 'station:confirmMode', 'station:revertMode',
  'station:allowPhones', 'station:openAdsFolder',
]);

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
 * @param {Object}  [deps.history] - Historial de partidos (core/history.js)
 * @param {Object}  [deps.remotes] - Portátiles remotos enlazados (core/remotes.js)
 * @param {Object}  [deps.formats] - Formatos de salida guardados (core/formats.js)
 */
function attachSocketServer(io, { registry, screens, getNetworkInfo, desktop = null, history = null, remotes = null, formats = null }) {
  const savedFormats = () => (formats ? formats.list() : []);
  const pinGuard  = auth.createPinGuard();
  const codeGuard = auth.createPinGuard();
  // Portátiles remotos conectados: remoteId → { sockets: Set, address, monitors, screens, lastSeen }
  const remotePresence = new Map();
  // Estaciones abiertas en portátiles remotos: remoteId → Set(socketId)
  const remoteStations = new Map();

  // La aplicación de escritorio avisa cuando cambian los monitores o las ventanas
  if (desktop) desktop.onChange(() => scheduleStationState());
  // …y sabe qué pantallas existen (abre una ventana por pantalla)
  const tellDesktopScreens = () => { if (desktop && desktop.setScreens) desktop.setScreens(screens.ids()); };
  tellDesktopScreens();

  // Teléfonos conectados por partido: matchId → { sockets: Set, lastSeen }
  const controllerPresence = new Map(registry.ids().map((id) => [id, { sockets: new Set(), lastSeen: null }]));

  // ─────────────────────────────────────────────────────────────
  // IDENTIFICACIÓN DEL ROL (antes de aceptar la conexión)
  // ─────────────────────────────────────────────────────────────

  io.use((socket, next) => {
    const params = socket.handshake.auth || {};
    const role   = ['station', 'display', 'preview', 'controller', 'remote'].includes(params.role) ? params.role : 'controller';
    const local  = auth.isLocalAddress(socket.handshake.address);
    socket.data.role = role;

    // Estación y vista previa: el propio portátil o un portátil remoto ENLAZADO
    if ((role === 'station' || role === 'preview') && !local) {
      const remote = remotes ? remotes.verify(params.remoteToken) : null;
      if (!remote) {
        return next(connectionError('STATION_LOCAL_ONLY',
          'La estación operadora solo se abre en el portátil principal o en un portátil remoto enlazado con el código de la estación'));
      }
      socket.data.remoteId = remote.id;
    }
    if (role === 'display') {
      // Las pantallas son del propio portátil o de un portátil remoto ENLAZADO
      // (token del código de enlace): ningún otro dispositivo de la red puede
      // hacerse pasar por una pantalla. STAGEMASTER_REMOTE_DISPLAYS=1 lo permite sin enlace.
      const remote = remotes && !local ? remotes.verify(params.remoteToken) : null;
      if (!local && !remote && process.env.STAGEMASTER_REMOTE_DISPLAYS !== '1') {
        return next(connectionError('DISPLAY_LOCAL_ONLY',
          'Esta pantalla no está autorizada: ábrela desde StageMaster en modo «pantalla remota» enlazado con el código de la estación'));
      }
      if (!screens.has(params.screenId)) {
        return next(connectionError('UNKNOWN_SCREEN', `Pantalla desconocida: ${params.screenId}`));
      }
      socket.data.screenId = params.screenId;
      socket.data.remoteId = remote ? remote.id : null;
    }
    if (role === 'preview') {
      if (!screens.has(params.screenId)) {
        return next(connectionError('UNKNOWN_SCREEN', `Pantalla desconocida: ${params.screenId}`));
      }
      socket.data.screenId = params.screenId;
    }
    if (role === 'remote') {
      if (!remotes) return next(connectionError('FORBIDDEN', 'Este servidor no admite portátiles remotos'));
      const remote = typeof params.token === 'string' ? remotes.verify(params.token) : null;
      socket.data.remoteId = remote ? remote.id : null;
      socket.data.remoteInvalid = typeof params.token === 'string' && !remote;
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
    if (role === 'preview')    onPreviewConnected(socket);
    if (role === 'controller') onControllerConnected(socket);
    if (role === 'remote')     onRemoteConnected(socket);

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
      const wasFinished = match.state && match.state.status === 'finished';
      match.applyAction(action, version);
      updateHistory(match, wasFinished, action);
      publishMatch(match, wasFinished);
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
      requireStation(socket, 'station:newPin');
      registry.get(matchId).regeneratePin();
      scheduleStationState();
    });

    handle(socket, 'station:unpair', ({ matchId } = {}) => {
      requireStation(socket, 'station:unpair');
      registry.get(matchId).unpairController();
      revokeControllers(matchId, 'unpaired', 'La estación operadora desvinculó este teléfono.');
      scheduleStationState();
    });

    handle(socket, 'station:updateScreen', ({ screenId, changes } = {}) => {
      requireStation(socket, 'station:updateScreen');
      // Pantallas afectadas: ella y sus espejos (que muestran su contenido)
      const affected = screens.withMirrors([screenId]);
      const before   = new Map(affected.map((id) => [id, screens.effective(id).matchId]));
      screens.update(screenId, changes, ads.listAds(), savedFormats());
      affected.forEach((id) => {
        const matchChanged = screens.effective(id).matchId !== before.get(id);
        if (matchChanged) joinMatchRoom(id);
        pushOne(id, matchChanged);
      });
      scheduleStationState();
    });

    // ── Formatos de salida guardados (tamaños personalizados con nombre) ──
    handle(socket, 'station:saveFormat', ({ label, width, height, screenId } = {}) => {
      requireStation(socket, 'station:saveFormat');
      if (!formats) throw appError('FORBIDDEN', 'No disponible');
      const format = formats.add({ label, width, height });
      // La pantalla desde la que se guardó pasa a usarlo
      if (screenId && screens.has(screenId)) {
        screens.update(screenId, { output: { format: format.id } }, ads.listAds(), savedFormats());
        pushScreenConfig(screenId, false);
      }
      scheduleStationState();
      return { format };
    });

    handle(socket, 'station:deleteFormat', ({ formatId } = {}) => {
      requireStation(socket, 'station:deleteFormat');
      if (!formats) throw appError('FORBIDDEN', 'No disponible');
      formats.remove(formatId);
      screens.forgetFormat(formatId).forEach((id) => pushScreenConfig(id, false));
      scheduleStationState();
    });

    handle(socket, 'station:addScreen', () => {
      requireStation(socket, 'station:addScreen');
      const config = screens.add();
      tellDesktopScreens();
      scheduleStationState();
      return { screenId: config.id };
    });

    handle(socket, 'station:removeScreen', ({ screenId } = {}) => {
      requireStation(socket, 'station:removeScreen');
      const { released } = screens.remove(screenId);
      // Sus ventanas se apagan (la aplicación de escritorio las cierra)
      io.to(`screen:${screenId}`).emit('screenRemoved');
      io.in(`screen:${screenId}`).disconnectSockets(true);
      // Sus espejos siguen mostrando lo mismo, ya como pantallas independientes
      released.forEach((id) => pushOne(id, false));
      tellDesktopScreens();
      scheduleStationState();
    });

    handle(socket, 'station:history', (filters = {}) => {
      requireStation(socket, 'station:history');
      if (!history) return { total: 0, records: [] };
      const num = (v) => (Number.isFinite(v) ? v : undefined);
      return history.list({
        from: num(filters.from), to: num(filters.to), limit: num(filters.limit),
        text: typeof filters.text === 'string' ? filters.text.slice(0, 80) : '',
        matchId: typeof filters.matchId === 'string' ? filters.matchId : '',
      });
    });

    handle(socket, 'station:media', ({ screenId, command } = {}) => {
      requireStation(socket, 'station:media');
      screens.command(screenId, command);
      // En un espejo manda su origen: se actualizan el origen y todos sus espejos
      pushScreenConfig(screens.sourceId(screenId), false);
      scheduleStationState();
    });

    handle(socket, 'station:identify', ({ screenId } = {}) => {
      requireStation(socket, 'station:identify');
      const { label, mirrorOf } = screens.get(screenId);
      io.to(`screen:${screenId}`).emit('identify', { label, mirrorOf: mirrorOf ? screens.get(mirrorOf).label : null });
    });

    handle(socket, 'station:refreshAds', () => {
      requireStation(socket, 'station:refreshAds');
      refreshAds();
      return { ads: ads.listAds() };
    });

    // ── Aplicación de escritorio: monitores y carpeta de publicidad ──
    handle(socket, 'station:setMonitor', ({ screenId, monitor } = {}) => {
      requireStation(socket, 'station:setMonitor');
      requireDesktop();
      screens.get(screenId);   // UNKNOWN_SCREEN si no existe
      desktop.setMonitor(screenId, monitor);
      scheduleStationState();
    });

    handle(socket, 'station:openScreen', ({ screenId } = {}) => {
      requireStation(socket, 'station:openScreen');
      requireDesktop();
      screens.get(screenId);
      desktop.openScreen(screenId);
    });

    // ── Resolución del monitor (aplicación de escritorio en Windows) ──
    handle(socket, 'station:listModes', ({ screenId } = {}) => {
      requireStation(socket, 'station:listModes');
      requireDesktop();
      screens.get(screenId);
      if (!desktop.listModes) throw appError('FORBIDDEN', 'No disponible');
      return desktop.listModes(screenId);
    });

    handle(socket, 'station:applyMode', ({ screenId, mode } = {}) => {
      requireStation(socket, 'station:applyMode');
      requireDesktop();
      screens.get(screenId);
      const valid = mode && ['width', 'height', 'hz'].every((k) => Number.isInteger(mode[k]) && mode[k] > 0 && mode[k] < 16384);
      if (!valid) throw appError('DISPLAY_MODE', 'Modo de pantalla no válido');
      return desktop.applyMode(screenId, { width: mode.width, height: mode.height, hz: mode.hz });
    });

    handle(socket, 'station:confirmMode', () => {
      requireStation(socket, 'station:confirmMode');
      requireDesktop();
      return desktop.confirmMode();
    });

    handle(socket, 'station:revertMode', () => {
      requireStation(socket, 'station:revertMode');
      requireDesktop();
      return desktop.revertMode();
    });

    // ── Teléfonos que no conectan: firewall de Windows (aplicación de escritorio) ──
    handle(socket, 'station:checkNetwork', () => {
      requireStation(socket, 'station:checkNetwork');
      requireDesktop();
      return desktop.checkNetwork ? desktop.checkNetwork().then(() => ({})) : {};
    });

    handle(socket, 'station:allowPhones', () => {
      requireStation(socket, 'station:allowPhones');
      requireDesktop();
      if (!desktop.allowPhones) throw appError('FORBIDDEN', 'Disponible solo en Windows');
      return desktop.allowPhones().then(() => ({}));
    });

    handle(socket, 'station:openAdsFolder', () => {
      requireStation(socket, 'station:openAdsFolder');
      requireDesktop();
      desktop.openAdsFolder();
    });

    // ── Portátiles remotos ───────────────────────────────────────
    handle(socket, 'station:remoteCode', () => {
      requireStation(socket, 'station:remoteCode');
      remotes.newCode();
      scheduleStationState();
    });

    handle(socket, 'station:unlinkRemote', ({ remoteId } = {}) => {
      requireStation(socket, 'station:unlinkRemote');
      remotes.unlink(remoteId);
      // Su conexión y sus pantallas se cortan al momento
      io.sockets.sockets.forEach((other) => {
        if (other.data.remoteId !== remoteId) return;
        if (other.data.role === 'remote') other.emit('remoteRevoked', { message: 'La estación del portátil principal desvinculó este portátil.' });
        if (other.data.role === 'station') other.emit('stationRevoked', { message: 'El portátil principal desvinculó este portátil: ya no puede usar la estación.' });
        other.disconnect(true);
      });
      remotePresence.delete(remoteId);
      remoteStations.delete(remoteId);
      scheduleStationState();
    });

    handle(socket, 'station:useAsRemote', () => {
      requireStation(socket, 'station:useAsRemote');
      requireDesktop();
      if (!desktop.useAsRemote) throw appError('FORBIDDEN', 'No disponible en esta versión');
      desktop.useAsRemote();
    });

    handle(socket, 'remote:pair', ({ code, name } = {}) => {
      if (socket.data.role !== 'remote') throw appError('FORBIDDEN', 'Solo un portátil en modo pantalla remota puede enlazarse');
      const key = 'remote:' + socket.handshake.address;
      codeGuard.check(key);
      let paired;
      try {
        paired = remotes.pair(code, name);
      } catch (err) {
        if (err.code === 'INVALID_CODE') {
          const left = codeGuard.fail(key);
          throw appError('INVALID_CODE', left > 0
            ? `Código incorrecto. Te quedan ${left} intento(s). Míralo en la estación del portátil principal.`
            : 'Código incorrecto. Demasiados intentos: espera un minuto.');
        }
        throw err;
      }
      codeGuard.success(key);
      socket.data.remoteId = paired.id;
      socket.data.remoteInvalid = false;
      bindRemote(socket);
      return { token: paired.token, remoteId: paired.id, name: paired.name, serverName: serverName() };
    });

    socket.on('remote:report', (data) => {
      const entry = socket.data.role === 'remote' && remotePresence.get(socket.data.remoteId);
      if (!entry || !data || typeof data !== 'object') return;
      const text = (v, max = 60) => String(v == null ? '' : v).slice(0, max);
      if (Array.isArray(data.monitors)) {
        entry.monitors = data.monitors.slice(0, 8).map((m) => ({
          label: text(m && m.label), width: Number(m && m.width) || 0, height: Number(m && m.height) || 0,
          refreshRate: Number(m && m.refreshRate) || null,
        }));
      }
      if (data.screens && typeof data.screens === 'object') {
        entry.screens = {};
        Object.keys(data.screens).filter((id) => screens.has(id)).forEach((id) => {
          entry.screens[id] = data.screens[id] === null ? null : text(data.screens[id]);
        });
      }
      scheduleStationState();
    });

    // ── Pantalla: informe tras dibujar ───────────────────────────
    socket.on('display:report', (data) => {
      if (socket.data.role !== 'display' || !screens.has(socket.data.screenId)) return;
      screens.report(socket.data.screenId, socket.id, data);
      scheduleStationState();
    });

    socket.on('disconnect', (reason) => {
      console.log(`[-] ${roleLabel(socket)} desconectado (${reason})`);
      if (role === 'display') screens.detach(socket.data.screenId, socket.id);
      if (role === 'controller') unbindController(socket);
      if (role === 'remote') unbindRemote(socket);
      if (role === 'station' && socket.data.remoteId) {
        const open = remoteStations.get(socket.data.remoteId);
        if (open) { open.delete(socket.id); if (!open.size) remoteStations.delete(socket.data.remoteId); }
      }
      scheduleStationState();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CONEXIÓN DE CADA ROL
  // ─────────────────────────────────────────────────────────────

  function onStationConnected(socket) {
    const { remoteId } = socket.data;
    if (remoteId) {
      if (!remoteStations.has(remoteId)) remoteStations.set(remoteId, new Set());
      remoteStations.get(remoteId).add(socket.id);
      socket.join('station-remote');
      socket.emit('stationState', remoteView(buildStationState()));
      scheduleStationState();   // el principal ve que ese portátil tiene la estación abierta
      return;
    }
    socket.join('station');
    socket.emit('stationState', buildStationState());
  }

  function onDisplayConnected(socket) {
    const { screenId } = socket.data;
    const config = screens.effective(screenId);
    const remote = socket.data.remoteId && remotes ? remotes.get(socket.data.remoteId) : null;
    screens.attach(screenId, socket.id, { remote: remote ? remote.name : null });
    socket.join(`screen:${screenId}`);
    socket.join(`match:${config.matchId}`);
    socket.emit('screenConfig', buildScreenConfig(screenId));
    socket.emit('matchUpdate', matchPayload(registry.get(config.matchId)));
    scheduleStationState();
  }

  /** Portátil remoto: si su token vale, recibe las pantallas; si no, debe enlazarse otra vez */
  function onRemoteConnected(socket) {
    if (socket.data.remoteInvalid) {
      socket.emit('remoteRevoked', { message: 'Este portátil ya no está enlazado. Pide el código en la estación del portátil principal.' });
      return;
    }
    if (socket.data.remoteId) bindRemote(socket);
  }

  function bindRemote(socket) {
    const { remoteId } = socket.data;
    let entry = remotePresence.get(remoteId);
    if (!entry) {
      entry = { sockets: new Set(), address: null, monitors: [], screens: {}, lastSeen: null };
      remotePresence.set(remoteId, entry);
    }
    entry.sockets.add(socket.id);
    entry.address = String(socket.handshake.address).replace(/^::ffff:/, '');
    socket.join('remotes');
    socket.emit('remoteState', remoteState());
    scheduleStationState();
  }

  function unbindRemote(socket) {
    const entry = remotePresence.get(socket.data.remoteId);
    if (entry && entry.sockets.delete(socket.id)) entry.lastSeen = Date.now();
  }

  function serverName() {
    return os.hostname();
  }

  /** Lo que ve un portátil remoto: las pantallas que puede mostrar */
  function remoteState() {
    return {
      serverName: serverName(),
      build: getBuildInfo(),
      screens: screens.ids().map((id) => {
        const config = screens.effective(id);
        const mirror = config.mirrorOf ? screens.get(config.mirrorOf).label : null;
        return { id, label: config.label, matchLabel: registry.get(config.matchId).label, mirrorOf: mirror };
      }),
    };
  }

  /** Vista previa: misma sala que la pantalla, sin presencia (no cuenta como ventana) */
  function onPreviewConnected(socket) {
    const { screenId } = socket.data;
    const config = screens.effective(screenId);
    socket.join(`screen:${screenId}`);
    socket.join(`match:${config.matchId}`);
    socket.emit('screenConfig', buildScreenConfig(screenId));
    socket.emit('matchUpdate', matchPayload(registry.get(config.matchId)));
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
   *   - Estación (del principal o de un portátil remoto enlazado): cualquier partido.
   *   - Teléfono: solo el partido al que está vinculado y con token válido.
   */
  function authorizeMatch(socket, matchId) {
    const match = registry.get(matchId);   // UNKNOWN_MATCH si no existe
    const { role } = socket.data;

    if (role === 'station') {
      requireStation(socket, 'match');
      return match;
    }
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

  function requireStation(socket, eventName) {
    if (socket.data.role !== 'station') {
      throw appError('FORBIDDEN', 'Acción reservada a la estación operadora');
    }
    const { remoteId } = socket.data;
    if (!remoteId) return;
    // Estación de un portátil remoto: sigue enlazado (si se volvió a enlazar con
    // otro token, el anterior ya no vale) y no pide algo reservado al principal
    if (!remotes.get(remoteId)) {
      socket.emit('stationRevoked', { message: 'Este portátil ya no está enlazado: ya no puede usar la estación.' });
      socket.disconnect(true);
      throw appError('FORBIDDEN', 'Este portátil ya no está enlazado');
    }
    if (MAIN_ONLY.has(eventName)) {
      throw appError('MAIN_ONLY', 'Esto solo se puede hacer en la estación del portátil principal');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // DIFUSIÓN (cada cosa solo a quien le corresponde)
  // ─────────────────────────────────────────────────────────────

  function matchPayload(match) {
    return { matchId: match.id, state: match.getPublicState() };
  }

  /**
   * Nuevo estado de un partido → SOLO a su sala (teléfono + pantallas que lo muestran).
   * Además avisa a las pantallas de que el partido terminó (publicidad final)
   * o vuelve a jugarse (fin de esa publicidad). Nunca al revés: la
   * publicidad no puede cambiar el marcador.
   *
   * @param {Match}   match
   * @param {boolean} [wasFinished] - Si estaba terminado ANTES de la acción
   */
  function publishMatch(match, wasFinished = false) {
    const state = match.getPublicState();
    io.to(`match:${match.id}`).emit('matchUpdate', matchPayload(match));

    const finishedNow = !!state && state.status === 'finished';
    const changed = finishedNow && !wasFinished
      ? screens.matchFinished(match.id, String(match.version))
      : (finishedNow ? [] : screens.matchActive(match.id));
    changed.forEach((screenId) => {
      pushScreenConfig(screenId, false);   // y a sus espejos
      // La estación muestra "en X s" y después "mostrando publicidad": refrescar al empezar
      setTimeout(scheduleStationState, screens.effective(screenId).endAds.delay * 1000 + 200);
    });
    // Pausa: publicidad mientras dura (cada pausa tiene su identificador)
    const pauseKey = state && state.paused ? `${match.uid}:${match.pausedSince}` : null;
    screens.matchPauseChanged(match.id, pauseKey)
      .filter((screenId) => !changed.includes(screenId))
      .forEach((screenId) => pushScreenConfig(screenId, false));

    scheduleStationState();
    // Segunda revisión pasada la tolerancia: detecta pantallas que no dibujaron la versión nueva
    setTimeout(scheduleStationState, SYNC_TOLERANCE_MS + 200);
  }

  /**
   * Historial: el partido acaba de terminar → se guarda; se deshizo el final →
   * se anula. Un partido que nunca termina no se guarda.
   */
  function updateHistory(match, wasFinished, action) {
    if (!history) return;
    const finishedNow = !!match.state && match.state.status === 'finished';
    let changed = false;
    if (finishedNow && !wasFinished) {
      changed = history.recordFinish(match.historyRecord(action === 'finishMatch' ? 'manual' : 'normal'));
    } else if (!finishedNow && wasFinished) {
      changed = history.cancelFinish(match.uid);
    }
    if (changed) io.to(['station', 'station-remote']).emit('historyChanged');
  }

  /** Lo que necesita una pantalla para dibujarse (URLs resueltas, sin datos internos) */
  function buildScreenConfig(screenId) {
    const config  = screens.effective(screenId);   // un espejo: contenido de su origen
    const match   = registry.get(config.matchId);
    const library = ads.listAds();
    const ribbon  = ads.resolve('banner', config.ribbon.items, library);
    const media   = ads.resolve('fullscreen', config.media.items, library);
    const { postMatch, endAds } = config;
    return {
      id:         config.id,
      label:      config.label,
      matchId:    match.id,
      matchLabel: match.label,
      matchColor: match.color,
      view:       config.view,
      ribbon:     { ...config.ribbon, items: ribbon.items },
      media:      { ...config.media, items: media.items, playback: config.playback, playId: config.playId },
      // Tiempo restante (no la hora): así no importa si el reloj de la pantalla va desajustado
      postMatch:  postMatch && { remainingMs: Math.max(0, postMatch.since + endAds.delay * 1000 - Date.now()) },
      pauseMedia: !!config.pauseMedia,
      output:     resolveOutput(config.output),
      missingAds: ribbon.missing.concat(media.missing),
    };
  }

  /** La carpeta de publicidad cambió: las pantallas y la estación se actualizan */
  function refreshAds() {
    screens.ids().forEach((id) => pushOne(id, false));
    scheduleStationState();
  }

  /** Envía su configuración a una pantalla y a sus espejos (y el marcador, si cambió de partido) */
  function pushScreenConfig(screenId, withMatch = true) {
    screens.withMirrors([screenId]).forEach((id) => pushOne(id, withMatch));
  }

  function pushOne(screenId, withMatch) {
    const config = screens.effective(screenId);
    io.to(`screen:${screenId}`).emit('screenConfig', buildScreenConfig(screenId));
    if (withMatch) io.to(`screen:${screenId}`).emit('matchUpdate', matchPayload(registry.get(config.matchId)));
  }

  /** Las ventanas de una pantalla pasan a la sala del partido que muestra ahora */
  function joinMatchRoom(screenId) {
    const room = io.in(`screen:${screenId}`);
    room.socketsLeave(registry.ids().map((id) => `match:${id}`));
    room.socketsJoin(`match:${screens.effective(screenId).matchId}`);
  }

  // ── Estado para la estación (agrupado: como mucho 1 envío cada 100 ms) ──

  let stationTimer = null;
  function scheduleStationState() {
    if (stationTimer) return;
    stationTimer = setTimeout(() => {
      stationTimer = null;
      const state = buildStationState();
      io.to('station').emit('stationState', state);
      io.to('station-remote').emit('stationState', remoteView(state));
      // Los portátiles remotos solo reciben su lista cuando cambia
      if (remotes) {
        const state = remoteState();
        const key = JSON.stringify(state.screens);
        if (key !== lastRemoteKey) {
          lastRemoteKey = key;
          io.to('remotes').emit('remoteState', state);
        }
      }
    }, 100);
  }
  let lastRemoteKey = '';

  function buildStationState() {
    const now     = Date.now();
    const network = getNetworkInfo();
    const library = ads.listAds();
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
      // Un espejo se ve con el contenido de su origen (y mirrorOf indica cuál)
      screens: screens.ids().map((id) => screens.effective(id)).map((config) => {
        const match = registry.get(config.matchId);
        return {
          ...config,
          matchLabel: match.label,
          missingAds: ads.resolve('banner', config.ribbon.items, library).missing
            .concat(ads.resolve('fullscreen', config.media.items, library).missing),
          displays: screens.presenceOf(config.id).map((display) => ({
            remote:       display.remote || null,
            viewport:     display.viewport,
            window:       display.window || null,
            adErrors:     display.adErrors,
            playing:      display.playing,
            soundBlocked: display.soundBlocked,
            sync:         syncStatus(display, match, now),
          })),
        };
      }),
      ads:     library,
      maxScreens: MAX_SCREENS,
      // Fijos, guardados por el operador y «personalizado»
      outputFormats: Object.entries(OUTPUT_FORMATS).map(([id, format]) => ({ id, ...format }))
        .concat(savedFormats().map((f) => ({ ...f, label: `${f.label} · ${f.width} × ${f.height} px`, name: f.label, saved: true })))
        .concat({ id: 'custom', label: 'Personalizado (ancho × alto)', width: null, height: null }),
      limits:  LIMITS,
      network,
      desktop: desktop ? desktop.getState() : null,
      remotes: remotes ? remotesSummary(now) : null,
      viewer:  'main',
      build:   getBuildInfo(),
      serverTime: now,
    };
  }

  /**
   * Lo que ve la estación de un portátil remoto: lo mismo, salvo el código de
   * enlace (lo reparte el principal) y las opciones de su hardware.
   */
  function remoteView(state) {
    return {
      ...state,
      viewer: 'remote',
      remotes: state.remotes && { ...state.remotes, code: null },
      desktop: state.desktop && { ...state.desktop, canUseAsRemote: false, displayModes: null },
    };
  }

  /** Portátiles remotos para la estación: código, enlazados, conectados y qué muestran */
  function remotesSummary(now) {
    return {
      code: remotes.code(),
      serverName: serverName(),
      list: remotes.list().map((remote) => {
        const entry = remotePresence.get(remote.id);
        return {
          ...remote,
          online:   !!entry && entry.sockets.size > 0,
          stationOpen: remoteStations.has(remote.id),
          address:  entry ? entry.address : null,
          lastSeen: entry ? entry.lastSeen : null,
          monitors: entry ? entry.monitors : [],
          screens:  entry ? entry.screens : {},
        };
      }),
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

  return { buildStationState, refreshAds };
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
    const fail = (err) => {
      if (!err.code) console.error(`[Error] ${eventName}:`, err);
      else console.warn(`[Event] ${eventName} rechazado (${roleLabel(socket)}): ${err.code}`);
      reply({
        ok:      false,
        code:    err.code || 'SERVER_ERROR',
        message: err.code ? err.message : 'Error interno del servidor',
      });
    };
    try {
      const result = handler(payload && typeof payload === 'object' ? payload : {});
      // Algunas órdenes tardan (p. ej. preguntar a Windows): se responde al terminar
      if (result && typeof result.then === 'function') {
        result.then((value) => reply({ ok: true, ...(value || {}) }), fail);
        return;
      }
      reply({ ok: true, ...(result || {}) });
    } catch (err) {
      fail(err);
    }
  });
}

function connectionError(code, message) {
  const err = new Error(message);
  err.data  = { code };
  return err;
}

function roleLabel(socket) {
  const { role, screenId, matchId, remoteId } = socket.data;
  if (role === 'display') return `Pantalla ${screenId}${remoteId ? ` (${remoteId})` : ''}`;
  if (role === 'preview') return `Vista previa ${screenId}`;
  if (role === 'remote') return `Portátil remoto ${remoteId || 'sin enlazar'}`;
  if (role === 'station') return 'Estación';
  return matchId ? `Teléfono (${matchId})` : 'Teléfono sin vincular';
}

module.exports = { attachSocketServer };
