/**
 * history.js — Vista "Historial" de la estación
 *
 *   - Filtros: Hoy · Ayer · 7 días · 30 días · Todo, o un día / rango con
 *     "Desde" y "Hasta", por pista y por nombre de jugador
 *   - Lista agrupada por días, lo más reciente primero
 *   - Detalle de cada partido (set a set, horas, duración, reglas)
 *   - Exportar lo que se ve a CSV (se abre en Excel)
 *
 * Las fechas se calculan en la hora local del portátil y se envían como
 * instantes (ms) al servidor (core/history.js), que guarda los partidos.
 */

import * as ScoreFormat from '../common/score-format.js';
import { esc, icon } from '../common/ui.js';
import { send, toast } from './context.js';

const $ = (id) => document.getElementById(id);
const DAY = 24 * 60 * 60 * 1000;

const SCORING = ScoreFormat.SCORING_NAMES;
const TIEBREAK = { tiebreak: 'Tie Break', superTiebreak: 'Súper Tie Break', none: 'Sin desempate' };

const dayFormat  = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

let quick   = 'today';
let records = [];
let visible = false;
let stale   = true;
let searchTimer = null;

// ─────────────────────────────────────────────────────────────────
// FILTROS
// ─────────────────────────────────────────────────────────────────

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "2026-11-01" (input type=date) → inicio de ese día en hora local */
function parseDay(value) {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function toInputValue(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Rango [from, to) del filtro rápido o de las fechas elegidas */
function currentRange() {
  const today = startOfDay(new Date());
  switch (quick) {
    case 'today':     return { from: today, to: today + DAY };
    case 'yesterday': return { from: today - DAY, to: today };
    case '7':         return { from: today - 6 * DAY, to: today + DAY };
    case '30':        return { from: today - 29 * DAY, to: today + DAY };
    case 'all':       return {};
    default: {
      // Fechas a mano: "Hasta" incluye ese día entero; con solo "Desde", ese día
      const from = parseDay($('hist-from').value);
      const toDay = parseDay($('hist-to').value);
      const to = toDay !== undefined ? toDay + DAY : (from !== undefined ? from + DAY : undefined);
      return { from, to };
    }
  }
}

/** Refleja el filtro rápido en los campos de fecha (así se ve qué días son) */
function syncDateInputs() {
  const { from, to } = currentRange();
  $('hist-from').value = from !== undefined ? toInputValue(from) : '';
  $('hist-to').value   = to !== undefined ? toInputValue(to - 1) : '';
}

function setQuick(value) {
  quick = value;
  document.querySelectorAll('#hist-quick button').forEach((b) => b.classList.toggle('is-active', b.dataset.quick === value));
  if (value !== 'custom') syncDateInputs();
  load();
}

// ─────────────────────────────────────────────────────────────────
// CARGA Y DIBUJO
// ─────────────────────────────────────────────────────────────────

async function load() {
  if (!visible) { stale = true; return; }
  stale = false;
  const res = await send('station:history', {
    ...currentRange(), matchId: $('hist-court').value, text: $('hist-text').value.trim(), limit: 2000,
  });
  if (!res.ok) return;
  records = res.records;
  render(res.total);
}

function render(total) {
  const n = records.length;
  $('hist-summary').textContent = n === 0 ? '' :
    `${n} ${n === 1 ? 'partido' : 'partidos'}${total > n ? ` (se muestran los ${n} más recientes de ${total})` : ''}`;
  $('hist-export').disabled = n === 0;

  if (n === 0) {
    $('hist-list').innerHTML = `<div class="hist-empty">${icon('calendar')}<strong>No hay partidos terminados en estas fechas</strong>` +
      '<span>Los partidos se guardan solos al terminar (o al pulsar «Finalizar»).</span></div>';
    return;
  }

  // Agrupados por día
  const groups = [];
  records.forEach((r) => {
    const day = startOfDay(new Date(r.finishedAt));
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, items: [] });
    groups[groups.length - 1].items.push(r);
  });
  $('hist-list').innerHTML = groups.map((g) => `
    <section class="hist-day">
      <h3 class="hist-day-title">${esc(capitalize(dayFormat.format(g.day)))} <span>${g.items.length}</span></h3>
      ${g.items.map(rowHtml).join('')}
    </section>`).join('');
}

