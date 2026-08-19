import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMER_SETTINGS,
  parseBcdeditOutput,
  runTimersActionNative,
} from '../lib/timers.js';

describe('Optimizador de Temporizadores del Sistema (timers.js)', () => {
  it('expone los ajustes clave de temporizadores BCD', () => {
    assert.ok(TIMER_SETTINGS.length >= 3);
    assert.ok(TIMER_SETTINGS.some((s) => s.id === 'disabledynamictick'));
    assert.ok(TIMER_SETTINGS.some((s) => s.id === 'useplatformclock'));
  });

  it('parseBcdeditOutput extrae valores de bcdedit /enum', () => {
    const raw = `
Windows Boot Loader
-------------------
identifier              {current}
device                  partition=C:
path                    \\WINDOWS\\system32\\winload.efi
description             Windows 11
disabledynamictick      Yes
useplatformclock        No
`;
    const map = parseBcdeditOutput(raw);
    assert.equal(map.disabledynamictick, 'Yes');
    assert.equal(map.useplatformclock, 'No');
    assert.equal(map.description, 'Windows 11');
  });

  it('runTimersActionNative en dryRun no realiza mutaciones destructivas', async () => {
    const logs = [];
    await runTimersActionNative({
      DRY_RUN: 'true',
      SETTINGS: 'disabledynamictick,useplatformclock',
    }, (msg) => logs.push(msg));

    assert.ok(logs.some((l) => l.includes('Iniciando optimización de temporizadores BCD')));
    assert.ok(logs.some((l) => l.includes('finalizada')));
  });
});
