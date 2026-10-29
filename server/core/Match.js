'use strict';

/**
 * Match.js — Un partido (una pista)
 *
 * Cada instancia es un partido COMPLETAMENTE AISLADO de los demás:
 * su propio estado, su propia versión, su propio archivo en disco, su
 * propio PIN y su propio teléfono vinculado. Para dos partidos simultáneos
 * se crean dos instancias (ver matchRegistry.js): no se duplica código.
 *
 * Responsabilidades (heredadas del antiguo matchManager.js):
 *   - Guardar el estado del partido (en memoria y en disco)
 *   - Puente con el motor de reglas (sports/padel/engine.js)
 *   - Protecciones: configuración válida, versión del marcador, no pisar
 *     un partido en curso sin confirmación
 *   - Estado PÚBLICO (sin historial) con version, canUndo y paused
 *   - Pausa del partido (no admite puntos hasta reanudarlo)
 *
 * Y además (nuevo):
 *   - PIN de vinculación y teléfono árbitro asociado
 *
 * VERSIÓN DEL ESTADO (control de concurrencia):
 *   Cada cambio incrementa `version`. El teléfono envía la versión que
 *   estaba viendo; si no coincide, la acción se rechaza (STALE_VERSION).
 *   Evita la doble pulsación y que dos dispositivos se pisen.
 */

const { createMatch, applyAction } = require('../sports/padel/engine');
const { validateConfig }           = require('../sports/padel/config');
const { appError }                 = require('./errors');
const auth                         = require('./auth');

/** Acciones de partido permitidas (lista blanca) */
const MATCH_ACTIONS = ['pointA', 'pointB', 'undo', 'changeServer', 'finishMatch', 'pause', 'resume'];

/** Acciones que no se aceptan con el partido en pausa (deshacer y finalizar sí) */
const BLOCKED_WHILE_PAUSED = ['pointA', 'pointB', 'changeServer'];

