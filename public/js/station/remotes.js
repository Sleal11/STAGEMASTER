/**
 * remotes.js — Portátiles remotos en la estación (pantallas en otro ordenador)
 *
 * Muestra el CÓDIGO DE ENLACE que se escribe en el otro portátil, los
 * portátiles enlazados (conectado o no, su IP y qué pantalla muestra en qué
 * monitor) y permite desvincularlos. Si es la aplicación de escritorio,
 * también convertir ESTE portátil en pantalla remota.
 */

import { esc, icon } from '../common/ui.js';
import { ctx, send, toast } from './context.js';
import { confirmDialog } from './dialogs.js';

export function renderRemotes(state) {
  const section = document.getElementById('st-remotes-section');
  const remotes = state.remotes;
  section.classList.toggle('hidden', !remotes);
  if (!remotes) return;
  const card = document.getElementById('st-remotes');
  const html = codeHtml(remotes, state) + listHtml(remotes, state);
  if (card.dataset.html !== html) {
    card.dataset.html = html;
    card.innerHTML = html;
  }
}

function codeHtml(remotes, state) {
  const code = remotes.code.slice(0, 3) + ' ' + remotes.code.slice(3);
  const primary = state.network.primary;
  const where = primary ? `${esc(primary.address)}:${state.network.port}` : 'sin red';
  return `<div class="st-remote-code">
      <div>
        <div class="field-label">Código de enlace</div>
        <div class="st-code" aria-label="Código ${esc(remotes.code)}">${esc(code)}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-action="newCode">${icon('refresh')}Nuevo código</button>
      </div>
      <div class="st-remote-help">
        <p><strong>Pantallas en otro portátil</strong> (pistas lejos de este): en el otro portátil abre StageMaster,
          pulsa <em>«Usar este portátil como pantalla remota»</em>, elige <strong>«${esc(remotes.serverName)}»</strong>
          (este portátil, <code>${where}</code>) y escribe este código.</p>
        <p class="muted">Los dos portátiles en la misma red: cable Ethernet a un switch o router (lo más fiable), o Wi-Fi.
          No hace falta Internet. Todo se configura aquí: el otro portátil solo muestra.</p>
        ${state.desktop && state.desktop.canUseAsRemote
          ? `<button type="button" class="btn btn-ghost btn-sm" data-action="useAsRemote">${icon('screen')}Usar este portátil como pantalla remota</button>` : ''}
      </div>
    </div>`;
}

function listHtml(remotes, state) {
  if (!remotes.list.length) return '<div class="st-remote-empty muted">Ningún portátil remoto enlazado.</div>';
  const label = (id) => {
    const screen = state.screens.find((s) => s.id === id);
    return screen ? screen.label : id;
  };
  return `<div class="st-remote-list">${remotes.list.map((remote) => {
    const shown = Object.entries(remote.screens).filter(([, where]) => where);
    const what = shown.length
      ? shown.map(([id, where]) => `<strong>${esc(label(id))}</strong> en ${esc(where)}`).join(' · ')
      : 'No muestra ninguna pantalla (elígelas en ese portátil)';
    const status = remote.online
      ? `<span class="dot ok"></span>Conectado · ${esc(remote.address || '')}`
      : `<span class="dot bad"></span>Desconectado${remote.lastSeen ? ` <span class="muted">(hace <span data-tick-since="${remote.lastSeen}"></span>)</span>` : ''}`;
    return `<div class="st-remote">
        <div class="st-remote-main">
          <div class="st-remote-name">${icon('screen')}${esc(remote.name)}</div>
          <div class="st-status">${status}</div>
          <div class="st-remote-what">${remote.online ? what : 'Sus pantallas se reconectarán solas al volver la red'}</div>
        </div>
        <button type="button" class="btn btn-danger-ghost btn-sm" data-action="unlinkRemote" data-remote="${esc(remote.id)}" data-name="${esc(remote.name)}">${icon('unlink')}Desvincular</button>
      </div>`;
  }).join('')}</div>`;
}

export function onRemotesClick(event) {
  const el = event.target.closest('button[data-action]');
  if (!el || el.disabled) return;
  switch (el.dataset.action) {
    case 'newCode':
      confirmDialog('¿Generar un código nuevo?', 'El código actual dejará de servir. Los portátiles ya enlazados siguen funcionando.', 'Nuevo código', { danger: false })
        .then((ok) => { if (ok) send('station:remoteCode', {}, el); });
      break;
    case 'unlinkRemote':
      confirmDialog(`¿Desvincular «${el.dataset.name}»?`,
        'Sus pantallas se apagarán al momento. Para volver a usarlo hará falta el código de enlace.', 'Desvincular')
        .then((ok) => {
          if (ok) send('station:unlinkRemote', { remoteId: el.dataset.remote }, el).then((res) => { if (res.ok) toast(`${el.dataset.name} desvinculado`); });
        });
      break;
    case 'useAsRemote':
      send('station:useAsRemote', {}, el);
      break;
  }
}

/** Portátiles remotos que muestran una pantalla (para su tarjeta) */
export function remotesShowing(screenId) {
  const remotes = ctx.state && ctx.state.remotes;
  if (!remotes) return [];
  return remotes.list.filter((r) => r.online && r.screens[screenId]).map((r) => ({ name: r.name, where: r.screens[screenId] }));
}
