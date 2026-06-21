import { existsSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { readdir, rename } from 'fs/promises';
import { join, dirname } from 'path';
import {
  MODULES, spawnCapture, isAdminWindows, parseCsvLine, parseIndexSelection,
  loadJsonSafe, normalizeSchTaskStatus,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Startup optimizer — ejecucion nativa en Node (sin powershell.exe)
//
// Mismo principio que cleanup/updates: evitar powershell.exe especificamente,
// usando binarios nativos (reg.exe, schtasks.exe) en su lugar. Limitaciones aceptadas:
//   - Los accesos directos (.lnk) de la carpeta Startup se listan por nombre de
//     archivo, sin resolver su target real (eso requeria WScript.Shell COM via
//     PowerShell). Suficiente para identificarlos y deshabilitarlos.
//   - Rendimiento de arranque (EventLog ID 100) NO se migro: `wevtutil` dio
//     "Access is denied" para un usuario no-admin incluso cuando `Get-WinEvent`
//     (PowerShell) si puede leerlo sin admin. Migrarlo significaria reintroducir
//     powershell.exe justo despues de haberlo eliminado por el bug del cuelgue,
//     para una sola metrica de baja prioridad — se decidio no hacerlo aqui.
//     Se reporta como no disponible en vez de fingir un valor.
//
// Los programas de inicio deshabilitados via registro se borran con `reg delete`,
// lo cual es IRREVERSIBLE si no se guarda el valor antes — por eso se mantiene un
// manifiesto (`disabled-registry.json`) con name/command/keyPath de cada entrada
// deshabilitada, para poder reactivarla despues con `reg add`.
// ═══════════════════════════════════════════════════════

function disabledRegistryManifestPath() {
  return join(MODULES.startup.dir, 'reports', 'disabled-registry.json');
}

function loadDisabledRegistryManifest() {
  return loadJsonSafe(disabledRegistryManifestPath(), []);
}

function saveDisabledRegistryManifest(entries) {
  const dir = join(MODULES.startup.dir, 'reports');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(disabledRegistryManifestPath(), JSON.stringify(entries, null, 2), 'utf-8');
}

const STARTUP_DISABLED_SUBDIR = 'Startup_Disabled';

const STARTUP_FOLDERS = [
  { dir: join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), label: 'Carpeta Startup (usuario)' },
  { dir: join(process.env.ProgramData || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), label: 'Carpeta Startup (global)' },
];

/** Accesos directos movidos a Startup_Disabled (deshabilitados, pendientes de reactivar). */
async function getDisabledShortcuts() {
  const entries = [];
  for (const sf of STARTUP_FOLDERS) {
    const disabledDir = join(sf.dir, STARTUP_DISABLED_SUBDIR);
    let files;
    try {
      files = await readdir(disabledDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.lnk')) continue;
      entries.push({
        name: f.replace(/\.lnk$/i, ''),
        source: sf.label,
        disabledPath: join(disabledDir, f),
        restorePath: join(sf.dir, f),
        type: 'shortcut',
      });
    }
  }
  return entries;
}

/** Combina registro + accesos directos deshabilitados en una sola lista, en orden estable. */
async function getDisabledStartupItems() {
  const registryItems = loadDisabledRegistryManifest().map((e) => ({ ...e, type: 'registry' }));
  const shortcutItems = await getDisabledShortcuts();
  return [...registryItems, ...shortcutItems];
}

/**
 * Enumera servicios con inicio Automatico via reg.exe (3 lecturas recursivas
 * de HKLM\SYSTEM\CurrentControlSet\Services: Start, DisplayName, ImagePath).
 * Sin WMI/CIM/PowerShell. ~1s en total para ~800 servicios en pruebas reales.
 */
async function getAutoStartServices() {
  const servicesKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Services';
  const [startResult, nameResult, pathResult] = await Promise.all([
    spawnCapture('reg', ['query', servicesKey, '/s', '/v', 'Start']),
    spawnCapture('reg', ['query', servicesKey, '/s', '/v', 'DisplayName']),
    spawnCapture('reg', ['query', servicesKey, '/s', '/v', 'ImagePath']),
  ]);
  if (startResult.code !== 0) return { services: [], error: true };

  const parseKeyValue = (output) => {
    const map = new Map();
    let currentKey = null;
    for (const line of output.split(/\r?\n/)) {
      if (line.startsWith('HKEY_LOCAL_MACHINE')) {
        currentKey = line.trim();
        continue;
      }
      const m = line.match(/^\s+\S+\s{2,}REG_\w+\s{2,}(.*)$/);
      if (m && currentKey) map.set(currentKey, m[1].trim());
    }
    return map;
  };

  const starts = parseKeyValue(startResult.stdout);
  const names = parseKeyValue(nameResult.stdout);
  const paths = parseKeyValue(pathResult.stdout);

  const services = [];
  for (const [keyPath, startValue] of starts) {
    // REG_DWORD se imprime como "0x2" — 2 = Automatic
    if (parseInt(startValue, 16) !== 2) continue;
    const serviceName = keyPath.split('\\').pop();
    const imagePath = paths.get(keyPath) || '';
    // Los servicios casi siempre guardan la ruta con el token literal
    // "%SystemRoot%"/"%windir%" (sin expandir) en el registro, no la ruta
    // absoluta — sin esto, la mayoria de los servicios del sistema (que
    // corren via svchost.exe) se clasificaban erroneamente como no-Microsoft.
    const isMicrosoft = !imagePath
      || /%SystemRoot%|%windir%|\\Windows\\|\\System32\\drivers\\/i.test(imagePath);
    services.push({
      name: serviceName,
      displayName: names.get(keyPath) || serviceName,
      imagePath,
      isMicrosoft,
    });
  }
  return { services, error: false };
}

const STARTUP_REG_PATHS = [
  { hive: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', label: 'Registro (HKCU)' },
  { hive: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', label: 'Registro (HKLM)' },
  { hive: 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', label: 'Registro (HKLM 32-bit)' },
];

async function getRegistryStartupEntries() {
  const entries = [];
  for (const rp of STARTUP_REG_PATHS) {
    const r = await spawnCapture('reg', ['query', rp.hive]);
    if (r.code !== 0) continue;
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.match(/^\s+(.+?)\s{2,}(REG_\w+)\s{2,}(.*)$/);
      if (m) entries.push({ name: m[1].trim(), command: m[3].trim(), source: rp.label, keyPath: rp.hive, type: 'registry' });
    }
  }
  return entries;
}

async function getShortcutStartupEntries() {
  const entries = [];
  for (const sf of STARTUP_FOLDERS) {
    let files;
    try {
      files = await readdir(sf.dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.lnk')) continue;
      entries.push({
        name: f.replace(/\.lnk$/i, ''),
        command: '(acceso directo — ver archivo)',
        source: sf.label,
        keyPath: join(sf.dir, f),
        type: 'shortcut',
      });
    }
  }
  return entries;
}

// `schtasks /query /v /fo csv` traduce los nombres de columna segun el idioma
// de Windows ("Schedule Type" → "Tipo de programacion" en es-ES, etc.), pero
// el ORDEN de columnas es fijo independientemente del idioma. Se usa la
// posicion fija como fuente de verdad y el nombre en ingles solo como
// verificacion/fallback si algun dia cambia el numero de columnas.
const SCHTASKS_COL = { TASK_NAME: 1, SCHEDULED_TASK_STATE: 11, SCHEDULE_TYPE: 18 };

async function getLogonScheduledTasks() {
  const r = await spawnCapture('schtasks', ['/query', '/v', '/fo', 'csv']);
  if (r.code !== 0) return { tasks: [], error: true };
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { tasks: [], error: true };
  const header = parseCsvLine(lines[0]);

  const colIndex = (label, fixedIdx) => {
    const named = header.indexOf(label);
    return named >= 0 ? named : fixedIdx;
  };
  const taskNameIdx = colIndex('TaskName', SCHTASKS_COL.TASK_NAME);
  const stateIdx = colIndex('Scheduled Task State', SCHTASKS_COL.SCHEDULED_TASK_STATE);
  const scheduleTypeIdx = colIndex('Schedule Type', SCHTASKS_COL.SCHEDULE_TYPE);

  const tasks = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    if (cols.length !== header.length) continue;
    const scheduleType = cols[scheduleTypeIdx] || '';
    if (!/log\s*on|startup|boot|system start|inicio|d[ée]marrage|anmeld/i.test(scheduleType)) continue;
    tasks.push({
      taskName: cols[taskNameIdx] || '',
      scheduleType,
      state: normalizeSchTaskStatus(cols[stateIdx] || ''),
    });
  }
  return { tasks, error: false };
}

export async function runStartupScanNative(onOutput) {
  const reportsDir = join(MODULES.startup.dir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportsDir, `startup-report-${today}.md`);
  const countsPath = join(reportsDir, 'startup-counts.json');

  onOutput('Revisando programas de inicio (registro)...');
  const regEntries = await getRegistryStartupEntries();
  onOutput('Revisando carpetas de inicio...');
  const shortcutEntries = await getShortcutStartupEntries();
  const allEntries = [...regEntries, ...shortcutEntries];

  onOutput('Revisando programas deshabilitados...');
  const disabledEntries = await getDisabledStartupItems();

  onOutput('Revisando servicios con inicio automatico...');
  const { services, error: servicesError } = await getAutoStartServices();
  const nonMsServices = services.filter((s) => !s.isMicrosoft);

  onOutput('Revisando tareas programadas de inicio/logon...');
  const { tasks: logonTasks, error: tasksError } = await getLogonScheduledTasks();
  const enabledTasks = logonTasks.filter((t) => t.state !== 'Disabled');
  const disabledTasks = logonTasks.filter((t) => t.state === 'Disabled');

  const lines = [
    `# Reporte de optimizacion de inicio - ${today}`, '',
    '## Resumen', '',
    `- Programas de inicio: ${allEntries.length} entradas (${disabledEntries.length} deshabilitadas)`,
    '- Rendimiento de arranque: no disponible (ver PROJECT_CONTEXT.md)',
    servicesError
      ? '- Servicios auto-start: error'
      : `- Servicios auto-start: ${services.length} (${nonMsServices.length} no-Microsoft)`,
    tasksError
      ? '- Tareas programadas al inicio/logon: error'
      : `- Tareas programadas al inicio/logon: ${logonTasks.length} (${enabledTasks.length} habilitadas, ${disabledTasks.length} deshabilitadas)`,
    '',
    `## Programas de inicio (${allEntries.length})`, '',
  ];

  if (allEntries.length > 0) {
    lines.push('```');
    for (const e of allEntries) {
      lines.push(`[${e.source}]  ${e.name}`);
      lines.push(`  Comando: ${e.command}`);
      lines.push('');
    }
    lines.push('```');
  } else {
    lines.push('No hay programas registrados para iniciar automaticamente.');
  }
  lines.push('');

  lines.push(`## Programas deshabilitados (${disabledEntries.length})`, '');
  if (disabledEntries.length > 0) {
    lines.push('```');
    for (const e of disabledEntries) {
      lines.push(`[${e.source}]  ${e.name}`);
    }
    lines.push('```');
  } else {
    lines.push('No hay programas de inicio deshabilitados desde aqui.');
  }
  lines.push('');

  lines.push(`## Servicios auto-start (${services.length})`, '');
  if (!servicesError && nonMsServices.length > 0) {
    lines.push(`### No-Microsoft (${nonMsServices.length})`, '');
    lines.push('```');
    for (const s of nonMsServices) lines.push(`${s.name}  (${s.displayName})`);
    lines.push('```');
  } else if (servicesError) {
    lines.push('No se pudieron consultar los servicios.');
  } else {
    lines.push('No hay servicios no-Microsoft con inicio automatico.');
  }
  lines.push('');

  lines.push(`## Tareas programadas al inicio/logon (${logonTasks.length})`, '');
  if (!tasksError && enabledTasks.length > 0) {
    lines.push(`### Habilitadas (${enabledTasks.length})`, '');
    lines.push('```');
    for (const t of enabledTasks) lines.push(`${t.taskName}  [${t.scheduleType}]`);
    lines.push('```');
    lines.push('');
  }
  if (!tasksError && disabledTasks.length > 0) {
    lines.push(`### Deshabilitadas (${disabledTasks.length})`, '');
    lines.push('```');
    for (const t of disabledTasks) lines.push(`${t.taskName}  [${t.scheduleType}]`);
    lines.push('```');
  }
  if (tasksError) {
    lines.push('No se pudieron consultar las tareas programadas.');
  } else if (enabledTasks.length === 0 && disabledTasks.length === 0) {
    lines.push('No hay tareas de inicio/logon registradas.');
  }
  lines.push('');

  writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8');
  writeFileSync(countsPath, JSON.stringify({
    date: today,
    reportPath,
    startup_programs: { count: allEntries.length, error: false },
    disabled_programs: { count: disabledEntries.length, error: false },
    boot_performance: { boot_time_ms: 0, trend: 'unknown', error: true },
    auto_services: { count: services.length, nonMicrosoft: nonMsServices.length, error: servicesError },
    logon_tasks: { count: logonTasks.length, enabled: enabledTasks.length, disabled: disabledTasks.length, error: tasksError },
  }, null, 2), 'utf-8');

  onOutput(`Reporte generado en: ${reportPath}`);
  onOutput(`Conteos generados en: ${countsPath}`);
}

/** Deshabilita programas de inicio (registro/accesos directos) y tareas de logon seleccionadas. */
export async function runStartupActionNative(envVars, onOutput) {
  const logDir = join(MODULES.startup.dir, 'reports');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, MODULES.startup.logFile);

  const writeLog = (message) => {
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const line = `[${stamp}] ${message}`;
    appendFileSync(logPath, line + '\n');
    onOutput(line);
  };

  writeLog('=== Optimizacion de inicio - inicio ===');

  const isAdmin = await isAdminWindows();

  // ── Reactivar programas deshabilitados (registro + accesos directos) ──
  const disabledEntries = await getDisabledStartupItems();
  const enableProgramIndices = parseIndexSelection(envVars.ENABLE_PROGRAMS, disabledEntries.length);
  if (enableProgramIndices.length > 0) {
    const manifest = loadDisabledRegistryManifest();
    for (const idx of enableProgramIndices) {
      const e = disabledEntries[idx];
      if (!e) continue;
      if (e.type === 'registry') {
        if (e.keyPath.startsWith('HKLM') && !isAdmin) {
          writeLog(`OMITIDO (admin requerido para reactivar): ${e.name} desde ${e.keyPath}`);
          continue;
        }
        const r = await spawnCapture('reg', ['add', e.keyPath, '/v', e.name, '/t', 'REG_SZ', '/d', e.command, '/f']);
        if (r.code === 0) {
          const i = manifest.findIndex((m) => m.keyPath === e.keyPath && m.name === e.name);
          if (i >= 0) manifest.splice(i, 1);
          writeLog(`Reactivado (registry): ${e.name} en ${e.keyPath}`);
        } else {
          writeLog(`ERROR reactivando ${e.name}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
        }
      } else {
        try {
          await rename(e.disabledPath, e.restorePath);
          writeLog(`Reactivado (shortcut): ${e.name} -> ${e.restorePath}`);
        } catch (err) {
          writeLog(`ERROR reactivando ${e.name}: ${err.message}`);
        }
      }
    }
    saveDisabledRegistryManifest(manifest);
  }

  // ── Reactivar tareas de logon deshabilitadas ──
  const { tasks: logonTasksForEnable } = await getLogonScheduledTasks();
  const disabledTasksForEnable = logonTasksForEnable.filter((t) => t.state === 'Disabled');
  const enableTaskIndices = parseIndexSelection(envVars.ENABLE_TASKS, disabledTasksForEnable.length);
  for (const idx of enableTaskIndices) {
    const t = disabledTasksForEnable[idx];
    if (!t) continue;
    const r = await spawnCapture('schtasks', ['/Change', '/TN', t.taskName, '/Enable']);
    writeLog(r.code === 0
      ? `Tarea reactivada: ${t.taskName}`
      : `ERROR reactivando ${t.taskName}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  }

  // ── Deshabilitar programas seleccionados ──
  const regEntries = await getRegistryStartupEntries();
  const shortcutEntries = await getShortcutStartupEntries();
  const allEntries = [...regEntries, ...shortcutEntries];

  const programIndices = parseIndexSelection(envVars.OPTIMIZE_PROGRAMS, allEntries.length);
  if (programIndices.length > 0) {
    const manifest = loadDisabledRegistryManifest();
    for (const idx of programIndices) {
      const e = allEntries[idx];
      if (!e) continue;
      if (e.type === 'registry') {
        if (e.keyPath.startsWith('HKLM') && !isAdmin) {
          writeLog(`OMITIDO (admin requerido): ${e.name} desde ${e.keyPath}`);
          continue;
        }
        const r = await spawnCapture('reg', ['delete', e.keyPath, '/v', e.name, '/f']);
        if (r.code === 0) {
          manifest.push({ name: e.name, command: e.command, keyPath: e.keyPath, source: e.source });
          writeLog(`Deshabilitado (registry): ${e.name} desde ${e.keyPath}`);
        } else {
          writeLog(`ERROR deshabilitando ${e.name}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
        }
      } else {
        try {
          const disabledDir = join(dirname(e.keyPath), STARTUP_DISABLED_SUBDIR);
          if (!existsSync(disabledDir)) mkdirSync(disabledDir, { recursive: true });
          const dest = join(disabledDir, e.name + '.lnk');
          await rename(e.keyPath, dest);
          writeLog(`Deshabilitado (shortcut): ${e.name} -> ${dest}`);
        } catch (err) {
          writeLog(`ERROR deshabilitando ${e.name}: ${err.message}`);
        }
      }
    }
    saveDisabledRegistryManifest(manifest);
  }

  const { tasks: logonTasks } = await getLogonScheduledTasks();
  const enabledTasks = logonTasks.filter((t) => t.state !== 'Disabled');
  const taskIndices = parseIndexSelection(envVars.OPTIMIZE_TASKS, enabledTasks.length);
  for (const idx of taskIndices) {
    const t = enabledTasks[idx];
    if (!t) continue;
    const r = await spawnCapture('schtasks', ['/Change', '/TN', t.taskName, '/Disable']);
    writeLog(r.code === 0
      ? `Tarea deshabilitada: ${t.taskName}`
      : `ERROR deshabilitando ${t.taskName}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  }

  writeLog('=== Optimizacion de inicio - fin ===');
}
