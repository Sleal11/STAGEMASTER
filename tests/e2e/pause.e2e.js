'use strict';

/**
 * pause.e2e.js — Publicidad automática al pausar el partido (navegador)
 *
 * Pausa → la pantalla pasa a la lista de reproducción; reanudar → vuelve al
 * marcador con EXACTAMENTE el mismo tanteo. Sin lista: marcador con "EN PAUSA".
 * Opción desactivada: no cambia. "Volver al marcador" en plena pausa: solo
 * para esa pausa.
 */

const { chromium } = require('playwright');
const H = require('./harness');

(async () => {
  const T = H.checker('PUBLICIDAD AL PAUSAR (navegador)');
  const port = 3402;
  const srv = await H.startServer(port);
  const st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  const screen1 = () => st.state.screens.find((s) => s.id === 'pantalla-1');
  try {
    await st.setup('pista-1', H.config());
    for (const a of ['pointA', 'pointA', 'pointB', 'pointA']) await st.act('pista-1', a);
    await st.screen('pantalla-1', { media: { items: ['ejemplo-pantalla-completa.png', 'ejemplo-video.mp4'], imageSeconds: 5 } });

    const D = await browser.newPage({ viewport: { width: 832, height: 416 } });
    H.watchErrors(D, 'pantalla', errors);
    await D.goto(`http://localhost:${port}/score.html?pantalla=1`);
    await D.waitForSelector('#d-board:not(.hidden)');
    const scoreBefore = await D.evaluate(() => ['pts-a', 'pts-b', 'games-a', 'games-b', 'sets-a', 'sets-b'].map((id) => document.getElementById(id).textContent).join(','));

    const S = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    H.watchErrors(S, 'estación', errors);
    await S.goto(`http://localhost:${port}/station.html`);
    await S.waitForSelector('[data-match-card="pista-1"] [data-action="pause"]');

    // ── Pausar → publicidad ──
    await S.click('[data-match-card="pista-1"] [data-action="pause"]');
    await D.waitForSelector('#d-media:not(.hidden)', { timeout: 5000 });
    await D.waitForFunction(() => document.querySelector('#d-media .media-item.is-visible'), null, { timeout: 8000 });
    T.check('Pausar → la pantalla pasa a la publicidad', true);
    await S.waitForSelector('[data-screen-card="pantalla-1"] .st-banner');
    T.check('La estación lo indica ("Partido en pausa: mostrando la publicidad")',
      (await S.textContent('[data-screen-card="pantalla-1"] .st-banner')).includes('Partido en pausa: mostrando la publicidad'));
    await D.screenshot({ path: `${H.OUT}/pausa-publicidad.png` });

    // ── Reanudar → marcador intacto ──
    await S.click('[data-match-card="pista-1"] [data-action="resume"]');
    await D.waitForSelector('#d-board:not(.hidden)');
    await D.waitForFunction(() => document.getElementById('d-media').classList.contains('hidden'), null, { timeout: 5000 });
    const scoreAfter = await D.evaluate(() => ['pts-a', 'pts-b', 'games-a', 'games-b', 'sets-a', 'sets-b'].map((id) => document.getElementById(id).textContent).join(','));
    T.check('Reanudar → vuelve al marcador con el mismo tanteo', scoreAfter === scoreBefore, `${scoreBefore} → ${scoreAfter}`);
    T.check('Reproductor vacío al volver (sin restos)', await D.evaluate(() =>
      document.querySelectorAll('#d-media .media-item').length === 0 && document.querySelector('#d-media .media-backdrop').classList.contains('hidden')));
    T.check('Se puede seguir puntuando', (await st.act('pista-1', 'pointB')).ok);

    // ── "Volver al marcador" en plena pausa: solo esa pausa ──
    await st.act('pista-1', 'pause');
    await D.waitForSelector('#d-media:not(.hidden)');
    await S.click('[data-screen-card="pantalla-1"] [data-command="stop"]');
    await D.waitForSelector('#d-board:not(.hidden)');
    await H.sleep(500);
    T.check('"Volver al marcador" en plena pausa → marcador con "EN PAUSA"',
      await D.isHidden('#d-media') && (await D.textContent('#d-badge')).includes('PAUSA'));
    await st.act('pista-1', 'resume');
    await st.act('pista-1', 'pause');
    await D.waitForSelector('#d-media:not(.hidden)', { timeout: 5000 });
    T.check('En la siguiente pausa vuelve a salir la publicidad', true);
    await st.act('pista-1', 'resume');
    await D.waitForSelector('#d-board:not(.hidden)');

    // ── Lista vacía: marcador con EN PAUSA ──
    await st.screen('pantalla-1', { media: { items: [] } });
    await st.act('pista-1', 'pause');
    await H.sleep(800);
    T.check('Sin lista de reproducción → se queda el marcador con "EN PAUSA"',
      await D.isVisible('#d-board') && await D.isHidden('#d-media') && (await D.textContent('#d-badge')).includes('PAUSA'));
    T.check('…y la estación lo explica', (await S.textContent('[data-screen-card="pantalla-1"] .st-banner')).includes('lista de reproducción está vacía'));
    await st.act('pista-1', 'resume');

    // ── Opción desactivada (interruptor de la estación) ──
    await st.screen('pantalla-1', { media: { items: ['ejemplo-pantalla-completa.png'] } });
    await S.click('[data-screen-card="pantalla-1"] [data-tab="content"]');
    await S.click('[data-screen-card="pantalla-1"] label.switch:has(input[data-action="pauseAds"])');
    await H.waitFor(() => screen1().pauseAds.enabled === false, 'opción desactivada');
    await st.act('pista-1', 'pause');
    await H.sleep(800);
    T.check('Opción desactivada → la pausa no cambia la pantalla', await D.isVisible('#d-board') && await D.isHidden('#d-media'));
    await st.act('pista-1', 'resume');

    // ── Terminar estando en pausa: no se confunde con la publicidad final ──
    await S.click('[data-screen-card="pantalla-1"] label.switch:has(input[data-action="pauseAds"])');
    await H.waitFor(() => screen1().pauseAds.enabled === true, 'opción activada');
    await st.act('pista-1', 'pause');
    await D.waitForSelector('#d-media:not(.hidden)');
    await st.act('pista-1', 'finishMatch');
    await H.sleep(800);
    T.check('Finalizar en pausa → fin de la pausa: se ve el resultado en el marcador (publicidad final desactivada)',
      await D.isVisible('#d-board') && await D.isHidden('#d-media') && (await D.textContent('#d-badge')).includes('FINALIZADO'));
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
