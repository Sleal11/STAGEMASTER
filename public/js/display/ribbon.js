/**
 * ribbon.js — Cinta publicitaria del marcador
 *
 * Una franja en la parte de abajo del marcador (nunca tapa nombres ni
 * números: el marcador se reparte el espacio que queda). Contenido:
 * imágenes/logos de la carpeta banner/ y mensajes de texto, intercalados.
 *
 * Dos movimientos:
 *   'rotate'  Un elemento cada vez, con fundido, cada `interval` segundos.
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

  /** Imágenes y mensajes intercalados: img, texto, img, texto… */
  function items() {
    if (!config) return [];
    const images = config.images.filter((img) => !failed.has(img.url)).map((img) => ({ type: 'image', ...img }));
    const texts  = config.texts.map((text) => ({ type: 'text', text }));
    const list = [];
    for (let i = 0; i < Math.max(images.length, texts.length); i++) {
      if (images[i]) list.push(images[i]);
      if (texts[i]) list.push(texts[i]);
    }
    return list;
  }

  function configure(ribbon) {
    const next = JSON.stringify([ribbon.enabled, ribbon.images.map((i) => i.url), ribbon.texts,
      ribbon.motion, ribbon.interval, ribbon.speed]);
    if (next === signature) return;
    if (!config || JSON.stringify(config.images) !== JSON.stringify(ribbon.images)) failed.clear();
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
    animation = null;
    current = null;
    index = -1;
  }

  function hasContent() {
    return !!config && config.enabled && items().length > 0;
  }

  function imageFailed(url) {
    if (failed.has(url)) return;
    failed.add(url);
    console.warn('[Cinta] No se puede mostrar:', url);
    rebuild();
    onChange();
  }

  // ── Elementos ───────────────────────────────────────────────────

  function createItem(item) {
    if (item.type === 'image') {
      const img = document.createElement('img');
      img.className = 'ribbon-item ribbon-image';
      img.alt = '';
      img.src = item.url;
      return img;
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
    const el = createItem(item);
    el.classList.add('ribbon-slide');
    container.appendChild(el);
    const myBuild = build;

    const show = () => {
      if (myBuild !== build) return;
      const previous = current;
      current = el;
      el.classList.add('is-visible');
      if (previous) setTimeout(() => previous.remove(), FADE_MS + 50);
      const extraMs = item.type === 'text' ? fitText(el, list.length === 1) : 0;
      if (list.length > 1) timer = setTimeout(rotateNext, Math.max(config.interval * 1000, extraMs));
    };

    if (item.type === 'image') {
      el.onload  = show;
      el.onerror = () => { el.remove(); imageFailed(item.url); };
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
      const el = createItem(item);
      group.appendChild(el);
      const sep = document.createElement('span');
      sep.className = 'ribbon-sep';
      group.appendChild(sep);
      if (item.type !== 'image') return Promise.resolve(true);
      return new Promise((resolve) => {
        if (el.complete && el.naturalWidth) resolve(true);
        el.onload  = () => resolve(true);
        el.onerror = () => resolve(item.url);
      });
    });
    track.appendChild(group);
    container.appendChild(track);

    Promise.all(loads).then((results) => {
      if (myBuild !== build) return;
      const broken = results.find((r) => typeof r === 'string');
      if (broken) { imageFailed(broken); return; }

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
