'use strict';

/**
 * media-fit.e2e.js — La publicidad llena la pantalla igual que el marcador
 *
 * Caso real (LED 832 × 416 con el procesador escalando el monitor entero):
 * en «Monitor completo» el marcador llenaba la LED pero un vídeo 2:1 se veía
 * con bandas / cortado, porque se mostraba «completo» dentro de un monitor
 * 16:9. Ahora el ajuste «Automático» lo estira a toda la salida (como el
 * marcador) y, si la proporción es muy distinta (foto vertical), la muestra
 * completa sobre un fondo difuminado. También: «Llenar recortando»,
 * «Completa con fondo difuminado», formato LED exacto y el selector de la estación.
 */

const fs   = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const H = require('./harness');

/** Rectángulo que ocupa de verdad la imagen o vídeo visible, según su object-fit */
const visibleMedia = (page) => page.evaluate(() => {
  const el = document.querySelector('#d-media .media-item.is-visible');
  if (!el) return null;
  const box = el.getBoundingClientRect();
  const w = el.naturalWidth || el.videoWidth, h = el.naturalHeight || el.videoHeight;
  const fit = getComputedStyle(el).objectFit;
  let cw = box.width, ch = box.height;
  if (fit === 'contain') {
    const s = Math.min(box.width / w, box.height / h);
    cw = w * s; ch = h * s;
  }
  const backdrop = document.querySelector('#d-media .media-backdrop');
  let backdropLit = false;
  if (backdrop && !backdrop.classList.contains('hidden')) {
    const px = backdrop.getContext('2d').getImageData(0, 0, backdrop.width, backdrop.height).data;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) { backdropLit = true; break; }
  }
  return {
    tag: el.tagName, fit, dataFit: el.dataset.fit,
    covers: `${Math.round(cw)}x${Math.round(ch)}`, box: `${Math.round(box.width)}x${Math.round(box.height)}`,
    backdrop: !!backdrop && !backdrop.classList.contains('hidden'), backdropLit,
  };
});

