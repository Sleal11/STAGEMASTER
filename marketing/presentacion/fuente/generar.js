'use strict';

/**
 * generar.js — Crea los DOS vídeos de presentación (MP4 1920 × 1080, 30 fps, H.264 + AAC)
 *
 *   1. node marketing/presentacion/fuente/capturar.js            capturas reales de la app
 *   2. python3 marketing/presentacion/fuente/voz.py <piper> <voz.onnx>   narración por escena
 *   3. node marketing/presentacion/fuente/generar.js             música, imagen y mezcla
 *      node marketing/presentacion/fuente/generar.js --revisar   hoja de fotogramas (sin renderizar)
 *
 * Resultado (en marketing/presentacion/):
 *   StageMaster-Score-Padel-con-voz.mp4      narración + música de fondo suave
 *   StageMaster-Score-Padel-con-musica.mp4   música deportiva, sin voz (los rótulos lo explican)
 *
 * Requisitos: Playwright con Chromium, ffmpeg y Python 3 con numpy y scipy
 * (variable PYTHON si no es «python3»).
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const FPS = 30;
const DIR = __dirname;
const OUT = path.join(DIR, '..');
const AUDIO = path.join(DIR, 'audio');
const PY = process.env.PYTHON || 'python3';
const FILES = { voz: 'StageMaster-Score-Padel-con-voz.mp4', musica: 'StageMaster-Score-Padel-con-musica.mp4' };

async function openVideo(browser) {
  const zones = JSON.parse(fs.readFileSync(path.join(DIR, 'capturas', 'zonas.json'), 'utf8'));
  const icons = fs.readFileSync(path.join(DIR, '..', '..', '..', 'public', 'img', 'icons.svg'), 'utf8');
  const durFile = path.join(AUDIO, 'duraciones.json');
  const voice = fs.existsSync(durFile) ? JSON.parse(fs.readFileSync(durFile, 'utf8')) : {};
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(([z, i, v]) => { window.ZONES = z; window.ICONS = i; window.VOICE = v; }, [zones, icons, voice]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(DIR, 'presentacion.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })))));
  if (errors.length) throw new Error(errors.join(' | '));
  return page;
}

async function review(browser) {
  const page = await openVideo(browser);
  const total = await page.evaluate(() => window.DURATION);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-revisar-'));
  const times = [];
  for (let t = 1; t < total; t += 2) times.push(Math.round(t * 10) / 10);
  for (const [i, t] of times.entries()) {
    await page.evaluate((x) => window.render(x), t);
    await page.screenshot({ path: path.join(dir, `k${String(i).padStart(3, '0')}.png`) });
  }
  const sheet = path.join(OUT, 'revisar-presentacion.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'k%03d.png'), '-vf',
    `scale=384:216,tile=6x${Math.ceil(times.length / 6)}:padding=4`, '-frames:v', '1', sheet]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`🔎 ${total.toFixed(1)} s → ${sheet}`);
}

async function render(browser) {
  const page = await openVideo(browser);
  const total = await page.evaluate(() => window.DURATION);
  const timeline = await page.evaluate(() => window.TIMELINE);
  fs.mkdirSync(AUDIO, { recursive: true });
  fs.writeFileSync(path.join(AUDIO, 'linea.json'), JSON.stringify(timeline, null, 2));

  // Música a la medida de la línea de tiempo
  execFileSync(PY, [path.join(DIR, 'musica.py'), path.join(AUDIO, 'linea.json'), path.join(AUDIO, 'musica.wav')], { stdio: 'inherit' });

  // Imagen
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-presentacion-'));
  const count = Math.round(total * FPS);
  for (let i = 0; i < count; i++) {
    await page.evaluate((t) => window.render(t), i / FPS);
    await page.screenshot({ path: path.join(frames, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94 });
    if (i % 300 === 0) console.log(`  fotograma ${i}/${count}`);
  }
  await page.close();
  const silent = path.join(frames, 'imagen.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frames, 'f%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-profile:v', 'high', silent]);

  // Voz: cada escena en su sitio
  const voiceScenes = timeline.escenas.filter((s) => fs.existsSync(path.join(AUDIO, `escena-${s.id}.wav`)));
  const voiceInputs = voiceScenes.flatMap((s) => ['-i', path.join(AUDIO, `escena-${s.id}.wav`)]);
  const delays = voiceScenes.map((s, i) => `[${i}:a]aresample=48000,adelay=${Math.round(s.voiceAt * 1000)}:all=1[v${i}]`).join(';');
  const voiceTrack = path.join(frames, 'voz.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...voiceInputs, '-filter_complex',
    `${delays};${voiceScenes.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voiceScenes.length}:normalize=0,apad=whole_dur=${total + 2.5}[out]`,
    '-map', '[out]', '-ac', '1', voiceTrack]);

  const music = path.join(AUDIO, 'musica.wav');
  const video = (name) => path.join(OUT, FILES[name]);
  const common = ['-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart'];

  // A · Con voz: música de fondo suave que además baja cuando habla la voz
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', silent, '-i', voiceTrack, '-i', music, '-filter_complex',
    '[1:a]aformat=channel_layouts=stereo,asplit=2[voz][key];' +
    '[2:a]volume=0.22[mus];[mus][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[musd];' +
    '[voz][musd]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9[a]',
    ...common, video('voz')]);
  // B · Con música: la pista deportiva a pleno volumen
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', silent, '-i', music, '-filter_complex',
    '[1:a]loudnorm=I=-14:TP=-1.5:LRA=9[a]', ...common.map((x) => x), video('musica')].map((x) => x));

  fs.rmSync(frames, { recursive: true, force: true });
  for (const name of Object.keys(FILES)) {
    console.log(`✅ ${FILES[name]} (${total.toFixed(1)} s, ${Math.round(fs.statSync(video(name)).size / 1024 / 1024 * 10) / 10} MB)`);
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    await (process.argv.includes('--revisar') ? review(browser) : render(browser));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
