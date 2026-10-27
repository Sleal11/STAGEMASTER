'use strict';

/**
 * screens.js — Pantallas de score y publicidad
 *
 * Una PANTALLA es una ventana de navegador abierta en un monitor externo
 * (score.html?pantalla=1). Es independiente de los PARTIDOS:
 *   - Dos pantallas pueden mostrar dos partidos distintos (Pista 1 y Pista 2)
 *   - o el MISMO partido (ej. una pantalla a cada lado de la pista).
 *
 * Por cada pantalla se guarda (data/screens.json):
 *   matchId     Partido que muestra
 *   mode        'scoreAds' (marcador + franja publicitaria)
 *               'score'    (solo marcador)
 *               'ads'      (solo publicidad a pantalla completa)
 *   ads         Archivos elegidos: { banner: [...], fullscreen: [...] }
 *   adInterval  Segundos que se muestra cada imagen
 *
 * Además se lleva la PRESENCIA en tiempo real (no se guarda): qué ventanas
 * están conectadas, su resolución, qué versión del marcador han dibujado
 * (para detectar si una pantalla está desactualizada) y errores de publicidad.
 */

const { createStore } = require('./storage');
const { appError }    = require('./errors');

const MODES = ['scoreAds', 'score', 'ads'];

const AD_INTERVAL_MIN = 3;
const AD_INTERVAL_MAX = 120;

const DEFAULT_SCREENS = [
  { id: 'pantalla-1', label: 'Pantalla 1' },
  { id: 'pantalla-2', label: 'Pantalla 2' },
];

/**
 * @param {Object}   options
 * @param {string[]} options.matchIds - Partidos existentes (para validar y asignar por defecto)
 * @param {Array}    [options.screens] - Pantallas a crear (por defecto DEFAULT_SCREENS)
 */
function createScreenManager({ matchIds, screens = DEFAULT_SCREENS }) {
  const store = createStore('screens.json', { validate: (data) => Array.isArray(data.screens) });
  const saved = (store.load() || { screens: [] }).screens;

  // Configuración: lo guardado en disco, completado con los valores por defecto.
  // Por defecto, la pantalla N muestra el partido N (o el primero si no existe).
  const configs = new Map(screens.map((screen, index) => {
    const previous = saved.find((s) => s.id === screen.id) || {};
    const config = {
      id:         screen.id,
      label:      screen.label,
      matchId:    matchIds.includes(previous.matchId) ? previous.matchId : (matchIds[index] || matchIds[0]),
      mode:       MODES.includes(previous.mode) ? previous.mode : 'scoreAds',
      ads:        {
        banner:     Array.isArray(previous.ads?.banner) ? previous.ads.banner : [],
        fullscreen: Array.isArray(previous.ads?.fullscreen) ? previous.ads.fullscreen : [],
      },
      adInterval: Number.isInteger(previous.adInterval) ? previous.adInterval : 10,
    };
    return [screen.id, config];
  }));

  // Presencia: pantalla → (socketId → datos de la ventana conectada)
  const presence = new Map(screens.map((screen) => [screen.id, new Map()]));

  function persist() {
    store.save({ screens: [...configs.values()] });
  }

  function get(id) {
    const config = configs.get(id);
    if (!config) throw appError('UNKNOWN_SCREEN', `No existe la pantalla "${id}"`);
    return config;
  }

  /**
   * Cambia la configuración de una pantalla (validando cada campo).
   * @param {string} id
   * @param {Object} changes   - Campos a cambiar: matchId, mode, ads, adInterval
   * @param {Object} adLibrary - Biblioteca actual (ads.listAds()) para validar nombres
   * @returns {{ config: Object, previousMatchId: string }}
   */
  function update(id, changes, adLibrary) {
    const config = get(id);
    const next   = { ...config, ads: { ...config.ads } };
    const fail   = (message) => { throw appError('INVALID_SCREEN_CONFIG', message); };

    if (!changes || typeof changes !== 'object') fail('Cambios de pantalla inválidos');

    if (changes.matchId !== undefined) {
      if (!matchIds.includes(changes.matchId)) fail(`Partido inexistente: ${changes.matchId}`);
      next.matchId = changes.matchId;
    }
    if (changes.mode !== undefined) {
      if (!MODES.includes(changes.mode)) fail(`Modo inválido: ${changes.mode}`);
      next.mode = changes.mode;
    }
    if (changes.adInterval !== undefined) {
      const seconds = Number(changes.adInterval);
      if (!Number.isInteger(seconds) || seconds < AD_INTERVAL_MIN || seconds > AD_INTERVAL_MAX) {
        fail(`El intervalo de publicidad debe estar entre ${AD_INTERVAL_MIN} y ${AD_INTERVAL_MAX} segundos`);
      }
      next.adInterval = seconds;
    }
    if (changes.ads !== undefined) {
      ['banner', 'fullscreen'].forEach((category) => {
        const names = changes.ads[category];
        if (names === undefined) return;
        if (!Array.isArray(names)) fail('Selección de publicidad inválida');
        const available = adLibrary[category].map((ad) => ad.name);
        const unknown   = names.filter((name) => !available.includes(name));
        if (unknown.length) fail(`Publicidad inexistente: ${unknown.join(', ')}`);
        next.ads[category] = [...new Set(names)];
      });
    }

    const previousMatchId = config.matchId;
    configs.set(id, next);
    persist();
    return { config: next, previousMatchId };
  }

  // ── Presencia ──────────────────────────────────────────────────

  function attach(id, socketId) {
    presence.get(id).set(socketId, {
      connectedAt: Date.now(), viewport: null, renderedMatchId: null, renderedVersion: null, adErrors: [],
    });
  }

  function detach(id, socketId) {
    presence.get(id)?.delete(socketId);
  }

  /** Informe que envía la pantalla tras dibujar (datos saneados) */
  function report(id, socketId, data) {
    const entry = presence.get(id)?.get(socketId);
    if (!entry || !data || typeof data !== 'object') return;

    if (data.viewport && Number.isFinite(data.viewport.width) && Number.isFinite(data.viewport.height)) {
      entry.viewport = {
        width:  Math.round(data.viewport.width),
        height: Math.round(data.viewport.height),
        dpr:    Number.isFinite(data.viewport.dpr) ? data.viewport.dpr : 1,
      };
    }
    if (typeof data.renderedMatchId === 'string' || data.renderedMatchId === null) {
      entry.renderedMatchId = data.renderedMatchId;
    }
    if (Number.isInteger(data.renderedVersion) || data.renderedVersion === null) {
      entry.renderedVersion = data.renderedVersion;
    }
    if (Array.isArray(data.adErrors)) {
      entry.adErrors = data.adErrors.filter((e) => typeof e === 'string').slice(0, 20);
    }
  }

  function presenceOf(id) {
    return [...(presence.get(id) || new Map()).values()];
  }

  return {
    get,
    has:  (id) => configs.has(id),
    list: () => [...configs.values()],
    update,
    attach,
    detach,
    report,
    presenceOf,
  };
}

module.exports = { createScreenManager, MODES, DEFAULT_SCREENS };
