import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPrivacyActionNative } from '../lib/privacy.js';

describe('Optimizador de Privacidad del Sistema (privacy.js)', () => {
  it('runPrivacyActionNative maneja selección vacía sin errores', async () => {
    const logs = [];
    await runPrivacyActionNative({ DRY_RUN: 'true' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('No se seleccionaron ajustes para proteger.')));
  });

  it('runPrivacyActionNative en dryRun acepta índices y nombres de ajuste con progreso', async () => {
    const logs = [];
    let progress = 0;
    await runPrivacyActionNative({
      DRY_RUN: 'true',
      ITEMS: 'telemetry,ads,1',
    }, (msg) => logs.push(msg), (pct) => { progress = pct; });

    assert.ok(logs.some((l) => l.includes('Protección de privacidad - inicio (SIMULACION)')));
    assert.ok(logs.some((l) => l.includes('Protección de privacidad - fin')));
    assert.equal(progress, 100);
  });

  it('rechaza tokens numéricos malformados como 1invalid y deduplica selecciones', async () => {
    const logs = [];
    await runPrivacyActionNative({
      DRY_RUN: 'true',
      ITEMS: '1invalid,unknown_setting',
    }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('No se seleccionaron ajustes para proteger.')));

    const dupLogs = [];
    await runPrivacyActionNative({
      DRY_RUN: 'true',
      ITEMS: '1,telemetry',
    }, (msg) => dupLogs.push(msg));
    assert.ok(dupLogs.some((l) => l.includes('Simulacion: 1 ajustes se protegerian')));
  });
});
