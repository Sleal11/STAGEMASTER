'use strict';

/**
 * harness.js — Utilidades de las pruebas de navegador (tests/e2e)
 *
 * Arranca el servidor REAL con carpetas temporales de datos y publicidad y
 * conecta una "estación observadora" por Socket.IO para leer el estado real
 * y dar órdenes. Las capturas se guardan en tests/e2e/out/ (no se suben).
 *
 * Requisitos: Playwright con Chromium (npx playwright install chromium).
 */

const { spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..', '..');
const OUT  = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, ms = 5000) {
  const t0 = Date.now();
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('Tiempo agotado esperando: ' + what);
    await sleep(30);
  }
}

/** Carpeta de publicidad temporal (con los ejemplos del proyecto) */
function makeAdsDir(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-e2e-ads-'));
  ['banner', 'pantalla-completa'].forEach((folder) => {
    fs.mkdirSync(path.join(dir, folder));
    const src = path.join(ROOT, 'publicidad', folder);
    fs.readdirSync(src).forEach((f) => fs.copyFileSync(path.join(src, f), path.join(dir, folder, f)));
  });
  Object.entries(extra).forEach(([rel, content]) => fs.writeFileSync(path.join(dir, rel), content));
  return dir;
}

async function startServer(port, env = {}) {
  const data = env.STAGEMASTER_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'sm-e2e-data-'));
  const ads  = env.STAGEMASTER_ADS_DIR || makeAdsDir();
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), STAGEMASTER_DATA_DIR: data, STAGEMASTER_ADS_DIR: ads, ...env },
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  await waitFor(() => out.includes('Esperando conexiones'), 'arranque del servidor\n' + out, 10000);
  return {
    proc, data, ads, log: () => out,
    stop: () => new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once('exit', r); proc.kill('SIGKILL'); }),
  };
}

/** Estación observadora: estado real del servidor y órdenes */
async function station(port) {
  const socket = io(`http://localhost:${port}`, { auth: { role: 'station' }, forceNew: true });
  const st = { socket, state: null };
  socket.on('stationState', (s) => { st.state = s; });
  await waitFor(() => st.state, 'estado de la estación');
  st.send   = (ev, p) => socket.timeout(5000).emitWithAck(ev, p);
  st.match  = (id) => st.state.matches.find((m) => m.id === id);
  st.screen = (id, changes) => st.send('station:updateScreen', { screenId: id, changes });
  st.setup  = async (id, cfg) => {
    const r = await st.send('setupMatch', { matchId: id, config: cfg, force: true });
    await waitFor(() => st.match(id).state && st.match(id).state.status === 'playing' && st.match(id).state.players.A.points === 0, 'partido nuevo');
    await sleep(150);
    return r;
  };
  st.act = async (id, action) => {
    await waitFor(() => st.match(id).state, 'partido ' + id);
    // El estado de la estación llega agrupado (cada 100 ms): esperar a que esté al día
    await sleep(160);
    const v = st.match(id).state.version;
    const r = await st.send('matchAction', { matchId: id, action, version: v });
    if (r.ok) await waitFor(() => st.match(id).state.version > v, 'versión nueva');
    return r;
  };
  st.close = () => socket.close();
  return st;
}

const config = (o = {}) => ({
  nameA: 'Jose V / Santiago R', nameB: 'Coello / Tapia', gamesPerSet: 6, totalSets: 3,
  scoringSystem: 'goldenPoint', tiebreakType: 'superTiebreak', initialServer: 'A', ...o,
});

/** Mini marco de pruebas: check(nombre, condición, detalle) y resumen final */
function checker(title) {
  const results = [];
  return {
    check: (name, ok, detail = '') => results.push({ name, ok: !!ok, detail }),
    report() {
      console.log(`\n${title}`);
      results.forEach((r) => console.log(`  ${r.ok ? '✅' : '❌'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`));
      const failed = results.filter((r) => !r.ok).length;
      console.log(`TOTAL: ${results.length}  |  ✅ Pasadas: ${results.length - failed}  |  ❌ Fallidas: ${failed}`);
      return failed;
    },
  };
}

/** Errores de JavaScript de una página (para comprobar que no hay ninguno) */
function watchErrors(page, name, list) {
  page.on('pageerror', (e) => list.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') list.push(`${name}: ${m.text()}`); });
}

module.exports = { ROOT, OUT, sleep, waitFor, makeAdsDir, startServer, station, config, checker, watchErrors };
