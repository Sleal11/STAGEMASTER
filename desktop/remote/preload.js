'use strict';

/**
 * preload.js — Puente seguro entre la ventana de control del portátil remoto
 * (remote.html, sin acceso a Node) y el proceso principal (remote.js).
 * Solo expone estas órdenes; la página no puede hacer nada más.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stagemaster', {
  state:      () => ipcRenderer.invoke('remote:state'),
  pair:       (data) => ipcRenderer.invoke('remote:pair', data),
  setMonitor: (screenId, value) => ipcRenderer.invoke('remote:setMonitor', screenId, value),
  openScreen: (screenId) => ipcRenderer.invoke('remote:openScreen', screenId),
  openStation: () => ipcRenderer.invoke('remote:openStation'),
  unpair:     () => ipcRenderer.invoke('remote:unpair'),
  retry:      () => ipcRenderer.invoke('remote:retry'),
  useAsMain:  () => ipcRenderer.invoke('remote:useAsMain'),
  onState:    (callback) => ipcRenderer.on('remote:state', (event, state) => callback(state)),
});
