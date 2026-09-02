import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runUpdatesScanNative, runUpdatesActionNative,
  checkWingetUpdates, checkPipUpdates, checkNpmUpdates, checkChocoUpdates,
} from '../lib/updates.js';

describe('Gestor de Actualizaciones (updates.js)', () => {
  it('checkWingetUpdates retorna estructura con conteo e items', async () => {
    const res = await checkWingetUpdates();
    assert.ok(typeof res.count === 'number');
    assert.ok(Array.isArray(res.items));
    assert.ok(typeof res.block === 'string');
    if (res.items.length > 0) {
      const first = res.items[0];
      assert.ok(first.id, 'Debe incluir ID de paquete');
      assert.ok(first.name, 'Debe incluir nombre de paquete');
      assert.equal(first.manager, 'winget');
    }
  });

  it('runUpdatesScanNative genera reporte estructurado con items', async () => {
    const logs = [];
    await runUpdatesScanNative((msg) => logs.push(msg));
    assert.ok(logs.some((l) => typeof l === 'string' && l.includes('Auditando actualizaciones')));
  });

  it('runUpdatesActionNative en dryRun con selección procesa paquetes secuencialmente', async () => {
    const logs = [];
    let lastProgress = null;
    const res = await runUpdatesActionNative({
      DRY_RUN: 'true',
      PACKAGES: 'Obsidian.Obsidian,pip:requests,npm:typescript',
    }, (msg) => logs.push(msg), (prog) => { lastProgress = prog; });

    assert.equal(res.ok, true);
    assert.equal(res.dryRun, true);
    assert.equal(res.results.length, 3);
    assert.ok(logs.some((l) => typeof l === 'string' && l.includes('Actualizando Obsidian.Obsidian')));
    assert.ok(logs.some((l) => typeof l === 'string' && l.includes('Actualizando requests (PIP)')));
    assert.ok(logs.some((l) => typeof l === 'string' && l.includes('Actualizando typescript (NPM)')));
    assert.ok(lastProgress?.percent === 100);
  });

  it('runUpdatesActionNative sin paquetes pendientes retorna de inmediato', async () => {
    const logs = [];
    const res = await runUpdatesActionNative({
      DRY_RUN: 'true',
      PACKAGES: '',
    }, (msg) => logs.push(msg));

    assert.equal(res.ok, true);
  });
});
