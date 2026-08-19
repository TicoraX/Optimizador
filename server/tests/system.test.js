import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCpuUsage,
  getRamMetrics,
  parseLogicalDisks,
  formatUptime,
  getSystemTelemetry,
} from '../lib/system.js';

describe('Telemetría del sistema (system.js)', () => {
  it('getCpuUsage calcula porcentaje de uso entre 0 y 100', async () => {
    const usage = await getCpuUsage(50);
    assert.equal(typeof usage, 'number');
    assert.ok(usage >= 0 && usage <= 100, `Uso de CPU fuera de rango: ${usage}`);
  });

  it('getRamMetrics devuelve total, libre, usado y porcentaje válido', () => {
    const ram = getRamMetrics();
    assert.ok(ram.totalGB > 0, 'Total GB debe ser mayor a 0');
    assert.ok(ram.freeGB >= 0, 'Free GB no debe ser negativo');
    assert.ok(ram.usedGB >= 0, 'Used GB no debe ser negativo');
    assert.ok(ram.usagePercent >= 0 && ram.usagePercent <= 100, 'usagePercent debe estar entre 0 y 100');
  });

  it('parseLogicalDisks parsea CSV de wmic correctamente', () => {
    const sampleCsv = `
Node,DeviceID,FreeSpace,Size,VolumeName
MI-PC,C:,50000000000,100000000000,Sistema
MI-PC,D:,150000000000,500000000000,Datos
`;
    const disks = parseLogicalDisks(sampleCsv);
    assert.equal(disks.length, 2);
    assert.equal(disks[0].drive, 'C:');
    assert.equal(disks[0].volumeName, 'Sistema');
    assert.ok(disks[0].totalGB > 0);
    assert.ok(disks[0].freeGB > 0);
    assert.ok(disks[0].usagePercent >= 0 && disks[0].usagePercent <= 100);

    assert.equal(disks[1].drive, 'D:');
    assert.equal(disks[1].volumeName, 'Datos');
  });

  it('parseLogicalDisks maneja salidas vacías o corruptas sin fallar', () => {
    assert.deepEqual(parseLogicalDisks(''), []);
    assert.deepEqual(parseLogicalDisks(null), []);
    assert.deepEqual(parseLogicalDisks('invalid,header,only'), []);
  });

  it('formatUptime formatea correctamente segundos a dias, horas y minutos', () => {
    assert.equal(formatUptime(120), '2m');
    assert.equal(formatUptime(3660), '1h 1m');
    assert.equal(formatUptime(90000), '1d 1h 0m');
  });

  it('getSystemTelemetry retorna estructura completa con cpu, ram, disks y system', async () => {
    const data = await getSystemTelemetry();
    assert.ok(data.timestamp);
    assert.ok(data.cpu);
    assert.ok(data.cpu.model);
    assert.ok(data.cpu.cores > 0);
    assert.ok(data.ram);
    assert.ok(data.ram.totalGB > 0);
    assert.ok(Array.isArray(data.disks));
    assert.ok(data.system);
    assert.ok(data.system.hostname);
    assert.ok(data.system.uptimeFormatted);
  });
});
