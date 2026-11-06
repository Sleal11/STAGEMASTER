'use strict';

/**
 * displayModes.js — Resoluciones REALES de los monitores (solo Windows)
 *
 * Windows solo acepta los modos (ancho × alto @ Hz) que el controlador de la
 * tarjeta gráfica da por buenos para ese monitor, según su EDID (la "ficha"
 * que envía el monitor o la tarjeta emisora LED). Un tamaño cualquiera, como
 * 1920×1120, no se puede poner desde una aplicación: hay que crearlo antes
 * como resolución personalizada (ver docs/RESOLUCIONES.md).
 *
 * Este módulo:
 *   list()                 Monitores conectados, su modo actual y los modos que admiten
 *   apply(device, mode, k) Aplica un modo. k = 'test' (solo comprueba, no cambia nada),
 *                          'dynamic' (cambia ahora, sin guardar: un reinicio lo deshace),
 *                          'try' (comprueba y, si vale, cambia ahora: 'test' + 'dynamic'
 *                          en una sola llamada) o 'persist' (guarda el modo actual como
 *                          definitivo, sin volver a cambiarlo)
 *
 * Usa las funciones de Windows EnumDisplayDevices / EnumDisplaySettings /
 * ChangeDisplaySettingsEx desde PowerShell (incluido en Windows 10 y 11):
 * no hay que instalar nada. El "volver solo si no se confirma" lo hace main.js.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFile } = require('child_process');

const TIMEOUT_MS = 20000;
const KINDS = ['test', 'dynamic', 'try', 'persist'];

const RESULT_TEXT = {
  0:  'Aplicado',
  1:  'Windows pide reiniciar el equipo para aplicarlo',
  '-1': 'El controlador de la tarjeta gráfica no pudo aplicarlo',
  '-2': 'El monitor o la tarjeta no admiten ese modo',
  '-3': 'No se pudo guardar la configuración',
  '-4': 'Opciones no válidas',
  '-5': 'Parámetros no válidos',
  '-6': 'No compatible con este modo de varias pantallas',
};

const CSHARP = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class SMDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra;
    public int dmFields;
    public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput;
    public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight;
    public int dmDisplayFlags; public int dmDisplayFrequency;
    public int dmICMMethod; public int dmICMIntent; public int dmMediaType; public int dmDitherType;
    public int dmReserved1; public int dmReserved2; public int dmPanningWidth; public int dmPanningHeight;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }

  [DllImport("user32.dll", CharSet = CharSet.Ansi)]
  static extern bool EnumDisplayDevices(string device, int index, ref DISPLAY_DEVICE info, int flags);
  [DllImport("user32.dll", CharSet = CharSet.Ansi)]
  static extern bool EnumDisplaySettings(string device, int mode, ref DEVMODE info);
  [DllImport("user32.dll", CharSet = CharSet.Ansi)]
  static extern int ChangeDisplaySettingsEx(string device, ref DEVMODE mode, IntPtr hwnd, int flags, IntPtr param);

  const int ENUM_CURRENT_SETTINGS = -1;
  const int ATTACHED_TO_DESKTOP = 0x1, PRIMARY_DEVICE = 0x4;
  const int DM_PELSWIDTH = 0x80000, DM_PELSHEIGHT = 0x100000, DM_DISPLAYFREQUENCY = 0x400000;
  const int CDS_UPDATEREGISTRY = 0x1, CDS_TEST = 0x2, CDS_NORESET = 0x10000000;

  static DEVMODE NewMode() {
    DEVMODE m = new DEVMODE();
    m.dmDeviceName = new string((char)0, 32);
    m.dmFormName = new string((char)0, 32);
    m.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    return m;
  }

  static string Json(string s) {
    StringBuilder b = new StringBuilder("\"");
    foreach (char c in s ?? "") {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c < 32) b.Append(' ');
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }

  public static string List() {
    List<string> devices = new List<string>();
    DISPLAY_DEVICE d = new DISPLAY_DEVICE();
    d.cb = Marshal.SizeOf(d);
    for (int i = 0; EnumDisplayDevices(null, i, ref d, 0); i++) {
      if ((d.StateFlags & ATTACHED_TO_DESKTOP) != 0) {
        DISPLAY_DEVICE monitor = new DISPLAY_DEVICE();
        monitor.cb = Marshal.SizeOf(monitor);
        string monitorName = EnumDisplayDevices(d.DeviceName, 0, ref monitor, 0) ? monitor.DeviceString : "";
        DEVMODE cur = NewMode();
        EnumDisplaySettings(d.DeviceName, ENUM_CURRENT_SETTINGS, ref cur);
        HashSet<string> seen = new HashSet<string>();
        List<string> modes = new List<string>();
        DEVMODE m = NewMode();
        for (int n = 0; EnumDisplaySettings(d.DeviceName, n, ref m) && n < 5000; n++) {
          if (m.dmBitsPerPel < 24) continue;
          string key = m.dmPelsWidth + "x" + m.dmPelsHeight + "@" + m.dmDisplayFrequency;
          if (seen.Add(key)) modes.Add("{\"width\":" + m.dmPelsWidth + ",\"height\":" + m.dmPelsHeight + ",\"hz\":" + m.dmDisplayFrequency + "}");
        }
        devices.Add("{\"device\":" + Json(d.DeviceName) + ",\"adapter\":" + Json(d.DeviceString) +
          ",\"monitor\":" + Json(monitorName) + ",\"primary\":" + ((d.StateFlags & PRIMARY_DEVICE) != 0 ? "true" : "false") +
          ",\"x\":" + cur.dmPositionX + ",\"y\":" + cur.dmPositionY +
          ",\"current\":{\"width\":" + cur.dmPelsWidth + ",\"height\":" + cur.dmPelsHeight + ",\"hz\":" + cur.dmDisplayFrequency + "}" +
          ",\"modes\":[" + string.Join(",", modes.ToArray()) + "]}");
      }
      d = new DISPLAY_DEVICE();
      d.cb = Marshal.SizeOf(d);
    }
    return "[" + string.Join(",", devices.ToArray()) + "]";
  }

  public static string Apply(string device, int width, int height, int hz, string kind) {
    DEVMODE m = NewMode();
    if (!EnumDisplaySettings(device, ENUM_CURRENT_SETTINGS, ref m)) return "{\"code\":-5}";
    m.dmPelsWidth = width;
    m.dmPelsHeight = height;
    m.dmDisplayFrequency = hz;
    m.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
    int flags = kind == "test" ? CDS_TEST : kind == "persist" ? (CDS_UPDATEREGISTRY | CDS_NORESET) : 0;
    if (kind == "try") {
      // Comprobar y aplicar en una sola llamada (cada llamada a PowerShell tarda segundos)
      int tested = ChangeDisplaySettingsEx(device, ref m, IntPtr.Zero, CDS_TEST, IntPtr.Zero);
      if (tested != 0) return "{\"code\":" + tested + ",\"stage\":\"test\"}";
      flags = 0;
    }
    return "{\"code\":" + ChangeDisplaySettingsEx(device, ref m, IntPtr.Zero, flags, IntPtr.Zero) + "}";
  }
}
`;

const SCRIPT = `param([string]$Action = 'list', [string]$Device = '', [int]$Width = 0, [int]$Height = 0, [int]$Hz = 0, [string]$Kind = 'test')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${CSHARP}
'@
if ($Action -eq 'list') { [Console]::Out.Write([SMDisplay]::List()) }
else { [Console]::Out.Write([SMDisplay]::Apply($Device, $Width, $Height, $Hz, $Kind)) }
`;

function supported() {
  return process.platform === 'win32';
}

/** El script se escribe en una carpeta temporal (dentro del .exe no se puede ejecutar) */
let scriptFile = null;
function ensureScript() {
  if (scriptFile && fs.existsSync(scriptFile)) return scriptFile;
  scriptFile = path.join(os.tmpdir(), `stagemaster-display-modes-${process.pid}.ps1`);
  fs.writeFileSync(scriptFile, '﻿' + SCRIPT, 'utf8');
  // Al cerrar StageMaster se borra (no se acumulan scripts en la carpeta temporal)
  const file = scriptFile;
  process.once('exit', () => { try { fs.unlinkSync(file); } catch (_) { /* ya no está */ } });
  return scriptFile;
}

