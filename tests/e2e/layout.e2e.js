'use strict';

/**
 * layout.e2e.js — Matriz visual del marcador (navegador)
 *
 * Formatos: LED XL 832×416, LED pequeño 416×208, 1920×1080 y 1280×720.
 * Estados: set 1 en juego, set 2 con un set terminado, súper tie-break
 * decisivo con nombres largos y punto de oro, pausa y partido terminado;
 * con la cinta publicitaria (logos + mensaje).
 *
 * Comprueba en cada combinación: los sets van en la cabecera junto al logo,
 * nada se sale de la caja, los nombres caben, la cinta tiene la altura
 * prevista y no hay errores. Guarda una captura de cada una (tests/e2e/out/matriz).
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const H = require('./harness');

const FORMATS = [
  { name: 'led-xl', w: 832, h: 416, ribbon: 0.19 },
  { name: 'led-sm', w: 416, h: 208, ribbon: 0.21 },
  { name: 'fhd', w: 1920, h: 1080, ribbon: 0.19 },
  { name: 'hd', w: 1280, h: 720, ribbon: 0.19 },
];

const STATES = [
  { name: 'set1', label: 'Set 1 en juego', current: 'SET 1' },
  { name: 'set2', label: 'Set 2 (un set terminado)', current: 'SET 2', done: 1 },
  { name: 'supertb', label: 'Súper tie-break, nombres largos, punto de oro', current: 'SUPER TB', done: 2 },
  { name: 'pausa', label: 'En pausa', current: 'SET 2', done: 1, badge: 'PAUSA' },
  { name: 'final', label: 'Terminado sin ganador (marcador y estadísticas)', done: 2, badge: 'FINALIZADO', summary: true },
  { name: 'ganador', label: 'Ganado 2-0 (celebración, marcador con el ganador y estadísticas)', done: 2, badge: 'FINALIZADO', winner: true, summary: true },
];

const OUT = path.join(H.OUT, 'matriz');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const T = H.checker('MATRIZ VISUAL DEL MARCADOR (formatos × estados)');
  const port = 3406;
  const srv = await H.startServer(port, { STAGEMASTER_DISCOVERY: '0' });
  const st = await H.station(port);
  const browser = await chromium.launch();
  const errors = [];
  try {
    const pages = [];
    for (const f of FORMATS) {
      const screenId = 'pantalla-1';
      const page = await browser.newPage({ viewport: { width: f.w, height: f.h } });
      H.watchErrors(page, f.name, errors);
      pages.push({ f, page, screenId });
    }
    await st.screen('pantalla-1', {
      ribbon: { enabled: true, items: ['ejemplo-banner.png'], texts: ['Gracias a Bar Central'], motion: 'rotate', interval: 3 },
    });

    for (const s of STATES) {
      await prepare(st, s);
      // Ganado: primero la celebración (6 s), después el marcador con el ganador
      if (s.winner) {
        await H.sleep(1500);
        for (const { f, page } of pages) {
          const shown = await page.isVisible('#d-celebrate');
          T.check(`${f.name} · ${s.name}: celebración del ganador`, shown);
          await page.screenshot({ path: path.join(OUT, `${f.name}-celebracion.png`) });
        }
        await H.sleep(5200);
      }
      for (const { f, page } of pages) {
        if (!page.url().includes('score.html')) await page.goto(`http://localhost:${port}/score.html?pantalla=1`);
        await page.waitForSelector('#d-board:not(.hidden)');
        await H.sleep(900);
        const r = await page.evaluate(measure);
        const tag = `${f.name} · ${s.name}`;
        if (s.winner) {
          const win = await page.evaluate(() => ({
            row: document.getElementById('row-a').classList.contains('is-winner'),
            trophy: getComputedStyle(document.querySelector('#row-a .icon-trophy')).display !== 'none',
            label: document.getElementById('d-divider-label').textContent,
          }));
          T.check(`${tag}: marcador con el ganador (fila destacada y trofeo)`, win.row && win.trophy, JSON.stringify(win));
        }
        const chips = r.chips.map((c) => c.text);
        if (s.current) {
          T.check(`${tag}: «${s.current} · EN JUEGO» arriba junto al logo`,
            r.chipsInHeader && chips.some((c) => c.startsWith(s.current) && c.includes('EN JUEGO')), chips.join(' | '));
        } else {
          T.check(`${tag}: sets terminados arriba (sin «en juego»)`, r.chipsInHeader && !chips.some((c) => c.includes('EN JUEGO')), chips.join(' | '));
        }
        if (s.badge) T.check(`${tag}: indicador «${s.badge}»`, r.badge.includes(s.badge), r.badge);
        T.check(`${tag}: nada se sale de la caja ni se solapa con el logo`, r.overflow.length === 0, r.overflow.join(', '));
        T.check(`${tag}: los nombres caben`, r.namesFit, r.names);
        T.check(`${tag}: cinta ${Math.round(f.ribbon * 100)} % del alto`, Math.abs(r.ribbonRatio - f.ribbon) < 0.012, (r.ribbonRatio * 100).toFixed(1) + ' %');
        await page.screenshot({ path: path.join(OUT, `${f.name}-${s.name}.png`) });
        if (s.summary) {
          // Después, las estadísticas (se alternan con el marcador; aquí sin esperar los 10 s)
          await page.evaluate(() => window.dispatchEvent(new CustomEvent('stagemaster:fase-final', { detail: 'stats' })));
          await page.waitForSelector('#d-summary:not(.hidden)');
          await H.sleep(900);
          const q = await page.evaluate(measure);
          T.check(`${tag}: las estadísticas sustituyen al marcador`, q.summary.shown, q.summary.detail);
          T.check(`${tag}: las estadísticas caben (nada se recorta ni se solapa)`, q.summary.fits && q.overflow.length === 0, q.summary.detail + ' ' + q.overflow.join(', '));
          T.check(`${tag}: estadísticas legibles (datos a ${f.h <= 220 ? 14 : 18} px o más)`, q.summary.minLabel >= (f.h <= 220 ? 14 : 18), q.summary.minLabel + ' px');
          T.check(`${tag}: nombres de las estadísticas caben`, q.namesFit, q.names);
          await page.screenshot({ path: path.join(OUT, `${f.name}-${s.name}-estadisticas.png`) });
        }
      }
    }
    T.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  } catch (err) {
    T.check('La prueba se completa sin excepciones', false, err.message.split('\n')[0]);
  } finally {
    const failed = T.report();
    await browser.close(); st.close(); await srv.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });

/** Lleva el partido al estado pedido */
async function prepare(st, s) {
  const long = s.name === 'supertb';
  await st.setup('pista-1', H.config(long
    // Nombres al máximo permitido (24 caracteres por jugador)
    ? { nameA: 'Maximiliano Fernández C / Juan Sebastián Lebrón', nameB: 'Federico Chingotto Ruiz / Agustín Tapia Fernández', scoringSystem: 'goldenPoint' }
    : {}));
  const game = async (side) => { for (let i = 0; i < 4; i++) await st.act('pista-1', side === 'A' ? 'pointA' : 'pointB'); };
  for (let set = 0; set < (s.done || 0); set++) {
    // Sets alternos (6-0 para A, 0-6 para B) → súper tie-break en el tercero
    for (let g = 0; g < 6; g++) await game(set % 2 === 0 || s.winner ? 'A' : 'B');
  }
  if (s.winner) return;   // 2-0: el partido termina solo
  if (s.name === 'final') {
    await st.act('pista-1', 'finishMatch');
    return;
  }
  await st.act('pista-1', 'pointA');
  if (long) for (let i = 0; i < 3; i++) { await st.act('pista-1', 'pointB'); await st.act('pista-1', 'pointA'); }
  if (s.name === 'pausa') await st.act('pista-1', 'pause');
}

