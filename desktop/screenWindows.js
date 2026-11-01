'use strict';

/**
 * screenWindows.js — Ventanas de las pantallas en los monitores de ESTE portátil
 *
 * Lo usan los dos modos de la aplicación de escritorio:
 *   - Portátil principal (main.js): las pantallas se cargan de su propio servidor.
 *   - Pantalla remota (remote.js): se cargan del servidor del portátil principal.
 *
 * Abre cada pantalla a pantalla completa en su monitor (o en una ventana de
 * prueba), la recoloca si se conectan o desconectan monitores y recuerda la
 * elección del operador. La decisión de qué va en cada monitor es lógica pura
 * (monitors.js); aquí solo se aplican las ventanas.
 */

const fs = require('fs');
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const monitors = require('./monitors');

/**
 * @param {Object}   options
 * @param {string}   options.prefsFile   - Archivo donde se guardan los monitores elegidos
 * @param {Function} options.urlFor      - (screenId) → URL de la pantalla (null si aún no se puede abrir)
 * @param {Function} options.allowedBase - () → inicio de las URL permitidas en las ventanas
 * @param {string}   options.background  - Color de fondo mientras carga
 * @param {string}   [options.icon]      - Icono de las ventanas de prueba
 * @param {Function} [options.onChange]  - Avisa cuando cambian monitores, ventanas o elecciones
 * @param {string}   [options.defaultPreference] - Dónde va una pantalla nueva ('auto' si no se indica;
 *                   el portátil remoto usa 'none': solo muestra las que elige el operador)
 */
