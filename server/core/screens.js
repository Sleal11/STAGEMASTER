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
 *   - Lista DINÁMICA: se añaden y quitan pantallas (de 1 a MAX_SCREENS)
 *   - ESPEJOS: una pantalla puede mostrar exactamente lo mismo que otra
 *     (mismo partido, misma publicidad, mismo instante de la lista) con su
 *     propio formato de salida. Ej.: dos LED a cada lado de la pista.
 *   - Comandos del reproductor: play / pause / resume / stop
 *   - Publicidad al terminar el partido (se activa UNA vez por final)
 *   - Publicidad mientras el partido está en pausa (vuelve al marcador al reanudar)
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
const MAX_SCREENS    = 8;

/**
 * Lo que un espejo toma de su pantalla origen. Lo demás (id, nombre, formato
 * de salida y brillo) es propio de cada pantalla.
 */
const CONTENT_FIELDS = ['matchId', 'view', 'ribbon', 'media', 'endAds', 'pauseAds', 'endStats', 'playback', 'playId',
  'postMatch', 'lastFinishKey', 'pauseMedia', 'pauseDismissed'];

const screenNumber = (id) => Number(String(id).replace('pantalla-', ''));

/**
 * @param {Object}   options
 * @param {string[]} options.matchIds - Partidos existentes (para validar y asignar por defecto)
 * @param {Array}    [options.screens] - Pantallas a crear (por defecto DEFAULT_SCREENS)
 * @param {Function} [options.now]     - Reloj (las pruebas lo sustituyen)
 */
