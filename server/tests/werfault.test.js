import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WERFAULT_SETTINGS,
  runWerFaultActionNative,
} from '../lib/werfault.js';

describe('Optimizador de Windows Error Reporting (werfault.js)', () => {
  it('expone los ajustes clave de WerFault', () => {
    assert.ok(WERFAULT_SETTINGS.length >= 3);
    assert.ok(WERFAULT_SETTINGS.some((s) => s.id === 'disabled'));
    assert.ok(WERFAULT_SETTINGS.some((s) => s.id === 'dontshowui'));
    assert.ok(WERFAULT_SETTINGS.some((s) => s.id === 'dontsenddata'));
    assert.ok(WERFAULT_SETTINGS.some((s) => s.id === 'loggingdisabled'));
  });

  it('runWerFaultActionNative en dryRun no realiza mutaciones destructivas', async () => {
    const logs = [];
    await runWerFaultActionNative({
      DRY_RUN: 'true',
      SETTINGS: 'disabled,dontshowui',
    }, (msg) => logs.push(msg));

    assert.ok(logs.some((l) => l.includes('Iniciando optimización de Windows Error Reporting')));
    assert.ok(logs.some((l) => l.includes('finalizada')));
  });
});
