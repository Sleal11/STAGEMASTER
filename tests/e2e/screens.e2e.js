'use strict';

/**
 * screens.e2e.js — Varias pantallas en el mismo ordenador (navegador)
 *
 * Desde la estación: «Añadir pantalla», convertirla en ESPEJO de la Pantalla 1
 * (mismo marcador, misma cinta, misma lista en el mismo instante) con su propio
 * formato LED, y «Quitar» con confirmación. Las ventanas de las pantallas son
 * páginas reales (score.html?pantalla=N) y se comparan sus tanteos y capturas.
 */

const { chromium } = require('playwright');
const H = require('./harness');

const score = (page) => page.evaluate(() =>
  ['pts-a', 'pts-b', 'games-a', 'games-b', 'sets-a', 'sets-b'].map((id) => document.getElementById(id).textContent).join(','));

(async () => {
  const T = H.checker('VARIAS PANTALLAS EN EL MISMO ORDENADOR (navegador)');
  const port = 3404;
  const srv = await H.startServer(port);
  const st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  try {
    await st.setup('pista-1', H.config());
    await st.setup('pista-2', H.config({ nameA: 'Galán / Lebrón', nameB: 'Stupa / Di Nenno' }));
    for (const a of ['pointA', 'pointA', 'pointB']) await st.act('pista-1', a);

    const S = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    H.watchErrors(S, 'estación', errors);
    await S.goto(`http://localhost:${port}/station.html`);
    await S.waitForSelector('[data-screen-card="pantalla-2"]');
    T.check('Al empezar: 2 pantallas', (await S.$$('[data-screen-card]')).length === 2);

    // ── Añadir ──
    await S.click('#st-add-screen');
    await S.waitForSelector('[data-screen-card="pantalla-3"]');
    T.check('«Añadir pantalla» crea la Pantalla 3 (en orden)', (await S.$$eval('[data-screen-card]', (cards) => cards.map((c) => c.dataset.screenCard))).join() === 'pantalla-1,pantalla-2,pantalla-3');

    const D1 = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const D3 = await browser.newPage({ viewport: { width: 960, height: 540 } });
    H.watchErrors(D1, 'pantalla 1', errors);
    H.watchErrors(D3, 'pantalla 3', errors);
    await D1.goto(`http://localhost:${port}/score.html?pantalla=1`);
    await D3.goto(`http://localhost:${port}/score.html?pantalla=3`);
    await D1.waitForSelector('#d-board:not(.hidden)');
    await D3.waitForSelector('#d-board:not(.hidden)');
    await S.waitForSelector('[data-screen-card="pantalla-3"] .dot.ok');
    T.check('La estación ve conectada la Pantalla 3', true);

    // ── Espejo ──
    await S.selectOption('[data-screen-card="pantalla-3"] select[data-action="mirror"]', 'pantalla-1');
    await H.waitFor(() => st.state.screens.find((s) => s.id === 'pantalla-3').mirrorOf === 'pantalla-1', 'espejo');
    await S.waitForSelector('[data-screen-card="pantalla-3"] .st-mirror-note');
    T.check('La tarjeta indica «Espejo de Pantalla 1»', (await S.textContent('[data-screen-card="pantalla-3"] [data-part="chip"]')).includes('Espejo de Pantalla 1'));
    await S.click('[data-screen-card="pantalla-3"] [data-tab="ribbon"]');
    T.check('Cinta del espejo: solo explica dónde se cambia (sin controles)',
      (await S.$$('[data-screen-card="pantalla-3"] [data-part="panel"] input')).length === 0);
    const p1Select = await S.$$eval('[data-screen-card="pantalla-2"] select[data-action="mirror"] option', (o) => o.map((x) => x.value));
    T.check('Otra pantalla no puede ser espejo de un espejo (sin cadenas)', !p1Select.includes('pantalla-3') && p1Select.includes('pantalla-1'));

    await st.act('pista-1', 'pointA');
    await H.sleep(400);
    T.check('Origen y espejo muestran el mismo tanteo', (await score(D1)) === (await score(D3)), await score(D3));

    // Formato propio del espejo
    await S.click('[data-screen-card="pantalla-3"] [data-tab="output"]');
    await S.selectOption('[data-screen-card="pantalla-3"] select[data-action="format"]', 'led-sm');
    await D3.waitForFunction(() => document.body.classList.contains('is-led'));
    const box3 = await D3.$eval('#output', (el) => [el.clientWidth, el.clientHeight].join('x'));
    T.check('El espejo tiene su propio formato (416 × 208) y el origen no cambia',
      box3 === '416x208' && !(await D1.evaluate(() => document.body.classList.contains('is-led'))), box3);

    // Cinta del origen → también en el espejo
    await st.screen('pantalla-1', { ribbon: { texts: ['Gracias a Bar Central'] } });
    await D3.waitForFunction(() => document.getElementById('d-ribbon').textContent.includes('Bar Central'), null, { timeout: 5000 });
    T.check('La cinta de la Pantalla 1 aparece en el espejo', true);

    // Lista de reproducción a la vez
    await st.screen('pantalla-1', { media: { items: ['ejemplo-pantalla-completa.png'] } });
    await S.click('[data-screen-card="pantalla-3"] [data-view="media"]');
    const dlg = await S.waitForSelector('#dlg-confirm-ok', { state: 'visible', timeout: 3000 }).catch(() => null);
    if (dlg) await dlg.click();
    await D1.waitForSelector('#d-media:not(.hidden)', { timeout: 5000 });
    await D3.waitForSelector('#d-media:not(.hidden)', { timeout: 5000 });
    T.check('«Publicidad» en el espejo: origen y espejo pasan a la lista a la vez', true);
    await S.waitForSelector('[data-screen-card="pantalla-3"] [data-view="media"].is-active');
    await S.click('[data-screen-card="pantalla-3"] [data-view="score"]');
    await D1.waitForSelector('#d-media.hidden', { state: 'attached', timeout: 5000 });
    await D3.waitForSelector('#d-media.hidden', { state: 'attached', timeout: 5000 });
    T.check('«Marcador» en el espejo: los dos vuelven al marcador', await D3.isVisible('#d-board'));
    await D3.screenshot({ path: `${H.OUT}/espejo-led-sm.png` });

    // ── Quitar ──
    await S.click('[data-screen-card="pantalla-3"] [data-action="removeScreen"]');
    await S.click('#dlg-confirm-ok');
    await S.waitForSelector('[data-screen-card="pantalla-3"]', { state: 'detached' });
    await D3.waitForFunction(() => document.getElementById('d-waiting-court').textContent.includes('quitada'), null, { timeout: 5000 });
    T.check('«Quitar» (con confirmación): desaparece la tarjeta y su ventana lo indica', true);
    T.check('La Pantalla 1 sigue igual', (await score(D1)) === (await score(D3)) || await D1.isVisible('#d-board'));
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