function rowHtml(r) {
  const index = records.indexOf(r);
  const team = (side) => `<span class="hist-team${r.winner === side ? ' is-winner' : ''}">` +
    `${r.winner === side ? icon('trophy', 'hist-trophy') : ''}${esc(r.teams[side])}</span>`;
  return `
    <button type="button" class="hist-row" data-index="${index}" style="--court-color:${esc(r.color || '#8FD3FF')}">
      <span class="hist-time">${timeRange(r)}<small>${durationText(r)}</small></span>
      <span class="hist-court">${esc(r.court)}</span>
      <span class="hist-teams">${team('A')}<span class="hist-vs">vs</span>${team('B')}</span>
      <span class="hist-score">${esc(scoreText(r))}</span>
      ${r.finishType === 'manual' ? '<span class="pill warn">Finalizado a mano</span>' : ''}
    </button>`;
}

// ─────────────────────────────────────────────────────────────────
// TEXTOS
// ─────────────────────────────────────────────────────────────────

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const plural = (n, one, many) => `${n ?? '?'} ${n === 1 ? one : many}`;

function timeRange(r) {
  return r.startedAt ? `${timeFormat.format(r.startedAt)} – ${timeFormat.format(r.finishedAt)}` : timeFormat.format(r.finishedAt);
}

function minutes(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
}

function durationText(r) {
  if (!Number.isFinite(r.durationMs)) return 'duración desconocida';
  return minutes(r.durationMs) + (r.pausedMs > 60000 ? ` (${minutes(r.pausedMs)} en pausa)` : '');
}

/** "6-3 · 7-6 (8-6) · STB 10-8" (+ set sin terminar si se finalizó a mano) */
function scoreText(r) {
  const sets = (r.setScores || []).map((set) => {
    if (set.superTiebreak) return `STB ${set.tiebreak.A}-${set.tiebreak.B}`;
    return `${set.A}-${set.B}${set.tiebreak ? ` (${set.tiebreak.A}-${set.tiebreak.B})` : ''}`;
  });
  if (r.unfinishedSet) sets.push(`${r.unfinishedSet.A}-${r.unfinishedSet.B} sin terminar`);
  return sets.length ? sets.join(' · ') : `${r.sets.A}-${r.sets.B} en sets`;
}

function winnerText(r) {
  return r.winner ? r.teams[r.winner] : 'Sin ganador (empate en sets)';
}

// ─────────────────────────────────────────────────────────────────
// DETALLE
// ─────────────────────────────────────────────────────────────────

function openDetail(r) {
  const setRows = (r.setScores || []).map((set, i) => `<tr><td>${set.superTiebreak ? 'Súper Tie Break' : `Set ${i + 1}`}</td>` +
    `<td>${set.superTiebreak ? set.tiebreak.A : set.A}</td><td>${set.superTiebreak ? set.tiebreak.B : set.B}</td>` +
    `<td>${set.tiebreak && !set.superTiebreak ? `tie break ${set.tiebreak.A}-${set.tiebreak.B}` : ''}</td></tr>`).join('');
  const unfinished = r.unfinishedSet ? `<tr><td>Set ${(r.setScores || []).length + 1}</td><td>${r.unfinishedSet.A}</td>` +
    `<td>${r.unfinishedSet.B}</td><td>sin terminar</td></tr>` : '';
  const c = r.config || {};
  $('dlg-match-body').innerHTML = `
    <h3 class="st-dialog-title">${esc(r.court)} · ${esc(capitalize(dayFormat.format(r.finishedAt)))}</h3>
    <div class="hist-detail-teams">
      <div class="${r.winner === 'A' ? 'is-winner' : ''}">${r.winner === 'A' ? icon('trophy') : ''}${esc(r.teams.A)}<strong>${r.sets.A}</strong></div>
      <div class="${r.winner === 'B' ? 'is-winner' : ''}">${r.winner === 'B' ? icon('trophy') : ''}${esc(r.teams.B)}<strong>${r.sets.B}</strong></div>
    </div>
    <table class="hist-table"><thead><tr><th></th><th>Pareja A</th><th>Pareja B</th><th></th></tr></thead>
      <tbody>${setRows}${unfinished || ''}</tbody></table>
    ${statsTable(r)}
    <dl class="hist-facts">
      <dt>Ganador</dt><dd>${esc(winnerText(r))}</dd>
      <dt>Horario</dt><dd>${timeRange(r)}</dd>
      <dt>Duración</dt><dd>${durationText(r)}</dd>
      <dt>Cómo terminó</dt><dd>${r.finishType === 'manual' ? 'Finalizado a mano («Finalizar»)' : 'Por el marcador (reglas)'}</dd>
      <dt>Formato</dt><dd>${plural(c.totalSets, 'set', 'sets')} · ${plural(c.gamesPerSet, 'game', 'games')} · ${esc(SCORING[c.scoringSystem] || '')} · ${esc(TIEBREAK[c.tiebreakType] || '')}</dd>
    </dl>`;
  $('dlg-match').showModal();
}

