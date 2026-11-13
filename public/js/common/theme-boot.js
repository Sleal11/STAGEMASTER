/*
 * theme-boot.js — Pone el tema guardado ANTES de pintar la página (sin destello)
 *
 * Se carga en el <head> con data-scope="ui" (estación, teléfono) o "led"
 * (pantallas). El tema real llega del servidor (evento 'appearance', ver
 * common/theme.js) y se recuerda en este navegador para la próxima vez.
 */
(function () {
  var script = document.currentScript;
  var scope = (script && script.getAttribute('data-scope')) || 'ui';
  var theme = 'dark';
  try { theme = localStorage.getItem('stagemaster.tema.' + scope) || 'dark'; } catch (e) { /* sin almacenamiento */ }
  if (theme !== 'light' && theme !== 'alt') theme = 'dark';
  document.documentElement.setAttribute('data-theme', theme);
}());
