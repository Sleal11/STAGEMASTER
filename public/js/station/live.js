/**
 * live.js — Pestaña «En vivo»: todas las pantallas de un vistazo
 *
 * Para cuando el moderador no ve las pantallas LED desde su sitio. Cada
 * tarjeta tiene:
 *   - Una VISTA PREVIA en movimiento de lo que StageMaster envía a esa
 *     pantalla (score.html?vista=previa: mismo diseño, mismos datos, con la
 *     proporción y el tamaño reales del formato, escalada a la tarjeta).
 *   - El ESTADO REAL que informa la propia pantalla: conectada o no y dónde,
 *     resolución, marcador al día, qué se está reproduciendo y problemas.
 *
 * Las vistas previas solo existen mientras la pestaña está abierta (no gastan
 * nada en segundo plano). La pestaña muestra un aviso rojo con el número de
 * pantallas con problemas aunque esté cerrada.
 */

import { esc, icon, fileNameOf } from '../common/ui.js';
import { ctx, findMatch, findScreen, serverNow, patch, remoteToken } from './context.js';
import { playableCount, outputSize } from './screens.js';

const DEFAULT_SIZE = { width: 1920, height: 1080 };

let visible = false;
const frames = new Map();   // pantalla → { iframe, width, height }
const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => entries.forEach((e) => fit(e.target))) : null;

/** La pestaña se abre o se cierra: crear o quitar las vistas previas */
export function setLiveVisible(isVisible) {
  visible = isVisible;
  if (!visible) {
    frames.forEach((frame) => frame.iframe.remove());
    frames.clear();
  }
  if (ctx.state) renderLive(ctx.state);
}

export function renderLive(state) {
  const issues = state.screens.map((screen) => statusOf(screen, state)).filter((s) => s.problem).length;
  renderTabBadge(issues);
  if (!visible) return;

  const grid = document.getElementById('live-grid');
  grid.querySelectorAll('[data-live]').forEach((tile) => {
    if (!state.screens.some((s) => s.id === tile.dataset.live)) {
      frames.delete(tile.dataset.live);
      tile.remove();
    }
  });
  state.screens.forEach((screen, index) => {
    let tile = grid.querySelector(`[data-live="${screen.id}"]`);
    if (!tile) {
      tile = createTile(screen);
      grid.insertBefore(tile, grid.children[index] || null);
    }
    updateTile(tile, screen, state);
  });

  const connected = state.screens.filter((s) => s.displays.length > 0).length;
  patch(document.getElementById('live-summary'),
    `<span>${state.screens.length} pantalla${state.screens.length === 1 ? '' : 's'}</span>` +
    `<span><span class="dot ok"></span>${connected} conectada${connected === 1 ? '' : 's'}</span>` +
    (issues ? `<span class="live-summary-bad"><span class="dot bad"></span>${issues} con problemas</span>`
      : '<span><span class="dot ok"></span>Todo en orden</span>'));
}

function createTile(screen) {
  const tile = document.createElement('article');
  tile.className = 'live-tile';
  tile.dataset.live = screen.id;
  tile.innerHTML = `
    <header class="live-head"><span class="live-name"></span><span class="pill" data-part="chip"></span><span data-part="state"></span></header>
    <div class="live-frame" data-part="frame"><div class="live-overlay hidden" data-part="overlay"></div></div>
    <div class="live-info" data-part="info"></div>
    <footer class="live-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-action="identify" data-screen="${screen.id}">${icon('eye')}Identificar</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="goto" data-screen="${screen.id}">${icon('sliders')}Ajustes</button>
    </footer>`;
  if (resizer) resizer.observe(tile.querySelector('[data-part="frame"]'));
  return tile;
}

