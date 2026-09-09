import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getProfiles, applyProfile, PROFILES } from '../lib/profiles.js';

describe('Motor de Perfiles de Optimización (profiles.js)', () => {
  it('getProfiles expone los 4 perfiles principales', () => {
    const profiles = getProfiles();
    assert.equal(profiles.length, 4);
    const ids = profiles.map((p) => p.id);
    assert.ok(ids.includes('gaming'));
    assert.ok(ids.includes('work'));
    assert.ok(ids.includes('battery'));
    assert.ok(ids.includes('dev'));
  });

  it('applyProfile en dryRun ejecuta los pasos de forma segura sin mutaciones', async () => {
    const outputs = [];
    const res = await applyProfile('gaming', { dryRun: true }, (msg) => outputs.push(msg));
    assert.equal(res.ok, true);
    assert.equal(res.dryRun, true);
    assert.equal(res.profileId, 'gaming');
    assert.ok(res.results.length > 0);
    assert.ok(outputs.some((o) => o.includes('SIMULACIÓN (dryRun)')));
  });

  it('applyProfile con ID inexistente rechaza con 404', async () => {
    await assert.rejects(
      async () => applyProfile('perfil_falso', { dryRun: true }),
      (err) => err.statusCode === 404,
    );
  });
});
