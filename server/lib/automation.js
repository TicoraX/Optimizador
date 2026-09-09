import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import {
  PROJECT_ROOT,
  validateFrequency,
  validateTime,
  validateWeekdays,
  validateIntervalDays,
  normalizeSchTaskStatus,
  spawnCapture,
} from './shared.js';
import { PROFILES } from './profiles.js';

// ═══════════════════════════════════════════════════════
// Automatización y Tareas Programadas de Perfiles
// (server/lib/automation.js)
// ═══════════════════════════════════════════════════════

export const TR_MAX_LENGTH = 261;
export const TASK_PREFIX = 'Optimizador_Profile_';

/** Valida que el identificador corresponda a un perfil existente en la whitelist. */
export function validateProfileId(profileId) {
  const p = PROFILES.find((x) => x.id === profileId);
  if (!p) {
    const err = new Error(`Perfil '${profileId}' no permitido para automatización`);
    err.statusCode = 400;
    throw err;
  }
  return p.id;
}

/** Construye el nombre canónico de la tarea en Windows Task Scheduler. */
export function buildProfileTaskName(profileId) {
  const cleanId = validateProfileId(profileId);
  const capitalized = cleanId.charAt(0).toUpperCase() + cleanId.slice(1);
  return `${TASK_PREFIX}${capitalized}`;
}

/** Comprueba si un nombre de tarea pertenece a los perfiles del Optimizador. */
export function isProfileTask(taskName) {
  return typeof taskName === 'string' && taskName.startsWith(TASK_PREFIX);
}

/** Extrae el ID de perfil a partir del nombre de tarea. */
export function extractProfileId(taskName) {
  if (!isProfileTask(taskName)) return null;
  const suffix = taskName.slice(TASK_PREFIX.length).toLowerCase();
  return PROFILES.some((p) => p.id === suffix) ? suffix : null;
}

/**
 * Registra o actualiza una tarea programada en el Programador de Tareas de Windows.
 */
export async function registerProfileSchedule({
  profileId,
  frequency = 'weekly',
  time = '03:00',
  days = ['SUN'],
  intervalDays = 1,
  dryRun = false,
  scriptsDir,
  port = 3001,
} = {}) {
  const cleanProfile = validateProfileId(profileId);
  const validFreq = validateFrequency(frequency);
  const validTime = validateTime(time);
  const taskName = buildProfileTaskName(cleanProfile);

  const baseScriptsDir = scriptsDir || process.env.OPTIMIZADOR_SCRIPTS_DIR || join(PROJECT_ROOT, 'scripts');
  const runScheduledScript = join(baseScriptsDir, 'Run-Scheduled.ps1');

  // Comando compacto para respetar el límite estricto de 261 caracteres de Windows schtasks /TR
  const trCommand = `powershell.exe -ep Bypass -nop -w Hidden -File "${runScheduledScript}" -Profile ${cleanProfile} -Port ${port}`;

  if (trCommand.length > TR_MAX_LENGTH) {
    const err = new Error(
      `La ruta del ejecutor es demasiado larga para schtasks (${trCommand.length} de ${TR_MAX_LENGTH} caracteres).`,
    );
    err.statusCode = 400;
    throw err;
  }

  const args = [
    '/Create', '/F',
    '/TN', taskName,
    '/TR', trCommand,
    '/SC', validFreq === 'daily' ? 'DAILY' : 'WEEKLY',
    '/ST', validTime,
  ];

  let validDays;
  if (validFreq === 'weekly') {
    validDays = validateWeekdays(days);
    args.push('/D', validDays);
  } else if (intervalDays !== undefined) {
    const validInterval = validateIntervalDays(intervalDays);
    if (validInterval > 1) args.push('/MO', String(validInterval));
  }

  if (dryRun) {
    return {
      ok: true,
      simulated: true,
      taskName,
      profileId: cleanProfile,
      frequency: validFreq,
      time: validTime,
      days: validDays,
      trCommand,
    };
  }

  const result = await spawnCapture('schtasks.exe', args);
  if (result.code !== 0) {
    const err = new Error(result.stderr.trim() || 'Error al programar la tarea en Windows Task Scheduler');
    err.statusCode = 500;
    throw err;
  }

  return {
    ok: true,
    taskName,
    profileId: cleanProfile,
    frequency: validFreq,
    time: validTime,
    days: validDays,
  };
}

/**
 * Consulta todas las tareas programadas de perfiles en el Programador de Tareas.
 */
export async function listScheduledProfiles() {
  const result = await spawnCapture('schtasks.exe', ['/Query', '/FO', 'CSV', '/NH']);
  if (result.code !== 0) {
    throw new Error('No se pudieron consultar las tareas programadas');
  }

  const output = result.stdout;
  const lines = output.trim().split(/\r?\n/);
  const tasks = [];

  for (const line of lines) {
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cols.push(current); current = ''; continue; }
      current += ch;
    }
    cols.push(current);
    if (cols.length < 3) continue;

    const rawName = cols[0].trim().replace(/^\\/, '');
    if (!isProfileTask(rawName)) continue;

    const profileId = extractProfileId(rawName);
    if (!profileId) continue;

    const nextRun = cols[1].trim() || 'N/A';
    const status = normalizeSchTaskStatus(cols[2]);
    const schedule = cols[3] ? cols[3].trim() : '';

    tasks.push({
      taskName: rawName,
      profileId,
      nextRun,
      status,
      schedule,
    });
  }

  return tasks;
}

/**
 * Habilita o deshabilita una tarea de perfil existente.
 */
export async function toggleProfileSchedule(taskNameOrProfile, enable, { dryRun = false } = {}) {
  const taskName = isProfileTask(taskNameOrProfile)
    ? taskNameOrProfile
    : buildProfileTaskName(taskNameOrProfile);

  if (!isProfileTask(taskName)) {
    const err = new Error('Nombre de tarea inválido');
    err.statusCode = 400;
    throw err;
  }

  const action = enable ? 'ENABLE' : 'DISABLE';

  if (dryRun) {
    return { ok: true, simulated: true, taskName, action: enable ? 'enabled' : 'disabled' };
  }

  const result = await spawnCapture('schtasks.exe', ['/Change', '/TN', taskName, `/${action}`]);
  if (result.code !== 0) {
    const err = new Error(result.stderr.trim() || 'Error al modificar el estado de la tarea');
    err.statusCode = 500;
    throw err;
  }

  return { ok: true, taskName, action: enable ? 'enabled' : 'disabled' };
}

/**
 * Elimina una tarea programada de perfil del sistema.
 */
export async function deleteProfileSchedule(taskNameOrProfile, { dryRun = false } = {}) {
  const taskName = isProfileTask(taskNameOrProfile)
    ? taskNameOrProfile
    : buildProfileTaskName(taskNameOrProfile);

  if (!isProfileTask(taskName)) {
    const err = new Error('Nombre de tarea inválido');
    err.statusCode = 400;
    throw err;
  }

  if (dryRun) {
    return { ok: true, simulated: true, taskName, action: 'deleted' };
  }

  const result = await spawnCapture('schtasks.exe', ['/Delete', '/TN', taskName, '/F']);
  if (result.code !== 0) {
    const err = new Error(result.stderr.trim() || 'Error al eliminar la tarea programada');
    err.statusCode = 500;
    throw err;
  }

  return { ok: true, taskName, action: 'deleted' };
}

/**
 * Ruta del log estructurado de ejecuciones programadas.
 */
export function getHistoryLogPath(dataDir = PROJECT_ROOT) {
  const reportsDir = join(dataDir, 'reports');
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }
  return join(reportsDir, 'scheduled-automation.jsonl');
}

/**
 * Registra una ejecución programada en el archivo de historial.
 */
export function recordScheduledExecution(entry, { dataDir = PROJECT_ROOT } = {}) {
  const logFile = getHistoryLogPath(dataDir);
  const record = {
    timestamp: new Date().toISOString(),
    profileId: entry.profileId || 'unknown',
    success: Boolean(entry.success),
    summary: entry.summary || '',
    freedMB: typeof entry.freedMB === 'number' ? entry.freedMB : 0,
    durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : 0,
    error: entry.error || null,
  };
  appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf-8');
  return record;
}

/**
 * Lee el historial de ejecuciones programadas (más reciente primero, con límite).
 */
export function getScheduledHistory({ dataDir = PROJECT_ROOT, limit = 50 } = {}) {
  const logFile = getHistoryLogPath(dataDir);
  if (!existsSync(logFile)) return [];

  try {
    const content = readFileSync(logFile, 'utf-8');
    const lines = content.trim().split(/\r?\n/).filter(Boolean);
    const records = [];
    for (let i = lines.length - 1; i >= 0 && records.length < limit; i--) {
      try {
        records.push(JSON.parse(lines[i]));
      } catch { /* Ignora líneas corruptas */ }
    }
    return records;
  } catch {
    return [];
  }
}
