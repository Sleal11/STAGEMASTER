/**
 * screens.js — Tarjetas de las pantallas en la estación
 *
 * Cada tarjeta tiene:
 *   Estado      conexión, tamaño real, si el marcador está al día, Identificar
 *   En pantalla Marcador | Publicidad y vídeos, y el reproductor
 *               (Pausar / Reanudar / Detener) con lo que se está viendo
 *   Pestañas    Contenido (partido y publicidad al terminar) · Cinta ·
 *               Lista de reproducción · Salida (monitor y formato LED)
 *
 * Los controles de las pestañas solo se redibujan si cambió su configuración
 * y nunca mientras el moderador está escribiendo en ellos.
 */

import { esc, icon, fileNameOf } from '../common/ui.js';
import { ctx, send, toast, findMatch, findScreen, serverNow, patch } from './context.js';
import { confirmDialog } from './dialogs.js';

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
  state.screens.forEach((screen) => {
    let card = container.querySelector(`[data-screen-card="${screen.id}"]`);
    if (!card) {
      card = createCard(screen);
      container.appendChild(card);
    }
    const match = findMatch(screen.matchId);
    card.style.setProperty('--court-color', match.color);
    card.querySelector('.st-card-name').textContent = screen.label;
    card.querySelector('[data-part="chip"]').textContent = 'Muestra ' + screen.matchLabel;
    patch(card.querySelector('[data-part="status"]'), statusHtml(screen));
    patch(card.querySelector('[data-part="live"]'), liveHtml(screen));
    patch(card.querySelector('[data-part="warnings"]'), warningsHtml(screen));

    const tab = activeTab[screen.id] || 'content';
    card.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tab === tab);
      b.setAttribute('aria-selected', b.dataset.tab === tab);
    });
    // Panel: no se toca mientras el moderador escribe en él
    const panel = card.querySelector('[data-part="panel"]');
    if (!panel.contains(document.activeElement)) patch(panel, panelHtml(tab, screen, state));
  });
}

