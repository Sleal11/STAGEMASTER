'use strict';

/**
 * remote.js — Modo «PANTALLA REMOTA» de la aplicación de escritorio
 *
 * Para pistas lejos del portátil principal: este portátil va junto a la
 * pantalla LED y muestra pantallas del PRINCIPAL por la red (cable Ethernet
 * o Wi-Fi). No tiene partidos ni configuración propia: todo lo decide la
 * estación del principal (una sola autoridad, sin conflictos).
 *
 *   1. Encuentra el principal en la red (anuncio UDP, discovery.js) o se
 *      escribe su dirección.
 *   2. Se enlaza con el CÓDIGO de 6 cifras de la estación del principal y
 *      guarda el token que recibe (modo.json).
 *   3. Recibe la lista de pantallas y abre en sus monitores las que elija el
 *      operador (las demás no se muestran aquí).
 *   4. Si la red se corta, las pantallas siguen mostrando lo último y se
 *      reconectan solas. Si el principal cambia de dirección (otra IP), lo
 *      vuelve a encontrar por su nombre.
 *   5. Informa al principal de qué muestra y en qué monitor (la estación lo ve).
 *
 * Ventana de control: desktop/remote/remote.html (sin acceso a Node: habla
 * con este proceso por preload.js).
 */

const os   = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, screen, powerSaveBlocker, Menu, dialog, session } = require('electron');
const { io } = require('socket.io-client');
const discovery = require('../server/core/discovery');
const { createScreenWindows } = require('./screenWindows');
const mode = require('./mode');

const DISCOVERY_TTL_MS = 8000;   // un principal que deja de anunciarse desaparece de la lista
const PAIR_TIMEOUT_MS  = 6000;

let win       = null;
let socket    = null;
let windows   = null;
let settings  = null;
let build     = null;
let status    = 'unpaired';   // unpaired | connecting | connected | reconnecting
let lastError = null;
let screensList = [];
let quitting  = false;
const discovered = new Map();   // 'ip:puerto' → { address, port, name, version, seen }

const remote   = () => settings.remote;
const baseUrl  = () => (remote().address ? `http://${formatHost(remote().address)}:${remote().port}` : null);
const isPaired = () => !!(remote().token && remote().address);

function formatHost(address) {
  return address.includes(':') ? `[${address}]` : address;
}

function save() {
  mode.saveSettings(settings);
}

// ─────────────────────────────────────────────────────────────────
// CONEXIÓN CON EL PORTÁTIL PRINCIPAL
// ─────────────────────────────────────────────────────────────────

function connect() {
  if (socket) { socket.removeAllListeners(); socket.close(); }
  if (!isPaired()) { setStatus('unpaired'); return; }
  setStatus('connecting');
  socket = io(baseUrl(), {
    auth: { role: 'remote', token: remote().token },
    reconnectionDelay: 1000,
    reconnectionDelayMax: 3000,
    timeout: 5000,
  });
  socket.on('connect', () => { lastError = null; setStatus('connected'); report(); });
  socket.on('disconnect', () => setStatus('reconnecting'));
  socket.on('connect_error', (err) => {
    lastError = err.message === 'xhr poll error' || err.message === 'timeout'
      ? `No se encuentra el portátil principal en ${remote().address}:${remote().port}` : err.message;
    setStatus('reconnecting');
  });
  socket.on('remoteState', (state) => {
    screensList = Array.isArray(state.screens) ? state.screens : [];
    // Se recuerda: al volver a abrir, las pantallas se abren aunque el principal tarde en responder
    remote().serverName = state.serverName;
    remote().screens = screensList;
    save();
    windows.setScreens(screensList.map((s) => s.id));
    report();
    pushState();
  });
  socket.on('remoteRevoked', ({ message } = {}) => unpair(message || 'El portátil principal desvinculó este portátil.'));
}

/** Pierde el enlace: se cierran sus pantallas y hay que volver a enlazar */
function unpair(message) {
  if (socket) { socket.removeAllListeners(); socket.close(); socket = null; }
  remote().token = null;
  remote().screens = [];
  screensList = [];
  save();
  windows.setScreens([]);
  lastError = message || null;
  setStatus('unpaired');
}

