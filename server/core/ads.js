'use strict';

/**
 * ads.js — Biblioteca de publicidad (imágenes y vídeos)
 *
 * La publicidad son archivos de la carpeta de publicidad. Se añaden desde la
 * estación ("Subir archivos", ver server/http/adsApi.js) o copiándolos a mano
 * (botón "Carpeta de publicidad"); no hace falta Internet.
 *
 *   banner/             Cinta publicitaria del marcador: imágenes, logos y
 *                       vídeos cortos (sin sonido)
 *   pantalla-completa/  Lista de reproducción a pantalla completa: imágenes
 *                       y vídeos (MP4 H.264 recomendado; también WEBM)
 *
 * Este módulo lista los archivos, construye sus URL (los sirve Express en
 * /publicidad, con soporte de rangos para los vídeos) y decide qué nombres de
 * archivo son válidos. Se lee la carpeta en cada consulta.
 */

const fs   = require('fs');
const path = require('path');

/** Carpeta de publicidad (configurable para las pruebas) */
function adsDir() {
  return process.env.STAGEMASTER_ADS_DIR || path.join(__dirname, '..', '..', 'publicidad');
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.webm'];

/** Categoría → subcarpeta y tipos de archivo que admite */
const CATEGORIES = {
  banner:     { folder: 'banner',            kinds: ['image', 'video'] },
  fullscreen: { folder: 'pantalla-completa', kinds: ['image', 'video'] },
};

const MAX_NAME_LENGTH = 120;

function kindOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  return null;
}

function folderOf(category) {
  return path.join(adsDir(), CATEGORIES[category].folder);
}

/** Lista los archivos válidos de una categoría, ordenados por nombre */
function listCategory(category) {
  const { folder, kinds } = CATEGORIES[category];
  let names = [];
  try {
    names = fs.readdirSync(folderOf(category), { withFileTypes: true })
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

// ─────────────────────────────────────────────────────────────────
// ARCHIVOS SUBIDOS DESDE LA ESTACIÓN
// ─────────────────────────────────────────────────────────────────

/**
 * Nombre de archivo seguro a partir del que envía el navegador:
 * sin carpetas (nada de "../"), sin caracteres prohibidos en Windows, sin
 * empezar por punto y con una extensión admitida en esa categoría.
 * @returns {string|null} null si el archivo no es válido
 */
function safeFileName(category, rawName) {
  if (!CATEGORIES[category] || typeof rawName !== 'string') return null;
  let name = path.basename(rawName.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();
  const ext = path.extname(name);
  if (!ext || !CATEGORIES[category].kinds.includes(kindOf(name))) return null;
  // Nombre demasiado largo: se acorta conservando la extensión
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH - ext.length).trim() + ext;
  const base = name.slice(0, -ext.length);
  return base ? base + ext : null;
}

/** "promo.png" → "promo (2).png" si ya existe (nunca se pisa un archivo) */
function uniqueFileName(category, name) {
  const folder = folderOf(category);
  const ext = path.extname(name);
  const base = name.slice(0, -ext.length);
  let candidate = name;
  for (let n = 2; fs.existsSync(path.join(folder, candidate)); n++) candidate = `${base} (${n})${ext}`;
  return candidate;
}

/** Ruta en disco de un archivo de la biblioteca (o null si no existe en ella) */
function existingFile(category, name) {
  if (!CATEGORIES[category]) return null;
  const item = listCategory(category).find((ad) => ad.name === name);
  return item ? path.join(folderOf(category), item.name) : null;
}

module.exports = {
  listAds, resolve, adsDir, folderOf, kindOf, safeFileName, uniqueFileName, existingFile,
  CATEGORIES, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS,
};
