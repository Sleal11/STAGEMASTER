'use strict';

/**
 * discovery.js — Encontrar el portátil principal en la red, sin escribir IPs
 *
 * El portátil PRINCIPAL anuncia cada 2 s por UDP (difusión a la red local):
 *   { app: 'StageMaster', v: 1, name, port, version }
 * Los portátiles en modo «pantalla remota» escuchan y lo muestran en una
 * lista ("StageMaster en 192.168.1.10:3000"). Funciona sin Internet, en la
 * misma red (mismo router o switch). Si algo lo bloquea (cortafuegos, redes
 * de invitados que aíslan equipos), se puede escribir la dirección a mano.
 *
 * Es solo un anuncio: no da ningún permiso. Para mostrar pantallas hace falta
 * el código de enlace (ver remotes.js).
 */

const dgram = require('dgram');
const os    = require('os');

const DISCOVERY_PORT = 41234;
const INTERVAL_MS    = 2000;

/** Direcciones de difusión de cada red del portátil (y la general) */
function broadcastAddresses() {
  const list = new Set(['255.255.255.255']);
  Object.values(os.networkInterfaces()).flat().forEach((net) => {
    if (!net || net.family !== 'IPv4' || net.internal || !net.netmask) return;
    const ip   = net.address.split('.').map(Number);
    const mask = net.netmask.split('.').map(Number);
    list.add(ip.map((part, i) => (part & mask[i]) | (~mask[i] & 255)).join('.'));
  });
  return [...list];
}

/**
 * Empieza a anunciar este servidor.
 * @param {Function} getInfo - () => { name, port, version }
 * @returns {{ stop: Function }}
 */
function startBeacon(getInfo, { port = DISCOVERY_PORT, intervalMs = INTERVAL_MS } = {}) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let timer = null;
  let warned = false;
  socket.on('error', (err) => {
    if (!warned) console.warn('[Descubrimiento] No se puede anunciar en la red:', err.message);
    warned = true;
  });
  socket.bind(() => {
    try { socket.setBroadcast(true); } catch (_) { return; }
    const send = () => {
      const message = Buffer.from(JSON.stringify({ app: 'StageMaster', v: 1, ...getInfo() }));
      broadcastAddresses().forEach((address) => socket.send(message, port, address, () => {}));
    };
    send();
    timer = setInterval(send, intervalMs);
    timer.unref();
  });
  socket.unref();
  return {
    stop() {
      clearInterval(timer);
      try { socket.close(); } catch (_) { /* ya cerrado */ }
    },
  };
}

/**
 * Escucha los anuncios (portátil remoto).
 * @param {Function} onFound - ({ address, port, name, version }) en cada anuncio
 * @returns {{ stop: Function }}
 */
function listen(onFound, { port = DISCOVERY_PORT, onError = () => {} } = {}) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', onError);
  socket.on('message', (buffer, rinfo) => {
    try {
      const data = JSON.parse(buffer.toString('utf8'));
      if (data.app !== 'StageMaster' || !Number.isInteger(data.port)) return;
      onFound({
        address: rinfo.address,
        port:    data.port,
        name:    String(data.name || 'StageMaster').slice(0, 40),
        version: String(data.version || '').slice(0, 20),
      });
    } catch (_) { /* no es un anuncio de StageMaster */ }
  });
  socket.bind(port);
  return {
    stop() {
      try { socket.close(); } catch (_) { /* ya cerrado */ }
    },
  };
}

/** STAGEMASTER_DISCOVERY=0 lo desactiva (pruebas, o si una red no lo permite) */
function enabled() {
  return process.env.STAGEMASTER_DISCOVERY !== '0';
}

module.exports = { startBeacon, listen, broadcastAddresses, enabled, DISCOVERY_PORT };
