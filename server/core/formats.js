'use strict';

/**
 * formats.js — Formatos de salida GUARDADOS por el operador
 *
 * Además de los formatos fijos (monitor completo, LED 832×416 y 416×208, ver
 * screenConfig.js), la estación puede usar un tamaño PERSONALIZADO (ancho ×
 * alto en píxeles reales) y guardarlo con un nombre para reutilizarlo
 * («LED pista central · 1536 × 768»). Se guardan en data/formatos.json.
 *
 * Una pantalla que usa un formato guardado copia su tamaño: si el formato se
 * borra, la pantalla pasa a «personalizado» con el mismo tamaño (no cambia
 * lo que se ve).
 */

const crypto = require('crypto');
const { createStore } = require('./storage');
const { appError }    = require('./errors');
const { LIMITS }      = require('./screenConfig');

const MAX_FORMATS = 20;
const LABEL_LENGTH = 40;

function createFormatLibrary() {
  const store = createStore('formatos.json', { validate: (data) => Array.isArray(data.formats) });
  const saved = store.load() || { formats: [] };
  const inRange = (v, [min, max]) => Number.isInteger(v) && v >= min && v <= max;
  let formats = saved.formats.filter((f) => f && /^f-[0-9a-f]{8}$/.test(f.id) && typeof f.label === 'string' &&
    inRange(f.width, LIMITS.width) && inRange(f.height, LIMITS.height));

  function persist() {
    store.save({ formats });
  }

  /**
   * Guarda un tamaño con nombre.
   * @returns {Object} { id, label, width, height }
   */
  function add({ label, width, height } = {}) {
    const fail = (message) => { throw appError('INVALID_FORMAT', message); };
    const name = String(label || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, LABEL_LENGTH);
    width = Number(width);
    height = Number(height);
    if (!name) fail('Ponle un nombre al formato');
    if (!inRange(width, LIMITS.width)) fail(`Ancho: entre ${LIMITS.width[0]} y ${LIMITS.width[1]} píxeles`);
    if (!inRange(height, LIMITS.height)) fail(`Alto: entre ${LIMITS.height[0]} y ${LIMITS.height[1]} píxeles`);
    if (formats.some((f) => f.label.toLowerCase() === name.toLowerCase())) fail(`Ya hay un formato llamado «${name}»`);
    if (formats.length >= MAX_FORMATS) fail(`Como máximo ${MAX_FORMATS} formatos guardados`);
    const format = { id: 'f-' + crypto.randomBytes(4).toString('hex'), label: name, width, height };
    formats = formats.concat(format);
    persist();
    return format;
  }

  function remove(id) {
    if (!formats.some((f) => f.id === id)) throw appError('INVALID_FORMAT', 'Ese formato ya no existe');
    formats = formats.filter((f) => f.id !== id);
    persist();
  }

  return {
    add,
    remove,
    list: () => formats.slice(),
    get:  (id) => formats.find((f) => f.id === id) || null,
  };
}

module.exports = { createFormatLibrary };
