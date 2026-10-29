'use strict';

/**
 * screens.js — Pantallas de score y publicidad
 *
 * Una PANTALLA es una ventana abierta en un monitor o pantalla LED
 * (score.html?pantalla=1). Es independiente de los PARTIDOS:
 *   - Dos pantallas pueden mostrar dos partidos distintos (Pista 1 y Pista 2)
 *   - o el MISMO partido (ej. una pantalla a cada lado de la pista).
 *
 * Qué se guarda de cada pantalla y cómo se valida: ver screenConfig.js.
 *
 * Este módulo añade:
 *   - Guardado en disco (data/screens.json) y valores por defecto
 *   - Comandos del reproductor: play / pause / resume / stop
 *   - Publicidad al terminar el partido (se activa UNA vez por final)
 *   - PRESENCIA en tiempo real (no se guarda): ventanas conectadas, su
 *     resolución, la versión del marcador que han dibujado (sincronización),
 *     qué están reproduciendo y qué archivos fallan
 *
 * La publicidad nunca toca el marcador: este módulo solo recibe avisos
 * ("el partido X terminó / se reanudó") y cambia lo que muestran las pantallas.
 */

const { createStore } = require('./storage');
const { appError }    = require('./errors');
const screenConfig    = require('./screenConfig');

const DEFAULT_SCREENS = [
  { id: 'pantalla-1', label: 'Pantalla 1' },
  { id: 'pantalla-2', label: 'Pantalla 2' },
];

const MEDIA_COMMANDS = ['play', 'pause', 'resume', 'stop'];

/**
 * @param {Object}   options
 * @param {string[]} options.matchIds - Partidos existentes (para validar y asignar por defecto)
 * @param {Array}    [options.screens] - Pantallas a crear (por defecto DEFAULT_SCREENS)
 * @param {Function} [options.now]     - Reloj (las pruebas lo sustituyen)
 */
