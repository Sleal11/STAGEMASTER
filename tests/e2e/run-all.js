'use strict';

/**
 * run-all.js — Ejecuta todas las pruebas de navegador y de la aplicación de
 * escritorio, una detrás de otra, y resume el resultado.
 *
 *   npm run test:e2e
 *
 * Requisitos: Playwright con Chromium y, para las de la aplicación de
 * escritorio (desktop, remote), Electron descargado. En Linux sin escritorio,
 * con Xvfb (DISPLAY=:99).
 */

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = ['history', 'pause', 'brightness', 'screens', 'formats', 'station-ui', 'live', 'media-fit', 'layout', 'phone', 'desktop', 'remote'];

const results = SUITES.map((name) => {
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(__dirname, `${name}.e2e.js`)], { encoding: 'utf8', timeout: 10 * 60 * 1000 });
  const output = (run.stdout || '') + (run.stderr || '');
  const total = (output.match(/TOTAL: .*/) || ['sin resumen'])[0];
  const ok = run.status === 0;
  console.log(`${ok ? '✅' : '❌'}  ${name.padEnd(12)} ${total}  (${Math.round((Date.now() - started) / 1000)} s)`);
  if (!ok) console.log(output.split('\n').filter((l) => l.includes('❌')).map((l) => '      ' + l.trim()).join('\n'));
  return ok;
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed ? '❌' : '✅'}  ${SUITES.length - failed}/${SUITES.length} conjuntos de pruebas superados`);
process.exit(failed ? 1 : 0);
