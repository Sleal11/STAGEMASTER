'use strict';

/**
 * capturar.js — Capturas REALES de StageMaster para los vídeos explicativos
 *
 *   node marketing/tutoriales/fuente/capturar.js
 *
 * Arranca el servidor de verdad (con un adaptador de escritorio de ejemplo:
 * monitores de un portátil con dos LED, como en la aplicación) y datos de
 * ejemplo (nombres inventados),
 * abre la estación, el teléfono del árbitro, la pantalla LED y la ventana del
 * portátil remoto en Chromium y guarda cada vista en capturas/ junto con la
 * posición de sus partes (capturas/zonas.json), que los vídeos usan para
 * acercarse y resaltar. Requisitos: Playwright con Chromium.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const H = require('../../../tests/e2e/harness');

const OUT  = path.join(__dirname, 'capturas');
const PORT = 3480;
const PROMO = path.join(__dirname, '..', '..', 'videos-led', 'StageMaster-LED-1664x832-HD.mp4');
const zones = {};

/** Como la aplicación de escritorio: portátil + dos LED a 1920 × 1080 · 60 Hz */
function exampleDesktop(adsFolder) {
  const listeners = new Set();
  const monitor = (key, label, primary) => ({ key, label, width: 1920, height: 1080, primary, refreshRate: 60, scale: 1, name: primary ? '' : 'LED' });
  return {
    onChange: (fn) => listeners.add(fn),
    setScreens: () => {},
    getState: () => ({
      monitors: [monitor('m1', 'Monitor 1', true), monitor('m2', 'Monitor 2', false), monitor('m3', 'Monitor 3', false)],
      preferences: { 'pantalla-1': 'm2', 'pantalla-2': 'm3' },
      assignments: { 'pantalla-1': 'm2', 'pantalla-2': 'm3' },
      closed: [], adsFolder, canUseAsRemote: true, network: { ok: true }, displayModes: { pending: null },
    }),
    setMonitor: () => {}, openScreen: () => {}, openAdsFolder: () => {},
  };
}

/** Logos de ejemplo de la cinta (marcas INVENTADAS): uno con texto marrón (el realce lo
 *  aclara), uno negro (pasa a blanco) y un «sticker» con fondo rojo (se quita el fondo) */
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const LOGOS = {
  'banner/club-padel-norte.svg': svg(400, 400, '<circle cx="200" cy="200" r="190" fill="#1FB36B"/><circle cx="200" cy="200" r="160" fill="none" stroke="#FFFFFF" stroke-width="10"/>' +
    '<text x="200" y="232" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="110" fill="#FFFFFF">CPN</text>' +
    '<text x="200" y="300" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="34" fill="#FFFFFF">CLUB PÁDEL</text>'),
  'banner/ferreteria-el-tornillo.svg': svg(640, 400, '<rect width="640" height="400" fill="#C0141B"/><ellipse cx="320" cy="200" rx="270" ry="170" fill="#FFFFFF"/>' +
    '<ellipse cx="320" cy="200" rx="250" ry="150" fill="#111111"/><text x="320" y="190" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="64" textLength="400" lengthAdjust="spacingAndGlyphs" fill="#FFFFFF">EL TORNILLO</text>' +
    '<text x="320" y="252" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="46" fill="#F5C518">Ferretería</text>'),
  'banner/cafe-montana.svg': svg(760, 260, '<path d="M40 90 h120 v70 a60 60 0 0 1 -120 0 z" fill="#6B3F22"/><path d="M160 105 a28 28 0 0 1 0 56" fill="none" stroke="#6B3F22" stroke-width="14"/>' +
    '<text x="215" y="160" font-family="Georgia, serif" font-weight="700" font-size="104" textLength="520" lengthAdjust="spacingAndGlyphs" fill="#5A3420">Café Montaña</text>' +
    '<text x="222" y="215" font-family="Arial, sans-serif" font-size="34" textLength="500" lengthAdjust="spacingAndGlyphs" fill="#8A5A3A">TOSTADO ARTESANAL</text>'),
  'banner/optica-vision.svg': svg(900, 220, '<ellipse cx="110" cy="110" rx="95" ry="60" fill="none" stroke="#1E88E5" stroke-width="16"/><circle cx="110" cy="110" r="32" fill="#1E88E5"/>' +
    '<text x="240" y="140" font-family="Arial, sans-serif" font-weight="800" font-size="96" textLength="620" lengthAdjust="spacingAndGlyphs" fill="#1E88E5">ÓPTICA VISIÓN</text>'),
  'banner/bar-central.svg': svg(700, 220, '<text x="350" y="150" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="120" textLength="560" lengthAdjust="spacingAndGlyphs" fill="#111111">Bar Central</text>' +
    '<rect x="120" y="175" width="460" height="8" fill="#111111"/>'),
};
const RIBBON = ['club-padel-norte.svg', 'ferreteria-el-tornillo.svg', 'cafe-montana.svg', 'optica-vision.svg', 'bar-central.svg'];

