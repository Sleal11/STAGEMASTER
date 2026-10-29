'use strict';

/**
 * ads.js — Biblioteca de publicidad (imágenes y vídeos)
 *
 * La publicidad son archivos que el operador copia en la carpeta de
 * publicidad (no hace falta Internet ni subir nada):
 *
 *   banner/             Cinta publicitaria del marcador: imágenes o logos
 *                       (recomendado 1920×200 px, PNG)
 *   pantalla-completa/  Lista de reproducción a pantalla completa: imágenes
 *                       y VÍDEOS (MP4 H.264 recomendado; también WEBM)
 *
 * Este módulo solo LISTA los archivos y construye sus URL; los sirve Express
 * en /publicidad (ver index.js), con soporte de rangos para que los vídeos
 * grandes se reproduzcan sin cargarlos enteros. Se lee la carpeta en cada
 * consulta: basta con copiar un archivo y pulsar "Actualizar" en la estación.
 */

const fs   = require('fs');
const path = require('path');

/** Carpeta de publicidad (configurable para las pruebas) */
function adsDir() {
  return process.env.STAGEMASTER_ADS_DIR || path.join(__dirname, '..', '..', 'publicidad');
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.webm'];

/** Categoría → subcarpeta y tipos de archivo que admite */
const CATEGORIES = {
  banner:     { folder: 'banner',            kinds: ['image'] },
  fullscreen: { folder: 'pantalla-completa', kinds: ['image', 'video'] },
};

function kindOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  return null;
}

/** Lista los archivos válidos de una categoría, ordenados por nombre */
function listCategory(category) {
  const { folder, kinds } = CATEGORIES[category];
  let names = [];
  try {
    names = fs.readdirSync(path.join(adsDir(), folder), { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  } catch (_) {
    return [];   // La carpeta no existe: simplemente no hay publicidad
  }

  return names
    .filter((name) => kinds.includes(kindOf(name)))
    .map((name) => ({ name, kind: kindOf(name), url: `/publicidad/${folder}/${encodeURIComponent(name)}` }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Biblioteca completa: { banner: [...], fullscreen: [...] } */
function listAds() {
  return { banner: listCategory('banner'), fullscreen: listCategory('fullscreen') };
}

/**
 * Convierte los nombres elegidos en elementos con URL, en el orden elegido.
 * Si un archivo se borró de la carpeta, se omite y se informa en `missing`.
 *
 * @param {'banner'|'fullscreen'} category
 * @param {string[]} names
 * @param {Object}  [library] - listAds() ya leída (evita leer la carpeta dos veces)
 */
function resolve(category, names, library = listAds()) {
  const result = { items: [], missing: [] };
  names.forEach((name) => {
    const item = library[category].find((ad) => ad.name === name);
    if (item) result.items.push(item);
    else result.missing.push(`${CATEGORIES[category].folder}/${name}`);
  });
  return result;
}

module.exports = { listAds, resolve, adsDir, CATEGORIES, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS };
