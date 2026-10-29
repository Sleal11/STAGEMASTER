'use strict';

/**
 * buildInfo.js — Qué versión de StageMaster está funcionando
 *
 *   version  La de package.json (ej. 2.2.0)
 *   commit   El cambio exacto del código (7 caracteres), para saber si es la
 *            última versión de prueba:
 *              - En el .exe: lo escribe GitHub al compilar (build-info.json)
 *              - Desarrollo (npm run app): se lee de la carpeta .git
 *   date     Fecha de compilación (solo en el .exe)
 *
 * La estación lo muestra arriba ("v2.2.0 · 19c768c") y lo da /health.
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/** Commit actual leyendo .git (sin ejecutar git) */
function gitCommit() {
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head.slice(0, 7);
    const ref = head.slice(5);
    const loose = path.join(ROOT, '.git', ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim().slice(0, 7);
    const packed = fs.readFileSync(path.join(ROOT, '.git', 'packed-refs'), 'utf8');
    const line = packed.split('\n').find((l) => l.endsWith(' ' + ref));
    return line ? line.slice(0, 7) : null;
  } catch (_) {
    return null;
  }
}

let cached = null;

function getBuildInfo() {
  if (cached) return cached;
  const pkg   = readJson(path.join(ROOT, 'package.json')) || {};
  const build = readJson(path.join(ROOT, 'build-info.json'));
  cached = {
    version: pkg.version || '?',
    commit:  process.env.STAGEMASTER_BUILD_COMMIT || (build && build.commit) || gitCommit() || 'desarrollo',
    date:    (build && build.date) || null,
  };
  return cached;
}

/** "v2.2.0 · 19c768c" */
function describeBuild(info = getBuildInfo()) {
  return `v${info.version} · ${info.commit}`;
}

module.exports = { getBuildInfo, describeBuild };
