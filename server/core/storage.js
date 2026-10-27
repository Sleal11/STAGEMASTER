'use strict';

/**
 * storage.js — Persistencia en disco (archivos JSON)
 *
 * Responsabilidad ÚNICA: guardar y recuperar datos en archivos JSON dentro
 * de la carpeta data/, para que nada se pierda si el servidor se reinicia
 * en pleno evento (corte de luz, cierre accidental de la ventana...).
 *
 * Cada módulo pide su propio "almacén" con createStore():
 *   - data/matches/pista-1.json   Partido de la pista 1 (estado, versión, PIN, teléfono)
 *   - data/matches/pista-2.json   Partido de la pista 2
 *   - data/screens.json           Configuración de las pantallas
 *
 * Escritura ATÓMICA: se escribe en un archivo temporal y luego se renombra.
 * Si el PC se apaga mientras se guarda, el archivo anterior sigue intacto.
 *
 * Ubicación configurable con STAGEMASTER_DATA_DIR (las pruebas usan una
 * carpeta temporal para no tocar los datos reales).
 */

const fs   = require('fs');
const path = require('path');

/** Carpeta de datos (se lee en cada llamada para que las pruebas puedan cambiarla) */
function dataDir() {
  return process.env.STAGEMASTER_DATA_DIR || path.join(__dirname, '..', '..', 'data');
}

/**
 * Crea un almacén asociado a un archivo JSON.
 *
 * @param {string}   relativePath     - Ruta dentro de data/ (ej. 'matches/pista-1.json')
 * @param {Object}   [options]
 * @param {Function} [options.validate] - Recibe los datos leídos; devuelve true si tienen la forma esperada
 * @returns {{ file: string, load: Function, save: Function }}
 */
function createStore(relativePath, { validate = () => true } = {}) {
  const file = path.join(dataDir(), relativePath);

  /** Lee los datos guardados, o null si no hay nada válido */
  function load() {
    if (!fs.existsSync(file)) return null;

    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data || !validate(data)) throw new Error('formato inesperado');
      return data;
    } catch (err) {
      // Archivo dañado: se aparta (no se borra) para poder revisarlo
      const backup = `${file}.corrupt-${Date.now()}`;
      console.warn(`[Storage] No se pudo leer ${file} (${err.message}). Se guarda como ${path.basename(backup)}`);
      try { fs.renameSync(file, backup); } catch (_) { /* sin acción */ }
      return null;
    }
  }

  /**
   * Guarda los datos. Un fallo al guardar NUNCA debe detener el marcador:
   * se avisa en consola y los datos siguen en memoria.
   */
  function save(data) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmpFile = `${file}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
      fs.renameSync(tmpFile, file);
    } catch (err) {
      console.error(`[Storage] ⚠ No se pudo guardar ${file}: ${err.message}`);
    }
  }

  return { file, load, save };
}

/**
 * Migra un archivo de una versión anterior a su nueva ubicación
 * (ej. data/match.json de la versión de un solo partido → data/matches/pista-1.json).
 * Solo actúa si el archivo antiguo existe y el nuevo todavía no.
 */
function migrateFile(oldRelativePath, newRelativePath) {
  const oldFile = path.join(dataDir(), oldRelativePath);
  const newFile = path.join(dataDir(), newRelativePath);
  if (!fs.existsSync(oldFile) || fs.existsSync(newFile)) return false;

  fs.mkdirSync(path.dirname(newFile), { recursive: true });
  fs.renameSync(oldFile, newFile);
  console.log(`[Storage] Datos migrados: ${oldRelativePath} → ${newRelativePath}`);
  return true;
}

module.exports = { createStore, migrateFile, dataDir };
