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
 * Dos modos (mode.js):
 *   - PORTÁTIL PRINCIPAL (este archivo): servidor + estación + pantallas.
 *   - PANTALLA REMOTA (remote.js): otro portátil, lejos, que muestra
 *     pantallas del principal por la red. Se elige desde la estación
 *     («Usar este portátil como pantalla remota») y se recuerda.
 *
 * Relación con otros archivos:
 *   → server/index.js          startServer() con el "adaptador de escritorio"
 *   → desktop/screenWindows.js ventanas de las pantallas en los monitores
 *   → desktop/monitors.js      qué pantalla va en qué monitor (lógica pura)
 *   ← la estación cambia monitores con 'station:setMonitor' (socketServer.js)
 */

const path = require('path');
const fs   = require('fs');
const {
  app, BrowserWindow, screen, dialog, shell, powerSaveBlocker, Menu, session,
} = require('electron');

const { createScreenWindows } = require('./screenWindows');
const displayModes = require('./displayModes');
const firewall = require('./firewall');
const mode = require('./mode');
const { getBuildInfo, describeBuild } = require('../server/core/buildInfo');

const BUILD = getBuildInfo();
const SETTINGS = mode.loadSettings();

const BACKGROUND = '#041024';
const ICON       = path.join(__dirname, 'icon.png');

// ─────────────────────────────────────────────────────────────────
// UNA SOLA INSTANCIA (abrirla dos veces chocaría por el puerto)
//
// Si se abre StageMaster con otro ya abierto, se muestra el que estaba.
// Si el que se intenta abrir es OTRA versión (p. ej. una versión de prueba
// recién descargada), se avisa: si no, el operador seguiría usando la vieja
// sin darse cuenta.
// ─────────────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock({ version: BUILD.version, commit: BUILD.commit })) {
  app.quit();
} else {
  app.on('second-instance', (event, argv, cwd, other) => {
    const target = SETTINGS.mode === 'remote' ? require('./remote').mainWindow() : stationWindow;
    if (!target || target.isDestroyed()) return;
    if (target.isMinimized()) target.restore();
    target.focus();
    // Aviso sin bloquear: la copia que se intenta abrir se cierra al momento
    if (other && (other.version !== BUILD.version || other.commit !== BUILD.commit)) setImmediate(() => warnOtherVersion(other));
  });
  app.whenReady().then(() => (SETTINGS.mode === 'remote'
    ? require('./remote').start({ background: BACKGROUND, icon: ICON, build: BUILD, settings: SETTINGS })
    : start()));
}

function warnOtherVersion(other) {
  console.log(`[Escritorio] Se intentó abrir otra versión: ${describeBuild(other)} (abierta: ${describeBuild(BUILD)})`);
  const parent = SETTINGS.mode === 'remote' ? require('./remote').mainWindow() : stationWindow;
  dialog.showMessageBox(parent, {
    type: 'warning',
    buttons: ['Seguir con esta', 'Cerrar esta versión'],
    defaultId: 1,
    cancelId: 0,
    title: 'Otra versión de StageMaster',
    message: 'Ya hay un StageMaster abierto, de otra versión.',
    detail: `Abierto ahora: ${describeBuild(BUILD)}\nEl que intentas abrir: ${describeBuild(other)}\n\n` +
      'Solo puede haber uno abierto. Para usar el otro, cierra este y vuelve a abrirlo. ' +
      'Los partidos y la configuración se conservan.',
  }).then(({ response }) => {
    if (response !== 1) return;
    quitting = true;
    app.quit();
  });
}

// ─────────────────────────────────────────────────────────────────
// CARPETAS DE DATOS Y PUBLICIDAD
// ─────────────────────────────────────────────────────────────────

const dataDir = process.env.STAGEMASTER_DATA_DIR || path.join(app.getPath('userData'), 'datos');
const adsDir  = process.env.STAGEMASTER_ADS_DIR  || path.join(app.getPath('documents'), 'StageMaster', 'Publicidad');
process.env.STAGEMASTER_DATA_DIR = dataDir;
process.env.STAGEMASTER_ADS_DIR  = adsDir;