/** Estadísticas registradas del partido (las mismas que la pantalla y el teléfono) */
function statsTable(r) {
  if (!r.stats) return '';   // partidos de versiones anteriores: sin estadísticas
  const rows = ScoreFormat.summaryFromRecord(r).rows;
  return `<table class="hist-table hist-stats"><thead><tr><th>Estadísticas</th><th>Pareja A</th><th>Pareja B</th><th></th></tr></thead>
    <tbody>${rows.map((row) => `<tr><td>${esc(row.label)}</td><td>${row.A}</td><td>${row.B}</td><td></td></tr>`).join('')}</tbody></table>`;
}

// ─────────────────────────────────────────────────────────────────
// EXPORTAR
// ─────────────────────────────────────────────────────────────────

function exportCsv() {
  if (!records.length) return;
  const cell = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
  const header = ['Fecha', 'Inicio', 'Fin', 'Duración', 'Pista', 'Pareja A', 'Pareja B', 'Ganador',
    'Sets A', 'Sets B', 'Resultado', 'Puntuación', 'Desempate', 'Cómo terminó'];
  const rows = records.map((r) => [
    dateFormat.format(r.finishedAt), r.startedAt ? timeFormat.format(r.startedAt) : '', timeFormat.format(r.finishedAt),
    Number.isFinite(r.durationMs) ? minutes(r.durationMs) : '', r.court, r.teams.A, r.teams.B, winnerText(r),
    r.sets.A, r.sets.B, scoreText(r), SCORING[(r.config || {}).scoringSystem] || '', TIEBREAK[(r.config || {}).tiebreakType] || '',
    r.finishType === 'manual' ? 'A mano' : 'Por el marcador',
  ]);
  // ';' y BOM: Excel en español lo abre directamente en columnas y con tildes
  const csv = '﻿' + [header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `StageMaster-historial-${toInputValue(Date.now())}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast(`Historial exportado: ${records.length} partidos`);
}

// ─────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────

/** Pistas del filtro (cuando llega el estado de la estación) */
export function updateCourts(state) {
  const select = $('hist-court');
  const current = select.value;
  const options = '<option value="">Todas</option>' + state.matches.map((m) =>
    `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
  if (select.dataset.options !== options) {
    select.dataset.options = options;
    select.innerHTML = options;
    select.value = current;
  }
}

/** Se muestra u oculta la vista; al mostrarla se recarga si hubo cambios */
export function setHistoryVisible(isVisible) {
  visible = isVisible;
  if (visible && stale) load();
}

/** El servidor avisa de que se guardó o anuló un partido */
export function onHistoryChanged() {
  stale = true;
  if (visible) load();
}

export function initHistory() {
  syncDateInputs();
  $('hist-quick').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-quick]');
    if (b) setQuick(b.dataset.quick);
  });
  ['hist-from', 'hist-to'].forEach((id) => $(id).addEventListener('change', () => {
    quick = 'custom';
    document.querySelectorAll('#hist-quick button').forEach((b) => b.classList.remove('is-active'));
    load();
  }));
  $('hist-court').addEventListener('change', load);
  $('hist-text').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 250); });
  $('hist-list').addEventListener('click', (e) => {
    const row = e.target.closest('.hist-row');
    if (row) openDetail(records[Number(row.dataset.index)]);
  });
  $('hist-export').addEventListener('click', exportCsv);
  $('dlg-match-close').addEventListener('click', () => $('dlg-match').close());
}