function createScreenWindows({ prefsFile, urlFor, allowedBase, background, icon, onChange = () => {}, defaultPreference = null }) {
  let screenIds   = [];
  let preferences = loadPreferences();
  let assignments = {};
  let quitting    = false;
  // pantalla → { win, target, url, closingByApp } de las ventanas abiertas
  const windows      = new Map();
  // pantallas cuya ventana cerró el operador (no se reabren solas)
  const closedByUser = new Set();

  function loadPreferences() {
    try {
      return JSON.parse(fs.readFileSync(prefsFile, 'utf8')).preferences || {};
    } catch (_) {
      return {};
    }
  }

  function savePreferences() {
    try {
      fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
      fs.writeFileSync(prefsFile, JSON.stringify({ preferences }));
    } catch (err) {
      console.warn('[Escritorio] No se pudieron guardar los monitores:', err.message);
    }
  }

  function currentMonitors() {
    return monitors.describeMonitors(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
  }

  /** Calcula dónde va cada pantalla y abre, mueve o cierra sus ventanas */
  function applyLayout() {
    const list = currentMonitors();
    assignments = monitors.resolveAssignments(screenIds, list, preferences);
    const stuck = monitors.stickAutoAssignments(preferences, assignments);
    if (JSON.stringify(stuck) !== JSON.stringify(preferences)) {
      preferences = stuck;
      savePreferences();
    }

    screenIds.forEach((screenId) => {
      const target  = assignments[screenId];
      const current = windows.get(screenId);
      const url     = urlFor(screenId);

      if (!target || !url || closedByUser.has(screenId)) {
        close(screenId);
        return;
      }
      if (current && current.target === target && current.url === url && !current.win.isDestroyed()) {
        // Mismo sitio: solo se ajusta si el monitor cambió de tamaño o posición
        if (target !== 'window') fitToMonitor(current.win, list.find((m) => m.key === target));
        return;
      }
      close(screenId);
      open(screenId, target, list, url);
    });
    // Ventanas de pantallas que ya no existen
    [...windows.keys()].filter((id) => !screenIds.includes(id)).forEach(close);
    onChange();
  }

  function open(screenId, target, list, url) {
    const number  = screenId.replace('pantalla-', '');
    const monitor = list.find((m) => m.key === target);
    // Vídeos de la lista de reproducción: arrancan solos (también con sonido)
    // y siguen a velocidad normal aunque la ventana no tenga el foco
    const webPreferences = { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' };

    // Las ventanas se muestran cuando su página ya está dibujada: nunca se ve
    // una ventana vacía (solo el color de fondo) mientras carga
    const win = target === 'window'
      ? new BrowserWindow({
        width: 960, height: 540, show: false, title: `StageMaster · Pantalla ${number} (ventana de prueba)`,
        backgroundColor: background, autoHideMenuBar: true, icon, webPreferences,
      })
      : new BrowserWindow({
        ...monitor.bounds, frame: false, show: false, title: `StageMaster · Pantalla ${number}`,
        backgroundColor: background, autoHideMenuBar: true, skipTaskbar: true, webPreferences,
      });

    let shown = false;
    const reveal = () => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      if (target === 'window') {
        win.showInactive();   // no le quita el foco a la estación
      } else {
        fitToMonitor(win, monitor);
        win.show();
        win.setFullScreen(true);
      }
    };
    win.once('ready-to-show', reveal);
    setTimeout(reveal, 8000);   // por si la página tarda: mejor verla que tenerla oculta

    // Si la página no carga (el servidor tardó en responder o la red se cortó), se reintenta sola
    win.webContents.on('did-fail-load', (event, code, description, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return;   // -3 = carga cancelada a propósito
      console.warn(`[Escritorio] ${screenId}: no cargó (${description}); reintentando…`);
      setTimeout(() => { if (!win.isDestroyed()) win.loadURL(url); }, 1500);
    });
    protect(win);

    win.on('closed', () => {
      const record = windows.get(screenId);
      if (record && record.win === win) {
        windows.delete(screenId);
        // Cerrada por el operador (Alt+F4) y no por la aplicación
        if (!record.closingByApp && !quitting) closedByUser.add(screenId);
        onChange();
      }
    });

    win.loadURL(url);
    windows.set(screenId, { win, target, url, closingByApp: false });
  }

  /**
   * Una ventana de StageMaster solo muestra páginas de StageMaster: si se suelta
   * un archivo encima o algo intenta navegar fuera, no pasa nada.
   */
  function protect(win) {
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(allowedBase())) event.preventDefault();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  function fitToMonitor(win, monitor) {
    if (!monitor || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const same = ['x', 'y', 'width', 'height'].every((k) => bounds[k] === monitor.bounds[k]);
    if (!same && !win.isFullScreen()) win.setBounds(monitor.bounds);
  }

  function close(screenId) {
    const record = windows.get(screenId);
    if (!record) return;
    record.closingByApp = true;
    windows.delete(screenId);
    if (!record.win.isDestroyed()) record.win.close();
  }

  function invalidMonitor() {
    const { appError } = require('../server/core/errors');
    return appError('INVALID_MONITOR', 'Ese monitor ya no está conectado');
  }

  return {
    applyLayout,
    currentMonitors,
    protect,

    /** Pantallas que existen (al arrancar y al añadir o quitar una) */
    setScreens(ids, { relayout = true } = {}) {
      const removed = screenIds.filter((id) => !ids.includes(id));
      screenIds = ids.slice();
      removed.forEach((id) => {
        close(id);
        closedByUser.delete(id);
        delete preferences[id];   // si se vuelve a añadir, empieza en "automático"
      });
      const added = defaultPreference ? ids.filter((id) => !(id in preferences)) : [];
      added.forEach((id) => { preferences[id] = defaultPreference; });
      if (removed.length || added.length) savePreferences();
      if (relayout) applyLayout();
    },

    /** Lo que ve la estación: monitores, dónde va cada pantalla, ventanas cerradas */
    getState() {
      return {
        monitors: currentMonitors().map(({ key, label, width, height, primary, refreshRate, scale, name }) =>
          ({ key, label, width, height, primary, refreshRate, scale, name })),
        preferences,
        assignments,
        closed: [...closedByUser],
      };
    },

    /** El operador elige monitor para una pantalla ('auto', id, 'window', 'none') */
    setMonitor(screenId, value) {
      try {
        preferences = monitors.choosePreference(screenIds, currentMonitors(), preferences, screenId, value);
      } catch (err) {
        throw invalidMonitor();
      }
      savePreferences();
      closedByUser.delete(screenId);
      applyLayout();
    },

    /** Reabre una pantalla (si no tenía monitor, en una ventana de prueba) */
    openScreen(screenId) {
      closedByUser.delete(screenId);
      if (!assignments[screenId]) {
        preferences = monitors.choosePreference(screenIds, currentMonitors(), preferences, screenId, 'window');
        savePreferences();
      }
      applyLayout();
    },

    /** Cierra todas las ventanas (p. ej. el portátil remoto pierde el enlace) */
    closeAll() {
      [...windows.keys()].forEach(close);
      onChange();
    },

    setQuitting() {
      quitting = true;
    },
  };
}

module.exports = { createScreenWindows };
