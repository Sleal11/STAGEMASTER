'use strict';

/**
 * generar.js — Crea los vídeos explicativos (MP4 1920 × 1080, 30 fps, H.264)
 *
 *   node marketing/tutoriales/fuente/capturar.js     1º capturas reales de la app
 *   node marketing/tutoriales/fuente/generar.js      2º todos los vídeos
 *   node marketing/tutoriales/fuente/generar.js resumen 2-arbitro   solo esos
 *   node marketing/tutoriales/fuente/generar.js --revisar resumen   fotogramas
 *        sueltos (cada 1,5 s) en una hoja de contacto, para revisar sin renderizar
 *
 * Requisitos: Playwright con Chromium y ffmpeg en el PATH. Sin sonido: si se
 * quiere música, se añade después en el editor de vídeo.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const FPS = 30;
const DIR = __dirname;
const OUT = path.join(DIR, '..');
const ROOT = path.join(DIR, '..', '..', '..');
const NAMES = {
  resumen: 'StageMaster-resumen-90s.mp4',
  '1-estacion': 'StageMaster-tutorial-1-estacion.mp4',
  '2-arbitro': 'StageMaster-tutorial-2-arbitro.mp4',
  '3-pantallas': 'StageMaster-tutorial-3-pantallas-y-publicidad.mp4',
  '4-avanzado': 'StageMaster-tutorial-4-varias-pantallas-y-remoto.mp4',
};

async function openVideo(browser, id) {
  const zones = JSON.parse(fs.readFileSync(path.join(DIR, 'capturas', 'zonas.json'), 'utf8'));
  const icons = fs.readFileSync(path.join(ROOT, 'public', 'img', 'icons.svg'), 'utf8');
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(([z, i]) => { window.ZONES = z; window.ICONS = i; }, [zones, icons]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(DIR, 'video.html') + '?id=' + encodeURIComponent(id));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })))));
  if (errors.length) throw new Error(`${id}: ${errors.join(' | ')}`);
  return page;
}

async function review(browser, id) {
  const page = await openVideo(browser, id);
  const total = await page.evaluate(() => window.DURATION);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-revisar-'));
  const times = [];
  for (let t = 1.2; t < total; t += 1.5) times.push(Math.round(t * 10) / 10);
  for (const [i, t] of times.entries()) {
    await page.evaluate((x) => window.render(x), t);
    await page.screenshot({ path: path.join(dir, `k${String(i).padStart(3, '0')}.png`) });
  }
  const sheet = path.join(OUT, `revisar-${id}.png`);
  const cols = 4;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'k%03d.png'), '-vf',
    `scale=480:270,tile=${cols}x${Math.ceil(times.length / cols)}:padding=6`, '-frames:v', '1', sheet]);
  fs.rmSync(dir, { recursive: true, force: true });
  await page.close();
  console.log(`🔎 ${id}: ${total.toFixed(1)} s → ${sheet}`);
}

async function render(browser, id) {
  const page = await openVideo(browser, id);
  const total = await page.evaluate(() => window.DURATION);
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-video-'));
  const count = Math.round(total * FPS);
  for (let i = 0; i < count; i++) {
    await page.evaluate((t) => window.render(t), i / FPS);
    await page.screenshot({ path: path.join(frames, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
  }
  await page.close();
  const file = path.join(OUT, NAMES[id]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frames, 'f%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-movflags', '+faststart', '-an', file]);
  fs.rmSync(frames, { recursive: true, force: true });
  console.log(`✅ ${NAMES[id]} (${total.toFixed(1)} s, ${Math.round(fs.statSync(file).size / 1024 / 1024 * 10) / 10} MB)`);
}

(async () => {
  const args = process.argv.slice(2);
  const reviewOnly = args.includes('--revisar');
  const ids = args.filter((a) => !a.startsWith('--'));
  const list = ids.length ? ids : Object.keys(NAMES);
  const browser = await chromium.launch();
  try {
    for (const id of list) {
      if (!NAMES[id]) throw new Error('Vídeo desconocido: ' + id);
      await (reviewOnly ? review(browser, id) : render(browser, id));
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
