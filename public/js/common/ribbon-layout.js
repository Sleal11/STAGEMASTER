/**
 * ribbon-layout.js — Tamaño y reparto de los logos de la cinta (compartido)
 *
 * Lo usan la pantalla (display/ribbon.js) y la vista previa de la estación
 * (station/ribbon-editor.js), así la vista previa es exactamente lo que se ve.
 *
 * Tamaño automático: todos los logos con un PESO VISUAL parecido. Un logo
 * cuadrado ocupa casi todo el alto de la cinta; uno muy ancho (p. ej. un
 * texto largo) es más bajo, porque ya se lee por su anchura. Sin esto, en
 * una LED de pocos píxeles los logos cuadrados quedaban diminutos.
 * Encima, cada logo tiene su ajuste del operador («Tamaño», 50-200 %).
 */

/** Ajuste del operador para cada logo (porcentaje sobre el tamaño automático) */
export const LOGO_SIZE = { min: 50, max: 200, step: 5, auto: 100 };

/** Separación entre logos, en altos de cinta */
export const LOGO_GAP = 0.55;

/**
 * Alto del logo como fracción del alto de la cinta
 * @param {number} aspect - ancho / alto del logo (ya sin márgenes vacíos)
 * @param {number} [size] - ajuste del operador (%)
 * @param {boolean} [single] - se muestra solo (movimiento «Cambia cada cierto tiempo»): puede ser más grande
 */
export function logoHeight(aspect, size = LOGO_SIZE.auto, single = false) {
  const a = Math.max(0.25, Number(aspect) || 1);
  let base = Math.min(0.86, Math.max(0.42, 0.62 * Math.sqrt(2.4 / a)));
  if (single) base = Math.min(0.9, base * 1.6);
  return Math.min(0.96, base * (size / 100));
}

/**
 * Reparte los elementos en grupos que caben a la vez en la cinta (movimiento
 * «Logos fijos»), respetando el orden. Un elemento más ancho que la cinta va solo.
 * @param {number[]} widths - ancho de cada elemento (en las mismas unidades que `available`)
 * @param {number} available - ancho útil de la cinta
 * @param {number} gap - separación mínima entre elementos
 * @returns {number[][]} índices de cada grupo
 */
export function paginate(widths, available, gap) {
  const pages = [];
  let page = [];
  let used = 0;
  widths.forEach((w, i) => {
    const extra = page.length ? gap + w : w;
    if (page.length && used + extra > available) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(i);
    used += page.length === 1 ? w : gap + w;
  });
  if (page.length) pages.push(page);
  return pages;
}
