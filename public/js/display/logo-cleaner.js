/**
 * logo-cleaner.js — Logos de la cinta "sobre el mismo fondo"
 *
 * Muchos logos llegan en JPG o PNG con un recuadro blanco. Sobre el azul de
 * la cinta quedan como parches blancos. Esta función prepara una copia limpia
 * de cada imagen (en el navegador, sin tocar el archivo original):
 *
 *   1. Quita el fondo BLANCO que toca los bordes de la imagen (relleno desde
 *      los bordes): el blanco de DENTRO del logo se conserva (p. ej. las
 *      letras blancas del logo de Pepsi).
 *   2. Suaviza el borde para que no quede un halo blanco.
 *   3. Recorta los márgenes vacíos: todos los logos quedan igual de separados.
 *   4. Un logo que no contrasta con el azul de la cinta (negro, gris oscuro,
 *      azul marino…) se pasa a BLANCO. Se mide con el contraste estándar
 *      (WCAG) frente al color real de la cinta; los logos de colores vivos
 *      (rojo, naranja…) conservan su color.
 *
 * Los SVG se dibujan a alta resolución antes de procesarlos (nítidos aunque
 * el archivo no indique su tamaño).
 *
 * Si la imagen no tiene nada que limpiar, se usa la original.
 * Se activa o desactiva por pantalla (Cinta → "Quitar el fondo blanco").
 */

const MAX_SIDE      = 1600;  // las imágenes grandes se reducen antes de procesarlas
const WHITE_MIN     = 226;   // un píxel es "blanco de fondo" si R, G y B superan esto…
const WHITE_SPREAD  = 30;    // …y apenas tienen color (diferencia entre canales)
const FEATHER_MIN   = 170;   // claros junto al fondo: transparencia parcial (sin halo)
const RIBBON_LUM    = 0.015; // luminancia relativa del azul de la cinta (#08204A)
const MIN_CONTRAST  = 2.5;   // por debajo, el logo no se distingue del fondo → blanco
const SVG_SIDE      = 800;   // lado mayor al dibujar un SVG

const cache = new Map();

/** Devuelve (promesa) la URL de la versión limpia, o la original si no hace falta o falla */
export function cleanLogo(url) {
  if (!cache.has(url)) cache.set(url, process(url).catch(() => url));
  return cache.get(url);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Proporción de un SVG (viewBox o width/height); 1 si no se puede saber */
async function svgRatio(url) {
  try {
    const text = await (await fetch(url)).text();
    const viewBox = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (viewBox && +viewBox[1] > 0 && +viewBox[2] > 0) return +viewBox[1] / +viewBox[2];
    const w = text.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i);
    const h = text.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i);
    if (w && h && +w[1] > 0 && +h[1] > 0) return +w[1] / +h[1];
  } catch (_) { /* se usa 1 */ }
  return 1;
}

async function process(url) {
  const img = await loadImage(url);
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  if (/\.svg$/i.test(decodeURIComponent(url.split(/[?#]/)[0]))) {
    // Vectorial: se dibuja grande para que quede nítido
    const ratio = width && height ? width / height : await svgRatio(url);
    width = ratio >= 1 ? SVG_SIDE : Math.round(SVG_SIDE * ratio);
    height = ratio >= 1 ? Math.round(SVG_SIDE / ratio) : SVG_SIDE;
  }
  if (!width || !height) return url;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;

  const removed = removeWhiteBackground(px, width, height);
  const recolored = whitenDarkMonochrome(px);
  const box = opaqueBounds(px, width, height);
  if (!box) return url;   // quedaría vacía: mejor la original
  const cropped = box.w < width || box.h < height;
  if (!removed && !recolored && !cropped) return url;

  ctx.putImageData(image, 0, 0);
  const out = document.createElement('canvas');
  out.width = box.w;
  out.height = box.h;
  out.getContext('2d').drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return out.toDataURL('image/png');
}

/** Relleno desde los bordes: el blanco conectado al borde pasa a transparente */
function removeWhiteBackground(px, width, height) {
  const isWhite = (p) => {
    const i = p * 4;
    if (px[i + 3] < 8) return true;   // ya transparente: también es "fondo"
    const min = Math.min(px[i], px[i + 1], px[i + 2]);
    const max = Math.max(px[i], px[i + 1], px[i + 2]);
    return min >= WHITE_MIN && max - min <= WHITE_SPREAD;
  };
  const total = width * height;
  const background = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const push = (p) => { if (!background[p] && isWhite(p)) { background[p] = 1; queue[tail++] = p; } };

  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < total - width) push(p + width);
  }

  let removed = 0;
  for (let p = 0; p < total; p++) {
    if (!background[p]) continue;
    if (px[p * 4 + 3] >= 8) removed++;
    px[p * 4 + 3] = 0;
  }
  if (removed === 0) return false;

  // Borde suave: píxeles claros pegados al fondo quitado → semitransparentes
  for (let p = 0; p < total; p++) {
    if (background[p]) continue;
    const x = p % width;
    const touches = (x > 0 && background[p - 1]) || (x < width - 1 && background[p + 1]) ||
      (p >= width && background[p - width]) || (p < total - width && background[p + width]);
    if (!touches) continue;
    const i = p * 4;
    const min = Math.min(px[i], px[i + 1], px[i + 2]);
    if (min >= FEATHER_MIN) px[i + 3] = Math.round(px[i + 3] * (WHITE_MIN - min) / (WHITE_MIN - FEATHER_MIN));
  }
  return true;
}

/** Canal sRGB (0-255) → valor lineal (para la luminancia relativa WCAG) */
const linear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

/** Logo que no contrasta con la cinta → blanco (mantiene la forma y los bordes suaves) */
function whitenDarkMonochrome(px) {
  let count = 0;
  let lum = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    lum += 0.2126 * linear(px[i]) + 0.7152 * linear(px[i + 1]) + 0.0722 * linear(px[i + 2]);
    count++;
  }
  if (!count) return false;
  const contrast = (lum / count + 0.05) / (RIBBON_LUM + 0.05);
  if (contrast >= MIN_CONTRAST) return false;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    px[i] = px[i + 1] = px[i + 2] = 255;
  }
  return true;
}

/** Rectángulo que contiene lo visible, con un pequeño margen */
function opaqueBounds(px, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] < 12) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
  const x = Math.max(0, x0 - pad);
  const y = Math.max(0, y0 - pad);
  return { x, y, w: Math.min(width, x1 + pad + 1) - x, h: Math.min(height, y1 + pad + 1) - y };
}
