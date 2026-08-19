import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRestorePointsJson,
  validateRestoreDescription,
} from '../lib/restore.js';

describe('Puntos de restauración de Windows (restore.js)', () => {
  it('parseRestorePointsJson maneja un array de puntos de restauración', () => {
    const sample = JSON.stringify([
      {
        SequenceNumber: 15,
        Description: 'Instalación de controlador',
        CreationTime: '2026-06-18 10:30:00',
        RestorePointType: 10,
        EventType: 100,
      },
      {
        SequenceNumber: 14,
        Description: 'Optimizador D1 Pre-Clean',
        CreationTime: '2026-06-17 09:15:00',
        RestorePointType: 12,
        EventType: 100,
      },
    ]);

    const result = parseRestorePointsJson(sample);
    assert.equal(result.length, 2);
    assert.equal(result[0].sequenceNumber, 15);
    assert.equal(result[0].description, 'Instalación de controlador');
    assert.equal(result[0].type, 'DEVICE_DRIVER_INSTALL');
    assert.equal(result[1].sequenceNumber, 14);
    assert.equal(result[1].type, 'MODIFY_SETTINGS');
  });

  it('parseRestorePointsJson maneja un único objeto retornado por PowerShell', () => {
    const single = JSON.stringify({
      SequenceNumber: 1,
      Description: 'Punto inicial',
      CreationTime: '2026-01-01 00:00:00',
      RestorePointType: 0,
    });

    const result = parseRestorePointsJson(single);
    assert.equal(result.length, 1);
    assert.equal(result[0].sequenceNumber, 1);
    assert.equal(result[0].description, 'Punto inicial');
    assert.equal(result[0].type, 'APPLICATION_INSTALL');
  });

  it('parseRestorePointsJson maneja strings vacíos o corruptos', () => {
    assert.deepEqual(parseRestorePointsJson(''), []);
    assert.deepEqual(parseRestorePointsJson(null), []);
    assert.deepEqual(parseRestorePointsJson('{ not json }'), []);
  });

  it('validateRestoreDescription acepta descripciones válidas', () => {
    assert.equal(validateRestoreDescription('Punto de Seguridad 2026'), 'Punto de Seguridad 2026');
    assert.equal(validateRestoreDescription('Pre-Limpieza D1_01'), 'Pre-Limpieza D1_01');
  });

  it('validateRestoreDescription rechaza strings demasiado cortos, largos o con caracteres inválidos', () => {
    assert.throws(() => validateRestoreDescription('ab'), /entre 3 y 100 caracteres/);
    assert.throws(() => validateRestoreDescription('a'.repeat(101)), /entre 3 y 100 caracteres/);
    assert.throws(() => validateRestoreDescription('Punto <script>'), /caracteres no permitidos/);
    assert.throws(() => validateRestoreDescription(12345), /debe ser un texto/);
  });
});
