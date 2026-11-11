/**
 * logo-cleaner.js — Logos de la cinta "sobre el mismo fondo"
 *
 * Muchos logos llegan en JPG o PNG con un recuadro blanco. Sobre el azul de
 * la cinta quedan como parches blancos. Esta función prepara una copia limpia
 * de cada imagen (en el navegador, sin tocar el archivo original):
 *
 *   1. Quita el FONDO que rodea al logo desde los bordes de la imagen, sea
 *      blanco, negro, de color, un degradado o una foto (2.10.1: los logos
 *      tipo «sticker» en JPG): el blanco o el color de DENTRO del logo se
 *      conserva (p. ej. las letras blancas del logo de Pepsi).
 *   2. Suaviza el borde para que no quede un halo del fondo.
 *   3. Recorta los márgenes vacíos: todos los logos quedan igual de separados.
 *   4. Las partes grises o negras (sin color) que no se distinguirían del fondo
 *      de la cinta se aclaran (cinta oscura) o se oscurecen (cinta clara): el
 *      texto negro de un logo de colores se lee y los colores se conservan.
 *   5. Un logo entero que no contrasta con la cinta (negro, gris oscuro,
 *      azul marino… sobre la oscura; blanco o crema sobre la clara) pasa a
 *      BLANCO o a AZUL TINTA. Se mide con el contraste estándar (WCAG) frente
 *      al color real de la cinta; los logos de colores vivos conservan su color.
 *
 * Los SVG se dibujan a alta resolución antes de procesarlos (nítidos aunque
 * el archivo no indique su tamaño).
 *
 * REALCE de cada logo (2.10, «Realce» en la estación; `effect`):
 *   - 'auto'    (por defecto): si una parte importante del logo apenas se
 *               distingue de la cinta (letras marrones, plateadas…), se aclara
 *               con una curva SUAVE que conserva el relieve (logos metálicos).
 *   - 'define'  «Definir»: las partes que no contrastan se aclaran (cinta
 *               oscura) u oscurecen (clara) conservando su tono, hasta leerse.
 *   - 'outline' «Contorno»: un borde blanco alrededor de todo el logo (azul
 *               tinta en la cinta clara): la silueta se lee siempre.
 *   - 'both'    Definir + contorno.   - 'none' «Sin realce».
 *
 * Si la imagen no tiene nada que limpiar, se usa la original.
 * Siempre activo (2.9): todos los logos sobre el mismo fondo, el de la cinta
 * («Fondo de la cinta»: oscuro o claro, en la estación).
 */

const MAX_SIDE      = 1600;  // las imágenes grandes se reducen antes de procesarlas…
const MAX_HEIGHT    = 600;   // …y a este alto (en la cinta un logo no pasa de ~350 px en 1080p):
                             // igual de nítido y hasta 5 veces más rápido
const WHITE_MIN     = 226;   // un píxel es "blanco de fondo" si R, G y B superan esto…
const WHITE_SPREAD  = 30;    // …y apenas tienen color (diferencia entre canales)
const BG_STEP       = 26;    // fondo: diferencia máxima de color entre dos píxeles vecinos
const BG_RANGE      = 64;    // …y respecto al color del borde del que parte (no se cuela en el logo)
const BG_SEED_SHARE = 0.05;  // un color del borde es «de fondo» si ocupa al menos esto del borde
const BG_MIN_LEFT   = 0.03;  // si al quitar el fondo queda menos de esto, no se quita nada
/** Fondos de la cinta: luminancia relativa (WCAG) y color al que pasa lo que no se ve */
const BACKGROUNDS = {
  dark:  { lum: 0.015, ink: [255, 255, 255] },   // azul de la cinta (#08204A) → blanco
  light: { lum: 0.86,  ink: [11, 31, 68] },      // blanco de la cinta clara → azul tinta (#0B1F44)
};
const MIN_CONTRAST  = 2.5;   // por debajo, el logo entero no se distingue del fondo
const PART_CONTRAST = 1.7;   // por debajo, una parte gris/negra no se ve: se aclara u oscurece
const GREY_SPREAD   = 46;    // diferencia máxima entre canales para considerar "sin color"
const SVG_SIDE      = 800;   // lado mayor al dibujar un SVG
/**
 * «Definir»: contraste mínimo de cada parte con la cinta para leerse en una LED.
 * Un color vivo (rojo, verde, dorado intenso) se ve con menos contraste que
 * un gris o un color apagado (marrón, plateado, azul marino).
 */
