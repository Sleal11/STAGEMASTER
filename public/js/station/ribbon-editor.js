/**
 * ribbon-editor.js — «Orden, tamaño y realce de los logos» (pestaña Cinta de cada pantalla)
 *
 *   - Vista previa con el aspecto REAL de la cinta de esa pantalla: mismos
 *     logos limpios y realzados (logo-cleaner.js), misma proporción de cinta y
 *     mismo cálculo de tamaños y grupos que la pantalla (common/ribbon-layout.js).
 *   - Como en Word: un clic en un logo de la vista previa lo selecciona (recuadro
 *     con tiradores en las esquinas); arrastrar un tirador lo agranda o achica.
 *   - Lista de los archivos de la cinta en su orden: arrastrar para mover
 *     (o las flechas), el tamaño de cada logo (50-200 %, 100 % = automático)
 *     y su «Realce» (automático, sin realce, definir, contorno o los dos).
 *
 * Los cambios se envían como cualquier ajuste de pantalla (screens.js:
 * logoMove, logoSize, logoReset, logoEffect; arrastrar → items; tiradores → sizes).
 */

import { esc, icon } from '../common/ui.js';
import { ctx } from './context.js';
import { cleanLogo, LOGO_EFFECTS } from '../display/logo-cleaner.js';
import { logoHeight, paginate, LOGO_GAP, LOGO_SIZE } from '../common/ribbon-layout.js';

const MAX_PREVIEW_TURNS = 8;   // «Cambia cada cierto tiempo»: se muestran los primeros turnos
const aspects = new Map();     // url → proporción del logo limpio (o null si falla)
let selected = null;           // { screenId, name }: logo seleccionado en la vista previa

/** Nombre visible de cada realce (logo-cleaner.js: LOGO_EFFECTS) */
const EFFECT_LABELS = {
  auto:    'Automático',
  none:    'Sin realce',
  define:  'Definir (aclara lo que no se ve)',
  outline: 'Contorno blanco',
  both:    'Definir + contorno',
};
const effectOf = (screen, name) => (screen.ribbon.effects && screen.ribbon.effects[name]) || 'auto';

/** Archivos de la cinta en su orden, con sus datos de la biblioteca */
function ribbonFiles(screen) {
  const library = ctx.state.ads.banner;
  return screen.ribbon.items.map((name) => library.find((ad) => ad.name === name)).filter(Boolean);
}

