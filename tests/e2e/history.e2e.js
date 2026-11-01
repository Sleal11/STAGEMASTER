'use strict';

/**
 * history.e2e.js — Historial de partidos en la estación (navegador)
 *
 * Termina partidos reales, abre la vista Historial y comprueba lista, orden,
 * filtros (fecha, pista, jugador), detalle, exportación CSV, estado vacío,
 * actualización en vivo y que sigue ahí tras reiniciar el servidor.
 */

const fs = require('fs');
const { chromium } = require('playwright');
const H = require('./harness');

async function finishByPoints(st, matchId) {
  for (let i = 0; i < 60 && st.match(matchId).state.status === 'playing'; i++) await st.act(matchId, 'pointA');
}

(async () => {
  const T = H.checker('HISTORIAL (navegador)');
  const port = 3401;
  let srv = await H.startServer(port);
  let st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  try {
    // Dos partidos terminados (uno por reglas, otro a mano) y uno sin terminar
    await st.setup('pista-1', H.config({ nameA: 'Agustín Tapia / Arturo Coello', nameB: 'Ale Galán / Federico Chingotto', gamesPerSet: 1, totalSets: 1 }));
    await finishByPoints(st, 'pista-1');
    await st.setup('pista-2', H.config({ nameA: 'Juan Lebrón / Paquito Navarro', nameB: 'Momo / Stupa' }));
    await st.act('pista-2', 'pointB');
    await st.act('pista-2', 'finishMatch');
    await st.setup('pista-1', H.config({ nameA: 'Sin / Terminar', nameB: 'Otro / Partido' }));
    await st.act('pista-1', 'pointA');

    const S = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    H.watchErrors(S, 'estación', errors);
    await S.goto(`http://localhost:${port}/station.html`);
    await S.waitForSelector('[data-match-card="pista-1"]');
    await S.click('.st-view-tab[data-view="history"]');
    await S.waitForSelector('.hist-row');
    T.check('La vista Historial se abre y oculta el panel', await S.isHidden('#view-panel') && await S.isVisible('#view-history'));
    const names = await S.$$eval('.hist-row .hist-teams', (els) => els.map((e) => e.textContent));
    T.check('Hoy: los 2 partidos terminados, el más reciente primero', names.length === 2 && names[0].includes('Lebrón') && names[1].includes('Tapia'), names.join(' | '));
    T.check('El partido sin terminar no aparece', !names.some((n) => n.includes('Terminar')));
    const first = await S.locator('.hist-row').first().textContent();
    T.check('Se ve que se finalizó a mano', first.includes('Finalizado a mano'));
    T.check('Agrupado por día con fecha legible', /\d{4}/.test(await S.textContent('.hist-day-title')));
    T.check('El ganador se marca con el trofeo', await S.$('.hist-team.is-winner .hist-trophy') !== null);
    await S.screenshot({ path: `${H.OUT}/historial.png`, fullPage: true });

    await S.fill('#hist-text', 'galan');
    await H.sleep(600);
    T.check('Buscar jugador (sin tildes): "galan" → 1 partido', (await S.$$('.hist-row')).length === 1);
    await S.fill('#hist-text', '');
    await S.selectOption('#hist-court', 'pista-2');
    await H.sleep(500);
    T.check('Filtro por pista', (await S.$$('.hist-row')).length === 1 && (await S.textContent('.hist-row')).includes('Lebrón'));
    await S.selectOption('#hist-court', '');
    await S.click('#hist-quick [data-quick="yesterday"]');
    await H.sleep(500);
    T.check('Ayer: estado vacío claro', await S.isVisible('.hist-empty'));
    await S.click('#hist-quick [data-quick="all"]');
    await H.sleep(500);
    T.check('Todo: vuelven los 2', (await S.$$('.hist-row')).length === 2);
    // Un día concreto con "Desde"
    const today = await S.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    await S.fill('#hist-from', today); await S.fill('#hist-to', '');
    await S.dispatchEvent('#hist-from', 'change');
    await H.sleep(500);
    T.check('Un día concreto (Desde = hoy): los 2', (await S.$$('.hist-row')).length === 2);

    await S.locator('.hist-row').last().click();
    await S.waitForSelector('#dlg-match[open]');
    const detail = await S.textContent('#dlg-match');
    T.check('Detalle: set a set, horario, duración y formato', detail.includes('Set 1') && detail.includes('Duración') && detail.includes('Punto de oro'));
    await S.screenshot({ path: `${H.OUT}/historial-detalle.png` });
    await S.click('#dlg-match-close');

    const [download] = await Promise.all([S.waitForEvent('download'), S.click('#hist-export')]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    T.check('Exportar CSV: cabecera y una fila por partido', csv.startsWith('﻿"Fecha"') && csv.trim().split('\r\n').length === 3 && csv.includes('Lebrón'));

    // En vivo: termina otro partido mientras se ve el historial
    await S.click('#hist-quick [data-quick="today"]');
    await H.sleep(300);
    await st.act('pista-1', 'finishMatch');
    await S.waitForFunction(() => document.querySelectorAll('.hist-row').length === 3, null, { timeout: 5000 }).catch(() => {});
    T.check('Se actualiza solo al terminar otro partido', (await S.$$('.hist-row')).length === 3);

    // Reiniciar el servidor: el historial sigue
    st.close();
    await srv.stop();
    srv = await H.startServer(port, { STAGEMASTER_DATA_DIR: srv.data, STAGEMASTER_ADS_DIR: srv.ads });
    st = await H.station(port);
    const res = await st.send('station:history', {});
    T.check('Tras reiniciar, siguen los 3 partidos', res.total === 3);

    await S.click('.st-view-tab[data-view="panel"]');
    T.check('Volver al Panel', await S.isVisible('#view-panel') && await S.isHidden('#view-history'));
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
