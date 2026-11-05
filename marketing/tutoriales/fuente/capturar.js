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
  const ads = H.makeAdsDir({ 'pantalla-completa/StageMaster-LED.mp4': fs.readFileSync(PROMO) });
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

    // ── Partidos en juego ──
    await st.setup('pista-1', H.config(NAMES['pista-1']));
    await play(st, 'pista-1', ['pointA', 'pointA', 'pointA', 'pointA', 'pointB', 'pointA', 'pointA', 'pointB', 'pointA']);
    await st.setup('pista-2', H.config(NAMES['pista-2']));
    await play(st, 'pista-2', ['pointB', 'pointB', 'pointA', 'pointB', 'pointB', 'pointA']);

    // Pantalla 1: marcador con cinta (logo + mensajes); Pantalla 2: publicidad
    await st.screen('pantalla-1', {
      ribbon: { enabled: true, items: ['ejemplo-banner.png'], texts: ['Gracias a nuestros patrocinadores', 'Síguenos en @stagemastervzla'], motion: 'rotate', interval: 10 },
      media: { items: ['StageMaster-LED.mp4'] }, pauseAds: { enabled: true }, endAds: { enabled: true, delay: 15 },
    });
    await st.screen('pantalla-2', { view: 'media', media: { items: ['StageMaster-LED.mp4', 'ejemplo-pantalla-completa.png'], imageSeconds: 8 } });
    await st.send('station:media', { screenId: 'pantalla-2', command: 'play' });

    // ── Pantallas LED (2:1) ──
    const D1 = await browser.newPage({ viewport: { width: 1664, height: 832 } });
    await D1.goto(`http://localhost:${PORT}/score.html?pantalla=1`);
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
    });

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
      ['content', 'estacion-pantalla-contenido', { pauseAds: `${card} label.switch:has([data-action="pauseAds"])`, endAds: `${card} label.switch:has([data-action="endAds"])` }],
      ['ribbon', 'estacion-pantalla-cinta', { upload: `${card} [data-action="upload"]`, texts: `${card} textarea` }],
      ['media', 'estacion-pantalla-lista', { upload: `${card} [data-action="upload"]`, list: `${card} .checklist` }],
      ['output', 'estacion-pantalla-salida', { brightness: `${card} [data-action="brightness"]`, format: `${card} [data-action="format"]`, fit: `${card} [data-action="fit"]` }],
    ]) {
      await S.click(`${card} [data-tab="${tab}"]`);
      await showCard();
      await shot(S, name, { card, views: `${card} .segmented, ${card} [data-part="segment"]`, ...extra });
    }
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
    await D1.waitForSelector('#d-media video.is-visible', { timeout: 15000 });
    await D1.waitForTimeout(3000);
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
    await D1.waitForSelector('#d-summary:not(.hidden)', { timeout: 10000 });
    await D1.waitForTimeout(1500);
    await shot(D1, 'led-resumen', { left: '.sum-left', right: '.sum-right' });
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
    await W.addInitScript(() => {
      const state = {
        build: { version: '2.6.0', commit: '' }, hostname: 'PORTATIL-PISTA-2', status: 'connected', error: null, paired: true,
        server: { address: '192.168.1.10', port: 3000, name: 'PORTATIL-PRINCIPAL' }, name: 'Portátil pista 2', discovered: [],
        stationOpen: false,
        screens: [{ id: 'pantalla-1', label: 'Pantalla 1', matchLabel: 'Pista 1', mirrorOf: null }, { id: 'pantalla-2', label: 'Pantalla 2', matchLabel: 'Pista 2', mirrorOf: null }],
        desktop: { monitors: [{ key: 'm1', label: 'Monitor 1', width: 1920, height: 1080, primary: true }, { key: 'm2', label: 'Monitor 2', width: 1920, height: 1080, primary: false }],
          assignments: { 'pantalla-2': 'm2' }, preferences: { 'pantalla-1': 'none', 'pantalla-2': 'm2' }, closed: [] },
      };
      const ok = () => Promise.resolve({ ok: true });
      window.stagemaster = { state: () => Promise.resolve(state), pair: ok, setMonitor: ok, openScreen: ok, unpair: ok, retry: ok, useAsMain: ok, openStation: ok, onState: () => {} };
    });
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
