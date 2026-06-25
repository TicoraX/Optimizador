import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { readFileSync, existsSync, writeFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  PROJECT_ROOT, MODULES, TASK_TO_MODULE, VALID_MODULES, VALID_TASKS,
  validateModule, validateDate, validateTask, validateTime, validateFrequency,
  validateWeekdays, validateIntervalDays, validateBooleanField, validateIndexList,
  validateDays, validateMinRamMB, normalizeSchTaskStatus, loadJsonSafe,
  findLatestReport, buildReportPath, safeHandler,
} from './lib/shared.js';
import { runCleanupScanNative, runCleanupActionNative } from './lib/cleanup.js';
import { runUpdatesScanNative, runUpdatesActionNative } from './lib/updates.js';
import { runStartupScanNative, runStartupActionNative } from './lib/startup.js';
import { runRamScanNative, runRamActionNative } from './lib/ram.js';
import { runNetworkScanNative, runNetworkActionNative } from './lib/network.js';
import { runServicesScanNative, runServicesActionNative } from './lib/services.js';
import { runPowerScanNative, runPowerActionNative } from './lib/power.js';
import { runAppsScanNative, runAppsActionNative } from './lib/apps.js';
import { runPrivacyScanNative, runPrivacyActionNative } from './lib/privacy.js';

const app = express();

// ── CORS: restringir origen en produccion si se desea ──
app.use(cors());

// ── Limitar tamanio del body JSON para mitigar DoS ──
app.use(express.json({ limit: '16kb' }));

// ═══════════════════════════════════════════════════════
// GET /api/health — health check rapido
// ═══════════════════════════════════════════════════════
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ═══════════════════════════════════════════════════════
// MODULE_HANDLERS — mapa handlers scan/action
// ═══════════════════════════════════════════════════════
const SCAN_HANDLERS = {
  cleanup: runCleanupScanNative,
  updates: runUpdatesScanNative,
  startup: runStartupScanNative,
  ram: runRamScanNative,
  network: runNetworkScanNative,
  services: runServicesScanNative,
  power: runPowerScanNative,
  apps: runAppsScanNative,
  privacy: runPrivacyScanNative,
};
const ACTION_HANDLERS = {
  cleanup: runCleanupActionNative,
  updates: runUpdatesActionNative,
  startup: runStartupActionNative,
  ram: runRamActionNative,
  network: runNetworkActionNative,
  services: runServicesActionNative,
  power: runPowerActionNative,
  apps: runAppsActionNative,
  privacy: runPrivacyActionNative,
};

