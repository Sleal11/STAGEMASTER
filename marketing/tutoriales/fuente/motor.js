/**
 * motor.js — Motor de los vídeos explicativos de StageMaster
 *
 * Cada vídeo (videos.js) es una lista de ESCENAS. Todo se dibuja en función
 * del tiempo t (render(t)): así generar.js captura fotograma a fotograma, sin
 * depender de la velocidad del ordenador. Las capturas son de la aplicación
 * REAL (capturar.js); ZONES dice dónde está cada parte, para acercarse a ella
 * y resaltarla.
 *
 *   escena.device(tipo, opciones)  portátil, teléfono, LED o ventana con una captura
 *     .focus(t, zona)              acercamiento suave a una parte ('all' = entera)
 *     .highlight(t0, t1, zona, { tag })  recuadro amarillo con etiqueta (right: anclada a la derecha)
 *     .tap(t, zona)                toque de dedo
 *     .swap(t, captura)            cambia a otra captura (fundido)
 *   escena.text(html, opciones)    texto que entra animado
 *   escena.caption(t, n, texto)    subtítulo con el número de paso
 */

(function () {
  'use strict';

  const W = 1920, H = 1080, FADE = 0.4;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease  = (p) => 1 - Math.pow(1 - clamp(p), 3);
  const inOut = (p) => { p = clamp(p); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  const prog  = (t, a, d) => clamp((t - a) / d);
  const el = (tag, cls, parent, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  };
  const icon = (id) => `<svg viewBox="0 0 24 24"><use href="#${id}"></use></svg>`;

  function createVideo({ chip }) {
    const root = document.body;
    if (window.ICONS) el('div', 'hidden-icons', root, window.ICONS);
    const bg = el('div', '', root); bg.id = 'bg';
    [[-60, 120, 520], [1500, 940, 520], [-60, 1010, 300]].forEach(([x, y, w]) => {
      const b = el('div', 'bar', bg); Object.assign(b.style, { left: x + 'px', top: y + 'px', width: w + 'px' });
    });
    [[1350, -260, 820], [-300, 620, 700]].forEach(([x, y, s]) => {
      const g = el('div', 'glow', bg); Object.assign(g.style, { left: x + 'px', top: y + 'px', width: s + 'px', height: s + 'px' });
    });
    const scenesBox = el('div', '', root);
    const chapter = el('div', '', root); chapter.id = 'chapter';
    chapter.innerHTML = `<img src="../../../public/img/logo-stagemaster.png" alt=""><span class="chip">${chip}</span>`;
    const caption = el('div', '', root); caption.id = 'caption';
    caption.innerHTML = '<span class="num"></span><span class="txt"></span>';
    const wipe = el('div', '', root); wipe.id = 'wipe';

    const scenes = [];
    const captions = [];   // { t0, t1, num, text }
    const wipes = [];
    let total = 0;

    function scene(dur, build, { light = false, chip: showChip = true, wipe: wipeIn = false } = {}) {
      const box = el('div', 'scene' + (light ? ' light' : ''), scenesBox);
      const start = total;
      total += dur;
      if (wipeIn && start > 0) wipes.push(start);
      const updates = [];
      const sc = {
        el: box, start, dur,
        on: (fn) => updates.push(fn),
        caption: (t, num, text, until) => captions.push({ t0: start + t, t1: start + (until !== undefined ? until : dur), num, text }),
        text: (html, opts) => text(sc, html, opts),
        device: (kind, opts) => device(sc, kind, opts),
        node: (opts) => node(sc, opts),
        link: (opts) => link(sc, opts),
        bullet: (opts) => bullet(sc, opts),
      };
      build(sc);
      scenes.push({ box, start, dur, updates, chip: showChip });
      return sc;
    }

    // ── Texto ────────────────────────────────────────────────────
    function text(sc, html, { x = 0, y = 0, w = null, size = 60, cls = 'h', align = 'left', color = null, at = 0.2, from = 'up', dur = 0.7, out = null } = {}) {
      const e = el('div', 'abs ' + cls, sc.el, html);
      Object.assign(e.style, { left: x + 'px', top: y + 'px', fontSize: size + 'px', textAlign: align });
      if (w) e.style.width = w + 'px';
      if (color) e.style.color = color;
      sc.on((t) => {
        const p = ease(prog(t, at, dur));
        const q = out === null ? 1 : 1 - ease(prog(t, out, 0.4));
        const d = from === 'left' ? `translateX(${-60 * (1 - p)}px)` : from === 'right' ? `translateX(${60 * (1 - p)}px)`
          : from === 'scale' ? `scale(${0.85 + 0.15 * p})` : `translateY(${40 * (1 - p)}px)`;
        e.style.opacity = String(p * q);
        e.style.transform = d;
      });
      return e;
    }

    function bullet(sc, { x, y, iconId, html, at }) {
      const e = el('div', 'bullet', sc.el, `<span class="dot">${icon(iconId)}</span><span>${html}</span>`);
      Object.assign(e.style, { left: x + 'px', top: y + 'px' });
      sc.on((t) => {
        const p = ease(prog(t, at, 0.6));
        e.style.opacity = String(p);
        e.style.transform = `translateX(${-50 * (1 - p)}px)`;
      });
      return e;
    }

    function node(sc, { x, y, iconId, name, sub, at }) {
      const e = el('div', 'node', sc.el, `<div class="ico">${icon(iconId)}</div><div class="name">${name}</div><div class="sub">${sub}</div>`);
      Object.assign(e.style, { left: x + 'px', top: y + 'px', width: '380px', marginLeft: '-190px' });
      sc.on((t) => {
        const p = ease(prog(t, at, 0.6));
        e.style.opacity = String(p);
        e.style.transform = `scale(${0.8 + 0.2 * p})`;
      });
      return e;
    }

    function link(sc, { x1, y1, x2, y2, at, pulses = 3 }) {
      const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
      const e = el('div', 'link', sc.el);
      Object.assign(e.style, { left: x1 + 'px', top: y1 + 'px', width: len + 'px', transform: `rotate(${ang}rad) scaleX(0)` });
      const dots = Array.from({ length: pulses }, () => el('div', 'pulse', sc.el));
      sc.on((t) => {
        const p = ease(prog(t, at, 0.6));
        e.style.transform = `rotate(${ang}rad) scaleX(${p})`;
        dots.forEach((d, i) => {
          const f = ((t - at - 0.6) * 0.6 + i / pulses) % 1;
          const visible = t > at + 0.6;
          d.style.opacity = visible ? String(Math.sin(Math.PI * f)) : '0';
          d.style.left = (x1 + (x2 - x1) * f) + 'px';
          d.style.top = (y1 + (y2 - y1) * f) + 'px';
        });
      });
    }

    // ── Dispositivos con capturas reales ─────────────────────────
    function zoneOf(img) {
      const z = window.ZONES[img];
      if (!z) throw new Error('Captura desconocida: ' + img);
      return z;
    }

    function device(sc, kind, { img, x, y, w, at = 0.15, from = 'up', vpw = null, vph = null }) {
      const z = zoneOf(img);
      const pad = { laptop: [18, 18, 18, 18], phone: [40, 16, 30, 16], led: [14, 14, 14, 14], window: [40, 8, 8, 8] }[kind];
      // Tamaño de la zona visible: la proporción de la captura (salvo que se indique otra)
      const iw = vpw || w - pad[1] - pad[3];
      const ih = vph || Math.round(iw * z.height / z.width);
      const box = el('div', 'device ' + kind, sc.el);
      Object.assign(box.style, { left: x + 'px', top: y + 'px', width: (iw + pad[1] + pad[3]) + 'px', height: (ih + pad[0] + pad[2]) + 'px' });
      if (kind === 'laptop') el('div', 'cam', box);
      if (kind === 'phone') el('div', 'notch', box);
      if (kind === 'window') { const bar = el('div', 'bar', box); [16, 36, 56].forEach((l) => { const i = el('i', '', bar); i.style.left = l + 'px'; }); }
      const vp = el('div', 'vp', box);
      Object.assign(vp.style, { left: pad[3] + 'px', top: pad[0] + 'px', width: iw + 'px', height: ih + 'px' });
      if (kind === 'led') {
        el('div', 'grid', vp);
        [0.22, 0.78].forEach((f) => { const l = el('div', 'leg', box); l.style.left = `calc(${f * 100}% - 11px)`; });
      }
      const content = el('div', 'content', vp);
      const over = el('div', 'over', vp);
      const layers = [];
      const named = {};   // zonas de todas las capturas del dispositivo (también las de swap)
      const addLayer = (name, t0) => {
        const zz = zoneOf(name);
        // Una zona oculta en esa captura (tamaño 0) no cuenta: vale la de otra capa
        Object.entries(zz.rects).forEach(([k, r]) => { if (r && r.w > 0 && r.h > 0 && !named[k]) named[k] = r; });
        const im = el('img', '', content);
        im.src = `capturas/${name}.png`;
        Object.assign(im.style, { width: zz.width + 'px', height: zz.height + 'px' });
        layers.push({ im, t0 });
      };
      addLayer(img, -1);

      const focuses = [{ t: -1, rect: { x: 0, y: 0, w: z.width, h: z.height }, dur: 0 }];
      const highlights = [];
      const taps = [];
      const rectOf = (r, padding = 0) => {
        if (r === 'all') return { x: 0, y: 0, w: z.width, h: z.height };
        const base = typeof r === 'string' ? named[r] : r;
        if (!base) throw new Error(`Zona desconocida en ${img}: ${r}`);
        return { x: base.x - padding, y: base.y - padding, w: base.w + 2 * padding, h: base.h + 2 * padding };
      };
      const api = {
        focus(t, r, { padding = 40, dur = 1.0 } = {}) { focuses.push({ t, rect: rectOf(r, padding), dur }); return api; },
        highlight(t0, t1, r, { tag = '', below = false, right = false, padding = 10, dim = true } = {}) {
          const h = el('div', 'hl' + (dim ? '' : ' nodim'), over, tag ? `<span class="tag${below ? ' below' : ''}${right ? ' right' : ''}">${tag}</span>` : '');
          highlights.push({ h, t0, t1, rect: rectOf(r, padding) });
          return api;
        },
        tap(t, r) { const e = el('div', 'tap', over); taps.push({ e, t, rect: rectOf(r) }); return api; },
        swap(t, name) { addLayer(name, t); return api; },
      };

      const transformFor = (r) => {
        let s = Math.min(iw / r.w, ih / r.h);
        s = Math.max(s, Math.min(iw / z.width, ih / z.height));
        let tx = iw / 2 - (r.x + r.w / 2) * s, ty = ih / 2 - (r.y + r.h / 2) * s;
        const cw = z.width * s, ch = z.height * s;
        tx = cw >= iw ? clamp(tx, iw - cw, 0) : (iw - cw) / 2;
        ty = ch >= ih ? clamp(ty, ih - ch, 0) : (ih - ch) / 2;
        return { s, tx, ty };
      };

      sc.on((t) => {
        // Entrada del dispositivo
        const p = ease(prog(t, at, 0.8));
        box.style.opacity = String(p);
        box.style.transform = from === 'left' ? `translateX(${-120 * (1 - p)}px)` : from === 'right' ? `translateX(${120 * (1 - p)}px)`
          : `translateY(${80 * (1 - p)}px)`;
        // Acercamiento: del anterior al actual, con la duración indicada
        let cur = focuses[0].rect;
        for (let i = 1; i < focuses.length; i++) {
          const f = focuses[i];
          if (t < f.t) break;
          const k = inOut(prog(t, f.t, f.dur));
          cur = { x: cur.x + (f.rect.x - cur.x) * k, y: cur.y + (f.rect.y - cur.y) * k, w: cur.w + (f.rect.w - cur.w) * k, h: cur.h + (f.rect.h - cur.h) * k };
        }
        const m = transformFor(cur);
        content.style.transform = `translate(${m.tx}px, ${m.ty}px) scale(${m.s})`;
        layers.forEach((l, i) => { l.im.style.opacity = i === 0 ? '1' : String(ease(prog(t, l.t0, 0.35))); });
        highlights.forEach(({ h, t0, t1, rect }) => {
          const o = ease(prog(t, t0, 0.35)) * (1 - ease(prog(t, t1, 0.3)));
          const pulse = 1 + 0.02 * Math.sin((t - t0) * 6);
          Object.assign(h.style, {
            opacity: String(o), left: (rect.x * m.s + m.tx) + 'px', top: (rect.y * m.s + m.ty) + 'px',
            width: (rect.w * m.s) + 'px', height: (rect.h * m.s) + 'px', transform: `scale(${pulse})`,
          });
        });
        taps.forEach(({ e, t: tt, rect }) => {
          const k = prog(t, tt, 0.7);
          e.style.opacity = t >= tt && k < 1 ? String(1 - k) : '0';
          e.style.transform = `scale(${0.5 + k})`;
          e.style.left = ((rect.x + rect.w / 2) * m.s + m.tx) + 'px';
          e.style.top = ((rect.y + rect.h / 2) * m.s + m.ty) + 'px';
        });
      });
      api.box = box;
      return api;
    }

    // ── Dibujo del fotograma t ───────────────────────────────────
    function render(t) {
      let chipVisible = 0;
      scenes.forEach((s, i) => {
        const end = s.start + s.dur;
        const visible = t >= s.start && t < end + FADE && !(i === scenes.length - 1 && t >= end);
        s.box.style.display = visible ? '' : 'none';
        if (!visible) return;
        const o = i === 0 ? 1 : ease((t - s.start) / FADE);
        s.box.style.opacity = String(o);
        s.updates.forEach((fn) => fn(t - s.start));
        if (t < end && s.chip) chipVisible = 1;
      });
      chapter.style.opacity = String(chipVisible);
      // Subtítulo actual
      const c = captions.filter((x) => t >= x.t0 && t < x.t1).pop();
      if (c) {
        const k = ease(prog(t, c.t0, 0.4)) * (1 - ease(prog(t, c.t1 - 0.3, 0.3)));
        caption.style.opacity = String(k);
        caption.style.transform = `translateX(-50%) translateY(${30 * (1 - k)}px)`;
        caption.querySelector('.num').textContent = c.num || '';
        caption.querySelector('.num').classList.toggle('empty', !c.num);
        caption.querySelector('.txt').innerHTML = c.text;
      } else {
        caption.style.opacity = '0';
      }
      // Barrido celeste entre capítulos
      let wx = 2400;
      wipes.forEach((w) => { const p = (t - (w - 0.35)) / 0.7; if (p >= 0 && p <= 1) wx = 2300 - inOut(p) * 3500; });
      wipe.style.left = wx + 'px';
    }

    return { scene, render, get total() { return total; }, icon };
  }

  window.createVideo = createVideo;
}());
