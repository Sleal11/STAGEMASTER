'use strict';

/**
 * ribbon.e2e.js — Cinta de logos (2.9) y SET POINT / MATCH POINT en la pantalla
 *
 * Servidor real con logos de ejemplo de distintas proporciones (SVG):
 *   - Estación, pestaña Cinta: el apartado «Orden y tamaño de los logos» lista
 *     los logos en su orden; las flechas y ARRASTRAR los reordenan; el control de
 *     tamaño y «Auto» cambian el tamaño de cada logo; vista previa con grupos
 *   - Pantalla: «Logos fijos» muestra varios logos a la vez; un logo cuadrado es
 *     más alto que uno muy ancho (mismo peso visual); el tamaño del operador se
 *     aplica; un logo negro se ve en blanco sobre la cinta oscura; fondo claro;
 *     alto de la cinta
 *   - Marcador: SET POINT y MATCH POINT en la cabecera y en la fila de quien lo tiene
 */

const { chromium } = require('playwright');
const H = require('./harness');

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const LOGOS = {
  'banner/a-cuadrado.svg': svg(200, 200, '<circle cx="100" cy="100" r="96" fill="#E8455F"/>'),
  'banner/b-ancho.svg':    svg(800, 160, '<rect width="800" height="160" rx="20" fill="#1FB36B"/>'),
  'banner/c-negro.svg':    svg(400, 160, '<rect x="10" y="10" width="380" height="140" fill="#000000"/>'),
  'banner/d-medio.svg':    svg(400, 200, '<rect width="400" height="200" fill="#F29B1F"/>'),
};

