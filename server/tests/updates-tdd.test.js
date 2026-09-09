import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAndFilterUpdates,
} from '../lib/updates.js';

describe('TDD Ciclo 1: classifyAndFilterUpdates', () => {
  it('identifica versiones desconocidas y asigna fuentes correctamente', () => {
    const rawItems = [
      {
        id: 'CreativeTechnology.OpenAL',
        name: 'OpenAL',
        currentVersion: 'Unknown',
        availableVersion: '1.1',
        source: 'winget',
      },
      {
        id: 'XP89DCGQ3K6VLD',
        name: 'PowerToys (Preview)',
        currentVersion: '0.100.2',
        availableVersion: '0.101.2362.0',
        source: 'msstore',
      },
      {
        id: 'Microsoft.DotNet.SDK.10',
        name: 'Microsoft .NET SDK 10.0',
        currentVersion: '10.0.301',
        availableVersion: '10.0.400',
        source: 'winget',
      },
    ];

    const classified = classifyAndFilterUpdates(rawItems);

    assert.equal(classified.length, 3);
    assert.equal(classified[0].isUnknownVersion, true);
    assert.equal(classified[0].recommendedUpdate, false);

    assert.equal(classified[1].source, 'msstore');
    assert.equal(classified[1].isUnknownVersion, false);
    assert.equal(classified[1].recommendedUpdate, true);

    assert.equal(classified[2].source, 'winget');
    assert.equal(classified[2].isSystemScope, true);
    assert.equal(classified[2].recommendedUpdate, true);
  });
});

describe('TDD Ciclo 2: getBlockingProcessForPackage', () => {
  it('detecta si un proceso bloqueante está corriendo en el sistema', async () => {
    const { getBlockingProcessForPackage } = await import('../lib/updates.js');
    const mockActiveProcesses = ['chrome', 'opencode', 'discord', 'explorer'];

    // Caso 1: Proceso activo que bloquea OpenCode
    const blocking1 = getBlockingProcessForPackage('SST.OpenCodeDesktop', 'OpenCode', mockActiveProcesses);
    assert.equal(blocking1, 'opencode');

    // Caso 2: Proceso activo que bloquea Discord
    const blocking2 = getBlockingProcessForPackage('Discord.Discord', 'Discord', mockActiveProcesses);
    assert.equal(blocking2, 'discord');

    // Caso 3: Proceso que NO está activo (ej. Obsidian)
    const blocking3 = getBlockingProcessForPackage('Obsidian.Obsidian', 'Obsidian', mockActiveProcesses);
    assert.equal(blocking3, null);
  });
});

describe('TDD Ciclo 3: buildWingetUpgradeArgs', () => {
  it('genera los argumentos adecuados para winget y msstore', async () => {
    const { buildWingetUpgradeArgs } = await import('../lib/updates.js');

    // Paquete estándar winget
    const argsWinget = buildWingetUpgradeArgs({
      id: 'Obsidian.Obsidian',
      source: 'winget',
    }, { silent: true });

    assert.ok(argsWinget.includes('upgrade'));
    assert.ok(argsWinget.includes('--id'));
    assert.ok(argsWinget.includes('Obsidian.Obsidian'));
    assert.ok(argsWinget.includes('--exact'));
    assert.ok(argsWinget.includes('--source'));
    assert.ok(argsWinget.includes('winget'));
    assert.ok(argsWinget.includes('--silent'));
    assert.ok(argsWinget.includes('--disable-interactivity'));

    // Paquete msstore: no debe incluir --silent porque no lo soporta
    const argsMsStore = buildWingetUpgradeArgs({
      id: 'XP89DCGQ3K6VLD',
      source: 'msstore',
    }, { silent: true });

    assert.ok(argsMsStore.includes('--id'));
    assert.ok(argsMsStore.includes('XP89DCGQ3K6VLD'));
    assert.ok(argsMsStore.includes('--source'));
    assert.ok(argsMsStore.includes('msstore'));
    assert.equal(argsMsStore.includes('--silent'), false);
  });
});

describe('TDD Ciclo 4: runUpdatesActionNative con diagnóstico y procesos bloqueantes', () => {
  it('omite paquetes con procesos activos y emite diagnóstico en log', async () => {
    const { runUpdatesActionNative } = await import('../lib/updates.js');
    const logs = [];

    const res = await runUpdatesActionNative({
      DRY_RUN: 'true',
      PACKAGES: 'SST.OpenCodeDesktop,Obsidian.Obsidian',
      _MOCK_ACTIVE_PROCESSES: ['opencode'], // inyección para prueba determinista
    }, (msg) => logs.push(msg));

    assert.equal(res.dryRun, true);
    assert.equal(res.results.length, 2);

    const openCodeResult = res.results.find((r) => r.item === 'SST.OpenCodeDesktop');
    assert.ok(openCodeResult);
    assert.equal(openCodeResult.status, 'process_running');
    assert.equal(openCodeResult.blockingProcess, 'opencode');

    assert.ok(logs.some((l) => typeof l === 'string' && l.includes('está en ejecución')));

    const obsidianResult = res.results.find((r) => r.item === 'Obsidian.Obsidian');
    assert.ok(obsidianResult);
    assert.equal(obsidianResult.ok, true);
    assert.equal(obsidianResult.status, 'updated');
  });
});