(async () => {
  const T = H.checker('PUBLICIDAD QUE LLENA LA PANTALLA (ajuste a la salida)');
  const port = 3424;
  const ads = H.makeAdsDir({
    'pantalla-completa/vertical.png': fs.readFileSync(path.join(__dirname, 'fixtures', 'vertical.png')),
  });
  const srv = await H.startServer(port, { STAGEMASTER_DISCOVERY: '0', STAGEMASTER_ADS_DIR: ads });
  const st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  const showOnly = async (item, output = {}) => {
    await st.screen('pantalla-1', { view: 'media', media: { items: [item], imageSeconds: 30 }, output });
    await st.send('station:media', { screenId: 'pantalla-1', command: 'play' });
  };
  try {
    await st.setup('pista-1', H.config());
    const D = await browser.newPage({ viewport: { width: 1920, height: 1080 } });   // monitor 16:9
    H.watchErrors(D, 'pantalla', errors);
    await D.goto(`http://localhost:${port}/score.html?pantalla=1`);
    await D.waitForSelector('#d-board:not(.hidden)');
    T.check('Por defecto el ajuste es «Automático»', st.state.screens.find((s) => s.id === 'pantalla-1').output.fit === 'auto');

    // 1. Vídeo 2:1 (como el de la LED 832 × 416) en monitor completo 16:9
    await showOnly('ejemplo-video.mp4', { format: 'fill' });
    await D.waitForSelector('#d-media video.is-visible', { timeout: 10000 });
    let m = await visibleMedia(D);
    T.check('Vídeo 2:1 en monitor 16:9: llena TODA la salida, igual que el marcador (sin bandas)',
      m.dataFit === 'stretch' && m.fit === 'fill' && m.covers === '1920x1080' && !m.backdrop, JSON.stringify(m));
    await D.screenshot({ path: `${H.OUT}/ajuste-auto-video-16x9.png` });

    // 2. Imagen 2:1: igual
    await showOnly('ejemplo-pantalla-completa.png');
    await D.waitForFunction(() => document.querySelector('#d-media img.is-visible'), null, { timeout: 8000 });
    m = await visibleMedia(D);
    T.check('Imagen 2:1 en monitor 16:9: también llena toda la salida', m.dataFit === 'stretch' && m.covers === '1920x1080', JSON.stringify(m));

    // 3. Foto vertical: no se deforma; completa sobre fondo difuminado (sin bandas negras)
    await showOnly('vertical.png');
    await D.waitForFunction(() => { const el = document.querySelector('#d-media img.is-visible'); return el && /vertical/.test(el.src); }, null, { timeout: 8000 });
    m = await visibleMedia(D);
    T.check('Foto vertical (1:2): completa, sin deformar, con fondo difuminado en vez de bandas negras',
      m.dataFit === 'contain' && m.covers === '540x1080' && m.backdrop && m.backdropLit, JSON.stringify(m));
    await D.screenshot({ path: `${H.OUT}/ajuste-auto-vertical.png` });

    // 4. «Llenar recortando» y «Completa» con el vídeo 2:1
    await showOnly('ejemplo-video.mp4', { fit: 'cover' });
    await D.waitForSelector('#d-media video.is-visible', { timeout: 10000 });
    await D.waitForFunction(() => document.querySelector('#d-media video.is-visible').dataset.fit === 'cover');
    m = await visibleMedia(D);
    T.check('«Llenar sin deformar»: object-fit cover (recorta los lados)', m.fit === 'cover' && !m.backdrop, JSON.stringify(m));
    await st.screen('pantalla-1', { output: { fit: 'contain' } });
    await D.waitForFunction(() => document.querySelector('#d-media video.is-visible').dataset.fit === 'contain');
    await D.waitForTimeout(500);
    m = await visibleMedia(D);
    T.check('«Completa»: el vídeo entero (1920 × 960) y el fondo difuminado del propio vídeo arriba y abajo',
      m.fit === 'contain' && m.covers === '1920x960' && m.backdrop && m.backdropLit, JSON.stringify(m));
    await D.screenshot({ path: `${H.OUT}/ajuste-completa-video.png` });
    await st.screen('pantalla-1', { output: { fit: 'stretch' } });
    await D.waitForFunction(() => document.querySelector('#d-media video.is-visible').dataset.fit === 'stretch');
    m = await visibleMedia(D);
    T.check('«Estirar siempre»: vuelve a llenar toda la salida y se quita el fondo', m.covers === '1920x1080' && !m.backdrop, JSON.stringify(m));

    // 5. Formato LED exacto 832 × 416 con «Automático»: el vídeo 2:1 ocupa exactamente la LED
    await st.screen('pantalla-1', { output: { fit: 'auto', format: 'custom', width: 832, height: 416 } });
    await D.waitForFunction(() => document.getElementById('output').clientWidth === 832);
    await D.waitForTimeout(300);
    m = await visibleMedia(D);
    T.check('Formato LED 832 × 416: el vídeo 2:1 ocupa exactamente los 832 × 416', m.covers === '832x416', JSON.stringify(m));

    // 6. Selector en la estación (pestaña «Salida»)
    await st.screen('pantalla-1', { output: { format: 'fill' } });
    const S = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    H.watchErrors(S, 'estación', errors);
    await S.goto(`http://localhost:${port}/station.html`);
    await S.click('[data-screen-card="pantalla-1"] [data-tab="output"]');
    const select = '[data-screen-card="pantalla-1"] select[data-action="fit"]';
    await S.waitForSelector(select);
    const options = await S.$$eval(`${select} option`, (os) => os.map((o) => o.value).join(','));
    T.check('La estación ofrece los 4 ajustes en «Salida», con «Automático» elegido',
      options === 'auto,stretch,cover,contain' && (await S.$eval(select, (s) => s.value)) === 'auto', options);
    await S.selectOption(select, 'cover');
    await H.waitFor(() => st.state.screens.find((s) => s.id === 'pantalla-1').output.fit === 'cover', 'ajuste guardado');
    await D.waitForFunction(() => document.querySelector('#d-media video.is-visible').dataset.fit === 'cover');
    T.check('Elegirlo en la estación cambia la pantalla al instante', true);
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
