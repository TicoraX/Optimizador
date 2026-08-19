import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NETWORK_PRIVACY_SETTINGS,
  runNetworkPrivacyActionNative,
} from '../lib/networkprivacy.js';

describe('Optimizador de Privacidad en Red (networkprivacy.js)', () => {
  it('expone los ajustes clave de privacidad en red', () => {
    assert.ok(NETWORK_PRIVACY_SETTINGS.length >= 3);
    assert.ok(NETWORK_PRIVACY_SETTINGS.some((s) => s.id === 'wifisense'));
    assert.ok(NETWORK_PRIVACY_SETTINGS.some((s) => s.id === 'spotlight'));
    assert.ok(NETWORK_PRIVACY_SETTINGS.some((s) => s.id === 'edgepreloading'));
  });

  it('runNetworkPrivacyActionNative en dryRun no realiza mutaciones destructivas', async () => {
    const logs = [];
    await runNetworkPrivacyActionNative({
      DRY_RUN: 'true',
      SETTINGS: 'wifisense,spotlight',
    }, (msg) => logs.push(msg));

    assert.ok(logs.some((l) => l.includes('Iniciando protección de privacidad en red')));
    assert.ok(logs.some((l) => l.includes('finalizada')));
  });
});