// ═══════════════════════════════════════════════════════
// GET /api/status — estado consolidado (solo lectura)
// ═══════════════════════════════════════════════════════
app.get('/api/status', safeHandler((_req, res) => {
  const emptyMetrics = { count: 0, error: false };

  const updateCounts = loadJsonSafe(
    join(MODULES.updates.dir, 'reports', MODULES.updates.countsFile),
    { date: null, winget: emptyMetrics, pip: emptyMetrics, npm: emptyMetrics, choco: emptyMetrics },
  );

  const cleanupCounts = loadJsonSafe(
    join(MODULES.cleanup.dir, 'reports', MODULES.cleanup.countsFile),
    { date: null, temp: { total_mb: 0, error: false }, browser_cache: { total_mb: 0, error: false }, downloads: { total_mb: 0, count: 0, error: false }, recycle_bin: { total_mb: 0, count: 0, error: false } },
  );

  const startupCounts = loadJsonSafe(
    join(MODULES.startup.dir, 'reports', MODULES.startup.countsFile),
    { date: null, startup_programs: emptyMetrics, boot_performance: { boot_time_ms: 0, trend: 'unknown', error: false }, auto_services: emptyMetrics, logon_tasks: emptyMetrics },
  );

  const bootHistory = loadJsonSafe(
    join(MODULES.startup.dir, 'reports', 'boot-history.json'),
    [],
  );

  const ramCounts = loadJsonSafe(
    join(MODULES.ram.dir, 'reports', MODULES.ram.countsFile),
    { date: null, total_mb: 0, used_mb: 0, free_mb: 0, usage_percent: 0, total_processes: 0, known_processes: 0, unknown_processes: 0, risky_processes: 0, critical_processes: 0, top_processes: [], error: true },
  );

  res.json({
    timestamp: new Date().toISOString(),
    updates: {
      lastScan: updateCounts.date,
      winget: updateCounts.winget || emptyMetrics,
      pip: updateCounts.pip || emptyMetrics,
      npm: updateCounts.npm || emptyMetrics,
      choco: updateCounts.choco || emptyMetrics,
    },
    cleanup: {
      lastScan: cleanupCounts.date,
      temp: cleanupCounts.temp || { total_mb: 0, error: false },
      browserCache: cleanupCounts.browser_cache || { total_mb: 0, error: false },
      downloads: cleanupCounts.downloads || { total_mb: 0, count: 0, error: false },
      recycleBin: cleanupCounts.recycle_bin || { total_mb: 0, count: 0, error: false },
    },
    startup: {
      lastScan: startupCounts.date,
      startupPrograms: startupCounts.startup_programs || emptyMetrics,
      bootPerformance: startupCounts.boot_performance || { boot_time_ms: 0, trend: 'unknown', error: false },
      autoServices: startupCounts.auto_services || emptyMetrics,
      logonTasks: startupCounts.logon_tasks || emptyMetrics,
      bootHistory: Array.isArray(bootHistory) ? bootHistory : [bootHistory],
    },
    ram: {
      lastScan: ramCounts.date,
      totalMB: ramCounts.total_mb || 0,
      usedMB: ramCounts.used_mb || 0,
      freeMB: ramCounts.free_mb || 0,
      usagePercent: ramCounts.usage_percent || 0,
      totalProcesses: ramCounts.total_processes || 0,
      knownProcesses: ramCounts.known_processes || 0,
      unknownProcesses: ramCounts.unknown_processes || 0,
      riskyProcesses: ramCounts.risky_processes || 0,
      criticalProcesses: ramCounts.critical_processes || 0,
      topProcesses: Array.isArray(ramCounts.top_processes) ? ramCounts.top_processes : [],
      error: ramCounts.error,
    },
    network: (() => {
      const n = loadJsonSafe(
        join(MODULES.network.dir, 'reports', MODULES.network.countsFile),
        { date: null, dns_cache_entries: 0, avg_ping_ms: null, packet_loss: 0, active_adapters: 0, disconnected_adapters: 0, error: true },
      );
      return {
        lastScan: n.date,
        dnsCacheEntries: n.dns_cache_entries || 0,
        avgPingMs: n.avg_ping_ms,
        packetLoss: n.packet_loss || 0,
        activeAdapters: n.active_adapters || 0,
        disconnectedAdapters: n.disconnected_adapters || 0,
        error: n.error,
      };
    })(),
    services: (() => {
      const s = loadJsonSafe(
        join(MODULES.services.dir, 'reports', MODULES.services.countsFile),
        { date: null, third_party_total: 0, third_party_running: 0, third_party_memory_mb: 0, system_total: 0, system_running: 0, error: true },
      );
      return {
        lastScan: s.date,
        thirdPartyTotal: s.third_party_total || 0,
        thirdPartyRunning: s.third_party_running || 0,
        thirdPartyMemoryMB: s.third_party_memory_mb || 0,
        systemTotal: s.system_total || 0,
        systemRunning: s.system_running || 0,
        error: s.error,
      };
    })(),
    power: (() => {
      const p = loadJsonSafe(
        join(MODULES.power.dir, 'reports', MODULES.power.countsFile),
        { date: null, active_plan: 'N/A', battery_present: false, battery_pct: null, battery_status: null, runtime_min: null, power_watts: null, total_est_watts: null, wear_pct: null, capacity_full_mwh: null, capacity_design_mwh: null, cpu_load: null, cpu_name: null, cpu_tdp: null, cpu_est_watts: null, gpu_name: null, gpu_method: null, gpu_watts: null, gpu_est_watts: null, ram_gb: null, ram_sticks: null, ram_watts: null, disk_count: null, disk_watts: null, mobo_watts: null, other_watts: null, error: true },
      );
      return {
        lastScan: p.date,
        activePlan: p.active_plan || 'N/A',
        batteryPresent: p.battery_present,
        batteryPct: p.battery_pct,
        batteryStatus: p.battery_status,
        runtimeMin: p.runtime_min,
        powerWatts: p.power_watts,
        totalEstWatts: p.total_est_watts,
        wearPct: p.wear_pct,
        capacityFullMwh: p.capacity_full_mwh,
        capacityDesignMwh: p.capacity_design_mwh,
        cpuLoad: p.cpu_load,
        cpuName: p.cpu_name,
        cpuTdp: p.cpu_tdp,
        cpuEstWatts: p.cpu_est_watts,
        gpuName: p.gpu_name,
        gpuMethod: p.gpu_method,
        gpuWatts: p.gpu_watts,
        gpuEstWatts: p.gpu_est_watts,
        ramGb: p.ram_gb,
        ramSticks: p.ram_sticks,
        ramWatts: p.ram_watts,
        diskCount: p.disk_count,
        diskWatts: p.disk_watts,
        moboWatts: p.mobo_watts,
        otherWatts: p.other_watts,
        error: p.error,
      };
    })(),
    apps: (() => {
      const a = loadJsonSafe(
        join(MODULES.apps.dir, 'reports', MODULES.apps.countsFile),
        { date: null, apps_count: 0, error: true },
      );
      return {
        lastScan: a.date,
        appsCount: a.apps_count || 0,
        error: a.error,
      };
    })(),
    privacy: (() => {
      const p = loadJsonSafe(
        join(MODULES.privacy.dir, 'reports', MODULES.privacy.countsFile),
        { date: null, total_settings: 8, hardened_count: 0, error: true },
      );
      return {
        lastScan: p.date,
        totalSettings: p.total_settings || 8,
        hardenedCount: p.hardened_count || 0,
        error: p.error,
      };
    })(),
  });
}));

