'use strict';

/**
 * monitors.js — Qué pantalla de StageMaster va en qué monitor
 *
 * Funciones PURAS (sin Electron): reciben la lista de monitores y las
 * preferencias guardadas y devuelven dónde abrir cada pantalla. Así la
 * lógica se puede probar sin monitores reales (ver monitors.test.js).
 *
 * Preferencia de cada pantalla (se guarda en disco):
 *   'auto'     → el primer monitor EXTERNO libre (valor inicial)
 *   '<id>'     → un monitor concreto (identificador de Electron)
 *   'window'   → ventana normal en el portátil (para probar sin monitores)
 *   'none'     → no mostrar
 *
 * Reglas:
 *   1. Una pantalla que ya tiene monitor NO se mueve al conectar otro
 *      monitor: las asignaciones automáticas se vuelven fijas ("stick").
 *   2. Si su monitor se desconecta, la pantalla usa otro monitor externo
 *      libre (si lo hay) sin perder su preferencia; al volver, regresa.
 *   3. Dos pantallas nunca comparten monitor: elegir el monitor de otra
 *      pantalla las INTERCAMBIA.
 *   4. El monitor principal (el del portátil) solo se usa si se elige
 *      expresamente: ahí está la estación operadora.
 */

/**
 * Normaliza la lista de monitores de Electron (screen.getAllDisplays()).
 * El principal primero; los demás de izquierda a derecha.
 */
function describeMonitors(displays, primaryId) {
  const sorted = displays.slice().sort((a, b) => {
    if (a.id === primaryId) return -1;
    if (b.id === primaryId) return 1;
    return a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y;
  });

  return sorted.map((display, index) => ({
    key:     String(display.id),
    primary: display.id === primaryId,
    label:   display.id === primaryId ? 'Pantalla del portátil' : `Monitor ${index + 1}`,
    bounds:  { ...display.bounds },
    // Resolución real en píxeles (bounds va en unidades escaladas por Windows)
    width:   Math.round(display.bounds.width * (display.scaleFactor || 1)),
    height:  Math.round(display.bounds.height * (display.scaleFactor || 1)),
  }));
}

/**
 * Calcula dónde va cada pantalla.
 * @param {string[]} screenIds   - ['pantalla-1', 'pantalla-2']
 * @param {Array}    monitors    - Resultado de describeMonitors()
 * @param {Object}   preferences - { 'pantalla-1': 'auto' | id | 'window' | 'none' }
 * @returns {Object} { 'pantalla-1': monitorKey | 'window' | null }
 */
function resolveAssignments(screenIds, monitors, preferences) {
  const keys     = monitors.map((m) => m.key);
  const external = monitors.filter((m) => !m.primary).map((m) => m.key);
  const result   = {};
  const used     = new Set();

  // 1º las preferencias de un monitor concreto que está conectado
  screenIds.forEach((id) => {
    const pref = preferences[id];
    if (keys.includes(pref) && !used.has(pref)) {
      result[id] = pref;
      used.add(pref);
    }
  });

  // Monitores "reservados" por pantallas cuyo monitor preferido existe
  const reserved = new Set(screenIds.map((id) => preferences[id]).filter((p) => keys.includes(p)));

  // 2º el resto: ventana, ninguno, o el primer externo libre
  screenIds.forEach((id) => {
    if (id in result) return;
    const pref = preferences[id] || 'auto';
    if (pref === 'window') { result[id] = 'window'; return; }
    if (pref === 'none')   { result[id] = null; return; }

    const free = external.find((key) => !used.has(key) && !reserved.has(key));
    result[id] = free || null;
    if (free) used.add(free);
  });

  return result;
}

/**
 * Regla 1: las pantallas en 'auto' que ya tienen monitor lo fijan, para que
 * conectar otro monitor después no las mueva.
 * @returns {Object} Preferencias nuevas
 */
function stickAutoAssignments(preferences, assignments) {
  const next = { ...preferences };
  Object.keys(assignments).forEach((id) => {
    const target = assignments[id];
    if ((next[id] === undefined || next[id] === 'auto') && target && target !== 'window') {
      next[id] = target;
    }
  });
  return next;
}

/**
 * El operador elige dónde va una pantalla. Si ese monitor lo usa otra
 * pantalla, se intercambian (regla 3).
 * @param {string} value - id de monitor, 'window', 'none' o 'auto'
 * @returns {Object} Preferencias nuevas
 */
function choosePreference(screenIds, monitors, preferences, screenId, value) {
  const valid = ['auto', 'window', 'none'].concat(monitors.map((m) => m.key));
  if (!valid.includes(value)) {
    const err = new Error('Monitor no disponible');
    err.code = 'INVALID_MONITOR';
    throw err;
  }

  const current = resolveAssignments(screenIds, monitors, preferences);
  const next    = { ...preferences, [screenId]: value };

  if (monitors.some((m) => m.key === value)) {
    screenIds.forEach((other) => {
      if (other !== screenId && current[other] === value) {
        // La otra pantalla pasa al sitio que tenía esta (o a ninguno)
        next[other] = current[screenId] || 'none';
      }
    });
  }
  return next;
}

module.exports = { describeMonitors, resolveAssignments, stickAutoAssignments, choosePreference };
