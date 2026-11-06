'use strict';

/**
 * screenConfig.js — Configuración de una pantalla: valores, límites y validación
 *
 * Una pantalla guarda (data/screens.json):
 *
 *   mirrorOf  null, o la pantalla de la que es ESPEJO (toma de ella el contenido:
 *             partido, vista, cinta, lista y publicidad automática; ver screens.js)
 *   matchId   Partido que muestra
 *   view      'score'  marcador (con cinta publicitaria si está activa)
 *             'media'  lista de reproducción a pantalla completa (imágenes y vídeos)
 *   ribbon    Cinta publicitaria del marcador:
 *               enabled · items (imágenes y vídeos de banner/) · texts (mensajes) ·
 *               cleanLogos (quitar el fondo blanco de los logos) ·
 *               motion ('rotate' cambia cada `interval` s | 'scroll' desplazamiento) · speed
 *   media     Lista de reproducción: items (de pantalla-completa/, en orden) ·
 *             imageSeconds (tiempo de cada imagen) · sound (vídeos con sonido)
 *   endAds    Publicidad al terminar el partido: enabled · delay (segundos que
 *             se ve el resultado antes de la lista de reproducción)
 *   pauseAds  Publicidad mientras el partido está en pausa: enabled
 *   endStats  Estadísticas al terminar el partido (se alternan con el marcador
 *             del ganador): enabled
 *   output    Formato de salida: 'fill' (todo el monitor), un formato LED de
 *             tamaño fijo (OUTPUT_FORMATS), 'custom' (width × height a mano) o
 *             un formato guardado (id 'f-…', ver formats.js), en la posición
 *             x, y del monitor. Tamaños en píxeles REALES (físicos) ·
 *             brightness: brillo de la IMAGEN que envía StageMaster (10-100 %).
 *             No es el brillo físico de los módulos LED (ese lo controla el
 *             procesador LED: ver docs/BRILLO-LED.md) ·
 *             fit: cómo ocupan la salida las imágenes y vídeos de publicidad
 *             (MEDIA_FITS). 'auto' los estira a toda la salida si su proporción
 *             es parecida (igual que el marcador, que siempre la llena) y, si es
 *             muy distinta (ej. una foto vertical), los muestra completos con
 *             un fondo difuminado
 *
 * Y el estado de reproducción (también se guarda: sobrevive a un reinicio):
 *   playback       'playing' | 'paused'
 *   playId         Sube cada vez que se pulsa "Reproducir" (la lista empieza de nuevo)
 *   postMatch      { key, since } mientras se muestra la publicidad de fin de partido
 *   lastFinishKey  Último final de partido atendido (evita activarla dos veces)
 *   pauseMedia     { key } mientras se muestra la publicidad de la pausa
 *   pauseDismissed Pausa en la que el moderador volvió al marcador (no se repite)
 *
 * Este módulo es PURO (sin disco ni red): lo usan screens.js y las pruebas.
 */

const { appError } = require('./errors');

const VIEWS          = ['score', 'media'];
const RIBBON_MOTIONS = ['rotate', 'scroll'];
const SCROLL_SPEEDS  = ['slow', 'normal', 'fast'];
const PLAYBACK       = ['playing', 'paused'];
const PRESET_ID      = /^f-[0-9a-f]{8}$/;   // formato guardado por el operador (formats.js)
/** Ajuste de la publicidad: automático · estirar · llenar recortando · completa con fondo difuminado */
const MEDIA_FITS     = ['auto', 'stretch', 'cover', 'contain'];

/** Formatos de salida. Los LED tienen proporción 2:1 y tamaño exacto en píxeles físicos */
const OUTPUT_FORMATS = {
  'fill':   { label: 'Monitor completo',          width: null, height: null },
  'led-xl': { label: 'LED XL · 832 × 416 px',     width: 832,  height: 416 },
  'led-sm': { label: 'LED pequeño · 416 × 208 px', width: 416,  height: 208 },
};

const LIMITS = {
  interval:     [3, 120],   // segundos de cada elemento de la cinta (modo "cambia")
  imageSeconds: [3, 120],   // segundos de cada imagen de la lista de reproducción
  delay:        [0, 600],   // segundos del resultado antes de la publicidad final
  offset:       [0, 7680],  // posición del formato LED dentro del monitor
  width:        [16, 7680], // tamaño personalizado (píxeles reales)
  height:       [16, 4320],
  brightness:   [10, 100],  // brillo de la imagen (%)
  texts:        10,         // mensajes de la cinta
  textLength:   120,        // caracteres por mensaje
};