// ═══════════════════════════════════════════════════════
// GET /api/reports/:module/latest
// GET /api/reports/:module/:date
// ═══════════════════════════════════════════════════════
app.get('/api/reports/:module/latest', safeHandler((req, res) => {
  const mod = validateModule(req.params.module);
  const reportPath = findLatestReport(mod.dir, mod.reportPrefix);
  if (!reportPath) return res.status(404).json({ error: 'No hay reportes disponibles' });

  const content = readFileSync(reportPath, 'utf-8');
  const dateMatch = reportPath.match(/(\d{4}-\d{2}-\d{2})/);
  res.json({ module: req.params.module, date: dateMatch ? dateMatch[0] : null, content });
}));

app.get('/api/reports/:module/:date', safeHandler((req, res) => {
  const mod = validateModule(req.params.module);
  const date = validateDate(req.params.date);

  const reportPath = buildReportPath(mod.dir, mod.reportPrefix, date);
  if (!reportPath) return res.status(404).json({ error: 'No existe reporte para esa fecha' });

  const content = readFileSync(reportPath, 'utf-8');
  res.json({ module: req.params.module, date, content });
}));

// ═══════════════════════════════════════════════════════
// POST /api/scan/:module — ejecuta escaneo, SSE stream
// ═══════════════════════════════════════════════════════
function startNativeSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });
  res.flushHeaders();
  return (event, data) => {
    if (res.writable) {
      res.write(`event: ${event}\n`);
      res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
    }
  };
}

