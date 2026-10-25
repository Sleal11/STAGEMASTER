/**
 * brand.js — Logo de StageMaster (compartido por control.html y score.html)
 *
 * Responsabilidad ÚNICA: mostrar el logo oficial si existe.
 *
 * Funcionamiento:
 *   1. Busca los elementos marcados con el atributo data-brand-logo
 *      (contienen el texto "STAGEMASTER" como respaldo).
 *   2. Intenta cargar img/logo-stagemaster.png.
 *   3. Si la imagen existe → sustituye el texto por la imagen.
 *      Si no existe → se queda el texto (nunca se ve una imagen rota).
 *
 * Para cambiar el logo basta con reemplazar el archivo PNG: no hay que
 * tocar código. El aspecto (versión blanca, tamaño) está en shared.css
 * (.brand-logo-img).
 */

'use strict';

(function () {
  var LOGO_URL = 'img/logo-stagemaster.png';

  function applyLogo() {
    var slots = document.querySelectorAll('[data-brand-logo]');
    if (slots.length === 0) return;

    var probe = new Image();

    probe.onload = function () {
      slots.forEach(function (slot) {
        var img = document.createElement('img');
        img.src       = LOGO_URL;
        img.alt       = 'StageMaster';
        img.className = 'brand-logo-img';

        slot.textContent = '';
        slot.appendChild(img);
        slot.classList.add('has-logo-image');
      });
    };

    // Sin archivo de logo: se mantiene el texto, sin errores visibles
    probe.onerror = function () {};

    probe.src = LOGO_URL;
  }

  document.addEventListener('DOMContentLoaded', applyLogo);
})();