const DEFINE_CONTRAST = { grey: 9, muted: 5, vivid: 2.2 };
const GENTLE_CONTRAST = 3.5; // «Automático»: contraste al que llega lo más oscuro (curva suave)
const AUTO_DEFINE   = 0.1;   // «Auto»: se define si al menos esta parte del logo no se lee
const OUTLINE       = 0.022; // grosor del contorno (fracción del lado menor del logo)

/** Realces de un logo (el primero es el de por defecto) */
export const LOGO_EFFECTS = ['auto', 'none', 'define', 'outline', 'both'];

const cache = new Map();

/**
 * Devuelve (promesa) la URL de la versión limpia, o la original si no hace falta o falla
 * @param {'dark'|'light'} [background] - fondo de la cinta
 * @param {string} [effect] - realce del logo (LOGO_EFFECTS)
 */
export function cleanLogo(url, background = 'dark', effect = 'auto') {
  const bg = BACKGROUNDS[background] ? background : 'dark';
  const fx = LOGO_EFFECTS.includes(effect) ? effect : 'auto';
  const key = bg + '|' + fx + '|' + url;
  if (!cache.has(key)) cache.set(key, process(url, BACKGROUNDS[bg], fx).catch(() => url));
  return cache.get(key);
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

async function process(url, bg, fx) {
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
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height), MAX_HEIGHT / height);
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;

  // Un logo que ya tiene el fondo transparente no necesita quitar el fondo
  // (antes, en un logo BLANCO sobre transparente, se comía el propio logo)
  const removed = hasTransparentBorder(px, width, height) ? false : removeBackground(px, width, height);
  const recolored = adaptToBackground(px, bg, width, height);
  const define = fx === 'define' || fx === 'both' || (fx === 'auto' && hiddenShare(px, bg, width, height) >= AUTO_DEFINE);
  const defined = define && defineParts(px, bg, width, height, fx === 'auto');
  const outline = fx === 'outline' || fx === 'both';
  const box = opaqueBounds(px, width, height);
  if (!box) return url;   // quedaría vacía: mejor la original
  const cropped = box.w < width || box.h < height;
  if (!removed && !recolored && !defined && !outline && !cropped) return url;

  ctx.putImageData(image, 0, 0);
  let out = document.createElement('canvas');
  out.width = box.w;
  out.height = box.h;
  out.getContext('2d').drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  if (outline) out = withOutline(out, bg.ink);
  return out.toDataURL('image/png');
}

/**
 * Quita el FONDO del logo: lo que rodea al logo desde los bordes de la imagen,
 * sea del color que sea («varita mágica» desde los bordes):
 *   - Semillas: los píxeles del borde de los colores que dominan el borde (así
 *     una letra que toca el borde no cuenta como fondo).
 *   - El fondo se extiende a cada vecino de color parecido (BG_STEP) que no se
 *     aleje demasiado del color del borde del que parte (BG_RANGE): sigue
 *     degradados, fotos desenfocadas y el ruido del JPG; se detiene en el
 *     contorno del logo aunque esté difuminado.
 *   - El blanco conectado al borde también es fondo (como antes).
 *   - Si casi no quedara nada (la imagen ERA el anuncio, p. ej. un banner a
 *     sangre), no se quita nada.
 *   - Restos: líneas finas pegadas al borde (marcos, el borde de una captura)
 *     y motas sueltas de unos pocos píxeles.
 *   - Borde suave: lo que se parece al fondo quitado queda semitransparente.
 * @returns {boolean} se quitó algo
 */
