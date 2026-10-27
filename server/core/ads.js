'use strict';

/**
 * ads.js — Biblioteca de publicidad
 *
 * La publicidad son archivos que el operador copia en la carpeta
 * publicidad/ del proyecto (no hace falta Internet ni subir nada):
 *
 *   banner/             Franja inferior bajo el marcador (recomendado 1920×200 px)
 *   pantalla-completa/  Pantalla completa: entre partidos o en modo "Solo
 *                       publicidad" (recomendado 1920×1080 px)
 *
 * Formato: imágenes PNG (también se aceptan JPG y WEBP). No se usan vídeos:
 * el cliente trabaja con PNG y así el sistema es más simple y fiable.
 *
 * Este módulo solo LISTA los archivos y construye sus URL; los sirve Express
 * en /publicidad (ver index.js). Se lee la carpeta en cada consulta, así que
 * basta con copiar un archivo y pulsar "Actualizar" en la estación.
 */

const fs   = require('fs');
const path = require('path');

/** Carpeta de publicidad (configurable para las pruebas) */
function adsDir() {
  return process.env.STAGEMASTER_ADS_DIR || path.join(__dirname, '..', '..', 'publicidad');
}

/** Categoría → subcarpeta */
const CATEGORIES = {
  banner:     'banner',
  fullscreen: 'pantalla-completa',
};

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

/** Lista los archivos válidos de una categoría, ordenados por nombre */
function listCategory(category) {
  const folder = path.join(adsDir(), CATEGORIES[category]);
  let names = [];
  try {
    names = fs.readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith('.'));
  } catch (_) {
    return [];   // La carpeta no existe: simplemente no hay publicidad
  }

  return names
    .map((name) => {
      const ext = path.extname(name).toLowerCase();
      return IMAGE_EXTENSIONS.includes(ext) && {
        name,
        kind: 'image',
        url: `/publicidad/${CATEGORIES[category]}/${encodeURIComponent(name)}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Biblioteca completa: { banner: [...], fullscreen: [...] } */
function listAds() {
  return {
    banner:     listCategory('banner'),
    fullscreen: listCategory('fullscreen'),
  };
}

/**
 * Convierte los nombres elegidos para una pantalla en elementos con URL.
 * Si un archivo se borró de la carpeta, se omite (y se informa en missing).
 *
 * @param {{ banner: string[], fullscreen: string[] }} selection
 */
function resolveSelection(selection) {
  const library = listAds();
  const result  = { banner: [], fullscreen: [], missing: [] };

  Object.keys(CATEGORIES).forEach((category) => {
    (selection[category] || []).forEach((name) => {
      const item = library[category].find((ad) => ad.name === name);
      if (item) result[category].push(item);
      else result.missing.push(`${CATEGORIES[category]}/${name}`);
    });
  });
  return result;
}

module.exports = { listAds, resolveSelection, adsDir, CATEGORIES };
