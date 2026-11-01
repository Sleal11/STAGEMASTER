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
    await P.goto(`http://localhost:${port}/control.html?pista=pista-1`);
    await P.waitForSelector('#pair-step-pin:not(.hidden)');
    T.check('El enlace del QR abre directamente el PIN de la Pista 1', (await P.textContent('#pin-court')).includes('Pista 1'));
    for (const digit of st.match('pista-1').pin) await P.tap(`#pin-keypad [data-key="${digit}"]`);
    await P.waitForSelector('#screen-setup:not(.hidden)', { timeout: 5000 });
    T.check('PIN correcto → configuración del partido', true);
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
    const v = st.match('pista-1').state.version;
    await P.tap('#btn-undo');
    await H.sleep(300);
    T.check('Deshacer pide confirmación (no se deshace con un toque accidental)', st.match('pista-1').state.version === v &&
      (await P.textContent('#btn-undo')).includes('CONFIRMAR'));
    await P.tap('#btn-undo');
    await H.waitFor(() => st.match('pista-1').state.version > v, 'deshacer');
    await D.waitForFunction(() => document.getElementById('pts-b').textContent === '0');
    T.check('Deshacer desde el teléfono corrige la pantalla', true);
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
    await D.waitForSelector('#d-media:not(.hidden)', { timeout: 5000 });
    T.check('Al segundo, la publicidad final (lista de reproducción)', true);
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
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