function removeBackground(px, width, height) {
  const total = width * height;
  const colorAt = (p) => (px[p * 4] >> 5) << 6 | (px[p * 4 + 1] >> 5) << 3 | (px[p * 4 + 2] >> 5);
  const isWhite = (p) => {
    const i = p * 4;
    if (px[i + 3] < 8) return true;   // ya transparente: también es "fondo"
    const min = Math.min(px[i], px[i + 1], px[i + 2]);
    const max = Math.max(px[i], px[i + 1], px[i + 2]);
    return min >= WHITE_MIN && max - min <= WHITE_SPREAD;
  };
  const near = (p, q, limit) => {
    const i = p * 4, j = q * 4;
    const dr = px[i] - px[j], dg = px[i + 1] - px[j + 1], db = px[i + 2] - px[j + 2];
    return dr * dr + dg * dg + db * db <= limit * limit;
  };

  // Colores dominantes del borde (cajas de 32 niveles por canal)
  const borderPixels = [];
  for (let x = 0; x < width; x++) borderPixels.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) borderPixels.push(y * width, y * width + width - 1);
  const counts = new Map();
  borderPixels.forEach((p) => { const c = colorAt(p); counts.set(c, (counts.get(c) || 0) + 1); });
  // (un blanco que solo asoma por el borde, p. ej. la cinta de un sticker, no es fondo)
  const dominant = (p) => px[p * 4 + 3] < 8 || counts.get(colorAt(p)) >= borderPixels.length * BG_SEED_SHARE;

  const background = new Uint8Array(total);
  const queue = new Int32Array(total);
  const origin = new Int32Array(total);   // píxel del borde del que viene cada píxel de fondo
  let head = 0;
  let tail = 0;
  borderPixels.forEach((p) => { if (!background[p] && dominant(p)) { background[p] = 1; origin[p] = p; queue[tail++] = p; } });
  // Parecido al vecino Y a su color de partida: el fondo no «se cuela» en el logo
  // por un borde suave (difuminado del JPG), por mucho que cada paso sea pequeño
  const grow = (from, p) => {
    if (background[p]) return;
    if ((near(from, p, BG_STEP) && near(origin[from], p, BG_RANGE)) || (isWhite(p) && isWhite(from))) {
      background[p] = 1;
      origin[p] = origin[from];
      queue[tail++] = p;
    }
  };
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    if (x > 0) grow(p, p - 1);
    if (x < width - 1) grow(p, p + 1);
    if (p >= width) grow(p, p - width);
    if (p < total - width) grow(p, p + width);
  }
  if (total - tail < total * BG_MIN_LEFT) return false;   // no era un fondo: era el anuncio entero

  removeLeftovers(px, background, width, height);
  let removed = 0;
  for (let p = 0; p < total; p++) {
    if (!background[p]) continue;
    if (px[p * 4 + 3] >= 8) removed++;
    px[p * 4 + 3] = 0;
  }
  if (removed === 0) return false;

  // Borde suave: los píxeles del logo pegados al fondo y de color parecido → semitransparentes
  for (let p = 0; p < total; p++) {
    if (background[p]) continue;
    const x = p % width;
    const next = (x > 0 && background[p - 1] && p - 1) || (x < width - 1 && background[p + 1] && p + 1) ||
      (p >= width && background[p - width] && p - width) || (p < total - width && background[p + width] && p + width);
    if (!next) continue;
    const i = p * 4, j = next * 4;
    const d = Math.hypot(px[i] - px[j], px[i + 1] - px[j + 1], px[i + 2] - px[j + 2]);
    if (d < BG_STEP * 3) px[i + 3] = Math.round(px[i + 3] * Math.max(0.25, d / (BG_STEP * 3)));
  }
  return true;
}