/**
 * Corre `task` (una de las funciones runXNative) sobre SSE con un timeout
 * de seguridad. A diferencia de los procesos de PowerShell que reemplaza,
 * `task` no se puede "matar" a mitad de camino (es codigo async de Node,
 * no un proceso aparte) — si vence el timeout, simplemente se deja de
 * esperar y se le avisa al cliente. Evita que un `spawnCapture` colgado
 * (ej. `schtasks /query` en un sistema con miles de tareas) deje la
 * conexion SSE abierta para siempre.
 */
function runNativeOverSSE(res, task, timeoutMs = 120000) {
  const send = startNativeSSE(res);
  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    send('error', 'Tiempo de espera agotado.');
    send('done', { exitCode: 1, timedOut: true });
    res.end();
  }, timeoutMs);

  task((line) => send('output', line))
    .then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      send('done', { exitCode: 0, timedOut: false });
      res.end();
    })
    .catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      send('error', err.message);
      send('done', { exitCode: 1, timedOut: false });
      res.end();
    });
}

app.post('/api/scan/:module', safeHandler((req, res) => {
  const mod = validateModule(req.params.module);
  const handler = SCAN_HANDLERS[req.params.module];
  if (!handler) return res.status(400).json({ error: 'Modulo sin handler de escaneo' });

  let extraArgs = [];

  if (req.params.module === 'cleanup') {
    const ageDays = req.body?.downloadsAgeDays !== undefined
      ? validateDays(req.body.downloadsAgeDays)
      : 30;
    extraArgs = [ageDays];
  }

  if (req.params.module === 'ram') {
    const cleanMode = req.body?.cleanMode === 'deep' ? 'deep' : 'soft';
    const minMB = req.body?.minRamMB !== undefined
      ? validateMinRamMB(req.body.minRamMB)
      : (cleanMode === 'deep' ? 10 : 50);
    extraArgs = [cleanMode, minMB];
  }

  runNativeOverSSE(res, (onOutput) => handler(...extraArgs, onOutput));
}));

