/**
 * brand.js — Logo de StageMaster (lo usan la estación, el teléfono y las pantallas)
 *
 * Responsabilidad ÚNICA: mostrar el logo oficial si existe.
 *   1. Busca los elementos marcados con data-brand-logo (contienen el texto
 *      "STAGEMASTER" como respaldo).
 *   2. Si img/logo-stagemaster.png carga → sustituye el texto por la imagen.
 *      Si no existe → se queda el texto (nunca se ve una imagen rota).
 *
 * Para cambiar el logo basta con reemplazar el archivo PNG. El aspecto
 * (tamaño, filtro de color) está en shared.css (.brand-logo-img).
 *
 * Uso (módulo ES): import { applyLogo } from './common/brand.js'; applyLogo();
 */

const LOGO_URL = 'img/logo-stagemaster.png';

/** Pone el logo en los elementos [data-brand-logo] de la página (o de `root`) */
export function applyLogo(root = document) {
  const slots = root.querySelectorAll('[data-brand-logo]:not(.has-logo-image)');
  if (slots.length === 0) return;

  const probe = new Image();
  probe.onload = () => {
    slots.forEach((slot) => {
      const img = document.createElement('img');
      img.src       = LOGO_URL;
      img.alt       = 'StageMaster';
      img.className = 'brand-logo-img';
      slot.textContent = '';
      slot.appendChild(img);
      slot.classList.add('has-logo-image');
    });
  };
  probe.onerror = () => {};   // Sin archivo de logo: se mantiene el texto
  probe.src = LOGO_URL;
}
