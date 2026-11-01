'use strict';

/**
 * brightness.e2e.js — Brillo de la imagen por pantalla (navegador)
 *
 * El deslizador de la estación atenúa la imagen de ESA pantalla (y no la de
 * otra), sin recargar, con transición suave, y se conserva al reabrir.
 * Se mide el brillo real de los píxeles de la captura.
 */

const { chromium } = require('playwright');
const H = require('./harness');

/** Luminancia media de la caja de PUNTOS (azul claro) en una captura */
async function measure(page) {
  const box = await page.$eval('#pts-a', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + 4, y: r.y + 4, width: 8, height: 8 }; });
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  }, png.toString('base64'));
}

(async () => {
  const T = H.checker('BRILLO DE LA IMAGEN (navegador)');
  const port = 3403;
  const srv = await H.startServer(port);
  const st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  try {
    await st.setup('pista-1', H.config());
    await st.setup('pista-2', H.config());
    const D1 = await browser.newPage({ viewport: { width: 832, height: 416 } });
    const D2 = await browser.newPage({ viewport: { width: 832, height: 416 } });
    H.watchErrors(D1, 'pantalla 1', errors);
    await D1.goto(`http://localhost:${port}/score.html?pantalla=1`);
    await D2.goto(`http://localhost:${port}/score.html?pantalla=2`);
    await D1.waitForSelector('#d-board:not(.hidden)');
    await D2.waitForSelector('#d-board:not(.hidden)');
    await H.sleep(1000);   // que termine la animación de entrada
    const full = await measure(D1);

    const S = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    H.watchErrors(S, 'estación', errors);
    await S.goto(`http://localhost:${port}/station.html`);
    await S.click('[data-screen-card="pantalla-1"] [data-tab="output"]');
    const slider = '[data-screen-card="pantalla-1"] input[data-action="brightness"]';
    await S.waitForSelector(slider);
    await S.$eval(slider, (el) => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    T.check('El valor se ve mientras se arrastra', (await S.textContent('[data-brightness-value="pantalla-1"]')).trim() === '50 %');
    await S.$eval(slider, (el) => el.dispatchEvent(new Event('change', { bubbles: true })));
    await H.waitFor(() => st.state.screens[0].output.brightness === 50, 'brillo guardado');
    await H.sleep(150);
    const midway = await D1.$eval('#d-dimmer', (el) => Number(getComputedStyle(el).opacity));
    T.check('El cambio es suave (transición, no de golpe)', midway > 0 && midway < 0.5, `opacidad a los 150 ms: ${midway.toFixed(2)}`);
    await H.sleep(900);
    const half = await measure(D1);
    T.check('Pantalla 1 al 50 %: la imagen tiene la mitad de luz', Math.abs(half / full - 0.5) < 0.05, `${full.toFixed(0)} → ${half.toFixed(0)}`);
    const other = await measure(D2);
    T.check('Pantalla 2 no cambia', Math.abs(other - full) < 2, other.toFixed(0));

    await D1.reload();
    await D1.waitForSelector('#d-board:not(.hidden)');
    await H.sleep(900);
    T.check('Se conserva al reabrir la pantalla', Math.abs((await measure(D1)) / full - 0.5) < 0.05);
    const res = await st.screen('pantalla-1', { output: { brightness: 5 } });
    T.check('Fuera de rango (5 %) → rechazado', res.code === 'INVALID_SCREEN_CONFIG');
    await st.screen('pantalla-1', { output: { brightness: 100 } });
    await H.sleep(900);
    T.check('Al 100 %: brillo completo otra vez', Math.abs((await measure(D1)) - full) < 2);
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