/** HTML del apartado (la vista previa se dibuja después: drawPreviews) */
export function editorHtml(screen, off) {
  const files = ribbonFiles(screen);
  if (!files.length) return '';
  const sizes = screen.ribbon.sizes || {};
  const rows = files.map((ad, i) => {
    const size = sizes[ad.name] || LOGO_SIZE.auto;
    const effect = effectOf(screen, ad.name);
    const isSelected = selected && selected.screenId === screen.id && selected.name === ad.name;
    return `<div class="rb-row${isSelected ? ' is-selected' : ''}" draggable="true" data-name="${esc(ad.name)}" data-screen="${screen.id}">
        <span class="rb-grip" title="Arrastra para cambiar el orden" aria-hidden="true">${icon('list')}</span>
        <span class="rb-num">${i + 1}</span>
        <span class="rb-thumb">${ad.kind === 'video' ? icon('video') : `<img src="${esc(ad.url)}" alt="" loading="lazy">`}</span>
        <span class="rb-name" title="${esc(ad.name)}">${esc(ad.name)}</span>
        <span class="rb-move">
          <button type="button" class="icon-btn rb-up" data-action="logoMove" data-dir="-1" data-name="${esc(ad.name)}" data-screen="${screen.id}"
            title="Antes" aria-label="Mover ${esc(ad.name)} antes"${i === 0 ? ' disabled' : ''}>${icon('chevron')}</button>
          <button type="button" class="icon-btn" data-action="logoMove" data-dir="1" data-name="${esc(ad.name)}" data-screen="${screen.id}"
            title="Después" aria-label="Mover ${esc(ad.name)} después"${i === files.length - 1 ? ' disabled' : ''}>${icon('chevron')}</button>
        </span>
        <div class="rb-tools">
        <label class="rb-size"><span class="sr-only">Tamaño de ${esc(ad.name)}</span>
          <input type="range" class="range" min="${LOGO_SIZE.min}" max="${LOGO_SIZE.max}" step="${LOGO_SIZE.step}" value="${size}"
            data-action="logoSize" data-name="${esc(ad.name)}" data-screen="${screen.id}">
          <output>${size} %</output></label>
        <button type="button" class="btn btn-ghost btn-xs" data-action="logoReset" data-name="${esc(ad.name)}" data-screen="${screen.id}"
          ${size === LOGO_SIZE.auto ? 'disabled' : ''} title="Volver al tamaño automático">Auto</button>
        ${ad.kind === 'image' ? `<label class="rb-effect"><span>Realce</span>
          <select class="input rb-select" data-action="logoEffect" data-name="${esc(ad.name)}" data-screen="${screen.id}"
            title="Para que se lea en la LED: definir aclara las partes que no se ven; el contorno pone un borde blanco">
            ${LOGO_EFFECTS.map((fx) => `<option value="${fx}"${fx === effect ? ' selected' : ''}>${EFFECT_LABELS[fx]}</option>`).join('')}
          </select></label>` : ''}
        </div>
      </div>`;
  }).join('');
  return `<section class="st-group${off ? ' is-off' : ''}"><h4 class="st-group-title">${icon('sliders')}Orden, tamaño y realce de los logos</h4>
      <p class="st-group-note">Así se verá la cinta en esta pantalla. <strong>Haz clic en un logo</strong> de la vista previa y arrastra
        sus esquinas para agrandarlo o achicarlo (como una imagen en Word). En la lista: arrastra los logos (o usa las flechas) para
        ordenarlos, ajusta el tamaño (100 % = automático) y el <strong>realce</strong> si un logo no se lee bien en la LED.</p>
      <div class="rb-preview" data-ribbon-preview="${screen.id}"></div>
      <div class="rb-list" data-ribbon-list="${screen.id}">${rows}</div>
    </section>`;
}

/** Tamaño real de la cinta de esa pantalla (ancho / alto) */
function ribbonRatio(screen) {
  const out = screen.output;
  const viewport = screen.displays[0] && screen.displays[0].viewport;
  const fixed = out.format !== 'fill';
  const w = fixed ? out.width : (viewport ? viewport.width : 1920);
  const h = fixed ? out.height : (viewport ? viewport.height : 1080);
  const fraction = screen.ribbon.height ? screen.ribbon.height / 100 : (h <= 300 ? 0.21 : 0.19);
  return w / (h * fraction);
}

function measure(url, background, effect) {
  const key = background + '|' + effect + '|' + url;
  if (aspects.has(key)) return Promise.resolve(aspects.get(key));
  return cleanLogo(url, background, effect).then((src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ src, aspect: img.naturalWidth / img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  })).then((r) => { aspects.set(key, r); return r; });
}

/**
 * Dibuja la vista previa de cada pantalla con el apartado abierto.
 * @param {Object} [override] - { screenId, name, size }: tamaño mientras se arrastra el control
 */
