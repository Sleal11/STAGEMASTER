/**
 * main.js — Estación operadora (station.html)
 *
 *   1. Se conecta como estación: en el portátil principal, o en un portátil
 *      remoto enlazado (station.html#remoto=TOKEN, la abre su aplicación). Lo
 *      reservado al principal (enlazar portátiles, su resolución, su firewall,
 *      su carpeta) no se muestra en la de un remoto; el servidor lo impide igual.
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
import { icon, elapsed } from '../common/ui.js';
import { ctx, send, toast, patch, remoteToken, isRemoteViewer } from './context.js';
import { initDialogs } from './dialogs.js';
import { renderMatches, onMatchClick } from './matches.js';
import { renderScreens, onScreenClick, onScreenChange, onScreenInput } from './screens.js';
import { initUploads } from './uploads.js';
import { renderRemotes, onRemotesClick } from './remotes.js';
import { renderLive, setLiveVisible } from './live.js';
import { initHistory, updateCourts, setHistoryVisible, onHistoryChanged, onReconnected as historyReconnected } from './history.js';
import { initCollapse, expand } from './collapse.js';
import { initAppearance, refreshAppearance } from './appearance.js';
import { followTheme } from '../common/theme.js';

const $ = (id) => document.getElementById(id);

function connectToServer() {
  if (typeof window.io !== 'function') {
    setConnection('bad', 'Servidor no disponible · Reintentando…');
    setTimeout(() => window.location.reload(), 3000);
    return;
  }
  const socket = window.io({ auth: { role: 'station', remoteToken: remoteToken || undefined } });
  ctx.socket = socket;
  followTheme(socket, 'ui');

  socket.on('connect', () => {
    setConnection('ok', 'Servidor conectado');
    $('st-blocked').classList.add('hidden');
    historyReconnected();
  });
  socket.on('disconnect', () => setConnection('bad', 'Sin conexión con el servidor · Reconectando…'));
  socket.on('connect_error', (err) => {
    if (err.data && err.data.code === 'STATION_LOCAL_ONLY') showBlocked(err.message);
  });
  // Portátil remoto desvinculado por el principal: la estación deja de funcionar
  socket.on('stationRevoked', ({ message } = {}) => {
    socket.io.opts.reconnection = false;
    showBlocked(message || 'Este portátil ya no está enlazado.');
    setConnection('bad', 'Desvinculado');
  });
  socket.on('historyChanged', onHistoryChanged);
  socket.on('stationState', (state) => {
    ctx.state = state;
    ctx.clockOffset = state.serverTime - Date.now();
    render(state);
  });
}

function showBlocked(message) {
  $('st-blocked').textContent = message;
  $('st-blocked').classList.remove('hidden');
}

function render(state) {
  const remote = isRemoteViewer();
  document.body.classList.toggle('is-remote-station', remote);
  $('st-title').textContent = remote ? 'Estación · portátil remoto' : 'Estación operadora';
  // La carpeta de publicidad está en el principal: desde un remoto se sube con «Subir archivos…»
  $('st-open-ads').classList.toggle('hidden', !state.desktop || remote);
  // Versión que está funcionando: no se muestra (estética); se ve al pasar el
  // ratón por el logo y al final de la Ayuda, para comprobar que es la última
  document.querySelector('.st-brand').title = `StageMaster ${state.build.version} · ${state.build.commit}`;
  renderNetwork(state.network);
  renderPhonesAlert(state);
  renderMatches(state);
  renderScreens(state);
  renderRemotes(state);
  renderZoneSummaries(state);
  renderLive(state);
  updateCourts(state);
  refreshAppearance();
  tick();
}

/** Resumen de cada zona del Panel (se lee también con la zona minimizada) */
function renderZoneSummaries(state) {
  const count = (list, test) => list.filter(test).length;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const playing  = count(state.matches, (m) => m.state && m.state.status === 'playing');
  const finished = count(state.matches, (m) => m.state && m.state.status === 'finished');
  patch($('st-courts-summary'), [plural(state.matches.length, 'pista', 'pistas'),
    playing && `<span class="dot ok"></span>${playing} en juego`, finished && `${finished} ${finished === 1 ? 'finalizada' : 'finalizadas'}`]
    .filter(Boolean).join(' · '));
  const online = count(state.screens, (s) => s.displays.length > 0);
  patch($('st-screens-summary'), `${plural(state.screens.length, 'pantalla', 'pantallas')} · ` +
    `<span class="dot ${online === state.screens.length ? 'ok' : online ? 'warn' : 'bad'}"></span>${online} ${online === 1 ? 'conectada' : 'conectadas'}`);
  if (state.remotes) {
    const linked = state.remotes.list.length;
    patch($('st-remotes-summary'), linked ? plural(linked, 'portátil enlazado', 'portátiles enlazados') : 'Ninguno enlazado');
  }
}

/**
 * Cabecera: solo avisa si el portátil no tiene red. La dirección para los
 * teléfonos está junto al QR de cada pista (no hace falta repetirla arriba).
 */
function renderNetwork(network) {
  patch($('st-network'), network.addresses.length ? ''
    : `<span class="st-network-main is-bad">${icon('alert')}Sin red: los teléfonos no podrán entrar</span>`);
}

/**
 * Aviso si el firewall de Windows no deja entrar a los teléfonos (el QR
 * abriría «el servidor no responde»), con el botón para arreglarlo.
 */
function renderPhonesAlert(state) {
  const check = state.desktop && state.desktop.network;
  let html = '';
  if (check && check.ok === false) {
    const why = check.blocked
      ? 'El firewall de Windows está <strong>bloqueando StageMaster</strong>'
      : check.publicNetwork
        ? 'La red de este portátil está marcada como <strong>«Pública»</strong> y el firewall de Windows no deja entrar a los teléfonos'
        : 'Puede que el firewall de Windows <strong>no deje entrar</strong> a los teléfonos';
    html = `<div class="st-phones-alert">${icon('alert')}<div class="st-phones-alert-text"><strong>Los teléfonos pueden no conectarse.</strong> ` +
      `${why}: al escanear el QR verían «el servidor no responde». ` +
      (isRemoteViewer()
        // El permiso de administrador lo pide Windows en el principal: se pulsa allí
        ? 'Pulsa <strong>Permitir teléfonos</strong> en la estación del <strong>portátil principal</strong> (Windows pide permiso allí).</div>' +
          '<div class="st-phones-alert-actions">'
        : 'Pulsa <strong>Permitir teléfonos</strong> (Windows pedirá permiso de administrador una vez; solo se abre a la red local).</div>' +
          '<div class="st-phones-alert-actions"><button type="button" class="btn btn-primary btn-sm" data-action="allowPhones">' +
          `${icon('check')}Permitir teléfonos</button>`) +
      `<button type="button" class="btn btn-ghost btn-sm" data-action="checkNetwork">${icon('refresh')}Comprobar</button></div></div>`;
  }
  patch($('st-phones-alert'), html);
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
initCollapse();
initAppearance();
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
$('st-phones-alert').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'allowPhones') {
    send('station:allowPhones', {}, button).then((res) => { if (res.ok) toast('Listo: los teléfonos ya pueden conectarse'); });
  }
  if (button.dataset.action === 'checkNetwork') send('station:checkNetwork', {}, button);
});
// En vivo: identificar una pantalla o ir a sus ajustes en el Panel
$('live-grid').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { screen } = button.dataset;
  if (button.dataset.action === 'identify') send('station:identify', { screenId: screen }, button);
  if (button.dataset.action === 'goto') {
    showView('panel');
    expand('zona-pantallas', 'pantalla:' + screen);
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
