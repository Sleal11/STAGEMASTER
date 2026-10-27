'use strict';

/**
 * main.js — Aplicación de escritorio de StageMaster (Electron)
 *
 * Es lo que se ejecuta al hacer doble clic en StageMaster.exe:
 *   1. Arranca el servidor de StageMaster dentro de la propia aplicación
 *      (no hace falta instalar Node.js ni nada más en el portátil).
 *   2. Abre la ESTACIÓN OPERADORA en la pantalla del portátil.
 *   3. Abre cada PANTALLA (score + publicidad) a pantalla completa en su
 *      monitor externo, y la recoloca si se conectan o desconectan monitores.
 *   4. Impide que Windows apague las pantallas mientras está abierta.
 *
 * Dónde guarda las cosas (fuera del .exe, para que no se pierdan):
 *   Datos (partidos, PIN, pantallas):  %APPDATA%\StageMaster\datos
 *   Publicidad (PNG):                  Documentos\StageMaster\Publicidad
 *
 * Relación con otros archivos:
 *   → server/index.js       startServer() con el "adaptador de escritorio"
 *   → desktop/monitors.js   qué pantalla va en qué monitor (lógica pura)
 *   ← la estación cambia monitores con 'station:setMonitor' (socketServer.js)
 */

const path = require('path');
const fs   = require('fs');
const {
  app, BrowserWindow, screen, dialog, shell, powerSaveBlocker, Menu,
} = require('electron');

const monitors = require('./monitors');

const SCREEN_IDS = ['pantalla-1', 'pantalla-2'];
const BACKGROUND = '#041024';
const ICON       = path.join(__dirname, 'icon.png');

// ─────────────────────────────────────────────────────────────────
// UNA SOLA INSTANCIA (abrirla dos veces chocaría por el puerto)
// ─────────────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (stationWindow) {
      if (stationWindow.isMinimized()) stationWindow.restore();
      stationWindow.focus();
    }
  });
  app.whenReady().then(start);
}

// ─────────────────────────────────────────────────────────────────
// CARPETAS DE DATOS Y PUBLICIDAD
// ─────────────────────────────────────────────────────────────────

const dataDir = process.env.STAGEMASTER_DATA_DIR || path.join(app.getPath('userData'), 'datos');
const adsDir  = process.env.STAGEMASTER_ADS_DIR  || path.join(app.getPath('documents'), 'StageMaster', 'Publicidad');
process.env.STAGEMASTER_DATA_DIR = dataDir;
process.env.STAGEMASTER_ADS_DIR  = adsDir;

/** La primera vez crea la carpeta de publicidad con los ejemplos y las instrucciones */
function prepareAdsFolder() {
  if (fs.existsSync(adsDir)) return;
  const samples = path.join(__dirname, '..', 'publicidad');
  ['banner', 'pantalla-completa'].forEach((folder) => {
    fs.mkdirSync(path.join(adsDir, folder), { recursive: true });
    const source = path.join(samples, folder);
    if (!fs.existsSync(source)) return;
    fs.readdirSync(source).forEach((file) => {
      fs.copyFileSync(path.join(source, file), path.join(adsDir, folder, file));
    });
  });
  const readme = path.join(samples, 'LEEME.txt');
  if (fs.existsSync(readme)) fs.copyFileSync(readme, path.join(adsDir, 'LEEME.txt'));
}

// ─────────────────────────────────────────────────────────────────
// PREFERENCIAS DE MONITORES (se guardan entre usos)
// ─────────────────────────────────────────────────────────────────

const prefsFile = path.join(dataDir, 'monitores.json');

function loadPreferences() {
  try {
    return JSON.parse(fs.readFileSync(prefsFile, 'utf8')).preferences || {};
  } catch (_) {
    return {};
  }
}

