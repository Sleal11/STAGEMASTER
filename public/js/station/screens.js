/**
 * screens.js — Tarjetas de las pantallas en la estación
 *
 * Cada tarjeta tiene:
 *   Estado      conexión, tamaño real, si el marcador está al día, Identificar
 *   En pantalla Marcador | Publicidad y vídeos, y el reproductor
 *               (Pausar / Reanudar / Detener) con lo que se está viendo
 *   Pestañas    Contenido (partido, espejo y publicidad automática) · Cinta ·
 *               Lista de reproducción · Salida (monitor, brillo y formato LED)
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
import { ctx, send, toast, findMatch, findScreen, serverNow, patch } from './context.js';
import { confirmDialog } from './dialogs.js';
import { pickFiles, deleteAd } from './uploads.js';
import { remotesShowing } from './remotes.js';

const TABS = [
  { id: 'content', label: 'Contenido',             icon: 'sliders' },
  { id: 'ribbon',  label: 'Cinta',                 icon: 'ribbon' },
  { id: 'media',   label: 'Lista de reproducción', icon: 'list' },
  { id: 'output',  label: 'Salida',                icon: 'monitor' },
];
const SPEED_LABELS = { slow: 'Lenta', normal: 'Normal', fast: 'Rápida' };

const activeTab = {};   // pantalla → pestaña abierta

export function renderScreens(state) {
  const container = document.getElementById('st-screens');
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
    card.querySelector('.st-card-name').textContent = screen.label;
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
    });
    // Panel: no se toca mientras el moderador escribe en él (un botón con el foco no cuenta)
    const panel = card.querySelector('[data-part="panel"]');
    const editing = panel.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
    if (!editing) patch(panel, panelHtml(tab, screen, state));
  });
}

function createCard(screen) {
  const card = document.createElement('article');
  card.className = 'st-card st-screen';
  card.dataset.screenCard = screen.id;
  card.innerHTML = `
    <header class="st-card-head"><span class="st-card-name"></span>
      <span class="st-card-tools"><span class="pill" data-part="chip"></span><span data-part="remove"></span></span></header>
    <div class="st-card-body">
      <div data-part="status"></div>
      <div class="st-live">
        <div class="segmented segmented-lg" role="group" aria-label="Qué se ve en la pantalla" data-part="segment"></div>
        <div data-part="live"></div>
      </div>
      <div class="tabs" role="tablist">
        ${TABS.map((t) => `<button type="button" role="tab" class="tab" data-tab="${t.id}" data-screen="${screen.id}">${icon(t.icon)}${t.label}</button>`).join('')}
      </div>
      <div class="tab-panel" data-part="panel" role="tabpanel"></div>
      <div data-part="warnings"></div>
    </div>`;
  return card;
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
function playableCount(screen) {
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
  return mirrorField(screen, state) +
    field('Partido', `<select class="input" data-action="match" data-screen="${screen.id}">${options}</select>`) +
    field('En la pausa', toggle('pauseAds', screen.id, screen.pauseAds.enabled, 'Mostrar la lista de reproducción mientras el partido está en pausa')) +
    field('Al terminar', toggle('endAds', screen.id, screen.endAds.enabled, 'Mostrar la lista de reproducción al terminar el partido')) +
    (screen.endAds.enabled ? field('Resultado',
      number('endDelay', screen.id, screen.endAds.delay, state.limits.delay, 'segundos con el resultado antes de la publicidad')) : '');
}

/** Lista de archivos con casillas, botón "Subir archivos…" y zona para arrastrar */
function libraryHtml(category, action, screen, selected, emptyText, tall = false) {
  const library = ctx.state.ads[category];
  const items = library.length
    ? library.map((ad) => checkItem(action, screen.id, ad, selected.includes(ad.name), category)).join('')
    : `<span class="muted">${emptyText}</span>`;
  return `<div class="dropzone" data-category="${category}" data-screen="${screen.id}">
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

  return field('Cinta', toggle('ribbonEnabled', screen.id, ribbon.enabled, 'Mostrar la cinta debajo del marcador')) +
    field('Imágenes, logos y vídeos', libraryHtml('banner', 'ribbonItem', screen, ribbon.items, 'Aún no hay archivos para la cinta.'),
      'Imágenes PNG/JPG/SVG (recomendado 1920 × 200) y vídeos cortos MP4 o WEBM (sin sonido).') +
    field('Logos', toggle('cleanLogos', screen.id, ribbon.cleanLogos, 'Quitar el fondo blanco y poner todos sobre el mismo fondo'),
      'Quita el recuadro blanco de los logos, los separa por igual y pasa a blanco los logos negros (los archivos no se modifican).') +
    field('Mensajes', `<textarea class="input" rows="3" maxlength="1300" data-action="texts" data-screen="${screen.id}" placeholder="Un mensaje por línea (ej. Gracias a Bar Central)">${esc(ribbon.texts.join('\n'))}</textarea>` +
      `<button type="button" class="btn btn-secondary btn-sm" data-action="applyTexts" data-screen="${screen.id}" disabled>${icon('check')}Aplicar mensajes</button>`,
      `Hasta ${state.limits.texts} mensajes de ${state.limits.textLength} caracteres.`) +
    field('Movimiento', `<div class="segmented" role="group">${motion('rotate', 'Cambia cada cierto tiempo')}${motion('scroll', 'Desplazamiento continuo')}</div>`) +
    (ribbon.motion === 'rotate'
      ? field('Cada elemento', number('ribbonInterval', screen.id, ribbon.interval, state.limits.interval, 'segundos'))
      : field('Velocidad', `<div class="segmented" role="group">${speeds}</div>`));
}

function mediaPanel(screen, state) {
  const { media } = screen;
  return field('Imágenes y vídeos', libraryHtml('fullscreen', 'mediaItem', screen, media.items, 'Aún no hay imágenes ni vídeos.', true),
    'Se reproducen en bucle y en orden alfabético (para ordenarlos, empieza los nombres por 01-, 02-…). ' +
    'Imágenes PNG/JPG y vídeos MP4 (H.264) o WEBM. Para LED, mejor en 2:1 (ej. 1664 × 832).') +
    field('Cada imagen', number('imageSeconds', screen.id, media.imageSeconds, state.limits.imageSeconds, 'segundos (los vídeos duran lo que duran)')) +
    field('Sonido', toggle('sound', screen.id, media.sound, 'Vídeos con sonido'));
}

function outputPanel(screen, state) {
  const desktop = state.desktop;
  let monitor;
  let diagnostics = '';
  if (desktop) {
    const current = desktop.assignments[screen.id] || (desktop.preferences[screen.id] === 'none' ? 'none' : 'auto');
    const options = desktop.monitors.map((m) => [m.key, `${m.label} · ${m.width}×${m.height}${m.refreshRate ? ` · ${m.refreshRate} Hz` : ''}${m.primary ? ' (aquí está la estación)' : ''}`])
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

  return monitor + diagnostics +
    field('Brillo de la imagen', `<input class="range" type="range" min="${state.limits.brightness[0]}" max="${state.limits.brightness[1]}" step="5" ` +
      `value="${screen.output.brightness}" data-action="brightness" data-screen="${screen.id}" aria-label="Brillo de la imagen">` +
      `<output class="range-value" data-brightness-value="${screen.id}">${screen.output.brightness} %</output>`,
    'Atenúa la imagen que envía StageMaster (útil de noche). El brillo físico de los módulos LED se ajusta en el procesador LED.') +
    field('Formato', `<select class="input" data-action="format" data-screen="${screen.id}">${formats}</select>` +
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
function outputSize(screen, state) {
  const { format, width, height } = screen.output;
  if (format === 'fill') return null;
  const fixed = state.outputFormats.find((f) => f.id === format && !f.saved && f.width);
  return fixed ? { width: fixed.width, height: fixed.height } : { width, height };
}

function checkItem(action, screenId, ad, checked, category) {
  return `<div class="check-row"><label class="check"><input type="checkbox" data-action="${action}" data-screen="${screenId}" value="${esc(ad.name)}"${checked ? ' checked' : ''}>` +
    `${icon(ad.kind === 'video' ? 'video' : 'image')}<span>${esc(ad.name)}</span></label>` +
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
      send('station:applyMode', { screenId: screen.id, mode }, ok).then((r) => { if (r.ok) close(); });
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
    case 'endAds':         update(screenId, { endAds: { enabled: el.checked } }); break;
    case 'pauseAds':       update(screenId, { pauseAds: { enabled: el.checked } }); break;
    case 'endDelay':       update(screenId, { endAds: { delay: value } }); break;
    case 'ribbonEnabled':  update(screenId, { ribbon: { enabled: el.checked } }); break;
    case 'ribbonInterval': update(screenId, { ribbon: { interval: value } }); break;
    case 'cleanLogos':     update(screenId, { ribbon: { cleanLogos: el.checked } }); break;
    case 'ribbonItem':     update(screenId, { ribbon: { items: checkedValues(screenId, 'ribbonItem') } }); break;
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
  if (el.dataset.action !== 'texts') return;
  const screen = findScreen(el.dataset.screen);
  const button = el.parentElement.querySelector('[data-action="applyTexts"]');
  button.disabled = el.value.split('\n').map((t) => t.trim()).filter(Boolean).join('\n') === screen.ribbon.texts.join('\n');
}
