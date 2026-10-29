/**
 * uploads.js — Subir y borrar publicidad desde la estación
 *
 *   - Botón "Subir archivos…" o arrastrar archivos sobre la lista de la
 *     pestaña Cinta (carpeta banner) o Lista de reproducción (pantalla-completa)
 *   - Barra de progreso (los vídeos pueden pesar cientos de MB)
 *   - Al terminar, los archivos subidos quedan MARCADOS en esa pantalla
 *   - Borrar un archivo de la carpeta (con confirmación)
 *
 * Los archivos se envían a server/http/adsApi.js, que solo acepta peticiones
 * del propio portátil.
 */

import { send, toast, findScreen } from './context.js';
import { confirmDialog } from './dialogs.js';

const CATEGORY_LABELS = { banner: 'la cinta', fullscreen: 'la lista de reproducción' };
const SELECTION_KEY   = { banner: 'ribbon', fullscreen: 'media' };

const $ = (id) => document.getElementById(id);
let target = null;   // { category, screenId } del botón "Subir archivos…" pulsado

/** Abre el selector de archivos del sistema */
export function pickFiles(category, screenId) {
  target = { category, screenId };
  $('st-file').value = '';
  $('st-file').click();
}

/** Sube uno a uno y marca los subidos en la pantalla */
async function uploadFiles(files, category, screenId) {
  const list = [...files];
  if (!list.length) return;
  const added = [];
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    try {
      const res = await uploadOne(file, category, (fraction) => showProgress(file.name, fraction, i, list.length));
      added.push(res.name);
    } catch (err) {
      toast(err.message, true);
    }
  }
  hideProgress();
  if (!added.length) return;

  const screen = findScreen(screenId);
  const key = SELECTION_KEY[category];
  const res = await send('station:updateScreen', {
    screenId, changes: { [key]: { items: screen[key].items.concat(added) } },
  });
  if (res.ok) {
    toast(`${added.length === 1 ? `"${added[0]}" añadido` : `${added.length} archivos añadidos`} a ${CATEGORY_LABELS[category]} de ${screen.label}`);
  }
}

function uploadOne(file, category, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/publicidad/${category}`);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch (_) { /* respuesta vacía */ }
      if (xhr.status === 200 && body.ok) resolve(body);
      else reject(new Error(body.message || `No se pudo subir "${file.name}"`));
    };
    xhr.onerror = () => reject(new Error(`No se pudo subir "${file.name}": sin conexión con el servidor`));
    onProgress(0);
    xhr.send(file);
  });
}

function showProgress(name, fraction, index, total) {
  const box = $('st-upload');
  box.classList.remove('hidden');
  box.querySelector('[data-part="name"]').textContent =
    `Subiendo ${total > 1 ? `${index + 1} de ${total}: ` : ''}${name}`;
  box.querySelector('[data-part="percent"]').textContent = Math.round(fraction * 100) + ' %';
  box.querySelector('[data-part="bar"]').style.width = (fraction * 100) + '%';
}

function hideProgress() {
  $('st-upload').classList.add('hidden');
}

/** Borra un archivo de la carpeta de publicidad (se quita de todas las pantallas) */
export function deleteAd(category, name) {
  confirmDialog('Borrar archivo', `Se borrará "${name}" de la carpeta de publicidad y dejará de verse en todas las pantallas.`, 'Borrar')
    .then(async (ok) => {
      if (!ok) return;
      try {
        const res = await fetch(`/api/publicidad/${category}/${encodeURIComponent(name)}`, { method: 'DELETE' });
        const body = await res.json();
        if (!body.ok) throw new Error(body.message);
        toast(`"${name}" borrado`);
      } catch (err) {
        toast(err.message || 'No se pudo borrar el archivo', true);
      }
    });
}

export function initUploads() {
  $('st-file').addEventListener('change', (event) => {
    if (target) uploadFiles(event.target.files, target.category, target.screenId);
  });

  // Arrastrar archivos sobre una lista de publicidad
  const zoneOf = (event) => event.target.closest && event.target.closest('.dropzone');
  document.addEventListener('dragover', (event) => {
    event.preventDefault();   // fuera de una lista, soltar no hace nada (la app nunca abre el archivo)
    const zone = zoneOf(event);
    event.dataTransfer.dropEffect = zone ? 'copy' : 'none';
    document.querySelectorAll('.dropzone.is-over').forEach((z) => { if (z !== zone) z.classList.remove('is-over'); });
    if (zone) zone.classList.add('is-over');
  });
  document.addEventListener('dragleave', (event) => {
    const zone = zoneOf(event);
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('is-over');
  });
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    const zone = zoneOf(event);
    document.querySelectorAll('.dropzone.is-over').forEach((z) => z.classList.remove('is-over'));
    if (zone && event.dataTransfer.files.length) {
      uploadFiles(event.dataTransfer.files, zone.dataset.category, zone.dataset.screen);
    }
  });
}
