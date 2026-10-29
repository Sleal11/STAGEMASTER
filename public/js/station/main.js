/**
 * main.js — Estación operadora (station.html)
 *
 *   1. Se conecta como estación (solo funciona en el propio portátil)
 *   2. Dibuja partidos y pantallas cada vez que llega 'stationState'
 *      (el servidor lo envía al cambiar algo, como mucho cada 100 ms)
 *   3. Reparte los clics y cambios a cada módulo:
 *        matches.js  partidos        screens.js  pantallas
 *        dialogs.js  diálogos        uploads.js  subir y borrar publicidad
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
  socket.on('stationState', (state) => {
    ctx.state = state;
    ctx.clockOffset = state.serverTime - Date.now();
    render(state);
  });
}

function render(state) {
  $('st-open-ads').classList.toggle('hidden', !state.desktop);
  renderNetwork(state.network);
  renderMatches(state);
  renderScreens(state);
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

applyLogo();
initDialogs();
initUploads();

$('st-matches').addEventListener('click', onMatchClick);
$('st-screens').addEventListener('click', onScreenClick);
$('st-screens').addEventListener('change', onScreenChange);
$('st-screens').addEventListener('input', onScreenInput);

$('st-open-ads').addEventListener('click', (event) => send('station:openAdsFolder', {}, event.currentTarget));
$('st-help').addEventListener('click', () => window.open('/ayuda.html', 'ayuda', 'width=920,height=820'));
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
