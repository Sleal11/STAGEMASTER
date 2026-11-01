'use strict';

/**
 * mode.js — Modo de la aplicación de escritorio en este portátil
 *
 *   'main'    Portátil PRINCIPAL (por defecto): servidor, estación, partidos.
 *   'remote'  PANTALLA REMOTA: no tiene partidos; muestra pantallas del
 *             portátil principal por la red (ver remote.js).
 *
 * Se guarda en %APPDATA%\StageMaster\modo.json junto con los datos del
 * enlace remoto (dirección del principal, token y nombre de este portátil).
 */

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');

const file = () => path.join(app.getPath('userData'), 'modo.json');

function loadSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return { mode: data.mode === 'remote' ? 'remote' : 'main', remote: data.remote && typeof data.remote === 'object' ? data.remote : {} };
  } catch (_) {
    return { mode: 'main', remote: {} };
  }
}

function saveSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.warn('[Escritorio] No se pudo guardar el modo:', err.message);
  }
}

/** Cambia de modo y reinicia StageMaster (también el .exe portable) */
function switchMode(mode) {
  const settings = loadSettings();
  saveSettings({ ...settings, mode });
  // El .exe portable se descomprime en una carpeta temporal: se relanza el .exe original
  const execPath = process.env.PORTABLE_EXECUTABLE_FILE;
  app.relaunch(execPath ? { execPath } : undefined);
  app.exit(0);
}

module.exports = { loadSettings, saveSettings, switchMode };