function createScreenManager({ matchIds, screens = DEFAULT_SCREENS, now = Date.now }) {
  const store = createStore('screens.json', { validate: (data) => Array.isArray(data.screens) });
  const saved = (store.load() || { screens: [] }).screens;

  // Por defecto, la pantalla N muestra el partido N (o el primero si no existe)
  const configs = new Map(screens.map((screen, index) => {
    const base = { ...screen, matchId: matchIds[index] || matchIds[0], matchIds };
    return [screen.id, screenConfig.normalizeSaved(saved.find((s) => s.id === screen.id), base)];
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

  function set(id, config) {
    configs.set(id, config);
    persist();
    return config;
  }

  /**
   * Cambia la configuración de una pantalla (validada en screenConfig.js).
   * @param {string} id
   * @param {Object} changes - Ver screenConfig.applyChanges
   * @param {Object} library - Biblioteca actual (ads.listAds()) para validar nombres
   * @returns {{ config: Object, previousMatchId: string }}
   */
  function update(id, changes, library) {
    const config = get(id);
    const next   = screenConfig.applyChanges(config, changes, { matchIds, library });

    // Otro partido, se pide el marcador o se desactiva la publicidad final: se vuelve al marcador
    if (next.matchId !== config.matchId || !next.endAds.enabled || changes.view === 'score') next.postMatch = null;
    if (next.matchId !== config.matchId) next.lastFinishKey = null;
    // Pasar a la lista de reproducción la empieza desde el principio
    if (next.view === 'media' && config.view !== 'media') {
      next.playback = 'playing';
      next.playId   = config.playId + 1;
    }
    return { config: set(id, next), previousMatchId: config.matchId };
  }

  /**
   * Reproductor de la lista a pantalla completa:
   *   play    Muestra la lista desde el principio
   *   pause   Congela el vídeo o la imagen actual (no deja la pantalla en negro)
   *   resume  Continúa donde se pausó
   *   stop    Vuelve al marcador (también termina la publicidad de fin de partido)
   */
  function command(id, name) {
    const config = get(id);
    if (!MEDIA_COMMANDS.includes(name)) throw appError('INVALID_ACTION', `Comando desconocido: ${name}`);

    const next = { ...config };
    const showingMedia = config.view === 'media' || !!config.postMatch;
    switch (name) {
      case 'play':
        next.view = 'media';
        next.playback = 'playing';
        next.playId = config.playId + 1;
        break;
      case 'pause':
      case 'resume':
        if (!showingMedia) throw appError('INVALID_ACTION', 'La pantalla no está reproduciendo publicidad');
        next.playback = name === 'pause' ? 'paused' : 'playing';
        break;
      case 'stop':
        next.view = 'score';
        next.postMatch = null;
        next.playback = 'playing';
        break;
    }
    return set(id, next);
  }

  // ── Publicidad al terminar el partido ──────────────────────────

  /**
   * El partido `matchId` acaba de terminar. `finishKey` identifica ESE final
   * (partido + versión): si llega dos veces, la segunda se ignora.
   * @returns {string[]} Pantallas que cambian
   */
  function matchFinished(matchId, finishKey) {
    const key = `${matchId}:${finishKey}`;
    const changed = [];
    configs.forEach((config, id) => {
      if (config.matchId !== matchId || config.lastFinishKey === key) return;
      const next = { ...config, lastFinishKey: key };
      // Solo si está activada AHORA; activarla después no dispara un final pasado
      if (config.endAds.enabled && config.view === 'score') {
        next.postMatch = { key, since: now() };
        next.playback  = 'playing';
        next.playId    = config.playId + 1;
        changed.push(id);
      }
      configs.set(id, next);
    });
    persist();
    return changed;
  }

  /**
   * El partido vuelve a jugarse (deshacer el último punto, partido nuevo o
   * reiniciado): las pantallas que mostraban su publicidad final vuelven al marcador.
   * @returns {string[]} Pantallas que cambian
   */
  function matchActive(matchId) {
    const changed = [];
    configs.forEach((config, id) => {
      if (config.matchId === matchId && config.postMatch) {
        configs.set(id, { ...config, postMatch: null });
        changed.push(id);
      }
    });
    if (changed.length) persist();
    return changed;
  }

  /**
   * Un archivo se borró de la carpeta: se quita de la cinta o de la lista de
   * reproducción de todas las pantallas (en vez de quedar como "falta").
   * @returns {string[]} Pantallas que cambian
   */
  function forgetAd(category, name) {
    const key = category === 'banner' ? 'ribbon' : 'media';
    const changed = [];
    configs.forEach((config, id) => {
      if (!config[key].items.includes(name)) return;
      configs.set(id, { ...config, [key]: { ...config[key], items: config[key].items.filter((n) => n !== name) } });
      changed.push(id);
    });
    if (changed.length) persist();
    return changed;
  }

  // ── Presencia ──────────────────────────────────────────────────

  function attach(id, socketId) {
    presence.get(id).set(socketId, {
      connectedAt: now(), viewport: null, renderedMatchId: null, renderedVersion: null,
      adErrors: [], playing: null, soundBlocked: false,
    });
  }

  function detach(id, socketId) {
    presence.get(id)?.delete(socketId);
  }

  /** Informe que envía la pantalla tras dibujar (datos saneados) */
  function report(id, socketId, data) {
    const entry = presence.get(id)?.get(socketId);
    if (!entry || !data || typeof data !== 'object') return;
    const text = (value, max = 200) => String(value).slice(0, max);

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
      entry.adErrors = data.adErrors.filter((e) => typeof e === 'string').slice(0, 20).map((e) => text(e));
    }
    if (data.playing === null) entry.playing = null;
    else if (data.playing && typeof data.playing === 'object') {
      entry.playing = {
        name:   text(data.playing.name || '', 120),
        kind:   data.playing.kind === 'video' ? 'video' : 'image',
        index:  Number.isInteger(data.playing.index) ? data.playing.index : 0,
        total:  Number.isInteger(data.playing.total) ? data.playing.total : 0,
        paused: data.playing.paused === true,
      };
    }
    if (typeof data.soundBlocked === 'boolean') entry.soundBlocked = data.soundBlocked;
  }

  function presenceOf(id) {
    return [...(presence.get(id) || new Map()).values()];
  }

  return {
    get,
    has:  (id) => configs.has(id),
    list: () => [...configs.values()],
    update,
    command,
    matchFinished,
    matchActive,
    forgetAd,
    attach,
    detach,
    report,
    presenceOf,
  };
}

module.exports = { createScreenManager, DEFAULT_SCREENS, MEDIA_COMMANDS };
