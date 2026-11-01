'use strict';

/**
 * live.e2e.js — Pestaña «En vivo» de la estación (navegador)
 *
 * Todas las pantallas de un vistazo: vista previa en movimiento (igual que la
 * pantalla real) y su estado real. Comprueba que la vista previa sigue al
 * marcador y a la publicidad, tiene la proporción del formato, NO cuenta como
 * ventana conectada, no suena, y que la pestaña avisa de las pantallas sin
 * conexión aunque esté cerrada.
 */

const { chromium } = require('playwright');
const H = require('./harness');

const score = (frameOrPage) => frameOrPage.evaluate(() =>
  ['pts-a', 'pts-b', 'games-a', 'games-b'].map((id) => document.getElementById(id).textContent).join(','));

(async () => {
  const T = H.checker('ESTACIÓN · PESTAÑA «EN VIVO» (navegador)');
  const port = 3409;
  const srv = await H.startServer(port, { STAGEMASTER_DISCOVERY: '0' });
  const st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  const screenState = (id) => st.state.screens.find((s) => s.id === id);
  try {
    await st.setup('pista-1', H.config());
    await st.setup('pista-2', H.config({ nameA: 'Galán / Lebrón', nameB: 'Stupa / Di Nenno' }));
    await st.act('pista-1', 'pointA');
    await st.screen('pantalla-2', { output: { format: 'custom', width: 416, height: 208 } });

    // Pantalla 1 real (monitor 1280 × 720); la Pantalla 2 sin abrir (sin conexión)
    const D1 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    H.watchErrors(D1, 'pantalla 1', errors);
    await D1.goto(`http://localhost:${port}/score.html?pantalla=1`);
    await D1.waitForSelector('#d-board:not(.hidden)');

    const S = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    H.watchErrors(S, 'estación', errors);
    await S.goto(`http://localhost:${port}/station.html`);
    await S.waitForSelector('#live-badge:not(.hidden)');
    T.check('Con la pestaña cerrada, avisa en rojo de la pantalla sin conexión', (await S.textContent('#live-badge')) === '1');
    T.check('Sin la pestaña abierta no hay vistas previas (no gastan nada)', (await S.$$('iframe')).length === 0);

    await S.click('.st-view-tab[data-view="live"]');
    await S.waitForSelector('[data-live="pantalla-2"] iframe');
    T.check('Una tarjeta por pantalla', (await S.$$('[data-live]')).length === 2);
    const P1 = S.frame({ url: /pantalla=1&vista=previa/ });
    await P1.waitForSelector('#d-board:not(.hidden)');
    T.check('La vista previa muestra el mismo marcador que la pantalla', (await score(P1)) === (await score(D1)), await score(P1));
    await st.act('pista-1', 'pointA');
    await P1.waitForFunction(() => document.getElementById('pts-a').textContent === '30');
    T.check('…y lo sigue en tiempo real', (await score(D1)) === (await score(P1)));

    await H.sleep(400);
    T.check('La vista previa NO cuenta como ventana conectada', screenState('pantalla-1').displays.length === 1 &&
      screenState('pantalla-2').displays.length === 0);
    const tile1 = '[data-live="pantalla-1"]';
    const tile2 = '[data-live="pantalla-2"]';
    T.check('Pantalla 1: «En pantalla», conectada en este portátil y al día',
      (await S.textContent(`${tile1} .live-state`)).includes('En pantalla') &&
      (await S.textContent(`${tile1} .live-info`)).includes('Conectada en este portátil') &&
      (await S.textContent(`${tile1} .live-info`)).includes('Al día'));
    T.check('Pantalla 2: «Sin conexión» bien visible sobre su vista previa',
      (await S.getAttribute(tile2, 'class')).includes('has-problem') &&
      (await S.textContent(`${tile2} [data-part="overlay"]`)).includes('SIN CONEXIÓN'));

    // Proporción y tamaño reales
    const box2 = await S.$eval(`${tile2} [data-part="frame"]`, (el) => el.clientWidth / el.clientHeight);
    const iframe2 = await S.$eval(`${tile2} iframe`, (el) => el.style.width);
    T.check('La vista previa de la LED 416 × 208 tiene su proporción (2:1) y su tamaño real escalado',
      Math.abs(box2 - 2) < 0.03 && iframe2 === '416px', `${box2.toFixed(2)} · ${iframe2}`);
    const iframe1 = await S.$eval(`${tile1} iframe`, (el) => el.style.width);
    T.check('La del monitor completo usa el tamaño que informa la pantalla (1280 px)', iframe1 === '1280px', iframe1);
    const P2 = S.frame({ url: /pantalla=2&vista=previa/ });
    await P2.waitForSelector('#d-board:not(.hidden)');
    const out2 = await P2.$eval('#output', (el) => `${el.clientWidth}x${el.clientHeight}`);
    T.check('Dentro, el formato LED ocupa toda la vista previa', out2 === '416x208', out2);

    // Publicidad: la vista previa la muestra y el estado dice qué se reproduce (sin sonido)
    await st.screen('pantalla-1', { media: { items: ['ejemplo-pantalla-completa.png', 'ejemplo-video.mp4'], imageSeconds: 3, sound: true } });
    await st.send('station:media', { screenId: 'pantalla-1', command: 'play' });
    await P1.waitForSelector('#d-media:not(.hidden)', { timeout: 5000 });
    await S.waitForFunction((sel) => document.querySelector(sel).textContent.includes('Reproduce'), `${tile1} .live-info`, { timeout: 8000 });
    T.check('Publicidad: la vista previa la muestra y la tarjeta dice qué se reproduce',
      (await S.textContent(`${tile1} .live-info`)).includes('Publicidad y vídeos'));
    await P1.waitForSelector('#d-media video', { timeout: 10000 });
    T.check('La vista previa nunca suena (vídeo silenciado aunque la pantalla tenga sonido)', await P1.$eval('#d-media video', (v) => v.muted));
    await st.send('station:media', { screenId: 'pantalla-1', command: 'stop' });

    // Se abre la Pantalla 2: desaparece el aviso
    const D2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await D2.goto(`http://localhost:${port}/score.html?pantalla=2`);
    await S.waitForSelector('#live-badge.hidden', { state: 'attached', timeout: 5000 });
    T.check('Al conectarse la Pantalla 2, el aviso rojo desaparece', !(await S.getAttribute(tile2, 'class')).includes('has-problem'));
    await S.screenshot({ path: `${H.OUT}/en-vivo.png`, fullPage: true });

    // «Ajustes» lleva a la tarjeta de esa pantalla en el Panel; al salir se quitan las vistas previas
    await S.click(`${tile2} [data-action="goto"]`);
    await S.waitForSelector('#view-panel:not(.hidden)');
    T.check('«Ajustes» lleva al Panel y las vistas previas se cierran', (await S.$$('iframe')).length === 0);
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
