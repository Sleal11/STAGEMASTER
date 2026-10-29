/**
 * media-player.js — Lista de reproducción a pantalla completa (imágenes y vídeos)
 *
 * Se usa en la vista "Publicidad y vídeos", en la publicidad al terminar el
 * partido y cuando una pantalla no tiene partido.
 *
 * Comportamiento:
 *   - Imágenes: cada una `imageSeconds` segundos. Vídeos: hasta que terminan.
 *   - Bucle continuo: al llegar al final vuelve a empezar. Con un solo vídeo
 *     se usa el bucle nativo del navegador (sin cortes).
 *   - Nunca pantalla en negro entre elementos: el anterior sigue visible (el
 *     vídeo conserva su último fotograma) hasta que el siguiente ya se ve, y
 *     entonces se funden.
 *   - Pausa: congela el vídeo o el tiempo de la imagen actual; Reanudar sigue
 *     donde estaba.
 *   - Un archivo que no carga, no empieza en 15 s o se queda parado 10 s se
 *     salta y se informa a la estación. Si no queda ninguno, quien usa el
 *     reproductor muestra otra cosa (hasPlayable() === false).
 *   - Sonido: si el navegador bloquea el sonido, el vídeo sigue sin sonido y
 *     se avisa a la estación (en la aplicación de escritorio no ocurre).
 */

const FADE_MS          = 500;
const START_TIMEOUT_MS = 15000;
const STALL_TIMEOUT_MS = 10000;

/**
 * @param {HTMLElement} container
 * @param {Object}   hooks
 * @param {Function} hooks.onChange - Cambió lo que se ve (elemento, error, pausa)
 */
