// Corre contra un OPTIMIZADOR_DATA_DIR temporal: no toca las carpetas reales
// de los modulos ni el sistema.
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const dataDir = mkdtempSync(join(tmpdir(), 'optimizador-test-'));
process.env.OPTIMIZADOR_DATA_DIR = dataDir;
mkdirSync(join(dataDir, 'services', 'reports'), { recursive: true });

// PROJECT_ROOT se resuelve al importar, asi que el env va antes del import.
const { makeGuard } = await import('../lib/shared.js');

const journalPath = join(dataDir, 'services-optimizer', 'reports', 'changes.json');
const readJournal = () => (existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, 'utf-8')) : []);

describe('makeGuard', () => {
  after(() => rmSync(dataDir, { recursive: true, force: true }));

  it('en dryRun NO ejecuta la operacion', async () => {
    let ejecutada = false;
    const logs = [];
    const guard = makeGuard('services', { dryRun: true, writeLog: (m) => logs.push(m) });

    const r = await guard('Detener Foo', async () => { ejecutada = true; return { code: 0 }; }, { target: 'Foo' });

    assert.equal(ejecutada, false, 'la operacion no debe ejecutarse en simulacion');
    assert.equal(r.simulated, true);
    assert.match(logs[0], /^\[SIMULACION\] Detener Foo$/);
  });

  it('en dryRun no escribe el diario', async () => {
    const guard = makeGuard('services', { dryRun: true, writeLog: () => {} });
    await guard('Detener Bar', async () => ({ code: 0 }), { target: 'Bar' });
    assert.equal(readJournal().length, 0);
  });

  it('fuera de dryRun ejecuta y anota el valor anterior', async () => {
    let ejecutada = false;
    const guard = makeGuard('services', { dryRun: false, writeLog: () => {} });

    await guard('Deshabilitar Baz', async () => { ejecutada = true; return { code: 0 }; },
      { target: 'Baz', previousValue: 'auto', newValue: 'disabled' });

    assert.equal(ejecutada, true);
    const journal = readJournal();
    assert.equal(journal.length, 1);
    assert.equal(journal[0].target, 'Baz');
    assert.equal(journal[0].previousValue, 'auto');
    assert.equal(journal[0].reversible, true, 'con previousValue debe marcarse reversible');
    assert.ok(journal[0].at, 'debe llevar timestamp');
  });

  it('marca irreversible cuando no hay valor anterior', async () => {
    const guard = makeGuard('services', { dryRun: false, writeLog: () => {} });
    await guard('Desinstalar Qux', async () => ({ code: 0 }), { target: 'Qux' });

    const last = readJournal().at(-1);
    assert.equal(last.reversible, false);
  });

  it('no anota nada si la operacion fallo', async () => {
    const guard = makeGuard('services', { dryRun: false, writeLog: () => {} });
    const antes = readJournal().length;

    const r = await guard('Detener Roto', async () => ({ code: 1, stderr: 'acceso denegado' }), { target: 'Roto' });

    assert.equal(r.ok, false);
    assert.equal(readJournal().length, antes, 'un fallo no debe quedar registrado como cambio aplicado');
  });
});