/**
 * Restos que no son el logo (se marcan como fondo): líneas finas pegadas al
 * borde de la imagen (marco, borde de una captura de pantalla) y motas sueltas.
 */
function removeLeftovers(px, background, width, height) {
  const total = width * height;
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  const thin = Math.max(2, Math.min(width, height) * 0.03);
  const speck = Math.max(6, total * 0.00002);
  for (let start = 0; start < total; start++) {
    if (seen[start] || background[start] || px[start * 4 + 3] < 8) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      const y = (p - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const visit = (q) => { if (!seen[q] && !background[q] && px[q * 4 + 3] >= 8) { seen[q] = 1; queue[tail++] = q; } };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < total - width) visit(p + width);
    }
    const touchesBorder = x0 === 0 || y0 === 0 || x1 === width - 1 || y1 === height - 1;
    const isLine = touchesBorder && Math.min(x1 - x0 + 1, y1 - y0 + 1) <= thin;
    if (isLine || tail <= speck) for (let k = 0; k < tail; k++) background[queue[k]] = 1;
  }
}

/** Canal sRGB (0-255) → valor lineal (para la luminancia relativa WCAG) */
const linear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

const luminance = (px, i) => 0.2126 * linear(px[i]) + 0.7152 * linear(px[i + 1]) + 0.0722 * linear(px[i + 2]);
const contrastWith = (lum, bg) => (Math.max(lum, bg.lum) + 0.05) / (Math.min(lum, bg.lum) + 0.05);

/** true si la mayor parte del borde de la imagen ya es transparente */
function hasTransparentBorder(px, width, height) {
  let transparent = 0;
  let total = 0;
  const check = (x, y) => { total++; if (px[(y * width + x) * 4 + 3] < 8) transparent++; };
  for (let x = 0; x < width; x++) { check(x, 0); check(x, height - 1); }
  for (let y = 0; y < height; y++) { check(0, y); check(width - 1, y); }
  return transparent > total * 0.5;
}

const isGrey = (px, i) => Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) <= GREY_SPREAD;

/**
 * Que el logo se vea sobre el fondo de la cinta (mismo fondo para todos):
 *   - Logo de UN tono sin color (todo negro, todo blanco, gris…) que no
 *     contrasta → entero al color de tinta (blanco o azul tinta).
 *   - Logo de DOS tonos sin color (blanco y negro): si lo que no se ve es la
 *     mayor parte, se invierte (negativo): conserva sus detalles.
 *   - Logo de COLORES: solo las partes grises/negras que no se verían pasan a
 *     tinta, y las de color casi invisibles también; el resto conserva su color.
 */
