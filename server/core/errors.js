'use strict';

/**
 * errors.js — Errores de aplicación con código
 *
 * Todos los rechazos que el servidor devuelve a un cliente llevan un
 * `code` estable (ej. 'WRONG_MATCH') que las interfaces usan para decidir
 * qué hacer, y un `message` en español pensado para mostrarse al usuario.
 *
 * Códigos usados en el proyecto:
 *   INVALID_CONFIG       Configuración del partido inválida
 *   MATCH_IN_PROGRESS    Ya hay un partido en curso (requiere confirmación)
 *   STALE_VERSION        Acción basada en un marcador desactualizado
 *   NO_MATCH             El partido no tiene marcador iniciado
 *   UNKNOWN_MATCH        Identificador de partido inexistente
 *   UNKNOWN_SCREEN       Identificador de pantalla inexistente
 *   INVALID_ACTION       Acción no permitida
 *   INVALID_PIN          PIN incorrecto
 *   PIN_LOCKED           Demasiados PIN incorrectos: espera temporal
 *   CONTROLLER_ACTIVE    El partido ya tiene un teléfono conectado (requiere confirmación)
 *   NOT_PAIRED           El teléfono no está vinculado (o se le retiró el permiso)
 *   WRONG_MATCH          El teléfono intenta controlar un partido que no es el suyo
 *   FORBIDDEN            Acción reservada a la estación operadora
 *   INVALID_SCREEN_CONFIG Configuración de pantalla inválida
 */

class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Crea un error de aplicación: throw appError('WRONG_MATCH', '...') */
function appError(code, message) {
  return new AppError(code, message);
}

module.exports = { AppError, appError };