// ═══════════════════════════════════════════════════════
// POST /api/action/:module — ejecuta accion, SSE stream
// ═══════════════════════════════════════════════════════
app.post('/api/action/:module', safeHandler((req, res) => {
  const mod = validateModule(req.params.module);

  if (!mod.action) {
    return res.status(400).json({ error: 'Este modulo no tiene script de accion' });
  }

  const envVars = {};

  // ── Validacion estricta de body params ──
  if (req.body?.autoConfirm !== undefined) {
    if (validateBooleanField(req.body.autoConfirm, 'autoConfirm')) {
      envVars.AUTO_CONFIRM = 'true';
    }
  }

  if (req.body?.programs !== undefined) {
    envVars.OPTIMIZE_PROGRAMS = validateIndexList(req.body.programs, 'programs');
  }

  if (req.body?.tasks !== undefined) {
    envVars.OPTIMIZE_TASKS = validateIndexList(req.body.tasks, 'tasks');
  }

  if (req.body?.processes !== undefined) {
    envVars.OPTIMIZE_PROCESSES = validateIndexList(req.body.processes, 'processes');
  }

  if (req.body?.unknownProcesses !== undefined) {
    envVars.UNKNOWN_PROCESSES = validateIndexList(req.body.unknownProcesses, 'unknownProcesses');
  }

  // Services: indices de servicios de terceros a deshabilitar.
  if (req.body?.services !== undefined) {
    envVars.OPTIMIZE_SERVICES = validateIndexList(req.body.services, 'services');
  }

  // Power: indice del plan de energía a activar (1-based, entero).
  if (req.params.module === 'power' && req.body?.planIndex !== undefined) {
    const n = Number(req.body.planIndex);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 20) {
      const err = new Error('planIndex debe ser entero entre 1 y 20');
      err.statusCode = 400;
      throw err;
    }
    envVars.PLAN_INDEX = String(n);
  }

  // Apps: IDs de paquetes winget a desinstalar, separados por coma.
  if (req.body?.apps !== undefined) {
    const s = String(req.body.apps || '').trim();
    if (s === '') {
      envVars.OPTIMIZE_APPS = '';
    } else if (/^[a-zA-Z\d._\-]+(,[a-zA-Z\d._\-]+)*$/.test(s)) {
      envVars.OPTIMIZE_APPS = s;
    } else {
      const err = new Error('apps debe ser IDs de paquetes winget separados por coma');
      err.statusCode = 400;
      throw err;
    }
  }

  // Privacy: indices de ajustes de privacidad a proteger.
  if (req.body?.privacy !== undefined) {
    envVars.OPTIMIZE_PRIVACY = validateIndexList(req.body.privacy, 'privacy');
  }

  // Procesos 'risky' (editores/navegadores/sync/chat) seleccionados a mano por
  // el usuario, bajo su propio criterio - nunca via "todos" desde el frontend.
  if (req.body?.riskyProcesses !== undefined) {
    envVars.RISKY_PROCESSES = validateIndexList(req.body.riskyProcesses, 'riskyProcesses');
  }

  // Reactivacion: solo aplica al modulo startup (programas/tareas previamente
  // deshabilitados). Indices referidos a la lista de "deshabilitados", no a la
  // lista de "activos" que usan programs/tasks arriba.
  if (req.body?.enablePrograms !== undefined) {
    envVars.ENABLE_PROGRAMS = validateIndexList(req.body.enablePrograms, 'enablePrograms');
  }

  if (req.body?.enableTasks !== undefined) {
    envVars.ENABLE_TASKS = validateIndexList(req.body.enableTasks, 'enableTasks');
  }

  // DownloadsAgeDays: solo aplica al modulo cleanup. Se pasa via env var
  // (el script lee $env:DOWNLOADS_AGE_DAYS como override de su parametro -DownloadsAgeDays)
  if (req.params.module === 'cleanup' && req.body?.downloadsAgeDays !== undefined) {
    const days = validateDays(req.body.downloadsAgeDays);
    envVars.DOWNLOADS_AGE_DAYS = String(days);
  }

  // MinRamMB: solo aplica al modulo ram. Filtra procesos por umbral minimo.
  if (req.params.module === 'ram' && req.body?.minRamMB !== undefined) {
    envVars.MIN_RAM_MB = String(validateMinRamMB(req.body.minRamMB));
  }

  // CleanMode: solo aplica al modulo ram. Controla que procesos se consideran
  // candidatos: 'soft' (solo safe_known) o 'deep' (incluye unknown sin ventana).
  if (req.params.module === 'ram' && req.body?.cleanMode !== undefined) {
    envVars.CLEAN_MODE = req.body.cleanMode === 'deep' ? 'deep' : 'soft';
  }

  // Ningun modulo invoca powershell.exe para su accion: los 3 se ejecutan
  // nativos en Node para evitar el cuelgue al spawnear desde este proceso
  // servidor (ver "Bug critico conocido" en PROJECT_CONTEXT.md).
  // Las acciones instalan/cambian cosas reales (winget/pip/npm/choco, registro,
  // tareas) y pueden tardar mucho mas que un escaneo de solo lectura — ej.
  // "winget upgrade --all" tardo 3m28s en una prueba real. Timeout mas alto
  // que el default de runNativeOverSSE (2 min, pensado para escaneos).
  const ACTION_TIMEOUT_MS = 600000;

  const handler = ACTION_HANDLERS[req.params.module];
  if (!handler) return res.status(400).json({ error: 'Modulo sin handler de accion' });

  // updates no recibe envVars (no tiene params de seleccion)
  if (req.params.module === 'updates') {
    runNativeOverSSE(res, (onOutput) => handler(onOutput), ACTION_TIMEOUT_MS);
    return;
  }

  runNativeOverSSE(res, (onOutput) => handler(envVars, onOutput), ACTION_TIMEOUT_MS);
}));

