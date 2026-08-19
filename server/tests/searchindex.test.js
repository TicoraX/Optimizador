import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARCH_SETTINGS,
  getWSearchServiceStatus,
  runSearchIndexActionNative,
} from '../lib/searchindex.js';

describe('Optimizador de Búsqueda e Indexador (searchindex.js)', () => {
  it('expone los ajustes clave de Windows Search', () => {
    assert.ok(SEARCH_SETTINGS.length >= 3);
    assert.ok(SEARCH_SETTINGS.some((s) => s.id === 'preventlowdisk'));
    assert.ok(SEARCH_SETTINGS.some((s) => s.id === 'disableencrypted'));
    assert.ok(SEARCH_SETTINGS.some((s) => s.id === 'allowcortana'));
  });

  it('getWSearchServiceStatus retorna un estado estructurado', async () => {
    const status = await getWSearchServiceStatus();
    assert.ok(typeof status.exists === 'boolean');
    assert.ok(typeof status.state === 'string');
  });

  it('runSearchIndexActionNative en dryRun no realiza mutaciones destructivas', async () => {
    const logs = [];
    await runSearchIndexActionNative({
      DRY_RUN: 'true',
      SETTINGS: 'preventlowdisk,disableencrypted',
    }, (msg) => logs.push(msg));

    assert.ok(logs.some((l) => l.includes('Iniciando optimización de directivas de Windows Search')));
    assert.ok(logs.some((l) => l.includes('finalizada')));
  });
});
