'use strict';

/**
 * live-sync.e2e.js — «En vivo» en tiempo real y estación sin saltos (navegador)
 *
 * La vista previa de «En vivo» debe enseñar LO MISMO que la pantalla real en
 * ese momento: el mismo grupo de logos de la cinta y la misma imagen de la
 * lista de publicidad, aunque se abra más tarde. Además:
 *   - cambiar una opción de la cinta (el fondo) no la hace empezar otra vez
 *     desde el primer grupo;
 *   - con la cinta en «rotar», el mismo logo; en desplazamiento continuo, el
 *     mismo punto;
 *   - tocar opciones en la estación no recarga la tarjeta ni mueve la página.
 */

const { chromium } = require('playwright');
const H = require('./harness');

const rect = (w, h, f) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="20" fill="${f}"/></svg>`;

// El grupo de la cinta que se ve: cuántos logos y su anchura (cada grupo es distinto)
const ribbonGroup = (p) => p.evaluate(() => {
  const v = [...document.querySelectorAll('.ribbon-page.is-visible')].pop();
  return v && v.querySelector('img') ? `${v.querySelectorAll('img').length}x${Math.round(v.querySelector('img').getBoundingClientRect().width)}` : null;
});
const mediaShown = (p) => p.evaluate(() => {
  const el = [...document.querySelectorAll('#d-media .media-item.is-visible')].pop();
  return el ? decodeURIComponent(el.src.split('/').pop()) : null;
});

(async () => {
  const T = H.checker('«EN VIVO» EN TIEMPO REAL Y ESTACIÓN SIN SALTOS (navegador)');
  const port = 3433;
  const logos = {};
  ['red', 'green', 'blue', 'orange', 'purple', 'teal', 'gold', 'pink', 'gray'].forEach((c, i) => { logos[`banner/l${i}.svg`] = rect(600, 200, c); });
  ['a', 'b', 'c'].forEach((n, i) => { logos[`pantalla-completa/img-${n}.svg`] = rect(1600, 800, ['red', 'green', 'blue'][i]); });
  const srv = await H.startServer(port, { STAGEMASTER_DISCOVERY: '0', STAGEMASTER_ADS_DIR: H.makeAdsDir(logos) });
  const st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  const view = { viewport: { width: 1664, height: 832 } };
  try {
    const items = Object.keys(logos).filter((k) => k.startsWith('banner/')).map((k) => k.slice(7));
    await st.screen('pantalla-1', { ribbon: { enabled: true, items, motion: 'fixed', interval: 3 } });
    await st.screen('pantalla-2', { view: 'media', media: { items: ['img-a.svg', 'img-b.svg', 'img-c.svg'], imageSeconds: 3 } });
    await st.setup('pista-1', H.config());
    await st.send('station:media', { screenId: 'pantalla-2', command: 'play' });

    const D1 = await browser.newPage(view);
    const D2 = await browser.newPage(view);
    H.watchErrors(D1, 'pantalla 1', errors);
    H.watchErrors(D2, 'pantalla 2', errors);
    await D1.goto(`http://localhost:${port}/score.html?pantalla=1`);
    await D2.goto(`http://localhost:${port}/score.html?pantalla=2`);
    await D1.waitForSelector('.ribbon-page.is-visible img');
    await D2.waitForSelector('#d-media .is-visible');
    await H.sleep(4500);   // las reales ya van por otro grupo / otra imagen

    // Las vistas previas se abren TARDE: aun así enseñan lo mismo que la real
    const P1 = await browser.newPage(view);
    const P2 = await browser.newPage(view);
    H.watchErrors(P1, 'vista previa 1', errors);
    H.watchErrors(P2, 'vista previa 2', errors);
    await P1.goto(`http://localhost:${port}/score.html?pantalla=1&vista=previa`);
    await P2.goto(`http://localhost:${port}/score.html?pantalla=2&vista=previa`);
    await P1.waitForSelector('.ribbon-page.is-visible img');
    await P2.waitForSelector('#d-media .is-visible');
    await H.sleep(1500);

    let ribbonOk = 0;
    let mediaOk = 0;
    const samples = 8;
    const seen = [];
    for (let i = 0; i < samples; i++) {
      const [r1, p1, r2, p2] = [await ribbonGroup(D1), await ribbonGroup(P1), await mediaShown(D2), await mediaShown(P2)];
      if (r1 && r1 === p1) ribbonOk++;
      if (r2 && r2 === p2) mediaOk++;
      seen.push(`${r1}/${p1} ${r2}/${p2}`);
      await H.sleep(1300);
    }
    // Se tolera una muestra justo en el cambio (la transición dura un instante)
    T.check('Cinta: la vista previa enseña el mismo grupo de logos que la pantalla real', ribbonOk >= samples - 1, `${ribbonOk}/${samples} · ${seen.join(' | ')}`);
    T.check('Publicidad: la vista previa enseña la misma imagen que la pantalla real', mediaOk >= samples - 1, `${mediaOk}/${samples}`);

    // Cambiar el fondo de la cinta: sigue en el mismo grupo (no vuelve al primero)
    const first = await ribbonGroup(D1);
    for (let i = 0; i < 30 && (await ribbonGroup(D1)) === first; i++) await H.sleep(150);
    await H.sleep(300);
    const before = await ribbonGroup(D1);
    await st.screen('pantalla-1', { ribbon: { background: 'light' } });
    await D1.waitForSelector('#d-ribbon[data-bg="light"] .ribbon-page.is-visible img', { timeout: 5000 });
    const after = await ribbonGroup(D1);
    T.check('Cambiar una opción de la cinta NO la hace empezar otra vez desde el primer grupo', before !== first && after === before,
      `primero ${first} · antes ${before} · después ${after}`);

    // «Rotar» (un logo cada vez): el mismo logo a la vez
    await st.screen('pantalla-1', { ribbon: { motion: 'rotate', background: 'dark' } });
    await D1.waitForSelector('#d-ribbon[data-motion="rotate"] .ribbon-slide.is-visible');
    await P1.waitForSelector('#d-ribbon[data-motion="rotate"] .ribbon-slide.is-visible');
    await H.sleep(4500);
    const slide = (p) => p.evaluate(() => {
      const el = [...document.querySelectorAll('.ribbon-slide.is-visible')].pop();
      const img = el && (el.tagName === 'IMG' ? el : el.querySelector('img'));
      return img ? decodeURIComponent(img.src.split('/').pop().split('?')[0]) : null;
    });
    let rotateOk = 0;
    const rotateSeen = [];
    for (let i = 0; i < 6; i++) {
      const [a, b] = [await slide(D1), await slide(P1)];
      if (a && a === b) rotateOk++;
      rotateSeen.push(`${a}/${b}`);
      await H.sleep(1100);
    }
    T.check('Cinta «rotar»: la vista previa enseña el mismo logo que la pantalla real', rotateOk >= 5, `${rotateOk}/6 · ${rotateSeen.join(' | ')}`);

    // Cinta en desplazamiento continuo: la vista previa va por el mismo punto
    await st.screen('pantalla-1', { ribbon: { motion: 'scroll' } });
    await D1.waitForSelector('#d-ribbon[data-motion="scroll"] .ribbon-track');
    await P1.waitForSelector('#d-ribbon[data-motion="scroll"] .ribbon-track');
    await H.sleep(5000);   // al menos un aviso periódico de la pantalla real
    const scrollAt = (p) => p.evaluate(() => {
      const a = document.querySelector('.ribbon-track').getAnimations()[0];
      return a ? a.currentTime % a.effect.getTiming().duration : null;
    });
    const [s1, s2] = await Promise.all([scrollAt(D1), scrollAt(P1)]);
    T.check('Cinta que se desplaza: la vista previa va por el mismo punto (±0,6 s)', s1 !== null && s2 !== null && Math.abs(s1 - s2) < 600,
      `real ${Math.round(s1)} ms · previa ${Math.round(s2)} ms`);

    // Estación: tocar opciones de la cinta no recarga la tarjeta ni mueve la página
    const S = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    H.watchErrors(S, 'estación', errors);
    await S.goto(`http://localhost:${port}/station.html`);
    const card = '[data-screen-card="pantalla-1"]';
    await S.waitForSelector(card);
    await S.click(`${card} [data-tab="ribbon"]`);
    await S.waitForSelector(`${card} .rb-preview img`);
    await S.evaluate((sel) => {
      const el = document.querySelector(sel);
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 200);
      el.__marca = 1;
    }, `${card} .rb-preview`);
    await H.sleep(500);
    const y0 = await S.evaluate((sel) => Math.round(document.querySelector(sel).getBoundingClientRect().top), `${card} .rb-preview`);
    await S.$eval(`${card} .rb-row[data-name="l1.svg"] input[data-action="logoSize"]`, (el) => {
      el.value = '150';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await H.sleep(700);
    await S.selectOption(`${card} .rb-row[data-name="l2.svg"] select[data-action="logoEffect"]`, 'outline');
    await H.sleep(700);
    await st.act('pista-1', 'pointA');   // y además llega un estado nuevo del partido
    await H.sleep(1000);
    const res = await S.evaluate((sel) => {
      const el = document.querySelector(sel);
      return { y: Math.round(el.getBoundingClientRect().top), same: el.__marca === 1 };
    }, `${card} .rb-preview`);
    T.check('Estación: al cambiar opciones, la vista previa de la cinta es la misma (no se vuelve a montar)', res.same);
    T.check('Estación: la página no salta ni sube', Math.abs(res.y - y0) <= 2, `antes ${y0} · después ${res.y}`);
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
