'use strict';

/**
 * history.js — Historial de partidos terminados
 *
 * Archivo: data/historial.jsonl (una línea JSON por evento; SOLO se añade,
 * nunca se reescribe). Así un corte de luz como mucho estropea la última
 * línea, que se ignora al leer; el resto del historial queda intacto.
 *
 * Eventos:
 *   { type: 'final',   uid, ... }   Un partido terminó (por las reglas o con "Finalizar")
 *   { type: 'anulado', uid, at }    Se deshizo el final (el partido sigue jugándose)
 *
 * Sin duplicados: `uid` identifica a cada partido (Match.uid). Al leer, cuenta
 * el último evento de cada uid: si el mismo final llega dos veces, queda uno;
 * si se deshace y se vuelve a terminar, queda el resultado nuevo; si se
 * deshace y nunca termina, no aparece.
 *
 * Un partido que no terminó (p. ej. se cerró la app a mitad) no se guarda.
 */

const fs   = require('fs');
const path = require('path');
const { dataDir } = require('./storage');

const FILE_NAME = 'historial.jsonl';

function createHistory() {
  const file = path.join(dataDir(), FILE_NAME);
  // Último evento escrito por partido: evita escribir el mismo final dos veces
  const lastWritten = new Map();

  function append(event) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Si la última línea quedó cortada (corte de luz), se empieza en una línea nueva
      fs.appendFileSync(file, (endsWithNewline() ? '' : '\n') + JSON.stringify(event) + '\n');
      lastWritten.set(event.uid, event);
      return true;
    } catch (err) {
      // Nunca detiene el marcador: se avisa y se sigue
      console.error(`[Historial] ⚠ No se pudo guardar: ${err.message}`);
      return false;
    }
  }

  function endsWithNewline() {
    let fd = null;
    try {
      const { size } = fs.statSync(file);
      if (size === 0) return true;
      fd = fs.openSync(file, 'r');
      const last = Buffer.alloc(1);
      fs.readSync(fd, last, 0, 1, size - 1);
      return last[0] === 0x0a;
    } catch (_) {
      return true;   // no existe todavía
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }

  // Lo último leído: se reutiliza mientras el archivo no cambie (la estación consulta a menudo)
  let cached = null;   // { stamp, byUid }

  /** Lee el archivo y devuelve el estado actual de cada partido (último evento por uid) */
  function load() {
    let stamp = null;
    try {
      const st = fs.statSync(file);
      stamp = `${st.size}:${st.mtimeMs}`;
    } catch (_) { return new Map(); }
    if (cached && cached.stamp === stamp) return cached.byUid;
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return new Map(); }
    const byUid = new Map();
    text.split('\n').forEach((line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event && typeof event.uid === 'string') byUid.set(event.uid, event);
      } catch (_) { /* línea dañada (corte de luz al escribir): se ignora */ }
    });
    cached = { stamp, byUid };
    return byUid;
  }

  /** Guarda el final de un partido (si es el mismo final ya guardado, no hace nada) */
  function recordFinish(record) {
    if (!record || !record.uid) return false;
    const previous = lastWritten.get(record.uid) || load().get(record.uid);
    if (previous && previous.type === 'final' && previous.version === record.version) return false;
    console.log(`[Historial] Guardado: ${record.court} · ${record.teams.A} vs ${record.teams.B}`);
    return append({ type: 'final', ...record });
  }

  /** Anula el final de un partido (se deshizo el último punto) */
  function cancelFinish(uid) {
    if (!uid) return false;
    const previous = lastWritten.get(uid) || load().get(uid);
    if (!previous || previous.type !== 'final') return false;
    console.log(`[Historial] Anulado (se deshizo el final): ${uid}`);
    return append({ type: 'anulado', uid, at: Date.now() });
  }

  /**
   * Partidos terminados, los más recientes primero.
   * @param {Object} [filters]
   * @param {number} [filters.from]    - Desde (ms, incluido)
   * @param {number} [filters.to]      - Hasta (ms, excluido)
   * @param {string} [filters.text]    - Texto en los nombres de las parejas
   * @param {string} [filters.matchId] - Solo una pista
   * @param {number} [filters.limit]   - Máximo de resultados (por defecto 500)
   */
  function list({ from, to, text, matchId, limit = 500 } = {}) {
    const words = normalize(text || '').split(/\s+/).filter(Boolean);
    const records = [...load().values()]
      .filter((r) => r.type === 'final')
      .filter((r) => !Number.isFinite(from) || r.finishedAt >= from)
      .filter((r) => !Number.isFinite(to) || r.finishedAt < to)
      .filter((r) => !matchId || r.matchId === matchId)
      .filter((r) => {
        if (!words.length) return true;
        const names = normalize(`${r.teams.A} ${r.teams.B}`);
        return words.every((w) => names.includes(w));
      })
      .sort((a, b) => b.finishedAt - a.finishedAt);
    return { total: records.length, records: records.slice(0, Math.min(Math.max(1, limit), 5000)) };
  }

  return { recordFinish, cancelFinish, list, file };
}

/** Minúsculas y sin tildes: "Galán" se encuentra buscando "galan" */
function normalize(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

module.exports = { createHistory };
