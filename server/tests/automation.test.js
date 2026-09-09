import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  validateProfileId,
  buildProfileTaskName,
  isProfileTask,
  extractProfileId,
  registerProfileSchedule,
  toggleProfileSchedule,
  deleteProfileSchedule,
  recordScheduledExecution,
  getScheduledHistory,
  TR_MAX_LENGTH,
  TASK_PREFIX,
} from '../lib/automation.js';

describe('Módulo de Automatización de Perfiles (automation.js)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'd1-auto-test-'));
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('Validación de Perfiles y Nombres de Tarea', () => {
    it('valida perfiles existentes en la whitelist', () => {
      assert.equal(validateProfileId('gaming'), 'gaming');
      assert.equal(validateProfileId('work'), 'work');
      assert.equal(validateProfileId('battery'), 'battery');
      assert.equal(validateProfileId('dev'), 'dev');
    });

    it('rechaza perfiles inexistentes con error 400', () => {
      assert.throws(() => validateProfileId('hacker_mode'), (err) => {
        return err.statusCode === 400 && err.message.includes('no permitido');
      });
    });

    it('construye el nombre canónico de la tarea con prefijo', () => {
      assert.equal(buildProfileTaskName('gaming'), 'Optimizador_Profile_Gaming');
      assert.equal(buildProfileTaskName('work'), 'Optimizador_Profile_Work');
    });

    it('identifica y extrae perfiles válidos desde nombres de tarea', () => {
      assert.equal(isProfileTask('Optimizador_Profile_Gaming'), true);
      assert.equal(isProfileTask('Optimizador_Profile_Work'), true);
      assert.equal(isProfileTask('RandomTask_Weekly'), false);

      assert.equal(extractProfileId('Optimizador_Profile_Gaming'), 'gaming');
      assert.equal(extractProfileId('Optimizador_Profile_Work'), 'work');
      assert.equal(extractProfileId('Optimizador_Profile_Unknown'), null);
      assert.equal(extractProfileId('RandomTask'), null);
    });
  });

  describe('Registro de Tareas Programadas (dryRun)', () => {
    it('registra tarea semanal en dryRun sin invocar schtasks', async () => {
      const res = await registerProfileSchedule({
        profileId: 'gaming',
        frequency: 'weekly',
        time: '04:30',
        days: ['SUN', 'WED'],
        dryRun: true,
        scriptsDir: 'C:\\test\\scripts',
      });

      assert.equal(res.ok, true);
      assert.equal(res.simulated, true);
      assert.equal(res.taskName, 'Optimizador_Profile_Gaming');
      assert.equal(res.profileId, 'gaming');
      assert.equal(res.frequency, 'weekly');
      assert.equal(res.time, '04:30');
      assert.equal(res.days, 'SUN,WED');
      assert.ok(res.trCommand.includes('Run-Scheduled.ps1'));
      assert.ok(res.trCommand.includes('-Profile gaming'));
    });

    it('registra tarea diaria con intervalo en dryRun', async () => {
      const res = await registerProfileSchedule({
        profileId: 'work',
        frequency: 'daily',
        time: '08:00',
        intervalDays: 2,
        dryRun: true,
        scriptsDir: 'C:\\test\\scripts',
      });

      assert.equal(res.ok, true);
      assert.equal(res.simulated, true);
      assert.equal(res.taskName, 'Optimizador_Profile_Work');
      assert.equal(res.frequency, 'daily');
      assert.equal(res.time, '08:00');
    });

    it('rechaza comandos que excedan el límite de 261 caracteres de schtasks', async () => {
      const longDir = 'C:\\' + 'a'.repeat(240);
      await assert.rejects(
        () => registerProfileSchedule({
          profileId: 'gaming',
          scriptsDir: longDir,
          dryRun: true,
        }),
        (err) => err.statusCode === 400 && err.message.includes('demasiado larga'),
      );
    });

    it('rechaza horarios inválidos', async () => {
      await assert.rejects(
        () => registerProfileSchedule({
          profileId: 'gaming',
          time: '25:99',
          dryRun: true,
        }),
        (err) => err.statusCode === 400,
      );
    });
  });

  describe('Toggle y Delete (dryRun)', () => {
    it('toggleProfileSchedule simula enable/disable', async () => {
      const res1 = await toggleProfileSchedule('gaming', true, { dryRun: true });
      assert.equal(res1.ok, true);
      assert.equal(res1.simulated, true);
      assert.equal(res1.action, 'enabled');
      assert.equal(res1.taskName, 'Optimizador_Profile_Gaming');

      const res2 = await toggleProfileSchedule('Optimizador_Profile_Work', false, { dryRun: true });
      assert.equal(res2.ok, true);
      assert.equal(res2.action, 'disabled');
      assert.equal(res2.taskName, 'Optimizador_Profile_Work');
    });

    it('deleteProfileSchedule simula eliminación de tarea', async () => {
      const res = await deleteProfileSchedule('work', { dryRun: true });
      assert.equal(res.ok, true);
      assert.equal(res.simulated, true);
      assert.equal(res.action, 'deleted');
      assert.equal(res.taskName, 'Optimizador_Profile_Work');
    });

    it('rechaza tareas que no pertenezcan al prefijo', async () => {
      await assert.rejects(
        () => deleteProfileSchedule('SystemTask_DoNotTouch', { dryRun: true }),
        (err) => err.statusCode === 400,
      );
    });
  });

  describe('Historial de Ejecuciones Programadas', () => {
    it('graba y lee registros de historial correctamente', () => {
      const entry1 = recordScheduledExecution({
        profileId: 'gaming',
        success: true,
        summary: 'Optimización de latencia y timers aplicada con éxito',
        freedMB: 120.5,
        durationMs: 1450,
      }, { dataDir: tempDir });

      assert.equal(entry1.profileId, 'gaming');
      assert.equal(entry1.success, true);
      assert.equal(entry1.freedMB, 120.5);

      const entry2 = recordScheduledExecution({
        profileId: 'dev',
        success: false,
        summary: 'Fallo al purgar caché',
        error: 'Access denied',
        durationMs: 500,
      }, { dataDir: tempDir });

      const history = getScheduledHistory({ dataDir: tempDir });
      assert.equal(history.length, 2);
      // El más reciente primero
      assert.equal(history[0].profileId, 'dev');
      assert.equal(history[0].success, false);
      assert.equal(history[1].profileId, 'gaming');
      assert.equal(history[1].success, true);
    });

    it('devuelve array vacío si no existe el archivo de historial', () => {
      const history = getScheduledHistory({ dataDir: tempDir });
      assert.deepEqual(history, []);
    });
  });
});
