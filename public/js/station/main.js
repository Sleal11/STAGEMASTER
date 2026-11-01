/**
 * main.js — Estación operadora (station.html)
 *
 *   1. Se conecta como estación (solo funciona en el propio portátil)
 *   2. Dibuja partidos y pantallas cada vez que llega 'stationState'
 *      (el servidor lo envía al cambiar algo, como mucho cada 100 ms)
 *   3. Reparte los clics y cambios a cada módulo:
 *        matches.js  partidos        screens.js  pantallas
 *        dialogs.js  diálogos        uploads.js  subir y borrar publicidad
 *        history.js  vista Historial
 *        context.js  estado y envío de órdenes
 *
 * Los textos que cambian con el tiempo ("hace 12 s", "publicidad en 8 s") se
 * actualizan cada segundo sin redibujar las tarjetas.
 */

import { applyLogo } from '../common/brand.js';
import { esc, icon, elapsed } from '../common/ui.js';
import { ctx, send, toast } from './context.js';
import { initDialogs } from './dialogs.js';
import { renderMatches, onMatchClick } from './matches.js';
import { renderScreens, onScreenClick, onScreenChange, onScreenInput } from './screens.js';
import { initUploads } from './uploads.js';
import { renderRemotes, onRemotesClick } from './remotes.js';
import { renderLive, setLiveVisible } from './live.js';
import { initHistory, updateCourts, setHistoryVisible, onHistoryChanged } from './history.js';

const $ = (id) => document.getElementById(id);

function connectToServer() {
  if (typeof window.io !== 'function') {
    setConnection('bad', 'Servidor no disponible · Reintentando…');
    setTimeout(() => window.location.reload(), 3000);
    return;
  }
  const socket = window.io({ auth: { role: 'station' } });
  ctx.socket = socket;

  socket.on('connect', () => {
    setConnection('ok', 'Servidor conectado');
    $('st-blocked').classList.add('hidden');
  });
  socket.on('disconnect', () => setConnection('bad', 'Sin conexión con el servidor · Reconectando…'));
  socket.on('connect_error', (err) => {
    if (err.data && err.data.code === 'STATION_LOCAL_ONLY') {
      $('st-blocked').textContent = err.message;
      $('st-blocked').classList.remove('hidden');
    }
  });
  socket.on('historyChanged', onHistoryChanged);
  socket.on('stationState', (state) => {
    ctx.state = state;
    ctx.clockOffset = state.serverTime - Date.now();
    render(state);
  });
}

function render(state) {
  $('st-open-ads').classList.toggle('hidden', !state.desktop);
  // Versión que está funcionando: no se muestra (estética); se ve al pasar el
  // ratón por el logo y al final de la Ayuda, para comprobar que es la última
  document.querySelector('.st-brand').title = `StageMaster ${state.build.version} · ${state.build.commit}`;
  renderNetwork(state.network);
  renderMatches(state);
  renderScreens(state);
  renderRemotes(state);
  renderLive(state);
  updateCourts(state);
  tick();
}

/** Dirección que deben abrir los teléfonos de los árbitros */
function renderNetwork(network) {
  const el = $('st-network');
  if (!network.addresses.length) {
    el.innerHTML = `<span class="st-network-main is-bad">${icon('alert')}El portátil no está conectado a ninguna red: los teléfonos no podrán entrar</span>`;
    return;
  }
  const others = network.addresses.slice(1).map((a) => esc(a.address));
  el.innerHTML = `<span class="st-network-main">${icon('wifi')}Teléfonos de árbitro: <strong>${esc(network.primary.controlUrl)}</strong></span>` +
    (others.length ? `<span class="st-network-alt" title="Si los teléfonos no conectan, prueba con estas direcciones">Otras redes: ${others.join(', ')}</span>` : '');
}

/** Textos que dependen de la hora: "hace 12 s" y "publicidad en 8 s" */
function tick() {
  document.querySelectorAll('[data-tick-since]').forEach((el) => {
    el.textContent = elapsed(Number(el.dataset.tickSince));
  });
  let pending = false;
  document.querySelectorAll('[data-tick-until]').forEach((el) => {
    const seconds = Math.ceil((Number(el.dataset.tickUntil) - (Date.now() + ctx.clockOffset)) / 1000);
    el.textContent = Math.max(0, seconds) + ' s';
    if (seconds <= 0) pending = true;
  });
  // La cuenta atrás llegó a 0: redibujar para mostrar "mostrando la publicidad"
  if (pending && ctx.state) renderScreens(ctx.state);
}

function setConnection(kind, text) {
  $('st-conn-dot').className = 'dot ' + kind;
  $('st-conn-text').textContent = text;
}

// ─────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────

/** Panel (partidos y pantallas) ↔ En vivo ↔ Historial */
function showView(view) {
  document.querySelectorAll('.st-view-tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.view === view);
    tab.setAttribute('aria-selected', tab.dataset.view === view);
  });
  $('view-panel').classList.toggle('hidden', view !== 'panel');
  $('view-live').classList.toggle('hidden', view !== 'live');
  $('view-history').classList.toggle('hidden', view !== 'history');
  setHistoryVisible(view === 'history');
  setLiveVisible(view === 'live');
}

applyLogo();
initDialogs();
initUploads();
initHistory();
document.querySelector('.st-views').addEventListener('click', (e) => {
  const tab = e.target.closest('.st-view-tab');
  if (tab) showView(tab.dataset.view);
});

$('st-matches').addEventListener('click', onMatchClick);
$('st-screens').addEventListener('click', onScreenClick);
$('st-screens').addEventListener('change', onScreenChange);
$('st-screens').addEventListener('input', onScreenInput);
$('st-remotes').addEventListener('click', onRemotesClick);
// En vivo: identificar una pantalla o ir a sus ajustes en el Panel
$('live-grid').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { screen } = button.dataset;
  if (button.dataset.action === 'identify') send('station:identify', { screenId: screen }, button);
  if (button.dataset.action === 'goto') {
    showView('panel');
    const card = document.querySelector(`[data-screen-card="${screen}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

$('st-open-ads').addEventListener('click', (event) => send('station:openAdsFolder', {}, event.currentTarget));
$('st-help').addEventListener('click', () => window.open('/ayuda.html', 'ayuda', 'width=920,height=820'));
$('st-add-screen').addEventListener('click', (event) => {
  send('station:addScreen', {}, event.currentTarget).then((res) => {
    if (res.ok) toast(`${res.screenId.replace('pantalla-', 'Pantalla ')} añadida: elige su monitor en «Salida»`);
  });
});
$('st-refresh-ads').addEventListener('click', (event) => {
  send('station:refreshAds', {}, event.currentTarget).then((res) => {
    if (res.ok) {
      const videos = res.ads.fullscreen.filter((a) => a.kind === 'video').length;
      toast(`Publicidad actualizada: ${res.ads.banner.length} para la cinta, ` +
        `${res.ads.fullscreen.length - videos} imágenes y ${videos} vídeos para la lista`);
    }
  });
});

setInterval(tick, 1000);
connectToServer();
