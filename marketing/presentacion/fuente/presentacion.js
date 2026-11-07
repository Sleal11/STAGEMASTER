/**
 * presentacion.js — Vídeo de presentación y tutorial del Score de Pádel (1920 × 1080, 30 fps)
 *
 * 9 escenas del guion (../GUION.md). Todo lo que se ve de la aplicación son
 * capturas REALES (capturar.js). Cada escena dura lo que pide su imagen o lo
 * que dura su frase de voz (audio/duraciones.json, window.VOICE), lo que sea
 * más largo; la voz empieza VOICE_AT segundos después del inicio de la escena.
 * El mismo montaje sirve para las dos versiones (con voz y solo con música).
 *
 * Expone: window.render(t), window.DURATION, window.TIMELINE (para la música y la voz).
 */

(function () {
  'use strict';

  const VOICE_AT = 0.9;
  const voice = window.VOICE || {};
  const durFor = (id, planned) => Math.max(planned, voice[id] ? voice[id] + VOICE_AT + 1.4 : 0);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (p) => 1 - Math.pow(1 - clamp(p), 3);
  const prog = (t, a, d) => clamp((t - a) / d);
  const el = (tag, cls, parent, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  };
  const LOGO = '../../../public/img/logo-stagemaster.png';

  /** Pista de pádel en perspectiva que se dibuja (líneas) entre t0 y t0 + 1,6 s */
  function court(sc, { t0 = 0, opacity = 0.75, y = 0 } = {}) {
    const svg = el('div', 'court', sc.el, `
      <svg viewBox="0 0 1920 1080" width="1920" height="1080">
        <defs><linearGradient id="turf${sc.start}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0D3A8A" stop-opacity="0.15"/><stop offset="1" stop-color="#1450B4" stop-opacity="0.6"/></linearGradient></defs>
        <polygon points="700,560 1220,560 1800,1080 120,1080" fill="url(#turf${sc.start})"/>
        <g class="lines" fill="none" stroke="#BEE6FF" stroke-width="4" stroke-linecap="round">
          <path pathLength="1" d="M700 560 L1220 560 L1800 1080 L120 1080 Z"/>
          <path pathLength="1" d="M655 600 L1265 600"/>
          <path pathLength="1" d="M330 890 L1590 890"/>
          <path pathLength="1" d="M960 600 L960 890"/>
        </g>
        <g class="net"><path d="M480 760 L1440 760" stroke="#FFFFFF" stroke-opacity=".75" stroke-width="7" stroke-linecap="round"/>
          <path d="M480 760 L480 715 M1440 760 L1440 715" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round"/>
          <path d="M480 720 L1440 720" stroke="#FFFFFF" stroke-opacity=".4" stroke-width="2"/></g>
        <g class="glass" fill="none" stroke="#8FD3FF" stroke-opacity=".3" stroke-width="2">
          <path d="M700 560 L700 400 M1220 560 L1220 400 M120 1080 L120 640 M1800 1080 L1800 640 M700 400 L120 640 M1220 400 L1800 640"/></g>
      </svg>`);
    svg.style.top = y + 'px';
    const lines = [...svg.querySelectorAll('.lines path')];
    const net = svg.querySelector('.net');
    const glass = svg.querySelector('.glass');
    sc.on((t) => {
      lines.forEach((p, i) => { p.style.strokeDashoffset = String(1 - ease(prog(t, t0 + i * 0.18, 1.3))); });
      net.style.opacity = String(ease(prog(t, t0 + 0.9, 0.6)));
      glass.style.opacity = String(ease(prog(t, t0 + 0.5, 0.9)));
      svg.style.opacity = String(opacity);
    });
    return svg;
  }

  /** LED colgada al fondo de la pista, con una captura real */
  function stageLed(sc, { img, x, y, w, on = 0.8, zoom = null }) {
    const h = w / 2;
    const box = el('div', 'stage-led', sc.el, `<div class="panel"><img src="capturas/${img}.png" alt=""><div class="grid"></div><div class="glare"></div></div>` +
      '<div class="post" style="left:22%"></div><div class="post" style="left:calc(78% - 18px)"></div>');
    Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const im = box.querySelector('img');
    const glare = box.querySelector('.glare');
    sc.on((t) => {
      const p = ease(prog(t, on, 1.0));
      im.style.opacity = String(p);            // la LED «se enciende»
      im.style.filter = `brightness(${0.4 + 0.6 * p})`;
      glare.style.transform = `translateX(${-120 + 240 * prog(t, on + 0.6, 2.2)}%)`;
      const z = zoom ? zoom(t) : 1;
      box.style.transform = `perspective(1600px) rotateX(4deg) scale(${z})`;
    });
    return box;
  }

  function overlay(sc, cls, fn) {
    const e = el('div', cls, sc.el);
    sc.on((t) => fn(e, t));
    return e;
  }

  function chips(sc, { x, y, items, at }) {
    const e = el('div', 'chips', sc.el, items.map((i) => `<span>${i}</span>`).join(''));
    Object.assign(e.style, { left: x + 'px', top: y + 'px' });
    const spans = [...e.children];
    sc.on((t) => spans.forEach((s, i) => {
      const p = ease(prog(t, at + i * 0.25, 0.5));
      s.style.opacity = String(p);
      s.style.transform = `translateY(${20 * (1 - p)}px)`;
    }));
  }

  function devLabel(sc, { x, y, title, sub, at }) {
    const e = el('div', 'devlabel', sc.el, `<div class="t">${title}</div><div class="s">${sub}</div>`);
    Object.assign(e.style, { left: (x - 250) + 'px', top: y + 'px', width: '500px' });
    sc.on((t) => { const p = ease(prog(t, at, 0.6)); e.style.opacity = String(p); e.style.transform = `translateY(${20 * (1 - p)}px)`; });
  }

  // ═════════════════════════════════════════════════════════════════
  function build(V) {
    const timeline = [];
    const scene = (id, planned, fn, opts = {}) => {
      const dur = durFor(id, planned);
      const sc = V.scene(dur, fn, { chip: false, ...opts });
      timeline.push({ id, start: sc.start, end: sc.start + dur, voiceAt: sc.start + VOICE_AT });
      return sc;
    };

    // ── 1 · Introducción ─────────────────────────────────────────
    const LOGO_AT = 4.3;
    scene('intro', 11, (s) => {
      court(s, { t0: 0.3 });
      stageLed(s, { img: 'led-juego', x: 560, y: 150, w: 800, on: 1.3, zoom: (t) => 0.9 + 0.12 * ease(prog(t, 0, 10)) });
      overlay(s, 'shade', (e, t) => { e.style.opacity = String(0.85 * ease(prog(t, LOGO_AT - 0.2, 0.5)) * (1 - ease(prog(t, 9.6, 0.8)))); });
      overlay(s, 'flash', (e, t) => { e.style.opacity = String(Math.max(0, 1 - Math.abs(t - LOGO_AT) / 0.35) * 0.8); });
      s.text(`<img src="${LOGO}" style="height:190px" alt="">`, { x: 0, y: 330, w: 1920, align: 'center', cls: '', at: LOGO_AT, from: 'scale', out: 9.6 });
      s.text('Score de pádel', { x: 0, y: 560, w: 1920, align: 'center', size: 96, at: LOGO_AT + 0.6, out: 9.6 });
      s.text('Marcador profesional para pantallas LED', { x: 0, y: 680, w: 1920, align: 'center', cls: 'lead', size: 40, at: LOGO_AT + 1.0, out: 9.6 });
    });

    // ── 2 · El sistema ───────────────────────────────────────────
    scene('sistema', 12, (s) => {
      s.text('Un sistema, <span class="gold">tres piezas</span>', { x: 0, y: 70, w: 1920, align: 'center', size: 74, at: 0.1 });
      s.device('laptop', { img: 'st-panel', x: 90, y: 260, w: 640, at: 0.6, from: 'left' });
      s.device('phone', { img: 'rt-tel-0', x: 840, y: 210, w: 250, at: 1.6 });
      s.device('led', { img: 'led-juego', x: 1200, y: 300, w: 640, at: 2.6, from: 'right' });
      s.link({ x1: 740, y1: 470, x2: 830, y2: 470, at: 2.2 });
      s.link({ x1: 1100, y1: 470, x2: 1190, y2: 470, at: 3.2 });
      devLabel(s, { x: 410, y: 700, title: 'Estación', sub: 'El operador, en el portátil', at: 1.2 });
      devLabel(s, { x: 965, y: 760, title: 'Árbitro', sub: 'Puntúa con su teléfono', at: 2.2 });
      devLabel(s, { x: 1520, y: 700, title: 'Pantallas LED', sub: 'Hasta 8, con publicidad', at: 3.2 });
      chips(s, { x: 610, y: 880, items: ['Sin instalar nada', 'Sin Internet', 'Red del club'], at: 5.4 });
    }, { wipe: true });

    // ── 3 · El marcador ──────────────────────────────────────────
    scene('marcador', 21, (s) => {
      const a = VOICE_AT;
      s.text('El marcador', { x: 110, y: 60, size: 64, at: 0.1 });
      const led = s.device('led', { img: 'led-juego', x: 160, y: 170, w: 1600, at: 0.2 });
      led.highlight(a + 2.2, a + 4.4, 'namesA', { tag: 'Nombres' })
        .highlight(a + 4.4, a + 5.4, 'setsA', { tag: 'Sets' })
        .highlight(a + 5.4, a + 6.3, 'gamesA', { tag: 'Games' })
        .highlight(a + 6.3, a + 7.6, 'ptsA', { tag: 'Puntos' })
        .highlight(a + 7.6, a + 9.8, 'serveA', { tag: 'Saca', padding: 6 })
        .highlight(a + 9.8, a + 12.0, 'history', { tag: 'Sets jugados', below: true })
        .swap(a + 12.0, 'led-juego-oro')
        .highlight(a + 12.3, a + 15.8, 'badge', { tag: 'Momento clave', below: true })
        .highlight(a + 15.8, a + 19.5, 'ribbon', { tag: 'Tus patrocinadores' });
      s.caption(a + 12.3, '', 'PUNTO DE ORO · TIE BREAK · SUPER TIE BREAK · EN PAUSA · PARTIDO FINALIZADO', a + 15.6);
    }, { wipe: true });

    // ── 4 · Configurar el partido ────────────────────────────────
    scene('configurar', 22, (s) => {
      const a = VOICE_AT;
      s.text('Configurar el partido', { x: 110, y: 50, size: 60, at: 0.1 });
      const lap = s.device('laptop', { img: 'st-panel', x: 260, y: 150, w: 1400, at: 0.2 });
      lap.focus(0.6, 'card1', { padding: 30 }).tap(1.6, 'setup1')
        .swap(2.0, 'st-setup-0').focus(2.1, 'dialog', { padding: 24, dur: 0.8 })
        .swap(a + 3.0, 'st-setup-1')
        .highlight(a + 3.0, a + 5.0, 'teams', { tag: 'Parejas' })
        .highlight(a + 5.0, a + 6.6, 'games', { tag: 'Games' })
        .highlight(a + 5.4, a + 6.6, 'sets', { tag: 'Sets', dim: false })
        .highlight(a + 6.6, a + 8.0, 'server', { tag: 'Saque inicial' })
        .swap(a + 8.0, 'st-setup-2')
        .highlight(a + 8.0, a + 13.6, 'scoring', { tag: 'Puntuación', below: true })
        .highlight(a + 13.6, a + 15.6, 'tiebreak', { tag: 'Desempate', below: true })
        .highlight(a + 15.6, a + 17.4, 'start', { tag: 'Iniciar partido', below: true })
        .tap(a + 16.6, 'start');
      s.caption(a + 8.2, '', 'Puntuación: <b>Ventaja · Punto de oro · FIP 2026</b>', a + 13.4);
      s.caption(a + 13.7, '', 'Desempate: <b>Tie Break · Súper Tie Break · Ninguno</b>', a + 15.5);
      s.device('led', { img: 'rt-led-0', x: 1180, y: 610, w: 640, at: a + 17.4, from: 'right' });
      s.caption(a + 17.6, '', 'La pantalla, <b>lista al instante</b>');
    }, { wipe: true });

    // ── 5 · Acceso del árbitro ───────────────────────────────────
    scene('arbitro', 15, (s) => {
      const a = VOICE_AT;
      s.text('El árbitro, <span class="gold">con su teléfono</span>', { x: 110, y: 50, size: 60, at: 0.1 });
      const lap = s.device('laptop', { img: 'st-panel', x: 110, y: 190, w: 1000, at: 0.2, from: 'left' });
      lap.focus(0.8, 'referee', { padding: 20 }).highlight(a + 2.2, a + 5.6, 'qr', { tag: '1 QR para todas las pistas', below: true, padding: 8 })
        .focus(a + 5.6, 'card1', { padding: 20 }).highlight(a + 6.2, a + 10.5, 'pin1', { tag: 'Código de la pista', below: true });
      const tel = s.device('phone', { img: 'tel-codigo-0', x: 1330, y: 120, w: 380, at: 0.6, from: 'right' });
      tel.swap(a + 6.6, 'tel-codigo-3').tap(a + 6.4, 'keypad')
        .swap(a + 8.2, 'tel-conectado').swap(a + 10.6, 'rt-tel-0');
      s.caption(a + 8.4, '', 'Sin aplicaciones ni contraseñas: <b>el código decide la pista</b>');
    }, { wipe: true });

    // ── 6 · Tiempo real ──────────────────────────────────────────
    scene('directo', 26, (s) => {
      s.text('En tiempo real', { x: 110, y: 50, size: 60, at: 0.1 });
      const tel = s.device('phone', { img: 'rt-tel-0', x: 150, y: 140, w: 380, at: 0.2, from: 'left' });
      const led = s.device('led', { img: 'rt-led-0', x: 640, y: 250, w: 1160, at: 0.4, from: 'right' });
      const step = (t, n, tapZone, { ledToo = true } = {}) => {
        if (tapZone) tel.tap(t - 0.25, tapZone);
        tel.swap(t, `rt-tel-${n}`);
        if (ledToo) led.swap(t + 0.12, `rt-led-${n}`);
      };
      step(2.0, 1, 'pointA'); step(3.2, 2, 'pointA'); step(4.4, 3, 'pointA'); step(5.6, 4, 'pointA');
      led.highlight(5.9, 8.4, 'serveB', { tag: 'El saque cambia solo', padding: 6 });
      s.caption(2.0, '', 'Cada punto, <b>al instante</b> en la pantalla', 8.5);
      // Más tarde en el set: 5-3 · 40-15 → set
      step(8.8, 5, null);
      const later = el('div', 'badge-later', s.el, 'Más tarde…');
      Object.assign(later.style, { left: '640px', top: '190px' });
      s.on((t) => { later.style.opacity = String(ease(prog(t, 8.8, 0.3)) * (1 - ease(prog(t, 10.4, 0.3)))); });
      step(10.6, 6, 'pointA');
      led.highlight(10.9, 13.0, 'history', { tag: 'Set 1 · 6-3', below: true });
      s.caption(10.8, '', 'Games y sets: <b>se calculan solos</b>', 13.0);
      // Deshacer: doble toque
      tel.tap(13.2, 'undo').swap(13.35, 'rt-tel-7');
      step(14.6, 8, 'undo');
      s.caption(13.3, '', '¿Un error? <b>Deshacer</b> con doble toque', 16.4);
      step(16.6, 9, 'pointA');
      step(18.0, 10, 'server');
      s.caption(17.9, '', 'Cambiar saque si hace falta', 19.6);
      // Pausa: la LED muestra la publicidad
      step(19.8, 11, 'pause');
      s.caption(20.0, '', 'Pausa: <b>tu publicidad</b> y el marcador vuelve igual', 25.6);
      tel.tap(23.0, 'pause').swap(23.25, 'rt-tel-10');
      led.swap(23.4, 'rt-led-12');
    }, { wipe: true });

    // ── 7 · Las reglas ───────────────────────────────────────────
    scene('reglas', 23, (s) => {
      const a = VOICE_AT;
      const led = s.device('led', { img: 'r-ventaja-1', x: 280, y: 300, w: 1360, at: 0.2 });
      const rules = [
        [0.3, a + 2.2, 'FIP', 'Reglamento FIP', 'Todas las reglas, aplicadas por el marcador'],
        [a + 2.2, a + 4.4, '1', 'Ventaja', '40-40 → ventaja (AD) → game'],
        [a + 4.4, a + 6.4, '2', 'Punto de oro', 'En el 40-40, el siguiente punto gana el game'],
        [a + 6.4, a + 10.4, '3', 'FIP 2026', '1.º y 2.º 40-40 con ventaja · el 3.º, punto decisivo'],
        [a + 10.4, a + 13.0, '4', 'Tie Break', '6-6 → a 7 puntos, con 2 de diferencia'],
        [a + 13.0, a + 16.6, '5', 'Súper Tie Break', 'En lugar del set decisivo: a 10 puntos'],
        [a + 16.6, 30, '6', 'Final', 'Termina solo al ganar los sets necesarios'],
      ];
      rules.forEach(([t0, t1, n, title, sub]) => {
        const card = el('div', 'rule', s.el, `<span class="n">${n}</span><span class="t">${title}</span>`);
        const subEl = el('div', 'rule-sub', s.el, sub);
        s.on((t) => {
          const p = ease(prog(t, t0, 0.45)) * (1 - ease(prog(t, t1 - 0.3, 0.3)));
          [card, subEl].forEach((e) => { e.style.opacity = String(p); e.style.transform = `translateX(${-40 * (1 - p)}px)`; });
        });
      });
      led.swap(a + 3.2, 'r-ventaja-2').highlight(a + 3.4, a + 4.4, 'ptsA', { tag: 'Ventaja' })
        .swap(a + 4.4, 'r-oro').highlight(a + 4.7, a + 6.4, 'badge', { tag: 'Punto de oro', below: true })
        .swap(a + 6.4, 'r-fip-1').swap(a + 7.6, 'r-fip-2').swap(a + 8.8, 'r-fip-3')
        .highlight(a + 9.0, a + 10.4, 'badge', { tag: '3.er 40-40', below: true })
        .swap(a + 10.4, 'r-tiebreak').highlight(a + 10.7, a + 13.0, 'badge', { tag: 'Tie Break', below: true })
        .swap(a + 13.0, 'r-stb').highlight(a + 13.3, a + 16.6, 'history', { tag: 'Set decisivo', below: true })
        .swap(a + 16.6, 'f-ganador').highlight(a + 16.9, 22, 'badge', { tag: 'Partido finalizado', below: true });
    }, { wipe: true });

    // ── 8 · Final del partido ────────────────────────────────────
    scene('final', 14, (s) => {
      const CEL = window.ZONES.cel;
      const led = s.device('led', { img: 'f-ganador', x: 240, y: 170, w: 1440, at: 0.15 });
      const vp = led.box.querySelector('.vp');
      const seq = el('div', 'celseq', vp);
      const frames = Array.from({ length: CEL.frames }, (_, i) => {
        const im = el('img', '', seq);
        im.src = `capturas/cel/c${String(i).padStart(3, '0')}.jpg`;
        return im;
      });
      const fps = CEL.frames / CEL.seconds;
      const CEL_END = Math.min(CEL.seconds, 5.4);
      s.on((t) => {
        const f = clamp(t * fps, 0, CEL.frames - 1.001);
        const i = Math.floor(f), k = f - i;
        frames.forEach((im, j) => { im.style.opacity = j === i ? '1' : j === i + 1 ? String(k) : '0'; });
        seq.style.opacity = String(1 - ease(prog(t, CEL_END, 0.4)));
      });
      led.highlight(CEL_END + 0.4, CEL_END + 2.4, 'rowA', { tag: 'Ganador' })
        .swap(CEL_END + 2.6, 'f-estadisticas');
      s.caption(0.8, '', 'La celebración de los <b>ganadores</b>', CEL_END);
      s.caption(CEL_END + 2.7, '', 'Las <b>estadísticas</b> del partido, en grande', 13);
      // La LED deja paso a la estación: el partido ya está en el Historial
      s.on((t) => { led.box.style.opacity = String(1 - ease(prog(t, CEL_END + 4.3, 0.5))); });
      const lap = s.device('laptop', { img: 'f-historial', x: 360, y: 150, w: 1200, at: CEL_END + 4.6, from: 'right' });
      lap.focus(CEL_END + 5.2, 'list', { padding: 20 }).highlight(CEL_END + 5.8, 14, 'first', { tag: 'Guardado en el historial', below: true });
    }, { wipe: true });

    // ── 9 · Cierre ───────────────────────────────────────────────
    scene('cierre', 10, (s) => {
      court(s, { t0: 0 });
      stageLed(s, { img: 'led-juego', x: 560, y: 150, w: 800, on: 0, zoom: (t) => 1.05 - 0.15 * ease(prog(t, 0, 8)) });
      overlay(s, 'shade', (e, t) => { e.style.opacity = String(0.88 * ease(prog(t, 1.2, 1.0))); });
      overlay(s, 'flash', (e, t) => { e.style.opacity = String(Math.max(0, 1 - Math.abs(t - 1.9) / 0.35) * 0.7); });
      s.text(`<img src="${LOGO}" style="height:200px" alt="">`, { x: 0, y: 300, w: 1920, align: 'center', cls: '', at: 1.9, from: 'scale' });
      s.text('Tecnología que convierte cada partido<br>en un <span class="gold">espectáculo</span>', { x: 0, y: 560, w: 1920, align: 'center', size: 70, at: 3.0 });
      s.text('STAGEMASTER · SCORE DE PÁDEL', { x: 0, y: 790, w: 1920, align: 'center', cls: 'kicker', size: 30, at: 4.2 });
    }, { wipe: true });

    window.TIMELINE = { escenas: timeline, total: V.total, logoAt: LOGO_AT };
  }

  window.PRESENTACION = { build };
}());
