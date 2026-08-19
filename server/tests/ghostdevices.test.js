import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafeGhostDevice,
  parsePnpUtilDisconnected,
  runGhostDevicesActionNative,
} from '../lib/ghostdevices.js';

describe('Auditor de Dispositivos Fantasma (ghostdevices.js)', () => {
  it('isSafeGhostDevice protege dispositivos de infraestructura', () => {
    assert.equal(isSafeGhostDevice('ROOT\\ACPI_HAL\\0000', 'System'), false);
    assert.equal(isSafeGhostDevice('ACPI\\PNP0A08\\0', 'System'), false);
    assert.equal(isSafeGhostDevice('SWD\\PRINTENUM\\WSD-1234', 'Printer'), false);

    assert.equal(isSafeGhostDevice('USB\\VID_0781&PID_5583\\1234567890', 'DiskDrive'), true);
    assert.equal(isSafeGhostDevice('HID\\VID_046D&PID_C077\\6&12345', 'Mouse'), true);
    assert.equal(isSafeGhostDevice('BTHENUM\\DEV_001BDC072890\\7&123', 'Bluetooth'), true);
  });

  it('parsePnpUtilDisconnected parsea la salida en español e inglés', () => {
    const raw = `
Id. de instancia: USB\\VID_0781&PID_5583\\1234567890
Descripción del dispositivo: SanDisk Ultra USB 3.0
Nombre de clase: DiskDrive
Estado del dispositivo: Desconectado

Instance ID: HID\\VID_046D&PID_C077\\6&12345
Device Description: Logitech Optical Mouse
Class Name: Mouse
Status: Disconnected
`;
    const devices = parsePnpUtilDisconnected(raw);
    assert.equal(devices.length, 2);
    assert.equal(devices[0].name, 'SanDisk Ultra USB 3.0');
    assert.equal(devices[0].isSafe, true);
    assert.equal(devices[1].name, 'Logitech Optical Mouse');
    assert.equal(devices[1].isSafe, true);
  });

  it('runGhostDevicesActionNative en dryRun no realiza mutaciones destructivas', async () => {
    const logs = [];
    await runGhostDevicesActionNative({
      DRY_RUN: 'true',
      DEVICES: 'USB\\VID_0781&PID_5583\\1234567890',
    }, (msg) => logs.push(msg));

    assert.ok(logs.some((l) => l.includes('Iniciando purga de dispositivos fantasma')));
    assert.ok(logs.some((l) => l.includes('finalizada')));
  });
});