/** Configuración nueva de una pantalla */
function defaultConfig({ id, label, matchId }) {
  return {
    id,
    label,
    mirrorOf: null,
    matchId,
    view:   'score',
    ribbon: { enabled: true, items: [], texts: [], motion: 'rotate', interval: 10, speed: 'normal', cleanLogos: true },
    media:  { items: [], imageSeconds: 10, sound: false },
    endAds: { enabled: false, delay: 15 },
    pauseAds: { enabled: true },
    endStats: { enabled: true },
    output: { format: 'fill', x: 0, y: 0, brightness: 100, width: 832, height: 416, fit: 'auto' },
    playback:      'playing',
    playId:        0,
    postMatch:     null,
    lastFinishKey: null,
    pauseMedia:     null,
    pauseDismissed: null,
  };
}

/**
 * Completa lo guardado en disco con los valores por defecto. Acepta también
 * los formatos anteriores y los convierte:
 *   2.0  mode / ads / adInterval
 *   2.1  ribbon.images (ahora ribbon.items, porque admite vídeos)
 * Cualquier valor dañado se sustituye por el valor por defecto.
 */
function normalizeSaved(saved, base) {
  const config = defaultConfig(base);
  if (!saved || typeof saved !== 'object') return config;

  // ── Formato 2.0 → actual ─────────────────────────────────────
  if (typeof saved.mode === 'string' && !saved.view) {
    const interval = Number.isInteger(saved.adInterval) ? saved.adInterval : 10;
    saved = {
      matchId: saved.matchId,
      view:    saved.mode === 'ads' ? 'media' : 'score',
      ribbon:  { enabled: saved.mode !== 'score', items: saved.ads?.banner, interval },
      media:   { items: saved.ads?.fullscreen, imageSeconds: interval },
    };
  }

  const pick = (value, valid, fallback) => (valid(value) ? value : fallback);
  const inRange = ([min, max]) => (v) => Number.isInteger(v) && v >= min && v <= max;
  const names = (v) => Array.isArray(v) && v.every((n) => typeof n === 'string');
  const bool = (v) => typeof v === 'boolean';
  const oneOf = (list) => (v) => list.includes(v);
  const r = saved.ribbon || {}, m = saved.media || {}, e = saved.endAds || {}, o = saved.output || {};
  const pa = saved.pauseAds || {};
  const es = saved.endStats || {};

  config.mirrorOf = typeof saved.mirrorOf === 'string' && /^pantalla-\d+$/.test(saved.mirrorOf) ? saved.mirrorOf : null;
  config.matchId = pick(saved.matchId, oneOf(base.matchIds), config.matchId);
  config.view    = pick(saved.view, oneOf(VIEWS), config.view);
  config.ribbon  = {
    enabled:  pick(r.enabled, bool, config.ribbon.enabled),
    items:    pick(r.items !== undefined ? r.items : r.images, names, []),
    texts:    pick(r.texts, names, []).slice(0, LIMITS.texts),
    motion:   pick(r.motion, oneOf(RIBBON_MOTIONS), 'rotate'),
    interval: pick(r.interval, inRange(LIMITS.interval), 10),
    speed:    pick(r.speed, oneOf(SCROLL_SPEEDS), 'normal'),
    cleanLogos: pick(r.cleanLogos, bool, true),
  };
  config.media = {
    items:        pick(m.items, names, []),
    imageSeconds: pick(m.imageSeconds, inRange(LIMITS.imageSeconds), 10),
    sound:        pick(m.sound, bool, false),
  };
  config.endAds = {
    enabled: pick(e.enabled, bool, false),
    delay:   pick(e.delay, inRange(LIMITS.delay), 15),
  };
  config.pauseAds = { enabled: pick(pa.enabled, bool, true) };
  config.endStats = { enabled: pick(es.enabled, bool, true) };
  config.output = {
    format: pick(o.format, (v) => v in OUTPUT_FORMATS || v === 'custom' || PRESET_ID.test(v), 'fill'),
    x:      pick(o.x, inRange(LIMITS.offset), 0),
    y:      pick(o.y, inRange(LIMITS.offset), 0),
    brightness: pick(o.brightness, inRange(LIMITS.brightness), 100),
    width:  pick(o.width, inRange(LIMITS.width), 832),
    height: pick(o.height, inRange(LIMITS.height), 416),
    fit:    pick(o.fit, oneOf(MEDIA_FITS), 'auto'),
  };
  copyFixedSize(config.output);
  config.playback      = pick(saved.playback, oneOf(PLAYBACK), 'playing');
  config.playId        = pick(saved.playId, Number.isInteger, 0);
  config.postMatch     = saved.postMatch && typeof saved.postMatch.key === 'string' &&
    Number.isFinite(saved.postMatch.since) ? { key: saved.postMatch.key, since: saved.postMatch.since } : null;
  config.lastFinishKey = typeof saved.lastFinishKey === 'string' ? saved.lastFinishKey : null;
  config.pauseMedia     = saved.pauseMedia && typeof saved.pauseMedia.key === 'string' ? { key: saved.pauseMedia.key } : null;
  config.pauseDismissed = typeof saved.pauseDismissed === 'string' ? saved.pauseDismissed : null;
  return config;
}