function adaptToBackground(px, bg, width, height) {
  let count = 0, greys = 0, lum = 0, dark = 0, light = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const l = luminance(px, i);
    count++;
    lum += l;
    if (isGrey(px, i)) {
      greys++;
      if (l < 0.06) dark++;
      if (l > 0.55) light++;
    }
  }
  if (!count) return false;
  // Solo lo que se ve CONTRA LA CINTA (toca lo transparente): lo oscuro de dentro
  // de un sticker, rodeado de su propio borde claro, ya se ve y se respeta
  const paint = (test, all = false) => {
    const outside = all ? null : exposed(px, width, height, test);
    let changed = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 8 || (all ? !test(i) : !outside[i >> 2])) continue;
      [px[i], px[i + 1], px[i + 2]] = bg.ink;
      changed++;
    }
    return changed > 0;
  };

  if (greys >= count * 0.85) {
    const twoTone = dark >= count * 0.08 && light >= count * 0.08;
    if (twoTone) {
      const hidden = bg.lum < 0.5 ? dark : light;    // el tono que no se ve sobre esta cinta
      if (hidden <= count - hidden) return false;    // se ve la mayor parte: se deja como está
      // Si ese tono queda DENTRO del logo (placa negra con su aro blanco), ya se ve
      const hiddenTone = (i) => isGrey(px, i) && (bg.lum < 0.5 ? luminance(px, i) < 0.06 : luminance(px, i) > 0.55);
      const outside = exposed(px, width, height, hiddenTone);
      let seen = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] >= 128 && outside[i >> 2]) seen++;
      if (seen < count * 0.08) return false;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 8 || !isGrey(px, i)) continue;
        px[i] = 255 - px[i]; px[i + 1] = 255 - px[i + 1]; px[i + 2] = 255 - px[i + 2];
      }
      return true;
    }
    if (contrastWith(lum / count, bg) < MIN_CONTRAST) return paint(() => true, true);
    return paint((i) => isGrey(px, i) && contrastWith(luminance(px, i), bg) < PART_CONTRAST);
  }
  // De colores: las partes grises que no se ven solo se cambian si son una parte
  // importante (p. ej. el texto); los detalles pequeños (un filete blanco) se respetan
  const hiddenGrey = (i) => isGrey(px, i) && contrastWith(luminance(px, i), bg) < PART_CONTRAST;
  const outside = exposed(px, width, height, hiddenGrey);
  let hidden = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] >= 128 && outside[i >> 2]) hidden++;
  const darkRibbon = bg.lum < 0.5;
  return paint((i) => (hidden >= count * 0.3 && hiddenGrey(i)) ||
    // Sobre la cinta oscura, un color casi invisible (azul marino, granate muy oscuro) también;
    // sobre la clara, los colores (dorados, amarillos) se conservan
    (darkRibbon && !isGrey(px, i) && contrastWith(luminance(px, i), bg) < 1.3));
}

/**
 * Píxeles que cumplen `test` (recibe el índice en `px`) y se ven CONTRA LA
 * CINTA: tocan lo transparente o el borde, directamente o a través de otros
 * píxeles que también lo cumplen. Lo que queda encerrado dentro del logo (la
 * placa negra de un sticker con su borde blanco) no cuenta.
 */
function exposed(px, width, height, test) {
  const total = width * height;
  const mark = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const ok = (p) => px[p * 4 + 3] >= 8 && test(p * 4);
  const clear = (p) => px[p * 4 + 3] < 128;
  for (let p = 0; p < total; p++) {
    if (!ok(p)) continue;
    const x = p % width;
    if (clear(p) || x === 0 || x === width - 1 || p < width || p >= total - width ||
        clear(p - 1) || clear(p + 1) || clear(p - width) || clear(p + width)) { mark[p] = 1; queue[tail++] = p; }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const visit = (q) => { if (!mark[q] && ok(q)) { mark[q] = 1; queue[tail++] = q; } };
    if (x > 0) visit(p - 1);
    if (x < width - 1) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p < total - width) visit(p + width);
  }
  return mark;
}

/** Contraste que necesita un píxel para leerse (según sea gris, apagado o vivo) */
function neededContrast(px, i) {
  const max = Math.max(px[i], px[i + 1], px[i + 2]);
  const spread = max - Math.min(px[i], px[i + 1], px[i + 2]);
  if (spread <= GREY_SPREAD) return DEFINE_CONTRAST.grey;
  return spread / max >= 0.75 && max >= 150 ? DEFINE_CONTRAST.vivid : DEFINE_CONTRAST.muted;
}

/** Parte del logo (opaca) que no se lee bien sobre el fondo de la cinta */
function hiddenShare(px, bg, width, height) {
  const outside = exposed(px, width, height, (i) => contrastWith(luminance(px, i), bg) < neededContrast(px, i));
  let count = 0, hidden = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    count++;
    if (outside[i >> 2]) hidden++;
  }
  return count ? hidden / count : 0;
}

