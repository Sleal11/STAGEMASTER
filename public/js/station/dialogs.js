/**
 * dialogs.js — Diálogos de la estación
 *
 *   confirmDialog()    Confirmación de acciones irreversibles o que afectan
 *                      al partido en curso (devuelve una promesa true/false)
 *   openSetupDialog()  Formulario de partido (jugadores y reglas)
 */

import * as ScoreFormat from '../common/score-format.js';
import { send, toast, findMatch } from './context.js';

const $ = (id) => document.getElementById(id);
let setupTarget = null;   // Partido que se está configurando

/**
 * @param {string} title
 * @param {string} message
 * @param {string} [okText]
 * @param {Object} [options]
 * @param {boolean} [options.danger=true] - Botón rojo (acción destructiva) o azul
 */
export function confirmDialog(title, message, okText = 'Confirmar', { danger = true } = {}) {
  const dialog = $('dlg-confirm');
  const ok     = $('dlg-confirm-ok');
  const cancel = $('dlg-confirm-cancel');
  $('dlg-confirm-title').textContent   = title;
  $('dlg-confirm-message').textContent = message;
  ok.textContent = okText;
  ok.className   = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');

  return new Promise((resolve) => {
    const done = (value) => {
      ok.onclick = cancel.onclick = dialog.oncancel = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    ok.onclick      = () => done(true);
    cancel.onclick  = () => done(false);
    dialog.oncancel = () => done(false);
    dialog.showModal();
    cancel.focus();   // Enter no confirma por accidente
  });
}

/** Abre el formulario, precargado con el partido actual si existe */
export function openSetupDialog(match) {
  setupTarget = match.id;
  const form = $('form-setup');
  $('dlg-setup-title').textContent = 'Partido de ' + match.label;
  $('dlg-setup-error').classList.add('hidden');

  if (match.state) {
    const cfg = match.state.config;
    const a = ScoreFormat.splitTeamName(match.state.players.A.name);
    const b = ScoreFormat.splitTeamName(match.state.players.B.name);
    form.a1.value = a[0] || ''; form.a2.value = a[1] || '';
    form.b1.value = b[0] || ''; form.b2.value = b[1] || '';
    form.gamesPerSet.value   = cfg.gamesPerSet;
    form.totalSets.value     = cfg.totalSets;
    form.scoringSystem.value = cfg.scoringSystem;
    form.tiebreakType.value  = cfg.tiebreakType;
    form.initialServer.value = cfg.initialServer;
  }
  showScoringHelp();
  $('dlg-setup').showModal();
  form.a1.focus();
}

function submitSetup(event) {
  event.preventDefault();
  const form = event.target;
  const team = (x, y) => [form[x].value.trim(), form[y].value.trim()].filter(Boolean).join(' / ');
  const config = {
    nameA:         team('a1', 'a2'),
    nameB:         team('b1', 'b2'),
    gamesPerSet:   parseInt(form.gamesPerSet.value, 10),
    totalSets:     parseInt(form.totalSets.value, 10),
    scoringSystem: form.scoringSystem.value,
    tiebreakType:  form.tiebreakType.value,
    initialServer: form.initialServer.value,
  };
  requestSetup(setupTarget, config, false, event.submitter);
}

function requestSetup(matchId, config, force, button) {
  send('setupMatch', { matchId, config, force }, button).then((res) => {
    if (res.ok) {
      $('dlg-setup').close();
      toast('Partido iniciado en ' + findMatch(matchId).label);
      return;
    }
    if (res.code === 'MATCH_IN_PROGRESS') {
      confirmDialog('Partido en curso', res.message + '. ¿Reemplazarlo? El marcador actual se perderá.', 'Reemplazar')
        .then((ok) => { if (ok) requestSetup(matchId, config, true); });
      return;
    }
    const error = $('dlg-setup-error');
    error.textContent = res.message;
    error.classList.remove('hidden');
  });
}

/** Explica el sistema de puntuación elegido (Punto de oro ≠ Punto Estrella) */
function showScoringHelp() {
  $('scoring-help').textContent = ScoreFormat.SCORING_HELP[$('form-setup').scoringSystem.value];
}

export function initDialogs() {
  $('form-setup').addEventListener('submit', submitSetup);
  $('form-setup').scoringSystem.addEventListener('change', showScoringHelp);
  $('dlg-setup-cancel').addEventListener('click', () => $('dlg-setup').close());
}
