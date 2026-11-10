'use strict';

/**
 * finale.e2e.js — Final del partido: celebración del ganador y resumen
 *
 * Partido real hasta el final con dos pantallas (una con publicidad al
 * terminar y otra sin ella) y el teléfono del árbitro:
 *   - la celebración sale UNA vez al terminar, con la pareja ganadora
 *   - la publicidad final espera a que acabe la celebración
 *   - el resumen sustituye al marcador, con las estadísticas registradas
 *   - recargar la pantalla no repite la celebración; deshacer y volver a
 *     terminar es otro final y sí la repite
 *   - partido nuevo → vuelve el marcador; formato LED pequeño sin desbordes
 */

const { chromium } = require('playwright');
const H = require('./harness');

(async () => {
  const T = H.checker('FINAL DEL PARTIDO: CELEBRACIÓN Y RESUMEN');
  const port = 3426;
  const srv = await H.startServer(port, { STAGEMASTER_DISCOVERY: '0' });
  const st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  const finish = async () => {
    for (let i = 0; i < 80 && st.match('pista-1').state.status !== 'finished'; i++) {
      await st.act('pista-1', i % 5 === 3 ? 'pointB' : 'pointA');
    }
  };
  try {
    await st.screen('pantalla-1', { endAds: { enabled: true, delay: 2 }, media: { items: ['ejemplo-pantalla-completa.png'], imageSeconds: 30 } });
    await st.screen('pantalla-2', { matchId: 'pista-1', output: { format: 'custom', width: 416, height: 208 } });
    await st.setup('pista-1', H.config({ nameA: 'Leal / Fernández', nameB: 'Romero / Castillo', gamesPerSet: 2, totalSets: 1, scoringSystem: 'goldenPoint' }));
    const D1 = await browser.newPage({ viewport: { width: 1664, height: 832 } });
    const D2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    [[D1, 'pantalla 1'], [D2, 'pantalla 2']].forEach(([p, n]) => H.watchErrors(p, n, errors));
    await D1.goto(`http://localhost:${port}/score.html?pantalla=1`);
    await D2.goto(`http://localhost:${port}/score.html?pantalla=2`);
    await D1.waitForSelector('#d-board:not(.hidden)');
    await D2.waitForSelector('#d-board:not(.hidden)');
    await D1.evaluate(() => { window.celebrations = 0; new MutationObserver(() => {
      if (!document.getElementById('d-celebrate').classList.contains('hidden')) window.celebrations += window.lastCel ? 0 : 1;
      window.lastCel = !document.getElementById('d-celebrate').classList.contains('hidden');
    }).observe(document.getElementById('d-celebrate'), { attributes: true }); });

    await finish();
    const state = st.match('pista-1').state;
    await D1.waitForSelector('#d-celebrate:not(.hidden)', { timeout: 4000 });
    const cel = (await D1.textContent('#d-celebrate')).replace(/\s+/g, ' ');
    T.check('Al terminar: celebración con «GANADORES» y la pareja ganadora', /Ganadores/i.test(cel) && cel.includes('Leal') && cel.includes('Fernández'), cel.trim());
    T.check('Celebración deportiva en SVG: pista de pádel, pala y pelota, resultado por set y firma de StageMaster',
      !!(await D1.$('#d-celebrate svg.cel-court')) && !!(await D1.$('#d-celebrate svg.cel-emblem .cel-ball')) &&
      (await D1.$$('#d-celebrate .cel-set')).length === state.setScores.length && !!(await D1.$('#d-celebrate .cel-brand [data-brand-logo]')));
    await D1.screenshot({ path: `${H.OUT}/final-celebracion.png` });
    await H.sleep(3000);
    T.check('La publicidad final (2 s) espera a que acabe la celebración', await D1.isHidden('#d-media'));
    await D1.waitForSelector('#d-celebrate.hidden', { state: 'attached', timeout: 6000 });
    await D1.waitForSelector('#d-media:not(.hidden)', { timeout: 4000 });
    T.check('…y empieza al acabar la celebración', true);
    T.check('La celebración salió una sola vez', (await D1.evaluate(() => window.celebrations)) === 1);

    // Pantalla 2 (sin publicidad final, LED 416 × 208): tras la celebración, primero
    // el marcador con el ganador destacado; después las estadísticas, y se alternan
    await D2.waitForSelector('#d-celebrate.hidden', { state: 'attached', timeout: 4000 });
    await D2.waitForSelector('#d-board:not(.hidden)');
    T.check('Tras la celebración: el marcador con el ganador (fila destacada, trofeo y «GANADOR»)',
      await D2.isHidden('#d-summary') && (await D2.$eval('#row-a', (el) => el.classList.contains('is-winner'))) &&
      await D2.isVisible('#row-a .icon-trophy') && (await D2.textContent('#d-divider-label')) === 'GANADOR');
    await D2.screenshot({ path: `${H.OUT}/final-marcador-416.png`, clip: { x: 0, y: 0, width: 416, height: 208 } });
    await D2.waitForSelector('#d-summary:not(.hidden)', { timeout: 12000 });
    T.check('A los 10 s: las estadísticas en lugar del marcador', await D2.isHidden('#d-board'));
    const fits = await D2.$$eval('.sum-name', (els) => els.every((el) => el.scrollWidth <= el.clientWidth + 1));
    T.check('LED 416 × 208: las estadísticas caben (nombres sin desbordar)', fits);
    const small = await D2.$$eval('.sum-label', (els) => els.filter((el) => el.offsetParent).map((el) => parseFloat(getComputedStyle(el).fontSize)));
    T.check('LED 416 × 208: letra legible (los datos a 14 px o más)', small.length >= 3 && Math.min(...small) >= 14, small.join(', '));
    await D2.screenshot({ path: `${H.OUT}/final-resumen-416.png`, clip: { x: 0, y: 0, width: 416, height: 208 } });
    await D2.waitForSelector('#d-board:not(.hidden)', { timeout: 12000 });
    T.check('…y vuelve el marcador (se alternan)', await D2.isHidden('#d-summary'));
    // Opción «Mostrar las estadísticas» desactivada: se queda el marcador con el ganador
    await st.screen('pantalla-2', { endStats: { enabled: false } });
    await H.sleep(500);
    await D2.evaluate(() => window.dispatchEvent(new CustomEvent('stagemaster:fase-final', { detail: 'stats' })));
    await H.sleep(800);
    T.check('Sin la opción «Mostrar las estadísticas»: solo el marcador con el ganador',
      await D2.isHidden('#d-summary') && await D2.isVisible('#d-board'));
    await st.screen('pantalla-2', { endStats: { enabled: true } });
    await H.sleep(500);
    await D2.evaluate(() => window.dispatchEvent(new CustomEvent('stagemaster:fase-final', { detail: 'stats' })));
    await D2.waitForSelector('#d-summary:not(.hidden)', { timeout: 3000 });
    T.check('…y al volver a activarla, las estadísticas vuelven a salir', true);

    // Pantalla grande: las estadísticas registradas
    await st.screen('pantalla-1', { endAds: { enabled: false } });
    await D1.waitForSelector('#d-board:not(.hidden)', { timeout: 5000 });
    await D1.evaluate(() => window.dispatchEvent(new CustomEvent('stagemaster:fase-final', { detail: 'stats' })));
    await D1.waitForSelector('#d-summary:not(.hidden)', { timeout: 5000 });
    await H.sleep(1600);   // los números cuentan desde 0 al aparecer (finale.countUp)
    const rows = await D1.$$eval('.sum-row', (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
    const points = rows.find((r) => r.includes('Puntos ganados')) || '';
    T.check('Estadísticas reales: puntos ganados = los del marcador',
      points.startsWith(String(state.stats.points.A)) && points.endsWith(String(state.stats.points.B)), points);
    T.check('Con punto de oro: incluye los puntos de oro ganados', rows.some((r) => r.includes('Puntos de oro')), rows.join(' | '));
    T.check('El ganador está destacado (trofeo junto a su nombre)', (await D1.textContent('.sum-team.is-winner')).includes('Leal') && !!(await D1.$('.sum-team.is-winner .sum-trophy')));
    await D1.screenshot({ path: `${H.OUT}/final-resumen.png` });

    // Recargar: no se repite la celebración
    await D1.reload();
    await D1.waitForSelector('#d-board:not(.hidden)');
    await H.sleep(800);
    T.check('Recargar la pantalla no repite la celebración (sale el marcador con el ganador)',
      await D1.isHidden('#d-celebrate') && (await D1.textContent('#d-divider-label')) === 'GANADOR');

    // Deshacer el final → vuelve el marcador; terminar otra vez → otro final, se celebra
    await st.act('pista-1', 'undo');
    await D1.waitForSelector('#d-board:not(.hidden)');
    T.check('Deshacer el último punto: vuelve el marcador (sin ganador)', await D1.isHidden('#d-summary') && (await D1.textContent('#d-divider-label')) === '');
    await finish();
    await D1.waitForSelector('#d-celebrate:not(.hidden)', { timeout: 4000 });
    T.check('Volver a terminar es otro final: se celebra de nuevo', true);

    // Teléfono del árbitro: el mismo resumen
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const P = await phone.newPage();
    H.watchErrors(P, 'teléfono', errors);
    await P.goto(`http://localhost:${port}/control.html`);
    await P.waitForSelector('#screen-pair:not(.hidden)');
    for (const d of st.match('pista-1').pin) await P.tap(`#pin-keypad [data-key="${d}"]`);
    await P.waitForSelector('#screen-finished:not(.hidden)', { timeout: 6000 });
    await P.waitForSelector('#paired-overlay.hidden', { state: 'attached', timeout: 4000 });
    const phoneStats = (await P.textContent('#final-stats')).replace(/\s+/g, ' ');
    T.check('Teléfono: ganadores y las mismas estadísticas', phoneStats.includes('Puntos ganados') && phoneStats.includes('Duración'), phoneStats.trim().slice(0, 90));
    await P.screenshot({ path: `${H.OUT}/final-telefono.png`, fullPage: true });

    // Partido nuevo: vuelve el marcador
    await st.setup('pista-1', H.config({ nameA: 'Pérez / Díaz', nameB: 'Torres / Medina' }));
    await D1.waitForSelector('#d-board:not(.hidden)');
    T.check('Partido nuevo: el resumen desaparece y vuelve el marcador', await D1.isHidden('#d-summary') && await D1.isHidden('#d-celebrate'));

    // Historial: el partido guardado con sus estadísticas
    const res = await st.send('station:history', {});
    T.check('El historial guarda las estadísticas del partido', !!(res.records[0] && res.records[0].stats && res.records[0].stats.points.A === state.stats.points.A));

    // Nombres largos (2.10): la celebración los muestra COMPLETOS (la letra se ajusta);
    // las estadísticas abrevian las dos parejas de la misma forma
    const longA = 'Maximiliano Fernández C / Juan Sebastián Lebrón';
    await st.setup('pista-1', H.config({ nameA: longA, nameB: 'Federico Chingotto Ruiz / Agustín Tapia Fernández',
      gamesPerSet: 2, totalSets: 1, scoringSystem: 'goldenPoint' }));
    await D1.waitForSelector('#d-board:not(.hidden)');
    await finish();
    await D1.waitForSelector('#d-celebrate:not(.hidden)', { timeout: 4000 });
    await D2.waitForSelector('#d-celebrate:not(.hidden)', { timeout: 4000 });
    await H.sleep(1800);
    for (const [page, label] of [[D1, '1664 × 832'], [D2, '416 × 208']]) {
      const lines = await page.$$eval('.cel-names span', (els) => els.map((el) => ({ text: el.textContent, fits: el.scrollWidth <= el.clientWidth + 1 })));
      T.check(`Celebración ${label}: nombres largos COMPLETOS y dentro de la pantalla`,
        lines.map((l) => l.text).join(' / ') === longA && lines.every((l) => l.fits), JSON.stringify(lines));
    }
    await D1.screenshot({ path: `${H.OUT}/final-celebracion-nombres-largos.png` });
    await D1.waitForSelector('#d-celebrate.hidden', { state: 'attached', timeout: 8000 });
    await D1.evaluate(() => window.dispatchEvent(new CustomEvent('stagemaster:fase-final', { detail: 'stats' })));
    await D1.waitForSelector('#d-summary:not(.hidden)', { timeout: 5000 });
    await H.sleep(300);
    const heads = await D1.$$eval('.sum-name', (els) => els.map((el) => ({ text: el.textContent, fits: el.scrollWidth <= el.clientWidth + 1 })));
    T.check('Estadísticas: nombres largos abreviados igual en las dos parejas y sin desbordar',
      heads.length === 2 && heads.every((h) => h.fits) && heads[0].text.includes('.') === heads[1].text.includes('.') &&
      heads.every((h) => !h.text.includes('…')), heads.map((h) => h.text).join(' | '));
    await D1.screenshot({ path: `${H.OUT}/final-resumen-nombres-largos.png` });
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
