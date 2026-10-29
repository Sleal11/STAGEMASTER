/**
 * main.js — Pantalla de score y publicidad (score.html?pantalla=N)
 *
 * Responsabilidad: decidir QUÉ se ve y DÓNDE. Nunca modifica el partido.
 *   1. Se conecta como pantalla N (role: 'display')
 *   2. Recibe su configuración ('screenConfig') y el estado de SU partido
 *      ('matchUpdate')
 *   3. Elige la capa visible:
 *        marcador (+ cinta)  ·  lista de reproducción  ·  espera  ·  logo
 *   4. Coloca la salida: todo el monitor, o un formato LED de tamaño EXACTO
 *      (832×416 o 416×208 píxeles físicos) en la posición indicada
 *   5. Informa a la estación ('display:report'): tamaño real, versión
 *      dibujada (sincronización), qué reproduce y qué archivos fallan
 *
 * Módulos:
 *   scoreboard.js    marcador          ribbon.js   cinta publicitaria
 *   media-player.js  imágenes y vídeos
 */

import { applyLogo }         from '../common/brand.js';
import { createScoreboard }  from './scoreboard.js';
import { createRibbon }      from './ribbon.js';
import { createMediaPlayer } from './media-player.js';

const IDENTIFY_MS = 6000;

const $ = (id) => document.getElementById(id);
const dom = {
  output:   $('output'),
  display:  $('display'),
  court:    $('d-court'),
  waiting:  $('d-waiting'),
  waitingCourt: $('d-waiting-court'),
  board:    $('d-board'),
  ribbon:   $('d-ribbon'),
  media:    $('d-media'),
  standby:  $('d-standby'),
  identify: $('d-identify'),
};

const screenId = readScreenId();
const board    = createScoreboard(dom.display);
const ribbon   = createRibbon(dom.ribbon, { onChange: () => updateLayout() });
const player   = createMediaPlayer(dom.media, { onChange: () => updateLayout() });

let socket         = null;
let config         = null;   // Configuración enviada por la estación
let postMatchReady = false;  // La publicidad de fin de partido ya debe verse
let postMatchTimer = null;
let identifyTimer  = null;
let boxSize        = '';

/** ?pantalla=2 → 'pantalla-2' (por defecto la 1) */
function readScreenId() {
  const value = new URLSearchParams(window.location.search).get('pantalla') || '1';
  return /^pantalla-/.test(value) ? value : 'pantalla-' + value;
}

// ─────────────────────────────────────────────────────────────────
// CONEXIÓN
// ─────────────────────────────────────────────────────────────────

/**
 * Socket.IO reconecta solo; al reconectar el servidor reenvía configuración
 * y estado. Sin conexión NO se borra nada: el público sigue viendo lo último.
 */
function connectToServer() {
  if (typeof window.io !== 'function') {
    console.error('[Pantalla] Socket.IO no disponible. Reintentando en 3 s...');
    setTimeout(() => window.location.reload(), 3000);
    return;
  }
  socket = window.io({ auth: { role: 'display', screenId } });

  socket.on('connect_error', (err) => {
    if (err.data && err.data.code === 'UNKNOWN_SCREEN') {
      dom.waitingCourt.textContent = 'Pantalla no válida';
      console.error('[Pantalla] ' + err.message + '. Usa score.html?pantalla=1 o ?pantalla=2');
    }
  });
  socket.on('screenConfig', applyScreenConfig);
  socket.on('matchUpdate', (payload) => {
    // Solo el partido asignado (el servidor ya filtra por sala)
    if (!config || payload.matchId !== config.matchId) return;
    board.render(payload.state);
    updateLayout();
  });
  socket.on('identify', showIdentify);
}

// ─────────────────────────────────────────────────────────────────
// CONFIGURACIÓN (en vivo, sin recargar)
// ─────────────────────────────────────────────────────────────────

function applyScreenConfig(next) {
  if (!config || config.matchId !== next.matchId) board.forget();   // otro partido: no animar
  config = next;

  dom.court.textContent = next.matchLabel;
  dom.court.style.setProperty('--court-color', next.matchColor);
  dom.waitingCourt.textContent = next.matchLabel;

  applyOutput();
  ribbon.configure(next.ribbon);
  player.configure(next.media);
  schedulePostMatch(next.postMatch);
  updateLayout();
}

/** Publicidad de fin de partido: primero el resultado unos segundos, después la lista */
function schedulePostMatch(postMatch) {
  clearTimeout(postMatchTimer);
  if (!postMatch) {
    postMatchReady = false;
    return;
  }
  if (postMatchReady) return;
  postMatchTimer = setTimeout(() => {
    postMatchReady = true;
    updateLayout();
  }, postMatch.remainingMs);
}

/**
 * Formato de salida. En los formatos LED la caja mide EXACTAMENTE
 * width × height píxeles físicos (se divide por el escalado de Windows,
 * devicePixelRatio) y se coloca en x, y; el resto de la ventana queda en negro.
 */
