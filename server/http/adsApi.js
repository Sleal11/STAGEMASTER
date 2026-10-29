'use strict';

/**
 * adsApi.js — Subir y borrar publicidad desde la estación
 *
 *   POST   /api/publicidad/:category          Sube un archivo (cuerpo = el archivo;
 *                                            cabecera X-File-Name = su nombre, codificado)
 *   DELETE /api/publicidad/:category/:name    Borra un archivo de la carpeta
 *
 *   :category = banner (cinta) | fullscreen (lista de reproducción)
 *
 * Solo desde el propio portátil (igual que la estación): un teléfono de la red
 * no puede subir ni borrar nada. El archivo se escribe primero con otro nombre
 * y se renombra al terminar: un archivo a medias nunca aparece en la
 * biblioteca. Nunca se pisa un archivo existente ("promo (2).png").
 */

const fs      = require('fs');
const path    = require('path');
const express = require('express');

const ads                = require('../core/ads');
const { isLocalAddress } = require('../core/auth');

/** Tamaño máximo de un archivo (vídeos largos en alta calidad caben de sobra) */
const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;

/**
 * @param {Object}   hooks
 * @param {Function} hooks.onChange  - La biblioteca cambió (refrescar pantallas y estación)
 * @param {Function} hooks.onRemoved - (category, name) Un archivo se borró (quitarlo de las pantallas)
 */
function createAdsRouter({ onChange, onRemoved }) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (isLocalAddress(req.ip)) return next();
    res.status(403).json({ ok: false, message: 'Solo la estación operadora (en el portátil) puede cambiar la publicidad' });
  });

  router.post('/:category', (req, res) => {
    const { category } = req.params;
    const fail = (status, message) => { if (!res.headersSent) res.status(status).json({ ok: false, message }); };

    if (!ads.CATEGORIES[category]) return fail(404, 'Categoría de publicidad desconocida');
    let rawName = '';
    try { rawName = decodeURIComponent(req.get('X-File-Name') || ''); } catch (_) { /* nombre ilegible */ }
    const safe = ads.safeFileName(category, rawName);
    if (!safe) {
      return fail(415, `"${rawName || 'archivo'}" no es compatible: usa imágenes PNG, JPG o WEBP y vídeos MP4 (H.264) o WEBM`);
    }
    if (Number(req.get('Content-Length')) > MAX_UPLOAD_BYTES) return fail(413, 'El archivo es demasiado grande (máximo 2 GB)');

    const folder = ads.folderOf(category);
    fs.mkdirSync(folder, { recursive: true });
    const name = ads.uniqueFileName(category, safe);
    const finalPath = path.join(folder, name);
    const tempPath  = path.join(folder, `.${name}.${process.pid}.subiendo`);
    const out = fs.createWriteStream(tempPath);
    let bytes = 0;
    let failed = false;

    // Error: se cierra y se borra el archivo a medias ANTES de responder
    const abort = (status, message) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      const cleanup = () => fs.rm(tempPath, { force: true }, () => {
        // No seguir recibiendo un archivo rechazado (p. ej. de más de 2 GB)
        if (!req.complete) res.on('finish', () => req.destroy());
        fail(status, message);
      });
      if (out.closed) cleanup();
      else { out.once('close', cleanup); out.destroy(); }
    };

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD_BYTES) abort(413, 'El archivo es demasiado grande (máximo 2 GB)');
    });
    req.on('close', () => { if (!req.complete) abort(400, 'La subida se interrumpió'); });
    out.on('error', (err) => abort(500, 'No se pudo guardar el archivo: ' + err.message));
    out.on('finish', () => {
      if (failed) return;
      if (bytes === 0) { abort(400, 'El archivo está vacío'); return; }
      fs.rename(tempPath, finalPath, (err) => {
        if (err) { abort(500, 'No se pudo guardar el archivo: ' + err.message); return; }
        console.log(`[Publicidad] Subido ${ads.CATEGORIES[category].folder}/${name} (${Math.round(bytes / 1024)} KB)`);
        onChange();
        res.json({ ok: true, name, kind: ads.kindOf(name) });
      });
    });
    req.pipe(out);
  });

  router.delete('/:category/:name', (req, res) => {
    const { category, name } = req.params;
    const file = ads.existingFile(category, name);
    if (!file) return res.status(404).json({ ok: false, message: 'Ese archivo ya no está en la carpeta' });
    fs.rm(file, { force: true }, (err) => {
      if (err) return res.status(500).json({ ok: false, message: 'No se pudo borrar: ' + err.message });
      console.log(`[Publicidad] Borrado ${ads.CATEGORIES[category].folder}/${name}`);
      onRemoved(category, name);
      onChange();
      res.json({ ok: true });
    });
  });

  return router;
}

module.exports = { createAdsRouter, MAX_UPLOAD_BYTES };
