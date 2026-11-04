'use strict';

/**
 * generar.js — Vuelve a crear los vídeos de marketing/videos-led/ a partir de promo.html
 *
 *   node marketing/videos-led/fuente/generar.js
 *
 * Requisitos: Playwright con Chromium y ffmpeg en el PATH.
 * promo.html es una animación de 15 s (función render(t)): se captura
 * fotograma a fotograma (30 fps) y ffmpeg la codifica en MP4 H.264 sin sonido.
 */

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const FPS = 30, SECONDS = 15;
const OUT = path.join(__dirname, '..');
const SIZES = [
  { scale: 1, file: 'StageMaster-LED-832x416.mp4', crf: '14' },
  { scale: 2, file: 'StageMaster-LED-1664x832-HD.mp4', crf: '16' },
];

(async () => {
  const browser = await chromium.launch();
  for (const { scale, file, crf } of SIZES) {
    const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-video-'));
    const page = await browser.newPage({ viewport: { width: 832, height: 416 }, deviceScaleFactor: scale });
    await page.goto('file://' + path.join(__dirname, 'promo.html'));
    await page.evaluate(() => document.fonts.ready);
    for (let i = 0; i < FPS * SECONDS; i++) {
      await page.evaluate((t) => window.render(t), i / FPS);
      await page.screenshot({ path: path.join(frames, `f${String(i).padStart(4, '0')}.png`) });
    }
    await page.close();
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.png'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-tune', 'animation', '-pix_fmt', 'yuv420p',
      '-profile:v', 'high', '-movflags', '+faststart', '-an', path.join(OUT, file)]);
    fs.rmSync(frames, { recursive: true, force: true });
    console.log('✅', file);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
