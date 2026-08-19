import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import {
  classifyFile,
  formatBytes,
  scanDirForLargeFiles,
} from '../lib/largefiles.js';

describe('Buscador de archivos gigantes (largefiles.js)', () => {
  it('classifyFile clasifica extensiones correctamente', () => {
    assert.equal(classifyFile('windows_11.iso'), 'Imagen de Disco');
    assert.equal(classifyFile('ubuntu_vm.vmdk'), 'Disco Virtual');
    assert.equal(classifyFile('gameplay.mp4'), 'Video');
    assert.equal(classifyFile('backup_2026.zip'), 'Archivo Comprimido');
    assert.equal(classifyFile('installer.msi'), 'Instalador / Paquete');
    assert.equal(classifyFile('unknown.xyz'), 'Otro archivo grande');
  });

  it('formatBytes formatea tamaños en KB, MB y GB', () => {
    assert.equal(formatBytes(500 * 1024), '500.0 KB');
    assert.equal(formatBytes(50 * 1024 * 1024), '50.0 MB');
    assert.equal(formatBytes(2.5 * 1024 * 1024 * 1024), '2.50 GB');
  });

  it('scanDirForLargeFiles detecta archivos que superan el umbral', async () => {
    const testDir = join(tmpdir(), `test_largefiles_${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Archivo de 2 MB
    const bigFile = join(testDir, 'big_archive.zip');
    writeFileSync(bigFile, Buffer.alloc(2 * 1024 * 1024));

    // Archivo pequeño de 100 KB
    const smallFile = join(testDir, 'small.txt');
    writeFileSync(smallFile, Buffer.alloc(100 * 1024));

    const found = await scanDirForLargeFiles(testDir, 1 * 1024 * 1024); // Umbral 1 MB
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'big_archive.zip');
    assert.equal(found[0].category, 'Archivo Comprimido');

    rmSync(testDir, { recursive: true, force: true });
  });
});
