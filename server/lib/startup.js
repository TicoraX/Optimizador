import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { readdir, rename } from 'fs/promises';
import { join, dirname } from 'path';
import {
  MODULES, spawnCapture, isAdminWindows, parseCsvLine,
  makeLogger, makeGuard, prepareReport, finishReport, errText,
  loadJsonSafe, normalizeSchTaskStatus,
} from './shared.js';

/**
 * Selecciones que vienen como lista de identificadores separados por `|`.
 *
 * El separador NO es la coma: los ids llevan rutas de registro y de archivo,
 * y `HKCU\...\Run\Nombre, con coma` es un nombre de valor perfectamente legal.
 * La barra vertical no puede aparecer en una ruta de Windows.
 */
function parseIdSelection(selection) {
  return String(selection || '').split('|').map((s) => s.trim()).filter(Boolean);
}

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

/**
 * Identificador estable de un elemento de inicio.
 *
 * Para el registro es `keyPath\name`, que es exactamente lo que `reg` va a
 * tocar. Para un acceso directo es la ruta del archivo. En ambos casos
 * identifica al elemento sin depender de su posicion en la lista.
 */
export function startupItemId(entry) {
  if (entry.type === 'registry') return `${entry.keyPath}\\${entry.name}`;
  // Los deshabilitados guardan la ruta en disabledPath; los activos, en keyPath.
  return entry.disabledPath || entry.keyPath || entry.name;
}

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
      // El tipo se conserva. Antes se descartaba y al reactivar se escribia
      // siempre REG_SZ: una entrada REG_EXPAND_SZ (`%ProgramFiles%\App\app.exe`,
      // muy comun) volvia sin expansion de variables y el programa no arrancaba.
      if (m) entries.push({
        name: m[1].trim(), valueType: m[2], command: m[3].trim(),
        source: rp.label, keyPath: rp.hive, type: 'registry',
      });
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
  const paths = prepareReport('startup');
  const { today, reportPath } = paths;

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

  finishReport(paths, lines, {
    date: today,
    reportPath,
    startup_programs: { count: allEntries.length, error: false },
    disabled_programs: { count: disabledEntries.length, error: false },
    boot_performance: { boot_time_ms: 0, trend: 'unknown', error: true },
    auto_services: { count: services.length, nonMicrosoft: nonMsServices.length, error: servicesError },
    logon_tasks: { count: logonTasks.length, enabled: enabledTasks.length, disabled: disabledTasks.length, error: tasksError },
  }, onOutput,
  // Cada elemento viaja con un `id` estable, no con su posicion: si entre el
  // escaneo y el clic se agrega o se quita una entrada, el indice N pasa a
  // apuntar a otra cosa y se deshabilita lo que no era. Es el mismo bug que ya
  // habia mordido en services.
  {
    programs: allEntries.map((e) => ({
      id: startupItemId(e), name: e.name, source: e.source, type: e.type,
      command: e.command, requiresAdmin: String(e.keyPath || '').startsWith('HKLM'),
    })),
    tasks: enabledTasks.map((t) => ({ id: t.taskName, taskName: t.taskName, state: t.state })),
    disabledPrograms: disabledEntries.map((e) => ({
      id: startupItemId(e), name: e.name, source: e.source, type: e.type,
    })),
    disabledTasks: disabledTasks.map((t) => ({ id: t.taskName, taskName: t.taskName, state: t.state })),
  });
}