function createScreenManager({ matchIds, screens = DEFAULT_SCREENS, now = Date.now }) {
  const store = createStore('screens.json', { validate: (data) => Array.isArray(data.screens) });
  const saved = (store.load() || { screens: [] }).screens
    .filter((s) => s && /^pantalla-[1-9]\d*$/.test(s.id) && screenNumber(s.id) <= MAX_SCREENS);

  // Las pantallas guardadas (si el operador añadió o quitó alguna) o las de por defecto
  const initial = saved.length
    ? saved.map((s) => ({ id: s.id, label: `Pantalla ${screenNumber(s.id)}` }))
    : screens;

  const configs  = new Map();
  // Presencia: pantalla → (socketId → datos de la ventana conectada)
  const presence = new Map();
  initial.forEach((screen) => {
    configs.set(screen.id, screenConfig.normalizeSaved(saved.find((s) => s.id === screen.id), baseFor(screen)));
    presence.set(screen.id, new Map());
  });
  // Espejos rotos (su origen ya no existe o también es espejo): pasan a ser independientes
  configs.forEach((config, id) => {
    const source = config.mirrorOf && configs.get(config.mirrorOf);
    if (config.mirrorOf && (!source || source.mirrorOf || config.mirrorOf === id)) configs.set(id, { ...config, mirrorOf: null });
  });
  sortConfigs();

  /** Por defecto, la pantalla N muestra el partido N (o el primero si no existe) */
  function baseFor({ id, label }) {
    return { id, label, matchId: matchIds[screenNumber(id) - 1] || matchIds[0], matchIds };
  }

  /** Orden: Pantalla 1, 2, 3… */
  function sortConfigs() {
    const sorted = [...configs.entries()].sort((a, b) => screenNumber(a[0]) - screenNumber(b[0]));
    configs.clear();
    sorted.forEach(([id, config]) => configs.set(id, config));
  }

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

  /** Pantalla de la que toma el contenido (ella misma si no es espejo) */
  function sourceId(id) {
    return get(id).mirrorOf || id;
  }

  /**
   * Configuración que de verdad se ve: la propia, con el contenido de su
   * origen si es un espejo.
   */
  function effective(id) {
    const config = get(id);
    if (!config.mirrorOf) return config;
    const source = get(config.mirrorOf);
    const merged = { ...config };
    CONTENT_FIELDS.forEach((field) => { merged[field] = source[field]; });
    return merged;
  }

  /** Espejos de una pantalla */
  function mirrorsOf(id) {
    return [...configs.values()].filter((c) => c.mirrorOf === id).map((c) => c.id);
  }

  /** La pantalla y sus espejos: todas las que cambian cuando cambia su contenido */
  function withMirrors(ids) {
    const all = new Set();
    ids.forEach((id) => { all.add(id); mirrorsOf(id).forEach((m) => all.add(m)); });
    return [...all];
  }

  /**
   * Cambia la configuración de una pantalla (validada en screenConfig.js).
   *   mirrorOf: 'pantalla-N' la convierte en espejo de otra; null, en independiente
   *             (conserva el contenido que estaba mostrando).
   * Un espejo solo cambia su salida; su contenido se cambia en la pantalla origen.
   * @param {string} id
   * @param {Object} changes - Ver screenConfig.applyChanges
   * @param {Object} library - Biblioteca actual (ads.listAds()) para validar nombres
   * @param {Array}  [formats] - Formatos guardados (formats.js) que se pueden elegir
   * @returns {{ config: Object, previousMatchId: string }} previousMatchId: partido que se veía antes
   */
  function update(id, changes, library, formats = []) {
    const before = effective(id);
    let config = get(id);
    const isObject = changes && typeof changes === 'object' && !Array.isArray(changes);
    // Primero se valida todo; solo se guarda si todos los cambios son válidos
    if (isObject && changes.mirrorOf !== undefined) config = mirrorChange(id, changes.mirrorOf);
    const rest = isObject ? { ...changes } : changes;   // no es un objeto: applyChanges lo rechaza
    if (isObject) delete rest.mirrorOf;
    if (isObject && config.mirrorOf && CONTENT_FIELDS.some((field) => rest[field] !== undefined)) {
      throw appError('INVALID_SCREEN_CONFIG',
        `${config.label} es un espejo de ${get(config.mirrorOf).label}: su contenido se cambia en ${get(config.mirrorOf).label}`);
    }
    const next = screenConfig.applyChanges(config, rest, { matchIds, library, formats });

    // Otro partido, se pide el marcador o se desactiva la publicidad final: se vuelve al marcador
    if (next.matchId !== config.matchId || !next.endAds.enabled || rest.view === 'score') next.postMatch = null;
    if (next.matchId !== config.matchId || !next.pauseAds.enabled) next.pauseMedia = null;
    if (rest.view === 'score' && config.pauseMedia) {
      next.pauseMedia = null;
      next.pauseDismissed = config.pauseMedia.key;
    }
    if (next.matchId !== config.matchId) next.lastFinishKey = null;
    // Pasar a la lista de reproducción la empieza desde el principio
    if (next.view === 'media' && config.view !== 'media') {
      next.playback = 'playing';
      next.playId   = config.playId + 1;
    }
    set(id, next);
    return { config: effective(id), previousMatchId: before.matchId };
  }

  /**
   * Configuración de la pantalla como espejo de otra (o independiente con
   * null), sin guardarla todavía. Sin cadenas: el origen no puede ser espejo,
   * y una pantalla con espejos no puede convertirse en espejo.
   */
  function mirrorChange(id, target) {
    const config = get(id);
    if (target === null || target === '') {
      if (!config.mirrorOf) return config;
      // Pasa a ser independiente mostrando lo mismo que mostraba
      return { ...effective(id), mirrorOf: null };
    }
    const fail = (message) => { throw appError('INVALID_SCREEN_CONFIG', message); };
    if (typeof target !== 'string' || !configs.has(target)) fail('Pantalla origen inexistente');
    if (target === id) fail('Una pantalla no puede ser espejo de sí misma');
    if (get(target).mirrorOf) fail(`${get(target).label} ya es un espejo: elige la pantalla original`);
    if (mirrorsOf(id).length) fail(`${config.label} tiene espejos: no puede ser espejo de otra`);
    return { ...config, mirrorOf: target };
  }

  /**
   * Añade una pantalla (la primera numeración libre: Pantalla 3, 4…).
   * @returns {Object} Configuración nueva
   */
  function add() {
    if (configs.size >= MAX_SCREENS) {
      throw appError('SCREEN_LIMIT', `Como máximo ${MAX_SCREENS} pantallas`);
    }
    let n = 1;
    while (configs.has(`pantalla-${n}`)) n += 1;
    const id = `pantalla-${n}`;
    configs.set(id, screenConfig.defaultConfig(baseFor({ id, label: `Pantalla ${n}` })));
    presence.set(id, new Map());
    sortConfigs();
    persist();
    return get(id);
  }

  /**
   * Quita una pantalla (siempre queda al menos una). Sus espejos pasan a ser
   * independientes y siguen mostrando lo mismo.
   * @returns {{ removed: Object, released: string[] }} released: espejos liberados
   */
  function remove(id) {
    const config = get(id);
    if (configs.size <= 1) throw appError('INVALID_ACTION', 'Tiene que quedar al menos una pantalla');
    const released = mirrorsOf(id);
    released.forEach((mirrorId) => configs.set(mirrorId, { ...effective(mirrorId), mirrorOf: null }));
    configs.delete(id);
    presence.delete(id);
    persist();
    return { removed: config, released };
  }

  /**
   * Reproductor de la lista a pantalla completa:
   *   play    Muestra la lista desde el principio
   *   pause   Congela el vídeo o la imagen actual (no deja la pantalla en negro)
   *   resume  Continúa donde se pausó
   *   stop    Vuelve al marcador (también termina la publicidad de fin de partido)
   */
  function command(id, name) {
    // En un espejo, el reproductor es el de su origen (se ven sincronizados)
    id = sourceId(id);
    const config = get(id);
    if (!MEDIA_COMMANDS.includes(name)) throw appError('INVALID_ACTION', `Comando desconocido: ${name}`);

    const next = { ...config };
    const showingMedia = config.view === 'media' || !!config.postMatch || !!config.pauseMedia;
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
        // En una pausa: el marcador vuelve y no se insiste hasta la próxima pausa
        if (config.pauseMedia) next.pauseDismissed = config.pauseMedia.key;
        next.pauseMedia = null;
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
      if (config.mirrorOf || config.matchId !== matchId || config.lastFinishKey === key) return;
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
      if (!config.mirrorOf && config.matchId === matchId && config.postMatch) {
        configs.set(id, { ...config, postMatch: null });
        changed.push(id);
      }
    });
    if (changed.length) persist();
    return changed;
  }

  /**
   * El partido `matchId` entra en pausa (`pauseKey` identifica ESA pausa) o
   * sale de ella (`pauseKey` null). Las pantallas que lo muestran con la
   * opción activada pasan a la publicidad y vuelven al marcador al reanudar.
   * Repetir el mismo aviso no cambia nada.
   * @returns {string[]} Pantallas que cambian
   */
  function matchPauseChanged(matchId, pauseKey) {
    const changed = [];
    configs.forEach((config, id) => {
      if (config.mirrorOf || config.matchId !== matchId) return;
      let next = null;
      if (!pauseKey) {
        if (config.pauseMedia || config.pauseDismissed) next = { ...config, pauseMedia: null, pauseDismissed: null };
      } else if (config.pauseAds.enabled && config.view === 'score' && !config.pauseMedia &&
                 config.pauseDismissed !== pauseKey) {
        next = { ...config, pauseMedia: { key: pauseKey }, playback: 'playing', playId: config.playId + 1 };
      }
      if (next) {
        configs.set(id, next);
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

  /**
   * Se borró un formato guardado: las pantallas que lo usaban pasan a
   * «personalizado» con el mismo tamaño (no cambia lo que se ve).
   * @returns {string[]} Pantallas que cambian
   */
  function forgetFormat(formatId) {
    const changed = [];
    configs.forEach((config, id) => {
      if (config.output.format !== formatId) return;
      configs.set(id, { ...config, output: { ...config.output, format: 'custom' } });
      changed.push(id);
    });
    if (changed.length) persist();
    return changed;
  }

  // ── Presencia ──────────────────────────────────────────────────

  /** extra.remote: nombre del portátil remoto que la muestra (null = este portátil) */
  function attach(id, socketId, extra = {}) {
    if (!presence.has(id)) return;
    presence.get(id).set(socketId, {
      remote: extra.remote || null,
      connectedAt: now(), viewport: null, window: null, renderedMatchId: null, renderedVersion: null,
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
    // Tamaño de la ventana (el monitor): para avisar si el formato LED no cabe
    if (data.window && Number.isFinite(data.window.width) && Number.isFinite(data.window.height)) {
      entry.window = { width: Math.round(data.window.width), height: Math.round(data.window.height) };
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

  /** La ventana que lleva más tiempo mostrando la pantalla (a la que sigue «En vivo») */
  function leaderOf(id) {
    const first = (presence.get(id) || new Map()).keys().next();
    return first.done ? null : first.value;
  }

  function presenceOf(id) {
    return [...(presence.get(id) || new Map()).values()];
  }

  return {
    get,
    effective,
    sourceId,
    mirrorsOf,
    withMirrors,
    has:  (id) => configs.has(id),
    ids:  () => [...configs.keys()],
    list: () => [...configs.values()],
    update,
    add,
    remove,
    command,
    matchFinished,
    matchActive,
    matchPauseChanged,
    forgetAd,
    forgetFormat,
    attach,
    detach,
    report,
    presenceOf,
    leaderOf,
  };
}

module.exports = { createScreenManager, MAX_SCREENS };
