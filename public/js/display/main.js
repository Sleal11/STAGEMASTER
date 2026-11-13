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
 * VISTA PREVIA (score.html?pantalla=N&vista=previa): la usa la pestaña «En vivo»
 * de la estación. Recibe y dibuja exactamente lo mismo, pero: sin sonido, sin
 * informar a la estación (no cuenta como ventana), sin «Identificar» y con el
 * formato LED ocupando toda la vista (la estación la escala en su tarjeta).
 *
 * Módulos:
 *   scoreboard.js    marcador          ribbon.js   cinta publicitaria
 *   media-player.js  imágenes y vídeos     finale.js   celebración y resumen final
 */

import { applyLogo }         from '../common/brand.js';
import { createScoreboard }  from './scoreboard.js';
import { createRibbon }      from './ribbon.js';
import { createMediaPlayer } from './media-player.js';
import { createFinale }      from './finale.js';
import { followTheme }       from '../common/theme.js';

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
  dimmer:   $('d-dimmer'),
  summary:  $('d-summary'),
  celebrate: $('d-celebrate'),
};

const screenId    = readScreenId();
const preview     = new URLSearchParams(window.location.search).get('vista') === 'previa';
if (preview) document.body.classList.add('is-preview');
// Portátil remoto enlazado: su token viene en el enlace (score.html?pantalla=N#remoto=TOKEN)
const remoteToken = new URLSearchParams(window.location.hash.slice(1)).get('remoto') || undefined;
const board    = createScoreboard(dom.display);
const ribbon   = createRibbon(dom.ribbon, { onChange: () => updateLayout(), onMove: () => sendSync() });
const player   = createMediaPlayer(dom.media, { onChange: () => updateLayout() });
const finale   = createFinale({ summary: dom.summary, celebrate: dom.celebrate }, () => updateLayout(), () => sendSync());

/** Cada cuánto la pantalla real dice por dónde va (además de en cada cambio) */
const SYNC_EVERY_MS = 4000;

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
  // Con remoteToken: pantalla o vista previa abierta desde un portátil remoto enlazado
  socket = window.io({ auth: { role: preview ? 'preview' : 'display', screenId, remoteToken } });

  socket.on('connect_error', (err) => {
    const code = err.data && err.data.code;
    if (code === 'UNKNOWN_SCREEN' || code === 'DISPLAY_LOCAL_ONLY') {
      // Rechazo del servidor (no es un corte de red): se reintenta cada 5 s
      // por si se añade la pantalla o se vuelve a enlazar el portátil
      dom.waitingCourt.textContent = code === 'UNKNOWN_SCREEN' ? 'Pantalla no válida' : 'Pantalla no autorizada';
      console.error('[Pantalla] ' + err.message);
      setTimeout(() => { if (!socket.connected) socket.connect(); }, 5000);
    }
  });
  // El operador quitó esta pantalla en la estación: no se reconecta
  socket.on('screenRemoved', () => {
    socket.io.opts.reconnection = false;
    config = null;
    player.setActive(false);
    ribbon.setActive(false);
    [dom.board, dom.ribbon, dom.media, dom.standby].forEach((el) => el.classList.add('hidden'));
    dom.waiting.classList.remove('hidden');
    dom.waitingCourt.textContent = 'Pantalla quitada en la estación';
    dom.waiting.querySelector('.d-waiting-text').textContent = 'Esta ventana ya se puede cerrar';
  });
  followTheme(socket, 'led');
  socket.on('screenConfig', applyScreenConfig);
  socket.on('matchUpdate', (payload) => {
    // Solo el partido asignado (el servidor ya filtra por sala)
    if (!config || payload.matchId !== config.matchId) return;
    board.render(payload.state);
    finale.update(payload.state, payload.matchId);
    updateLayout();
  });
  if (!preview) socket.on('identify', showIdentify);
  // «En vivo» en tiempo real: la vista previa sigue a la pantalla real (misma cinta,
  // mismo vídeo en el mismo momento, marcador o estadísticas a la vez)
  if (preview) {
    socket.on('playbackSync', (sync) => {
      if (!sync) return;
      lastFollow = { sync, at: Date.now(), todo: ['ribbon', 'media', 'phase'] };
      applyFollow();
    });
  } else {
    socket.on('syncRequest', () => sendSync(true));
    setInterval(() => sendSync(true), SYNC_EVERY_MS);
  }
}

