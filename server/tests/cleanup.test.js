import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  getSafeTargets,
  getDirSizeMB,
  removeDirContents,
  deleteOldDownloads,
  runCleanupActionNative,
} from '../lib/cleanup.js';

describe('Limpieza segura de disco (cleanup)', () => {
  const testDir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));

  after(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('getSafeTargets expone las 9 categorías seguras con metadatos de seguridad', () => {
    const targets = getSafeTargets();
    const expected = [
      'temp', 'windowsUpdate', 'crashDumps', 'devCache', 'shaderCache',
      'browserCache', 'thumbnails', 'recycle', 'downloads',
    ];
    for (const key of expected) {
      assert.ok(targets[key], `debe incluir categoría ${key}`);
      assert.ok(targets[key].name, `debe tener nombre para ${key}`);
      assert.ok(['SAFE', 'CAUTION'].includes(targets[key].safety), `safety level válido para ${key}`);
    }
  });

  it('removeDirContents rechaza raíces de disco o profundidad <= 1', async () => {
    // Probar que si se le pasa una raíz como C:\ o C:\Windows no la borre
    const rRoot = await removeDirContents('C:\\');
    assert.equal(rRoot.deleted, 0);

    const rWin = await removeDirContents('C:\\Windows');
    assert.equal(rWin.deleted, 0);
  });

  it('removeDirContents borra contenido de un directorio temporal seguro sin borrar el contenedor', async () => {
    const targetFolder = join(testDir, 'subfolder', 'temp-work');
    mkdirSync(targetFolder, { recursive: true });
    writeFileSync(join(targetFolder, 'file1.tmp'), 'test data 1');
    writeFileSync(join(targetFolder, 'file2.tmp'), 'test data 2');
    mkdirSync(join(targetFolder, 'sub'), { recursive: true });
    writeFileSync(join(targetFolder, 'sub', 'file3.tmp'), 'test data 3');

    const result = await removeDirContents(targetFolder);
    assert.equal(result.deleted, 3);
    assert.equal(result.errors, 0);
    assert.ok(existsSync(targetFolder), 'la carpeta contenedora debe seguir existiendo');
  });

  it('deleteOldDownloads con dryRun no borra archivos', async () => {
    const r = await deleteOldDownloads(30, { dryRun: true });
    assert.equal(typeof r.deleted, 'number');
    assert.ok(Array.isArray(r.files));
  });

  it('runCleanupActionNative en dryRun no realiza mutaciones destructivas', async () => {
    const logs = [];
    const envVars = {
      CLEAN_CATEGORIES: 'temp,windowsUpdate,devCache',
      DRY_RUN: 'true',
    };

    await runCleanupActionNative(envVars, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('(SIMULACION)')));
    assert.ok(logs.some((l) => l.includes('Temporales: se liberarian')));
    assert.ok(logs.some((l) => l.includes('Windows Update Cache')));
  });

  it('runCleanupScanNative genera items estructurados con las 9 categorías', async () => {
    const { runCleanupScanNative } = await import('../lib/cleanup.js');
    const { loadItems } = await import('../lib/shared.js');
    const logs = [];
    await runCleanupScanNative({ DOWNLOADS_AGE_DAYS: 30 }, (msg) => logs.push(msg));
    const items = loadItems('cleanup');
    assert.ok(Array.isArray(items), 'items debe ser un array de categorías');
    assert.equal(items.length, 9, 'deben estar las 9 categorías');
    for (const item of items) {
      assert.ok(item.key, 'debe tener key');
      assert.ok(item.label, 'debe tener label');
      assert.equal(typeof item.sizeMB, 'number', 'sizeMB debe ser numérico');
      assert.ok(['SAFE', 'CAUTION'].includes(item.safety), 'safety level válido');
    }
  });
});
