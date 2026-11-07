/**
 * ribbon.js — Cinta publicitaria del marcador
 *
 * Una franja en la parte de abajo del marcador (nunca tapa nombres ni
 * números: el marcador se reparte el espacio que queda). Contenido:
 * imágenes, logos y vídeos (siempre sin sonido) de la carpeta banner/ y
 * mensajes de texto, intercalados, EN EL ORDEN que elige el operador.
 *
 * Tres movimientos:
 *   'rotate'  Un elemento cada vez, con fundido, cada `interval` segundos
 *             (un vídeo se ve entero antes de pasar al siguiente).
 *             Un mensaje que no cabe se reduce un poco y, si aún no cabe,
 *             cruza la cinta una vez a velocidad de lectura.
 *   'fixed'   Logos fijos: varios a la vez, repartidos por la cinta. Si no
 *             caben todos, por grupos que se turnan cada `interval` segundos.
 *             Los mensajes y los vídeos van en su propio turno.
 *   'scroll'  Desplazamiento continuo de todos los elementos, sin saltos
 *             (animación por GPU), a una velocidad proporcional a la altura
 *             de la cinta: igual de legible en 832×416 que en 416×208.
 *
 * Los logos van SIEMPRE sobre el fondo de la cinta (azul oscuro o blanco,
 * «Fondo de la cinta»): sin su fondo blanco, sin márgenes vacíos y con las
 * partes que no se verían pasadas a blanco o a azul tinta (logo-cleaner.js). Su alto
 * se calcula para que todos se vean con un peso parecido y legibles
 * (common/ribbon-layout.js), más el ajuste de cada logo («Tamaño», 50-200 %).
 *
 * Los cambios de la estación se aplican al momento, sin recargar la página.
 */

import { cleanLogo } from './logo-cleaner.js';
import { logoHeight, paginate, LOGO_GAP } from '../common/ribbon-layout.js';

/**
 * Velocidad del desplazamiento: altos de cinta por segundo. "Normal"
 * cruza una pantalla LED XL (832 px) en unos 13 s: se lee sin prisa.
 */
const SPEEDS  = { slow: 0.7, normal: 1.0, fast: 1.5 };
const FADE_MS = 600;
/** Un mensaje puede reducirse hasta este tamaño antes de desplazarse */
const TEXT_MIN_SCALE = 0.78;

/**
 * @param {HTMLElement} container
 * @param {Object}   hooks
 * @param {Function} hooks.onChange - Cambió el contenido (p. ej. una imagen falló)
 */