function createCard(screen) {
  const card = document.createElement('article');
  card.className = 'st-card st-screen';
  card.dataset.screenCard = screen.id;
  card.innerHTML = `
    <header class="st-card-head"><span class="st-card-name"></span><span class="pill" data-part="chip"></span></header>
    <div class="st-card-body">
      <div data-part="status"></div>
      <div data-part="live"></div>
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
  const sync = {
    ok:      '<span class="dot ok"></span>Marcador al día',
    pending: '<span class="dot warn"></span>Actualizando…',
    stale:   `<span class="dot bad"></span>${icon('alert')}Desincronizada`,
  }[d.sync];
  return `<div class="st-status-row">
      <span class="st-status"><span class="dot ok"></span>Conectada · ${size}</span>
      <span class="st-status">${sync}</span>
      ${button('identify', 'eye', 'Identificar')}
    </div>`;
}

function liveHtml(screen) {
  const media     = screen.view === 'media';
  const postMatch = screen.postMatch;
  const playing   = screen.displays[0] && screen.displays[0].playing;
  const showsAt   = postMatch ? postMatch.since + screen.endAds.delay * 1000 : 0;
  const mediaOn   = media || (postMatch && serverNow() >= showsAt);
  const segment = (view, iconName, text) =>
    `<button type="button" class="${screen.view === view && !postMatch ? 'is-active' : ''}" data-action="view" data-view="${view}" data-screen="${screen.id}">${icon(iconName)}${text}</button>`;
  const btn = (command, iconName, text, cls) =>
    `<button type="button" class="btn ${cls} btn-sm" data-action="media" data-command="${command}" data-screen="${screen.id}">${icon(iconName)}${text}</button>`;

  let transport = '';
  if (media || postMatch) {
    transport = `<div class="st-transport">
        ${screen.playback === 'paused' ? btn('resume', 'play', 'Reanudar', 'btn-warn') : btn('pause', 'pause', 'Pausar', 'btn-secondary')}
        ${btn('stop', 'stop', postMatch ? 'Volver al marcador' : 'Detener', 'btn-secondary')}
        <span class="st-now">${nowPlaying(screen, playing)}</span>
      </div>`;
  }
  const banner = postMatch ? `<div class="st-banner">${icon('clock')}<span>Fin del partido: ` +
    (mediaOn ? 'mostrando la publicidad.' : `publicidad en <strong data-tick-until="${showsAt}"></strong>.`) +
    ' Vuelve al marcador al empezar otro partido o al deshacer el último punto.</span></div>' : '';

  return `<div class="st-live">
      <div class="segmented segmented-lg" role="group" aria-label="Qué se ve en la pantalla">
        ${segment('score', 'scoreboard', 'Marcador')}${segment('media', 'list', 'Publicidad y vídeos')}
      </div>
      ${banner}${transport}
    </div>`;
}

function nowPlaying(screen, playing) {
  if (!screen.media.items.length) return `${icon('alert')}Lista vacía: se ve el logo`;
  if (!playing) return 'Preparando…';
  const what = `${playing.index}/${playing.total} · ${esc(playing.name)}`;
  return `${icon(playing.kind === 'video' ? 'video' : 'image')}${playing.paused ? 'En pausa · ' : ''}${what}`;
}

function warningsHtml(screen) {
  const warnings = [];
  const displays = screen.displays;
  if (displays.length > 1) {
    warnings.push(`Hay ${displays.length} ventanas abiertas para ${esc(screen.label)}. Cierra las que sobren.`);
  }
  const failed = [...new Set([].concat(...displays.map((d) => d.adErrors)))];
  if (failed.length) {
    warnings.push(`No se puede mostrar: ${failed.map((u) => esc(fileNameOf(u))).join(', ')} (archivo dañado o formato no compatible: usa PNG, JPG, MP4 H.264 o WEBM). Se salta.`);
  }
  if (screen.missingAds.length) {
    warnings.push(`Ya no están en la carpeta: ${esc(screen.missingAds.join(', '))}`);
  }
  if (displays.some((d) => d.soundBlocked)) {
    warnings.push('El navegador bloqueó el sonido de los vídeos: se reproducen sin sonido.');
  }
  if (screen.endAds.enabled && !screen.media.items.length) {
    warnings.push('Publicidad al terminar activada, pero la lista de reproducción está vacía: al terminar se seguirá viendo el resultado.');
  }
  return warnings.map((w) => `<div class="st-warning">${icon('alert')}<span>${w}</span></div>`).join('');
}

// ─────────────────────────────────────────────────────────────────
// PESTAÑAS
// ─────────────────────────────────────────────────────────────────

function panelHtml(tab, screen, state) {
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

function contentPanel(screen, state) {
  const options = state.matches.map((m) =>
    `<option value="${m.id}"${m.id === screen.matchId ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
  return field('Partido', `<select class="input" data-action="match" data-screen="${screen.id}">${options}</select>`) +
    field('Al terminar', toggle('endAds', screen.id, screen.endAds.enabled, 'Mostrar la lista de reproducción al terminar el partido')) +
    (screen.endAds.enabled ? field('Resultado',
      number('endDelay', screen.id, screen.endAds.delay, state.limits.delay, 'segundos con el resultado antes de la publicidad')) : '');
}

function ribbonPanel(screen, state) {
  const { ribbon } = screen;
  const library = state.ads.banner;
  const images = library.length ? library.map((ad) => checkItem('ribbonImage', screen.id, ad, ribbon.images.includes(ad.name))).join('')
    : '<span class="muted">La carpeta <strong>banner</strong> está vacía.</span>';
  const motion = (value, text) =>
    `<button type="button" class="${ribbon.motion === value ? 'is-active' : ''}" data-action="motion" data-motion="${value}" data-screen="${screen.id}">${text}</button>`;
  const speeds = Object.entries(SPEED_LABELS).map(([value, text]) =>
    `<button type="button" class="${ribbon.speed === value ? 'is-active' : ''}" data-action="speed" data-speed="${value}" data-screen="${screen.id}">${text}</button>`).join('');

  return field('Cinta', toggle('ribbonEnabled', screen.id, ribbon.enabled, 'Mostrar la cinta debajo del marcador')) +
    field('Imágenes y logos', `<div class="checklist">${images}</div>`, 'PNG de la carpeta banner (recomendado 1920 × 200).') +
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
  const library = state.ads.fullscreen;
  const items = library.length ? library.map((ad) => checkItem('mediaItem', screen.id, ad, media.items.includes(ad.name))).join('')
    : '<span class="muted">La carpeta <strong>pantalla-completa</strong> está vacía.</span>';
  return field('Imágenes y vídeos', `<div class="checklist checklist-tall">${items}</div>`,
    'Se reproducen en bucle, en orden alfabético (para ordenarlos, empieza los nombres por 01-, 02-…). Vídeo: MP4 (H.264) o WEBM.') +
    field('Cada imagen', number('imageSeconds', screen.id, media.imageSeconds, state.limits.imageSeconds, 'segundos (los vídeos duran lo que duran)')) +
    field('Sonido', toggle('sound', screen.id, media.sound, 'Vídeos con sonido'));
}

function outputPanel(screen, state) {
  const desktop = state.desktop;
  let monitor;
  if (desktop) {
    const current = desktop.assignments[screen.id] || (desktop.preferences[screen.id] === 'none' ? 'none' : 'auto');
    const options = desktop.monitors.map((m) => [m.key, `${m.label} · ${m.width}×${m.height}${m.primary ? ' (aquí está la estación)' : ''}`])
      .concat([['auto', 'Automático (primer monitor libre)'], ['window', 'Ventana de prueba'], ['none', 'No mostrar']]);
    monitor = field('Monitor', `<select class="input" data-action="monitor" data-screen="${screen.id}">${options.map(([v, t]) =>
      `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`,
    'Si eliges el monitor de la otra pantalla, se intercambian.');
  } else {
    monitor = field('Monitor', `<span class="muted">Abre <code>/score.html?pantalla=${screen.id.replace('pantalla-', '')}</code> en el monitor y pulsa F11.</span>`);
  }
  const fixed = screen.output.format !== 'fill';
  const formats = state.outputFormats.map((f) =>
    `<option value="${f.id}"${f.id === screen.output.format ? ' selected' : ''}>${esc(f.label)}</option>`).join('');
  return monitor +
    field('Formato', `<select class="input" data-action="format" data-screen="${screen.id}">${formats}</select>`,
      fixed ? 'Tamaño exacto en píxeles reales, también con el escalado de Windows activado.' : 'El marcador ocupa todo el monitor y se adapta a su tamaño.') +
    (fixed ? field('Posición', `X ${number('outputX', screen.id, screen.output.x, state.limits.offset, '')}` +
      ` Y ${number('outputY', screen.id, screen.output.y, state.limits.offset, 'píxeles')}`,
    'Píxel del monitor donde empieza la pantalla LED (normalmente 0, 0).') : '');
}

function checkItem(action, screenId, ad, checked) {
  return `<label class="check"><input type="checkbox" data-action="${action}" data-screen="${screenId}" value="${esc(ad.name)}"${checked ? ' checked' : ''}>` +
    `${icon(ad.kind === 'video' ? 'video' : 'image')}<span>${esc(ad.name)}</span></label>`;
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
    case 'applyTexts': {
      const textarea = el.parentElement.querySelector('textarea');
      update(screenId, { ribbon: { texts: textarea.value.split('\n') } }).then((res) => {
        if (res.ok) { textarea.blur(); toast('Mensajes de la cinta actualizados'); }
      });
      break;
    }
  }
}

/** Pasar a "Publicidad y vídeos" oculta el marcador: con partido en juego, se confirma */
function changeView(screen, view, button) {
  if (view === screen.view && !screen.postMatch) return;
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
    case 'monitor':        send('station:setMonitor', { screenId, monitor: el.value }); break;
    case 'format':         update(screenId, { output: { format: el.value } }); break;
    case 'outputX':        update(screenId, { output: { x: value } }); break;
    case 'outputY':        update(screenId, { output: { y: value } }); break;
    case 'endAds':         update(screenId, { endAds: { enabled: el.checked } }); break;
    case 'endDelay':       update(screenId, { endAds: { delay: value } }); break;
    case 'ribbonEnabled':  update(screenId, { ribbon: { enabled: el.checked } }); break;
    case 'ribbonInterval': update(screenId, { ribbon: { interval: value } }); break;
    case 'ribbonImage':    update(screenId, { ribbon: { images: checkedValues(screenId, 'ribbonImage') } }); break;
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
  if (el.dataset.action !== 'texts') return;
  const screen = findScreen(el.dataset.screen);
  const button = el.parentElement.querySelector('[data-action="applyTexts"]');
  button.disabled = el.value.split('\n').map((t) => t.trim()).filter(Boolean).join('\n') === screen.ribbon.texts.join('\n');
}
