/**
 * videos.js — Guiones de los vídeos explicativos (1920 × 1080, 30 fps)
 *
 *   resumen       StageMaster en 90 segundos: todo el sistema
 *   1-estacion    La estación del operador: partidos, puntos e historial
 *   2-arbitro     El árbitro con su teléfono: QR único, código de pista y marcador
 *   3-pantallas   Pantallas LED y publicidad
 *   4-avanzado    Varias pantallas, En vivo y portátil remoto
 *
 * Se elige con video.html?id=resumen. Las capturas y sus zonas vienen de capturar.js.
 */

(function () {
  'use strict';

  // ── Escenas comunes ──────────────────────────────────────────────

  function intro(V, { kicker, title, sub, dur = 4.5 }) {
    V.scene(dur, (s) => {
      s.text(`<img src="../../../public/img/logo-stagemaster.png" style="height:150px" alt="">`, { x: 0, y: 220, w: 1920, align: 'center', cls: '', at: 0.1, from: 'scale' });
      s.text(kicker, { x: 0, y: 440, w: 1920, align: 'center', cls: 'kicker', size: 30, at: 0.5 });
      s.text(title, { x: 0, y: 500, w: 1920, align: 'center', size: 110, at: 0.75 });
      if (sub) s.text(sub, { x: 260, y: 660, w: 1400, align: 'center', cls: 'lead', size: 38, at: 1.1 });
    }, { chip: false });
  }

  function outro(V, { line = 'Donde tus eventos <span class="sky">suben de nivel</span>', dur = 5 } = {}) {
    V.scene(dur, (s) => {
      s.text(`<img src="../../../public/img/logo-stagemaster.png" style="height:200px" alt="">`, { x: 0, y: 230, w: 1920, align: 'center', cls: '', at: 0.1, from: 'scale' });
      s.text(line, { x: 0, y: 520, w: 1920, align: 'center', size: 84, at: 0.5 });
      s.text('@stagemastervzla', { x: 0, y: 680, w: 1920, align: 'center', cls: 'lead', size: 46, at: 0.9 });
    }, { chip: false, wipe: true });
  }

  const LAPTOP = { x: 360, y: 128, w: 1200 };

  // ═════════════════════════════════════════════════════════════════
  // RESUMEN · StageMaster en 90 segundos
  // ═════════════════════════════════════════════════════════════════
  function resumen(V) {
    intro(V, { kicker: 'Pádel · Pantallas LED · Eventos', title: 'Marcador profesional', sub: 'Partidos, árbitros, pantallas y publicidad, controlados desde un portátil' });

    V.scene(8, (s) => {
      s.text('Así funciona', { x: 0, y: 150, w: 1920, align: 'center', size: 80, at: 0.1 });
      s.node({ x: 400, y: 330, iconId: 'monitor', name: 'Estación', sub: 'El operador, en el portátil', at: 0.5 });
      s.node({ x: 960, y: 330, iconId: 'phone', name: 'Árbitro', sub: 'Puntúa con su teléfono', at: 1.2 });
      s.node({ x: 1520, y: 330, iconId: 'screen', name: 'Pantallas LED', sub: 'Marcador y publicidad', at: 1.9 });
      s.link({ x1: 610, y1: 425, x2: 750, y2: 425, at: 1.0 });
      s.link({ x1: 1170, y1: 425, x2: 1310, y2: 425, at: 1.7 });
      s.caption(2.6, '', 'Todo por la red local: <b>no necesita Internet</b>');
    }, { wipe: true });

    V.scene(7.5, (s) => {
      s.device('laptop', { img: 'estacion-panel', ...LAPTOP }).focus(2.4, 'card1', { padding: 30 }).highlight(3.6, 7.3, 'setup1', { tag: 'Nuevo partido' });
      s.caption(0.6, 1, 'El operador prepara los partidos en la <b>estación</b>: pistas y pantallas, cada una en su zona');
    });

    V.scene(6, (s) => {
      s.device('laptop', { img: 'estacion-nuevo-partido', ...LAPTOP }).focus(0.8, 'dialog', { padding: 30 }).highlight(2.6, 5.8, 'scoring', { tag: 'Reglas FIP' });
      s.caption(0.5, 1, 'Parejas, sets y puntuación: <b>ventaja, punto de oro o FIP 2026</b>');
    });

    V.scene(9, (s) => {
      s.device('laptop', { img: 'estacion-panel', x: 60, y: 200, w: 1140, from: 'left' }).focus(0.6, 'referee', { padding: 20 }).highlight(1.6, 8.8, 'qr', { tag: 'Un solo QR', padding: 8 });
      const phone = s.device('phone', { img: 'telefono-pin', x: 1330, y: 120, w: 400, vpw: 368, vph: 796, at: 2.2, from: 'right' });
      phone.highlight(4.6, 8.8, 'keypad', { tag: 'Código de pista', below: true });
      const scan = document.createElement('div'); scan.className = 'scanline'; phone.box.querySelector('.vp').appendChild(scan);
      s.on((t) => { const k = ((t - 2.6) / 1.4) % 1; scan.style.top = (8 + 84 * k) + '%'; scan.style.opacity = t > 2.6 && t < 4.4 ? '1' : '0'; });
      s.caption(0.5, 2, 'El árbitro <b>escanea el QR</b> y escribe el <b>código de su pista</b>');
    }, { wipe: true });

    V.scene(9, (s) => {
      const phone = s.device('phone', { img: 'telefono-marcador', x: 150, y: 120, w: 400, vpw: 368, vph: 796, from: 'left' });
      phone.highlight(1.4, 3.2, 'pointA', { tag: 'Punto' }).tap(2.6, 'pointA').swap(2.8, 'telefono-marcador-2');
      s.device('led', { img: 'led-marcador', x: 690, y: 250, w: 1100, at: 0.4, from: 'right' }).swap(3.0, 'led-marcador-2').highlight(3.4, 8.6, 'board', { padding: 0, dim: false });
      s.caption(0.5, 2, 'Cada punto llega a la pantalla LED <b>al instante</b>');
    });

    V.scene(6, (s) => {
      s.device('led', { img: 'led-set-point', x: 360, y: 180, w: 1200 }).highlight(1.2, 3.4, 'badge', { padding: 4, dim: false })
        .swap(3.4, 'led-match-point').highlight(3.6, 5.8, 'badge', { padding: 4, dim: false });
      s.caption(0.5, 2, 'La LED avisa del <b>SET POINT</b> y del <b>MATCH POINT</b>');
    });

    V.scene(8, (s) => {
      s.device('laptop', { img: 'estacion-cinta-editor-0', x: 60, y: 200, w: 1080, from: 'left' }).focus(0.4, 'editor', { padding: 30 })
        .tap(1.4, 'logo').swap(1.6, 'estacion-cinta-editor').tap(3.0, 'handle').swap(3.4, 'estacion-cinta-editor-2');
      s.device('led', { img: 'led-cinta', x: 1180, y: 330, w: 680, at: 3.8, from: 'right' }).highlight(4.6, 7.8, 'ribbon', { padding: 0, dim: false });
      s.caption(0.5, 3, '<b>Cinta de patrocinadores</b>: ordena los logos y ajusta su tamaño <b>como en Word</b>');
    }, { wipe: true });

    V.scene(7.5, (s) => {
      s.device('phone', { img: 'telefono-pausa', x: 150, y: 120, w: 400, vpw: 368, vph: 796, from: 'left' }).highlight(1.0, 7.2, 'banner', { padding: 6 });
      s.device('led', { img: 'led-pausa', x: 690, y: 250, w: 1100, at: 0.6, from: 'right' });
      s.caption(0.5, 3, 'En la pausa y al terminar, la LED pasa <b>sola</b> a tu publicidad');
    });

    V.scene(9, (s) => {
      s.device('led', { img: 'led-celebracion', x: 360, y: 180, w: 1200 }).swap(3.2, 'led-ganador').swap(6.0, 'led-resumen');
      s.caption(0.5, 3, 'Al terminar: <b>celebración</b>, el <b>ganador</b> y las <b>estadísticas</b> del partido');
    }, { wipe: true });

    V.scene(6.5, (s) => {
      s.device('led', { img: 'led-marcador', x: 360, y: 180, w: 1200 }).swap(2.0, 'led-tema-alt').swap(4.0, 'led-tema-light');
      s.caption(0.5, 4, '<b>Colores</b> a elegir: oscuro, alternativo (índigo) o claro');
    }, { wipe: true });

    V.scene(7, (s) => {
      s.device('laptop', { img: 'estacion-pantalla-salida', ...LAPTOP }).focus(0.8, 'card', { padding: 10 })
        .highlight(2.0, 4.2, 'brightness', { tag: 'Brillo' }).highlight(4.2, 6.8, 'fit', { tag: 'La publicidad llena la LED' });
      s.caption(0.5, 4, 'Cada pantalla: <b>monitor, formato LED, brillo</b> y ajuste');
    }, { wipe: true });

    V.scene(6.5, (s) => {
      s.device('laptop', { img: 'estacion-en-vivo', ...LAPTOP }).focus(1.0, { x: 30, y: 60, w: 1030, h: 620 }, { padding: 0 });
      s.caption(0.5, 4, '<b>En vivo</b>: ves lo que ve el público sin mirar las LED');
    });

    V.scene(8, (s) => {
      s.device('window', { img: 'remoto-ventana', x: 70, y: 210, w: 760, from: 'left' }).highlight(1.6, 7.8, 'station', { tag: 'Abrir estación', padding: 8 });
      s.device('laptop', { img: 'remoto-estacion', x: 900, y: 230, w: 960, at: 2.4, from: 'right' }).highlight(3.4, 7.8, 'title', { padding: 10, dim: false });
      s.caption(0.5, 5, 'Pista lejos: un <b>segundo portátil</b> con pantallas y su propia estación');
    }, { wipe: true });

    V.scene(5.5, (s) => {
      s.device('laptop', { img: 'estacion-historial', ...LAPTOP }).focus(0.8, 'list', { padding: 20 });
      s.caption(0.5, 6, '<b>Historial</b> de resultados, exportable a Excel (CSV)');
    });

    outro(V);
  }

  // ═════════════════════════════════════════════════════════════════
  // 1 · La estación del operador
  // ═════════════════════════════════════════════════════════════════
  function estacion(V) {
    intro(V, { kicker: 'Tutorial 1', title: 'La estación del operador', sub: 'Crear partidos, puntuar y consultar resultados' });

    V.scene(9, (s) => {
      s.device('laptop', { img: 'estacion-panel', ...LAPTOP })
        .highlight(1.2, 3.6, 'tabs', { tag: 'Panel · En vivo · Historial' })
        .highlight(3.8, 6.2, 'courtsZone', { tag: 'Pistas y partidos', padding: 0 })
        .highlight(6.4, 8.8, 'screensHead', { tag: 'Pantallas', below: true });
      s.caption(0.5, 1, 'Al abrir StageMaster se abre la <b>estación</b>: todo se controla desde aquí');
    });

    V.scene(7, (s) => {
      s.device('laptop', { img: 'estacion-panel', ...LAPTOP }).focus(0.3, { x: 700, y: 60, w: 880, h: 420 }, { padding: 0 })
        .highlight(0.9, 2.4, 'courtsCollapse', { tag: 'Minimizar', below: true, right: true, padding: 6 })
        .tap(2.0, 'courtsCollapse').swap(2.3, 'estacion-panel-plegado').highlight(3.0, 6.8, 'summary', { tag: 'Resumen a la vista', below: true, right: true, padding: 6 });
      s.caption(0.5, 2, 'Cada zona se <b>minimiza</b> con su flecha y deja a la vista un resumen');
    }, { wipe: true });

    V.scene(9, (s) => {
      s.device('laptop', { img: 'estacion-colores', ...LAPTOP }).focus(0.5, 'dialog', { padding: 30 })
        .highlight(1.4, 4.2, 'ui', { tag: 'Estación y teléfonos', padding: 6 }).highlight(4.4, 6.0, 'led', { tag: 'Pantallas LED', below: true, padding: 6 })
        .swap(6.2, 'estacion-tema-light').focus(6.2, 'all', { padding: 0, dur: 0.01 }).swap(7.6, 'estacion-tema-alt');
      s.caption(0.5, 3, '<b>Colores</b>: oscuro, <b>claro</b> o <b>alternativo</b> (índigo de marca), al instante en todos');
    });

    V.scene(8.5, (s) => {
      s.device('laptop', { img: 'estacion-panel', ...LAPTOP }).focus(0.6, 'card1', { padding: 20 }).tap(2.2, 'setup1').highlight(1.4, 2.6, 'setup1', { tag: 'Nuevo partido' })
        .swap(2.6, 'estacion-nuevo-partido').focus(2.8, 'dialog', { padding: 30 });
      s.caption(0.5, 4, 'Pulsa <b>Nuevo partido…</b> en la pista que quieras', 4.2);
      s.caption(4.2, 4, 'Escribe las <b>parejas</b>, games por set, sets y quién saca');
    });

    V.scene(7, (s) => {
      s.device('laptop', { img: 'estacion-nuevo-partido', ...LAPTOP }).focus(0.2, 'dialog', { padding: 30, dur: 0.01 }).highlight(1.0, 6.8, 'scoring', { tag: 'Puntuación' });
      s.caption(0.5, 5, 'Reglas FIP: <b>ventaja</b>, <b>punto de oro</b> o <b>FIP 2026</b>; tie break o súper tie break');
    });

    V.scene(8, (s) => {
      s.device('laptop', { img: 'estacion-panel', ...LAPTOP }).focus(0.6, 'card1', { padding: 20 })
        .highlight(1.6, 4.6, 'score1', { tag: 'Punto', padding: 6 }).highlight(4.8, 7.8, 'pause1', { tag: 'Pausar · Finalizar', padding: 6 });
      s.caption(0.5, 6, 'Si falla el teléfono, <b>puntúa desde la estación</b> como respaldo');
    }, { wipe: true });

    V.scene(7, (s) => {
      s.device('laptop', { img: 'estacion-panel-telefono', ...LAPTOP }).focus(0.6, 'access1', { padding: 20 });
      s.caption(0.5, 7, 'Ves si el teléfono del árbitro está <b>conectado</b>; puedes cambiar el código o desvincularlo');
    });

    V.scene(7, (s) => {
      s.device('laptop', { img: 'estacion-historial', ...LAPTOP }).highlight(0.8, 3.2, 'tab', { tag: 'Historial', below: true }).focus(3.0, 'list', { padding: 20 });
      s.caption(0.5, 8, 'Cada partido terminado queda en el <b>Historial</b> al instante: filtra y exporta a Excel');
    }, { wipe: true });

    outro(V);
  }

  // ═════════════════════════════════════════════════════════════════
  // 2 · El árbitro con su teléfono
  // ═════════════════════════════════════════════════════════════════
  function arbitro(V) {
    intro(V, { kicker: 'Tutorial 2', title: 'El árbitro y su teléfono', sub: 'Sin instalar nada: escanea, escribe el código de su pista y puntúa' });

    V.scene(6.5, (s) => {
      s.device('laptop', { img: 'estacion-panel', ...LAPTOP }).focus(0.6, { x: 30, y: 60, w: 1540, h: 640 }, { padding: 0 })
        .highlight(1.6, 6.3, 'qr', { tag: 'Un solo QR', padding: 8 }).highlight(3.2, 6.3, 'pin1', { tag: 'Código de pista', below: true, padding: 8, dim: false });
      s.caption(0.5, 1, '<b>Un solo QR</b> para todos y un <b>código</b> por pista, en la estación');
    });

    V.scene(8, (s) => {
      s.device('laptop', { img: 'estacion-panel', x: 60, y: 200, w: 1140, from: 'left' }).focus(0.1, 'referee', { padding: 20, dur: 0.01 }).highlight(0.6, 7.8, 'qr', { padding: 8 });
      const phone = s.device('phone', { img: 'telefono-pin', x: 1330, y: 120, w: 400, vpw: 368, vph: 796, at: 0.8, from: 'right' });
      const scan = document.createElement('div'); scan.className = 'scanline'; phone.box.querySelector('.vp').appendChild(scan);
      s.on((t) => { const k = ((t - 1.2) / 1.4) % 1; scan.style.top = (8 + 84 * k) + '%'; scan.style.opacity = t > 1.2 && t < 4.0 ? '1' : '0'; });
      phone.highlight(4.4, 7.8, 'title', { tag: 'Página del árbitro', below: true, padding: 4 });
      s.caption(0.5, 2, 'Con la <b>cámara del teléfono</b> escanea el QR: se abre la página del árbitro');
    }, { wipe: true });

    V.scene(7, (s) => {
      s.device('phone', { img: 'telefono-pin', x: 760, y: 120, w: 400, vpw: 368, vph: 796 }).highlight(1.0, 4.2, 'keypad', { tag: 'Código de 4 cifras', padding: 6 })
        .tap(2.2, { x: 140, y: 470, w: 100, h: 60 }).tap(3.0, { x: 260, y: 540, w: 100, h: 60 }).swap(4.4, 'telefono-conectado');
      s.caption(0.5, 3, 'Escribe el <b>código de su pista</b>: el teléfono confirma <b>«Conectado a Pista 1»</b>');
    });

    V.scene(7, (s) => {
      s.device('phone', { img: 'telefono-marcador', x: 760, y: 120, w: 400, vpw: 368, vph: 796 })
        .highlight(1.0, 3.6, { x: 16, y: 262, w: 358, h: 120 }, { tag: 'Un botón por pareja', below: true, padding: 6 })
        .highlight(3.8, 6.8, 'undo', { tag: 'Deshacer', below: true, padding: 6 });
      s.caption(0.5, 4, 'Botones grandes por pareja; <b>deshacer</b> con doble toque para evitar errores');
    }, { wipe: true });

    V.scene(9, (s) => {
      const phone = s.device('phone', { img: 'telefono-marcador', x: 150, y: 120, w: 400, vpw: 368, vph: 796, from: 'left' });
      phone.highlight(1.2, 3.0, 'pointA', { padding: 6 }).tap(2.6, 'pointA').swap(2.8, 'telefono-marcador-2');
      s.device('led', { img: 'led-marcador', x: 690, y: 250, w: 1100, at: 0.4, from: 'right' }).swap(3.0, 'led-marcador-2').highlight(3.4, 8.6, 'board', { tag: 'Pantalla LED', padding: 0, dim: false });
      s.caption(0.5, 5, 'Cada punto se ve en la LED <b>al instante</b>, con sets y saque');
    });

    V.scene(6, (s) => {
      s.device('led', { img: 'led-set-point', x: 360, y: 180, w: 1200 }).highlight(1.0, 3.2, 'rowA', { tag: 'Quien puede cerrar el set', padding: 2, dim: false })
        .swap(3.4, 'led-match-point').highlight(3.6, 5.8, 'badge', { padding: 4, dim: false });
      s.caption(0.5, 6, 'El aviso de <b>SET POINT</b> y <b>MATCH POINT</b> sale solo, con cualquier puntuación');
    }, { wipe: true });

    V.scene(8, (s) => {
      s.device('phone', { img: 'telefono-pausa', x: 150, y: 120, w: 400, vpw: 368, vph: 796, from: 'left' }).highlight(0.8, 7.8, 'banner', { padding: 6 });
      s.device('led', { img: 'led-pausa', x: 690, y: 250, w: 1100, at: 0.6, from: 'right' });
      s.caption(0.5, 7, '<b>Pausa</b>: la LED muestra tu publicidad y vuelve al marcador al reanudar');
    }, { wipe: true });

    V.scene(6.5, (s) => {
      s.device('laptop', { img: 'estacion-panel-telefono', ...LAPTOP }).focus(0.6, 'access1', { padding: 20 });
      s.caption(0.5, 8, 'La estación ve el teléfono <b>conectado</b> y siempre puede desvincularlo');
    });

    V.scene(7, (s) => {
      s.device('phone', { img: 'telefono-final', x: 150, y: 120, w: 400, vpw: 368, vph: 796, from: 'left' }).highlight(1.2, 6.8, 'stats', { padding: 4 });
      s.device('led', { img: 'led-ganador', x: 690, y: 250, w: 1100, at: 0.4, from: 'right' }).swap(3.4, 'led-resumen');
      s.caption(0.5, 9, 'Al terminar, ganadores y <b>estadísticas</b> en el teléfono y en la LED');
    }, { wipe: true });

    outro(V);
  }

  // ═════════════════════════════════════════════════════════════════
  // 3 · Pantallas LED y publicidad
  // ═════════════════════════════════════════════════════════════════
  function pantallas(V) {
    intro(V, { kicker: 'Tutorial 3', title: 'Pantallas LED y publicidad', sub: 'Marcador, cinta de patrocinadores, vídeos y ajustes de cada pantalla' });

    V.scene(7, (s) => {
      s.device('led', { img: 'led-set-point', x: 360, y: 180, w: 1200 })
        .highlight(1.0, 3.6, 'badge', { tag: 'Set point · match point', below: true, padding: 4 })
        .highlight(3.8, 6.8, 'ribbon', { tag: 'Cinta de patrocinadores', padding: 0 });
      s.caption(0.5, 1, 'Marcador legible de lejos, hecho para <b>pantallas LED</b>');
    });

    V.scene(5.5, (s) => {
      s.device('laptop', { img: 'estacion-pantalla-cinta', ...LAPTOP }).focus(0.6, 'card', { padding: 10 })
        .highlight(1.6, 5.3, 'library', { tag: 'Logos y vídeos', padding: 6 });
      s.caption(0.5, 2, '<b>Cinta</b>: logos, vídeos cortos y mensajes; el fondo de cada logo se quita solo');
    }, { wipe: true });

    V.scene(5, (s) => {
      s.device('laptop', { img: 'estacion-cinta-movimiento', ...LAPTOP }).focus(0.4, 'motionGroup', { padding: 20 })
        .highlight(1.4, 4.8, 'motion', { tag: 'Logos fijos', below: true, padding: 6 });
      s.caption(0.3, 2, 'Uno cada vez, <b>logos fijos</b> (varios a la vez) o desplazamiento continuo');
    });

    V.scene(9.5, (s) => {
      s.device('laptop', { img: 'estacion-cinta-editor-0', ...LAPTOP }).focus(0.5, 'editor', { padding: 30 })
        .tap(1.6, 'logo').swap(1.8, 'estacion-cinta-editor').highlight(2.2, 3.8, 'handle', { tag: 'Tirador', padding: 10, dim: false })
        .tap(4.0, 'handle').swap(4.4, 'estacion-cinta-editor-2').focus(5.4, 'list', { padding: 20 }).highlight(6.0, 9.2, 'grip', { tag: 'Arrastra para ordenar', padding: 8 });
      s.caption(0.5, 3, 'Como en <b>Word</b>: haz clic en un logo y arrastra una esquina para agrandarlo', 5.2);
      s.caption(5.2, 3, 'En la lista, <b>arrastra</b> los logos (o usa las flechas) para ordenarlos');
    });

    V.scene(7.5, (s) => {
      s.device('laptop', { img: 'estacion-cinta-editor-2', ...LAPTOP }).focus(0.4, 'row', { padding: 30 }).highlight(1.2, 7.2, 'effect', { tag: 'Realce', padding: 8 });
      s.caption(0.5, 4, '<b>Realce</b>, si un logo no se lee en la LED: definir, contorno blanco o los dos');
    }, { wipe: true });

    V.scene(6, (s) => {
      s.device('led', { img: 'led-cinta', x: 360, y: 180, w: 1200 }).highlight(0.8, 5.8, 'ribbon', { padding: 0, dim: false });
      s.caption(0.5, 4, 'Todos los logos sobre el mismo fondo, <b>legibles</b> y con el tamaño que elegiste');
    });

    V.scene(7.5, (s) => {
      s.device('laptop', { img: 'estacion-pantalla-lista', ...LAPTOP }).focus(0.6, 'card', { padding: 10 })
        .highlight(1.8, 4.4, 'list', { tag: 'Imágenes y vídeos', padding: 6 }).highlight(4.6, 7.3, 'upload', { tag: 'Subir o arrastrar', padding: 6 });
      s.caption(0.5, 5, '<b>Lista de reproducción</b>: imágenes y vídeos a pantalla completa, en bucle');
    });

    V.scene(6, (s) => {
      s.device('led', { img: 'led-publicidad', x: 360, y: 180, w: 1200 });
      s.caption(0.5, 5, 'Con <b>Publicidad y vídeos</b>, la LED reproduce tu lista');
    });

    V.scene(7.5, (s) => {
      s.device('laptop', { img: 'estacion-pantalla-contenido', ...LAPTOP }).focus(0.6, 'card', { padding: 10 })
        .highlight(1.8, 4.4, 'pauseAds', { tag: 'En la pausa', padding: 6 })
        .highlight(4.6, 7.3, 'endAds', { tag: 'Al terminar', below: true, padding: 6 });
      s.caption(0.5, 6, 'Publicidad <b>automática</b> en la pausa y al terminar el partido');
    }, { wipe: true });

    V.scene(9, (s) => {
      s.device('laptop', { img: 'estacion-pantalla-salida', ...LAPTOP }).focus(0.6, 'card', { padding: 10 })
        .highlight(1.6, 3.6, 'brightness', { tag: 'Brillo de la imagen', padding: 6 })
        .highlight(3.8, 6.0, 'format', { tag: 'Monitor completo o tamaño LED', padding: 6 })
        .highlight(6.2, 8.8, 'fit', { tag: 'Publicidad: llena toda la LED', padding: 6 });
      s.caption(0.5, 7, '<b>Salida</b>: monitor, brillo, formato exacto de la LED y ajuste de la publicidad');
    });

    V.scene(10, (s) => {
      s.device('led', { img: 'led-celebracion', x: 360, y: 180, w: 1200 }).swap(3.2, 'led-ganador').swap(6.2, 'led-resumen');
      s.caption(0.5, 8, 'Fin del partido: <b>celebración</b>, el marcador con el <b>ganador</b> y las <b>estadísticas</b>');
    }, { wipe: true });

    V.scene(6.5, (s) => {
      s.device('laptop', { img: 'estacion-pantalla-contenido', ...LAPTOP }).focus(0.6, 'card', { padding: 10 })
        .highlight(1.6, 6.3, 'endStats', { tag: 'Mostrar las estadísticas', below: true, padding: 6 });
      s.caption(0.5, 8, 'Las estadísticas se pueden <b>quitar</b> en cada pantalla');
    });

    V.scene(5.5, (s) => {
      s.text('Para que se vea <span class="yellow">perfecto</span>', { x: 330, y: 190, size: 84, at: 0.1 });
      s.bullet({ x: 330, y: 380, iconId: 'image', html: 'Imágenes PNG/JPG y vídeos <b class="yellow">MP4 (H.264)</b>', at: 0.5 });
      s.bullet({ x: 330, y: 500, iconId: 'screen', html: 'Para LED, mejor en <b class="yellow">2:1</b> (ej. 832 × 416 o 1664 × 832)', at: 1.1 });
      s.bullet({ x: 330, y: 620, iconId: 'monitor', html: 'Monitor a <b class="yellow">1920 × 1080 · 60 Hz</b>: sin parpadeos', at: 1.7 });
    }, { wipe: true });

    outro(V);
  }

  // ═════════════════════════════════════════════════════════════════
  // 4 · Varias pantallas, En vivo y portátil remoto
  // ═════════════════════════════════════════════════════════════════
  function avanzado(V) {
    intro(V, { kicker: 'Tutorial 4', title: 'Varias pantallas y portátiles', sub: 'Hasta 8 pantallas, espejos, vista En vivo y un segundo portátil para pistas lejanas' });

    V.scene(7, (s) => {
      s.device('laptop', { img: 'estacion-panel', ...LAPTOP }).focus(0.6, { x: 760, y: 660, w: 820, h: 300 }, { padding: 0 }).highlight(1.6, 6.8, 'screensHead', { tag: 'Añadir pantalla', padding: 6 });
      s.caption(0.5, 1, 'Añade pantallas (hasta 8) y elige su <b>monitor</b>; un <b>espejo</b> repite otra');
    });

    V.scene(8, (s) => {
      s.device('laptop', { img: 'estacion-en-vivo', ...LAPTOP }).highlight(0.8, 2.6, 'tab', { tag: 'En vivo', below: true })
        .focus(2.6, { x: 30, y: 60, w: 1030, h: 620 }, { padding: 0 }).highlight(3.6, 7.8, 'tile2', { padding: 4, dim: false });
      s.caption(0.5, 2, '<b>En vivo</b>: la imagen real de cada pantalla y si está conectada');
    }, { wipe: true });

    V.scene(7, (s) => {
      s.device('laptop', { img: 'estacion-portatiles', ...LAPTOP }).focus(0.6, 'section', { padding: 10 })
        .highlight(1.6, 4.0, 'code', { tag: 'Código de enlace', padding: 6 }).highlight(4.2, 6.8, 'remote', { tag: 'Portátil enlazado', below: true, padding: 4 });
      s.caption(0.5, 3, '<b>Pista lejos</b>: otro portátil se enlaza con el código de 6 cifras');
    }, { wipe: true });

    V.scene(7.5, (s) => {
      s.device('window', { img: 'remoto-ventana', x: 470, y: 110, w: 980 }).focus(0.4, 'uses', { padding: 20 })
        .highlight(1.2, 4.0, 'station', { tag: 'Estación del moderador', below: true, padding: 6 }).highlight(4.2, 7.3, 'auto', { tag: 'Abrirla al iniciar', below: true, padding: 6 });
      s.caption(0.5, 4, 'En ese portátil eliges: la <b>estación del moderador</b> completa y/o sus <b>pantallas</b>');
    });

    V.scene(7, (s) => {
      s.device('laptop', { img: 'remoto-estacion', ...LAPTOP }).highlight(0.8, 6.8, 'title', { tag: 'Estación remota', below: true, padding: 8 });
      s.caption(0.5, 5, 'Controla partidos y pantallas <b>a la vez</b> que el portátil principal');
    });

    V.scene(7, (s) => {
      s.text('Seguro y <span class="yellow">sin sorpresas</span>', { x: 330, y: 150, size: 84, at: 0.1 });
      s.bullet({ x: 330, y: 330, iconId: 'key', html: 'Solo entra quien tiene el <b class="yellow">código de enlace</b>', at: 0.3 });
      s.bullet({ x: 330, y: 450, iconId: 'unlink', html: 'El principal puede <b class="yellow">desvincularlo</b> al instante', at: 0.9 });
      s.bullet({ x: 330, y: 570, iconId: 'check', html: 'Los puntos <b class="yellow">nunca se duplican</b>, aunque puntúen dos', at: 1.5 });
      s.bullet({ x: 330, y: 690, iconId: 'wifi', html: 'Si se corta la red, las pantallas <b class="yellow">mantienen la imagen</b>', at: 2.1 });
    }, { wipe: true });

    outro(V);
  }

  window.VIDEOS = {
    resumen:      { chip: 'StageMaster en 90 segundos', build: resumen },
    '1-estacion': { chip: 'Tutorial 1 · Estación', build: estacion },
    '2-arbitro':  { chip: 'Tutorial 2 · Árbitro', build: arbitro },
    '3-pantallas': { chip: 'Tutorial 3 · Pantallas y publicidad', build: pantallas },
    '4-avanzado': { chip: 'Tutorial 4 · Varias pantallas', build: avanzado },
  };
}());
