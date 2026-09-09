import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SMARTDISK_ACTIONS, checkTrimStatus, runSmartDiskScanNative, runSmartDiskActionNative,
} from '../lib/smartdisk.js';

describe('Optimizador de Salud SSD & TRIM (smartdisk.js)', () => {
  it('expone las acciones clave de optimización TRIM', () => {
    assert.ok(Array.isArray(SMARTDISK_ACTIONS));
    assert.ok(SMARTDISK_ACTIONS.length >= 1);
    const trimAction = SMARTDISK_ACTIONS.find((a) => a.id === 'trim_all');
    assert.ok(trimAction);
    assert.equal(trimAction.type, 'TRIM_OPTIMIZE');
  });

  it('checkTrimStatus retorna estado booleano de TRIM', async () => {
    const res = await checkTrimStatus();
    assert.ok(typeof res.enabled === 'boolean');
    assert.ok(typeof res.raw === 'string');
  });

  it('runSmartDiskScanNative genera items y reporte estructurado', async () => {
    const outputs = [];
    const progress = [];
    const report = await runSmartDiskScanNative(
      (out) => outputs.push(out),
      (p) => progress.push(p),
    );
    assert.ok(report);
    assert.ok(report.markdown.includes('Salud de Discos'));
    assert.ok(progress.length > 0);
  });

  it('runSmartDiskActionNative en dryRun no ejecuta mutaciones', async () => {
    const outputs = [];
    const res = await runSmartDiskActionNative(
      { DRY_RUN: 'true' },
      (out) => outputs.push(out),
      () => {},
    );
    assert.equal(res.ok, true);
    assert.equal(res.dryRun, true);
    assert.ok(outputs.some((o) => o.includes('SIMULACIÓN (dryRun)')));
  });
});
