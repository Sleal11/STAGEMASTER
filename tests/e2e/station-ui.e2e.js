'use strict';

/**
 * station-ui.e2e.js — Detalles de la estación (navegador)
 *
 * Servidor real con una aplicación de escritorio SIMULADA (monitores y modos
 * de Windows inventados, como los de un portátil con un monitor externo) para
 * probar en cualquier sistema:
 *   - La versión no se ve en la interfaz (solo al pasar el ratón por el logo)
 *   - Formato: «Monitor completo», guardados y «Personalizado» (sin LED XL / pequeño);
 *     una pantalla en LED pequeño se ve como Personalizado 416 × 208
 *   - Pestañas sin barra de desplazamiento horizontal
 *   - Diálogo de resolución: X para cerrar, la elegida resaltada, «Probar»
 *   - Los avisos de las pantallas se ocultan solos a los 10 s y vuelven si reaparecen
 *   - Cabecera sin «Teléfonos de árbitro» y logo sin aplastar; junto al QR, la
 *     Wi-Fi y la dirección; aviso del firewall de Windows y «Permitir teléfonos»
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { chromium } = require('playwright');
const H = require('./harness');

const MODES = [[1920, 1080, 100], [1920, 1080, 85], [1920, 1080, 60], [1920, 1080, 59], [1920, 1080, 50],
  [1680, 1050, 100], [1680, 1050, 60], [1760, 990, 100], [1600, 900, 60], [1440, 900, 60], [1280, 1024, 60],
  [1280, 720, 60], [1024, 768, 60]].map(([width, height, hz]) => ({ width, height, hz }));

(async () => {
  const T = H.checker('ESTACIÓN: VERSIÓN, FORMATOS, PESTAÑAS, DIÁLOGO DE RESOLUCIÓN Y AVISOS');
  process.env.STAGEMASTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-e2e-ui-'));
  process.env.STAGEMASTER_ADS_DIR  = H.makeAdsDir();
  process.env.STAGEMASTER_DISCOVERY = '0';
  const applied = [];
  // Diagnóstico de red simulado: firewall bloqueando StageMaster hasta «Permitir teléfonos»
  let network = { ok: false, rule: false, blocked: true, publicNetwork: false, wifi: 'Club Padel 5G', checkedAt: Date.now() };
  let allowCalls = 0;
  let notify = () => {};
  const desktop = {
    onChange: (fn) => { notify = fn; },
    getState: () => ({
      monitors: [
        { key: '1', label: 'Pantalla del portátil', width: 1920, height: 1080, primary: true, refreshRate: 60, scale: 1.25, name: '' },
        { key: '2', label: 'Monitor 2', width: 1920, height: 1080, primary: false, refreshRate: 60, scale: 1, name: 'Generic PnP Monitor' },
      ],
      preferences: {}, assignments: { 'pantalla-1': '2', 'pantalla-2': null }, closed: [],
      adsFolder: process.env.STAGEMASTER_ADS_DIR, canUseAsRemote: true, displayModes: { pending: null }, network,
    }),
    setScreens: () => {}, setMonitor: () => notify(), openScreen: () => {}, openAdsFolder: () => {}, useAsRemote: () => {},
    listModes: async () => ({ monitor: 'Monitor 2', name: 'Generic PnP Monitor', adapter: 'AMD Radeon(TM) Vega 8 Graphics',
      current: { width: 1920, height: 1080, hz: 60 }, modes: MODES }),
    applyMode: async (screenId, mode) => { applied.push(mode); return { revertAt: Date.now() + 15000 }; },
    confirmMode: async () => {}, revertMode: async () => {},
    checkNetwork: async () => {},
    allowPhones: async () => { allowCalls++; network = { ...network, ok: true, rule: true, blocked: false }; notify(); },
  };
  const { startServer } = require('../../server/index');
  const app = await startServer({ ports: [3408], desktop, logHttp: false });
  const st = await H.station(3408);
  const browser = await chromium.launch();
  const errors = [];
  try {
    await st.setup('pista-1', H.config());
    await st.act('pista-1', 'pointA');
    // Mismo ancho de ventana que en la captura de Santiago (tarjetas estrechas)
    const S = await browser.newPage({ viewport: { width: 1018, height: 1100 } });
    H.watchErrors(S, 'estación', errors);
    await S.goto('http://localhost:3408/station.html');
    await S.waitForSelector('[data-match-card="pista-1"] .pill');

    // ── Cabecera y logo (ventana ancha como la del portátil del evento) ──
    await S.setViewportSize({ width: 1866, height: 1000 });
    await H.sleep(300);
    const top = (await S.textContent('.st-top')).replace(/\s+/g, ' ');
    T.check('La cabecera ya no muestra «Teléfonos de árbitro»', !top.includes('Teléfonos de árbitro') && !top.includes('control.html'), top.slice(0, 120));
    const logo = await S.$eval('.st-logo', (el) => {
      const img = el.querySelector('img');
      if (!img) return { text: true };
      const r = img.getBoundingClientRect();
      return { ratio: r.width / r.height, natural: img.naturalWidth / img.naturalHeight };
    });
    T.check('El logo no se aplasta (mantiene su proporción)', logo.text || Math.abs(logo.ratio - logo.natural) < 0.05, JSON.stringify(logo));
    const viewTabs = await S.$$eval('.st-view-tab', (els) => els.map((e) => e.getBoundingClientRect().height));
    T.check('«En vivo» cabe en una línea (pestañas de la misma altura)', Math.max(...viewTabs) - Math.min(...viewTabs) < 1, viewTabs.join(','));
    await S.setViewportSize({ width: 1018, height: 1100 });

    // ── Junto al QR: Wi-Fi y dirección; aviso del firewall ──
    const hint = await S.textContent('#st-referee-access .st-access-hint');
    T.check('Junto al QR único: en qué Wi-Fi debe estar el teléfono y la dirección para escribirla',
      hint.includes('Club Padel 5G') && /\d+\.\d+\.\d+\.\d+:3408/.test(hint), hint.trim());
    await S.waitForSelector('#st-phones-alert .st-phones-alert');
    T.check('El firewall bloquea StageMaster → aviso claro en el Panel', (await S.textContent('#st-phones-alert')).includes('bloqueando StageMaster'));
    await S.click('#st-phones-alert [data-action="allowPhones"]');
    await S.waitForSelector('#st-phones-alert .st-phones-alert', { state: 'detached', timeout: 5000 });
    T.check('«Permitir teléfonos» lo arregla y el aviso desaparece', allowCalls === 1);

    // ── Versión ──
    const header = await S.textContent('.st-top');
    const pill = await S.textContent('[data-match-card="pista-1"] .st-card-head .pill');
    T.check('La versión no se ve en la cabecera', !/v\d+\.\d+\.\d+/.test(header) && !/2\.3\.\d/.test(header), header.replace(/\s+/g, ' ').slice(0, 80));
    T.check('Ni la versión del marcador en la tarjeta del partido («En juego», sin «v12»)', !/\bv\d+/.test(pill), pill);
    T.check('…pero se puede consultar pasando el ratón por el logo', /StageMaster \d+\.\d+\.\d+/.test(await S.getAttribute('.st-brand', 'title')));

    // ── Formatos ──
    const card = (n) => `[data-screen-card="pantalla-${n}"]`;
    await S.click(`${card(2)} [data-tab="output"]`);
    const options = await S.$$eval(`${card(2)} select[data-action="format"] option`, (o) => o.map((x) => x.value));
    T.check('Formato: solo «Monitor completo» y «Personalizado» (sin LED XL ni LED pequeño)', options.join() === 'fill,custom', options.join());
    await st.screen('pantalla-2', { output: { format: 'led-sm' } });
    await S.waitForSelector(`${card(2)} input[data-action="outputW"]`);
    T.check('Una pantalla que estaba en «LED pequeño» se ve como Personalizado 416 × 208',
      (await S.inputValue(`${card(2)} select[data-action="format"]`)) === 'custom' &&
      (await S.inputValue(`${card(2)} input[data-action="outputW"]`)) === '416' &&
      (await S.inputValue(`${card(2)} input[data-action="outputH"]`)) === '208');

    // ── Pestañas sin barra blanca ──
    await S.click(`${card(1)} [data-tab="output"]`);
    const tabs = await S.$eval(`${card(1)} .tabs`, (el) => ({ overflow: getComputedStyle(el).overflowX, fits: el.scrollWidth <= el.clientWidth + 1 }));
    T.check('Pestañas sin barra de desplazamiento horizontal', tabs.overflow === 'visible' && tabs.fits, JSON.stringify(tabs));

    // ── Diálogo de resolución ──
    await S.click(`${card(1)} [data-action="modes"]`);
    await S.waitForSelector('#dlg-modes[open] .st-mode');
    T.check('El diálogo tiene una X para cerrar y ya no tiene «Cancelar»',
      await S.isVisible('#dlg-modes-close') && !(await S.$('#dlg-modes-cancel')));
    const look = (i) => S.$eval(`#dlg-modes .st-mode:nth-child(${i})`, (el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: cs.borderColor };
    });
    const current = await look(3);                    // 1920 × 1080 · 60 Hz (la actual)
    const other = await look(6);
    T.check('Al abrir, la actual se ve resaltada', current.bg !== other.bg && current.border !== other.border);
    T.check('«Probar» desactivado mientras la elegida es la actual', await S.isDisabled('#dlg-modes-ok'));
    await S.click('#dlg-modes .st-mode:nth-child(6)');  // 1680 × 1050 · 100 Hz
    await S.mouse.move(5, 5);                          // sin el ratón encima (hover)
    await H.sleep(300);                                // fin de la transición de color
    const picked = await look(6);
    const unpicked = await look(3);
    T.check('Al hacer clic en otra, esa queda resaltada y la anterior no', picked.bg === current.bg && unpicked.bg === other.bg);
    T.check('…y se indica cuál está elegida junto a «Probar»',
      (await S.textContent('#dlg-modes-choice')).includes('1680 × 1050 · 100 Hz') && !(await S.isDisabled('#dlg-modes-ok')));
    const list = await S.$eval('#dlg-modes-list', (el) => getComputedStyle(el).scrollbarColor);
    T.check('Barra de desplazamiento oscura (no blanca)', list && list !== 'auto', list);
    await S.screenshot({ path: `${H.OUT}/dialogo-resolucion.png`, clip: await (await S.$('#dlg-modes')).boundingBox() });
    await S.click('#dlg-modes-close');
    T.check('La X cierra el diálogo sin cambiar nada', !(await S.$('#dlg-modes[open]')) && applied.length === 0);
    await S.click(`${card(1)} [data-action="modes"]`);
    await S.waitForSelector('#dlg-modes[open] .st-mode');
    await S.click('#dlg-modes .st-mode:nth-child(9)');  // 1600 × 900 · 60 Hz
    await S.click('#dlg-modes-ok');
    await S.waitForSelector('#dlg-modes:not([open])', { state: 'attached' });
    T.check('«Probar» aplica la elegida', applied.length === 1 && applied[0].width === 1600 && applied[0].height === 900);

    // ── Avisos que se ocultan solos ──
    await st.screen('pantalla-1', { endAds: { enabled: true }, media: { items: [] } });
    await S.waitForSelector(`${card(1)} .st-warning`);
    T.check('Aparece el aviso (publicidad final con la lista vacía)', true);
    await H.sleep(9000);
    T.check('A los 9 s sigue visible', await S.isVisible(`${card(1)} .st-warning`));
    await S.waitForSelector(`${card(1)} .st-warning`, { state: 'detached', timeout: 3000 });
    T.check('A los 10 s desaparece solo', true);
    await st.screen('pantalla-1', { media: { items: ['ejemplo-pantalla-completa.png'] } });
    await H.sleep(500);
    await st.screen('pantalla-1', { media: { items: [] } });
    await S.waitForSelector(`${card(1)} .st-warning`, { timeout: 3000 });
    T.check('Si el problema se arregla y vuelve, el aviso vuelve a salir', true);
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await app.close();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
