'use strict';

/**
 * displayModes.win.test.js — Resoluciones de Windows en un Windows REAL (CI)
 *
 * Se ejecuta en GitHub Actions (windows-latest) antes de compilar el .exe:
 * comprueba que el código de Windows (PowerShell + C#) compila y que lee los
 * monitores y sus modos. Solo usa el modo 'test' de Windows (comprueba sin
 * cambiar nada): la pantalla del equipo de compilación no cambia.
 * En otros sistemas no hace nada.
 */

const assert = require('assert');
const displayModes = require('./displayModes');

if (!displayModes.supported()) {
  console.log('displayModes: solo en Windows (se prueba en GitHub Actions)');
  process.exit(0);
}

(async () => {
  console.log('\n🖥   STAGEMASTER — RESOLUCIONES DE WINDOWS — PRUEBAS\n');
  const devices = await displayModes.list();
  console.log(JSON.stringify(devices.map((d) => ({ ...d, modes: `${d.modes.length} modos` })), null, 2));
  if (!devices.length) {
    console.log('  ⚠  Este equipo no tiene monitores en el escritorio (sesión sin pantalla): no se puede probar más');
    return;
  }
  devices.forEach((d) => {
    assert.ok(/^\\\\\.\\DISPLAY\d+$/.test(d.device), d.device);
    assert.ok(d.current.width > 0 && d.current.height > 0, 'Modo actual');
    assert.ok(d.modes.length > 0, 'Lista de modos');
  });
  console.log('  ✅  Lista los monitores, su modo actual y los modos admitidos');

  const d = devices.find((x) => x.primary) || devices[0];
  const current = d.modes.find((m) => m.width === d.current.width && m.height === d.current.height) || d.current;
  const ok = await displayModes.apply(d.device, { width: current.width, height: current.height, hz: current.hz }, 'test');
  assert.strictEqual(ok.code, 0, `El modo actual debe ser válido: ${ok.message}`);
  console.log(`  ✅  Windows valida el modo actual (${current.width}×${current.height} @ ${current.hz} Hz) sin cambiar nada`);

  const bad = await displayModes.apply(d.device, { width: 1234, height: 77, hz: 13 }, 'test');
  assert.notStrictEqual(bad.code, 0, 'Un modo inventado no se acepta');
  console.log(`  ✅  Un modo que el monitor no admite se rechaza: ${bad.message}`);

  await assert.rejects(() => displayModes.apply('DISPLAY1; rm', current, 'test'));
  console.log('  ✅  Un nombre de monitor no válido se rechaza antes de llamar a Windows');
})().catch((err) => {
  console.error('  ❌ ', err.message);
  process.exit(1);
});