function savePreferences(preferences) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(prefsFile, JSON.stringify({ preferences }));
  } catch (err) {
    console.warn('[Escritorio] No se pudieron guardar los monitores:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// VENTANAS
// ─────────────────────────────────────────────────────────────────

let baseUrl       = null;
let stationWindow = null;
let preferences   = {};
let assignments   = {};
let quitting      = false;

// pantalla → { win, target } de las ventanas abiertas
const screenWindows = new Map();
// pantallas cuya ventana cerró el operador (no se reabren solas)
const closedByUser  = new Set();
const listeners     = new Set();

function notify() {
  listeners.forEach((listener) => listener());
}

function currentMonitors() {
  return monitors.describeMonitors(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
}

/** Calcula dónde va cada pantalla y abre, mueve o cierra sus ventanas */
function applyLayout() {
  const list = currentMonitors();
  assignments = monitors.resolveAssignments(SCREEN_IDS, list, preferences);
  const stuck = monitors.stickAutoAssignments(preferences, assignments);
  if (JSON.stringify(stuck) !== JSON.stringify(preferences)) {
    preferences = stuck;
    savePreferences(preferences);
  }

  SCREEN_IDS.forEach((screenId) => {
    const target  = assignments[screenId];
    const current = screenWindows.get(screenId);

    if (!target || closedByUser.has(screenId)) {
      closeScreenWindow(screenId);
      return;
    }
    if (current && current.target === target && !current.win.isDestroyed()) {
      // Mismo sitio: solo se ajusta si el monitor cambió de tamaño o posición
      if (target !== 'window') fitToMonitor(current.win, list.find((m) => m.key === target));
      return;
    }
    closeScreenWindow(screenId);
    openScreenWindow(screenId, target, list);
  });
  notify();
}

function openScreenWindow(screenId, target, list) {
  const number = screenId.replace('pantalla-', '');
  const url    = `${baseUrl}/score.html?pantalla=${number}`;
  const monitor = list.find((m) => m.key === target);

  const win = target === 'window'
    ? new BrowserWindow({
      width: 960, height: 540, title: `StageMaster · Pantalla ${number} (ventana de prueba)`,
      backgroundColor: BACKGROUND, autoHideMenuBar: true, icon: ICON,
      webPreferences: { backgroundThrottling: false },
    })
    : new BrowserWindow({
      ...monitor.bounds, frame: false, show: false, title: `StageMaster · Pantalla ${number}`,
      backgroundColor: BACKGROUND, autoHideMenuBar: true, skipTaskbar: true,
      webPreferences: { backgroundThrottling: false },
    });

  if (target !== 'window') {
    win.once('ready-to-show', () => {
      fitToMonitor(win, monitor);
      win.show();
      win.setFullScreen(true);
    });
  }

  win.on('closed', () => {
    const record = screenWindows.get(screenId);
    if (record && record.win === win) {
      screenWindows.delete(screenId);
      // Cerrada por el operador (Alt+F4) y no por la aplicación
      if (!record.closingByApp && !quitting) closedByUser.add(screenId);
      notify();
    }
  });

  win.loadURL(url);
  screenWindows.set(screenId, { win, target, closingByApp: false });
}

function fitToMonitor(win, monitor) {
  if (!monitor || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const same = ['x', 'y', 'width', 'height'].every((k) => bounds[k] === monitor.bounds[k]);
  if (!same && !win.isFullScreen()) win.setBounds(monitor.bounds);
}

function closeScreenWindow(screenId) {
  const record = screenWindows.get(screenId);
  if (!record) return;
  record.closingByApp = true;
  screenWindows.delete(screenId);
  if (!record.win.isDestroyed()) record.win.close();
}

function openStationWindow() {
  stationWindow = new BrowserWindow({
    width: 1400, height: 900, title: 'StageMaster · Estación operadora',
    backgroundColor: BACKGROUND, autoHideMenuBar: true, show: false, icon: ICON,
  });
  stationWindow.once('ready-to-show', () => {
    stationWindow.maximize();
    stationWindow.show();
  });

  // Enlaces de la estación: páginas propias en ventana nueva; nada externo
  stationWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: BACKGROUND } };
    }
    return { action: 'deny' };
  });

  // Cerrar la estación cierra StageMaster (con confirmación)
  stationWindow.on('close', (event) => {
    if (quitting) return;
    const choice = dialog.showMessageBoxSync(stationWindow, {
      type: 'question',
      buttons: ['Cancelar', 'Cerrar StageMaster'],
      defaultId: 0,
      cancelId: 0,
      title: 'Cerrar StageMaster',
      message: '¿Cerrar StageMaster?',
      detail: 'Las pantallas se apagarán y los teléfonos de los árbitros dejarán de funcionar. ' +
        'Los marcadores quedan guardados y se recuperan al volver a abrir.',
    });
    if (choice === 0) {
      event.preventDefault();
      return;
    }
    quitting = true;
    app.quit();
  });

  stationWindow.loadURL(`${baseUrl}/station.html`);
}

