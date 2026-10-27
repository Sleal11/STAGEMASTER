'use strict';

/**
 * network.js — Direcciones de red del portátil y códigos QR
 *
 * Responsabilidad:
 *   1. Averiguar las direcciones IPv4 del portátil y elegir la PRINCIPAL:
 *      la que deben usar los teléfonos (la del Wi-Fi/Ethernet real, no la de
 *      adaptadores virtuales de Hyper-V, WSL, VirtualBox, VPN...).
 *   2. Generar el código QR de cada pista: el árbitro lo escanea y llega
 *      directamente a introducir el PIN de esa pista.
 *
 * Los QR se generan en SVG (nítidos a cualquier tamaño) y se guardan en
 * caché: solo se regeneran si cambia la dirección (otra red, otro puerto).
 */

const os     = require('os');
const QRCode = require('qrcode');

/** Adaptadores que nunca son la red del evento */
const VIRTUAL_ADAPTER = /vethernet|virtualbox|vmware|wsl|hyper-v|loopback|bluetooth|docker|veth|^br-|tailscale|zerotier|vpn/i;

/** Prioridad de una dirección: menor = mejor candidata para los teléfonos */
function addressRank({ name, address }) {
  let rank = 0;
  if (VIRTUAL_ADAPTER.test(name)) rank += 100;
  if (address.startsWith('192.168.')) rank += 0;
  else if (address.startsWith('10.')) rank += 1;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) rank += 2;
  else if (address.startsWith('169.254.')) rank += 50;     // sin red real (autoasignada)
  else rank += 10;
  return rank;
}

/** IPv4 del portátil, la más probable primero */
function getLocalAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push({ name, address: net.address });
    }
  }
  return addresses.sort((a, b) => addressRank(a) - addressRank(b));
}

// ── Códigos QR ─────────────────────────────────────────────────────

const qrCache   = new Map();   // url → svg
const qrPending = new Set();

/**
 * Devuelve el SVG del QR de una URL si ya está generado; si no, lo genera
 * en segundo plano y llama a onReady cuando esté (para redibujar la estación).
 */
function getQrSvg(url, onReady) {
  if (qrCache.has(url)) return qrCache.get(url);
  if (!qrPending.has(url)) {
    qrPending.add(url);
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#04122B', light: '#FFFFFF' } })
      .then((svg) => {
        qrCache.set(url, svg);
        qrPending.delete(url);
        if (onReady) onReady();
      })
      .catch((err) => {
        qrPending.delete(url);
        console.warn(`[QR] No se pudo generar el código QR: ${err.message}`);
      });
  }
  return null;
}

module.exports = { getLocalAddresses, getQrSvg, addressRank };
