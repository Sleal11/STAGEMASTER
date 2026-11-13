/**
 * screens.js — Tarjetas de las pantallas en la estación
 *
 * Cada tarjeta tiene:
 *   Cabecera    nombre, qué pista muestra, quitar y minimizar (⌄): minimizada
 *               queda una línea con su estado
 *   Estado      conexión, tamaño real, si el marcador está al día, Identificar
 *   En pantalla Marcador | Publicidad y vídeos, y el reproductor
 *               (Pausar / Reanudar / Detener) con lo que se está viendo
 *   Pestañas    cuatro botones grandes con el resumen de cada una a la vista:
 *               Contenido (partido, espejo y publicidad automática) · Cinta ·
 *               Lista de reproducción · Salida (monitor, brillo y formato LED).
 *               Dentro, los ajustes van en grupos con título («Qué aparece»,
 *               «Cómo se mueve»…) y los archivos con miniatura
 *   Quitar      (si hay más de una pantalla)
 *
 * Un ESPEJO muestra lo mismo que su pantalla origen: sus pestañas de
 * contenido solo dicen de dónde lo toma; su salida (monitor, formato, brillo)
 * es propia. El reproductor de un espejo controla el de su origen.
 *
 * Los controles de las pestañas solo se redibujan si cambió su configuración
 * y nunca mientras el moderador está escribiendo en ellos.
 */

import { esc, icon, fileNameOf } from '../common/ui.js';
import { ctx, send, toast, findMatch, findScreen, serverNow, patch, isRemoteViewer } from './context.js';
import { confirmDialog } from './dialogs.js';
import { pickFiles, deleteAd } from './uploads.js';
import { remotesShowing } from './remotes.js';
import { collapseButton, isCollapsed } from './collapse.js';
import { editorHtml, drawPreviews, moved, initRibbonDrag, initRibbonResize, isResizing } from './ribbon-editor.js';

const TABS = [
  { id: 'content', label: 'Contenido',             icon: 'sliders' },
  { id: 'ribbon',  label: 'Cinta',                 icon: 'ribbon' },
  { id: 'media',   label: 'Lista de reproducción', icon: 'list' },
  { id: 'output',  label: 'Salida',                icon: 'monitor' },
];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const SPEED_LABELS = { slow: 'Lenta', normal: 'Normal', fast: 'Rápida' };
/** Alto de la cinta: 0 = automático (19 % de la pantalla; 21 % en LED pequeñas) */
const RIBBON_HEIGHTS = [[0, 'Automático (recomendado)'], [16, '16 %'], [20, '20 %'], [24, '24 % · logos más grandes'], [28, '28 %'], [32, '32 %']];
/** Opciones del alto: las fijas y, si se ajustó con el tirador, el valor elegido */
const heightOptions = (current) => (RIBBON_HEIGHTS.some(([v]) => v === current) ? RIBBON_HEIGHTS
  : RIBBON_HEIGHTS.concat([[current, `${current} % (ajustado a mano)`]]).sort((a, b) => a[0] - b[0]));
let dragReady = false;
/** Ajuste de la publicidad a la salida (screenConfig.MEDIA_FITS) */
const FIT_LABELS = {
  auto:    'Automático: llena toda la pantalla (recomendado)',
  stretch: 'Estirar siempre a toda la pantalla',
  cover:   'Llenar sin deformar (recorta los bordes)',
  contain: 'Completa sin deformar, con fondo difuminado',
};

const activeTab = {};   // pantalla → pestaña abierta

export function renderScreens(state) {
  const container = document.getElementById('st-screens');
  if (!dragReady) {
    dragReady = true;
    initRibbonDrag(container, (screenId, items) => update(screenId, { ribbon: { items } }));
    initRibbonResize(container, (screenId, name, size) => update(screenId, { ribbon: { sizes: { [name]: size === 100 ? null : size } } }),
      () => renderScreens(ctx.state), (screenId, height) => update(screenId, { ribbon: { height } }));
  }
  // Pantallas quitadas (en esta estación o en otra ventana): fuera su tarjeta
  container.querySelectorAll('[data-screen-card]').forEach((card) => {
    if (!state.screens.some((s) => s.id === card.dataset.screenCard)) card.remove();
  });
  const addButton = document.getElementById('st-add-screen');
  if (addButton) addButton.disabled = state.screens.length >= (state.maxScreens || 8);

  state.screens.forEach((screen, index) => {
    let card = container.querySelector(`[data-screen-card="${screen.id}"]`);
    if (!card) {
      card = createCard(screen);
      // En su sitio (Pantalla 1, 2, 3…), también si se añade una intermedia
      container.insertBefore(card, container.children[index] || null);
    }
    const match = findMatch(screen.matchId);
    const source = screen.mirrorOf && findScreen(screen.mirrorOf);
    card.style.setProperty('--court-color', match.color);
    card.classList.toggle('is-collapsed', isCollapsed('pantalla:' + screen.id));
    card.querySelector('[data-part="name"]').textContent = screen.label;
    patch(card.querySelector('[data-part="mini"]'), miniHtml(screen));
    const chip = card.querySelector('[data-part="chip"]');
    chip.textContent = (source ? `Espejo de ${source.label} · ` : 'Muestra ') + screen.matchLabel;
    chip.classList.toggle('mirror', !!source);
    patch(card.querySelector('[data-part="remove"]'), state.screens.length > 1
      ? `<button type="button" class="icon-btn" data-action="removeScreen" data-screen="${screen.id}" title="Quitar ${esc(screen.label)}" aria-label="Quitar ${esc(screen.label)}">${icon('trash')}</button>`
      : '');
    patch(card.querySelector('[data-part="status"]'), statusHtml(screen));
    // Botones Marcador / Publicidad aparte: no se redibujan con cada avance de la lista
    // (un clic justo durante un redibujado se perdería)
    patch(card.querySelector('[data-part="segment"]'), segmentHtml(screen));
    patch(card.querySelector('[data-part="live"]'), liveHtml(screen));
    patch(card.querySelector('[data-part="warnings"]'), warningsHtml(screen));

    const tab = activeTab[screen.id] || 'content';
    card.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tab === tab);
      b.setAttribute('aria-selected', b.dataset.tab === tab);
      // Resumen de cada pestaña a la vista (sin abrirla)
      const sub = b.querySelector('.tab-sub');
      const text = tabSummary(b.dataset.tab, screen, state);
      if (sub.textContent !== text) sub.textContent = text;
      b.classList.toggle('is-off', b.dataset.tab === 'ribbon' && !screen.mirrorOf && !screen.ribbon.enabled);
    });
    // Panel: no se toca mientras el moderador escribe en él (un botón con el foco no cuenta)
    const panel = card.querySelector('[data-part="panel"]');
    // …ni mientras se arrastra un tirador de la vista previa de la cinta
    const editing = (panel.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) || isResizing();
    if (!editing) patch(panel, panelHtml(tab, screen, state));
  });
  drawPreviews();
}