/**
 * Vista previa: aplicar lo que dijo la pantalla real. Cada parte (cinta,
 * publicidad, fase final) se aplica una vez; si aún no estaba lista (el aviso
 * llegó antes de montarse), se reintenta al terminar de montarse, contando el
 * tiempo que ha pasado desde el aviso.
 */
let lastFollow = null;
function applyFollow() {
  if (!lastFollow) return;
  const age = Date.now() - lastFollow.at;
  if (age > SYNC_EVERY_MS * 2) { lastFollow = null; return; }
  const later = (pos) => (pos && Number.isFinite(pos.elapsed) ? { ...pos, elapsed: pos.elapsed + age } : pos);
  const { sync, todo } = lastFollow;
  lastFollow.todo = [];   // antes de seguir: lo que provoque un nuevo montaje no lo repite
  const retry = todo.filter((part) => {
    if (part === 'ribbon') return !ribbon.follow(later(sync.ribbon));
    if (part === 'media') return !player.follow(later(sync.media));
    return !finale.follow(sync.phase);
  });
  if (lastFollow) lastFollow.todo = [...new Set([...lastFollow.todo, ...retry])];
}

/**
 * La pantalla REAL informa por dónde va: qué elemento o grupo de la cinta, qué
 * vídeo y en qué segundo, y si está en el marcador o en las estadísticas. El
 * servidor se lo pasa SOLO a sus vistas previas (no recalcula nada más).
 */
let lastSync = '';
function sendSync(force = false) {
  if (preview || !socket || !socket.connected || !config) return;
  const sync = { ribbon: ribbon.position(), media: player.position(), phase: finale.phase() };
  const key = JSON.stringify([sync.ribbon && [sync.ribbon.motion, sync.ribbon.key], sync.media && sync.media.url, sync.phase]);
  if (!force && key === lastSync) return;
  lastSync = key;
  socket.emit('display:sync', sync);
}

// ─────────────────────────────────────────────────────────────────
// CONFIGURACIÓN (en vivo, sin recargar)
// ─────────────────────────────────────────────────────────────────

function applyScreenConfig(next) {
  if (!config || config.matchId !== next.matchId) {   // otro partido: no animar ni celebrar
    board.forget();
    finale.reset();
  }
  config = next;
  finale.setStatsEnabled(next.showStats);
  // Alto de la cinta elegido en la estación (0 = el automático de score.css)
  dom.display.style.setProperty('--ribbon-h', next.ribbon.height ? next.ribbon.height + 'cqh' : '');

  dom.court.textContent = next.matchLabel;
  dom.court.style.setProperty('--court-color', next.matchColor);
  dom.waitingCourt.textContent = next.matchLabel;

  applyOutput();
  ribbon.configure(next.ribbon);
  // La vista previa nunca suena (la estación puede tener varias a la vez)
  player.configure(preview ? { ...next.media, sound: false } : next.media);
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
  const { width, height, brightness } = config.output;
  // Vista previa: el formato LED ocupa toda la vista, en píxeles tal cual
  const x = preview ? 0 : config.output.x;
  const y = preview ? 0 : config.output.y;
  // Brillo de la imagen (no el físico de los módulos LED): velo negro encima de todo
  dom.dimmer.style.opacity = String(1 - (brightness || 100) / 100);
  const dpr   = preview ? 1 : (window.devicePixelRatio || 1);
  const fixed = !!(width && height);
  const style = dom.output.style;
  document.body.classList.toggle('is-led', fixed);
  style.width  = fixed ? width / dpr + 'px' : '';
  style.height = fixed ? height / dpr + 'px' : '';
  style.left   = fixed ? x / dpr + 'px' : '';
  style.top    = fixed ? y / dpr + 'px' : '';
  player.setFit(config.output.fit || 'auto');

  // Si cambió el tamaño real, reajustar nombres y cinta
  const size = dom.output.clientWidth + 'x' + dom.output.clientHeight;
  if (size !== boxSize) {
    boxSize = size;
    ribbon.refresh();
    board.fitAll();
    player.relayout();
  }
}

