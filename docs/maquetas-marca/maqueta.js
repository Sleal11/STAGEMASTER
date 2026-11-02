'use strict';
// Maquetas de color: la app REAL con cada tema (Actual · A Índigo · B Claro), sin cambiar la app.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const H = require('../../tests/e2e/harness');

const DIR = __dirname;
const OUT = path.join(__dirname, '..', '..', 'tests', 'e2e', 'out', 'maqueta');
fs.mkdirSync(OUT, { recursive: true });
const THEMES = [
  { id: 'actual', css: '' },
  { id: 'indigo', css: fs.readFileSync(path.join(DIR, 'indigo.css'), 'utf8') },
  { id: 'claro', css: fs.readFileSync(path.join(DIR, 'claro.css'), 'utf8'), logo: path.join(DIR, 'logo-indigo.png') },
];

async function themed(browser, theme, options) {
  const ctx = await browser.newContext(options);
  if (theme.css) {
    await ctx.addInitScript((css) => {
      const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
    }, theme.css);
  }
  if (theme.logo) await ctx.route('**/img/logo-stagemaster.png', (route) => route.fulfill({ path: theme.logo, contentType: 'image/png' }));
  return ctx;
}

(async () => {
  const port = 3470;
  const srv = await H.startServer(port, { STAGEMASTER_DISCOVERY: '0' });
  const st = await H.station(port);
  const base = `http://localhost:${port}`;
  // Datos: Pista 1 en juego (set 2) y Pista 2 ganada 2-0 (queda en el historial)
  await st.setup('pista-1', H.config({ nameA: 'Santiago Leal / Gustavo Fernandez', nameB: 'Jose Villavicencio / Santiago Romero' }));
  await st.setup('pista-2', H.config({ nameA: 'Lucas Silva / Agustin Tapia', nameB: 'Arturo Coello / Federico Chingotto', totalSets: 3 }));
  const game = async (id, side) => { for (let i = 0; i < 4; i++) await st.act(id, side); };
  for (let g = 0; g < 6; g++) await game('pista-1', g === 2 ? 'pointB' : 'pointA');
  for (let g = 0; g < 3; g++) await game('pista-1', g === 1 ? 'pointB' : 'pointA');
  await st.act('pista-1', 'pointA'); await st.act('pista-1', 'pointA'); await st.act('pista-1', 'pointB');
  for (let s = 0; s < 2; s++) for (let g = 0; g < 6; g++) await game('pista-2', 'pointA');
  for (const id of ['pantalla-1', 'pantalla-2']) {
    await st.screen(id, { ribbon: { enabled: true, items: ['ejemplo-banner.png'], texts: ['Gracias a Bar Central'], motion: 'rotate', interval: 60 } });
  }
  const browser = await chromium.launch();
  const shot = (name) => path.join(OUT, name + '.png');

  for (const theme of THEMES) {
    // Pantallas LED (XL en juego, XL ganador, pequeña)
    for (const [name, screen, w, h] of [['led-xl-juego', 1, 832, 416], ['led-xl-ganador', 2, 832, 416], ['led-sm', 1, 416, 208]]) {
      const ctx = await themed(browser, theme, { viewport: { width: w, height: h } });
      const D = await ctx.newPage();
      await D.goto(`${base}/score.html?pantalla=${screen}`);
      await D.waitForSelector('#d-board:not(.hidden)');
      await H.sleep(1600);
      await D.screenshot({ path: shot(`${theme.id}-${name}`) });
      await ctx.close();
    }
    // Estación: Panel, En vivo e Historial (con las dos pantallas abiertas)
    const ctx = await themed(browser, theme, { viewport: { width: 1440, height: 900 } });
    const D1 = await ctx.newPage(); await D1.goto(`${base}/score.html?pantalla=1`);
    const D2 = await ctx.newPage(); await D2.goto(`${base}/score.html?pantalla=2`);
    const S = await ctx.newPage();
    await S.goto(`${base}/station.html`);
    await S.waitForSelector('[data-match-card="pista-2"] .st-qr svg');
    await H.sleep(800);
    await S.screenshot({ path: shot(`${theme.id}-estacion-panel`) });
    await S.evaluate(() => document.querySelector('[data-screen-card="pantalla-1"]').scrollIntoView({ block: 'start' }));
    await H.sleep(400);
    await S.screenshot({ path: shot(`${theme.id}-estacion-pantallas`) });
    await S.click('.st-view-tab[data-view="live"]');
    await S.waitForSelector('[data-live="pantalla-2"] iframe');
    await H.sleep(2500);
    await S.screenshot({ path: shot(`${theme.id}-estacion-envivo`) });
    await S.click('.st-view-tab[data-view="history"]');
    await S.waitForSelector('.hist-row');
    await H.sleep(600);
    await S.screenshot({ path: shot(`${theme.id}-estacion-historial`) });
    await ctx.close();
    // Teléfono: PIN y partido
    await st.send('station:unpair', { matchId: 'pista-1' });
    const pctx = await themed(browser, theme, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const P = await pctx.newPage();
    await P.goto(`${base}/control.html?pista=pista-1`);
    await P.waitForSelector('#pair-step-pin:not(.hidden)');
    await H.sleep(500);
    await P.screenshot({ path: shot(`${theme.id}-telefono-pin`) });
    for (const digit of st.match('pista-1').pin) await P.tap(`#pin-keypad [data-key="${digit}"]`);
    await P.waitForSelector('#screen-match:not(.hidden)');
    await H.sleep(700);
    await P.screenshot({ path: shot(`${theme.id}-telefono-partido`) });
    await pctx.close();
    console.log('tema listo:', theme.id);
  }
  await browser.close(); st.close(); await srv.stop();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