// ═══════════════════════════════════════════════════════
// GET /api/scheduler — estado de tareas programadas
// ═══════════════════════════════════════════════════════
app.get('/api/scheduler', safeHandler((_req, res) => {
  const proc = spawn('schtasks.exe', ['/Query', '/FO', 'CSV', '/NH'], {
    windowsHide: true,
    shell: false,
  });

  let output = '';
  let errorOut = '';

  proc.stdout.setEncoding('utf-8');
  proc.stderr.setEncoding('utf-8');
  proc.stdout.on('data', (d) => { output += d; });
  proc.stderr.on('data', (d) => { errorOut += d; });

  proc.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: 'Error al consultar tareas programadas' });
    }

    const tasks = {};
    const lines = output.trim().split(/\r?\n/);

    for (const line of lines) {
      // Split CSV respetando campos entrecomillados que pueden contener comas
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

      const name = cols[0].trim().replace(/^\\/, '');
      if (!VALID_TASKS.includes(name)) continue;

      const nextRun = cols[1].trim() || 'N/A';
      const status = normalizeSchTaskStatus(cols[2]);
      const schedule = cols[3] ? cols[3].trim() : '';

      tasks[name] = { name, nextRun, status, schedule };
    }

    // Tareas en whitelist que no aparecieron en schtasks
    for (const tn of VALID_TASKS) {
      if (!tasks[tn]) {
        tasks[tn] = { name: tn, nextRun: 'N/A', status: 'Not Found', schedule: '' };
      }
    }

    res.json({ tasks: Object.values(tasks) });
  });

  proc.on('error', () => {
    res.status(500).json({ error: 'Error al consultar tareas programadas' });
  });
}));

// ═══════════════════════════════════════════════════════
// POST /api/scheduler/:task/toggle — enable/disable
// ═══════════════════════════════════════════════════════
app.post('/api/scheduler/:task/toggle', safeHandler((req, res) => {
  const task = validateTask(req.params.task);
  const enable = validateBooleanField(req.body?.enable ?? false, 'enable');
  const action = enable ? 'ENABLE' : 'DISABLE';

  const proc = spawn('schtasks.exe', ['/Change', '/TN', task, `/${action}`], {
    windowsHide: true,
    shell: false,
  });

  proc.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: 'Error al modificar la tarea programada' });
    }
    res.json({ task, action: enable ? 'enabled' : 'disabled' });
  });

  proc.on('error', () => {
    res.status(500).json({ error: 'Error al modificar la tarea programada' });
  });
}));

// ═══════════════════════════════════════════════════════
// POST /api/scheduler/:task/reschedule — cambiar dia/hora/frecuencia
//
// schtasks /Change NO permite cambiar /SC, /D ni /MO (frecuencia/dias) —
// solo /Create lo permite, por lo que esto recrea la tarea con /F (force
// overwrite) preservando el mismo /TN y el mismo /TR (el Notify-*.ps1 de
// cada modulo, fijo en MODULES — nunca viene de input del usuario).
// ═══════════════════════════════════════════════════════
app.post('/api/scheduler/:task/reschedule', safeHandler((req, res) => {
  const task = validateTask(req.params.task);
  const mod = TASK_TO_MODULE[task];
  const frequency = validateFrequency(req.body?.frequency);
  const time = validateTime(req.body?.time);

  const args = [
    '/Create', '/F',
    '/TN', task,
    '/TR', `powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ${join(mod.dir, mod.notifyScript)}`,
    '/SC', frequency === 'daily' ? 'DAILY' : 'WEEKLY',
    '/ST', time,
  ];

  if (frequency === 'weekly') {
    args.push('/D', validateWeekdays(req.body?.days));
  } else if (req.body?.intervalDays !== undefined) {
    const intervalDays = validateIntervalDays(req.body.intervalDays);
    if (intervalDays > 1) args.push('/MO', String(intervalDays));
  }

  const proc = spawn('schtasks.exe', args, { windowsHide: true, shell: false });
  let errorOut = '';
  proc.stderr.setEncoding('utf-8');
  proc.stderr.on('data', (d) => { errorOut += d; });

  proc.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: errorOut.trim() || 'Error al reprogramar la tarea' });
    }
    res.json({ task, frequency, time, days: frequency === 'weekly' ? req.body.days : undefined });
  });

  proc.on('error', () => {
    res.status(500).json({ error: 'Error al reprogramar la tarea' });
  });
}));

