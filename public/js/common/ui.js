/**
 * ui.js — Utilidades de interfaz compartidas (estación, teléfono y pantallas)
 *
 *   esc()        Escapa texto para insertarlo en HTML (nombres escritos por personas)
 *   icon()       Icono SVG del sprite img/icons.svg
 *   fileNameOf() Nombre legible de un archivo a partir de su URL
 *   elapsed()    "12 s", "3 min", "2 h"
 */

const ICONS_URL = 'img/icons.svg';

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** <svg class="icon"> con el símbolo `name` (ver img/icons.svg) */
export function icon(name, className = '') {
  return `<svg class="icon${className ? ' ' + className : ''}" aria-hidden="true"><use href="${ICONS_URL}#${name}"></use></svg>`;
}

/** Nombre de archivo legible a partir de su URL (tolera URLs mal codificadas) */
export function fileNameOf(url) {
  const name = String(url).split('/').pop();
  try { return decodeURIComponent(name); } catch (_) { return name; }
}

export function elapsed(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return seconds + ' s';
  if (seconds < 3600) return Math.round(seconds / 60) + ' min';
  return Math.round(seconds / 3600) + ' h';
}
