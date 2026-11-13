/**
 * appearance.js — «Colores» de la estación: elegir el tema
 *
 *   Estación y teléfonos (ui) y Pantallas LED (led), cada uno con
 *   Oscuro · Claro · Alternativo (índigo de marca). Se guarda en el
 *   servidor (core/appearance.js) y llega a todos al instante.
 */

import { ctx, send } from './context.js';
import { THEMES, THEME_LABELS } from '../common/theme.js';

const $ = (id) => document.getElementById(id);

const GROUPS = [
  { key: 'ui', title: 'Estación y teléfonos', note: 'Esta estación, los teléfonos de los árbitros y los portátiles remotos.' },
  { key: 'led', title: 'Pantallas LED', note: 'Marcador, cinta, celebración y estadísticas. En una LED, el claro deslumbra más: recomendado oscuro o alternativo.' },
];

/** Muestra de cada tema (fondo, tarjeta, acento y texto) */
const SWATCH = {
  dark:  ['#06142C', '#0C2C63', '#8FD3FF', '#FFFFFF'],
  light: ['#F0F8FC', '#FFFFFF', '#3088E4', '#1E2270'],
  alt:   ['#3C40C4', '#2A2EA2', '#84D0FC', '#FFFFFF'],
};

function render() {
  const current = (ctx.state && ctx.state.appearance) || { ui: 'dark', led: 'dark' };
  $('dlg-theme-body').innerHTML = GROUPS.map((group) => `
    <section class="theme-group">
      <h4>${group.title}</h4>
      <p class="muted">${group.note}</p>
      <div class="theme-options" role="radiogroup" aria-label="${group.title}">
        ${THEMES.map((theme) => {
          const [bg, card, accent, text] = SWATCH[theme];
          const on = current[group.key] === theme;
          return `<button type="button" class="theme-option${on ? ' is-active' : ''}" role="radio" aria-checked="${on}"
              data-theme-scope="${group.key}" data-theme-value="${theme}">
            <span class="theme-swatch" style="background:${bg}">
              <i style="background:${card};border-color:${accent}"><b style="background:${accent}"></b><b style="background:${text}"></b></i>
            </span>
            <span class="theme-name">${THEME_LABELS[theme]}</span>
          </button>`;
        }).join('')}
      </div>
    </section>`).join('');
}

export function initAppearance() {
  $('st-theme').addEventListener('click', () => { render(); $('dlg-theme').showModal(); });
  $('dlg-theme-close').addEventListener('click', () => $('dlg-theme').close());
  $('dlg-theme-body').addEventListener('click', (event) => {
    const option = event.target.closest('[data-theme-scope]');
    if (!option) return;
    send('station:appearance', { [option.dataset.themeScope]: option.dataset.themeValue }).then((res) => {
      if (res.ok && ctx.state) { ctx.state.appearance = res.appearance; render(); }
    });
  });
}

/** Llegó un estado nuevo: si el diálogo está abierto, se actualiza */
export function refreshAppearance() {
  if ($('dlg-theme').open) render();
}
