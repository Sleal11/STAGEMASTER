'use strict';

/**
 * panel.e2e.js — Panel de la estación (2.8): zonas, minimizar, pestañas con
 * resumen, «Todos / Ninguno», Historial al instante y resolución lenta
 *
 * Servidor real con una aplicación de escritorio SIMULADA cuyo cambio de
 * resolución tarda 5 s (como Windows con algunos monitores):
 *   - Pistas y Pantallas son zonas distintas (icono, título y tarjetas distintas)
 *   - Una tarjeta (pista o pantalla), el acceso de los árbitros y una zona se
 *     minimizan con ⌄, muestran su resumen y se recuerdan al recargar
 *   - Las pestañas de la pantalla resumen su contenido (cinta apagada, archivos…)
 *   - «Todos» / «Ninguno» marcan o quitan todos los archivos de la lista
 *   - Al terminar un partido, el Historial lo muestra sin recargar (y avisa)
 *   - Cambiar la resolución aunque Windows tarde 5 s: sin «El servidor no respondió»
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { chromium } = require('playwright');
const H = require('./harness');

(async () => {
  const T = H.checker('PANEL: ZONAS, MINIMIZAR, PESTAÑAS, HISTORIAL AL INSTANTE Y RESOLUCIÓN LENTA');
  process.env.STAGEMASTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-e2e-panel-'));
  process.env.STAGEMASTER_ADS_DIR  = H.makeAdsDir({ 'pantalla-completa/02-segundo.png': fs.readFileSync(path.join(H.ROOT, 'publicidad', 'pantalla-completa', 'ejemplo-pantalla-completa.png')) });
  process.env.STAGEMASTER_DISCOVERY = '0';
  let notify = () => {};
  let pending = null;
  const desktop = {
    onChange: (fn) => { notify = fn; },
    getState: () => ({
      monitors: [
        { key: '1', label: 'Pantalla del portátil', width: 1920, height: 1080, primary: true, refreshRate: 60, scale: 1, name: '' },
        { key: '2', label: 'Monitor 2', width: 1920, height: 1080, primary: false, refreshRate: 100, scale: 1, name: 'Generic PnP Monitor' },
      ],
      preferences: {}, assignments: { 'pantalla-1': '2', 'pantalla-2': null }, closed: [],
      adsFolder: process.env.STAGEMASTER_ADS_DIR, canUseAsRemote: false, displayModes: { pending },
      network: { ok: true, rule: true, blocked: false, wifi: 'Club', checkedAt: Date.now() },
    }),
    setScreens: () => {}, setMonitor: () => notify(), openScreen: () => {}, openAdsFolder: () => {}, useAsRemote: () => {},
    listModes: async () => ({ monitor: 'Monitor 2', name: 'Generic PnP Monitor', adapter: 'AMD', current: { width: 1920, height: 1080, hz: 100 },
      modes: [{ width: 1920, height: 1080, hz: 100 }, { width: 1920, height: 1080, hz: 85 }, { width: 1920, height: 1080, hz: 60 }] }),
    // Windows tarda: comprobar + aplicar + resincronizar el monitor
    applyMode: async (screenId, mode) => {
      await H.sleep(5000);
      pending = { screenId, label: 'Monitor 2', next: mode, previous: { width: 1920, height: 1080, hz: 100 }, revertAt: Date.now() + 15000 };
      notify();
      return { revertAt: pending.revertAt };
    },
    confirmMode: async () => { pending = null; notify(); }, revertMode: async () => { pending = null; notify(); },
    checkNetwork: async () => {}, allowPhones: async () => {},
  };
  const { startServer } = require('../../server/index');
  const app = await startServer({ ports: [3431], desktop, logHttp: false });
  const st = await H.station(3431);
  const browser = await chromium.launch();
  const errors = [];
  try {
    await st.setup('pista-1', H.config());
    const S = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    H.watchErrors(S, 'estación', errors);
    const toasts = [];
    await S.exposeFunction('noteToast', (t) => toasts.push(t));
    // Avisos (#st-toast): cada texto nuevo que se muestra
    await S.addInitScript(() => {
      let last = '';
      setInterval(() => {
        const el = document.getElementById('st-toast');
        const text = el && !el.classList.contains('hidden') ? el.textContent : '';
        if (text && text !== last) window.noteToast(text);
        last = text;
      }, 40);
    });
    await S.goto('http://localhost:3431/station.html');
    await S.waitForSelector('[data-screen-card="pantalla-2"]');
    const card1 = '[data-screen-card="pantalla-1"]';

    // ── Zonas distintas ──
    const zones = await S.$$eval('.st-zone .st-section-title', (els) => els.map((e) => e.textContent));
    T.check('Dos zonas con su título: «Pistas y partidos» y «Pantallas LED»', zones[0] === 'Pistas y partidos' && zones[1] === 'Pantallas LED', zones.join(' | '));
    const heads = await S.evaluate(() => {
      const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
      return { court: bg('[data-match-card="pista-1"] .st-card-head'), screen: bg('[data-screen-card="pantalla-1"] .st-card-head') };
    });
    T.check('La cabecera de una pantalla no se parece a la de una pista (oscura, con monitor)',
      heads.court !== heads.screen && !!(await S.$(`${card1} .st-card-head .st-card-icon`)), JSON.stringify(heads));

    // ── Minimizar una pista: resumen y se recuerda ──
    await S.click('[data-collapse="pista:pista-2"]');
    T.check('Pista minimizada: sin cuerpo, con resumen en la cabecera',
      await S.isHidden('[data-match-card="pista-2"] .st-card-body') && (await S.textContent('[data-match-card="pista-2"] .st-card-mini')).includes('Sin partido'));
    await S.click('[data-collapse="pista:pista-1"]');
    T.check('…con el marcador en una línea si hay partido', /Sets 0-0 · Games 0-0/.test(await S.textContent('[data-match-card="pista-1"] .st-card-mini')));
    await S.click('[data-collapse="pantalla:pantalla-2"]');
    T.check('Pantalla minimizada: una línea con su estado',
      await S.isHidden('[data-screen-card="pantalla-2"] .st-card-body') && await S.isVisible('[data-screen-card="pantalla-2"] .st-card-mini'));
    await S.click('[data-collapse="acceso-arbitros"]');
    T.check('El acceso de los árbitros se minimiza (sin QR, con la dirección)',
      await S.isHidden('#st-referee-access .st-qr') && await S.isVisible('#st-referee-access .st-access-hint'));
    await S.reload();
    await S.waitForSelector('[data-screen-card="pantalla-2"]');
    T.check('Se recuerda al recargar (o al cerrar y abrir StageMaster)',
      await S.isHidden('[data-match-card="pista-2"] .st-card-body') && await S.isHidden('[data-screen-card="pantalla-2"] .st-card-body') &&
      await S.isHidden('#st-referee-access .st-qr') && await S.isVisible('[data-match-card="pista-1"] .st-card-body') === false);
    for (const id of ['pista:pista-1', 'pista:pista-2', 'pantalla:pantalla-2', 'acceso-arbitros']) await S.click(`[data-collapse="${id}"]`);
    T.check('Se vuelven a mostrar con el mismo botón', await S.isVisible('[data-match-card="pista-2"] .st-card-body') && await S.isVisible('#st-referee-access .st-qr'));
    await S.click('[data-collapse="zona-pantallas"]');
    T.check('Una zona entera se minimiza y deja su resumen («2 pantallas · …»)',
      await S.isHidden('#st-screens') && (await S.textContent('#st-screens-summary')).startsWith('2 pantallas'));
    await S.click('[data-collapse="zona-pantallas"]');

    // ── Pestañas con resumen ──
    const sub = (tab) => S.textContent(`${card1} [data-tab="${tab}"] .tab-sub`);
    T.check('Las pestañas dicen lo que hay sin abrirlas', (await sub('content')).startsWith('Pista 1') && (await sub('output')) === 'Monitor completo', await sub('content'));
    await st.screen('pantalla-1', { ribbon: { enabled: false } });
    await H.waitFor(async () => (await sub('ribbon')) === 'Apagada', 'cinta apagada');
    T.check('Cinta apagada: la pestaña lo dice', true);
    await S.click(`${card1} [data-tab="ribbon"]`);
    T.check('…y dentro, el interruptor principal y los grupos atenuados',
      await S.isVisible(`${card1} .st-power.is-off`) && (await S.$$(`${card1} .st-group.is-off`)).length === 3);

    // ── «Todos» / «Ninguno» y miniaturas ──
    await S.click(`${card1} [data-tab="media"]`);
    await S.click(`${card1} [data-action="selectItems"][data-which="all"]`);
    // Carpeta de ejemplo: 02-segundo.png, ejemplo-pantalla-completa.png y ejemplo-video.mp4
    await H.waitFor(() => st.state.screens[0].media.items.length === 3, 'todos los archivos');
    await H.waitFor(async () => (await sub('media')) === '3 archivos', 'resumen de la lista');
    T.check('«Todos» marca todos los archivos de la lista (y la pestaña dice «3 archivos»)', true);
    T.check('Cada archivo con su miniatura (imagen o fotograma del vídeo) y su número de orden',
      (await S.$$(`${card1} .st-thumb img`)).length === 2 && (await S.$$(`${card1} .st-thumb video`)).length === 1 &&
      (await S.$$eval(`${card1} .st-order`, (els) => els.map((e) => e.textContent))).join() === '1,2,3');
    await S.click(`${card1} [data-action="selectItems"][data-which="none"]`);
    await H.waitFor(() => st.state.screens[0].media.items.length === 0, 'ningún archivo');
    T.check('«Ninguno» los quita todos', true);

    // ── Historial al instante ──
    await S.click('.st-view-tab[data-view="history"]');
    await H.sleep(400);
    const before = (await S.$$('.hist-row')).length;
    await st.act('pista-1', 'finishMatch');
    await S.waitForFunction((n) => document.querySelectorAll('.hist-row').length === n + 1, before, { timeout: 4000 });
    T.check('Al terminar un partido, aparece en el Historial sin recargar', true);
    await H.waitFor(() => toasts.some((t) => t.includes('guardado en el Historial')), 'aviso');
    T.check('…y la estación avisa «Pista 1: partido guardado en el Historial»', true);
    await S.click('.st-view-tab[data-view="panel"]');

    // ── Resolución: Windows tarda 5 s ──
    await S.click(`${card1} [data-tab="output"]`);
    await S.click(`${card1} [data-action="modes"]`);
    await S.waitForSelector('#dlg-modes[open] .st-mode');
    await S.click('#dlg-modes .st-mode:nth-child(3)');
    await S.click('#dlg-modes-ok');
    await H.sleep(300);
    T.check('Mientras Windows aplica el modo, el diálogo lo explica', (await S.textContent('#dlg-modes-choice')).includes('Aplicando'));
    await S.waitForSelector('#dlg-modes[open]', { state: 'detached', timeout: 9000 }).catch(() => {});
    await S.waitForFunction(() => !document.getElementById('dlg-modes').open, null, { timeout: 9000 });
    T.check('Aunque Windows tarde 5 s: sin «El servidor no respondió»', !toasts.some((t) => /no respondió/.test(t)), toasts.join(' | '));
    await S.waitForSelector(`${card1} [data-action="confirmMode"]`);
    T.check('…y aparece «Mantener / Volver» con el modo probado', (await S.textContent(`${card1} .st-mode-pending`)).includes('60 Hz'));
    await S.click(`${card1} [data-action="confirmMode"]`);

    await S.screenshot({ path: `${H.OUT}/panel.png`, fullPage: true });
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close();
    st.socket.close();
    await app.close();
    process.exit(failed ? 1 : 0);
  }
})();
