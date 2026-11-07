'use strict';

/**
 * capturar.js — Capturas REALES de StageMaster para el vídeo de presentación
 *
 *   node marketing/presentacion/fuente/capturar.js
 *
 * Arranca el servidor de verdad (con un escritorio de ejemplo: portátil + LED)
 * y abre la estación, el teléfono del árbitro (iPhone, 390 × 844) y la pantalla
 * LED (2:1) en Chromium. Juega partidos REALES con el motor y guarda cada vista
 * en capturas/ con la posición de sus partes (capturas/zonas.json): el vídeo
 * se acerca a ellas y las señala. Nada se dibuja a mano.
 *
 * También guarda la celebración del final fotograma a fotograma (capturas/cel/).
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { chromium } = require('playwright');
const H = require('../../../tests/e2e/harness');

const OUT  = path.join(__dirname, 'capturas');
const PORT = 3490;
const zones = {};

function exampleDesktop(adsFolder) {
  const monitor = (key, label, primary) => ({ key, label, width: 1920, height: 1080, primary, refreshRate: 60, scale: 1, name: primary ? '' : 'LED' });
  return {
    onChange: () => {}, setScreens: () => {},
    getState: () => ({
      monitors: [monitor('m1', 'Monitor 1', true), monitor('m2', 'Monitor 2', false), monitor('m3', 'Monitor 3', false)],
      preferences: { 'pantalla-1': 'm2', 'pantalla-2': 'm3' }, assignments: { 'pantalla-1': 'm2', 'pantalla-2': 'm3' },
      closed: [], adsFolder, canUseAsRemote: false, network: { ok: true, wifi: 'Club Pádel' }, displayModes: { pending: null },
    }),
    setMonitor: () => {}, openScreen: () => {}, openAdsFolder: () => {},
  };
}

const TEAMS = { nameA: 'Leal / Fernández', nameB: 'Romero / Castillo' };

async function shot(page, name, parts = {}) {
  await page.waitForTimeout(400);
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

const LED_PARTS = {
  rowA: '#row-a', rowB: '#row-b', namesA: '#names-a', namesB: '#names-b', setsA: '#sets-a', gamesA: '#games-a', ptsA: '#pts-a',
  ptsB: '#pts-b', serveA: '#row-a .d-icon', serveB: '#row-b .d-icon', history: '#d-history', badge: '#d-badge', court: '#d-court',
  ribbon: '#d-ribbon', header: '.d-header', board: '#d-board', scores: '#sets-a',
};

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'cel'), { recursive: true });
  const PROMO = path.join(__dirname, '..', '..', 'videos-led', 'StageMaster-LED-1664x832-HD.mp4');
  const ads = H.makeAdsDir({ 'pantalla-completa/StageMaster-LED.mp4': fs.readFileSync(PROMO) });
  process.env.STAGEMASTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-presentacion-'));
  process.env.STAGEMASTER_ADS_DIR = ads;
  process.env.STAGEMASTER_DISCOVERY = '0';
  const { startServer } = require('../../../server/index.js');
  const srv = await startServer({ ports: [PORT], desktop: exampleDesktop(ads), logHttp: false });
  const st = await H.station(PORT);
  const browser = await chromium.launch();
  const act = (a, id = 'pista-1') => st.act(id, a);
  const points = async (seq, id = 'pista-1') => { for (const c of seq) await act(c === 'A' ? 'pointA' : 'pointB', id); };
  // Juegos con tanteos variados (como en un partido real): el ganador hace 4 y el rival 0-2
  const PATTERNS = ['WLWWW', 'WWLLWW', 'WWWW', 'LWWLWW', 'WWLWW', 'WLWLWW'];
  let patternIndex = 0;
  const game = (side) => {
    const p = PATTERNS[patternIndex++ % PATTERNS.length];
    const other = side === 'A' ? 'B' : 'A';
    return points(p.replace(/W/g, side).replace(/L/g, other));
  };
  try {
    // Historial con partidos de días de torneo (pista 2)
    for (const [a, b] of [['Ruiz / Vega', 'Soto / Navarro'], ['Molina / Ortega', 'Herrera / Campos']]) {
      await st.setup('pista-2', H.config({ nameA: a, nameB: b, gamesPerSet: 2, totalSets: 1 }));
      for (let i = 0; i < 40 && st.match('pista-2').state.status !== 'finished'; i++) await act(i % 3 === 1 ? 'pointB' : 'pointA', 'pista-2');
    }
    await st.setup('pista-2', H.config({ nameA: 'Pérez / Díaz', nameB: 'Torres / Medina' }));
    await points('BBABBA', 'pista-2');

    // Pantalla 1 = Pista 1 con cinta; publicidad en la pausa
    await st.screen('pantalla-1', {
      ribbon: { enabled: true, items: [], texts: ['Gracias a nuestros patrocinadores'], motion: 'rotate', interval: 30 },
      media: { items: ['ejemplo-pantalla-completa.png'], imageSeconds: 30 }, pauseAds: { enabled: true }, endAds: { enabled: false },
    });

    // ── Partido en juego: Set 1 6-3, set 2 2-1, 30-15 ──
    await st.setup('pista-1', H.config({ ...TEAMS, scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak' }));
    for (const s of 'AABABAABA') await game(s);   // 6-3
    for (const s of 'ABA') await game(s);         // 2-1
    await points('AAB');                           // 30-15
    const D = await browser.newPage({ viewport: { width: 1664, height: 832 } });
    await D.goto(`http://localhost:${PORT}/score.html?pantalla=1`);
    await D.waitForSelector('#d-board:not(.hidden)');
    await D.waitForTimeout(1500);
    await shot(D, 'led-juego', LED_PARTS);
    await points('B');
    await points('AB');                            // 40-40 → PUNTO DE ORO
    await D.waitForTimeout(900);
    await shot(D, 'led-juego-oro', LED_PARTS);

    // ── Estación ──
    const S = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    await S.goto(`http://localhost:${PORT}/station.html`);
    await S.waitForSelector('[data-screen-card="pantalla-2"]');
    await shot(S, 'st-panel', {
      courts: '.st-zone-courts', referee: '#st-referee-access', qr: '#st-referee-access .st-qr', card1: '[data-match-card="pista-1"]',
      pin1: '[data-match-card="pista-1"] .st-code-box', setup1: '[data-match-card="pista-1"] [data-action="setup"]', tabs: '.st-views',
    });
    await S.evaluate(() => { const e = document.querySelector('.st-zone-screens'); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 70); });
    await shot(S, 'st-pantallas', { screens: '.st-zone-screens', card: '[data-screen-card="pantalla-1"]', tabs: '[data-screen-card="pantalla-1"] .tabs' });
    await S.evaluate(() => window.scrollTo(0, 0));

    // Diálogo «Configurar partido»: vacío y relleno
    await S.click('[data-match-card="pista-1"] [data-action="setup"]');
    await S.waitForSelector('#dlg-setup[open]');
    for (const n of ['a1', 'a2', 'b1', 'b2']) await S.fill(`#form-setup [name="${n}"]`, '');
    const DLG = {
      dialog: '#dlg-setup', teams: '#form-setup .st-form-grid', games: '#form-setup [name="gamesPerSet"]', sets: '#form-setup [name="totalSets"]',
      server: '#form-setup [name="initialServer"]', scoring: '#form-setup [name="scoringSystem"]', tiebreak: '#form-setup [name="tiebreakType"]',
      start: '#form-setup button[type="submit"]', help: '#scoring-help',
    };
    await shot(S, 'st-setup-0', DLG);
    await S.fill('#form-setup [name="a1"]', 'Leal');
    await S.fill('#form-setup [name="a2"]', 'Fernández');
    await S.fill('#form-setup [name="b1"]', 'Romero');
    await S.fill('#form-setup [name="b2"]', 'Castillo');
    await shot(S, 'st-setup-1', DLG);
    await S.selectOption('#form-setup [name="scoringSystem"]', 'goldenPoint');
    await S.selectOption('#form-setup [name="tiebreakType"]', 'superTiebreak');
    await shot(S, 'st-setup-2', DLG);
    await S.click('#dlg-setup-cancel');

    // Partido nuevo de verdad (el del tutorial en tiempo real): 0-0, saca A
    await st.setup('pista-1', H.config({ ...TEAMS, scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak' }));
    await D.waitForTimeout(1200);
    await shot(D, 'rt-led-0', LED_PARTS);

    // ── Teléfono del árbitro: QR → código → conectado ──
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const P = await phone.newPage();
    await P.goto(`http://localhost:${PORT}/control.html`);
    await P.waitForSelector('#screen-pair:not(.hidden)');
    const PAIR = { keypad: '#pin-keypad', display: '#pin-display', card: '.pair-card' };
    await shot(P, 'tel-codigo-0', PAIR);
    const pin = st.match('pista-1').pin;
    for (const d of pin.slice(0, 3)) await P.tap(`#pin-keypad [data-key="${d}"]`);
    await shot(P, 'tel-codigo-3', PAIR);
    await P.tap(`#pin-keypad [data-key="${pin[3]}"]`);
    await P.waitForSelector('#paired-overlay:not(.hidden)', { timeout: 6000 });
    await P.waitForTimeout(450);
    await shot(P, 'tel-conectado', { court: '#paired-court' });
    await P.waitForSelector('#screen-match:not(.hidden)', { timeout: 8000 });
    await P.waitForSelector('#paired-overlay.hidden', { state: 'attached', timeout: 8000 });
    const TEL = { pointA: '#btn-point-a', pointB: '#btn-point-b', undo: '#btn-undo', server: '#btn-change-server', pause: '#btn-pause', score: '#pts-a', banner: '#court-banner' };
    await shot(P, 'rt-tel-0', TEL);

    // ── Tiempo real: cada toque y su efecto en la LED ──
    const rt = async (name, actions) => {
      for (const a of actions) {
        if (a === 'A') await P.tap('#btn-point-a');
        else if (a === 'B') await P.tap('#btn-point-b');
        else await P.tap(a);
        await P.waitForTimeout(350);
      }
      await D.waitForTimeout(900);
      await shot(P, `rt-tel-${name}`, TEL);
      await shot(D, `rt-led-${name}`, LED_PARTS);
    };
    await rt('1', ['A']);          // 15-0
    await rt('2', ['A']);          // 30-0
    await rt('3', ['A']);          // 40-0
    await rt('4', ['A']);          // game: 1-0, saca B
    // Avance rápido a 5-3 · 40-15 (sin capturas)
    for (const s of 'BABABAA') await game(s);   // de 1-0 a 5-3
    let sA = st.match('pista-1').state.players.A.games, sB = st.match('pista-1').state.players.B.games;
    while (sA < 5) { await game('A'); sA++; }
    while (sB < 3) { await game('B'); sB++; }
    await points('AAAB');          // 40-15
    await P.waitForTimeout(800);
    await D.waitForTimeout(900);
    await shot(P, 'rt-tel-5', TEL);
    await shot(D, 'rt-led-5', LED_PARTS);
    await rt('6', ['A']);          // set 1 6-3
    // Deshacer: la 1.ª pulsación pide confirmar
    await P.tap('#btn-undo');
    await P.waitForTimeout(300);
    await shot(P, 'rt-tel-7', TEL);
    await P.tap('#btn-undo');
    await P.waitForTimeout(500);
    await D.waitForTimeout(900);
    await shot(P, 'rt-tel-8', TEL);
    await shot(D, 'rt-led-8', LED_PARTS);
    await rt('9', ['A']);          // de nuevo 6-3
    await rt('10', ['#btn-change-server']);
    // Pausa: la LED muestra la publicidad
    await P.tap('#btn-pause');
    await P.waitForSelector('#paused-banner:not(.hidden)');
    await D.waitForSelector('#d-media:not(.hidden)', { timeout: 15000 });
    await D.waitForTimeout(2500);
    await shot(P, 'rt-tel-11', TEL);
    await shot(D, 'rt-led-11', LED_PARTS);
    await P.tap('#btn-pause');
    await D.waitForSelector('#d-board:not(.hidden)');
    await D.waitForTimeout(1200);
    await shot(D, 'rt-led-12', LED_PARTS);

    // ── Reglas (partidos reales del motor) ──
    const rule = async (cfg, prepare, shots) => {
      await st.setup('pista-1', H.config({ ...TEAMS, ...cfg }));
      await prepare();
      for (const [name, step] of shots) {
        if (step) await step();
        await D.waitForTimeout(1100);
        await shot(D, name, LED_PARTS);
      }
    };
    // Ventaja: 40-40 → AD
    await rule({ scoringSystem: 'advantage' }, () => points('AAABBB'), [['r-ventaja-1'], ['r-ventaja-2', () => points('A')]]);
    // Punto de oro: 40-40 → PUNTO DE ORO
    await rule({ scoringSystem: 'goldenPoint' }, () => points('AAABBB'), [['r-oro']]);
    // FIP 2026: 1.er y 2.º 40-40 con ventaja; el 3.º, punto decisivo
    await rule({ scoringSystem: 'starPoint' }, () => points('AAABBB'), [['r-fip-1'], ['r-fip-2', () => points('AB')], ['r-fip-3', () => points('BA')]]);
    // Tie Break: 6-6
    await rule({ scoringSystem: 'goldenPoint', tiebreakType: 'tiebreak' }, async () => {
      for (let g = 0; g < 12; g++) await game(g % 2 === 0 ? 'A' : 'B');
      await points('AABAB');
    }, [['r-tiebreak']]);
    // Súper Tie Break: 1-1 en sets → a 10 puntos
    await rule({ scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak' }, async () => {
      for (const s of 'ABAABABAA') await game(s);    // 6-3
      for (const s of 'BABABBABAB') await game(s);   // 4-6
      await points('AABABAABAB');                    // 6-4 en el súper tie break
    }, [['r-stb']]);

    // ── Final: celebración (fotograma a fotograma), marcador con el ganador y estadísticas ──
    await st.screen('pantalla-1', { endAds: { enabled: false }, endStats: { enabled: true } });
    await points('ABAA');   // 9-5
    // Datos de ejemplo: el partido simulado dura segundos; el reloj del servidor se
    // adelanta 1 h 24 min para que la duración del resumen sea la de un partido real
    const realNow = Date.now;
    Date.now = () => realNow() + 84 * 60 * 1000;
    await D.evaluate(() => { window.__t0 = 0; });
    const finishing = act('pointA');   // 10-5 → partido terminado
    await D.waitForSelector('#d-celebrate:not(.hidden)', { timeout: 5000 });
    await finishing;
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 5600) {
      await D.screenshot({ path: path.join(OUT, 'cel', `c${String(n++).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 92 });
    }
    zones.cel = { width: 1664, height: 832, rects: {}, frames: n, seconds: (Date.now() - t0) / 1000 };
    console.log(`✅ celebración: ${n} fotogramas en ${zones.cel.seconds.toFixed(1)} s`);
    await D.waitForSelector('#d-celebrate.hidden', { state: 'attached', timeout: 8000 });
    await D.waitForSelector('#d-board:not(.hidden)');
    await D.waitForTimeout(1500);
    await shot(D, 'f-ganador', { ...LED_PARTS, divider: '#d-divider-label' });
    await D.evaluate(() => window.dispatchEvent(new CustomEvent('stagemaster:fase-final', { detail: 'stats' })));
    await D.waitForSelector('#d-summary:not(.hidden)');
    await D.waitForTimeout(1600);
    await shot(D, 'f-estadisticas', { summary: '#d-summary' });
    Date.now = realNow;
    await P.waitForSelector('#screen-finished:not(.hidden)', { timeout: 8000 });
    await P.waitForTimeout(600);
    await shot(P, 'f-tel', { stats: '#final-stats', winner: '#winner-name' });
    await S.click('.st-view-tab[data-view="history"]');
    await S.waitForSelector('.hist-row');
    await S.waitForTimeout(1200);
    await shot(S, 'f-historial', { list: '#hist-list', first: '.hist-row' });

    fs.writeFileSync(path.join(OUT, 'zonas.json'), JSON.stringify(zones, null, 2));
    console.log(`\n${Object.keys(zones).length} capturas en ${OUT}`);
  } finally {
    await browser.close();
    st.socket.close();
    await srv.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
