import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAMING_SETTINGS,
  parseRegDword,
  isOptimized,
  runGamingActionNative,
} from '../lib/gaming.js';

describe('Optimizador Gaming & GPU (gaming.js)', () => {
  it('expone los 6 ajustes clave de gaming', () => {
    assert.equal(GAMING_SETTINGS.length, 6);
    const ids = GAMING_SETTINGS.map((s) => s.id);
    assert.ok(ids.includes('hags'));
    assert.ok(ids.includes('gamemode'));
    assert.ok(ids.includes('gamedvr'));
    assert.ok(ids.includes('networkThrottle'));
    assert.ok(ids.includes('systemResponsiveness'));
  });

  it('parseRegDword extrae el valor entero correctamente desde stdout de reg', () => {
    assert.equal(parseRegDword('    HwSchMode    REG_DWORD    0x2'), '2');
    assert.equal(parseRegDword('    AllowAutoGameMode    REG_DWORD    0x1'), '1');
    assert.equal(parseRegDword('    GameDVR_Enabled    REG_DWORD    0x0'), '0');
    assert.equal(parseRegDword(''), null);
    assert.equal(parseRegDword(null), null);
  });

  it('isOptimized evalúa si el valor actual coincide con el valor optimizado', () => {
    const hags = GAMING_SETTINGS.find((s) => s.id === 'hags');
    assert.equal(isOptimized(hags, '2'), true);
    assert.equal(isOptimized(hags, '1'), false);
    assert.equal(isOptimized(hags, null), false);
  });

  it('runGamingActionNative con dryRun no realiza mutaciones destructivas', async () => {
    const logs = [];
    await runGamingActionNative({ DRY_RUN: 'true', SETTINGS: 'gamemode,gamedvr' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando optimización Gaming & GPU')));
    assert.ok(logs.some((l) => l.includes('finalizada')));
  });
});
