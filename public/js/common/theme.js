/**
 * theme.js — Temas de colores: oscuro (el de siempre), claro y alternativo (índigo)
 *
 * El tema se elige en la estación (core/appearance.js en el servidor) y llega
 * a todos los dispositivos con el evento 'appearance' { ui, led }:
 *   ui   estación, teléfonos y portátiles remotos
 *   led  pantallas (marcador, cinta, celebración y estadísticas)
 * Se aplica con <html data-theme="dark|light|alt"> (css/themes.css) y se
 * recuerda en el navegador (theme-boot.js lo pone antes de pintar).
 */

export const THEMES = ['dark', 'light', 'alt'];
export const THEME_LABELS = { dark: 'Oscuro', light: 'Claro', alt: 'Alternativo' };

/** Aplica un tema a esta página y lo recuerda para la próxima vez */
export function applyTheme(theme, scope = 'ui') {
  const value = THEMES.includes(theme) ? theme : 'dark';
  if (document.documentElement.dataset.theme !== value) document.documentElement.dataset.theme = value;
  try { localStorage.setItem('stagemaster.tema.' + scope, value); } catch (_) { /* sin almacenamiento */ }
}

/** Sigue el tema que manda el servidor (al conectar y cada vez que cambia) */
export function followTheme(socket, scope = 'ui') {
  socket.on('appearance', (appearance) => { if (appearance) applyTheme(appearance[scope], scope); });
}
