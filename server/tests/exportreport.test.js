import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateSystemExport } from '../lib/exportreport.js';

describe('Exportador de Informes Técnicos (exportreport.js)', () => {
  const dummyStatus = {
    cleanup: { lastScan: '2026-08-19', totalRecoverableMB: 1500, error: false },
    startup: { lastScan: '2026-08-19', total: 10, error: false },
    ram: { lastScan: '2026-08-19', standbyMb: 800, error: false },
    gaming: { lastScan: '2026-08-19', optimizedCount: 5, total: 6, error: false },
    integrity: { lastScan: '2026-08-19', dismStatus: 'SALUDABLE', sfcStatus: 'INTEGRO', healthy: true },
    contextmenu: { lastScan: '2026-08-19', activeThirdParty: 2, totalHandlers: 15 },
    oemdebloat: { lastScan: '2026-08-19', autoCount: 0, detectedCount: 1 },
  };

  it('generateSystemExport genera un informe válido en Markdown', async () => {
    const md = await generateSystemExport(dummyStatus, 'markdown');
    assert.ok(typeof md === 'string');
    assert.ok(md.includes('# Informe Técnico de Diagnóstico y Optimización del Sistema'));
    assert.ok(md.includes('Health Score'));
    assert.ok(md.includes('Telemetría de Hardware'));
    assert.ok(md.includes('1500 MB recuperables'));
  });

  it('generateSystemExport genera un payload JSON válido y parseable', async () => {
    const jsonStr = await generateSystemExport(dummyStatus, 'json');
    const parsed = JSON.parse(jsonStr);
    assert.ok(parsed.hostname);
    assert.ok(parsed.healthScore);
    assert.ok(parsed.telemetry);
    assert.equal(parsed.status.cleanup.totalRecoverableMB, 1500);
  });
});
