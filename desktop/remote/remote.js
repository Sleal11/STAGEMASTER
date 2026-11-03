/**
 * remote.js (ventana) — Control del portátil en modo «pantalla remota»
 *
 * Dibuja el estado que envía el proceso principal (desktop/remote.js) y le
 * manda las órdenes del operador por window.stagemaster (preload.js).
 */

(function () {
  'use strict';

  const api = window.stagemaster;
  const $ = (id) => document.getElementById(id);
  let current = null;
  let chosen = null;          // principal elegido de la lista { address, port }
  let nameTouched = false;

  const esc = (text) => String(text == null ? '' : text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function render(state) {
    current = state;
    // Versión: no se muestra; se ve al pasar el ratón por el logo
    $('rm-brand').title = state.build ? `StageMaster ${state.build.version} · ${state.build.commit}` : '';
    const connected = state.status === 'connected';
    $('rm-dot').className = 'dot ' + (connected ? 'ok' : state.paired ? 'warn' : '');
    $('rm-conn').textContent = {
      unpaired: 'Sin enlazar', connecting: 'Conectando…', connected: 'Conectado', reconnecting: 'Reconectando…',
    }[state.status];

    $('rm-pair').classList.toggle('hidden', state.paired);
    $('rm-linked').classList.toggle('hidden', !state.paired);
    if (state.paired) renderLinked(state);
    else renderPair(state);
  }

  // ── Sin enlazar ──────────────────────────────────────────────────

  function renderPair(state) {
    if (!nameTouched && !$('rm-name').value) $('rm-name').value = state.name || state.hostname || '';
    const found = $('rm-found');
    if (!state.discovered.length) {
      found.innerHTML = '<span class="rm-found-empty">Buscando StageMaster en la red… Si no aparece, escribe la dirección ' +
        'que se ve en la estación del principal (arriba, junto a «Red»).</span>';
    } else {
      found.innerHTML = state.discovered.map((s) => {
        const active = chosen && chosen.address === s.address && chosen.port === s.port;
        return `<button type="button" class="btn btn-secondary${active ? ' is-active' : ''}" data-address="${esc(s.address)}" data-port="${s.port}">` +
          `StageMaster en «${esc(s.name)}» · ${esc(s.address)}:${s.port}</button>`;
      }).join('');
      // Un solo principal en la red: elegido directamente
      if (!chosen && state.discovered.length === 1 && !$('rm-address').value) {
        chosen = { address: state.discovered[0].address, port: state.discovered[0].port };
        found.firstElementChild.classList.add('is-active');
      }
    }
    if (state.error) showMessage(state.error, false);
  }

  function showMessage(text, ok) {
    const msg = $('rm-pair-msg');
    msg.textContent = text || '';
    msg.classList.toggle('ok', !!ok);
  }

  /** "192.168.1.10:3001" → { address, port } */
  function parseAddress(text) {
    const value = text.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!value) return null;
    const match = value.match(/^(.+?)(?::(\d+))?$/);
    return { address: match[1], port: match[2] ? Number(match[2]) : 3000 };
  }

  $('rm-found').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-address]');
    if (!button) return;
    chosen = { address: button.dataset.address, port: Number(button.dataset.port) };
    $('rm-address').value = '';
    render(current);
  });
  $('rm-address').addEventListener('input', () => {
    chosen = null;
    document.querySelectorAll('#rm-found .is-active').forEach((b) => b.classList.remove('is-active'));
  });
  $('rm-name').addEventListener('input', () => { nameTouched = true; });
  $('rm-code').addEventListener('input', (event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6); });

  $('rm-pair-btn').addEventListener('click', () => {
    const target = parseAddress($('rm-address').value) || chosen;
    if (!target) { showMessage('Elige el portátil principal de la lista o escribe su dirección', false); return; }
    const button = $('rm-pair-btn');
    button.disabled = true;
    showMessage('Enlazando…', true);
    api.pair({ ...target, code: $('rm-code').value, name: $('rm-name').value.trim() }).then((res) => {
      button.disabled = false;
      showMessage(res.ok ? 'Enlazado' : res.message, res.ok);
      if (res.ok) $('rm-code').value = '';
    });
  });

  // ── Enlazado ─────────────────────────────────────────────────────

  function renderLinked(state) {
    const server = state.server;
    $('rm-server-chip').textContent = (server.name ? server.name + ' · ' : '') + server.address + ':' + server.port;
    const status = {
      connected:    ['Conectado. Las pantallas se actualizan en tiempo real.', ''],
      connecting:   ['Conectando con el portátil principal…', ''],
      reconnecting: ['Sin conexión con el portátil principal. Reintentando…',
        'Las pantallas siguen mostrando lo último que recibieron. ' + (state.error ? esc(state.error) + '. ' : '') +
        'Comprueba el cable de red o el Wi-Fi y que StageMaster siga abierto en el principal.'],
    }[state.status] || ['', ''];
    patch($('rm-status'), `<span>${status[0]}</span>${status[1] ? `<span class="muted">${status[1]}</span>` : ''}`);
    $('rm-retry').classList.toggle('hidden', state.status === 'connected');
    $('rm-station').disabled = state.status !== 'connected';
    $('rm-station').textContent = state.stationOpen ? 'Ir a la estación del moderador' : 'Abrir estación del moderador';

    const list = $('rm-screens');
    // No se redibuja mientras se elige en una lista
    if (list.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    if (!state.screens.length) {
      patch(list, '<span class="muted">Esperando la lista de pantallas del portátil principal…</span>');
      return;
    }
    const desktop = state.desktop;
    patch(list, state.screens.map((screen) => {
      const assigned = desktop.assignments[screen.id];
      const pref = desktop.preferences[screen.id] || 'none';
      const value = assigned || (pref === 'auto' ? 'auto' : pref === 'window' ? 'window' : 'none');
      const options = desktop.monitors.map((m) => [m.key, `${m.label} · ${m.width}×${m.height}${m.primary ? ' (pantalla de este portátil)' : ''}`])
        .concat([['auto', 'Automático (primer monitor libre)'], ['window', 'Ventana de prueba'], ['none', 'No mostrar aquí']]);
      const closed = desktop.closed.includes(screen.id);
      const sub = (screen.mirrorOf ? 'Espejo de ' + esc(screen.mirrorOf) + ' · ' : '') + 'Muestra ' + esc(screen.matchLabel) +
        (closed ? ' · ventana cerrada' : '');
      return `<div class="rm-screen">
          <div><div class="rm-screen-name">${esc(screen.label)}</div><div class="rm-screen-sub">${sub}</div></div>
          <select class="input" data-screen="${esc(screen.id)}" aria-label="Monitor de ${esc(screen.label)}">${options.map(([v, t]) =>
            `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <button type="button" class="btn btn-ghost btn-sm" data-open="${esc(screen.id)}"${assigned && !closed ? ' disabled' : ''}>Abrir ventana</button>
        </div>`;
    }).join(''));
  }

  const lastHtml = new WeakMap();
  function patch(el, html) {
    if (lastHtml.get(el) === html) return;
    lastHtml.set(el, html);
    el.innerHTML = html;
  }

  $('rm-screens').addEventListener('change', (event) => {
    const select = event.target.closest('select[data-screen]');
    if (!select) return;
    api.setMonitor(select.dataset.screen, select.value).then(() => select.blur());
  });
  $('rm-screens').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-open]');
    if (button) api.openScreen(button.dataset.open);
  });
  $('rm-retry').addEventListener('click', () => api.retry());
  $('rm-station').addEventListener('click', () => api.openStation());
  $('rm-unpair').addEventListener('click', () => {
    if (window.confirm('¿Desenlazar este portátil? Sus pantallas se apagarán y para volver a mostrarlas hará falta el código de la estación.')) api.unpair();
  });
  $('rm-main').addEventListener('click', () => api.useAsMain());

  api.onState(render);
  api.state().then(render);
  // La lista de principales encontrados caduca sola: refrescar de vez en cuando
  setInterval(() => api.state().then(render), 3000);
}());