/**
 * Prepara la carpeta de publicidad con los ejemplos y las instrucciones.
 * Una vez por cada juego de ejemplos (marca SAMPLES_MARKER): añade los que
 * falten, nunca sustituye archivos y no vuelve a poner los que el operador
 * borre. Así quien actualiza desde una versión anterior recibe los ejemplos
 * nuevos (como el vídeo de ejemplo).
 */
const SAMPLES_MARKER = '.ejemplos-2.2';

function prepareAdsFolder() {
  try {
    const marker = path.join(adsDir, SAMPLES_MARKER);
    if (fs.existsSync(marker)) return;
    const samples = path.join(__dirname, '..', 'publicidad');
    ['banner', 'pantalla-completa'].forEach((folder) => {
      fs.mkdirSync(path.join(adsDir, folder), { recursive: true });
      const source = path.join(samples, folder);
      if (!fs.existsSync(source)) return;
      fs.readdirSync(source).forEach((file) => {
        const target = path.join(adsDir, folder, file);
        if (!fs.existsSync(target)) fs.copyFileSync(path.join(source, file), target);
      });
    });
    const readme = path.join(samples, 'LEEME.txt');
    if (fs.existsSync(readme)) fs.copyFileSync(readme, path.join(adsDir, 'LEEME.txt'));
    fs.writeFileSync(marker, 'Ejemplos de StageMaster ya copiados. Borra este archivo para volver a copiar los que falten.\n');
  } catch (err) {
    console.warn('[Escritorio] No se pudo preparar la carpeta de publicidad:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// VENTANAS
// ─────────────────────────────────────────────────────────────────

let baseUrl       = null;
let stationWindow = null;
let quitting      = false;
const listeners   = new Set();

// Pantallas en los monitores de este portátil (se cargan de su propio servidor)
const screenWindows = createScreenWindows({
  prefsFile:   path.join(dataDir, 'monitores.json'),
  urlFor:      (screenId) => baseUrl && `${baseUrl}/score.html?pantalla=${screenId.replace('pantalla-', '')}`,
  allowedBase: () => baseUrl,
  background:  BACKGROUND,
  icon:        ICON,
  onChange:    () => listeners.forEach((listener) => listener()),
});

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

  stationWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl)) event.preventDefault();
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
// RESOLUCIÓN DE LOS MONITORES (solo Windows; ver displayModes.js)
//
// Seguridad: solo se ofrecen los modos que el monitor admite; Windows los
// comprueba antes de aplicarlos; el cambio NO se guarda hasta que el
// operador lo confirma y, si no lo confirma en 15 s (p. ej. la pantalla se
// queda en negro), vuelve solo al modo anterior.
// ─────────────────────────────────────────────────────────────────

const REVERT_SECONDS = 15;
let pendingMode = null;   // { screenId, label, device, previous, next, revertAt, timer }

function modeError(message) {
  const { appError } = require('../server/core/errors');
  return appError('DISPLAY_MODE', message);
}

/** Monitor (Electron) y dispositivo (Windows) de una pantalla */
async function monitorOf(screenId) {
  if (!displayModes.supported()) throw modeError('Cambiar la resolución solo es posible en Windows');
  const monitorKey = screenWindows.getState().assignments[screenId];
  if (!monitorKey || monitorKey === 'window') throw modeError('Elige antes un monitor para esta pantalla');
  const list = screenWindows.currentMonitors();
  const monitor = list.find((m) => m.key === monitorKey);
  if (!monitor) throw modeError('Ese monitor ya no está conectado');
  if (monitor.primary) throw modeError('La resolución de la pantalla del portátil no se cambia desde aquí (en ella está la estación)');
  const device = displayModes.matchDevices(list, await windowsDevices())[monitorKey];
  if (!device) throw modeError('No se pudo identificar este monitor en Windows. Cambia la resolución en Configuración de pantalla de Windows');
  return { monitor, device };
}

/**
 * Monitores de Windows. Leerlos tarda 1-3 s (PowerShell): al abrir el diálogo de
 * resolución se leen y «Probar», justo después, reutiliza esa lectura.
 * Cualquier cambio de modo la invalida.
 */
let devicesCache = null;   // { at, devices }
const DEVICES_CACHE_MS = 60000;
async function windowsDevices({ fresh = false } = {}) {
  if (!fresh && devicesCache && Date.now() - devicesCache.at < DEVICES_CACHE_MS) return devicesCache.devices;
  const devices = await displayModes.list();
  devicesCache = { at: Date.now(), devices };
  return devices;
}

/** Un fallo de Windows (PowerShell) se explica en vez de "error interno" */
function explained(fn) {
  return (...args) => fn(...args).catch((err) => {
    throw err.code ? err : modeError(`Windows no respondió: ${err.message}`);
  });
}

async function revertPendingMode() {
  const pending = pendingMode;
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingMode = null;
  devicesCache = null;
  const result = await displayModes.apply(pending.device, pending.previous, 'dynamic').catch((err) => ({ ok: false, message: err.message }));
  if (!result.ok) console.warn('[Escritorio] No se pudo volver a la resolución anterior:', result.message);
  listeners.forEach((listener) => listener());
}

// ─────────────────────────────────────────────────────────────────
// RED: ¿PUEDEN CONECTARSE LOS TELÉFONOS? (solo Windows; ver firewall.js)
// ─────────────────────────────────────────────────────────────────

let networkCheck = null;   // último diagnóstico: { ok, rule, blocked, publicNetwork, wifi, checkedAt }

async function checkNetwork() {
  if (!firewall.supported()) return;
  try {
    networkCheck = { ...(await firewall.status()), checkedAt: Date.now() };
  } catch (err) {
    console.warn('[Escritorio] No se pudo comprobar el firewall:', err.message);
    networkCheck = { ok: null, error: err.message, checkedAt: Date.now() };
  }
  listeners.forEach((listener) => listener());
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
      ...screenWindows.getState(),
      adsFolder: adsDir,
      canUseAsRemote: true,
      network: firewall.supported() ? networkCheck : null,
      displayModes: displayModes.supported() ? {
        pending: pendingMode && { screenId: pendingMode.screenId, label: pendingMode.label, next: pendingMode.next, previous: pendingMode.previous, revertAt: pendingMode.revertAt },
      } : null,
    };
  },

  /** Vuelve a comprobar si los teléfonos pueden conectarse */
  async checkNetwork() {
    await checkNetwork();
  },

  /** «Permitir teléfonos»: Windows pide permiso de administrador y se ajusta el firewall */
  async allowPhones() {
    try {
      await firewall.allow();
    } catch (err) {
      const { appError } = require('../server/core/errors');
      throw appError('FIREWALL', err.message);
    } finally {
      await checkNetwork();
    }
  },

  /** Modos (ancho × alto @ Hz) que admite el monitor de una pantalla */
  listModes: explained(async (screenId) => {
    devicesCache = null;   // al abrir el diálogo, siempre la lista real
    const { monitor, device } = await monitorOf(screenId);
    return { monitor: monitor.label, name: device.monitor, adapter: device.adapter, current: device.current, modes: device.modes };
  }),

  /** Prueba un modo: se aplica sin guardar y vuelve solo si no se confirma */
  applyMode: explained(async (screenId, mode) => {
    if (pendingMode) throw modeError('Antes confirma o deshaz el cambio de resolución anterior');
    const { monitor, device } = await monitorOf(screenId);
    const next = device.modes.find((m) => m.width === mode.width && m.height === mode.height && m.hz === mode.hz);
    if (!next) throw modeError('Ese modo no está en la lista del monitor');
    // Comprobar y aplicar en una sola llamada a Windows (antes eran dos: tardaba el doble)
    devicesCache = null;
    const applied = await displayModes.apply(device.device, next, 'try');
    if (!applied.ok) throw modeError(applied.stage === 'test' ? `Windows no acepta ese modo: ${applied.message}` : applied.message);
    const revertAt = Date.now() + REVERT_SECONDS * 1000;
    pendingMode = {
      screenId, label: monitor.label, device: device.device, previous: device.current, next, revertAt,
      timer: setTimeout(revertPendingMode, REVERT_SECONDS * 1000),
    };
    listeners.forEach((listener) => listener());
    return { revertAt };
  }),

  /** El operador confirma que se ve bien: se guarda como definitivo */
  confirmMode: explained(async () => {
    const pending = pendingMode;
    if (!pending) throw modeError('No hay ningún cambio de resolución pendiente');
    clearTimeout(pending.timer);
    pendingMode = null;
    devicesCache = null;
    const saved = await displayModes.apply(pending.device, pending.next, 'persist');
    listeners.forEach((listener) => listener());
    if (!saved.ok) throw modeError(`Se ve, pero Windows no lo guardó (${saved.message}): al reiniciar volverá al anterior`);
  }),

  /** Volver ya al modo anterior */
  revertMode: explained(async () => {
    if (!pendingMode) throw modeError('No hay ningún cambio de resolución pendiente');
    await revertPendingMode();
  }),

  /** El servidor indica qué pantallas existen (al arrancar y al añadir o quitar una) */
  setScreens(ids) {
    // Al arrancar, la primera colocación la hace start()
    screenWindows.setScreens(ids, { relayout: !!baseUrl });
  },

  /** El operador elige monitor para una pantalla ('auto', id, 'window', 'none') */
  setMonitor(screenId, value) {
    screenWindows.setMonitor(screenId, value);
  },

  /** Reabre una pantalla (si no tenía monitor, en una ventana de prueba) */
  openScreen(screenId) {
    screenWindows.openScreen(screenId);
  },

  openAdsFolder() {
    prepareAdsFolder();
    shell.openPath(adsDir);
  },

  /** Este portátil pasa a ser una pantalla remota de otro (con confirmación) */
  useAsRemote() {
    dialog.showMessageBox(stationWindow, {
      type: 'question',
      buttons: ['Cancelar', 'Usar como pantalla remota'],
      defaultId: 0,
      cancelId: 0,
      title: 'Pantalla remota',
      message: '¿Usar este portátil como pantalla remota?',
      detail: 'StageMaster se reiniciará sin estación ni partidos: mostrará en sus monitores las pantallas ' +
        'de OTRO portátil (el principal) por la red. Necesitarás el código de enlace que aparece en la ' +
        'estación del portátil principal. Los partidos de este portátil se conservan y puedes volver ' +
        'a usarlo como principal cuando quieras.',
    }).then(({ response }) => {
      if (response !== 1) return;
      quitting = true;
      screenWindows.setQuitting();
      mode.switchMode('remote');
    });
  },
};

// ─────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────

async function start() {
  Menu.setApplicationMenu(null);
  // Nada de páginas de versiones anteriores guardadas en la caché
  await session.defaultSession.clearCache().catch(() => {});
  prepareAdsFolder();

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
  console.log(`[Escritorio] StageMaster ${describeBuild(BUILD)} · servidor en ${baseUrl} · datos: ${dataDir} · publicidad: ${adsDir}`);

  // Las pantallas no se apagan ni entran en reposo mientras StageMaster esté abierto
  powerSaveBlocker.start('prevent-display-sleep');

  openStationWindow();
  screenWindows.applyLayout();
  // ¿Podrán entrar los teléfonos? (al arrancar y cada 2 minutos: la red puede cambiar)
  checkNetwork();
  setInterval(checkNetwork, 2 * 60 * 1000).unref();

  // Monitores conectados/desconectados en caliente
  let layoutTimer = null;
  const relayout = () => {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(screenWindows.applyLayout, 600);
  };
  screen.on('display-added', relayout);
  screen.on('display-removed', relayout);
  screen.on('display-metrics-changed', relayout);
}

app.on('before-quit', () => { quitting = true; screenWindows.setQuitting(); });
app.on('window-all-closed', () => app.quit());
