import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runUpdatesActionNative } from '../lib/updates.js';

describe('Gestor de Actualizaciones (updates.js)', () => {
  it('runUpdatesActionNative en dryRun no ejecuta instalaciones reales', async () => {
    const logs = [];
    let progressReported = 0;
    await runUpdatesActionNative({
      DRY_RUN: 'true',
    }, (msg) => logs.push(msg), (pct) => { progressReported = pct; });

    assert.ok(logs.some((l) => typeof l === 'string' && l.includes('Aplicar actualizaciones - inicio (SIMULACION)')));
    assert.ok(logs.some((l) => typeof l === 'string' && l.includes('Aplicar actualizaciones - fin')));
    assert.equal(progressReported, 100);
  });

  it('runUpdatesActionNative es polimórfico y acepta callback directo de output', async () => {
    const logs = [];
    await runUpdatesActionNative({ DRY_RUN: 'true' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => typeof l === 'string' && l.includes('Aplicar actualizaciones - inicio')));
  });
});
