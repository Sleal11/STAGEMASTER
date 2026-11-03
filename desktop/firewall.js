'use strict';

/**
 * firewall.js — Que los teléfonos (y los portátiles remotos) puedan conectarse (solo Windows)
 *
 * El síntoma: el árbitro escanea el QR y el teléfono dice «el servidor no
 * responde». Si el teléfono está en la misma Wi-Fi, casi siempre es el
 * FIREWALL DE WINDOWS, que bloquea las conexiones que llegan al portátil:
 *   - al abrir StageMaster por primera vez Windows pregunta «¿Permitir
 *     acceso?»; si se cierra ese aviso, crea reglas que BLOQUEAN StageMaster;
 *   - si la red está marcada como «Pública», tampoco deja entrar.
 *
 * status()  (sin permisos) ¿Hay reglas de StageMaster que permitan / bloqueen?
 *           ¿Red pública o privada? ¿A qué Wi-Fi está conectado el portátil?
 * allow()   (pide permiso de administrador una vez, ventana de Windows UAC)
 *           Quita los bloqueos de StageMaster y permite los puertos de
 *           StageMaster SOLO desde la red local (subred), en cualquier tipo de
 *           red. La regla es por puerto: sirve para cualquier versión del .exe.
 *
 * Se prueba en un Windows real en GitHub Actions (firewall.win.test.js).
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFile } = require('child_process');

const RULE_PREFIX = 'StageMaster (red local';
const RULE_TCP = 'StageMaster (red local - telefonos y pantallas)';
const RULE_UDP = 'StageMaster (red local - portatiles remotos)';
const TIMEOUT_MS = 30000;

const STATUS_SCRIPT = `$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$rules = @(Get-NetFirewallRule -Direction Inbound -Enabled True | Where-Object { $_.DisplayName -like 'StageMaster*' })
$ours = @($rules | Where-Object { $_.DisplayName -like '${RULE_PREFIX}*' -and [string]$_.Action -eq 'Allow' })
$blocks = @($rules | Where-Object { [string]$_.Action -eq 'Block' })
$profiles = @(Get-NetConnectionProfile | ForEach-Object { @{ alias = $_.InterfaceAlias; category = [string]$_.NetworkCategory } })
$wifi = ''
$line = netsh wlan show interfaces 2>$null | Select-String '^\\s*SSID\\s*:\\s*(.+)$' | Select-Object -First 1
if ($line) { $wifi = $line.Matches[0].Groups[1].Value.Trim() }
$fw = @(Get-NetFirewallProfile | Where-Object { $_.Enabled } | ForEach-Object { [string]$_.Name })
@{ ours = $ours.Count; blocks = $blocks.Count; profiles = $profiles; wifi = $wifi; firewallOn = $fw } | ConvertTo-Json -Depth 4 -Compress
`;

const ALLOW_SCRIPT = `$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -Direction Inbound | Where-Object {
  $_.DisplayName -like 'StageMaster*' -and ([string]$_.Action -eq 'Block' -or $_.DisplayName -like '${RULE_PREFIX}*')
} | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName '${RULE_TCP}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000-3005 -RemoteAddress LocalSubnet -Profile Any | Out-Null
New-NetFirewallRule -DisplayName '${RULE_UDP}' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 41234 -RemoteAddress LocalSubnet -Profile Any | Out-Null
`;

const REMOVE_SCRIPT = `Get-NetFirewallRule -Direction Inbound | Where-Object { $_.DisplayName -like '${RULE_PREFIX}*' } | Remove-NetFirewallRule`;

function supported() {
  return process.platform === 'win32';
}

function writeScript(name, content) {
  const file = path.join(os.tmpdir(), `stagemaster-${name}-${process.pid}.ps1`);
  fs.writeFileSync(file, '﻿' + content, 'utf8');
  return file;
}

function powershell(args) {
  return new Promise((resolve, reject) => {
    if (!supported()) { reject(new Error('Solo disponible en Windows')); return; }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) { reject(new Error((stderr || err.message).trim().split('\n')[0])); return; }
        resolve(stdout.trim());
      });
  });
}

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/**
 * @returns {Promise<{ ok, rule, blocked, publicNetwork, wifi, profiles, firewallOn }>}
 *   ok: StageMaster puede recibir conexiones de la red local
 */
async function status() {
  const raw = JSON.parse(await powershell(['-File', writeScript('firewall-status', STATUS_SCRIPT)]));
  const profiles = asList(raw.profiles).map((p) => ({ alias: String(p.alias || ''), category: String(p.category || '') }));
  const firewallOn = asList(raw.firewallOn).map(String);
  const rule = raw.ours >= 1;
  const blocked = raw.blocks > 0;
  return {
    ok: firewallOn.length === 0 || (rule && !blocked),
    rule,
    blocked,
    publicNetwork: profiles.some((p) => p.category === 'Public'),
    wifi: String(raw.wifi || ''),
    profiles,
    firewallOn,
  };
}

/**
 * Pide permiso de administrador (ventana de Windows) y aplica las reglas.
 * @returns {Promise<void>} Rechaza si el operador cancela el permiso
 */
async function allow() {
  const script = writeScript('firewall-allow', ALLOW_SCRIPT);
  const elevate = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
    `-ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${script}"'; exit $p.ExitCode } ` +
    `catch { Write-Error 'CANCELADO'; exit 5 }`;
  try {
    await powershell(['-Command', elevate]);
  } catch (err) {
    const error = new Error(/CANCELADO|cancel/i.test(err.message)
      ? 'Windows no dio permiso (se canceló la ventana de administrador)' : `Windows no pudo cambiar el firewall: ${err.message}`);
    error.code = 'FIREWALL';
    throw error;
  }
}

/** Solo para las pruebas en Windows (el equipo de pruebas ya es administrador) */
function removeRules() {
  return powershell(['-File', writeScript('firewall-remove', REMOVE_SCRIPT)]);
}

module.exports = { supported, status, allow, removeRules };
