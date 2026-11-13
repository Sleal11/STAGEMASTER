'use strict';

/**
 * appearance.js — Colores de la aplicación (temas) elegidos en la estación
 *
 *   ui   Estación del moderador, teléfonos de los árbitros y portátiles remotos
 *   led  Pantallas LED (marcador, cinta, celebración y estadísticas)
 *
 * Cada uno: 'dark' (oscuro, el de siempre) · 'light' (claro, de marca) ·
 * 'alt' (alternativo: índigo de marca). Se guarda en data/apariencia.json y
 * el servidor lo reparte a todos los dispositivos conectados al instante.
 */

const { createStore } = require('./storage');
const { appError }    = require('./errors');

const THEMES = ['dark', 'light', 'alt'];
const DEFAULTS = { ui: 'dark', led: 'dark' };

function createAppearance() {
  const store = createStore('apariencia.json', { validate: (data) => data && typeof data === 'object' });
  const saved = store.load() || {};
  let current = {
    ui:  THEMES.includes(saved.ui) ? saved.ui : DEFAULTS.ui,
    led: THEMES.includes(saved.led) ? saved.led : DEFAULTS.led,
  };

  /** Cambia uno o los dos temas; devuelve los nuevos */
  function update(changes = {}) {
    const next = { ...current };
    ['ui', 'led'].forEach((key) => {
      if (changes[key] === undefined) return;
      if (!THEMES.includes(changes[key])) throw appError('INVALID_APPEARANCE', 'Tema no válido');
      next[key] = changes[key];
    });
    current = next;
    store.save(current);
    return get();
  }

  const get = () => ({ ...current });

  return { get, update };
}

module.exports = { createAppearance, THEMES };