export function drawPreviews(override = null) {
  document.querySelectorAll('[data-ribbon-preview]').forEach((box) => {
    const screen = ctx.state.screens.find((s) => s.id === box.dataset.ribbonPreview);
    if (!screen) return;
    const files = ribbonFiles(screen).filter((ad) => ad.kind === 'image');
    const bg = screen.ribbon.background || 'dark';
    const key = JSON.stringify([files.map((f) => f.url), screen.ribbon.sizes, screen.ribbon.effects, screen.ribbon.motion,
      screen.ribbon.height, bg, screen.output, override]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    Promise.all(files.map((f) => measure(f.url, bg, effectOf(screen, f.name)))).then((measured) => {
      if (box.dataset.key !== key) return;
      // Miniaturas de la lista: también con el logo limpio, sobre el fondo de la cinta
      const list = document.querySelector(`[data-ribbon-list="${screen.id}"]`);
      if (list) {
        list.dataset.bg = bg;
        files.forEach((f, i) => {
          const row = list.querySelector(`.rb-row[data-name="${CSS.escape(f.name)}"] .rb-thumb img`);
          if (row && measured[i] && row.getAttribute('src') !== measured[i].src) row.src = measured[i].src;
        });
      }
      const W = box.clientWidth || 600;
      const H = Math.max(24, Math.round(W / ribbonRatio(screen)));
      const motion = screen.ribbon.motion;
      const logos = files.map((f, i) => measured[i] && {
        name: f.name,
        src: measured[i].src,
        aspect: measured[i].aspect,
        size: override && override.screenId === screen.id && override.name === f.name ? override.size : (screen.ribbon.sizes[f.name] || 100),
      }).filter(Boolean);
      // Cada logo con su recuadro de selección y los 4 tiradores (initRibbonResize)
      const img = (l, single) => {
        const h = Math.round(H * logoHeight(l.aspect, l.size, single));
        const isSelected = selected && selected.screenId === screen.id && selected.name === l.name;
        return { h, w: h * l.aspect, html: `<span class="rb-logo${isSelected ? ' is-selected' : ''}" data-name="${esc(l.name)}"
          data-screen="${screen.id}" data-size="${l.size}" data-aspect="${l.aspect}" data-single="${single ? 1 : 0}" data-strip="${H}"
          title="${esc(l.name)}: clic para seleccionarlo y arrastra las esquinas para cambiar su tamaño">
          <img src="${l.src}" alt="" draggable="false" style="height:${h}px">
          ${['nw', 'ne', 'sw', 'se'].map((c) => `<i class="rb-handle" data-corner="${c}"></i>`).join('')}
          <b class="rb-badge">${l.size} %</b></span>` };
      };
      const strip = (inner, cls = '') => `<div class="rb-strip ${cls}${bg === 'light' ? ' is-light' : ''}" style="height:${H}px;--h:${H}px">${inner}</div>`;
      let html;
      if (motion === 'scroll') {
        html = strip(logos.map((l) => img(l, false).html).join(''), 'is-scroll') +
          '<p class="rb-caption">Desplazamiento continuo: pasan uno detrás de otro (desliza la vista previa para ver todos).</p>';
      } else if (motion === 'fixed') {
        const sized = logos.map((l) => img(l, false));
        const pages = paginate(sized.map((s) => s.w), W - H * 0.3 - 0.05 * W, H * LOGO_GAP);
        html = pages.map((page, n) => `<div class="rb-turn"><span>${n + 1}</span>${strip(page.map((i) => sized[i].html).join(''), 'is-fixed')}</div>`).join('') +
          `<p class="rb-caption">Logos fijos: ${pages.length === 1 ? 'todos a la vez' : `${pages.length} grupos que se turnan`}. Los mensajes salen en su propio turno.</p>`;
      } else {
        html = `<div class="rb-turns">${logos.slice(0, MAX_PREVIEW_TURNS).map((l, n) =>
          `<div class="rb-turn"><span>${n + 1}</span>${strip(img(l, true).html, 'is-single')}</div>`).join('')}</div>` +
          `<p class="rb-caption">Cambia cada cierto tiempo: un logo cada vez${logos.length > MAX_PREVIEW_TURNS ? ` (se muestran los ${MAX_PREVIEW_TURNS} primeros)` : ''}.</p>`;
      }
      box.innerHTML = logos.length ? html : '<p class="rb-caption">Marca logos (imágenes) para ver aquí cómo quedan.</p>';
    });
  });
}

/** Marca el logo seleccionado en la vista previa y en la lista (null = ninguno) */
function select(next) {
  selected = next;
  document.querySelectorAll('.rb-logo.is-selected, .rb-row.is-selected').forEach((el) => el.classList.remove('is-selected'));
  if (!next) return;
  const match = `[data-screen="${next.screenId}"][data-name="${CSS.escape(next.name)}"]`;
  document.querySelectorAll(`.rb-logo${match}, .rb-row${match}`).forEach((el) => el.classList.add('is-selected'));
}

/**
 * Tamaño con el ratón, como en Word: clic en un logo de la vista previa →
 * recuadro con tiradores; arrastrar un tirador cambia el tamaño en directo
 * (la vista previa, el control de la lista y el porcentaje) y al soltar se
 * envía: onResize(screenId, name, size). Clic fuera de los logos: se deselecciona.
 */
export function initRibbonResize(container, onResize) {
  let drag = null;
  container.addEventListener('click', (e) => {
    const logo = e.target.closest('.rb-logo');
    if (logo) select({ screenId: logo.dataset.screen, name: logo.dataset.name });
    else if (e.target.closest('.rb-preview')) select(null);
  });
  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.rb-handle');
    if (!handle) return;
    e.preventDefault();
    const logo = handle.closest('.rb-logo');
    const img = logo.querySelector('img');
    select({ screenId: logo.dataset.screen, name: logo.dataset.name });
    handle.setPointerCapture(e.pointerId);
    drag = { logo, img, corner: handle.dataset.corner, x: e.clientX, y: e.clientY,
      w: img.offsetWidth, h: img.offsetHeight, start: Number(logo.dataset.size), size: Number(logo.dataset.size) };
    logo.classList.add('is-resizing');
  });
  container.addEventListener('pointermove', (e) => {
    if (!drag) return;
    // Hacia fuera del logo agranda, hacia dentro achica (en diagonal, como en Word)
    const sx = drag.corner.includes('e') ? 1 : -1;
    const sy = drag.corner.includes('s') ? 1 : -1;
    const scale = 1 + (sx * (e.clientX - drag.x) + sy * (e.clientY - drag.y)) / (drag.w + drag.h);
    const size = Math.min(LOGO_SIZE.max, Math.max(LOGO_SIZE.min, Math.round((drag.start * scale) / 5) * 5));
    if (size === drag.size) return;
    drag.size = size;
    const { logo, img } = drag;
    img.style.height = Math.round(Number(logo.dataset.strip) * logoHeight(Number(logo.dataset.aspect), size, logo.dataset.single === '1')) + 'px';
    logo.querySelector('.rb-badge').textContent = size + ' %';
    const row = document.querySelector(`.rb-row[data-screen="${logo.dataset.screen}"][data-name="${CSS.escape(logo.dataset.name)}"]`);
    if (row) {
      row.querySelector('input[data-action="logoSize"]').value = size;
      row.querySelector('output').textContent = size + ' %';
    }
  });
  const end = () => {
    if (!drag) return;
    const { logo, start, size } = drag;
    logo.classList.remove('is-resizing');
    drag = null;
    if (size !== start) onResize(logo.dataset.screen, logo.dataset.name, size);
  };
  container.addEventListener('pointerup', end);
  container.addEventListener('pointercancel', end);
}