/** Se ejecuta en la página: posiciones y tamaños reales */
function measure() {
  const box = document.getElementById('output').getBoundingClientRect();
  const header = document.querySelector('.d-header').getBoundingClientRect();
  const logo = document.querySelector('.d-logo').getBoundingClientRect();
  const chips = [...document.querySelectorAll('.d-set-chip')].filter((c) => getComputedStyle(c).display !== 'none' && c.offsetWidth > 0)
    .map((c) => ({ text: c.textContent.replace(/\s+/g, ' ').trim(), rect: c.getBoundingClientRect() }));
  const overflow = [];
  const inside = (r, outer) => r.left >= outer.left - 1 && r.right <= outer.right + 1 && r.top >= outer.top - 1 && r.bottom <= outer.bottom + 1;
  ['.d-logo', '#d-court', '#d-badge', '#row-a', '#row-b', '#d-ribbon', '#d-summary'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.classList.contains('hidden') || !el.offsetWidth) return;
    if (!inside(el.getBoundingClientRect(), box)) overflow.push(sel);
  });
  chips.forEach((c) => {
    if (!inside(c.rect, header)) overflow.push('chip fuera de la cabecera: ' + c.text);
    if (c.rect.left < logo.right - 1) overflow.push('chip encima del logo: ' + c.text);
  });
  const right = document.querySelector('.d-header-right').getBoundingClientRect();
  chips.forEach((c) => { if (c.rect.right > right.left + 1) overflow.push('chip encima de la pista: ' + c.text); });
  const summaryEl = document.getElementById('d-summary');
  const summaryShown = !summaryEl.classList.contains('hidden');
  const visible = (el) => getComputedStyle(el).display !== 'none' && el.offsetWidth > 0;
  // Con el resumen, los nombres son los del resumen; si no, los del marcador
  const names = summaryShown ? [...document.querySelectorAll('.sum-name')] : [...document.querySelectorAll('.d-name-line')];
  let summary = { shown: false, fits: true, detail: '' };
  if (summaryShown) {
    const parts = [...summaryEl.querySelectorAll('.sum-team, .sum-row, .sum-title, .sum-foot')].filter(visible);
    const stage = document.getElementById('d-stage').getBoundingClientRect();
    const p = summaryEl.getBoundingClientRect();
    const out = parts.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < p.top - 1 || r.bottom > p.bottom + 1 || r.left < p.left - 1 || r.right > p.right + 1;
    }).map((el) => el.className);
    if (p.top < stage.top - 1 || p.bottom > stage.bottom + 1) out.push('d-summary fuera de la zona del marcador');
    const rows = [...summaryEl.querySelectorAll('.sum-row')].filter(visible);
    const labels = [...summaryEl.querySelectorAll('.sum-label')].filter(visible).map((el) => parseFloat(getComputedStyle(el).fontSize));
    summary = {
      shown: document.getElementById('d-board').classList.contains('hidden'),
      fits: out.length === 0,
      minLabel: labels.length ? Math.min(...labels) : 0,
      detail: `${rows.length} estadísticas · ${out.join(', ') || 'todo dentro'}`,
    };
  }
  const ribbon = document.getElementById('d-ribbon');
  return {
    chips: chips.map((c) => ({ text: c.text })),
    chipsInHeader: chips.length > 0 && chips.every((c) => c.rect.top >= header.top - 1 && c.rect.bottom <= header.bottom + 1),
    badge: document.getElementById('d-badge').classList.contains('hidden') ? '' : document.getElementById('d-badge').textContent,
    overflow,
    namesFit: names.every((n) => n.scrollWidth <= n.clientWidth + 1),
    names: names.map((n) => `${n.textContent} (${n.scrollWidth}/${n.clientWidth})`).join(' · '),
    summary,
    ribbonRatio: ribbon.classList.contains('hidden') ? 0 : ribbon.getBoundingClientRect().height / box.height,
  };
}
