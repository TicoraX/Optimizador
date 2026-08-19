import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDismHealth,
  parseSfcVerify,
  runIntegrityActionNative,
} from '../lib/integrity.js';

describe('Auditor de Integridad de Componentes (integrity.js)', () => {
  it('parseDismHealth identifica estados saludable, reparable y corrupto', () => {
    assert.equal(parseDismHealth('No component store corruption detected.\nThe operation completed successfully.'), 'SALUDABLE');
    assert.equal(parseDismHealth('No se detectaron daños en el almacén de componentes.'), 'SALUDABLE');
    assert.equal(parseDismHealth('The component store is repairable.'), 'REPARABLE');
    assert.equal(parseDismHealth('El almacén de componentes se puede reparar.'), 'REPARABLE');
    assert.equal(parseDismHealth('Component store corruption detected.'), 'CORRUPTO');
    assert.equal(parseDismHealth(''), 'DESCONOCIDO');
    assert.equal(parseDismHealth(null), 'DESCONOCIDO');
  });

  it('parseSfcVerify identifica estado íntegro y archivos corruptos', () => {
    assert.equal(parseSfcVerify('Windows Resource Protection did not find any integrity violations.'), 'INTEGRO');
    assert.equal(parseSfcVerify('Protección de recursos de Windows no encontró ninguna infracción de integridad.'), 'INTEGRO');
    assert.equal(parseSfcVerify('Windows Resource Protection found corrupt files but was unable to fix some of them.'), 'ARCHIVOS_CORRUPTOS');
    assert.equal(parseSfcVerify(''), 'DESCONOCIDO');
    assert.equal(parseSfcVerify(null), 'DESCONOCIDO');
  });

  it('runIntegrityActionNative en dryRun no realiza mutaciones destructivas', async () => {
    const logs = [];
    await runIntegrityActionNative({ DRY_RUN: 'true', ACTIONS: 'winsxs_cleanup' }, (msg) => logs.push(msg));
    assert.ok(logs.some((l) => l.includes('Iniciando tareas de integridad')));
    assert.ok(logs.some((l) => l.includes('finalizado')));
  });
});
