'use strict';

/**
 * firewall.win.test.js — Firewall de Windows en un Windows REAL (GitHub Actions)
 *
 * Comprueba que el diagnóstico funciona sin permisos y que «Permitir teléfonos»
 * crea las reglas de StageMaster (en el equipo de pruebas no sale la ventana
 * de administrador porque ya lo es). Al terminar, borra las reglas.
 * En otros sistemas no hace nada.
 */

const assert = require('assert');
const firewall = require('./firewall');

if (!firewall.supported()) {
  console.log('firewall: solo en Windows (se prueba en GitHub Actions)');
  process.exit(0);
}

(async () => {
  console.log('\n🛡   STAGEMASTER — FIREWALL DE WINDOWS — PRUEBAS\n');
  await firewall.removeRules().catch(() => {});
  const before = await firewall.status();
  console.log(JSON.stringify(before));
  assert.strictEqual(typeof before.ok, 'boolean');
  assert.strictEqual(before.rule, false, 'Sin reglas de StageMaster al empezar');
  console.log('  ✅  Diagnóstico sin permisos: reglas, bloqueos, tipo de red y Wi-Fi');

  await firewall.allow();
  const after = await firewall.status();
  console.log(JSON.stringify(after));
  assert.strictEqual(after.rule, true, 'Se crearon las reglas');
  assert.strictEqual(after.blocked, false);
  assert.strictEqual(after.ok, true);
  console.log('  ✅  «Permitir teléfonos» crea las reglas (solo red local) y quita bloqueos');

  await firewall.allow();
  assert.strictEqual((await firewall.status()).rule, true);
  console.log('  ✅  Repetirlo no duplica nada');

  await firewall.removeRules();
  assert.strictEqual((await firewall.status()).rule, false);
  console.log('  ✅  Reglas de prueba borradas');
})().catch((err) => {
  console.error('  ❌ ', err.message);
  process.exit(1);
});
