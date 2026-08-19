import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPowerActionNative } from '../lib/power.js';

describe('Optimizador de Planes de Energía (power.js)', () => {
  it('runPowerActionNative maneja plan vacío sin errores', async () => {
    const logs = [];
    await runPowerActionNative({ DRY_RUN: 'true' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('No se seleccionó un plan válido.')));
  });

  it('runPowerActionNative en dryRun simula la activación del plan', async () => {
    const logs = [];
    let progress = 0;
    // 381b4222-f694-41f0-9685-ff5bb260df2e es el GUID de Balanced por defecto en Windows
    await runPowerActionNative({
      DRY_RUN: 'true',
      PLAN_GUID: '381b4222-f694-41f0-9685-ff5bb260df2e',
    }, (msg) => logs.push(msg), (pct) => { progress = pct; });

    assert.ok(logs.some((l) => l.includes('Cambio de plan de energía - inicio (SIMULACION)')));
    assert.ok(logs.some((l) => l.includes('Cambio de plan de energía - fin')));
  });
});