function createCard(screen) {
  const card = document.createElement('article');
  card.className = 'st-card st-screen';
  card.dataset.screenCard = screen.id;
  card.dataset.collapsible = 'pantalla:' + screen.id;
  card.innerHTML = `
    <header class="st-card-head"><span class="st-card-name">${icon('monitor', 'st-card-icon')}<span data-part="name"></span></span>
      <span class="st-card-mini" data-part="mini"></span>
      <span class="st-card-tools"><span class="pill" data-part="chip"></span><span data-part="remove"></span>${collapseButton('pantalla:' + screen.id, screen.label)}</span></header>
    <div class="st-card-body">
      <div data-part="status"></div>
      <div class="st-live">
        <span class="st-live-label">En la pantalla ahora</span>
        <div class="segmented segmented-lg" role="group" aria-label="Qué se ve en la pantalla" data-part="segment"></div>
        <div data-part="live"></div>
      </div>
      <div class="tabs tabs-tiles" role="tablist" aria-label="Ajustes de ${esc(screen.label)}">
        ${TABS.map((t) => `<button type="button" role="tab" class="tab" data-tab="${t.id}" data-screen="${screen.id}">` +
          `${icon(t.icon)}<span class="tab-text"><span class="tab-title">${t.label}</span><span class="tab-sub"></span></span></button>`).join('')}
      </div>
      <div class="tab-panel" data-part="panel" role="tabpanel"></div>
      <div data-part="warnings"></div>
    </div>`;
  return card;
}

/** Una línea con el estado (se ve con la tarjeta minimizada) */
function miniHtml(screen) {
  const d = screen.displays[0];
  const shows = screen.postMatch || (screen.pauseMedia && screen.view !== 'media') ? 'Publicidad automática'
    : screen.view === 'media' ? 'Publicidad y vídeos' : 'Marcador';
  return d ? `<span class="dot ok"></span>${shows}` : '<span class="dot bad"></span>Sin conexión';
}