function run(args) {
  return new Promise((resolve, reject) => {
    if (!supported()) { reject(new Error('Solo disponible en Windows')); return; }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureScript(), ...args],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) { reject(new Error((stderr || err.message).trim().split('\n')[0])); return; }
        try { resolve(JSON.parse(stdout.trim())); } catch (e) { reject(new Error('Respuesta inesperada de Windows: ' + stdout.slice(0, 200))); }
      });
  });
}

/** Modos únicos, de mayor a menor resolución y frecuencia */
function sortModes(modes) {
  return modes.slice().sort((a, b) => b.width * b.height - a.width * a.height || b.width - a.width || b.hz - a.hz);
}

async function list() {
  const devices = await run(['list']);
  return devices.map((d) => ({ ...d, modes: sortModes(d.modes) }));
}

/**
 * @param {string} device - '\\\\.\\DISPLAY2'
 * @param {{ width, height, hz }} mode
 * @param {'test'|'dynamic'|'try'|'persist'} kind
 * @returns {Promise<{ ok: boolean, code: number, message: string, stage?: 'test' }>}
 *   stage 'test' (solo con 'try'): Windows no aceptó el modo y no se cambió nada
 */
async function apply(device, { width, height, hz }, kind) {
  if (!/^\\\\\.\\DISPLAY\d+$/.test(device)) throw new Error('Monitor no válido');
  if (!KINDS.includes(kind)) throw new Error('Tipo de cambio no válido');
  [width, height, hz].forEach((n) => { if (!Number.isInteger(n) || n < 1 || n > 16384) throw new Error('Modo no válido'); });
  const { code, stage } = await run(['apply', '-Device', device, '-Width', String(width), '-Height', String(height), '-Hz', String(hz), '-Kind', kind]);
  return { ok: code === 0, code, stage, message: RESULT_TEXT[code] || `Error de Windows (${code})` };
}

/**
 * Empareja los monitores de Electron (monitors.describeMonitors) con los
 * dispositivos de Windows: el principal con el principal; el resto por
 * tamaño real y por orden de izquierda a derecha.
 * @returns {Object} monitorKey → dispositivo de Windows
 */
function matchDevices(monitors, devices) {
  const result = {};
  const free = devices.slice();
  const take = (monitor, device) => { result[monitor.key] = device; free.splice(free.indexOf(device), 1); };
  monitors.filter((m) => m.primary).forEach((m) => {
    const device = free.find((d) => d.primary);
    if (device) take(m, device);
  });
  const others = monitors.filter((m) => !m.primary).sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  others.forEach((m) => {
    const bySize = free.filter((d) => !d.primary && d.current.width === m.width && d.current.height === m.height)
      .sort((a, b) => a.x - b.x || a.y - b.y);
    if (bySize.length) take(m, bySize[0]);
  });
  return result;
}

module.exports = { supported, list, apply, matchDevices, sortModes };
