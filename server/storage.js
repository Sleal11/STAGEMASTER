'use strict';

/**
 * storage.js — Persistencia del partido en disco
 *
 * Responsabilidad ÚNICA: guardar y recuperar el partido activo en un
 * archivo JSON, para que NO se pierda si el servidor se reinicia en
 * pleno evento (corte de luz, cierre accidental de la ventana, etc.).
 *
 * ¿Por qué un archivo y no una base de datos?
 *   Solo hay un partido activo y el estado ocupa unos pocos KB.
 *   Un archivo JSON no necesita instalar nada, funciona sin Internet
 *   y se puede abrir con cualquier editor para revisarlo.
 *
 * Escritura ATÓMICA:
 *   Se escribe primero en un archivo temporal y luego se renombra.
 *   Si el PC se apaga justo mientras se guarda, el archivo anterior
 *   sigue intacto (nunca queda un JSON a medio escribir).
 *
 * Ubicación: data/match.json (configurable con la variable de entorno
 * STAGEMASTER_DATA_DIR; las pruebas la usan para no tocar el real).
 *
 * Relación con otros archivos:
 *   ← matchManager.js llama a load() al arrancar y a save() tras cada cambio
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = process.env.STAGEMASTER_DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'match.json');

/**
 * Lee el partido guardado.
 * @returns {Object|null} { state, version } o null si no hay nada válido
 */
function load() {
  if (!fs.existsSync(DATA_FILE)) return null;

  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    // Validación mínima de la forma: si no encaja, se ignora
    if (!saved || typeof saved.version !== 'number' || !saved.state ||
        !saved.state.players || !Array.isArray(saved.state.history)) {
      throw new Error('formato inesperado');
    }
    return saved;
  } catch (err) {
    // Archivo dañado: se aparta (no se borra) para poder revisarlo
    const backup = DATA_FILE + '.corrupt-' + Date.now();
    console.warn(`[Storage] No se pudo leer ${DATA_FILE} (${err.message}). Se guarda como ${path.basename(backup)}`);
    try { fs.renameSync(DATA_FILE, backup); } catch (_) { /* sin acción */ }
    return null;
  }
}

/**
 * Guarda el partido. Un fallo al guardar NUNCA debe detener el marcador:
 * se avisa en consola y el partido sigue en memoria.
 *
 * @param {Object} state   - Estado completo (con historial, para poder deshacer tras reiniciar)
 * @param {number} version - Versión actual del partido
 */
function save(state, version) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify({ version, savedAt: new Date().toISOString(), state }));
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    console.error(`[Storage] ⚠ No se pudo guardar el partido: ${err.message}`);
  }
}

module.exports = { load, save, DATA_FILE };