/**
 * Enlaza este portátil con el principal usando el código de su estación.
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
function pair({ address, port, code, name } = {}) {
  address = String(address || '').trim();
  port = Number(port) || 3000;
  code = String(code || '').replace(/\D/g, '');
  if (!address) return Promise.resolve({ ok: false, message: 'Elige el portátil principal o escribe su dirección' });
  if (code.length !== 6) return Promise.resolve({ ok: false, message: 'El código de enlace tiene 6 cifras' });

  const url = `http://${formatHost(address)}:${port}`;
  return new Promise((resolve) => {
    const temp = io(url, { auth: { role: 'remote' }, reconnection: false, timeout: PAIR_TIMEOUT_MS, forceNew: true });
    const finish = (result) => { temp.removeAllListeners(); temp.close(); resolve(result); };
    temp.once('connect_error', () => finish({ ok: false, message: `No se puede conectar con ${address}:${port}. ¿Está StageMaster abierto en el principal y en la misma red?` }));
    temp.once('connect', () => {
      temp.timeout(PAIR_TIMEOUT_MS).emitWithAck('remote:pair', { code, name: name || os.hostname() })
        .then((res) => {
          if (!res.ok) return finish({ ok: false, message: res.message });
          settings.remote = { ...remote(), address, port, token: res.token, name: res.name, serverName: res.serverName, screens: [] };
          save();
          finish({ ok: true });
          connect();
        })
        .catch(() => finish({ ok: false, message: 'El portátil principal no respondió' }));
    });
  });
}

/** Informa al principal de los monitores de este portátil y de dónde va cada pantalla */
function report() {
  if (!socket || !socket.connected) return;
  const state = windows.getState();
  const label = (key) => {
    if (!key) return null;
    if (key === 'window') return 'Ventana de prueba';
    const monitor = state.monitors.find((m) => m.key === key);
    return monitor ? `${monitor.label} · ${monitor.width}×${monitor.height}${monitor.refreshRate ? ` · ${monitor.refreshRate} Hz` : ''}` : null;
  };
  const screens = {};
  screensList.forEach((s) => { screens[s.id] = label(state.assignments[s.id]); });
  socket.emit('remote:report', {
    monitors: state.monitors.map(({ label: l, width, height, refreshRate }) => ({ label: l, width, height, refreshRate })),
    screens,
  });
}

/** Anuncio de un principal en la red */
function onFound(info) {
  discovered.set(`${info.address}:${info.port}`, { ...info, seen: Date.now() });
  // El principal cambió de dirección (otra IP o puerto): se le sigue por su nombre
  const r = remote();
  if (isPaired() && r.serverName && info.name === r.serverName && status !== 'connected' &&
      (info.address !== r.address || info.port !== r.port)) {
    console.log(`[Remoto] El principal "${info.name}" ahora está en ${info.address}:${info.port}`);
    r.address = info.address;
    r.port = info.port;
    save();
    connect();
    windows.applyLayout();   // las ventanas cargan de la dirección nueva
  }
  pushState();
}

// ─────────────────────────────────────────────────────────────────
// VENTANA DE CONTROL
// ─────────────────────────────────────────────────────────────────

function setStatus(next) {
  status = next;
  pushState();
}

function state() {
  const now = Date.now();
  [...discovered.entries()].forEach(([key, info]) => { if (now - info.seen > DISCOVERY_TTL_MS) discovered.delete(key); });
  const r = remote();
  return {
    build,
    hostname: os.hostname(),
    status,
    error: lastError,
    paired: isPaired(),
    server: isPaired() ? { address: r.address, port: r.port, name: r.serverName || null } : null,
    name: r.name || null,
    discovered: [...discovered.values()].map(({ address, port, name, version }) => ({ address, port, name, version })),
    screens: screensList,
    desktop: windows.getState(),
  };
}

let pushTimer = null;
function pushState() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (win && !win.isDestroyed()) win.webContents.send('remote:state', state());
  }, 50);
}

