'use strict';

/**
 * phone.e2e.js — Un partido completo desde el teléfono del árbitro (navegador)
 *
 * Teléfono (pantalla de móvil, táctil): abre el enlace del QR de la pista,
 * escribe el PIN, configura el partido y lo juega hasta el final pulsando los
 * botones. Comprueba a la vez la pantalla (marcador en tiempo real, sets en la
 * cabecera, resultado y publicidad final con imagen y vídeo), la estación
 * (teléfono conectado) y el historial (el partido queda guardado una vez).
 */

const { chromium } = require('playwright');
const H = require('./harness');

(async () => {
  const T = H.checker('PARTIDO COMPLETO DESDE EL TELÉFONO (navegador)');
  const port = 3407;
  const srv = await H.startServer(port, { STAGEMASTER_DISCOVERY: '0' });
  const st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  try {
    // Publicidad al terminar: 1 s de resultado y después imagen + vídeo
    await st.screen('pantalla-1', {
      endAds: { enabled: true, delay: 1 },
      media: { items: ['ejemplo-pantalla-completa.png', 'ejemplo-video.mp4'], imageSeconds: 3 },
    });
    const D = await browser.newPage({ viewport: { width: 832, height: 416 } });
    H.watchErrors(D, 'pantalla', errors);
    await D.goto(`http://localhost:${port}/score.html?pantalla=1`);
    await D.waitForSelector('#d-waiting:not(.hidden), #d-media:not(.hidden)');

    // ── Teléfono: enlace del QR → PIN ──
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const P = await phoneCtx.newPage();
    H.watchErrors(P, 'teléfono', errors);
    // QR único de la estación → página del árbitro → código de la pista
    T.check('La estación muestra UN solo QR de acceso (no uno por pista)', st.state.access === null || !!st.state.access.url);
    await P.goto(`http://localhost:${port}/control.html`);
    await P.waitForSelector('#screen-pair:not(.hidden)');
    T.check('El QR abre la pantalla del código de pista', (await P.textContent('.pair-title')).includes('Código de la pista'));
    const taken = st.state.matches.map((m) => m.pin);
    const wrong = ['0000', '1111', '2222'].find((c) => !taken.includes(c));
    for (const digit of wrong) await P.tap(`#pin-keypad [data-key="${digit}"]`);
    await P.waitForSelector('#pin-error:not(.hidden)');
    T.check('Código incorrecto → mensaje claro y se puede reintentar',
      /Código incorrecto/.test(await P.textContent('#pin-error')) && (await P.$$eval('.pin-digit.is-filled', (d) => d.length)) === 0);
    for (const digit of st.match('pista-1').pin) await P.tap(`#pin-keypad [data-key="${digit}"]`);
    await P.waitForSelector('#paired-overlay:not(.hidden)', { timeout: 5000 });
    T.check('Código correcto → confirma «Conectado a Pista 1»', (await P.textContent('#paired-court')).includes('Pista 1'));
    await P.screenshot({ path: `${H.OUT}/telefono-conectado.png` });
    await P.waitForSelector('#screen-setup:not(.hidden)', { timeout: 5000 });
    T.check('…y pasa a la configuración del partido, con la pista siempre visible arriba',
      (await P.textContent('#court-banner-name')).includes('Pista 1'));
    await H.waitFor(() => st.match('pista-1').controller && st.match('pista-1').controller.connected, 'la estación ve el teléfono');
    T.check('La estación ve el teléfono conectado', true);

    // ── Configurar: 1 set de 1 game ──
    await P.fill('#input-name-a', 'Galán');
    await P.fill('#input-name-a2', 'Lebrón');
    await P.fill('#input-name-b', 'Coello');
    await P.fill('#input-name-b2', 'Tapia');
    await P.tap('#group-games-per-set [data-value="1"]');
    await P.tap('#group-total-sets [data-value="1"]');
    await P.tap('#btn-start-match');
    await P.waitForSelector('#screen-match:not(.hidden)');
    await D.waitForSelector('#d-board:not(.hidden)');
    T.check('Partido empezado: la pantalla muestra a las parejas', (await D.textContent('#names-a')).includes('GALÁN') || (await D.textContent('#names-a')).toUpperCase().includes('GALÁN'));
    const header = await D.$$eval('.d-set-chip', (chips) => chips.map((c) => c.innerText.replace(/\s+/g, ' ')).join(' | '));
    T.check('…y «SET 1 · EN JUEGO» en la cabecera', header === 'SET 1 EN JUEGO', header);
    await H.waitFor(() => st.match('pista-1').state, 'la estación ve el partido');

    // ── Jugar: 3 puntos, deshacer uno, y cerrar el game ──
    const tapPoint = async (side) => {
      const v = st.match('pista-1').state.version;
      await P.tap(`#btn-point-${side}`);
      await H.waitFor(() => st.match('pista-1').state.version > v, 'punto');
    };
    await tapPoint('a');
    await tapPoint('a');
    await D.waitForFunction(() => document.getElementById('pts-a').textContent === '30');
    T.check('Cada punto llega a la pantalla al momento (30-0)', true);
    await tapPoint('b');
    await P.waitForFunction(() => document.getElementById('last-action').textContent.includes('Coello'));
    T.check('Bajo «Deshacer»: «Último: punto para …» (lo que se registró)', (await P.textContent('#last-action')).startsWith('Último: punto para'));
    const v = st.match('pista-1').state.version;
    await P.tap('#btn-undo');
    await H.sleep(300);
    T.check('Deshacer pide confirmación (no se deshace con un toque accidental)', st.match('pista-1').state.version === v &&
      (await P.textContent('#btn-undo')).includes('CONFIRMAR'));
    await P.tap('#btn-undo');
    await H.waitFor(() => st.match('pista-1').state.version > v, 'deshacer');
    await D.waitForFunction(() => document.getElementById('pts-b').textContent === '0');
    T.check('Deshacer desde el teléfono corrige la pantalla', true);
    await P.waitForFunction(() => document.getElementById('last-action').textContent.includes('deshizo'));
    T.check('…y la última acción pasa a «se deshizo un punto»', true);
    await tapPoint('a');
    await tapPoint('a');
    // Reglamento: el set se gana con 2 games de diferencia (1-0 no basta): otro game
    T.check('1-0 no cierra el set de 1 game (hace falta ventaja de 2)', st.match('pista-1').state.status === 'playing');
    for (let i = 0; i < 4; i++) await tapPoint('a');

    // ── Final: resultado, historial y publicidad final ──
    await P.waitForSelector('#screen-finished:not(.hidden)', { timeout: 5000 });
    T.check('El teléfono muestra el ganador', (await P.textContent('#winner-name')).includes('Galán'));
    await D.waitForFunction(() => document.getElementById('d-badge').textContent.includes('FINALIZADO'));
    T.check('La pantalla muestra el resultado (FINALIZADO)', true);
    await D.waitForSelector('#d-celebrate:not(.hidden)', { timeout: 3000 });
    T.check('La pantalla celebra a los ganadores', true);
    await D.waitForSelector('#d-media:not(.hidden)', { timeout: 10000 });
    T.check('Tras la celebración, la publicidad final (lista de reproducción)', await D.isHidden('#d-celebrate'));
    await D.waitForFunction(() => {
      const video = document.querySelector('#d-media video');
      return video && video.currentTime > 0.3 && !video.paused;
    }, null, { timeout: 15000 });
    T.check('…y el vídeo de la lista se reproduce', true);
    const history = await st.send('station:history', {});
    T.check('El partido queda en el historial una sola vez, con su resultado', history.total === 1 &&
      history.records[0].winner === 'A' && history.records[0].teams.A.includes('Galán'), JSON.stringify(history.records[0] && history.records[0].sets));

    // Partido nuevo desde el teléfono: la publicidad final termina
    await P.tap('#btn-new-match');
    await P.waitForSelector('#screen-setup:not(.hidden)');
    await P.tap('#btn-start-match');
    await D.waitForSelector('#d-media.hidden', { state: 'attached', timeout: 5000 });
    T.check('Partido nuevo → la pantalla vuelve al marcador', await D.isVisible('#d-board'));
    await P.screenshot({ path: `${H.OUT}/telefono.png` });

    // Cambiar de pista: con confirmación, vuelve al código y entra en la Pista 2
    await P.waitForSelector('#screen-match:not(.hidden)');
    await P.tap('#btn-change-court');
    await P.tap('#modal-confirm');
    await P.waitForSelector('#screen-pair:not(.hidden)');
    T.check('«Cambiar de pista» pide confirmación y vuelve al código de pista', true);
    await H.waitFor(() => !st.match('pista-1').controller, 'la Pista 1 queda libre');
    for (const digit of st.match('pista-2').pin) await P.tap(`#pin-keypad [data-key="${digit}"]`);
    await P.waitForSelector('#paired-overlay:not(.hidden)', { timeout: 5000 });
    const court = await P.textContent('#paired-court');
    await H.waitFor(() => st.match('pista-2').controller && st.match('pista-2').controller.connected, 'Pista 2 con teléfono');
    T.check('Con el código de la Pista 2 pasa a controlar la Pista 2 (y la 1 queda libre)', court.includes('Pista 2') && !st.match('pista-1').controller, court);
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
