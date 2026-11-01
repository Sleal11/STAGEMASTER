'use strict';

/**
 * desktop.e2e.js — Aplicación de escritorio REAL (Electron) en modo principal
 *
 * Arranca StageMaster como el .exe (servidor + estación) con carpetas
 * temporales y comprueba desde la estación:
 *   - Elegir «Ventana de prueba» abre la ventana de la pantalla
 *   - «Añadir pantalla» → su ventana se abre al elegir monitor; «Quitar» la cierra
 *   - «Usar este portátil como pantalla remota» guarda el modo y reinicia
 *
 * Requisitos: Electron descargado y una pantalla (Xvfb en Linux).
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const H = require('./harness');

const isScreen = (page, n) => page.url().includes(`/score.html?pantalla=${n}`);

(async () => {
  const T = H.checker('APLICACIÓN DE ESCRITORIO (modo principal)');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-e2e-desktop-'));
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [H.ROOT, '--no-sandbox'],
    env: { ...process.env, XDG_CONFIG_HOME: home, STAGEMASTER_DATA_DIR: path.join(home, 'datos'), STAGEMASTER_ADS_DIR: H.makeAdsDir(), STAGEMASTER_DISCOVERY: '0' },
  });
  const errors = [];
  try {
    // Los diálogos nativos se contestan solos (no se pueden pulsar en la prueba)
    await app.evaluate(({ dialog, app: electronApp }) => {
      dialog.showMessageBoxSync = () => 1;
      dialog.showMessageBox = async () => ({ response: 1 });
      electronApp.relaunch = () => { global.relaunched = true; };
    });
    const S = await app.firstWindow();
    H.watchErrors(S, 'estación', errors);
    await S.waitForSelector('[data-screen-card="pantalla-2"]', { timeout: 20000 });
    T.check('Arranca con la estación y 2 pantallas', S.url().includes('/station.html'));

    // ── Ventana de prueba de la Pantalla 1 ──
    await S.click('[data-screen-card="pantalla-1"] [data-tab="output"]');
    let opened = app.waitForEvent('window');
    await S.selectOption('[data-screen-card="pantalla-1"] select[data-action="monitor"]', 'window');
    const D1 = await opened;
    await D1.waitForSelector('#d-waiting:not(.hidden), #d-board:not(.hidden)');
    T.check('«Ventana de prueba» abre la Pantalla 1', isScreen(D1, 1));
    await S.waitForSelector('[data-screen-card="pantalla-1"] .dot.ok');
    T.check('La estación la ve conectada «en este portátil»',
      (await S.textContent('[data-screen-card="pantalla-1"] [data-part="status"]')).includes('en este portátil'));

    // ── En vivo (dentro de la aplicación real) ──
    await S.click('.st-view-tab[data-view="live"]');
    await S.waitForSelector('[data-live="pantalla-1"] iframe');
    const preview = S.frames().find((f) => /pantalla=1&vista=previa/.test(f.url()));
    await preview.waitForSelector('#d-waiting:not(.hidden), #d-board:not(.hidden)');
    await S.waitForFunction(() => document.querySelector('[data-live="pantalla-1"] .live-info').textContent.includes('ventana de prueba'));
    T.check('«En vivo» funciona en la aplicación: vista previa y «en una ventana de prueba»', true);
    T.check('…y la vista previa no abre ventanas ni cuenta como una', app.windows().length === 2);
    await S.click('.st-view-tab[data-view="panel"]');

    // ── Diagnóstico del monitor (lo que dice el sistema: px reales, Hz, escala) ──
    await S.click('[data-screen-card="pantalla-2"] [data-tab="output"]');
    const primaryKey = await S.$eval('[data-screen-card="pantalla-2"] select[data-action="monitor"] option', (o) => o.value);
    opened = app.waitForEvent('window');
    await S.selectOption('[data-screen-card="pantalla-2"] select[data-action="monitor"]', primaryKey);
    const D2 = await opened;
    await S.waitForSelector('[data-screen-card="pantalla-2"] .st-monitor-facts');
    const facts = await S.textContent('[data-screen-card="pantalla-2"] .st-monitor-facts');
    T.check('Salida muestra la resolución real, la frecuencia y la escala del monitor', /px reales/.test(facts) && /escala \d+ %/.test(facts), facts.trim());
    T.check('…y no ofrece cambiar la resolución de la pantalla de la estación', !(await S.$('[data-screen-card="pantalla-2"] [data-action="modes"]')));
    const closedD2 = D2.waitForEvent('close');
    await S.selectOption('[data-screen-card="pantalla-2"] select[data-action="monitor"]', 'none');
    await closedD2;

    // ── Añadir y quitar ──
    await S.click('#st-add-screen');
    await S.waitForSelector('[data-screen-card="pantalla-3"]');
    await S.click('[data-screen-card="pantalla-3"] [data-tab="output"]');
    opened = app.waitForEvent('window');
    await S.selectOption('[data-screen-card="pantalla-3"] select[data-action="monitor"]', 'window');
    const D3 = await opened;
    await D3.waitForLoadState();
    T.check('Pantalla añadida: su ventana se abre al elegir monitor', isScreen(D3, 3));
    const closed = D3.waitForEvent('close');
    await S.click('[data-screen-card="pantalla-3"] [data-action="removeScreen"]');
    await S.click('#dlg-confirm-ok');
    await closed;
    T.check('«Quitar» cierra su ventana', !app.windows().some((w) => isScreen(w, 3)));
    T.check('…y la Pantalla 1 sigue abierta', app.windows().some((w) => isScreen(w, 1)));

    // ── Pasar a pantalla remota ──
    T.check('La estación ofrece «Usar este portátil como pantalla remota»', await S.isVisible('[data-action="useAsRemote"]'));
    const exited = app.waitForEvent('close');
    await S.click('[data-action="useAsRemote"]');
    await exited;
    const settingsFile = ['StageMaster', 'stagemaster'].map((n) => path.join(home, n, 'modo.json')).find((f) => fs.existsSync(f));
    const saved = settingsFile && JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    T.check('Guarda el modo «remoto» y reinicia StageMaster', saved && saved.mode === 'remote');
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await app.close().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