/**
 * «Definir»: cada parte que no contrasta lo suficiente con la cinta se mezcla
 * con blanco (cinta oscura) o con negro (cinta clara) lo justo para llegar a
 * su DEFINE_CONTRAST. Conserva el tono: un marrón pasa a canela,
 * un azul marino a azul claro, un plateado oscuro a plateado claro.
 */
function defineParts(px, bg, width, height, gentle = false) {
  const memo = new Map();
  const dark = bg.lum < 0.5;
  // Luminancia con la que un píxel llega a un contraste dado con la cinta
  const lumFor = (ratio) => (dark ? ratio * (bg.lum + 0.05) - 0.05 : (bg.lum + 0.05) / ratio - 0.05);
  const floor = lumFor(GENTLE_CONTRAST);
  // Luminancia objetivo de cada píxel. Fuerte («Definir»): justo el contraste que
  // necesita. Suave («Automático», cinta oscura): una curva que aclara lo oscuro
  // pero CONSERVA el orden de los tonos (el relieve de un logo metálico no se aplana)
  const targetLum = (l, needed) => {
    const full = lumFor(needed);
    if (!gentle || !dark) return full;
    return l + floor * (1 - l / full) * (1 - l);
  };
  // Se aclara hacia el blanco (cinta oscura) o se oscurece hacia el negro (cinta
  // clara): así el dorado sigue siendo dorado y no se vuelve verdoso
  const ink = bg.lum < 0.5 ? [255, 255, 255] : [0, 0, 0];
  const mix = (r, g, b, t) => [r + (ink[0] - r) * t, g + (ink[1] - g) * t, b + (ink[2] - b) * t].map(Math.round);
  const lumOf = (c) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
  const outside = exposed(px, width, height, (i) => contrastWith(luminance(px, i), bg) < neededContrast(px, i));
  let changed = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8 || !outside[i >> 2]) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let color = memo.get(key);
    if (!color) {
      const target = targetLum(luminance(px, i), neededContrast(px, i));
      const reached = (l) => (dark ? l >= target : l <= target);
      let lo = 0, hi = 1;
      for (let k = 0; k < 10; k++) {
        const t = (lo + hi) / 2;
        if (reached(lumOf(mix(px[i], px[i + 1], px[i + 2], t)))) hi = t; else lo = t;
      }
      color = mix(px[i], px[i + 1], px[i + 2], hi);
      memo.set(key, color);
    }
    [px[i], px[i + 1], px[i + 2]] = color;
    changed++;
  }
  return changed > 0;
}

/** «Contorno»: la silueta del logo, engordada, en el color de tinta, debajo del logo */
function withOutline(source, ink) {
  const w = source.width;
  const h = source.height;
  const r = Math.max(2, Math.round(Math.min(w, h) * OUTLINE));
  const silhouette = document.createElement('canvas');
  silhouette.width = w;
  silhouette.height = h;
  const s = silhouette.getContext('2d', { willReadFrequently: true });
  s.drawImage(source, 0, 0);
  const image = s.getImageData(0, 0, w, h);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    // Sombras y brillos casi transparentes no cuentan (si no, el contorno se hincha)
    const a = Math.max(0, Math.min(255, (px[i + 3] - 40) * 4));
    [px[i], px[i + 1], px[i + 2], px[i + 3]] = [ink[0], ink[1], ink[2], a];
  }
  s.putImageData(image, 0, 0);
  const out = document.createElement('canvas');
  out.width = w + 2 * r;
  out.height = h + 2 * r;
  const o = out.getContext('2d');
  const STEPS = 24;
  [1, 0.5].forEach((k) => {
    for (let n = 0; n < STEPS; n++) {
      const angle = (n / STEPS) * Math.PI * 2;
      o.drawImage(silhouette, r + Math.cos(angle) * r * k, r + Math.sin(angle) * r * k);
    }
  });
  o.drawImage(source, r, r);
  return out;
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