function openControlWindow({ background, icon }) {
  win = new BrowserWindow({
    width: 1000, height: 780, title: 'StageMaster · Pantalla remota',
    backgroundColor: background, autoHideMenuBar: true, show: false, icon,
    webPreferences: {
      preload: path.join(__dirname, 'remote', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  // Cerrar esta ventana cierra StageMaster (con confirmación)
  win.on('close', (event) => {
    if (quitting) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Cancelar', 'Cerrar StageMaster'],
      defaultId: 0,
      cancelId: 0,
      title: 'Cerrar StageMaster',
      message: '¿Cerrar StageMaster?',
      detail: 'Las pantallas de este portátil se apagarán. El portátil principal sigue funcionando.',
    });
    if (choice === 0) { event.preventDefault(); return; }
    quitting = true;
    windows.setQuitting();
    app.quit();
  });
  win.loadFile(path.join(__dirname, 'remote', 'remote.html'));
}

function registerIpc() {
  const only = (handler) => (event, ...args) => {
    // Solo la ventana de control puede dar órdenes
    if (!win || event.sender !== win.webContents) throw new Error('No autorizado');
    return handler(...args);
  };
  ipcMain.handle('remote:state', only(() => state()));
  ipcMain.handle('remote:pair', only((data) => pair(data)));
  ipcMain.handle('remote:setMonitor', only((screenId, value) => {
    try {
      windows.setMonitor(String(screenId), String(value));
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }));
  ipcMain.handle('remote:openScreen', only((screenId) => {
    windows.openScreen(String(screenId));
    return { ok: true };
  }));
  ipcMain.handle('remote:unpair', only(() => {
    unpair(null);
    return { ok: true };
  }));
  ipcMain.handle('remote:retry', only(() => {
    connect();
    return { ok: true };
  }));
  ipcMain.handle('remote:useAsMain', only(() => dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Cancelar', 'Usar como principal'],
    defaultId: 0,
    cancelId: 0,
    title: 'Portátil principal',
    message: '¿Usar este portátil como principal?',
    detail: 'StageMaster se reiniciará con su estación, sus partidos y sus pantallas. ' +
      'El enlace con el otro portátil se conserva por si vuelves a este modo.',
  }).then(({ response }) => {
    if (response !== 1) return { ok: false };
    quitting = true;
    windows.setQuitting();
    mode.switchMode('main');
    return { ok: true };
  })));
}

// ─────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────

async function start(options) {
  build = options.build;
  settings = options.settings;
  settings.remote = settings.remote || {};
  Menu.setApplicationMenu(null);
  await session.defaultSession.clearCache().catch(() => {});

  const dataDir = process.env.STAGEMASTER_DATA_DIR;
  windows = createScreenWindows({
    prefsFile: path.join(dataDir, 'monitores-remoto.json'),
    // El token va en el enlace (#…): no se envía en las peticiones HTTP
    urlFor: (screenId) => (isPaired()
      ? `${baseUrl()}/score.html?pantalla=${screenId.replace('pantalla-', '')}#remoto=${encodeURIComponent(remote().token)}`
      : null),
    allowedBase: () => baseUrl() || 'http://invalid',
    background: options.background,
    icon: options.icon,
    defaultPreference: 'none',
    onChange: () => { report(); pushState(); },
  });

  registerIpc();
  openControlWindow(options);
  // Las pantallas no se apagan ni entran en reposo mientras StageMaster esté abierto
  powerSaveBlocker.start('prevent-display-sleep');

  discovery.listen(onFound, {
    onError: (err) => console.warn('[Remoto] No se pueden recibir anuncios de la red:', err.message),
  });

  // Últimas pantallas conocidas: se abren ya (cargan en cuanto el principal responda)
  screensList = Array.isArray(remote().screens) ? remote().screens : [];
  if (isPaired()) windows.setScreens(screensList.map((s) => s.id));
  connect();

  let layoutTimer = null;
  const relayout = () => {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(windows.applyLayout, 600);
  };
  screen.on('display-added', relayout);
  screen.on('display-removed', relayout);
  screen.on('display-metrics-changed', relayout);
  app.on('before-quit', () => { quitting = true; windows.setQuitting(); });
}

module.exports = { start, mainWindow: () => win };
