'use strict';

/**
 * matchRegistry.js — Registro de partidos (pistas)
 *
 * Crea y guarda una instancia de Match por pista. Hoy son dos pistas
 * (requisito del cliente: hasta dos partidos simultáneos), pero el número
 * sale de la lista COURTS: añadir una tercera pista es añadir una línea.
 *
 * Cada pista tiene un color identificativo que aparece en el teléfono del
 * árbitro, en la estación y en la pantalla, para que nadie confunda el
 * partido que está controlando.
 */

const { Match, isValidSavedMatch }   = require('./Match');
const { createStore, migrateFile }   = require('./storage');
const { appError }                   = require('./errors');

const COURTS = [
  { id: 'pista-1', label: 'Pista 1', color: '#38BDF8' },   // azul cielo
  { id: 'pista-2', label: 'Pista 2', color: '#F59E0B' },   // ámbar (muy distinto del 1)
];

/**
 * @param {Object} [options]
 * @param {Array}  [options.courts] - Pistas a crear (por defecto COURTS)
 */
function createMatchRegistry({ courts = COURTS } = {}) {
  // Compatibilidad: la versión de un solo partido guardaba en data/match.json
  migrateFile('match.json', `matches/${courts[0].id}.json`);

  const matches = new Map(courts.map((court) => [
    court.id,
    new Match({ ...court, store: createStore(`matches/${court.id}.json`, { validate: isValidSavedMatch }) }),
  ]));

  return {
    /** Devuelve el partido o lanza UNKNOWN_MATCH */
    get(id) {
      const match = matches.get(id);
      if (!match) throw appError('UNKNOWN_MATCH', `No existe el partido "${id}"`);
      return match;
    },
    has: (id) => matches.has(id),
    list: () => [...matches.values()],
    ids:  () => [...matches.keys()],
  };
}

module.exports = { createMatchRegistry, COURTS };