// ─────────────────────────────────────────────────────────────────
// ADAPTADOR PARA EL SERVIDOR (la estación lo usa por Socket.IO)
// ─────────────────────────────────────────────────────────────────

const desktopAdapter = {
  onChange(listener) {
    listeners.add(listener);
  },

  /** Lo que ve la estación: monitores, dónde va cada pantalla, ventanas cerradas */
  getState() {
    return {
      monitors: currentMonitors().map(({ key, label, width, height, primary }) => ({ key, label, width, height, primary })),
      preferences,
      assignments,
      closed: [...closedByUser],
      adsFolder: adsDir,
    };
  },

  /** El operador elige monitor para una pantalla ('auto', id, 'window', 'none') */
  setMonitor(screenId, value) {
    try {
      preferences = monitors.choosePreference(SCREEN_IDS, currentMonitors(), preferences, screenId, value);
    } catch (err) {
      const { appError } = require('../server/core/errors');
      throw appError('INVALID_MONITOR', 'Ese monitor ya no está conectado');
    }
    savePreferences(preferences);
    closedByUser.delete(screenId);
    applyLayout();
  },

  /** Reabre una pantalla (si no tenía monitor, en una ventana de prueba) */
  openScreen(screenId) {
    closedByUser.delete(screenId);
    if (!assignments[screenId]) {
      preferences = monitors.choosePreference(SCREEN_IDS, currentMonitors(), preferences, screenId, 'window');
      savePreferences(preferences);
    }
    applyLayout();
  },

  openAdsFolder() {
    prepareAdsFolder();
    shell.openPath(adsDir);
  },
};

// ─────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────

async function start() {
  Menu.setApplicationMenu(null);
  prepareAdsFolder();
  preferences = loadPreferences();

  // El servidor se carga DESPUÉS de fijar las carpetas de datos y publicidad
  const { startServer } = require('../server/index');
  let started;
  try {
    started = await startServer({ desktop: desktopAdapter, logHttp: false });
  } catch (err) {
    dialog.showErrorBox('StageMaster no pudo arrancar',
      `${err.message}\n\n¿Hay otra copia de StageMaster abierta? Ciérrala y vuelve a intentarlo.`);
    app.quit();
    return;
  }
  baseUrl = `http://localhost:${started.port}`;
  console.log(`[Escritorio] Servidor en ${baseUrl} · datos: ${dataDir} · publicidad: ${adsDir}`);

  // Las pantallas no se apagan ni entran en reposo mientras StageMaster esté abierto
  powerSaveBlocker.start('prevent-display-sleep');

  openStationWindow();
  applyLayout();

  // Monitores conectados/desconectados en caliente
  let layoutTimer = null;
  const relayout = () => {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(applyLayout, 600);
  };
  screen.on('display-added', relayout);
  screen.on('display-removed', relayout);
  screen.on('display-metrics-changed', relayout);
}

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
