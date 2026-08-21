import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runGamingActionNative } from '../lib/gaming.js';
import { runIntegrityActionNative } from '../lib/integrity.js';
import { runContextMenuActionNative } from '../lib/contextmenu.js';
import { runOemDebloatActionNative } from '../lib/oemdebloat.js';
import { runTimersActionNative } from '../lib/timers.js';
import { runGhostDevicesActionNative } from '../lib/ghostdevices.js';
import { runSearchIndexActionNative } from '../lib/searchindex.js';
import { runDnsFlushActionNative } from '../lib/dnsflush.js';
import { runNetworkPrivacyActionNative } from '../lib/networkprivacy.js';
import { runPagefileActionNative } from '../lib/pagefile.js';
import { runWerFaultActionNative } from '../lib/werfault.js';
import { runServicesActionNative } from '../lib/services.js';
import { runAppsActionNative } from '../lib/apps.js';

describe('Validación de ejecución de acciones con parámetros (Módulos Genéricos)', () => {
  it('gaming: ejecuta en dryRun con SETTINGS seleccionados', async () => {
    const logs = [];
    await runGamingActionNative({ DRY_RUN: 'true', SETTINGS: 'gamemode,gamedvr' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando optimización Gaming & GPU')));
  });

  it('integrity: ejecuta en dryRun con ACTIONS seleccionadas', async () => {
    const logs = [];
    await runIntegrityActionNative({ DRY_RUN: 'true', ACTIONS: 'winsxs_cleanup' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando tareas de integridad')));
  });

  it('contextmenu: ejecuta en dryRun con HANDLERS seleccionados', async () => {
    const logs = [];
    await runContextMenuActionNative({ DRY_RUN: 'true', HANDLERS: 'HKCR\\*\\shellex\\ContextMenuHandlers\\Test' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando optimización del menú contextual')));
  });

  it('oemdebloat: ejecuta en dryRun con SERVICES seleccionados y MODE', async () => {
    const logs = [];
    await runOemDebloatActionNative({ DRY_RUN: 'true', SERVICES: 'TestOemService', MODE: 'demand' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando optimización de servicios OEM')));
  });

  it('timers: ejecuta en dryRun con SETTINGS seleccionados', async () => {
    const logs = [];
    await runTimersActionNative({ DRY_RUN: 'true', SETTINGS: 'disabledynamictick' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando optimización de temporizadores')));
  });

  it('ghostdevices: ejecuta en dryRun con DEVICES seleccionados', async () => {
    const logs = [];
    await runGhostDevicesActionNative({ DRY_RUN: 'true', DEVICES: 'USB\\VID_TEST' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando purga de dispositivos fantasma')));
  });

  it('searchindex: ejecuta en dryRun con SETTINGS seleccionados', async () => {
    const logs = [];
    await runSearchIndexActionNative({ DRY_RUN: 'true', SETTINGS: 'websearch' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando optimización de directivas de Windows Search')));
  });

  it('dnsflush: ejecuta en dryRun con ACTIONS seleccionadas', async () => {
    const logs = [];
    await runDnsFlushActionNative({ DRY_RUN: 'true', ACTIONS: 'flushdns' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando refresco y purga de caché DNS')));
  });

  it('networkprivacy: ejecuta en dryRun con SETTINGS seleccionados', async () => {
    const logs = [];
    await runNetworkPrivacyActionNative({ DRY_RUN: 'true', SETTINGS: 'wpad_disable' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando protección de privacidad en red')));
  });

  it('pagefile: ejecuta en dryRun con SETTINGS seleccionados', async () => {
    const logs = [];
    await runPagefileActionNative({ DRY_RUN: 'true', SETTINGS: 'disablePagingExecutive' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando optimización de memoria virtual')));
  });

  it('werfault: ejecuta en dryRun con SETTINGS seleccionados', async () => {
    const logs = [];
    await runWerFaultActionNative({ DRY_RUN: 'true', SETTINGS: 'disabled' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando optimización de Windows Error Reporting')));
  });

  it('services: ejecuta en dryRun con SERVICES seleccionados', async () => {
    const logs = [];
    await runServicesActionNative({ DRY_RUN: 'true', SERVICES: 'Spooler' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Optimizacion de Servicios')));
  });

  it('apps: ejecuta en dryRun con APPS seleccionadas', async () => {
    const logs = [];
    await runAppsActionNative({ DRY_RUN: 'true', APPS: 'TestApp.TestApp' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Desinstalacion de aplicaciones')));
  });
});
