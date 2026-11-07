/**
 * collapse.js — Apartados que se pueden minimizar en el Panel
 *
 * Secciones (Pistas y partidos, Pantallas LED, Portátiles remotos), el acceso
 * de los árbitros y cada tarjeta (una pista o una pantalla) se pliegan con su
 * botón ⌄. Útil si solo se usa una pista o una pantalla: lo que no se usa queda
 * en una línea con su resumen. Lo plegado se recuerda en este portátil
 * (localStorage), también al cerrar y abrir StageMaster.
 *
 * Marcado:
 *   data-collapsible="id"  el elemento que se pliega (recibe .is-collapsed)
 *   data-collapse="id"     el botón que lo pliega / despliega
 * Un botón de plegar NO lleva data-action: los demás módulos lo ignoran.
 */

import { icon } from '../common/ui.js';

const STORAGE_KEY = 'stagemaster.plegados';

function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []);
  } catch (_) {
    return new Set();
  }
}

const collapsed = read();

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed])); } catch (_) { /* sin almacenamiento: solo esta sesión */ }
}

export const isCollapsed = (id) => collapsed.has(id);

/**
 * Botón ⌄ / ⌃ para plegar un apartado
 * @param {string} id    - El mismo que su data-collapsible
 * @param {string} what  - Nombre para el texto accesible (ej. «Pista 1»)
 */
export function collapseButton(id, what) {
  const folded = collapsed.has(id);
  const text = `${folded ? 'Mostrar' : 'Minimizar'} ${what}`;
  return `<button type="button" class="collapse-btn" data-collapse="${id}" aria-expanded="${!folded}" title="${text}" aria-label="${text}">` +
    `${icon('chevron')}</button>`;
}

/** Aplica el estado (clase y botón) a todo lo plegable que haya en la página */
function applyCollapsed(root = document) {
  root.querySelectorAll('[data-collapsible]').forEach((el) => {
    el.classList.toggle('is-collapsed', collapsed.has(el.dataset.collapsible));
  });
  root.querySelectorAll('[data-collapse]').forEach((button) => {
    const folded = collapsed.has(button.dataset.collapse);
    button.setAttribute('aria-expanded', String(!folded));
    const what = (button.getAttribute('aria-label') || '').replace(/^(Mostrar|Minimizar) /, '');
    const text = `${folded ? 'Mostrar' : 'Minimizar'} ${what}`;
    button.title = text;
    button.setAttribute('aria-label', text);
  });
}

/** Despliega (p. ej. «Ir a la pantalla» desde En vivo: que se vea lo que se busca) */
export function expand(...ids) {
  let changed = false;
  ids.forEach((id) => { if (collapsed.delete(id)) changed = true; });
  if (changed) { save(); applyCollapsed(); }
}

export function initCollapse() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-collapse]');
    if (!button) return;
    const id = button.dataset.collapse;
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    save();
    applyCollapsed();
  });
  applyCollapsed();
}
