import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateHealthScore } from '../lib/healthscore.js';

describe('Motor de Diagnóstico Global y Health Score (healthscore.js)', () => {
  it('otorga puntuación 100/100 cuando el sistema está completamente optimizado', () => {
    const perfectStatus = {
      cleanup: { temp: { total_mb: 0 }, browser_cache: { total_mb: 0 } },
      ram: { usagePercent: 40, knownProcesses: 0 },
      startup: { startup_programs: { count: 2 } },
      updates: { winget: { count: 0 }, pip: { count: 0 }, npm: { count: 0 } },
      privacy: { totalSettings: 8, hardenedCount: 8 },
      gaming: { pendingCount: 0 },
    };

    const res = calculateHealthScore(perfectStatus, {});
    assert.equal(res.score, 100);
    assert.equal(res.grade, 'Excelente');
    assert.equal(res.badgeTone, 'is-success');
    assert.equal(res.quickFixes.length, 0);
  });

  it('aplica penalizaciones acumuladas cuando hay problemas detectados', () => {
    const degradedStatus = {
      cleanup: { temp: { total_mb: 6000 }, browser_cache: { total_mb: 2000 } }, // -12
      ram: { usagePercent: 92, knownProcesses: 4 }, // -12
      startup: { startup_programs: { count: 15 } }, // -8
      updates: { winget: { count: 12 }, pip: { count: 0 }, npm: { count: 0 } }, // -10
      privacy: { totalSettings: 8, hardenedCount: 1 }, // -8
      gaming: { pendingCount: 4 }, // -8
    };

    const res = calculateHealthScore(degradedStatus, {});
    assert.ok(res.score < 50);
    assert.equal(res.grade, 'Crítico');
    assert.equal(res.badgeTone, 'is-danger');
    assert.ok(res.quickFixes.length >= 4);
    assert.ok(res.quickFixes.some((f) => f.id === 'cleanup'));
    assert.ok(res.quickFixes.some((f) => f.id === 'privacy'));
    assert.ok(res.quickFixes.some((f) => f.id === 'gaming'));
  });

  it('genera desglose completo por categorías', () => {
    const res = calculateHealthScore({}, {});
    assert.equal(res.breakdown.length, 6);
    const names = res.breakdown.map((b) => b.category);
    assert.ok(names.includes('Almacenamiento'));
    assert.ok(names.includes('Memoria RAM'));
    assert.ok(names.includes('Inicio de Sistema'));
    assert.ok(names.includes('Actualizaciones'));
    assert.ok(names.includes('Privacidad'));
    assert.ok(names.includes('Rendimiento & Gaming'));
  });
});