function applyOutput() {
  if (!config) return;
  const { width, height, x, y } = config.output;
  const dpr   = window.devicePixelRatio || 1;
  const fixed = !!(width && height);
  const style = dom.output.style;
  document.body.classList.toggle('is-led', fixed);
  style.width  = fixed ? width / dpr + 'px' : '';
  style.height = fixed ? height / dpr + 'px' : '';
  style.left   = fixed ? x / dpr + 'px' : '';
  style.top    = fixed ? y / dpr + 'px' : '';

  // Si cambió el tamaño real, reajustar nombres y cinta
  const size = dom.output.clientWidth + 'x' + dom.output.clientHeight;
  if (size !== boxSize) {
    boxSize = size;
    ribbon.refresh();
    board.fitAll();
  }
}

// ─────────────────────────────────────────────────────────────────
// QUÉ SE VE
// ─────────────────────────────────────────────────────────────────

/**
 *   Lista de reproducción  si la vista es "Publicidad y vídeos", si terminó
 *                          el partido (con la opción activada) o si no hay partido
 *   Logo                   vista "Publicidad y vídeos" sin nada reproducible
 *                          (nunca una pantalla en negro)
 *   Marcador (+ cinta)     en los demás casos; sin partido, "Próximo partido"
 */
function updateLayout() {
  if (!config) return;
  const hasMatch   = board.hasMatch();
  const hasItems   = config.media.items.length > 0;
  const wantsMedia = config.view === 'media' || (postMatchReady && !!config.postMatch) || !hasMatch;

  player.setActive(wantsMedia && hasItems);
  const showMedia   = wantsMedia && hasItems && player.hasPlayable();
  const showStandby = !showMedia && config.view === 'media';
  const showScore   = !showMedia && !showStandby;
  const showRibbon  = showScore && hasMatch && ribbon.hasContent();

  dom.media.classList.toggle('hidden', !showMedia);
  dom.standby.classList.toggle('hidden', !showStandby);
  dom.board.classList.toggle('hidden', !hasMatch);
  dom.waiting.classList.toggle('hidden', hasMatch);

  const ribbonChanged = dom.display.classList.contains('has-ribbon') !== showRibbon;
  dom.display.classList.toggle('has-ribbon', showRibbon);
  dom.ribbon.classList.toggle('hidden', !showRibbon);
  ribbon.setActive(showRibbon);
  // El espacio del marcador cambió (aparece/desaparece la cinta): reajustar nombres
  if (ribbonChanged || showScore) board.fitAll();
  sendReport();
}

// ─────────────────────────────────────────────────────────────────
// INFORME A LA ESTACIÓN
// ─────────────────────────────────────────────────────────────────

/** Tamaño real (píxeles físicos) de lo que ve el público */
function outputPixels() {
  const dpr = window.devicePixelRatio || 1;
  return {
    width:  Math.round(dom.output.clientWidth * dpr),
    height: Math.round(dom.output.clientHeight * dpr),
    dpr,
  };
}

function sendReport() {
  if (!socket || !socket.connected || !config) return;
  socket.emit('display:report', {
    viewport:        outputPixels(),
    renderedMatchId: config.matchId,
    renderedVersion: board.version(),
    adErrors:        ribbon.errors().concat(player.errors()),
    playing:         player.status(),
    soundBlocked:    player.soundBlocked(),
  });
}

// ─────────────────────────────────────────────────────────────────
// IDENTIFICACIÓN ("¿cuál es la Pantalla 2?")
// ─────────────────────────────────────────────────────────────────

function showIdentify(data) {
  const { width, height } = outputPixels();
  dom.identify.innerHTML = '';
  [
    [data.label.toUpperCase(), 'd-identify-title'],
    ['Muestra: ' + (config ? config.matchLabel : '—'), 'd-identify-sub'],
    [width + ' × ' + height + ' px', 'd-identify-sub'],
  ].forEach(([text, className]) => {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    dom.identify.appendChild(div);
  });
  dom.identify.classList.remove('hidden');
  clearTimeout(identifyTimer);
  identifyTimer = setTimeout(() => dom.identify.classList.add('hidden'), IDENTIFY_MS);
}

// ─────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────

/** Wake Lock: la pantalla no se apaga (solo en localhost/HTTPS) */
function keepScreenAwake() {
  if (!('wakeLock' in navigator)) return;
  const request = () => navigator.wakeLock.request('screen').catch((err) => {
    console.warn('[Pantalla] Wake Lock no disponible:', err.message);
  });
  request();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') request(); });
}

applyLogo();
connectToServer();
keepScreenAwake();

// Cambio de resolución, de monitor o de escalado: recolocar, reajustar e informar
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    applyOutput();
    board.fitAll();
    sendReport();
  }, 150);
});

// Las tipografías cargan después del primer dibujo: reajustar al terminar
document.fonts.ready.then(() => {
  board.fitAll();
  ribbon.refresh();
});
