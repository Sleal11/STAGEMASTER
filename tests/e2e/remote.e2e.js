'use strict';

/**
 * remote.e2e.js — Portátil remoto con la aplicación de escritorio REAL (Electron)
 *
 * Simula dos portátiles en el mismo equipo:
 *   PRINCIPAL  servidor de StageMaster (como el .exe en modo principal)
 *   REMOTO     StageMaster (Electron) en modo «pantalla remota», con su propia
 *              carpeta de datos, que encuentra al principal por la red (UDP),
 *              se enlaza con el código y abre la Pantalla 2 por la red (IP, no localhost).
 *
 * Comprueba: descubrimiento, enlace, marcador en tiempo real, informe a la
 * estación, corte del principal (la pantalla mantiene la imagen y se reconecta
 * sola) y desvincular desde la estación.
 *
 * Requisitos: Electron descargado (node node_modules/electron/install.js) y una
 * pantalla (en Linux sin escritorio: Xvfb y DISPLAY=:99).
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const H = require('./harness');

/**
 * En el entorno de pruebas en la nube, Chromium no puede abrir WebSocket hacia la
 * IP de red (la red del contenedor responde 403 sin llegar al servidor; se
 * comprobó con un servidor mínimo ajeno a StageMaster). Socket.IO sigue
 * funcionando por HTTP (long-polling), que es lo que se prueba aquí. En una red
 * real no ocurre. Ese aviso concreto no cuenta como error de la aplicación.
 */
const SANDBOX_WS = /WebSocket connection to 'ws:\/\/[\d.]+:\d+\/socket\.io\/.*Unexpected response code: 403/;

const score = (page) => page.evaluate(() =>
  ['pts-a', 'pts-b', 'games-a', 'games-b'].map((id) => document.getElementById(id).textContent).join(','));