/**
 * Aplica los cambios que pide la estación, validando cada campo.
 * Solo se pueden cambiar las partes de configuración (no el estado de
 * reproducción, que cambia con los comandos de screens.js).
 *
 * @param {Object} config   - Configuración actual (no se modifica)
 * @param {Object} changes  - { matchId, view, ribbon: {...}, media: {...}, endAds: {...}, output: {...} }
 * @param {Object} context  - { matchIds, library, formats } (library = ads.listAds(),
 *                            formats = formatos guardados)
 * @returns {Object} Configuración nueva
 */
function applyChanges(config, changes, { matchIds, library, formats = [] }) {
  const fail = (message) => { throw appError('INVALID_SCREEN_CONFIG', message); };
  const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(changes)) fail('Cambios de pantalla inválidos');

  const next = {
    ...config,
    ribbon: { ...config.ribbon },
    media:  { ...config.media },
    endAds: { ...config.endAds },
    pauseAds: { ...config.pauseAds },
    endStats: { ...config.endStats },
    output: { ...config.output },
  };

  const section = (name) => {
    if (changes[name] === undefined) return null;
    if (!isObject(changes[name])) fail(`Sección inválida: ${name}`);
    return changes[name];
  };
  const integer = (value, [min, max], what) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) fail(`${what}: debe estar entre ${min} y ${max}`);
    return n;
  };
  const boolean = (value, what) => {
    if (typeof value !== 'boolean') fail(`${what}: debe ser sí o no`);
    return value;
  };
  const oneOf = (value, list, what) => {
    if (!list.includes(value)) fail(`${what} inválido: ${value}`);
    return value;
  };
  // Siempre en el orden de la carpeta (alfabético): así se reproduce y así se ve en la estación
  const files = (value, category) => {
    if (!Array.isArray(value)) fail('Selección de publicidad inválida');
    const available = library[category].map((ad) => ad.name);
    const unknown = value.filter((name) => !available.includes(name));
    if (unknown.length) fail(`Publicidad inexistente: ${unknown.join(', ')}`);
    return available.filter((name) => value.includes(name));
  };

  if (changes.matchId !== undefined) next.matchId = oneOf(changes.matchId, matchIds, 'Partido');
  if (changes.view !== undefined)    next.view    = oneOf(changes.view, VIEWS, 'Vista');

  const ribbon = section('ribbon');
  if (ribbon) {
    if (ribbon.enabled  !== undefined) next.ribbon.enabled  = boolean(ribbon.enabled, 'Cinta');
    if (ribbon.items    !== undefined) next.ribbon.items    = files(ribbon.items, 'banner');
    if (ribbon.motion   !== undefined) next.ribbon.motion   = oneOf(ribbon.motion, RIBBON_MOTIONS, 'Movimiento');
    if (ribbon.speed    !== undefined) next.ribbon.speed    = oneOf(ribbon.speed, SCROLL_SPEEDS, 'Velocidad');
    if (ribbon.interval !== undefined) next.ribbon.interval = integer(ribbon.interval, LIMITS.interval, 'Tiempo de cada elemento');
    if (ribbon.cleanLogos !== undefined) next.ribbon.cleanLogos = boolean(ribbon.cleanLogos, 'Quitar el fondo blanco');
    if (ribbon.texts !== undefined) {
      if (!Array.isArray(ribbon.texts) || ribbon.texts.some((t) => typeof t !== 'string')) fail('Mensajes inválidos');
      const texts = ribbon.texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (texts.length > LIMITS.texts) fail(`Como máximo ${LIMITS.texts} mensajes`);
      if (texts.some((t) => t.length > LIMITS.textLength)) fail(`Cada mensaje: máximo ${LIMITS.textLength} caracteres`);
      next.ribbon.texts = texts;
    }
  }

  const media = section('media');
  if (media) {
    if (media.items        !== undefined) next.media.items        = files(media.items, 'fullscreen');
    if (media.imageSeconds !== undefined) next.media.imageSeconds = integer(media.imageSeconds, LIMITS.imageSeconds, 'Tiempo de cada imagen');
    if (media.sound        !== undefined) next.media.sound        = boolean(media.sound, 'Sonido');
  }

  const endAds = section('endAds');
  if (endAds) {
    if (endAds.enabled !== undefined) next.endAds.enabled = boolean(endAds.enabled, 'Publicidad al terminar');
    if (endAds.delay   !== undefined) next.endAds.delay   = integer(endAds.delay, LIMITS.delay, 'Tiempo del resultado');
  }

  const pauseAds = section('pauseAds');
  if (pauseAds && pauseAds.enabled !== undefined) next.pauseAds.enabled = boolean(pauseAds.enabled, 'Publicidad en la pausa');

  const endStats = section('endStats');
  if (endStats && endStats.enabled !== undefined) next.endStats.enabled = boolean(endStats.enabled, 'Estadísticas al terminar');

  const output = section('output');
  if (output) {
    if (output.format !== undefined) {
      next.output.format = oneOf(output.format, Object.keys(OUTPUT_FORMATS).concat('custom', formats.map((f) => f.id)), 'Formato');
      // Formato guardado: la pantalla copia su tamaño (si se borra, sigue igual como personalizado)
      const preset = formats.find((f) => f.id === output.format);
      if (preset) Object.assign(next.output, { width: preset.width, height: preset.height });
      copyFixedSize(next.output);
    }
    if (output.width  !== undefined) next.output.width  = integer(output.width, LIMITS.width, 'Ancho');
    if (output.height !== undefined) next.output.height = integer(output.height, LIMITS.height, 'Alto');
    // Cambiar el tamaño a mano de un formato guardado o fijo (LED XL / pequeño) lo convierte en personalizado
    if (output.width !== undefined || output.height !== undefined) {
      const fixed = OUTPUT_FORMATS[next.output.format];
      const preset = PRESET_ID.test(next.output.format) && formats.find((f) => f.id === next.output.format);
      const size = fixed && fixed.width ? fixed : preset;
      if ((fixed && fixed.width) || PRESET_ID.test(next.output.format)) {
        if (!size || size.width !== next.output.width || size.height !== next.output.height) next.output.format = 'custom';
      }
    }
    if (output.x      !== undefined) next.output.x      = integer(output.x, LIMITS.offset, 'Posición X');
    if (output.y      !== undefined) next.output.y      = integer(output.y, LIMITS.offset, 'Posición Y');
    if (output.brightness !== undefined) next.output.brightness = integer(output.brightness, LIMITS.brightness, 'Brillo de la imagen');
    if (output.fit        !== undefined) next.output.fit        = oneOf(output.fit, MEDIA_FITS, 'Ajuste de la publicidad');
  }
  return next;
}

/**
 * Los formatos fijos (LED XL / pequeño) copian su tamaño en width/height: así,
 * al pasar a «Personalizado» (la estación ya no los ofrece por separado), la
 * pantalla conserva exactamente el mismo tamaño.
 */
function copyFixedSize(output) {
  const fixed = OUTPUT_FORMATS[output.format];
  if (fixed && fixed.width) Object.assign(output, { width: fixed.width, height: fixed.height });
}

/**
 * Formato de salida con su tamaño: { format, width, height, x, y, brightness, fit }
 * (width null = todo el monitor). Personalizado o guardado: su propio tamaño.
 */
function resolveOutput(output) {
  const fixed = OUTPUT_FORMATS[output.format];
  const { width, height } = fixed || output;
  return { format: output.format, width, height, x: output.x, y: output.y, brightness: output.brightness, fit: output.fit };
}

module.exports = {
  OUTPUT_FORMATS, LIMITS,
  defaultConfig, normalizeSaved, applyChanges, resolveOutput,
};