function updateTile(tile, screen, state) {
  const match = findMatch(screen.matchId);
  const source = screen.mirrorOf && findScreen(screen.mirrorOf);
  const status = statusOf(screen, state);
  tile.style.setProperty('--court-color', match.color);
  tile.classList.toggle('has-problem', status.problem);
  tile.querySelector('.live-name').textContent = screen.label;
  tile.querySelector('[data-part="chip"]').textContent = (source ? `Espejo de ${source.label} · ` : '') + screen.matchLabel;
  patch(tile.querySelector('[data-part="state"]'),
    `<span class="pill live-state ${status.kind}">${status.badge}</span>`);

  // Vista previa al tamaño real del formato (o del monitor), escalada a la tarjeta
  const size = realSize(screen, state);
  const box = tile.querySelector('[data-part="frame"]');
  box.style.aspectRatio = `${size.width} / ${size.height}`;
  let frame = frames.get(screen.id);
  if (!frame) {
    const iframe = document.createElement('iframe');
    iframe.className = 'live-iframe';
    iframe.title = `Vista previa de ${screen.label}`;
    iframe.setAttribute('tabindex', '-1');
    // En un portátil remoto la vista previa necesita su token (como la estación)
    iframe.src = `/score.html?pantalla=${screen.id.replace('pantalla-', '')}&vista=previa` +
      (remoteToken ? `#remoto=${encodeURIComponent(remoteToken)}` : '');
    box.prepend(iframe);
    frame = { iframe };
    frames.set(screen.id, frame);
  }
  if (frame.width !== size.width || frame.height !== size.height) {
    frame.width = size.width;
    frame.height = size.height;
    frame.iframe.style.width = size.width + 'px';
    frame.iframe.style.height = size.height + 'px';
  }
  fit(box);

  const overlay = tile.querySelector('[data-part="overlay"]');
  overlay.classList.toggle('hidden', !status.overlay);
  overlay.textContent = status.overlay || '';
  patch(tile.querySelector('[data-part="info"]'), infoHtml(screen, state, status));
}

/** Escala la vista previa al ancho de su tarjeta */
function fit(box) {
  const iframe = box.querySelector('iframe');
  const width = parseFloat(iframe && iframe.style.width);
  if (!width || !box.clientWidth) return;
  iframe.style.transform = `scale(${box.clientWidth / width})`;
}

/** Tamaño real: el del formato LED, el del monitor que informa la pantalla o 1920 × 1080 */
function realSize(screen, state) {
  const fixed = outputSize(screen, state);
  if (fixed) return fixed;
  const reported = screen.displays.find((d) => d.window && d.window.width && d.window.height);
  return reported ? reported.window : DEFAULT_SIZE;
}

/**
 * Estado de la pantalla para el moderador:
 *   kind     ok | warn | bad | off
 *   badge    texto corto de la tarjeta
 *   overlay  texto sobre la vista previa si el público NO la está viendo
 *   problem  cuenta para el aviso rojo de la pestaña
 */
function statusOf(screen, state) {
  const desktop = state.desktop;
  const displays = screen.displays;
  const chosenNone = desktop && desktop.preferences[screen.id] === 'none' && !displays.length;
  if (chosenNone) {
    return { kind: 'off', badge: 'No se muestra', overlay: 'No se muestra en ningún monitor (elegido en Salida)', problem: false };
  }
  if (!displays.length) {
    const noMonitor = desktop && !desktop.assignments[screen.id];
    return noMonitor
      ? { kind: 'bad', badge: 'Sin monitor', overlay: 'SIN MONITOR · el público no ve esta pantalla', problem: true }
      : { kind: 'bad', badge: 'Sin conexión', overlay: 'SIN CONEXIÓN · el público no ve esta pantalla', problem: true };
  }
  if (displays.some((d) => d.sync === 'stale')) {
    return { kind: 'bad', badge: 'Desincronizada', overlay: 'La pantalla no está al día', problem: true };
  }
  if (displays.some((d) => d.sync === 'pending')) return { kind: 'warn', badge: 'Actualizando…', overlay: null, problem: false };
  return { kind: 'ok', badge: 'En pantalla', overlay: null, problem: false };
}