/** Resumen de una pestaña, debajo de su nombre */
function tabSummary(tab, screen, state) {
  const source = screen.mirrorOf && findScreen(screen.mirrorOf);
  if (source && tab !== 'output') return tab === 'content' ? `Espejo de ${source.label}` : `La de ${source.label}`;
  switch (tab) {
    case 'content': {
      const autos = [screen.pauseAds.enabled && 'pausa', screen.endAds.enabled && 'final'].filter(Boolean);
      return `${screen.matchLabel}${autos.length ? ` · anuncios en ${autos.join(' y ')}` : ''}`;
    }
    case 'ribbon': {
      if (!screen.ribbon.enabled) return 'Apagada';
      const parts = [screen.ribbon.items.length && plural(screen.ribbon.items.length, 'archivo', 'archivos'),
        screen.ribbon.texts.length && plural(screen.ribbon.texts.length, 'mensaje', 'mensajes')].filter(Boolean);
      return parts.length ? parts.join(' · ') : 'Encendida · vacía';
    }
    case 'media': {
      const n = playableCount(screen);
      return n ? plural(n, 'archivo', 'archivos') : 'Vacía';
    }
    default: {
      const format = state.outputFormats.find((f) => f.id === screen.output.format);
      const size = screen.output.format === 'fill' ? 'Monitor completo'
        : format && format.saved ? format.label : `${screen.output.width} × ${screen.output.height}`;
      return size + (screen.output.brightness < 100 ? ` · ${screen.output.brightness} %` : '');
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// ESTADO Y "EN PANTALLA"
// ─────────────────────────────────────────────────────────────────

function statusHtml(screen) {
  const desktop = ctx.state.desktop;
  const d = screen.displays[0];
  const button = (action, iconName, text) =>
    `<button type="button" class="btn btn-ghost btn-sm" data-action="${action}" data-screen="${screen.id}">${icon(iconName)}${text}</button>`;

  if (!d && desktop && !desktop.assignments[screen.id]) {
    return `<div class="st-status-row"><span class="st-status"><span class="dot"></span>Sin monitor: conecta uno o elige dónde mostrarla</span>${button('openScreen', 'screen', 'Ver en ventana')}</div>`;
  }
  if (!d) {
    return `<div class="st-status-row"><span class="st-status"><span class="dot bad"></span>Sin conexión</span>${button('openScreen', 'screen', 'Abrir ventana')}</div>`;
  }
  const size = d.viewport ? `${d.viewport.width} × ${d.viewport.height} px` : 'tamaño desconocido';
  const where = screen.displays.map((x) => x.remote ? `en «${esc(x.remote)}»` : 'en este portátil');
  const place = [...new Set(where)].join(' y ');
  const sync = {
    ok:      '<span class="dot ok"></span>Marcador al día',
    pending: '<span class="dot warn"></span>Actualizando…',
    stale:   `<span class="dot bad"></span>${icon('alert')}Desincronizada`,
  }[d.sync];
  return `<div class="st-status-row">
      <span class="st-status"><span class="dot ok"></span>Conectada ${place} · ${size}</span>
      <span class="st-status">${sync}</span>
      ${button('identify', 'eye', 'Identificar')}
    </div>`;
}

/** Archivos de la lista que se pueden reproducir (están en la carpeta y no fallaron) */
export function playableCount(screen) {
  const failed = [].concat(...screen.displays.map((d) => d.adErrors)).map(fileNameOf);
  return screen.media.items.filter((name) =>
    !screen.missingAds.includes('pantalla-completa/' + name) && !failed.includes(name)).length;
}

function liveHtml(screen) {
  const media     = screen.view === 'media';
  const postMatch = screen.postMatch;
  const pause     = !!screen.pauseMedia && !media;
  const playing   = screen.displays[0] && screen.displays[0].playing;
  const hasList   = playableCount(screen) > 0;
  const showsAt   = postMatch ? postMatch.since + screen.endAds.delay * 1000 : 0;
  const mediaOn   = media || (postMatch && serverNow() >= showsAt);
  const btn = (command, iconName, text, cls) =>
    `<button type="button" class="btn ${cls} btn-sm" data-action="media" data-command="${command}" data-screen="${screen.id}">${icon(iconName)}${text}</button>`;

  let transport = '';
  if (media || postMatch || pause) {
    const auto = (postMatch || pause) && !media;   // publicidad automática (fin o pausa del partido)
    const pauseBtn = !hasList ? '' : screen.playback === 'paused'
      ? btn('resume', 'play', 'Reanudar', 'btn-warn') : btn('pause', 'pause', 'Pausar', 'btn-secondary');
    transport = `<div class="st-transport">
        ${pauseBtn}${btn('stop', 'stop', auto ? 'Volver al marcador' : 'Detener', 'btn-secondary')}
        <span class="st-now">${nowPlaying(screen, playing, hasList, auto)}</span>
      </div>`;
  }
  let banner = '';
  if (pause) {
    banner = `<div class="st-banner">${icon('pause')}<span>Partido en pausa: ` +
      (hasList ? 'mostrando la publicidad.' : 'la lista de reproducción está vacía, se ve el marcador con «EN PAUSA».') +
      ' Vuelve al marcador solo al reanudar el partido.</span></div>';
  } else if (postMatch && !media) {
    const what = !hasList ? 'la lista de reproducción está vacía, se sigue viendo el resultado.'
      : mediaOn ? 'mostrando la publicidad.' : `publicidad en <strong data-tick-until="${showsAt}"></strong>.`;
    banner = `<div class="st-banner">${icon('clock')}<span>Fin del partido: ${what}` +
      ' Vuelve al marcador al empezar otro partido o al deshacer el último punto.</span></div>';
  }

  return banner + transport;
}

/** Marcador | Publicidad y vídeos (ninguno resaltado durante la publicidad automática) */
function segmentHtml(screen) {
  const none = !!screen.postMatch || (!!screen.pauseMedia && screen.view !== 'media');
  const segment = (view, iconName, text) =>
    `<button type="button" class="${screen.view === view && !none ? 'is-active' : ''}" data-action="view" data-view="${view}" data-screen="${screen.id}">${icon(iconName)}${text}</button>`;
  return segment('score', 'scoreboard', 'Marcador') + segment('media', 'list', 'Publicidad y vídeos');
}

function nowPlaying(screen, playing, hasList, afterMatch) {
  if (!hasList) {
    return `${icon('alert')}${afterMatch ? 'Lista vacía' : 'Lista vacía: se ve el logo'} · añade imágenes o vídeos en «Lista de reproducción»`;
  }
  if (!playing) return 'Preparando…';
  const what = `${playing.index}/${playing.total} · ${esc(playing.name)}`;
  return `${icon(playing.kind === 'video' ? 'video' : 'image')}${playing.paused ? 'En pausa · ' : ''}${what}`;
}

function warningsHtml(screen) {
  const warnings = [];
  const displays = screen.displays;
  // Dos ventanas de la misma pantalla en el MISMO portátil sobran (en portátiles distintos es a propósito)
  const perPlace = {};
  displays.forEach((d) => { perPlace[d.remote || ''] = (perPlace[d.remote || ''] || 0) + 1; });
  const repeated = Object.entries(perPlace).filter(([, n]) => n > 1);
  if (repeated.length) {
    const [place, n] = repeated[0];
    warnings.push(`Hay ${n} ventanas abiertas para ${esc(screen.label)} ${place ? `en «${esc(place)}»` : 'en este portátil'}. Cierra las que sobren.`);
  }
  const failed = [...new Set([].concat(...displays.map((d) => d.adErrors)))];
  if (failed.length) {
    warnings.push(`No se puede mostrar: ${failed.map((u) => esc(fileNameOf(u))).join(', ')} (archivo dañado o formato no compatible: usa PNG, JPG, MP4 H.264 o WEBM). Se salta.`);
  }
  const size = outputSize(screen, ctx.state);
  const cut = size && displays.find((d) => d.window &&
    (screen.output.x + size.width > d.window.width || screen.output.y + size.height > d.window.height));
  if (cut) {
    warnings.push(`El formato ${size.width} × ${size.height} en la posición ${screen.output.x}, ${screen.output.y} no cabe en el monitor ` +
      `(${cut.window.width} × ${cut.window.height}): se ve recortado. Revisa el formato o la posición, o la resolución del monitor.`);
  }
  if (screen.missingAds.length) {
    warnings.push(`Ya no están en la carpeta: ${esc(screen.missingAds.join(', '))}`);
  }
  if (displays.some((d) => d.soundBlocked)) {
    warnings.push('El navegador bloqueó el sonido de los vídeos: se reproducen sin sonido.');
  }
  if (screen.endAds.enabled && playableCount(screen) === 0) {
    warnings.push('Publicidad al terminar activada, pero la lista de reproducción está vacía: al terminar se seguirá viendo el resultado.');
  }
  return visibleWarnings(screen.id, warnings)
    .map(({ text, leaving }) => `<div class="st-warning${leaving ? ' is-leaving' : ''}">${icon('alert')}<span>${text}</span></div>`).join('');
}

// ── Avisos que se ocultan solos ──────────────────────────────────
// Cada aviso se ve WARNING_MS y se desvanece. Si deja de aplicarse y más tarde
// vuelve (o aparece otro distinto), se muestra de nuevo.
const WARNING_MS = 10000;
const FADE_MS    = 600;
const warningSince = new Map();   // 'pantalla|texto' → cuándo apareció
let warningTimer = null;

function visibleWarnings(screenId, texts) {
  const now = Date.now();
  const prefix = screenId + '|';
  const current = new Set(texts.map((t) => prefix + t));
  [...warningSince.keys()].forEach((key) => {
    if (key.startsWith(prefix) && !current.has(key)) warningSince.delete(key);
  });
  const visible = [];
  texts.forEach((text) => {
    const key = prefix + text;
    if (!warningSince.has(key)) warningSince.set(key, now);
    const age = now - warningSince.get(key);
    if (age < WARNING_MS) visible.push({ text, leaving: age >= WARNING_MS - FADE_MS });
  });
  scheduleWarningRedraw(now);
  return visible;
}

/** Vuelve a dibujar justo cuando un aviso debe empezar a desvanecerse o desaparecer */
function scheduleWarningRedraw(now) {
  const next = [...warningSince.values()]
    .flatMap((since) => [since + WARNING_MS - FADE_MS, since + WARNING_MS])
    .filter((t) => t > now)
    .sort((a, b) => a - b)[0];
  clearTimeout(warningTimer);
  if (next) warningTimer = setTimeout(() => { if (ctx.state) renderScreens(ctx.state); }, next - now + 20);
}

// ─────────────────────────────────────────────────────────────────
// PESTAÑAS
// ─────────────────────────────────────────────────────────────────

function panelHtml(tab, screen, state) {
  if (screen.mirrorOf && tab !== 'output') return mirrorPanel(tab, screen, state);
  switch (tab) {
    case 'ribbon': return ribbonPanel(screen, state);
    case 'media':  return mediaPanel(screen, state);
    case 'output': return outputPanel(screen, state);
    default:       return contentPanel(screen, state);
  }
}

/** Grupo de ajustes con título (y, si está apagado, atenuado: sigue editable) */
const group = (title, iconName, body, { off = false, note = '' } = {}) =>
  `<section class="st-group${off ? ' is-off' : ''}"><h4 class="st-group-title">${icon(iconName)}${title}</h4>` +
  `${note ? `<p class="st-group-note">${note}</p>` : ''}<div class="st-group-body">${body}</div></section>`;

const field = (label, control, hint = '') =>
  `<div class="field"><span class="field-label">${label}</span><div class="field-control">${control}${hint ? `<span class="hint">${hint}</span>` : ''}</div></div>`;

const toggle = (action, screenId, checked, text) =>
  `<label class="switch"><input type="checkbox" data-action="${action}" data-screen="${screenId}"${checked ? ' checked' : ''}>` +
  `<span class="switch-track" aria-hidden="true"></span><span>${text}</span></label>`;

const number = (action, screenId, value, [min, max], suffix) =>
  `<input class="input input-number" type="number" min="${min}" max="${max}" value="${value}" data-action="${action}" data-screen="${screenId}"> ${suffix}`;

/**
 * "Contenido": propio o igual que otra pantalla. Solo se ofrecen pantallas
 * originales (sin cadenas); una pantalla con espejos no puede ser espejo.
 */
function mirrorField(screen, state) {
  const mirrors = state.screens.filter((s) => s.mirrorOf === screen.id);
  if (mirrors.length) {
    return field('Origen', `<span class="muted">${icon('mirror')} Propio · ${esc(mirrors.map((m) => m.label).join(', '))} ` +
      `${mirrors.length > 1 ? 'son espejos' : 'es espejo'} de esta pantalla</span>`);
  }
  const options = [['', 'Propio (se elige abajo)']].concat(state.screens
    .filter((s) => s.id !== screen.id && !s.mirrorOf).map((s) => [s.id, `Igual que ${s.label} (espejo)`]));
  return field('Origen', `<select class="input" data-action="mirror" data-screen="${screen.id}">${options.map(([v, t]) =>
    `<option value="${v}"${v === (screen.mirrorOf || '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`,
  'Un espejo muestra exactamente lo mismo que otra pantalla (marcador, cinta y publicidad, sincronizados) con su propio monitor y formato.');
}

function mirrorPanel(tab, screen, state) {
  const source = findScreen(screen.mirrorOf);
  const where = { content: 'el partido y la publicidad automática', ribbon: 'la cinta', media: 'la lista de reproducción' }[tab];
  const note = `<div class="st-mirror-note">${icon('mirror')}<span>${esc(screen.label)} es un espejo de <strong>${esc(source ? source.label : screen.mirrorOf)}</strong>: ` +
    `${where} se cambia${tab === 'content' ? 'n' : ''} en ${esc(source ? source.label : 'la pantalla origen')}. ` +
    'Su monitor, formato y brillo están en «Salida».</span></div>';
  return note + (tab === 'content' ? mirrorField(screen, state) : '');
}

function contentPanel(screen, state) {
  const options = state.matches.map((m) =>
    `<option value="${m.id}"${m.id === screen.matchId ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
  return group('Qué muestra', 'scoreboard',
    field('Partido', `<select class="input" data-action="match" data-screen="${screen.id}">${options}</select>`,
      'El marcador de esta pista es el que ve el público en esta pantalla.') +
    mirrorField(screen, state)) +
    group('Publicidad automática', 'clock',
      field('En la pausa', toggle('pauseAds', screen.id, screen.pauseAds.enabled, 'Mostrar la lista de reproducción mientras el partido está en pausa')) +
      field('Al terminar', toggle('endAds', screen.id, screen.endAds.enabled, 'Mostrar la lista de reproducción al terminar el partido')) +
      (screen.endAds.enabled ? field('Resultado',
        number('endDelay', screen.id, screen.endAds.delay, state.limits.delay, 'segundos con el resultado antes de la publicidad')) : ''),
    { note: 'Sale sola y vuelve sola al marcador. Usa los archivos de «Lista de reproducción».' }) +
    group('Final del partido', 'trophy',
      field('Estadísticas', toggle('endStats', screen.id, screen.endStats.enabled, 'Mostrar las estadísticas del partido'),
        'Tras la celebración, el marcador con el ganador y las estadísticas se alternan cada 10 s. Desactivado: se queda el marcador con el ganador.'));
}

/**
 * Archivos con casilla y miniatura, cuántos usa esta pantalla, «Todos» /
 * «Ninguno», botón "Subir archivos…" y zona para arrastrar.
 * Con `numbered`, los marcados llevan su número de orden (lista de reproducción).
 */
function libraryHtml(category, action, screen, selected, emptyText, { tall = false, numbered = false } = {}) {
  const library = ctx.state.ads[category];
  const used = library.filter((ad) => selected.includes(ad.name));
  const items = library.length
    ? library.map((ad) => checkItem(action, screen.id, ad, selected.includes(ad.name), category,
      numbered && selected.includes(ad.name) ? used.indexOf(ad) + 1 : 0)).join('')
    : `<span class="muted st-lib-empty">${emptyText}</span>`;
  const bulk = (which, text, disabled) =>
    `<button type="button" class="btn btn-ghost btn-xs" data-action="selectItems" data-which="${which}" data-item="${action}" data-screen="${screen.id}"${disabled ? ' disabled' : ''}>${text}</button>`;
  const head = library.length
    ? `<div class="st-lib-head"><span><strong>${used.length}</strong> de ${library.length} en esta pantalla</span>` +
      `<span class="st-lib-bulk">${bulk('all', 'Todos', used.length === library.length)}${bulk('none', 'Ninguno', used.length === 0)}</span></div>`
    : '';
  return `<div class="dropzone" data-category="${category}" data-screen="${screen.id}">
      ${head}
      <div class="checklist${tall ? ' checklist-tall' : ''}">${items}</div>
      <div class="upload-row">
        <button type="button" class="btn btn-secondary btn-sm" data-action="upload" data-category="${category}" data-screen="${screen.id}">${icon('upload')}Subir archivos…</button>
        <span class="muted">o arrástralos aquí · se marcan solos en esta pantalla</span>
      </div>
    </div>`;
}

function ribbonPanel(screen, state) {
  const { ribbon } = screen;
  const motion = (value, text) =>
    `<button type="button" class="${ribbon.motion === value ? 'is-active' : ''}" data-action="motion" data-motion="${value}" data-screen="${screen.id}">${text}</button>`;
  const speeds = Object.entries(SPEED_LABELS).map(([value, text]) =>
    `<button type="button" class="${ribbon.speed === value ? 'is-active' : ''}" data-action="speed" data-speed="${value}" data-screen="${screen.id}">${text}</button>`).join('');

  const off = !ribbon.enabled;
  const background = (value, text) =>
    `<button type="button" class="${(ribbon.background || 'dark') === value ? 'is-active' : ''}" data-action="ribbonBg" data-bg="${value}" data-screen="${screen.id}">${text}</button>`;
  return `<div class="st-power${off ? ' is-off' : ''}">${toggle('ribbonEnabled', screen.id, ribbon.enabled, 'Mostrar la cinta debajo del marcador')}` +
    `<span class="muted">${off ? 'Apagada: el marcador ocupa toda la pantalla.' : 'Franja de patrocinadores bajo el marcador.'}</span></div>` +
    group('Qué aparece', 'image',
      field('Archivos', libraryHtml('banner', 'ribbonItem', screen, ribbon.items, 'Aún no hay archivos para la cinta.'),
        'Logos PNG, JPG o SVG y vídeos cortos MP4 o WEBM (sin sonido). Los logos se ven siempre sobre el fondo de la cinta: ' +
        'sin su recuadro (blanco, negro, de color o una foto), sin márgenes y legibles (los archivos no se modifican).') +
      field('Mensajes', `<textarea class="input" rows="3" maxlength="1300" data-action="texts" data-screen="${screen.id}" placeholder="Un mensaje por línea (ej. Gracias a Bar Central)">${esc(ribbon.texts.join('\n'))}</textarea>` +
        `<button type="button" class="btn btn-secondary btn-sm" data-action="applyTexts" data-screen="${screen.id}" disabled>${icon('check')}Aplicar mensajes</button>`,
        `Texto que pasa por la cinta. Hasta ${state.limits.texts} mensajes de ${state.limits.textLength} caracteres.`), { off }) +
    group('Cómo se mueve', 'swap',
      field('Movimiento', `<div class="segmented segmented-wrap" role="group">${motion('rotate', 'Uno cada vez')}${motion('fixed', 'Logos fijos')}${motion('scroll', 'Desplazamiento continuo')}</div>`,
        { rotate: 'Un logo o mensaje cada vez, en grande.', fixed: 'Varios logos a la vez, repartidos por la cinta; si no caben todos, se turnan por grupos.',
          scroll: 'Todos pasan uno detrás de otro, sin parar.' }[ribbon.motion]) +
      (ribbon.motion === 'scroll'
        ? field('Velocidad', `<div class="segmented" role="group">${speeds}</div>`)
        : field(ribbon.motion === 'fixed' ? 'Cada grupo' : 'Cada elemento', number('ribbonInterval', screen.id, ribbon.interval, state.limits.interval, 'segundos'))), { off }) +
    group('Aspecto de la cinta', 'image',
      field('Fondo', `<div class="segmented" role="group">${background('dark', 'Oscuro')}${background('light', 'Claro (blanco)')}</div>`,
        'Todos los logos van sobre este mismo fondo. Oscuro: como el marcador. Claro: para logos pensados para fondo blanco. ' +
        'Lo que no se vería (texto negro sobre oscuro, blanco sobre claro) se ajusta solo.') +
      field('Alto', `<select class="input" data-action="ribbonHeight" data-screen="${screen.id}">${heightOptions(ribbon.height || 0).map(([v, t]) =>
        `<option value="${v}"${v === (ribbon.height || 0) ? ' selected' : ''}>${t}</option>`).join('')}</select>`,
        'Más alta = logos más grandes y legibles en la LED (el marcador se reparte el resto). ' +
        'También se cambia arrastrando el borde de arriba de la cinta en la vista previa.'), { off }) +
    editorHtml(screen, off);
}

function mediaPanel(screen, state) {
  const { media } = screen;
  return group('Qué se reproduce', 'list',
    field('Archivos', libraryHtml('fullscreen', 'mediaItem', screen, media.items, 'Aún no hay imágenes ni vídeos.', { tall: true, numbered: true }),
      'A pantalla completa, en bucle y en el orden del número (alfabético: para ordenarlos, empieza los nombres por 01-, 02-…). ' +
      'Imágenes PNG/JPG y vídeos MP4 (H.264) o WEBM. Para LED, mejor en 2:1 (ej. 1664 × 832).'),
    { note: 'Se ve al pulsar «Publicidad y vídeos» y, si está activada en «Contenido», en la pausa y al terminar.' }) +
    group('Reproducción', 'play',
      field('Cada imagen', number('imageSeconds', screen.id, media.imageSeconds, state.limits.imageSeconds, 'segundos (los vídeos duran lo que duran)')) +
      field('Sonido', toggle('sound', screen.id, media.sound, 'Vídeos con sonido')));
}

function outputPanel(screen, state) {
  const desktop = state.desktop;
  let monitor;
  let diagnostics = '';
  if (desktop) {
    const current = desktop.assignments[screen.id] || (desktop.preferences[screen.id] === 'none' ? 'none' : 'auto');
    const options = desktop.monitors.map((m) => [m.key, `${m.label} · ${m.width}×${m.height}${m.refreshRate ? ` · ${m.refreshRate} Hz` : ''}${m.primary ? (isRemoteViewer() ? ' (pantalla del portátil principal)' : ' (aquí está la estación)') : ''}`])
      .concat([['auto', 'Automático (primer monitor libre)'], ['window', 'Ventana de prueba'], ['none', 'No mostrar']]);
    const remote = remotesShowing(screen.id);
    monitor = field('Monitor', `<select class="input" data-action="monitor" data-screen="${screen.id}">${options.map(([v, t]) =>
      `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`,
    remote.length
      ? `También se ve en ${remote.map((r) => `«${esc(r.name)}» (${esc(r.where)})`).join(', ')}. Si no la quieres en este portátil, elige «No mostrar».`
      : 'Si eliges el monitor de otra pantalla, se intercambian.');
    const assigned = desktop.monitors.find((m) => m.key === desktop.assignments[screen.id]);
    if (assigned) diagnostics = monitorDiagnostics(screen, assigned, desktop);
  } else {
    monitor = field('Monitor', `<span class="muted">Abre <code>/score.html?pantalla=${screen.id.replace('pantalla-', '')}</code> en el monitor y pulsa F11.</span>`);
  }

  // Formatos: monitor completo, guardados y personalizado. Los fijos LED XL / pequeño
  // ya no se ofrecen (con «Personalizado» no hacen falta): una pantalla que los
  // usa se muestra como personalizada con su mismo tamaño
  const isFixedLed = (id) => state.outputFormats.some((f) => f.id === id && !f.saved && f.width);
  const format = isFixedLed(screen.output.format) ? 'custom' : screen.output.format;
  const fixed = format !== 'fill';
  const saved = state.outputFormats.filter((f) => f.saved);
  const option = (f) => `<option value="${esc(f.id)}"${f.id === format ? ' selected' : ''}>${esc(f.label)}</option>`;
  const formats = state.outputFormats.filter((f) => !f.saved && f.id !== 'custom' && !f.width).map(option).join('') +
    (saved.length ? `<optgroup label="Guardados">${saved.map(option).join('')}</optgroup>` : '') +
    option(state.outputFormats.find((f) => f.id === 'custom'));
  const preset = saved.find((f) => f.id === format);
  const hint = !fixed ? 'El marcador ocupa todo el monitor y se adapta a su tamaño.'
    : 'Tamaño en píxeles REALES de la pantalla LED (los que tiene configurados la tarjeta emisora), ' +
      'no los de Windows con escalado: StageMaster compensa el escalado.';

  const fits = Object.entries(FIT_LABELS).map(([value, text]) =>
    `<option value="${value}"${value === (screen.output.fit || 'auto') ? ' selected' : ''}>${text}</option>`).join('');

  const brightness = field('Brillo', `<input class="range" type="range" min="${state.limits.brightness[0]}" max="${state.limits.brightness[1]}" step="5" ` +
      `value="${screen.output.brightness}" data-action="brightness" data-screen="${screen.id}" aria-label="Brillo de la imagen">` +
      `<output class="range-value" data-brightness-value="${screen.id}">${screen.output.brightness} %</output>`,
    'Atenúa la imagen que envía StageMaster (útil de noche). El brillo físico de los módulos LED se ajusta en el procesador LED.');
  const fit = field('Publicidad', `<select class="input" data-action="fit" data-screen="${screen.id}">${fits}</select>`,
    'Cómo ocupan la pantalla las imágenes y vídeos. «Automático» los estira para que llenen todo, igual que el marcador ' +
    '(si su proporción es muy distinta, p. ej. una foto vertical, se ven completos sobre un fondo difuminado). ' +
    'Si la LED muestra la publicidad cortada o con bandas, deja «Automático» o elige «Estirar».');
  const size = field('Formato', `<select class="input" data-action="format" data-screen="${screen.id}">${formats}</select>` +
      (preset ? `<button type="button" class="btn btn-ghost btn-sm" data-action="deleteFormat" data-format="${esc(preset.id)}" data-name="${esc(preset.name)}" data-screen="${screen.id}">${icon('trash')}Borrar formato guardado</button>` : ''),
    hint) +
    (format === 'custom' ? field('Tamaño',
      `${number('outputW', screen.id, screen.output.width, state.limits.width, '')} × ${number('outputH', screen.id, screen.output.height, state.limits.height, 'píxeles')}` +
      `<div class="st-save-format"><input class="input" type="text" maxlength="40" placeholder="Nombre (ej. LED pista central)" data-role="formatName" data-screen="${screen.id}">` +
      `<button type="button" class="btn btn-secondary btn-sm" data-action="saveFormat" data-screen="${screen.id}">${icon('check')}Guardar formato</button></div>`,
    'Ancho × alto de la pantalla LED (ej. 832 × 416 o 416 × 208). Guárdalo con un nombre para usarlo en otras pantallas.') : '') +
    (fixed ? field('Posición', `X ${number('outputX', screen.id, screen.output.x, state.limits.offset, '')}` +
      ` Y ${number('outputY', screen.id, screen.output.y, state.limits.offset, 'píxeles')}`,
    'Píxel del monitor donde empieza la pantalla LED (normalmente 0, 0).') : '');

  return group('Monitor', 'monitor', monitor + diagnostics) +
    group('Tamaño de la imagen', 'screen', size) +
    group('Imagen', 'sliders', brightness + fit);
}

/**
 * Lo que dice Windows del monitor: nombre (EDID), resolución real, frecuencia y
 * escalado, con avisos. En Windows, «Cambiar resolución…» y la prueba en curso.
 */
function monitorDiagnostics(screen, m, desktop) {
  const facts = [
    m.name ? `«${esc(m.name)}»` : '',
    `${m.width} × ${m.height} px reales`,
    m.refreshRate ? `${m.refreshRate} Hz` : 'frecuencia desconocida',
    `escala ${Math.round(m.scale * 100)} %`,
  ].filter(Boolean).join(' · ');
  const notes = [];
  if (m.refreshRate && Math.abs(m.refreshRate - 60) > 1 && Math.abs(m.refreshRate - 50) > 1) {
    notes.push(`${icon('alert')}Va a ${m.refreshRate} Hz. Las tarjetas emisoras LED suelen trabajar a 60 Hz (o 50 Hz): si parpadea, ponlo a 60 Hz.`);
  }
  if (m.scale !== 1) {
    notes.push(`Windows escala este monitor al ${Math.round(m.scale * 100)} % (en Windows se ve como ${Math.round(m.width / m.scale)} × ${Math.round(m.height / m.scale)}). ` +
      'StageMaster lo compensa: el formato LED usa los píxeles reales.');
  }
  const modes = desktop.displayModes;
  const pending = modes && modes.pending;
  let action = '';
  if (pending && pending.screenId === screen.id) {
    action = `<div class="st-banner st-mode-pending">${icon('monitor')}<span>Probando <strong>${pending.next.width} × ${pending.next.height} · ${pending.next.hz} Hz</strong> en ${esc(pending.label)}. ` +
      `¿Se ve bien? Si no confirmas, vuelve solo a ${pending.previous.width} × ${pending.previous.height} en <strong data-tick-until="${pending.revertAt}"></strong>.</span>` +
      `<span class="st-mode-actions"><button type="button" class="btn btn-primary btn-sm" data-action="confirmMode" data-screen="${screen.id}">${icon('check')}Mantener</button>` +
      `<button type="button" class="btn btn-secondary btn-sm" data-action="revertMode" data-screen="${screen.id}">${icon('undo')}Volver</button></span></div>`;
  } else if (modes && !m.primary) {
    action = `<button type="button" class="btn btn-ghost btn-sm" data-action="modes" data-screen="${screen.id}"${pending ? ' disabled' : ''}>${icon('monitor')}Cambiar resolución del monitor…</button>`;
  }
  return field('Resolución', `<div class="st-monitor-facts"><span>${facts}</span>${action}` +
    notes.map((n) => `<span class="hint">${n}</span>`).join('') + '</div>');
}

/** Tamaño que ocupa el formato LED (null = todo el monitor) */
export function outputSize(screen, state) {
  const { format, width, height } = screen.output;
  if (format === 'fill') return null;
  const fixed = state.outputFormats.find((f) => f.id === format && !f.saved && f.width);
  return fixed ? { width: fixed.width, height: fixed.height } : { width, height };
}

/** Miniatura del archivo (imagen, o primer fotograma del vídeo) */
function thumbHtml(ad) {
  const media = ad.kind === 'video'
    ? `<video src="${esc(ad.url)}#t=0.5" muted preload="metadata" tabindex="-1" aria-hidden="true"></video>`
    : `<img src="${esc(ad.url)}" alt="" loading="lazy" decoding="async">`;
  return `<span class="st-thumb${ad.kind === 'video' ? ' is-video' : ''}">${media}${ad.kind === 'video' ? icon('play', 'st-thumb-play') : ''}</span>`;
}

function checkItem(action, screenId, ad, checked, category, order = 0) {
  return `<div class="check-row${checked ? ' is-checked' : ''}"><label class="check"><input type="checkbox" data-action="${action}" data-screen="${screenId}" value="${esc(ad.name)}"${checked ? ' checked' : ''}>` +
    `${thumbHtml(ad)}<span class="check-name">${esc(ad.name)}</span>` +
    `${order ? `<span class="st-order" title="Orden en la lista">${order}</span>` : ''}` +
    `<span class="check-kind">${ad.kind === 'video' ? 'Vídeo' : 'Imagen'}</span></label>` +
    `<button type="button" class="icon-btn" data-action="deleteAd" data-category="${category}" data-name="${esc(ad.name)}" data-screen="${screenId}" ` +
    `title="Borrar de la carpeta" aria-label="Borrar ${esc(ad.name)}">${icon('trash')}</button></div>`;
}

// ─────────────────────────────────────────────────────────────────
// ÓRDENES
// ─────────────────────────────────────────────────────────────────

function update(screenId, changes) {
  return send('station:updateScreen', { screenId, changes }).then((res) => {
    // Rechazado: volver a dibujar con la configuración real
    if (!res.ok) forceRedraw(screenId);
    return res;
  });
}

function forceRedraw(screenId) {
  const panel = document.querySelector(`[data-screen-card="${screenId}"] [data-part="panel"]`);
  if (panel) patch(panel, '');
  renderScreens(ctx.state);
}

function checkedValues(screenId, action) {
  return [...document.querySelectorAll(`input[data-action="${action}"][data-screen="${screenId}"]`)]
    .filter((box) => box.checked).map((box) => box.value);
}

/** Clic en una tarjeta de pantalla (delegación desde main.js) */
export function onScreenClick(event) {
  const el = event.target.closest('button[data-action], button[data-tab]');
  if (!el || el.disabled) return;
  const screenId = el.dataset.screen;
  const screen   = findScreen(screenId);

  if (el.dataset.tab) {
    activeTab[screenId] = el.dataset.tab;
    renderScreens(ctx.state);
    return;
  }

  switch (el.dataset.action) {
    case 'view':
      changeView(screen, el.dataset.view, el);
      break;
    case 'media':
      send('station:media', { screenId, command: el.dataset.command }, el);
      break;
    case 'identify':
      send('station:identify', { screenId }, el);
      break;
    case 'removeScreen':
      removeScreen(screen, el);
      break;
    case 'saveFormat': {
      const input = el.parentElement.querySelector('[data-role="formatName"]');
      send('station:saveFormat', { label: input.value, width: screen.output.width, height: screen.output.height, screenId }, el)
        .then((res) => { if (res.ok) toast(`Formato «${res.format.label}» guardado`); });
      break;
    }
    case 'deleteFormat':
      confirmDialog(`¿Borrar el formato «${el.dataset.name}»?`,
        'Las pantallas que lo usan se quedan con el mismo tamaño (como personalizado).', 'Borrar formato')
        .then((ok) => { if (ok) send('station:deleteFormat', { formatId: el.dataset.format }, el); });
      break;
    case 'modes':
      openModesDialog(screen, el);
      break;
    case 'confirmMode':
      send('station:confirmMode', {}, el).then((res) => { if (res.ok) toast('Resolución guardada'); });
      break;
    case 'revertMode':
      send('station:revertMode', {}, el);
      break;
    case 'openScreen':
      if (ctx.state.desktop) send('station:openScreen', { screenId }, el);
      else {
        window.open('/score.html?pantalla=' + screenId.replace('pantalla-', ''), screenId);
        toast('Lleva la ventana nueva a su monitor y pulsa F11 (pantalla completa)');
      }
      break;
    case 'motion':
      update(screenId, { ribbon: { motion: el.dataset.motion } });
      break;
    case 'speed':
      update(screenId, { ribbon: { speed: el.dataset.speed } });
      break;
    case 'upload':
      pickFiles(el.dataset.category, screenId);
      break;
    case 'selectItems': {
      // «Todos» / «Ninguno» de la cinta o de la lista de reproducción
      const category = el.dataset.item === 'ribbonItem' ? 'banner' : 'fullscreen';
      const all = ctx.state.ads[category].map((ad) => ad.name);
      // La cinta conserva el orden elegido: los que faltaban se añaden al final
      const current = el.dataset.item === 'ribbonItem' ? screen.ribbon.items : [];
      const items = el.dataset.which === 'all' ? current.concat(all.filter((n) => !current.includes(n))) : [];
      update(screenId, el.dataset.item === 'ribbonItem' ? { ribbon: { items } } : { media: { items } });
      break;
    }
    case 'logoMove': {
      const items = moved(screen.ribbon.items, el.dataset.name, Number(el.dataset.dir));
      if (items) update(screenId, { ribbon: { items } });
      break;
    }
    case 'ribbonBg':
      update(screenId, { ribbon: { background: el.dataset.bg } });
      break;
    case 'logoReset':
      update(screenId, { ribbon: { sizes: { [el.dataset.name]: null } } });
      break;
    case 'deleteAd':
      deleteAd(el.dataset.category, el.dataset.name);
      break;
    case 'applyTexts': {
      const textarea = el.parentElement.querySelector('textarea');
      update(screenId, { ribbon: { texts: textarea.value.split('\n') } }).then((res) => {
        if (res.ok) { textarea.blur(); toast('Mensajes de la cinta actualizados'); }
      });
      break;
    }
  }
}

/** Cambio de resolución a prueba (pendiente de «Mantener») en esta pantalla */
function pendingModeFor(screenId) {
  const modes = ctx.state && ctx.state.desktop && ctx.state.desktop.displayModes;
  return !!(modes && modes.pending && modes.pending.screenId === screenId);
}

/**
 * Resoluciones que admite el monitor (las da Windows). Al probar una, el
 * monitor cambia y vuelve solo en 15 s si no se pulsa «Mantener».
 */
function openModesDialog(screen, button) {
  send('station:listModes', { screenId: screen.id }, button).then((res) => {
    if (!res.ok) return;
    const dialog = document.getElementById('dlg-modes');
    const same = (m) => m.width === res.current.width && m.height === res.current.height && m.hz === res.current.hz;
    document.getElementById('dlg-modes-title').textContent = `Resolución de ${res.monitor}`;
    document.getElementById('dlg-modes-sub').textContent =
      `${res.name || 'Monitor'}${res.adapter ? ' · ' + res.adapter : ''} · ahora ${res.current.width} × ${res.current.height} · ${res.current.hz} Hz`;
    const list = document.getElementById('dlg-modes-list');
    list.innerHTML = res.modes.map((m, i) =>
      `<label class="st-mode"><input type="radio" name="mode" value="${i}"${same(m) ? ' checked' : ''}>` +
      `<span class="st-mode-check" aria-hidden="true">${icon('check')}</span>` +
      `<span class="st-mode-size">${m.width} × ${m.height}</span><span class="muted">${m.hz} Hz</span>` +
      `${same(m) ? '<span class="pill">Actual</span>' : ''}${m.width === 1920 && m.height === 1080 && m.hz === 60 ? '<span class="pill info">Recomendado para LED</span>' : ''}</label>`).join('');
    const ok = document.getElementById('dlg-modes-ok');
    const choice = document.getElementById('dlg-modes-choice');
    const selected = () => {
      const checked = list.querySelector('input[name="mode"]:checked');
      return checked && res.modes[Number(checked.value)];
    };
    // La elegida se resalta en la lista y se repite junto a «Probar»
    const showChoice = () => {
      const mode = selected();
      choice.textContent = !mode ? '' : same(mode) ? 'Elegida: la actual' : `Elegida: ${mode.width} × ${mode.height} · ${mode.hz} Hz`;
      ok.disabled = !mode || same(mode);
    };
    list.onchange = showChoice;
    showChoice();
    const close = () => { ok.onclick = null; list.onchange = null; dialog.close(); };
    document.getElementById('dlg-modes-close').onclick = close;
    ok.onclick = () => {
      const mode = selected();
      if (!mode || same(mode)) { close(); return; }
      // Windows tarda unos segundos (el monitor se resincroniza): se explica mientras tanto
      list.classList.add('is-busy');
      list.querySelectorAll('input').forEach((input) => { input.disabled = true; });
      choice.textContent = `Aplicando ${mode.width} × ${mode.height} · ${mode.hz} Hz… la pantalla puede quedarse en negro unos segundos`;
      send('station:applyMode', { screenId: screen.id, mode }, ok).then((r) => {
        if (r.ok || pendingModeFor(screen.id)) { close(); return; }
        list.classList.remove('is-busy');
        list.querySelectorAll('input').forEach((input) => { input.disabled = false; });
        showChoice();
      });
    };
    // La actual, visible al abrir (la lista puede ser larga)
    const current = list.querySelector('input:checked');
    dialog.showModal();
    if (current) current.closest('.st-mode').scrollIntoView({ block: 'center' });
  });
}

/** Quitar una pantalla: su ventana se cierra; sus espejos siguen mostrando lo mismo */
function removeScreen(screen, button) {
  const mirrors = ctx.state.screens.filter((s) => s.mirrorOf === screen.id).map((s) => s.label);
  const extra = mirrors.length ? ` ${mirrors.join(', ')} dejará${mirrors.length > 1 ? 'n' : ''} de ser espejo y seguirá${mirrors.length > 1 ? 'n' : ''} mostrando lo mismo.` : '';
  confirmDialog(`¿Quitar ${screen.label}?`,
    `Se cierra su ventana y se borra su configuración (cinta, lista, formato).${extra}`, 'Quitar pantalla')
    .then((ok) => { if (ok) send('station:removeScreen', { screenId: screen.id }, button).then((res) => { if (res.ok) toast(`${screen.label} quitada`); }); });
}

/** Pasar a "Publicidad y vídeos" oculta el marcador: con partido en juego, se confirma */
function changeView(screen, view, button) {
  if (view === screen.view && !screen.postMatch && !screen.pauseMedia) return;
  if (view === 'score') {
    send('station:media', { screenId: screen.id, command: 'stop' }, button);
    return;
  }
  const match = findMatch(screen.matchId);
  const live = match.state && match.state.status === 'playing';
  const go = () => send('station:media', { screenId: screen.id, command: 'play' }, button);
  if (!live) { go(); return; }
  confirmDialog(`¿Quitar el marcador de ${screen.label}?`,
    `${match.label} tiene un partido en juego: el público dejará de ver el marcador hasta que pulses «Marcador» o «Detener».`,
    'Mostrar publicidad', { danger: false })
    .then((ok) => { if (ok) go(); });
}

/** Cambios en selects, casillas, interruptores y números */
export function onScreenChange(event) {
  const el = event.target;
  const screenId = el.dataset.screen;
  if (!screenId) return;
  const value = parseInt(el.value, 10);

  switch (el.dataset.action) {
    case 'match':          update(screenId, { matchId: el.value }); break;
    case 'mirror':         update(screenId, { mirrorOf: el.value || null }); break;
    case 'monitor':        send('station:setMonitor', { screenId, monitor: el.value }); break;
    case 'format':         update(screenId, { output: { format: el.value } }); break;
    case 'outputX':        update(screenId, { output: { x: value } }); break;
    case 'outputW':        update(screenId, { output: { width: value } }); break;
    case 'outputH':        update(screenId, { output: { height: value } }); break;
    case 'outputY':        update(screenId, { output: { y: value } }); break;
    case 'brightness':     update(screenId, { output: { brightness: value } }); break;
    case 'fit':            update(screenId, { output: { fit: el.value } }); break;
    case 'endAds':         update(screenId, { endAds: { enabled: el.checked } }); break;
    case 'pauseAds':       update(screenId, { pauseAds: { enabled: el.checked } }); break;
    case 'endStats':       update(screenId, { endStats: { enabled: el.checked } }); break;
    case 'endDelay':       update(screenId, { endAds: { delay: value } }); break;
    case 'ribbonEnabled':  update(screenId, { ribbon: { enabled: el.checked } }); break;
    case 'ribbonInterval': update(screenId, { ribbon: { interval: value } }); break;
    case 'ribbonItem': {
      // Conserva el orden de la cinta: el que se marca va al final
      const checked = checkedValues(screenId, 'ribbonItem');
      const items = findScreen(screenId).ribbon.items.filter((n) => checked.includes(n));
      update(screenId, { ribbon: { items: items.concat(checked.filter((n) => !items.includes(n))) } });
      break;
    }
    case 'ribbonHeight':   update(screenId, { ribbon: { height: value } }); break;
    case 'logoSize':       update(screenId, { ribbon: { sizes: { [el.dataset.name]: value } } }); break;
    case 'logoEffect':     update(screenId, { ribbon: { effects: { [el.dataset.name]: el.value } } }); break;
    case 'mediaItem':      update(screenId, { media: { items: checkedValues(screenId, 'mediaItem') } }); break;
    case 'imageSeconds':   update(screenId, { media: { imageSeconds: value } }); break;
    case 'sound':          update(screenId, { media: { sound: el.checked } }); break;
    default: return;
  }
  el.blur();   // Permite que el siguiente estado del servidor redibuje los controles
}

/** Mientras se escriben los mensajes: activar "Aplicar" solo si hay cambios */
export function onScreenInput(event) {
  const el = event.target;
  // Brillo: el número se actualiza mientras se arrastra; se aplica al soltar
  if (el.dataset.action === 'brightness') {
    const label = document.querySelector(`[data-brightness-value="${el.dataset.screen}"]`);
    if (label) label.textContent = el.value + ' %';
    return;
  }
  // Tamaño de un logo: el valor y la vista previa cambian mientras se arrastra; se aplica al soltar
  if (el.dataset.action === 'logoSize') {
    el.parentElement.querySelector('output').textContent = el.value + ' %';
    drawPreviews({ screenId: el.dataset.screen, name: el.dataset.name, size: Number(el.value) });
    return;
  }
  if (el.dataset.action !== 'texts') return;
  const screen = findScreen(el.dataset.screen);
  const button = el.parentElement.querySelector('[data-action="applyTexts"]');
  button.disabled = el.value.split('\n').map((t) => t.trim()).filter(Boolean).join('\n') === screen.ribbon.texts.join('\n');
}