class Match {
  /**
   * @param {Object} options
   * @param {string} options.id    - Identificador único (ej. 'pista-1')
   * @param {string} options.label - Nombre visible (ej. 'Pista 1')
   * @param {string} options.color - Color identificativo de la pista
   * @param {Object} options.store - Almacén en disco (core/storage.js)
   */
  constructor({ id, label, color, store }) {
    this.id    = id;
    this.label = label;
    this.color = color;
    this.store = store;

    this.state      = null;   // Estado completo (con historial). null = sin partido
    this.version    = 0;
    this.paused     = false;  // Pausa (lesión, lluvia…): el marcador no admite puntos
    this.pin        = null;
    this.controller = null;   // { tokenHash, deviceName, pairedAt } | null
    this.changedAt  = Date.now();

    this.restore();
    if (!this.pin) {
      this.pin = auth.generatePin();
      this.persist();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // MARCADOR
  // ─────────────────────────────────────────────────────────────

  /**
   * Crea un partido nuevo en esta pista.
   * @param {Object}  rawConfig       - Configuración recibida
   * @param {Object}  [options]
   * @param {boolean} [options.force] - true para reemplazar un partido en curso
   */
  setup(rawConfig, { force = false } = {}) {
    if (this.state && this.state.status === 'playing' && !force) {
      throw appError('MATCH_IN_PROGRESS',
        `Hay un partido en curso en ${this.label}: ${this.state.players.A.name} vs ${this.state.players.B.name}`);
    }

    const config = validateConfig(rawConfig);
    this.paused = false;
    this.commit(createMatch(config));
    console.log(`[${this.label}] Partido creado: ${config.nameA} vs ${config.nameB} (v${this.version})`);
    return this.getPublicState();
  }

  /**
   * Aplica una acción del partido.
   * @param {string} actionName      - Ver MATCH_ACTIONS
   * @param {number} expectedVersion - Versión que veía el dispositivo
   */
  applyAction(actionName, expectedVersion) {
    if (!MATCH_ACTIONS.includes(actionName)) {
      throw appError('INVALID_ACTION', `Acción no permitida: ${actionName}`);
    }
    this.requireMatch();
    this.requireVersion(expectedVersion);

    if (actionName === 'pause' || actionName === 'resume') return this.setPaused(actionName === 'pause');
    if (this.paused && BLOCKED_WHILE_PAUSED.includes(actionName)) {
      throw appError('MATCH_PAUSED', `El partido de ${this.label} está en pausa. Reanúdalo para seguir.`);
    }

    const nextState = applyAction(this.state, actionName);
    // El motor devuelve el MISMO objeto si la acción no cambió nada (ej. undo sin historial)
    if (nextState !== this.state) {
      if (nextState.status === 'finished') this.paused = false;
      this.commit(nextState);
    }
    return this.getPublicState();
  }

  /** Pausa o reanuda (fuera del motor: no es una regla del pádel ni se deshace) */
  setPaused(paused) {
    if (this.state.status !== 'playing') {
      throw appError('INVALID_ACTION', 'Solo se puede pausar un partido en juego');
    }
    if (this.paused !== paused) {
      this.paused = paused;
      this.commit(this.state);   // Nueva versión: pantallas y teléfono se actualizan
      console.log(`[${this.label}] Partido ${paused ? 'en pausa' : 'reanudado'} (v${this.version})`);
    }
    return this.getPublicState();
  }

  /** Reinicia el partido con la misma configuración y nombres */
  reset(expectedVersion) {
    this.requireMatch();
    this.requireVersion(expectedVersion);

    this.paused = false;
    this.commit(createMatch({
      ...this.state.config,
      nameA: this.state.players.A.name,
      nameB: this.state.players.B.name,
    }));
    console.log(`[${this.label}] Partido reiniciado (v${this.version})`);
    return this.getPublicState();
  }

  /** Estado PÚBLICO (sin historial), o null si no hay partido */
  getPublicState() {
    if (!this.state) return null;
    const { history, ...publicState } = this.state;
    return { ...publicState, version: this.version, canUndo: history.length > 0, paused: this.paused };
  }

  // ─────────────────────────────────────────────────────────────
  // TELÉFONO ÁRBITRO
  // ─────────────────────────────────────────────────────────────

  /** true si el PIN coincide con el de esta pista */
  checkPin(pin) {
    return auth.safeEqual(pin, this.pin);
  }

  /**
   * Vincula un teléfono a esta pista (reemplaza al anterior, si lo había).
   * La comprobación del PIN la hace quien llama, antes.
   * @returns {string} Token que el teléfono debe guardar
   */
  pairController(deviceName) {
    const token = auth.generateToken();
    this.controller = {
      tokenHash:  auth.hashToken(token),
      deviceName: String(deviceName || 'Teléfono').slice(0, 40),
      pairedAt:   new Date().toISOString(),
    };
    this.persist();
    console.log(`[${this.label}] Teléfono vinculado: ${this.controller.deviceName}`);
    return token;
  }

  /** true si el token pertenece al teléfono vinculado a esta pista */
  verifyToken(token) {
    return !!(this.controller && token && auth.hashToken(token) === this.controller.tokenHash);
  }

  /** Retira el permiso al teléfono vinculado */
  unpairController() {
    if (!this.controller) return;
    console.log(`[${this.label}] Teléfono desvinculado: ${this.controller.deviceName}`);
    this.controller = null;
    this.persist();
  }

  /** Genera un PIN nuevo (el teléfono ya vinculado sigue funcionando) */
  regeneratePin() {
    this.pin = auth.generatePin();
    this.persist();
    return this.pin;
  }

  // ─────────────────────────────────────────────────────────────
  // INTERNO
  // ─────────────────────────────────────────────────────────────

  /** ÚNICO punto donde cambia el marcador: estado, versión y guardado */
  commit(newState) {
    this.state     = newState;
    this.version  += 1;
    this.changedAt = Date.now();
    this.persist();
  }

  persist() {
    this.store.save({
      version: this.version, state: this.state, paused: this.paused, pin: this.pin, controller: this.controller,
    });
  }

  /** Recupera lo guardado en disco (el servidor se reinició) */
  restore() {
    const saved = this.store.load();
    if (!saved) return;
    this.state      = saved.state || null;
    this.version    = saved.version;
    this.paused     = saved.paused === true && !!this.state && this.state.status === 'playing';
    this.pin        = saved.pin || null;
    this.controller = saved.controller || null;
    if (this.state) {
      console.log(`[${this.label}] Partido recuperado del disco: ` +
        `${this.state.players.A.name} vs ${this.state.players.B.name} (v${this.version})`);
    }
  }

  requireMatch() {
    if (!this.state) {
      throw appError('NO_MATCH', `No hay ningún partido iniciado en ${this.label}`);
    }
  }

  /** Rechaza acciones basadas en una versión antigua del marcador */
  requireVersion(expectedVersion) {
    if (expectedVersion !== undefined && expectedVersion !== this.version) {
      throw appError('STALE_VERSION',
        'El marcador cambió antes de aplicar la acción. Revisa el marcador y vuelve a intentarlo.');
    }
  }
}

/** Valida la forma de un partido guardado en disco (formato actual y el antiguo data/match.json) */
function isValidSavedMatch(data) {
  if (typeof data.version !== 'number') return false;
  if (data.state === null || data.state === undefined) return true;
  return !!(data.state.players && Array.isArray(data.state.history));
}

module.exports = { Match, MATCH_ACTIONS, isValidSavedMatch };