const NAMES = {
  'pista-1': { nameA: 'Leal / Fernández', nameB: 'Romero / Castillo' },
  'pista-2': { nameA: 'Pérez / Díaz', nameB: 'Torres / Medina' },
};

/** Guarda la captura y la posición (en píxeles CSS) de las partes indicadas */
async function shot(page, name, parts = {}) {
  await page.waitForTimeout(350);
  const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const rects = {};
  for (const [key, selector] of Object.entries(parts)) {
    rects[key] = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }, selector);
    if (!rects[key]) console.warn(`  ⚠ ${name}: no se encontró ${key} (${selector})`);
  }
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  zones[name] = { ...size, rects };
  console.log('✅', name);
}

async function play(st, matchId, actions) {
  for (const action of actions) await st.act(matchId, action);
}

/** Juega puntos para A hasta que el partido termina */
async function finish(st, matchId) {
  for (let i = 0; i < 60 && st.match(matchId).state.status !== 'finished'; i++) await st.act(matchId, 'pointA');
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const ads = H.makeAdsDir({ 'pantalla-completa/StageMaster-LED.mp4': fs.readFileSync(PROMO), ...LOGOS });
  process.env.STAGEMASTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-capturas-'));
  process.env.STAGEMASTER_ADS_DIR = ads;
  process.env.STAGEMASTER_DISCOVERY = '0';
  const { startServer } = require('../../../server/index.js');
  const srv = await startServer({ ports: [PORT], desktop: exampleDesktop(ads), logHttp: false });
  const st = await H.station(PORT);
  const browser = await chromium.launch();
  try {
    // ── Historial: dos partidos ya terminados (1 set de 1 juego) ──
    for (const [a, b] of [['Ruiz / Vega', 'Soto / Navarro'], ['Molina / Ortega', 'Herrera / Campos']]) {
      await st.setup('pista-2', H.config({ nameA: a, nameB: b, gamesPerSet: 1, totalSets: 1 }));
      await play(st, 'pista-2', ['pointA', 'pointB', 'pointB', 'pointA']);
      await finish(st, 'pista-2');
    }

    // Pantalla 1: marcador con cinta (logos fijos + mensajes); Pantalla 2: publicidad
    await st.screen('pantalla-1', {
      ribbon: { enabled: true, items: RIBBON, texts: ['Gracias a nuestros patrocinadores'], motion: 'fixed', interval: 30, effects: { 'cafe-montana.svg': 'define' } },
      media: { items: ['ejemplo-pantalla-completa.png'] }, pauseAds: { enabled: true }, endAds: { enabled: true, delay: 15 },
    });
    const D1 = await browser.newPage({ viewport: { width: 1664, height: 832 } });
    await D1.goto(`http://localhost:${PORT}/score.html?pantalla=1`);

    // ── SET POINT y MATCH POINT (punto de oro, 5-3 y 40-0) ──
    const game = (side) => play(st, 'pista-1', Array(4).fill(side === 'A' ? 'pointA' : 'pointB'));
    await st.setup('pista-1', H.config({ ...NAMES['pista-1'], scoringSystem: 'goldenPoint' }));
    await D1.waitForSelector('#d-board:not(.hidden)');
    for (const side of 'AAAAABBB') await game(side);
    await play(st, 'pista-1', ['pointA', 'pointA', 'pointA']);
    await D1.waitForFunction(() => document.getElementById('d-badge').textContent === 'SET POINT');
    await D1.waitForSelector('.ribbon-page.is-visible img', { timeout: 15000 });
    await D1.waitForTimeout(1800);
    await shot(D1, 'led-set-point', { badge: '#d-badge', rowA: '#row-a', board: '#d-board', ribbon: '#d-ribbon' });
    await st.act('pista-1', 'pointA');
    for (const side of 'AAAAA') await game(side);
    await play(st, 'pista-1', ['pointA', 'pointA', 'pointA']);
    await D1.waitForFunction(() => document.getElementById('d-badge').textContent === 'MATCH POINT');
    await D1.waitForTimeout(1500);
    await shot(D1, 'led-match-point', { badge: '#d-badge', rowA: '#row-a', board: '#d-board' });

    // ── Partidos en juego ──
    await st.setup('pista-1', H.config(NAMES['pista-1']));
    await play(st, 'pista-1', ['pointA', 'pointA', 'pointA', 'pointA', 'pointB', 'pointA', 'pointA', 'pointB', 'pointA']);
    await st.setup('pista-2', H.config(NAMES['pista-2']));
    await play(st, 'pista-2', ['pointB', 'pointB', 'pointA', 'pointB', 'pointB', 'pointA']);

    await st.screen('pantalla-2', { view: 'media', media: { items: ['StageMaster-LED.mp4', 'ejemplo-pantalla-completa.png'], imageSeconds: 8 } });
    await st.send('station:media', { screenId: 'pantalla-2', command: 'play' });

    // ── Pantallas LED (2:1) ──
    await D1.waitForSelector('#d-board:not(.hidden)');
    await D1.waitForTimeout(1500);
    await shot(D1, 'led-marcador', { board: '#d-board', ribbon: '#d-ribbon', header: '.d-header', pointsA: '#pts-a' });
    const D2 = await browser.newPage({ viewport: { width: 1664, height: 832 } });
    await D2.goto(`http://localhost:${PORT}/score.html?pantalla=2`);
    await D2.waitForSelector('#d-media video.is-visible', { timeout: 15000 });
    await D2.waitForTimeout(5200);
    await shot(D2, 'led-publicidad');

    // ── Estación ──
    // Estación al doble de resolución: los acercamientos del vídeo se ven nítidos
    const S = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    await S.goto(`http://localhost:${PORT}/station.html`);
    await S.waitForSelector('[data-screen-card="pantalla-2"]');
    await S.evaluate(() => document.querySelectorAll('[data-match-card] details').forEach((d) => { d.open = true; }));
    await shot(S, 'estacion-panel', {
      card1: '[data-match-card="pista-1"]', card2: '[data-match-card="pista-2"]',
      qr: '#st-referee-access .st-qr', referee: '#st-referee-access', pin1: '[data-match-card="pista-1"] .st-pin',
      access1: '[data-match-card="pista-1"] .st-access', score1: '[data-match-card="pista-1"] [data-score="pointA"]',
      setup1: '[data-match-card="pista-1"] [data-action="setup"]', pause1: '[data-match-card="pista-1"] [data-action="pause"]',
      tabs: '.st-views', screensHead: '#st-add-screen',
      courtsZone: '.st-zone-courts', screensZone: '.st-zone-screens', courtsCollapse: '.st-zone-courts [data-collapse]',
    });
    // Zonas que se minimizan: Pistas plegada (con su resumen) y Pantallas a la vista
    await S.click('.st-zone-courts .st-zone-head [data-collapse]');
    await S.waitForTimeout(500);
    await shot(S, 'estacion-panel-plegado', {
      courtsZone: '.st-zone-courts', courtsCollapse: '.st-zone-courts .st-zone-head [data-collapse]', summary: '#st-courts-summary', screensZone: '.st-zone-screens',
    });
    await S.click('.st-zone-courts .st-zone-head [data-collapse]');
    await S.waitForTimeout(400);

    // Diálogo «Nuevo partido»
    await S.click('[data-match-card="pista-1"] [data-action="setup"]');
    await S.waitForSelector('#dlg-setup[open]');
    await S.fill('#form-setup [name="a1"]', 'Leal');
    await S.fill('#form-setup [name="a2"]', 'Fernández');
    await S.fill('#form-setup [name="b1"]', 'Romero');
    await S.fill('#form-setup [name="b2"]', 'Castillo');
    await S.selectOption('#form-setup [name="scoringSystem"]', 'goldenPoint');
    await shot(S, 'estacion-nuevo-partido', { dialog: '#dlg-setup', names: '#form-setup .st-setup-teams, #form-setup fieldset', scoring: '#form-setup [name="scoringSystem"]' });
    await S.click('#dlg-setup-cancel');

    // Tarjeta de la Pantalla 1: pestañas
    const card = '[data-screen-card="pantalla-1"]';
    const showCard = async () => S.evaluate((sel) => {
      const el = document.querySelector(sel);
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80);
    }, card);
    for (const [tab, name, extra] of [
      ['content', 'estacion-pantalla-contenido', { pauseAds: `${card} label.switch:has([data-action="pauseAds"])`, endAds: `${card} label.switch:has([data-action="endAds"])`,
        endStats: `${card} label.switch:has([data-action="endStats"])` }],
      ['ribbon', 'estacion-pantalla-cinta', { upload: `${card} [data-action="upload"]`, texts: `${card} textarea`, library: `${card} .checklist`,
        motion: `${card} [data-action="motion"][data-motion="fixed"]` }],
      ['media', 'estacion-pantalla-lista', { upload: `${card} [data-action="upload"]`, list: `${card} .checklist` }],
      ['output', 'estacion-pantalla-salida', { brightness: `${card} [data-action="brightness"]`, format: `${card} [data-action="format"]`, fit: `${card} [data-action="fit"]` }],
    ]) {
      await S.click(`${card} [data-tab="${tab}"]`);
      await showCard();
      await shot(S, name, { card, views: `${card} .segmented, ${card} [data-part="segment"]`, ...extra });
    }

    // Cinta: cómo se mueve (uno cada vez, logos fijos, desplazamiento)
    await S.click(`${card} [data-tab="ribbon"]`);
    await S.evaluate((sel) => {
      const el = document.querySelector(sel);
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 360);
    }, `${card} [data-action="motion"][data-motion="fixed"]`);
    await shot(S, 'estacion-cinta-movimiento', {
      motion: `${card} [data-action="motion"][data-motion="fixed"]`, motionGroup: `${card} .st-group:has([data-action="motion"])`,
    });

    // Cinta: orden, tamaño (tiradores, como en Word) y realce de los logos
    await S.click(`${card} [data-tab="ribbon"]`);
    await S.waitForSelector(`${card} .rb-logo img`, { timeout: 15000 });
    await S.waitForTimeout(1500);
    const showEditor = () => S.evaluate((sel) => {
      const el = document.querySelector(sel);
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 230);
    }, `${card} .rb-preview`);
    await showEditor();
    const logo = `${card} .rb-logo[data-name="ferreteria-el-tornillo.svg"]`;
    const editorParts = {
      editor: `${card} .rb-preview`, list: `${card} .rb-list`, selected: `${card} .rb-logo.is-selected`,
      handle: `${card} .rb-logo.is-selected .rb-handle[data-corner="se"]`, grip: `${card} .rb-row .rb-grip`,
      size: `${card} .rb-row[data-name="ferreteria-el-tornillo.svg"] .rb-size`,
      effect: `${card} .rb-row[data-name="cafe-montana.svg"] .rb-effect`, row: `${card} .rb-row[data-name="cafe-montana.svg"]`,
    };
    await shot(S, 'estacion-cinta-editor-0', { ...editorParts, logo });
    await S.click(logo);
    await shot(S, 'estacion-cinta-editor', editorParts);
    const hb = await (await S.$(`${logo} .rb-handle[data-corner="se"]`)).boundingBox();
    await S.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await S.mouse.down();
    await S.mouse.move(hb.x + 40, hb.y + 24, { steps: 10 });
    await S.mouse.up();
    await H.waitFor(() => (st.state.screens[0].ribbon.sizes['ferreteria-el-tornillo.svg'] || 100) > 100, 'tamaño con el tirador');
    await S.waitForTimeout(1500);
    await showEditor();
    await shot(S, 'estacion-cinta-editor-2', editorParts);
    await D1.waitForTimeout(1800);
    await shot(D1, 'led-cinta', { ribbon: '#d-ribbon', board: '#d-board' });
    await S.evaluate(() => window.scrollTo(0, 0));

    // En vivo e Historial
    await S.click('.st-view-tab[data-view="live"]');
    await S.waitForSelector('[data-live="pantalla-2"] iframe');
    await S.waitForTimeout(3500);
    await shot(S, 'estacion-en-vivo', { tile1: '[data-live="pantalla-1"]', tile2: '[data-live="pantalla-2"]', tab: '.st-view-tab[data-view="live"]' });
    await S.click('.st-view-tab[data-view="history"]');
    await S.waitForTimeout(1200);
    await shot(S, 'estacion-historial', { tab: '.st-view-tab[data-view="history"]', list: '#view-history' });
    await S.click('.st-view-tab[data-view="panel"]');

    // ── Teléfono del árbitro (enlace del QR → PIN → partido) ──
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const P = await phone.newPage();
    await P.goto(`http://localhost:${PORT}/control.html`);
    await P.waitForSelector('#screen-pair:not(.hidden)');
    const pin = st.match('pista-1').pin;
    await P.tap(`#pin-keypad [data-key="${pin[0]}"]`);
    await P.tap(`#pin-keypad [data-key="${pin[1]}"]`);
    await shot(P, 'telefono-pin', { keypad: '#pin-keypad', display: '#pin-display', title: '.pair-card' });
    await P.tap(`#pin-keypad [data-key="${pin[2]}"]`);
    await P.tap(`#pin-keypad [data-key="${pin[3]}"]`);
    await P.waitForSelector('#paired-overlay:not(.hidden)', { timeout: 6000 });
    await P.waitForTimeout(500);
    await shot(P, 'telefono-conectado', { court: '#paired-court' });
    await P.waitForSelector('#paired-overlay.hidden', { state: 'attached', timeout: 6000 });
    await P.waitForSelector('#screen-match:not(.hidden)', { timeout: 6000 });
    await P.waitForTimeout(600);
    await shot(P, 'telefono-marcador', { pointA: '#btn-point-a', pointB: '#btn-point-b', undo: '#btn-undo', live: '.live-score, #screen-match .live-score-status', pause: '#btn-pause' });
    await P.tap('#btn-point-a');
    await D1.waitForTimeout(1200);
    await shot(P, 'telefono-marcador-2', { pointA: '#btn-point-a' });
    await shot(D1, 'led-marcador-2', { board: '#d-board', pointsA: '#pts-a' });

    // Estación con el teléfono conectado
    await S.waitForTimeout(600);
    await shot(S, 'estacion-panel-telefono', { access1: '[data-match-card="pista-1"] .st-access', card1: '[data-match-card="pista-1"]' });

    // Pausa → publicidad en la LED
    await P.tap('#btn-pause');
    await P.waitForSelector('#paused-banner:not(.hidden)');
    await shot(P, 'telefono-pausa', { banner: '#paused-banner', pause: '#btn-pause' });
    await D1.waitForSelector('#d-media .is-visible', { timeout: 15000 });
    await D1.waitForTimeout(2000);
    await shot(D1, 'led-pausa');
    await P.tap('#btn-pause');
    await D1.waitForSelector('#d-board:not(.hidden)');

    // Fin del partido: celebración y resumen en la LED; resumen en el teléfono
    await st.screen('pantalla-1', { endAds: { enabled: false } });
    await P.waitForTimeout(500);
    for (let i = 0; i < 80 && st.match('pista-1').state.status !== 'finished'; i++) {
      await st.act('pista-1', i % 4 === 2 ? 'pointB' : 'pointA');
    }
    await D1.waitForSelector('#d-celebrate:not(.hidden)', { timeout: 5000 });
    await D1.waitForTimeout(1600);
    await shot(D1, 'led-celebracion');
    await D1.waitForSelector('#d-celebrate.hidden', { state: 'attached', timeout: 10000 });
    await D1.waitForSelector('#d-board:not(.hidden)', { timeout: 5000 });
    await D1.waitForTimeout(1200);
    await shot(D1, 'led-ganador', { rowA: '#row-a', divider: '#d-divider-label', board: '#d-board' });
    await D1.waitForSelector('#d-summary:not(.hidden)', { timeout: 15000 });
    await D1.waitForTimeout(2000);
    await shot(D1, 'led-resumen', { head: '.sum-head', rows: '.sum-rows' });
    await P.waitForSelector('#screen-finished:not(.hidden)', { timeout: 6000 });
    await shot(P, 'telefono-final', { stats: '#final-stats', winner: '#winner-name' });

    // ── Portátil remoto: estación desde otro portátil (por la IP de red) ──
    const lanIp = Object.values(os.networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal);
    if (lanIp) {
      const remote = io(`http://${lanIp.address}:${PORT}`, { auth: { role: 'remote' }, forceNew: true });
      await H.waitFor(() => remote.connected, 'remoto conectado');
      const res = await remote.timeout(5000).emitWithAck('remote:pair', { code: st.state.remotes.code, name: 'Portátil pista 2' });
      remote.emit('remote:report', { monitors: [{ label: 'Monitor 2', width: 1920, height: 1080, refreshRate: 60 }], screens: { 'pantalla-2': 'Monitor 2 · 1920×1080 · 60 Hz' } });
      const R = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
      await R.goto(`http://${lanIp.address}:${PORT}/station.html#remoto=${encodeURIComponent(res.token)}`);
      await R.waitForSelector('[data-screen-card="pantalla-2"]', { timeout: 15000 });
      await R.waitForFunction(() => document.getElementById('st-title').textContent.includes('remoto'));
      await shot(R, 'remoto-estacion', { title: '#st-title', card1: '[data-match-card="pista-1"]' });
      await S.waitForTimeout(500);
      await S.evaluate(() => document.getElementById('st-remotes-section').scrollIntoView({ block: 'start' }));
      await shot(S, 'estacion-portatiles', { section: '#st-remotes-section', code: '.st-code', remote: '.st-remote' });
      await R.close();
      remote.close();
    } else {
      console.warn('  ⚠ Sin IP de red: no se captura la estación remota');
    }

    // Ventana del portátil remoto (aplicación de escritorio) con datos de ejemplo
    const W = await browser.newPage({ viewport: { width: 1000, height: 780 }, deviceScaleFactor: 2 });
    await W.addInitScript((version) => {
      const state = {
        build: { version, commit: '' }, hostname: 'PORTATIL-PISTA-2', status: 'connected', error: null, paired: true,
        server: { address: '192.168.1.10', port: 3000, name: 'PORTATIL-PRINCIPAL' }, name: 'Portátil pista 2', discovered: [],
        stationOpen: false,
        screens: [{ id: 'pantalla-1', label: 'Pantalla 1', matchLabel: 'Pista 1', mirrorOf: null }, { id: 'pantalla-2', label: 'Pantalla 2', matchLabel: 'Pista 2', mirrorOf: null }],
        desktop: { monitors: [{ key: 'm1', label: 'Monitor 1', width: 1920, height: 1080, primary: true }, { key: 'm2', label: 'Monitor 2', width: 1920, height: 1080, primary: false }],
          assignments: { 'pantalla-2': 'm2' }, preferences: { 'pantalla-1': 'none', 'pantalla-2': 'm2' }, closed: [] },
      };
      const ok = () => Promise.resolve({ ok: true });
      window.stagemaster = { state: () => Promise.resolve(state), pair: ok, setMonitor: ok, openScreen: ok, unpair: ok, retry: ok, useAsMain: ok, openStation: ok, onState: () => {} };
    }, require('../../../package.json').version);
    await W.goto('file://' + path.join(H.ROOT, 'desktop', 'remote', 'remote.html'));
    await W.waitForSelector('#rm-linked:not(.hidden)');
    await shot(W, 'remoto-ventana', { station: '#rm-station', screens: '#rm-screens', status: '#rm-status' });

    fs.writeFileSync(path.join(OUT, 'zonas.json'), JSON.stringify(zones, null, 2));
    console.log(`\n${Object.keys(zones).length} capturas en ${OUT}`);
  } finally {
    await browser.close();
    st.close();
    await srv.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
