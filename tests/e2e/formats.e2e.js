'use strict';

/**
 * formats.e2e.js — Resoluciones personalizadas (navegador)
 *
 * Desde la estación: formato «Personalizado» (ancho × alto), guardarlo con
 * nombre, usarlo en otra pantalla, aviso si no cabe en el monitor y borrarlo.
 * Las pantallas se abren con escalado de Windows al 125 %: el formato debe
 * medir los píxeles REALES pedidos.
 */

const { chromium } = require('playwright');
const H = require('./harness');

/** Tamaño real (píxeles físicos) de la caja de salida */
const boxPixels = (page) => page.evaluate(() => {
  const el = document.getElementById('output');
  return `${Math.round(el.clientWidth * devicePixelRatio)}x${Math.round(el.clientHeight * devicePixelRatio)}`;
});

(async () => {
  const T = H.checker('RESOLUCIONES PERSONALIZADAS (navegador)');
  const port = 3405;
  const srv = await H.startServer(port, { STAGEMASTER_DISCOVERY: '0' });
  const st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  const screenState = (id) => st.state.screens.find((s) => s.id === id);
  try {
    await st.setup('pista-1', H.config());
    // Monitor de 1600 × 900 píxeles reales con Windows al 125 % (1280 × 720 «de Windows»)
    const scaled = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.25 });
    const D1 = await scaled.newPage();
    const D2 = await scaled.newPage();
    H.watchErrors(D1, 'pantalla 1', errors);
    await D1.goto(`http://localhost:${port}/score.html?pantalla=1`);
    await D2.goto(`http://localhost:${port}/score.html?pantalla=2`);
    await D1.waitForSelector('#d-board:not(.hidden)');

    const S = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    H.watchErrors(S, 'estación', errors);
    await S.goto(`http://localhost:${port}/station.html`);
    const card = '[data-screen-card="pantalla-1"]';
    await S.click(`${card} [data-tab="output"]`);
    await S.selectOption(`${card} select[data-action="format"]`, 'custom');
    await S.waitForSelector(`${card} input[data-action="outputW"]`);
    await S.fill(`${card} input[data-action="outputW"]`, '1000');
    await S.press(`${card} input[data-action="outputW"]`, 'Tab');
    await H.waitFor(() => screenState('pantalla-1').output.width === 1000, 'ancho');
    await S.fill(`${card} input[data-action="outputH"]`, '500');
    await S.press(`${card} input[data-action="outputH"]`, 'Tab');
    await H.waitFor(() => screenState('pantalla-1').output.height === 500, 'alto');
    await D1.waitForFunction(() => document.body.classList.contains('is-led'));
    await H.sleep(300);
    T.check('Personalizado 1000 × 500: la pantalla mide exactamente eso en píxeles reales (Windows al 125 %)', (await boxPixels(D1)) === '1000x500', await boxPixels(D1));
    await H.waitFor(() => screenState('pantalla-1').displays[0] && screenState('pantalla-1').displays[0].viewport &&
      screenState('pantalla-1').displays[0].viewport.width === 1000, 'informe de la pantalla');
    T.check('La estación ve el tamaño real y el del monitor', screenState('pantalla-1').displays[0].window.width === 1600,
      JSON.stringify(screenState('pantalla-1').displays[0].window));

    // Valor fuera de rango: rechazado y se vuelve a ver el valor real
    await S.fill(`${card} input[data-action="outputW"]`, '5');
    await S.press(`${card} input[data-action="outputW"]`, 'Tab');
    await H.sleep(400);
    T.check('Ancho fuera de rango (5) → rechazado, sigue en 1000', screenState('pantalla-1').output.width === 1000 &&
      (await S.inputValue(`${card} input[data-action="outputW"]`)) === '1000');

    // Guardar con nombre
    await S.fill(`${card} [data-role="formatName"]`, 'LED pista central');
    await S.click(`${card} [data-action="saveFormat"]`);
    await H.waitFor(() => screenState('pantalla-1').output.format.startsWith('f-'), 'formato guardado en uso');
    const saved = st.state.outputFormats.find((f) => f.saved);
    T.check('«Guardar formato» lo añade a la lista y la pantalla pasa a usarlo', saved && saved.label === 'LED pista central · 1000 × 500 px');
    const dup = await st.send('station:saveFormat', { label: 'led pista CENTRAL', width: 10, height: 10 });
    T.check('No se repiten nombres ni se aceptan tamaños imposibles', dup.code === 'INVALID_FORMAT');

    // Usarlo en otra pantalla
    await S.click('[data-screen-card="pantalla-2"] [data-tab="output"]');
    await S.selectOption('[data-screen-card="pantalla-2"] select[data-action="format"]', saved.id);
    await D2.waitForFunction(() => document.body.classList.contains('is-led'));
    await H.sleep(300);
    T.check('Otra pantalla elige el formato guardado: mismo tamaño', (await boxPixels(D2)) === '1000x500', await boxPixels(D2));

    // No cabe: aviso
    await st.screen('pantalla-1', { output: { format: 'custom', width: 1600, height: 900, x: 100 } });
    await S.waitForSelector(`${card} .st-warning:has-text("no cabe")`, { timeout: 5000 });
    T.check('Si el formato no cabe en el monitor (1600 + 100 > 1600), la estación avisa', true);
    await st.screen('pantalla-1', { output: { x: 0 } });
    await S.waitForSelector(`${card} .st-warning:has-text("no cabe")`, { state: 'detached', timeout: 5000 });
    T.check('…y el aviso desaparece al corregirlo', true);

    // Borrar el formato guardado: la pantalla 2 sigue igual
    await S.click('[data-screen-card="pantalla-2"] [data-action="deleteFormat"]');
    await S.click('#dlg-confirm-ok');
    await H.waitFor(() => screenState('pantalla-2').output.format === 'custom', 'pasa a personalizado');
    await H.sleep(300);
    T.check('Borrar el formato: la pantalla que lo usaba se queda igual (personalizado)', (await boxPixels(D2)) === '1000x500' &&
      !st.state.outputFormats.some((f) => f.saved));
    await D2.screenshot({ path: `${H.OUT}/formato-personalizado.png` });
    await S.screenshot({ path: `${H.OUT}/estacion-salida.png`, clip: await (await S.$('[data-screen-card="pantalla-2"]')).boundingBox() });
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