export function createMediaPlayer(container, { onChange }) {
  let items    = [];      // [{ name, kind: 'image'|'video', url }]
  let imageMs  = 10000;
  let sound    = false;
  let paused   = false;
  let playId   = null;
  let active   = false;
  let index    = -1;      // posición en `items` del último elemento cargado
  let current  = null;    // { el, item } el que se ve
  let pending  = null;    // { el, item } el que se está cargando
  let soundBlocked = false;
  const failed = new Set();   // URLs que no se pueden reproducir

  const timers = { image: null, start: null, stall: null };
  let imageDeadline = 0;
  let imageRemaining = 0;

  const playable = () => items.filter((item) => !failed.has(item.url));
  const urlsOf   = (list) => list.map((item) => item.url).join('|');

  // ── Configuración (enviada por la estación) ─────────────────────

  function configure(media) {
    const nextItems   = media.items || [];
    const listChanged = urlsOf(nextItems) !== urlsOf(items);
    const restart     = media.playId !== playId;

    items   = nextItems;
    imageMs = media.imageSeconds * 1000;
    playId  = media.playId;
    if (sound !== media.sound) {
      sound = media.sound;
      soundBlocked = false;
      [current, pending].forEach((entry) => { if (entry && entry.item.kind === 'video') entry.el.muted = !sound; });
    }
    setPaused(media.playback === 'paused');

    if (restart || listChanged) failed.clear();
    if (!active) return;
    if (restart) start();
    else if (listChanged) reconcile();
  }

  function setActive(isActive) {
    if (isActive === active) return;
    active = isActive;
    if (active) start(); else clearAll();
  }

  /** La lista cambió mientras se reproducía: sigue con el actual si aún está */
  function reconcile() {
    const position = current ? items.findIndex((item) => item.url === current.item.url) : -1;
    if (position === -1) {
      advance();
      return;
    }
    index = position;
    if (current.item.kind === 'video') current.el.loop = playable().length === 1;
  }

  // ── Secuencia ───────────────────────────────────────────────────

  function start() {
    clearAll();
    advance();
  }

  function advance() {
    clearTimeout(timers.image);
    if (!active) return;

    const list = playable();
    if (list.length === 0) {
      clearAll();
      onChange();
      return;
    }
    // Un único elemento que ya se ve: se queda (los vídeos tienen bucle nativo)
    if (list.length === 1 && current && current.item.url === list[0].url) {
      if (current.item.kind === 'video') current.el.loop = true;
      return;
    }

    for (let n = 0; n < items.length; n++) {
      index = (index + 1) % items.length;
      if (!failed.has(items[index].url)) break;
    }
    load(items[index]);
  }

  function load(item) {
    discard(pending);
    const entry = { item, el: null };
    entry.el = item.kind === 'video' ? createVideo(entry) : createImage(entry);
    pending = entry;
    container.appendChild(entry.el);
  }

  function createImage(entry) {
    const img = document.createElement('img');
    img.className = 'media-item';
    img.alt = '';
    img.onload  = () => reveal(entry);
    img.onerror = () => fail(entry);
    img.src = entry.item.url;
    return img;
  }

  function createVideo(entry) {
    const video = document.createElement('video');
    video.className   = 'media-item';
    video.muted       = !sound;
    video.playsInline = true;
    video.preload     = 'auto';
    video.loop        = playable().length === 1;

    // En pausa se muestra el primer fotograma; si no, se reproduce y se muestra al arrancar
    video.addEventListener('loadeddata', () => {
      if (pending !== entry) return;
      if (paused) reveal(entry); else tryPlay(video);
    });
    video.addEventListener('playing', () => { if (pending === entry) reveal(entry); });
    video.addEventListener('ended',   () => { if (current === entry) advance(); });
    video.addEventListener('error',   () => fail(entry));

    clearTimeout(timers.start);
    timers.start = setTimeout(() => { if (pending === entry) fail(entry); }, START_TIMEOUT_MS);
    video.src = entry.item.url;
    return video;
  }

  /** El nuevo elemento ya se ve: se funde sobre el anterior */
  function reveal(entry) {
    if (pending !== entry) return;
    clearTimeout(timers.start);
    pending = null;

    const previous = current;
    current = entry;
    entry.el.classList.add('is-visible');
    if (previous) setTimeout(() => release(previous.el), FADE_MS + 50);

    if (entry.item.kind === 'image') scheduleImage(imageMs);
    else watchStall(entry.el);
    onChange();
  }

  function fail(entry) {
    if (failed.has(entry.item.url) && pending !== entry) return;
    failed.add(entry.item.url);
    console.warn('[Reproductor] No se puede reproducir:', entry.item.name);
    if (pending === entry) {
      clearTimeout(timers.start);
      pending = null;
      release(entry.el);
    }
    // Si falla el que se ve, sigue visible hasta que aparezca el siguiente
    onChange();
    advance();
  }

  // ── Tiempos, pausa y vídeos parados ─────────────────────────────

  function scheduleImage(ms) {
    clearTimeout(timers.image);
    imageRemaining = ms;
    if (paused) return;
    imageDeadline = Date.now() + ms;
    timers.image  = setTimeout(advance, ms);
  }

  function setPaused(isPaused) {
    if (isPaused === paused) return;
    paused = isPaused;
    if (!current) return;
    if (current.item.kind === 'video') {
      if (paused) current.el.pause(); else tryPlay(current.el);
    } else if (paused) {
      clearTimeout(timers.image);
      imageRemaining = Math.max(0, imageDeadline - Date.now());
    } else {
      scheduleImage(imageRemaining);
    }
    onChange();
  }

  /** Un vídeo que deja de avanzar 10 s (archivo dañado a mitad) se salta */
  function watchStall(video) {
    clearInterval(timers.stall);
    let lastTime = -1;
    let lastProgress = Date.now();
    timers.stall = setInterval(() => {
      if (!current || current.el !== video) { clearInterval(timers.stall); return; }
      if (paused || video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastProgress = Date.now();
      } else if (Date.now() - lastProgress > STALL_TIMEOUT_MS) {
        clearInterval(timers.stall);
        fail(current);
      }
    }, 1000);
  }

  function tryPlay(video) {
    const attempt = video.play();
    if (!attempt) return;
    attempt.catch((err) => {
      // El navegador no deja reproducir con sonido sin un clic: seguir sin sonido
      if (err.name === 'NotAllowedError' && !video.muted) {
        video.muted  = true;
        soundBlocked = true;
        onChange();
        video.play().catch(() => {});
      }
    });
  }

  // ── Limpieza ────────────────────────────────────────────────────

  function release(el) {
    if (el.tagName === 'VIDEO') {
      el.pause();
      el.removeAttribute('src');
      el.load();   // libera el decodificador
    }
    el.remove();
  }

  function discard(entry) {
    if (entry) release(entry.el);
  }

  function clearAll() {
    clearTimeout(timers.image);
    clearTimeout(timers.start);
    clearInterval(timers.stall);
    discard(pending);
    discard(current);
    pending = current = null;
    index = -1;
  }

  return {
    configure,
    setActive,
    hasPlayable: () => playable().length > 0,
    errors:      () => [...failed],
    soundBlocked: () => soundBlocked,
    /** Lo que se ve ahora (para la estación) o null */
    status() {
      if (!active || !current) return null;
      const list = playable();
      return {
        name:   current.item.name,
        kind:   current.item.kind,
        index:  Math.max(1, list.findIndex((item) => item.url === current.item.url) + 1),
        total:  list.length,
        paused,
      };
    },
  };
}
