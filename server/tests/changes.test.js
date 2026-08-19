// Corre contra un OPTIMIZADOR_DATA_DIR temporal: no toca carpetas reales ni
// el sistema. Los reverts se prueban sin ejecutar binarios, verificando el
// control de flujo (que se rechace lo irreversible, lo ya deshecho, etc.).
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const dataDir = mkdtempSync(join(tmpdir(), 'optimizador-changes-'));
process.env.OPTIMIZADOR_DATA_DIR = dataDir;
mkdirSync(join(dataDir, 'privacy-optimizer', 'reports'), { recursive: true });

const { appendChange, readChanges } = await import('../lib/shared.js');
const { undoChange, listAllChanges } = await import('../lib/changes.js');

describe('diario de cambios', () => {
  after(() => rmSync(dataDir, { recursive: true, force: true }));

  it('asigna ids consecutivos y estables', () => {
    appendChange('privacy', { action: 'uno', target: 'a', previousValue: '1' });
    appendChange('privacy', { action: 'dos', target: 'b' });
    const j = readChanges('privacy');
    assert.deepEqual(j.map((c) => c.id), [0, 1]);
  });

  it('marca reversible solo si hay valor anterior', () => {
    const j = readChanges('privacy');
    assert.equal(j[0].reversible, true);
    assert.equal(j[1].reversible, false);
  });

  it('rechaza deshacer un cambio inexistente', async () => {
    const r = await undoChange('privacy', 999);
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  });

  it('rechaza deshacer un cambio irreversible', async () => {
    const r = await undoChange('privacy', 1);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.match(r.error, /no se puede deshacer/i);
  });

  it('rechaza modulos sin revert (ram: un proceso muerto no vuelve)', async () => {
    mkdirSync(join(dataDir, 'ram-optimizer', 'reports'), { recursive: true });
    appendChange('ram', { action: 'matar', target: 'x', previousValue: 'vivo' });
    const r = await undoChange('ram', 0);
    assert.equal(r.ok, false);
    assert.match(r.error, /no soporta deshacer/i);
  });

  it('lista los diarios de todos los modulos, mas reciente primero', () => {
    const all = listAllChanges();
    assert.ok(all.length >= 3);
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i - 1].at >= all[i].at, 'debe venir ordenado descendente');
    }
  });
});
