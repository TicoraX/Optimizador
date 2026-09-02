import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getShaderTargets, inspectDirectory, runShaderCacheScanNative, runShaderCacheActionNative,
} from '../lib/shadercache.js';

describe('Optimizador de Caché de Shaders GPU (shadercache.js)', () => {
  it('getShaderTargets expone ubicaciones para los principales fabricantes', () => {
    const targets = getShaderTargets();
    assert.ok(Array.isArray(targets));
    assert.ok(targets.length >= 5);
    const vendors = targets.map((t) => t.vendor);
    assert.ok(vendors.includes('DirectX'));
    assert.ok(vendors.includes('NVIDIA'));
    assert.ok(vendors.includes('AMD'));
  });

  it('inspectDirectory maneja rutas inexistentes sin lanzar excepciones', async () => {
    const res = await inspectDirectory('C:\\Ruta_Falsa_Que_No_Existe_12345');
    assert.equal(res.exists, false);
    assert.equal(res.count, 0);
    assert.equal(res.bytes, 0);
  });

  it('runShaderCacheScanNative ejecuta escaneo y genera reporte', async () => {
    const outputs = [];
    const progress = [];
    const report = await runShaderCacheScanNative(
      (out) => outputs.push(out),
      (p) => progress.push(p),
    );
    assert.ok(report);
    assert.ok(report.markdown.includes('Caché de Shaders'));
    assert.ok(progress.length > 0);
  });

  it('runShaderCacheActionNative en dryRun simula la purga sin borrar archivos', async () => {
    const outputs = [];
    const res = await runShaderCacheActionNative(
      { DRY_RUN: 'true', CACHES: 'directx,nvidia_dxcache' },
      (out) => outputs.push(out),
      () => {},
    );
    assert.equal(res.ok, true);
    assert.equal(res.dryRun, true);
    assert.ok(outputs.some((o) => o.includes('SIMULACIÓN (dryRun)')));
  });
});
