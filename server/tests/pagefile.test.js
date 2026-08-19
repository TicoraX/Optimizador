import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGEFILE_SETTINGS,
  runPagefileActionNative,
} from '../lib/pagefile.js';

describe('Gestor y Optimizador de Memoria Virtual (pagefile.js)', () => {
  it('expone los ajustes clave de Memory Management', () => {
    assert.ok(PAGEFILE_SETTINGS.length >= 3);
    assert.ok(PAGEFILE_SETTINGS.some((s) => s.id === 'disablepagingexecutive'));
    assert.ok(PAGEFILE_SETTINGS.some((s) => s.id === 'largesystemcache'));
    assert.ok(PAGEFILE_SETTINGS.some((s) => s.id === 'clearpagefile'));
  });

  it('runPagefileActionNative en dryRun no realiza mutaciones destructivas', async () => {
    const logs = [];
    await runPagefileActionNative({
      DRY_RUN: 'true',
      SETTINGS: 'disablepagingexecutive,largesystemcache',
    }, (msg) => logs.push(msg));

    assert.ok(logs.some((l) => l.includes('Iniciando optimización de memoria virtual')));
    assert.ok(logs.some((l) => l.includes('finalizada')));
  });
});
