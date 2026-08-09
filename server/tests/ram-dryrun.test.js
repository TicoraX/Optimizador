// Verifica que la simulacion de RAM no ejecute NADA que mute el sistema.
//
// No mockea: corre la accion real con DRY_RUN, que es precisamente la que
// promete no tocar nada. Si la promesa se rompe, el test falla en la maquina
// donde corre. Los unicos binarios que si se invocan son `tasklist` y
// `net session`, ambos de solo lectura.
//
// Usa un OPTIMIZADOR_DATA_DIR temporal para no escribir en las carpetas reales.
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const dataDir = mkdtempSync(join(tmpdir(), 'optimizador-ram-'));
process.env.OPTIMIZADOR_DATA_DIR = dataDir;
mkdirSync(join(dataDir, 'ram-optimizer', 'reports'), { recursive: true });

const { runRamActionNative } = await import('../lib/ram.js');

describe('RAM en simulacion', () => {
  // Una sola corrida para todos los asserts: el re-escaneo con `tasklist`
  // tarda ~30 s y repetirlo por assert multiplicaba el tiempo de la suite.
  let log = '';

  before(async () => {
    const out = [];
    await runRamActionNative({ DRY_RUN: 'true', OPTIMIZE_PROCESSES: '999999' }, (l) => out.push(l));
    log = out.join('\n');
  });

  after(() => rmSync(dataDir, { recursive: true, force: true }));

  it('anuncia el vaciado de working sets como simulado, no lo ejecuta', () => {
    assert.match(log, /\[SIMULACION\] Vaciar el working set/,
      'deberia reportar que HARIA el EmptyWorkingSet');
    assert.doesNotMatch(log, /Working sets liberados\.|Error al liberar working sets\./,
      'no debe reportar el resultado de una ejecucion que no ocurrio');
  });

  it('no vacia la standby list', () => {
    // Segun si el test corre elevado o no, el camino es "OMITIDO (requiere
    // admin)" o la linea de simulacion. Lo que nunca debe aparecer es el
    // resultado de una purga real.
    assert.doesNotMatch(log, /Lista en espera vaciada correctamente/);
    assert.doesNotMatch(log, /ERROR vaciando lista en espera/);
  });

  it('no reporta procesos terminados', () => {
    assert.doesNotMatch(log, /^Liberado/m);
  });

  it('deja constancia de que fue una simulacion', () => {
    assert.match(log, /inicio \(SIMULACION\)/);
  });
});
