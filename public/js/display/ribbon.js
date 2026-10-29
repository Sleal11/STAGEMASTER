/**
 * ribbon.js — Cinta publicitaria del marcador
 *
 * Una franja en la parte de abajo del marcador (nunca tapa nombres ni
 * números: el marcador se reparte el espacio que queda). Contenido:
 * imágenes, logos y vídeos (siempre sin sonido) de la carpeta banner/ y
 * mensajes de texto, intercalados.
 *
 * Dos movimientos:
 *   'rotate'  Un elemento cada vez, con fundido, cada `interval` segundos
 *             (un vídeo se ve entero antes de pasar al siguiente).
 *             Un mensaje que no cabe se reduce un poco y, si aún no cabe,
 *             cruza la cinta una vez a velocidad de lectura.
 *   'scroll'  Desplazamiento continuo de todos los elementos, sin saltos
 *             (animación por GPU), a una velocidad proporcional a la altura
 *             de la cinta: igual de legible en 832×416 que en 416×208.
 *
 * Los cambios de la estación se aplican al momento, sin recargar la página.
 */

/** Velocidad del desplazamiento: alturas de cinta por segundo */
const SPEEDS  = { slow: 1.3, normal: 1.9, fast: 2.7 };
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
      ribbon.motion, ribbon.interval, ribbon.speed]);
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
    if (config.motion === 'scroll') buildScroll(build);
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

  /** @param {boolean} loop - Vídeo en bucle (desplazamiento o único elemento) */
  function createItem(item, loop) {
    if (item.type === 'image') {
      const img = document.createElement('img');
      img.className = 'ribbon-item ribbon-image';
      img.alt = '';
      img.src = item.url;
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

  // ── Movimiento "scroll": continuo ───────────────────────────────

  function buildScroll(myBuild) {
    const list  = items();
    const track = document.createElement('div');
    track.className = 'ribbon-track';
    const group = document.createElement('div');
    group.className = 'ribbon-group';

    const loads = list.map((item) => {
      const el = createItem(item, true);
      group.appendChild(el);
      const sep = document.createElement('span');
      sep.className = 'ribbon-sep';
      group.appendChild(sep);
      if (item.type === 'text') return Promise.resolve(true);
      // Hay que conocer el tamaño de imágenes y vídeos antes de medir la cinta
      return new Promise((resolve) => {
        if (item.type === 'image' && el.complete && el.naturalWidth) resolve(true);
        el.addEventListener(item.type === 'image' ? 'load' : 'loadedmetadata', () => resolve(true), { once: true });
        el.addEventListener('error', () => resolve(item.url), { once: true });
      });
    });
    track.appendChild(group);
    container.appendChild(track);

    Promise.all(loads).then((results) => {
      if (myBuild !== build) return;
      const broken = results.find((r) => typeof r === 'string');
      if (broken) { mediaFailed(broken); return; }

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