/** Nuevo orden tras mover un archivo una posición (dir = -1 antes, 1 después) */
export function moved(items, name, dir) {
  const list = items.slice();
  const i = list.indexOf(name);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return null;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

/**
 * Arrastrar y soltar en la lista: al soltar sobre otro logo, el arrastrado
 * pasa a su posición. onReorder(screenId, items) envía el cambio.
 */
export function initRibbonDrag(container, onReorder) {
  let dragged = null;
  container.addEventListener('dragstart', (e) => {
    const row = e.target.closest && e.target.closest('.rb-row');
    if (!row) return;
    dragged = row;
    row.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.name);
  });
  // Para que se pueda soltar, el navegador pide aceptar la entrada y el paso por encima
  const accept = (e) => {
    const row = e.target.closest && e.target.closest('.rb-row');
    if (!dragged || !row || row === dragged || row.dataset.screen !== dragged.dataset.screen) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    container.querySelectorAll('.rb-row.is-target').forEach((r) => r.classList.remove('is-target'));
    row.classList.add('is-target');
  };
  container.addEventListener('dragenter', accept);
  container.addEventListener('dragover', accept);
  container.addEventListener('drop', (e) => {
    const row = e.target.closest && e.target.closest('.rb-row');
    if (!dragged || !row || row === dragged) return;
    e.preventDefault();
    const screen = ctx.state.screens.find((s) => s.id === dragged.dataset.screen);
    const items = screen.ribbon.items.filter((n) => n !== dragged.dataset.name);
    items.splice(items.indexOf(row.dataset.name) + (row.compareDocumentPosition(dragged) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0), 0, dragged.dataset.name);
    onReorder(screen.id, items);
  });
  container.addEventListener('dragend', () => {
    container.querySelectorAll('.rb-row.is-dragging, .rb-row.is-target').forEach((r) => r.classList.remove('is-dragging', 'is-target'));
    dragged = null;
  });
}