(async () => {
  const T = H.checker('PORTÁTIL REMOTO (aplicación de escritorio real)');
  const port = 3421;
  let srv = await H.startServer(port);
  const st = await H.station(port);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-e2e-remote-'));
  // El portátil remoto empieza directamente en modo remoto
  ['StageMaster', 'stagemaster'].forEach((name) => {
    fs.mkdirSync(path.join(home, name), { recursive: true });
    fs.writeFileSync(path.join(home, name, 'modo.json'), JSON.stringify({ mode: 'remote', remote: {} }));
  });
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [H.ROOT, '--no-sandbox'],
    env: { ...process.env, XDG_CONFIG_HOME: home, STAGEMASTER_DATA_DIR: path.join(home, 'datos'), STAGEMASTER_ADS_DIR: path.join(home, 'pub') },
  });
  const errors = [];
  try {
    await st.setup('pista-2', H.config({ nameA: 'Galán / Lebrón', nameB: 'Stupa / Di Nenno' }));
    await st.act('pista-2', 'pointA');

    const ui = await app.firstWindow();
    H.watchErrors(ui, 'ventana del remoto', errors);
    await ui.waitForSelector('#rm-pair:not(.hidden)');
    T.check('Arranca en modo «pantalla remota» sin enlazar (sin servidor ni estación propios)', true);

    // ── Descubrimiento y enlace ──
    await ui.waitForSelector(`#rm-found button[data-port="${port}"]`, { timeout: 10000 });
    const found = await ui.textContent(`#rm-found button[data-port="${port}"]`);
    T.check('Encuentra el portátil principal en la red sin escribir la IP', found.includes(`:${port}`), found.trim());
    await ui.click(`#rm-found button[data-port="${port}"]`);
    await ui.fill('#rm-code', '111111');
    await ui.fill('#rm-name', 'Portátil pista 2');
    await ui.click('#rm-pair-btn');
    await ui.waitForFunction(() => /incorrecto/.test(document.getElementById('rm-pair-msg').textContent));
    T.check('Código incorrecto → lo explica', true);
    await ui.fill('#rm-code', st.state.remotes.code);
    await ui.click('#rm-pair-btn');
    await ui.waitForSelector('#rm-linked:not(.hidden)', { timeout: 8000 });
    await ui.waitForSelector('.rm-screen select[data-screen="pantalla-2"]');
    T.check('Enlazado: recibe las pantallas del principal', (await ui.$$('.rm-screen')).length === 2);
    T.check('Por defecto no abre nada (cada pantalla se elige)', app.windows().length === 1);

    // ── Mostrar la Pantalla 2 en este portátil ──
    const opened = app.waitForEvent('window');
    await ui.selectOption('select[data-screen="pantalla-2"]', 'window');
    const D = await opened;
    H.watchErrors(D, 'pantalla remota', errors);
    await D.waitForSelector('#d-board:not(.hidden)', { timeout: 10000 });
    const url = D.url();
    T.check('La pantalla carga del principal por la red (no de localhost)', !url.includes('localhost') && url.includes(`:${port}/score.html?pantalla=2`), url.split('#')[0]);
    await st.act('pista-2', 'pointB');
    await D.waitForFunction(() => document.getElementById('pts-b').textContent === '15', null, { timeout: 4000 });
    T.check('Marcador en tiempo real desde el principal', (await score(D)).startsWith('15,15'), await score(D));
    await H.waitFor(() => st.state.remotes.list[0] && st.state.remotes.list[0].screens['pantalla-2'] === 'Ventana de prueba', 'informe a la estación');
    T.check('La estación ve el portátil, su IP y qué muestra', st.state.remotes.list[0].online && /^\d/.test(st.state.remotes.list[0].address));
    await H.waitFor(() => st.state.screens[1].displays.some((d) => d.remote === 'Portátil pista 2'), 'pantalla remota en la tarjeta');
    T.check('La tarjeta de la Pantalla 2 indica «en Portátil pista 2»', true);
    await D.screenshot({ path: `${H.OUT}/remoto-pantalla-2.png` });
    await ui.screenshot({ path: `${H.OUT}/remoto-control.png` });

    // ── Corte del principal: la imagen se mantiene y se reconecta sola ──
    // (a partir de aquí el navegador avisa en consola de los fallos de red provocados;
    // al volver el servidor, la sesión anterior ya no existe: responde 400 y la
    // pantalla se reconecta con una nueva, que es lo que se comprueba después)
    const realErrors = errors.filter((e) => !SANDBOX_WS.test(e));
    const mark = errors.length;
    const before = await score(D);
    st.close();
    await srv.stop();
    await ui.waitForFunction(() => document.getElementById('rm-conn').textContent.includes('Reconectando'), null, { timeout: 15000 });
    T.check('Sin principal: el remoto lo indica («Reconectando…»)', true);
    T.check('…y la pantalla sigue mostrando el marcador (no se queda en negro)', (await score(D)) === before && await D.isVisible('#d-board'));
    srv = await H.startServer(port, { STAGEMASTER_DATA_DIR: srv.data, STAGEMASTER_ADS_DIR: srv.ads });
    const st2 = await H.station(port);
    await ui.waitForFunction(() => document.getElementById('rm-conn').textContent === 'Conectado', null, { timeout: 15000 });
    await H.waitFor(() => st2.state.screens[1].displays.length > 0, 'la pantalla remota vuelve sola', 15000);
    await st2.act('pista-2', 'pointB');
    await D.waitForFunction(() => document.getElementById('pts-b').textContent === '30', null, { timeout: 5000 });
    T.check('Vuelve el principal: se reconecta solo y sigue al día', true);

    // ── Desvincular desde la estación ──
    await st2.send('station:unlinkRemote', { remoteId: st2.state.remotes.list[0].id });
    await ui.waitForSelector('#rm-pair:not(.hidden)', { timeout: 8000 });
    await H.waitFor(() => app.windows().length === 1, 'la ventana de la pantalla se cierra');
    T.check('Desvincular: se apagan sus pantallas y vuelve a pedir el código',
      (await ui.textContent('#rm-pair-msg')).includes('desvincul'));
    st2.close();
    T.check('Sin errores de JavaScript (antes del corte provocado)', realErrors.length === 0, realErrors.join(' | '));
    const unexpected = errors.slice(mark).filter((e) => !/ERR_CONNECTION_REFUSED|WebSocket connection|ERR_CONNECTION_RESET|status of 400 \(Bad Request\)/.test(e));
    T.check('Durante el corte, solo avisos de red (ningún error de la aplicación)', unexpected.length === 0, unexpected.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
    try { await (await app.firstWindow()).screenshot({ path: `${H.OUT}/remoto-error.png` }); } catch (_) { /* sin captura */ }
  } finally {
    const failed = T.report();
    await app.close().catch(() => {});
    await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