/** Qué ve el público ahora mismo (misma lógica que la propia pantalla) */
function showing(screen) {
  const match = findMatch(screen.matchId);
  const hasMatch = !!match.state;
  const postMatchOn = screen.postMatch && serverNow() >= screen.postMatch.since + screen.endAds.delay * 1000;
  const wantsMedia = screen.view === 'media' || postMatchOn || !!screen.pauseMedia || !hasMatch;
  const hasList = playableCount(screen) > 0;
  if (wantsMedia && hasList) {
    const why = screen.view === 'media' ? '' : screen.pauseMedia ? ' (partido en pausa)' : postMatchOn ? ' (fin del partido)' : ' (sin partido)';
    return { text: 'Publicidad y vídeos' + why, media: true };
  }
  if (screen.view === 'media') return { text: 'Logo de StageMaster (lista de reproducción vacía)', media: false };
  if (!hasMatch) return { text: 'Próximo partido (sin partido ni publicidad)', media: false };
  const status = match.state.status === 'finished' ? ' · terminado' : match.state.paused ? ' · en pausa' : '';
  const ribbon = screen.ribbon.enabled && (screen.ribbon.items.length > 0 || screen.ribbon.texts.length > 0);
  return { text: `Marcador de ${match.label}${status}${ribbon ? ' con cinta' : ''}`, media: false };
}

function infoHtml(screen, state, status) {
  const rows = [];
  const row = (label, value) => rows.push(`<div class="live-row"><span class="live-label">${label}</span><span>${value}</span></div>`);
  const displays = screen.displays;
  const what = showing(screen);
  row('Muestra', esc(what.text));

  if (displays.length) {
    // Dónde: portátil remoto, o el monitor de este portátil (aplicación de escritorio)
    const desktop = state.desktop;
    const monitor = desktop && desktop.monitors.find((m) => m.key === desktop.assignments[screen.id]);
    const local = monitor ? `en ${esc(monitor.label)} (este portátil)` : desktop && desktop.assignments[screen.id] === 'window'
      ? 'en una ventana de prueba' : 'en este portátil';
    const where = [...new Set(displays.map((d) => (d.remote ? `en «${esc(d.remote)}»` : local)))].join(' y ');
    const size = displays[0].viewport ? ` · ${displays[0].viewport.width} × ${displays[0].viewport.height} px` : '';
    row('Ventana', `<span class="dot ok"></span>Conectada ${where}${size}`);
    const sync = { ok: '<span class="dot ok"></span>Al día', pending: '<span class="dot warn"></span>Actualizando…', stale: '<span class="dot bad"></span>Desincronizada' };
    row('Marcador', sync[displays[0].sync] || '—');
    const playing = displays[0].playing;
    if (what.media && playing) {
      row('Reproduce', `${icon(playing.kind === 'video' ? 'video' : 'image')}${playing.paused ? 'En pausa · ' : ''}${playing.index}/${playing.total} · ${esc(playing.name)}`);
    }
  } else {
    row('Ventana', `<span class="dot bad"></span>${esc(status.badge)}`);
  }

  const format = state.outputFormats.find((f) => f.id === screen.output.format);
  const size = outputSize(screen, state);
  row('Salida', (size ? `LED ${size.width} × ${size.height} px` : 'Monitor completo') +
    (format && format.saved ? ` · «${esc(format.name)}»` : '') +
    (screen.output.brightness < 100 ? ` · brillo ${screen.output.brightness} %` : ''));

  const problems = [];
  const failed = [...new Set([].concat(...displays.map((d) => d.adErrors)))];
  if (failed.length) problems.push(`No se puede mostrar: ${failed.map((u) => esc(fileNameOf(u))).join(', ')}`);
  if (screen.missingAds.length) problems.push(`Faltan en la carpeta: ${esc(screen.missingAds.map(fileNameOf).join(', '))}`);
  if (displays.some((d) => d.soundBlocked)) problems.push('Vídeos sin sonido (bloqueado por el navegador)');
  if (problems.length) row('Atención', `<span class="live-warn">${icon('alert')}${problems.join(' · ')}</span>`);
  return rows.join('');
}

/** Aviso rojo en la pestaña con las pantallas que tienen problemas */
function renderTabBadge(count) {
  const badge = document.getElementById('live-badge');
  if (!badge) return;
  badge.textContent = count ? String(count) : '';
  badge.classList.toggle('hidden', !count);
  badge.closest('.st-view-tab').title = count
    ? `${count} pantalla${count === 1 ? '' : 's'} con problemas` : 'Todas las pantallas de un vistazo';
}