(async () => {
  const T = H.checker('CINTA DE LOGOS (ORDEN, TAMAÑO, LOGOS FIJOS, FONDO) Y SET POINT / MATCH POINT');
  const port = 3432;
  const ads = H.makeAdsDir(LOGOS);
  const srv = await H.startServer(port, { STAGEMASTER_DISCOVERY: '0', STAGEMASTER_ADS_DIR: ads });
  const st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  try {
    const order = ['b-ancho.svg', 'a-cuadrado.svg', 'c-negro.svg', 'd-medio.svg'];
    await st.screen('pantalla-1', { ribbon: { enabled: true, items: order, texts: [], motion: 'fixed', interval: 60 } });
    await st.setup('pista-1', H.config({ nameA: 'Leal / Fernández', nameB: 'Romero / Castillo', scoringSystem: 'goldenPoint' }));
    T.check('La cinta guarda el orden elegido (no el alfabético)', st.state.screens[0].ribbon.items.join() === order.join());

    // ── Estación: orden y tamaño ──
    const S = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    H.watchErrors(S, 'estación', errors);
    await S.goto(`http://localhost:${port}/station.html`);
    const card = '[data-screen-card="pantalla-1"]';
    await S.waitForSelector(card);
    await S.click(`${card} [data-tab="ribbon"]`);
    await S.waitForSelector(`${card} .rb-row`);
    const rows = () => S.$$eval(`${card} .rb-row`, (els) => els.map((e) => e.dataset.name));
    T.check('«Orden y tamaño de los logos»: los logos en su orden', (await rows()).join() === order.join(), (await rows()).join());
    await S.waitForSelector(`${card} .rb-strip img`, { timeout: 8000 });
    T.check('Vista previa con los logos limpios (como en la pantalla)', (await S.$$(`${card} .rb-strip img`)).length === 4);
    T.check('El apartado antiguo «Quitar el fondo blanco» ya no está', !(await S.$(`${card} [data-action="cleanLogos"]`)));

    await S.click(`${card} .rb-row[data-name="b-ancho.svg"] [data-action="logoMove"][data-dir="1"]`);
    await H.waitFor(() => st.state.screens[0].ribbon.items[0] === 'a-cuadrado.svg', 'mover después');
    T.check('Flecha «después»: el logo baja un puesto', st.state.screens[0].ribbon.items.slice(0, 2).join() === 'a-cuadrado.svg,b-ancho.svg');

    await S.waitForFunction((sel) => document.querySelector(sel).dataset.name === 'a-cuadrado.svg', `${card} .rb-row`);
    // Los mismos eventos que el navegador envía al arrastrar con el ratón (el arrastre
    // automático de Playwright no entrega «drop» en Chromium sin pantalla)
    await S.evaluate(({ src, dst }) => {
      const dt = new DataTransfer();
      const from = document.querySelector(src);
      const to = document.querySelector(dst);
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      ['dragenter', 'dragover', 'drop'].forEach((type) => to.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })));
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, { src: `${card} .rb-row[data-name="d-medio.svg"]`, dst: `${card} .rb-row[data-name="a-cuadrado.svg"]` });
    await H.waitFor(() => st.state.screens[0].ribbon.items[0] === 'd-medio.svg', 'arrastrar');
    T.check('Arrastrar un logo encima de otro lo pone en su sitio', st.state.screens[0].ribbon.items.join() === 'd-medio.svg,a-cuadrado.svg,b-ancho.svg,c-negro.svg',
      st.state.screens[0].ribbon.items.join());

    const slider = `${card} .rb-row[data-name="a-cuadrado.svg"] input[data-action="logoSize"]`;
    await S.waitForSelector(slider);
    await S.$eval(slider, (el) => { el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await H.waitFor(() => st.state.screens[0].ribbon.sizes['a-cuadrado.svg'] === 60, 'tamaño');
    T.check('Control de tamaño: el logo queda al 60 %', true);
    await S.waitForSelector(`${card} .rb-row[data-name="a-cuadrado.svg"] [data-action="logoReset"]:not([disabled])`);
    await S.click(`${card} .rb-row[data-name="a-cuadrado.svg"] [data-action="logoReset"]`);
    await H.waitFor(() => !st.state.screens[0].ribbon.sizes['a-cuadrado.svg'], 'auto');
    T.check('«Auto» lo devuelve al tamaño automático', true);
    // Realce de cada logo y tamaño con los tiradores de la vista previa (como en Word)
    await S.selectOption(`${card} .rb-row[data-name="c-negro.svg"] select[data-action="logoEffect"]`, 'outline');
    await H.waitFor(() => st.state.screens[0].ribbon.effects['c-negro.svg'] === 'outline', 'realce');
    T.check('«Realce» de un logo (contorno) desde la estación', true);
    const pre = `${card} .rb-logo[data-name="b-ancho.svg"]`;
    await S.waitForSelector(pre);
    await S.click(pre);
    T.check('Clic en un logo de la vista previa: queda seleccionado con sus tiradores (y marcado en la lista)',
      await S.isVisible(`${pre} .rb-handle[data-corner="se"]`) && !!(await S.$(`${card} .rb-row.is-selected[data-name="b-ancho.svg"]`)));
    const hb = await (await S.$(`${pre} .rb-handle[data-corner="se"]`)).boundingBox();
    await S.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await S.mouse.down();
    await S.mouse.move(hb.x + 80, hb.y + 30, { steps: 8 });
    const live = await S.textContent(`${pre} .rb-badge`);
    await S.mouse.up();
    await H.waitFor(() => (st.state.screens[0].ribbon.sizes['b-ancho.svg'] || 100) > 100, 'tirador');
    T.check('Arrastrar un tirador agranda el logo (porcentaje en directo y guardado al soltar)',
      parseInt(live, 10) > 100 && st.state.screens[0].ribbon.sizes['b-ancho.svg'] === parseInt(live, 10), `${live} → ${st.state.screens[0].ribbon.sizes['b-ancho.svg']} %`);
    // Alto de la cinta arrastrando su borde de arriba (como Word); doble clic = automático
    const edge = `${card} .rb-height-handle`;
    await S.waitForSelector(edge);
    const eb = await (await S.$(edge)).boundingBox();
    await S.mouse.move(eb.x + eb.width / 2, eb.y + 5);
    await S.mouse.down();
    await S.mouse.move(eb.x + eb.width / 2, eb.y - 25, { steps: 6 });
    const liveHeight = await S.textContent(`${edge} span`);
    await S.mouse.up();
    await H.waitFor(() => st.state.screens[0].ribbon.height > 0, 'alto con el borde');
    T.check('Arrastrar el borde de arriba de la cinta la hace más alta (porcentaje en directo y guardado al soltar)',
      parseInt(liveHeight.replace(/\D+/g, ''), 10) === st.state.screens[0].ribbon.height, `${liveHeight} → ${st.state.screens[0].ribbon.height} %`);
    await S.dblclick(edge);
    await H.waitFor(() => st.state.screens[0].ribbon.height === 0, 'alto automático');
    T.check('Doble clic en el borde: alto automático', true);
    await S.click(`${card} [data-action="ribbonBg"][data-bg="light"]`);
    await H.waitFor(() => st.state.screens[0].ribbon.background === 'light', 'fondo claro');
    await S.selectOption(`${card} select[data-action="ribbonHeight"]`, '24');
    await H.waitFor(() => st.state.screens[0].ribbon.height === 24, 'alto');
    T.check('Fondo de la cinta (claro) y alto de la cinta (24 %) desde la estación', true);
    await S.screenshot({ path: `${H.OUT}/cinta-editor.png`, fullPage: true });

    // ── Pantalla: logos fijos ──
    await st.screen('pantalla-1', { ribbon: { background: 'dark', height: 0, items: order, sizes: { 'b-ancho.svg': null } } });
    const D = await browser.newPage({ viewport: { width: 1664, height: 832 } });
    H.watchErrors(D, 'pantalla', errors);
    await D.goto(`http://localhost:${port}/score.html?pantalla=1`);
    await D.waitForSelector('.ribbon-page.is-visible img', { timeout: 8000 });
    await H.sleep(800);
    const fixed = await D.$$eval('.ribbon-page.is-visible img', (imgs) => imgs.map((im) => ({ h: im.getBoundingClientRect().height, w: im.getBoundingClientRect().width })));
    const ribbonH = await D.$eval('#d-ribbon', (el) => el.clientHeight);
    T.check('Logos fijos: varios logos a la vez en la cinta', fixed.length >= 3, `${fixed.length} logos`);
    const sizes = Object.fromEntries(order.map((n, i) => [n, fixed[i]]));
    T.check('Mismo peso visual: el cuadrado es más alto que el muy ancho', sizes['a-cuadrado.svg'].h > sizes['b-ancho.svg'].h * 1.4,
      `cuadrado ${Math.round(sizes['a-cuadrado.svg'].h)} px · ancho ${Math.round(sizes['b-ancho.svg'].h)} px`);
    T.check('Ningún logo es diminuto ni se sale de la cinta', fixed.every((f) => f.h >= ribbonH * 0.4 && f.h <= ribbonH), `cinta ${ribbonH} px`);
    const black = await D.$eval('.ribbon-page.is-visible img:nth-child(3)', (im) => {
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      const d = x.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    T.check('Un logo negro se ve en blanco sobre la cinta oscura', black.every((v) => v > 230), black.join(','));
    // Realce: «Contorno» rodea el logo (imagen más grande con borde blanco) y
    // «Automático» aclara las partes apagadas que no se leen (un marrón oscuro)
    const fx = await D.evaluate(async () => {
      const { cleanLogo } = await import('/js/display/logo-cleaner.js');
      const svgUrl = (body) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160">${body}</svg>`);
      const read = async (src) => {
        const im = new Image(); im.src = src; await im.decode();
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        const x = c.getContext('2d'); x.drawImage(im, 0, 0);
        const at = (fx, fy) => Array.from(x.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data);
        // Primer píxel visible de la columna central, desde arriba
        const top = () => { for (let y = 0; y < c.height; y++) { const p = Array.from(x.getImageData(c.width >> 1, y, 1, 1).data); if (p[3] > 200) return p; } return []; };
        return { w: c.width, h: c.height, at, top };
      };
      const logo = svgUrl('<rect x="20" y="20" width="360" height="120" fill="#E8455F"/>');
      const plain = await read(await cleanLogo(logo, 'dark', 'none'));
      const ring = await read(await cleanLogo(logo, 'dark', 'outline'));
      const brownLogo = svgUrl('<rect x="0" y="0" width="180" height="160" fill="#5A2E10"/><rect x="220" y="0" width="180" height="160" fill="#FF7A00"/>');
      const brownNone = (await read(await cleanLogo(brownLogo, 'dark', 'none'))).at(0.25, 0.5);
      const brownAuto = (await read(await cleanLogo(brownLogo, 'dark', 'auto'))).at(0.25, 0.5);
      // Sticker en JPG con fondo de color (2.10.1): rojo → aro blanco → placa negra con texto blanco
      const sticker = await read(await cleanLogo(svgUrl('<rect width="400" height="160" fill="#B00201"/>' +
        '<circle cx="200" cy="80" r="70" fill="#FFFFFF"/><circle cx="200" cy="80" r="60" fill="#000000"/>' +
        '<rect x="160" y="70" width="80" height="20" fill="#FFFFFF"/>'), 'dark', 'auto'));
      const blackBg = await read(await cleanLogo(svgUrl('<rect width="400" height="160" fill="#000000"/>' +
        '<rect x="100" y="40" width="200" height="80" fill="#E0B020"/>'), 'dark', 'auto'));
      // Sticker como el de La Condesa: escudo blanco con borde NEGRO sobre transparente → se respeta tal cual
      const shield = await read(await cleanLogo(svgUrl('<rect x="40" y="10" width="320" height="140" rx="40" fill="#111111"/>' +
        '<rect x="56" y="26" width="288" height="108" rx="30" fill="#F2F2F2"/><rect x="150" y="60" width="100" height="40" fill="#E8551E"/>'), 'dark', 'auto'));
      return { grows: ring.w > plain.w && ring.h > plain.h, edge: ring.top(), plainEdge: plain.top(), brownNone, brownAuto,
        shieldEdge: shield.top(), shieldBody: shield.at(0.5, 0.3),
        sticker: { w: sticker.w, corner: sticker.at(0.02, 0.02), ring: sticker.top(), plate: sticker.at(0.5, 0.25), text: sticker.at(0.5, 0.5) },
        blackBg: { w: blackBg.w, center: blackBg.at(0.5, 0.5), corner: blackBg.at(0.02, 0.02) } };
    });
    T.check('«Contorno»: borde blanco alrededor del logo', fx.grows && fx.edge.slice(0, 3).every((v) => v > 230) && fx.plainEdge[1] < 120,
      `${fx.plainEdge} → ${fx.edge}`);
    const sk = fx.sticker;
    T.check('Sticker con fondo de color: se quita el fondo y se conservan el aro blanco, la placa negra y su texto',
      sk.w < 200 && sk.corner[3] === 0 && sk.ring[0] > 230 && sk.plate.slice(0, 3).every((v) => v < 40) && sk.text.slice(0, 3).every((v) => v > 230),
      JSON.stringify(sk));
    T.check('Logo sobre fondo NEGRO: se quita el negro (antes quedaba un rectángulo blanco)',
      fx.blackBg.w <= 220 && fx.blackBg.corner[3] === 0 && fx.blackBg.center[0] > 200 && fx.blackBg.center[2] < 100, JSON.stringify(fx.blackBg));
    T.check('Sticker con borde negro (como La Condesa): conserva sus colores originales (el negro no pasa a blanco)',
      fx.shieldEdge.slice(0, 3).every((v) => v < 40) && fx.shieldBody.slice(0, 3).every((v) => v > 230), `${fx.shieldEdge} · ${fx.shieldBody}`);
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    T.check('«Automático»: la parte marrón oscura se aclara (sigue siendo cálida) y lo vivo se conserva',
      lum(fx.brownAuto) > lum(fx.brownNone) + 60 && fx.brownAuto[0] > fx.brownAuto[2], `${fx.brownNone} → ${fx.brownAuto}`);

    await st.screen('pantalla-1', { ribbon: { sizes: { 'b-ancho.svg': 160 } } });
    await H.sleep(1500);
    const bigger = await D.$eval('.ribbon-page.is-visible img', (im) => im.getBoundingClientRect().height);
    T.check('El tamaño del operador se aplica en la pantalla (160 %)', bigger > sizes['b-ancho.svg'].h * 1.4,
      `${Math.round(sizes['b-ancho.svg'].h)} → ${Math.round(bigger)} px`);
    await st.screen('pantalla-1', { ribbon: { background: 'light', height: 28 } });
    await H.sleep(1500);
    const look = await D.$eval('#d-ribbon', (el) => ({ bg: el.dataset.bg, h: el.clientHeight, out: document.getElementById('output').clientHeight }));
    T.check('Fondo claro y alto de la cinta (28 %) en la pantalla', look.bg === 'light' && Math.abs(look.h / look.out - 0.28) < 0.02, JSON.stringify(look));
    await D.screenshot({ path: `${H.OUT}/cinta-fijos-claro.png` });

    // ── SET POINT / MATCH POINT ──
    await st.screen('pantalla-1', { ribbon: { background: 'dark', height: 0 } });
    const game = async (side) => { for (let i = 0; i < 4; i++) await st.act('pista-1', side === 'A' ? 'pointA' : 'pointB'); };
    for (const s of 'AAAAABBB') await game(s);
    for (const p of ['pointA', 'pointA', 'pointA']) await st.act('pista-1', p);
    await D.waitForFunction(() => document.getElementById('d-badge').textContent === 'SET POINT', null, { timeout: 4000 });
    T.check('5-3 y 40-0: SET POINT en la cabecera y en la fila de quien lo tiene',
      await D.$eval('#row-a', (el) => el.classList.contains('is-set-point')) && !(await D.$eval('#row-b', (el) => el.classList.contains('is-set-point'))));
    await st.act('pista-1', 'pointA');   // set 1
    for (const s of 'AAAAA') await game(s);
    for (const p of ['pointA', 'pointA', 'pointA']) await st.act('pista-1', p);
    await D.waitForFunction(() => document.getElementById('d-badge').textContent === 'MATCH POINT', null, { timeout: 4000 });
    T.check('Con un set ganado: MATCH POINT (coral, no amarillo)',
      await D.$eval('#d-badge', (el) => el.classList.contains('is-match') && getComputedStyle(el).backgroundColor === 'rgb(232, 69, 95)'));
    await D.screenshot({ path: `${H.OUT}/match-point.png` });
    await st.act('pista-1', 'pause');
    await D.waitForFunction(() => document.getElementById('d-badge').textContent === 'EN PAUSA', null, { timeout: 4000 });
    T.check('En pausa manda «EN PAUSA»', true);
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close();
    st.socket.close();
    await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})();