/** Deshabilita programas de inicio (registro/accesos directos) y tareas de logon seleccionadas. */
export async function runStartupActionNative(envVars, onOutput) {
  const writeLog = makeLogger('startup', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('startup', { dryRun, writeLog });

  writeLog(`=== Optimizacion de inicio - inicio${dryRun ? ' (SIMULACION)' : ''} ===`);

  const isAdmin = await isAdminWindows();

  // ── Reactivar programas deshabilitados (registro + accesos directos) ──
  const disabledEntries = await getDisabledStartupItems();
  const enableProgramIds = parseIdSelection(envVars.ENABLE_PROGRAMS);
  if (enableProgramIds.length > 0) {
    const manifest = loadDisabledRegistryManifest();
    for (const id of enableProgramIds) {
      const e = disabledEntries.find((x) => startupItemId(x) === id);
      if (!e) { writeLog(`OMITIDO (ya no esta deshabilitado): ${id}`); continue; }
      if (e.type === 'registry') {
        if (e.keyPath.startsWith('HKLM') && !isAdmin) {
          writeLog(`OMITIDO (admin requerido para reactivar): ${e.name} desde ${e.keyPath}`);
          continue;
        }
        // El tipo sale del manifiesto, que lo guardo al deshabilitar. Sin el,
        // una entrada REG_EXPAND_SZ volvia como REG_SZ y el programa no arrancaba.
        const valueType = e.valueType || 'REG_SZ';
        const r = await guard(
          `Reactivar ${e.name} en ${e.keyPath} (${valueType})`,
          () => spawnCapture('reg', ['add', e.keyPath, '/v', e.name, '/t', valueType, '/d', e.command, '/f']),
          { target: `${e.keyPath}\\${e.name}`, previousValue: null, newValue: e.command },
        );
        if (r.simulated) continue;
        if (r.ok) {
          const i = manifest.findIndex((m) => m.keyPath === e.keyPath && m.name === e.name);
          if (i >= 0) manifest.splice(i, 1);
          writeLog(`Reactivado (registry): ${e.name} en ${e.keyPath}`);
        } else {
          writeLog(`ERROR reactivando ${e.name}: ${errText(r)}`);
        }
      } else {
        const r = await guard(
          `Reactivar acceso directo ${e.name} -> ${e.restorePath}`,
          async () => {
            try {
              await rename(e.disabledPath, e.restorePath);
              return { ok: true };
            } catch (err) {
              return { ok: false, stderr: err.message };
            }
          },
          { target: e.restorePath, previousValue: e.disabledPath },
        );
        if (r.simulated) continue;
        writeLog(r.ok
          ? `Reactivado (shortcut): ${e.name} -> ${e.restorePath}`
          : `ERROR reactivando ${e.name}: ${r.stderr}`);
      }
    }
    saveDisabledRegistryManifest(manifest);
  }

  // ── Reactivar tareas de logon deshabilitadas ──
  const { tasks: logonTasksForEnable } = await getLogonScheduledTasks();
  const disabledTasksForEnable = logonTasksForEnable.filter((t) => t.state === 'Disabled');
  const enableTaskIds = parseIdSelection(envVars.ENABLE_TASKS);
  for (const id of enableTaskIds) {
    const t = disabledTasksForEnable.find((x) => x.taskName === id);
    if (!t) { writeLog(`OMITIDO (ya no esta deshabilitada): ${id}`); continue; }
    const r = await guard(
      `Reactivar tarea programada ${t.taskName}`,
      () => spawnCapture('schtasks', ['/Change', '/TN', t.taskName, '/Enable']),
      { target: t.taskName, previousValue: 'Disabled', newValue: 'Ready' },
    );
    if (r.simulated) continue;
    writeLog(r.ok
      ? `Tarea reactivada: ${t.taskName}`
      : `ERROR reactivando ${t.taskName}: ${errText(r)}`);
  }

  // ── Deshabilitar programas seleccionados ──
  const regEntries = await getRegistryStartupEntries();
  const shortcutEntries = await getShortcutStartupEntries();
  const allEntries = [...regEntries, ...shortcutEntries];

  const programIds = parseIdSelection(envVars.OPTIMIZE_PROGRAMS);
  if (programIds.length > 0) {
    const manifest = loadDisabledRegistryManifest();
    for (const id of programIds) {
      const e = allEntries.find((x) => startupItemId(x) === id);
      if (!e) { writeLog(`OMITIDO (ya no existe en el inicio): ${id}`); continue; }
      if (e.type === 'registry') {
        if (e.keyPath.startsWith('HKLM') && !isAdmin) {
          writeLog(`OMITIDO (admin requerido): ${e.name} desde ${e.keyPath}`);
          continue;
        }
        const r = await guard(
          `Deshabilitar ${e.name} en ${e.keyPath}`,
          () => spawnCapture('reg', ['delete', e.keyPath, '/v', e.name, '/f']),
          { target: `${e.keyPath}\\${e.name}`, previousValue: e.command, valueType: e.valueType },
        );
        if (r.simulated) continue;
        if (r.ok) {
          // valueType viaja al manifiesto: es lo que permite restaurar la
          // entrada con su tipo original.
          manifest.push({
            name: e.name, command: e.command, valueType: e.valueType,
            keyPath: e.keyPath, source: e.source,
          });
          writeLog(`Deshabilitado (registry): ${e.name} desde ${e.keyPath}`);
        } else {
          writeLog(`ERROR deshabilitando ${e.name}: ${errText(r)}`);
        }
      } else {
        const disabledDir = join(dirname(e.keyPath), STARTUP_DISABLED_SUBDIR);
        const dest = join(disabledDir, e.name + '.lnk');
        const r = await guard(
          `Deshabilitar acceso directo ${e.name} -> ${dest}`,
          async () => {
            try {
              if (!existsSync(disabledDir)) mkdirSync(disabledDir, { recursive: true });
              await rename(e.keyPath, dest);
              return { ok: true };
            } catch (err) {
              return { ok: false, stderr: err.message };
            }
          },
          { target: dest, previousValue: e.keyPath },
        );
        if (r.simulated) continue;
        writeLog(r.ok
          ? `Deshabilitado (shortcut): ${e.name} -> ${dest}`
          : `ERROR deshabilitando ${e.name}: ${r.stderr}`);
      }
    }
    saveDisabledRegistryManifest(manifest);
  }

  const { tasks: logonTasks } = await getLogonScheduledTasks();
  const enabledTasks = logonTasks.filter((t) => t.state !== 'Disabled');
  const taskIds = parseIdSelection(envVars.OPTIMIZE_TASKS);
  for (const id of taskIds) {
    const t = enabledTasks.find((x) => x.taskName === id);
    if (!t) { writeLog(`OMITIDO (ya no esta habilitada): ${id}`); continue; }
    const r = await guard(
      `Deshabilitar tarea programada ${t.taskName}`,
      () => spawnCapture('schtasks', ['/Change', '/TN', t.taskName, '/Disable']),
      { target: t.taskName, previousValue: t.state, newValue: 'Disabled' },
    );
    if (r.simulated) continue;
    writeLog(r.ok
      ? `Tarea deshabilitada: ${t.taskName}`
      : `ERROR deshabilitando ${t.taskName}: ${errText(r)}`);
  }

  writeLog('=== Optimizacion de inicio - fin ===');
}