// ═══════════════════════════════════════════════════════
// GET  /api/logs/:module  — ultimas 100 lineas del log de accion
// DELETE /api/logs/:module — vaciar/rotar log de accion
// ═══════════════════════════════════════════════════════

/**
 * Lee las ultimas N lineas de un archivo sin cargarlo completo en memoria.
 * Usa un buffer deslizante de N lineas.
 */
function readLastLines(filePath, maxLines = 100) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

app.get('/api/logs/:module', safeHandler((req, res) => {
  const mod = validateModule(req.params.module);

  const logPath = join(mod.dir, 'reports', mod.logFile);
  if (!existsSync(logPath)) {
    return res.json({ module: req.params.module, lines: [], size: 0, path: logPath });
  }

  const lines = readLastLines(logPath, 100);
  const size = statSync(logPath).size;

  res.json({ module: req.params.module, lines, size, path: logPath });
}));

app.delete('/api/logs/:module', safeHandler((req, res) => {
  const mod = validateModule(req.params.module);

  const logPath = join(mod.dir, 'reports', mod.logFile);
  if (!existsSync(logPath)) {
    return res.json({ module: req.params.module, action: 'nothing-to-clear', path: logPath });
  }

  const rotate = req.query?.rotate === 'true' || req.body?.rotate === true;

  if (rotate) {
    // Rotar: renombrar a .1.bak y crear nuevo vacio
    const bakPath = logPath.replace(/\.txt$/, '.1.bak.txt');
    try {
      writeFileSync(bakPath, readFileSync(logPath, 'utf-8'), 'utf-8');
    } catch { /* ignorar si falla el backup */ }
    writeFileSync(logPath, '', 'utf-8');
    res.json({ module: req.params.module, action: 'rotated', backup: bakPath });
  } else {
    // Truncar a vacio
    writeFileSync(logPath, '', 'utf-8');
    res.json({ module: req.params.module, action: 'cleared' });
  }
}));

// ═══════════════════════════════════════════════════════
// Frontend estatico (build de produccion, ej. dentro del .exe de Electron)
// ponytail: solo se activa si frontend/dist existe; en dev se usa el proxy de Vite
// ═══════════════════════════════════════════════════════
const FRONTEND_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist');
if (existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(FRONTEND_DIST, 'index.html')));
}

// ═══════════════════════════════════════════════════════
// Global error handler — sin leak de informacion
// ═══════════════════════════════════════════════════════
app.use((err, _req, res, _next) => {
  // Solo loguea internamente; NUNCA envia stack al cliente
  console.error(`[${new Date().toISOString()}] Error: ${err.message}`);
  const statusCode = err.statusCode || 500;
  const message = statusCode >= 500
    ? 'Error interno del servidor'
    : err.message;
  res.status(statusCode).json({ error: message });
});

// ═══════════════════════════════════════════════════════
// Start — BIND SOLO A LOCALHOST
// ═══════════════════════════════════════════════════════
const PORT = process.env.PORT || 3001;
const HOST = '127.0.0.1'; // Previene exposicion a LAN / internet

app.listen(PORT, HOST, () => {
  console.log(`D1 Automation Server en http://${HOST}:${PORT}`);
  console.log(`Root: ${PROJECT_ROOT}`);
  console.log(`Modulos: ${VALID_MODULES.join(', ')}`);
  console.log('Aceptando conexiones solo de localhost');
});