// ─────────────────────────────────────────────────────────────────
// QUÉ SE VE
// ─────────────────────────────────────────────────────────────────

/**
 *   Lista de reproducción  si la vista es "Publicidad y vídeos", si terminó
 *                          el partido (tras la celebración) o está en pausa
 *                          (con la opción activada), o si no hay partido
 *   Logo                   vista "Publicidad y vídeos" sin nada reproducible
 *                          (nunca una pantalla en negro)
 *   Marcador (+ cinta)     en los demás casos; sin partido, "Próximo partido";
 *                          partido terminado: celebración y después marcador y
 *                          estadísticas, alternándose
 */
function updateLayout() {
  if (!config) return;
  const hasMatch   = board.hasMatch();
  const hasItems   = config.media.items.length > 0;
  // La publicidad al terminar espera a que acabe la celebración
  const postMatchAds = postMatchReady && !!config.postMatch && !finale.isCelebrating();
  const wantsMedia = config.view === 'media' || postMatchAds || config.pauseMedia || !hasMatch;

  player.setActive(wantsMedia && hasItems);
  const showMedia   = wantsMedia && hasItems && player.hasPlayable();
  const showStandby = !showMedia && config.view === 'media';
  const showScore   = !showMedia && !showStandby;
  const showRibbon  = showScore && hasMatch && ribbon.hasContent();

  dom.media.classList.toggle('hidden', !showMedia);
  dom.standby.classList.toggle('hidden', !showStandby);
  // Partido terminado: el marcador (con el ganador) y las estadísticas se alternan;
  // la celebración va encima
  const stats = hasMatch && finale.isShowingStats();
  dom.board.classList.toggle('hidden', !hasMatch || stats);
  dom.summary.classList.toggle('hidden', !stats);
  dom.celebrate.classList.toggle('hidden', !(showScore && finale.isCelebrating()));
  dom.waiting.classList.toggle('hidden', hasMatch);

  const ribbonChanged = dom.display.classList.contains('has-ribbon') !== showRibbon;
  dom.display.classList.toggle('has-ribbon', showRibbon);
  dom.ribbon.classList.toggle('hidden', !showRibbon);
  ribbon.setActive(showRibbon);
  // El espacio del marcador cambió (aparece/desaparece la cinta): reajustar nombres
  if (ribbonChanged || showScore) board.fitAll();
  if (showScore && (stats || finale.isCelebrating())) finale.fit();
  sendReport();
  if (preview) applyFollow();
  else sendSync();
}

// ─────────────────────────────────────────────────────────────────
// INFORME A LA ESTACIÓN
// ─────────────────────────────────────────────────────────────────

/**
 * Tamaño real (píxeles físicos) de lo que ve el público. Con el escalado de
 * Windows (125 %, 150 %…) el tamaño en CSS tiene decimales: se mide sin
 * redondear (getBoundingClientRect) para no informar 1921 × 1081 en un
 * monitor de 1920 × 1080.
 */
function outputPixels() {
  const dpr = window.devicePixelRatio || 1;
  const box = dom.output.getBoundingClientRect();
  return {
    width:  Math.round(box.width * dpr),
    height: Math.round(box.height * dpr),
    dpr,
  };
}

function sendReport() {
  if (preview || !socket || !socket.connected || !config) return;
  const dpr = window.devicePixelRatio || 1;
  socket.emit('display:report', {
    viewport:        outputPixels(),
    window:          { width: Math.round(window.innerWidth * dpr), height: Math.round(window.innerHeight * dpr) },
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
    data.mirrorOf ? ['Espejo de ' + data.mirrorOf, 'd-identify-sub'] : null,
    ['Muestra: ' + (config ? config.matchLabel : '—'), 'd-identify-sub'],
    [width + ' × ' + height + ' px', 'd-identify-sub'],
  ].filter(Boolean).forEach(([text, className]) => {
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
if (!preview) keepScreenAwake();

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