export function createRibbon(container, { onChange }) {
  let config    = null;
  let active    = false;
  let signature = '';
  let timer     = null;
  let animation = null;
  let current   = null;
  let index     = -1;
  let build     = 0;   // invalida cargas de una configuración anterior
  const failed  = new Set();

  /** Archivos (imágenes y vídeos) y mensajes intercalados: archivo, texto, archivo, texto… */
  function items() {
    if (!config) return [];
    const media = config.items.filter((item) => !failed.has(item.url)).map((item) => ({ type: item.kind, ...item }));
    const texts = config.texts.map((text) => ({ type: 'text', text }));
    const list = [];
    for (let i = 0; i < Math.max(media.length, texts.length); i++) {
      if (media[i]) list.push(media[i]);
      if (texts[i]) list.push(texts[i]);
    }
    return list;
  }

  function configure(ribbon) {
    const next = JSON.stringify([ribbon.enabled, ribbon.items.map((i) => i.url), ribbon.texts,
      ribbon.motion, ribbon.interval, ribbon.speed, ribbon.sizes, ribbon.height, ribbon.background]);
    if (next === signature) return;
    if (!config || JSON.stringify(config.items) !== JSON.stringify(ribbon.items)) failed.clear();
    signature = next;
    config = ribbon;
    rebuild();
  }

  function setActive(isActive) {
    if (isActive === active) return;
    active = isActive;
    rebuild();
  }

  function rebuild() {
    stop();
    container.innerHTML = '';
    build++;
    if (!active || !hasContent()) return;
    container.dataset.motion = config.motion;
    container.dataset.bg = config.background || 'dark';
    if (config.motion === 'scroll') buildScroll(build);
    else if (config.motion === 'fixed') buildFixed(build);
    else rotateNext();
  }

  function stop() {
    clearTimeout(timer);
    if (animation) animation.cancel();
    container.querySelectorAll('video').forEach(releaseVideo);
    animation = null;
    current = null;
    index = -1;
  }

  function hasContent() {
    return !!config && config.enabled && items().length > 0;
  }

  function releaseVideo(video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  function mediaFailed(url) {
    if (failed.has(url)) return;
    failed.add(url);
    console.warn('[Cinta] No se puede mostrar:', url);
    rebuild();
    onChange();
  }

  // ── Elementos ───────────────────────────────────────────────────

  /** Ajuste del operador para un logo (%) */
  const sizeOf = (item) => (config.sizes && config.sizes[item.name]) || 100;

  /** Alto del logo en píxeles, ya cargado (proporción real, sin márgenes vacíos) */
  function logoPixels(el, item, single) {
    const w = el.naturalWidth || el.videoWidth || 16;
    const h = el.naturalHeight || el.videoHeight || 9;
    return Math.round(container.clientHeight * logoHeight(w / h, sizeOf(item), single));
  }

  /** @param {boolean} loop - Vídeo en bucle (desplazamiento o único elemento) */
  function createItem(item, loop) {
    if (item.type === 'image') {
      const img = document.createElement('img');
      img.className = 'ribbon-item ribbon-image';
      img.alt = '';
      // La versión limpia (sin fondo blanco) se prepara aparte; quien espera 'load' la recibe igual
      cleanLogo(item.url, config.background).then((src) => { img.src = src; });
      return img;
    }
    if (item.type === 'video') {
      // Atributos (no propiedades): así las copias de la cinta también son mudas y arrancan solas
      const video = document.createElement('video');
      video.className = 'ribbon-item ribbon-image';
      ['muted', 'autoplay', 'playsinline'].concat(loop ? ['loop'] : []).forEach((a) => video.setAttribute(a, ''));
      video.muted = true;
      video.preload = 'auto';
      video.src = item.url;
      return video;
    }
    const div = document.createElement('div');
    div.className = 'ribbon-item ribbon-text';
    const span = document.createElement('span');
    span.textContent = item.text;
    div.appendChild(span);
    return div;
  }

  /** Espera a conocer el tamaño de una imagen o un vídeo (true) o su error (la URL) */
  function whenLoaded(el, item) {
    if (item.type === 'text') return Promise.resolve(true);
    return new Promise((resolve) => {
      if (item.type === 'image' && el.complete && el.naturalWidth) resolve(true);
      el.addEventListener(item.type === 'image' ? 'load' : 'loadedmetadata', () => resolve(true), { once: true });
      el.addEventListener('error', () => resolve(item.url), { once: true });
    });
  }

  // ── Movimiento "rotate": uno cada vez ───────────────────────────

  function rotateNext() {
    clearTimeout(timer);
    const list = items();
    if (list.length === 0) return;
    if (list.length === 1 && current) return;   // un único elemento: se queda

    index = (index + 1) % list.length;
    const item = list[index];
    const el = createItem(item, list.length === 1);
    el.classList.add('ribbon-slide');
    container.appendChild(el);
    const myBuild = build;

    const show = () => {
      if (myBuild !== build || el.classList.contains('is-visible')) return;
      if (item.type === 'image') el.style.height = logoPixels(el, item, true) + 'px';
      const previous = current;
      current = el;
      el.classList.add('is-visible');
      if (previous) setTimeout(() => { if (previous.tagName === 'VIDEO') releaseVideo(previous); previous.remove(); }, FADE_MS + 50);
      if (list.length === 1) {
        if (item.type === 'text') fitText(el, true);
        return;
      }
      if (item.type === 'video') {
        // El vídeo se ve entero; por si no avisa al terminar, un tope de seguridad
        el.onended = () => { if (myBuild === build) rotateNext(); };
        const seconds = Number.isFinite(el.duration) ? el.duration : config.interval * 3;
        timer = setTimeout(rotateNext, (seconds + 2) * 1000);
        return;
      }
      const extraMs = item.type === 'text' ? fitText(el, false) : 0;
      timer = setTimeout(rotateNext, Math.max(config.interval * 1000, extraMs));
    };

    if (item.type === 'image') {
      el.onload  = show;
      el.onerror = () => { el.remove(); mediaFailed(item.url); };
    } else if (item.type === 'video') {
      el.onloadeddata = show;
      el.onerror = () => { releaseVideo(el); el.remove(); mediaFailed(item.url); };
    } else {
      requestAnimationFrame(show);
    }
  }

  /**
   * Ajusta un mensaje a la cinta: reduce la letra hasta TEXT_MIN_SCALE y, si
   * aún no cabe, lo hace cruzar la cinta (en bucle si es el único elemento).
   * @returns {number} Milisegundos que necesita para leerse entero (0 si cabe)
   */
  function fitText(el, loop) {
    const span = el.firstChild;
    const base = parseFloat(getComputedStyle(span).fontSize);
    let size = base;
    while (span.scrollWidth > el.clientWidth && size > base * TEXT_MIN_SCALE) {
      size = Math.max(size * 0.95, base * TEXT_MIN_SCALE);
      span.style.fontSize = size + 'px';
    }
    if (span.scrollWidth <= el.clientWidth) return 0;

    el.classList.add('is-marquee');
    const distance = el.clientWidth + span.scrollWidth;
    const duration = distance / (el.clientHeight * SPEEDS[config.speed]) * 1000;
    span.animate(
      [{ transform: `translateX(${el.clientWidth}px)` }, { transform: `translateX(${-span.scrollWidth}px)` }],
      { duration, iterations: loop ? Infinity : 1, fill: 'forwards' },
    );
    return duration + 200;
  }

  // ── Movimiento "fixed": varios logos a la vez, por grupos ────────

  function buildFixed(myBuild) {
    const list = items();
    const logos = list.filter((item) => item.type === 'image');
    const others = list.filter((item) => item.type !== 'image');   // mensajes y vídeos: su propio turno
    const els = logos.map((item) => createItem(item, false));
    Promise.all(els.map((el, i) => whenLoaded(el, logos[i]))).then((results) => {
      if (myBuild !== build) return;
      const broken = results.find((r) => typeof r === 'string');
      if (broken) { mediaFailed(broken); return; }
      const H = container.clientHeight;
      const heights = els.map((el, i) => logoPixels(el, logos[i], false));
      const widths = els.map((el, i) => heights[i] * (el.naturalWidth / el.naturalHeight));
      const safe = parseFloat(getComputedStyle(container).paddingLeft) || 0;
      const pages = paginate(widths, container.clientWidth - 2 * safe - H * 0.3, H * LOGO_GAP)
        .map((page) => ({ logos: page }));
      others.forEach((item) => pages.push({ other: item }));

      const slides = pages.map((page) => {
        if (page.other) {
          const el = createItem(page.other, false);
          el.classList.add('ribbon-slide');
          return { el, item: page.other };
        }
        const row = document.createElement('div');
        row.className = 'ribbon-slide ribbon-page';
        page.logos.forEach((i) => { els[i].style.height = heights[i] + 'px'; row.appendChild(els[i]); });
        return { el: row, item: null };
      });

      let k = -1;
      const showNext = () => {
        if (myBuild !== build) return;
        k = (k + 1) % slides.length;
        const { el, item } = slides[k];
        const previous = current;
        if (previous === el) return;
        if (!el.isConnected) container.appendChild(el);
        current = el;
        requestAnimationFrame(() => el.classList.add('is-visible'));
        if (previous) {
          previous.classList.remove('is-visible');
          setTimeout(() => { if (current !== previous) { if (previous.tagName === 'VIDEO') releaseVideo(previous); previous.remove(); } }, FADE_MS + 50);
        }
        if (slides.length === 1) { if (item && item.type === 'text') fitText(el, true); return; }
        let ms = config.interval * 1000;
        if (item && item.type === 'text') ms = Math.max(ms, fitText(el, false));
        if (item && item.type === 'video') {
          el.onended = () => { if (myBuild === build) showNext(); };
          ms = (Number.isFinite(el.duration) ? el.duration + 2 : config.interval * 3) * 1000;
        }
        timer = setTimeout(showNext, ms);
      };
      showNext();
    });
  }

  // ── Movimiento "scroll": continuo ───────────────────────────────

  function buildScroll(myBuild) {
    const list  = items();
    const track = document.createElement('div');
    track.className = 'ribbon-track';
    const group = document.createElement('div');
    group.className = 'ribbon-group';

    // Hay que conocer el tamaño de imágenes y vídeos antes de medir la cinta
    const els = list.map((item) => {
      const el = createItem(item, true);
      group.appendChild(el);
      return el;
    });
    track.appendChild(group);
    container.appendChild(track);

    Promise.all(els.map((el, i) => whenLoaded(el, list[i]))).then((results) => {
      if (myBuild !== build) return;
      const broken = results.find((r) => typeof r === 'string');
      if (broken) { mediaFailed(broken); return; }
      els.forEach((el, i) => { if (list[i].type !== 'text') el.style.height = logoPixels(el, list[i], false) + 'px'; });

      const groupWidth = group.getBoundingClientRect().width;
      if (!groupWidth) return;
      // Copias suficientes para que la cinta nunca se vea vacía al dar la vuelta
      const copies = Math.ceil(container.clientWidth / groupWidth) + 1;
      for (let i = 0; i < copies; i++) track.appendChild(group.cloneNode(true));

      const pxPerSecond = container.clientHeight * SPEEDS[config.speed];
      animation = track.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(${-groupWidth}px)` }],
        { duration: groupWidth / pxPerSecond * 1000, iterations: Infinity },
      );
    });
  }

  return {
    configure,
    setActive,
    hasContent,
    /** Recalcula tamaños (cambió la resolución) */
    refresh: () => { if (active) rebuild(); },
    errors: () => [...failed],
  };
}
