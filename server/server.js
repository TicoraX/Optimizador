import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { readFileSync, existsSync, readdirSync, writeFileSync, appendFileSync, statSync, mkdirSync } from 'fs';
import { rm, readdir, stat, unlink, rename } from 'fs/promises';
import { join, dirname, resolve, normalize } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ── Resolver PATH completo del usuario ──
// Cuando server.js arranca desde un proceso oculto, no hereda el PATH completo.
// Winget esta en %LOCALAPPDATA%\Microsoft\WindowsApps, que solo esta en el PATH
// del usuario, no del sistema. Lo resolvemos via child_process SIN usar powershell.exe
// (que tambien se cuelga si se llama sincronicamente desde el arranque del server).
function getUserPath() {
  const paths = new Set((process.env.PATH || '').split(';').filter(Boolean));
  // Rutas tipicas que faltan en procesos no-interactivos
  const extra = [
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps'),  // winget
    join(process.env.APPDATA || '', 'npm'),                             // npm global
    join(process.env.ProgramData || '', 'chocolatey', 'bin'),           // choco
  ];
  for (const p of extra) {
    if (existsSync(p)) paths.add(p);
  }
  // Si pip/python estan en el PATH del sistema, ya los tenemos. Si no, buscar AppData\Local\Programs\Python
  try {
    const pyDir = join(process.env.LOCALAPPDATA || '', 'Programs', 'Python');
    const entries = readdirSync(pyDir);
    for (const e of entries) {
      const scriptsDir = join(pyDir, e, 'Scripts');
      if (existsSync(scriptsDir)) paths.add(scriptsDir);
      if (existsSync(join(pyDir, e))) paths.add(join(pyDir, e));
    }
  } catch {}
  return Array.from(paths).join(';');
}

// Aplicar al arrancar (puramente filesystem, sin spawn de nada)
process.env.PATH = getUserPath();

// ── Whitelist: unica fuente de verdad para scripts validos ──
// Previene command injection via object-key lookup directo.
// Ningun input de usuario se concatena en rutas de archivo; solo se indexa este objeto.
const MODULES = Object.freeze({
  updates: Object.freeze({
    dir: join(PROJECT_ROOT, 'update-checker'),
    scan: 'Check-Updates.ps1',
    action: 'Apply-Updates.ps1',
    countsFile: 'update-counts.json',
    reportPrefix: 'update-report',
    taskName: 'UpdateChecker_Weekly',
    logFile: 'apply-log.txt',
    notifyScript: 'Notify-Updates.ps1',
  }),
  cleanup: Object.freeze({
    dir: join(PROJECT_ROOT, 'disk-cleanup'),
    scan: 'Scan-Cleanup.ps1',
    action: 'Clean-Disk.ps1',
    countsFile: 'cleanup-counts.json',
    reportPrefix: 'cleanup-report',
    taskName: 'DiskCleanup_Weekly',
    logFile: 'apply-log.txt',
    notifyScript: 'Notify-Cleanup.ps1',
  }),
  startup: Object.freeze({
    dir: join(PROJECT_ROOT, 'startup-optimizer'),
    scan: 'Scan-Startup.ps1',
    action: 'Optimize-Startup.ps1',
    countsFile: 'startup-counts.json',
    reportPrefix: 'startup-report',
    taskName: 'StartupOptimizer_Weekly',
    logFile: 'optimize-log.txt',
    notifyScript: 'Notify-Startup.ps1',
  }),
});

const TASK_TO_MODULE = Object.fromEntries(
  Object.entries(MODULES).map(([key, mod]) => [mod.taskName, mod]),
);

const VALID_MODULES = Object.keys(MODULES);
const VALID_TASKS = Object.values(MODULES).map((m) => m.taskName);

const app = express();

// ── CORS: restringir origen en produccion si se desea ──
app.use(cors());

// ── Limitar tamanio del body JSON para mitigar DoS ──
app.use(express.json({ limit: '16kb' }));

// ═══════════════════════════════════════════════════════
// Security helpers
// ═══════════════════════════════════════════════════════

/** Rechaza categoricamente cualquier string que contenga secuencias de directory traversal. */
function sanitizePathSegment(value) {
  if (typeof value !== 'string') return false;
  if (value.includes('..')) return false;       // ../  o  ..\
  if (value.includes('~')) return false;         // short-name expansion
  if (/[<>|?*"]/.test(value)) return false;     // chars ilegales en nombres de archivo Windows
  if (value.includes('\x00')) return false;      // null byte injection
  return true;
}

/** Valida que el parametro :module exista en la whitelist. */
function validateModule(module) {
  if (!VALID_MODULES.includes(module)) {
    const err = new Error('Modulo no permitido');
    err.statusCode = 404;
    throw err;
  }
  return MODULES[module];
}

/** Valida formato de fecha YYYY-MM-DD y que sea una fecha real (no 2026-02-30). */
function validateDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const err = new Error('Formato de fecha invalido');
    err.statusCode = 400;
    throw err;
  }
  // Validacion de calendario: evita fechas logicamente imposibles
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    const err = new Error('Fecha no existe en calendario');
    err.statusCode = 400;
    throw err;
  }
  // Rango razonable: 2020-2099
  if (y < 2020 || y > 2099) {
    const err = new Error('Fecha fuera de rango permitido');
    err.statusCode = 400;
    throw err;
  }
  return dateStr;
}

/** Valida que el parametro :task exista en la whitelist. */
function validateTask(task) {
  if (!VALID_TASKS.includes(task)) {
    const err = new Error('Tarea no permitida');
    err.statusCode = 404;
    throw err;
  }
  return task;
}

const VALID_WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Valida hora en formato HH:MM (24h). */
function validateTime(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    const err = new Error('time debe tener formato HH:MM (24h)');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

/** Valida frecuencia ("daily" o "weekly"). */
function validateFrequency(value) {
  if (value !== 'daily' && value !== 'weekly') {
    const err = new Error('frequency debe ser "daily" o "weekly"');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

/** Valida lista de dias de la semana (solo para frequency=weekly). */
function validateWeekdays(value) {
  if (!Array.isArray(value) || value.length === 0) {
    const err = new Error('days debe ser un array con al menos un dia (ej. ["MON","WED"])');
    err.statusCode = 400;
    throw err;
  }
  const days = value.map((d) => String(d).toUpperCase());
  for (const d of days) {
    if (!VALID_WEEKDAYS.includes(d)) {
      const err = new Error(`dia invalido: ${d}`);
      err.statusCode = 400;
      throw err;
    }
  }
  return days.join(',');
}

/** Valida intervalo en dias (solo para frequency=daily): entero 1-365. */
function validateIntervalDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 365) {
    const err = new Error('intervalDays debe ser entero entre 1 y 365');
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/** Valida que un body field sea booleano estricto (no truthy/falsy). */
function validateBooleanField(value, fieldName) {
  if (value !== true && value !== false) {
    const err = new Error(`${fieldName} debe ser booleano (true o false)`);
    err.statusCode = 400;
    throw err;
  }
  return value;
}

/** Valida lista de indices: string de numeros separados por coma, sin negativos. */
function validateIndexList(value, fieldName) {
  if (typeof value !== 'string') {
    const err = new Error(`${fieldName} debe ser string (ej. "1,3,5")`);
    err.statusCode = 400;
    throw err;
  }
  const trimmed = value.trim();
  // Vacio = sin seleccion (valido, el script no deshabilita nada)
  if (trimmed === '') return '';
  // "todos" es valido para el script de PowerShell
  if (trimmed.toLowerCase() === 'todos') return trimmed;
  if (!/^\d+(,\s*\d+)*$/.test(trimmed)) {
    const err = new Error(`${fieldName} debe ser numeros separados por coma (ej. "1,3,5")`);
    err.statusCode = 400;
    throw err;
  }
  return trimmed;
}

/**
 * Valida DownloadsAgeDays: entero positivo entre 1 y 365.
 * Se usa como argumento para Clean-Disk.ps1 (-DownloadsAgeDays).
 */
function validateDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 365) {
    const err = new Error('DownloadsAgeDays debe ser entero entre 1 y 365');
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/**
 * Normaliza el campo Status de schtasks /Query CSV.
 * Windows reporta estados en el idioma del sistema (ej. "Listo" en español,
 * "Ready" en ingles, "Prêt" en frances). Mapea a un enum estandarizado.
 * Insensible a mayusculas/minusculas y comillas.
 */
function normalizeSchTaskStatus(raw) {
  const cleaned = raw.replace(/^"|"$/g, '').trim();
  const lower = cleaned.toLowerCase();

  const map = {
    // Ingles
    'ready': 'Ready',
    'running': 'Running',
    'disabled': 'Disabled',
    // Espanol
    'listo': 'Ready',
    'preparado': 'Ready',
    'en ejecucion': 'Running',
    'ejecutandose': 'Running',
    'deshabilitado': 'Disabled',
    'deshabilitada': 'Disabled',
    'inhabilitado': 'Disabled',
    // Frances
    'prêt': 'Ready',
    'en cours': 'Running',
    'désactivé': 'Disabled',
    'desactive': 'Disabled',
    // Aleman
    'bereit': 'Ready',
    'wird ausgeführt': 'Running',
    'deaktiviert': 'Disabled',
    // Portugues
    'pronto': 'Ready',
    'em execução': 'Running',
    'em execucao': 'Running',
    'desativado': 'Disabled',
    'desativada': 'Disabled',
    // Italiano
    'pronto': 'Ready',
    'in esecuzione': 'Running',
    'disattivato': 'Disabled',
    // Fallback heuristics: si contiene ciertas palabras clave
  };

  if (map[lower]) return map[lower];

  // Heuristic fallbacks
  if (lower.includes('deshab') || lower.includes('disab') || lower.includes('desat') || lower.includes('inhab')) return 'Disabled';
  if (lower.includes('ejec') || lower.includes('run') || lower.includes('cours') || lower.includes('ander')) return 'Running';
  if (lower.includes('list') || lower.includes('read') || lower.includes('prep') || lower.includes('bereit') || lower.includes('pront') || lower.includes('prêt')) return 'Ready';

  return cleaned || 'Unknown';
}

// ═══════════════════════════════════════════════════════
// Secure file I/O helpers
// ═══════════════════════════════════════════════════════

function loadJsonSafe(filePath, fallback = null) {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function findLatestReport(moduleDir, prefix) {
  const reportsDir = join(moduleDir, 'reports');
  if (!existsSync(reportsDir)) return null;
  const pattern = new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})\\.md$`);
  const files = readdirSync(reportsDir)
    .filter((f) => pattern.test(f))
    .sort()
    .reverse();
  return files.length > 0 ? join(reportsDir, files[0]) : null;
}

/**
 * Construye ruta de reporte con validacion anti-traversal.
 * - prefix: viene de MODULES (whitelist interna, no input de usuario)
 * - date: validado previamente con validateDate()
 * La ruta final se normaliza y se verifica que permanezca dentro del directorio esperado.
 */
function buildReportPath(moduleDir, prefix, date) {
  const reportsDir = join(moduleDir, 'reports');
  const candidate = normalize(join(reportsDir, `${prefix}-${date}.md`));
  // Verifica que la ruta normalizada no haya escapado del directorio reports
  if (!candidate.startsWith(reportsDir + '\\') && !candidate.startsWith(reportsDir + '/')) {
    return null;
  }
  return existsSync(candidate) ? candidate : null;
}

// ═══════════════════════════════════════════════════════
// Limpieza de disco — ejecucion nativa en Node (sin powershell.exe)
//
// Lanzar powershell.exe -File desde este proceso (un servidor con un
// socket de red abierto) se quedaba colgado indefinidamente sin avanzar
// ni siquiera a la primera linea del script, mientras que el mismo script
// invocado fuera de un proceso "de servidor" terminaba en menos de 1s.
// Para no depender de ese comportamiento, la accion de limpieza borra
// los archivos directamente via fs. La papelera de reciclaje tambien se
// vacia por filesystem (C:\$Recycle.Bin\<SID>\...) en vez de via COM/
// Clear-RecycleBin, evitando cualquier dialogo de confirmacion de Shell.
// ═══════════════════════════════════════════════════════

const WINDIR = process.env.WINDIR || 'C:\\WINDOWS';

/** Borra el contenido (no la carpeta) de dirPath. Ignora entradas bloqueadas/sin permiso. */
async function removeDirContents(dirPath) {
  let deleted = 0;
  let errors = 0;
  let entries;
  try {
    entries = await readdir(dirPath);
  } catch {
    return { deleted, errors };
  }
  for (const entry of entries) {
    try {
      await rm(join(dirPath, entry), { recursive: true, force: true });
      deleted++;
    } catch {
      errors++;
    }
  }
  return { deleted, errors };
}

/** Vacia la papelera de reciclaje borrando directamente las carpetas por SID. */
async function emptyRecycleBinNative() {
  const recycleRoot = 'C:\\$Recycle.Bin';
  let deleted = 0;
  let errors = 0;
  let sidDirs;
  try {
    sidDirs = await readdir(recycleRoot);
  } catch {
    return { deleted, errors, ok: false };
  }
  for (const sid of sidDirs) {
    const result = await removeDirContents(join(recycleRoot, sid));
    deleted += result.deleted;
    errors += result.errors;
  }
  return { deleted, errors, ok: true };
}

/** Borra archivos de Descargas con LastWriteTime mas viejo que ageDays. */
async function deleteOldDownloads(ageDays) {
  const downloadsPath = join(process.env.USERPROFILE, 'Downloads');
  let entries;
  try {
    entries = await readdir(downloadsPath);
  } catch {
    return { deleted: 0, error: true };
  }
  const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const name of entries) {
    const filePath = join(downloadsPath, name);
    try {
      const info = await stat(filePath);
      if (info.isFile() && info.mtimeMs < cutoff) {
        await unlink(filePath);
        deleted++;
      }
    } catch {
      // bloqueado o ya no existe — se ignora
    }
  }
  return { deleted, error: false };
}

/**
 * Ejecuta la limpieza de disco completa de forma nativa, emitiendo cada
 * paso via onOutput (para SSE) y logueando en apply-log.txt igual que
 * lo hacia Clean-Disk.ps1.
 */
async function runCleanupActionNative(envVars, onOutput) {
  const logDir = join(MODULES.cleanup.dir, 'reports');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, MODULES.cleanup.logFile);

  const writeLog = (message) => {
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const line = `[${stamp}] ${message}`;
    appendFileSync(logPath, line + '\n');
    onOutput(line);
  };

  writeLog('=== Limpieza de disco - inicio ===');

  const tempResult = await removeDirContents(process.env.TEMP);
  const winTempResult = await removeDirContents(join(WINDIR, 'Temp'));
  const prefetchResult = await removeDirContents(join(WINDIR, 'Prefetch'));
  writeLog(
    `Temporales de Windows: ${tempResult.deleted + winTempResult.deleted + prefetchResult.deleted} ` +
    `elementos borrados, ${tempResult.errors + winTempResult.errors + prefetchResult.errors} omitidos (en uso o requieren admin).`,
  );

  let cacheDeleted = 0;
  let cacheErrors = 0;
  const cachePaths = [
    join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
    join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
  ];
  for (const p of cachePaths) {
    const r = await removeDirContents(p);
    cacheDeleted += r.deleted;
    cacheErrors += r.errors;
  }
  try {
    const ffRoot = join(process.env.APPDATA, 'Mozilla', 'Firefox', 'Profiles');
    const profiles = await readdir(ffRoot);
    for (const profile of profiles) {
      for (const sub of ['cache2', 'startupCache']) {
        const r = await removeDirContents(join(ffRoot, profile, sub));
        cacheDeleted += r.deleted;
        cacheErrors += r.errors;
      }
    }
  } catch {
    // sin perfiles de Firefox — se ignora
  }
  writeLog(`Cache de navegadores: ${cacheDeleted} elementos borrados, ${cacheErrors} omitidos (cierra el navegador antes para mejores resultados).`);

  const ageDays = envVars.DOWNLOADS_AGE_DAYS ? Number(envVars.DOWNLOADS_AGE_DAYS) : 30;
  const downloadsResult = await deleteOldDownloads(ageDays);
  writeLog(
    downloadsResult.error
      ? 'Descargas: carpeta no encontrada.'
      : `Descargas viejas borradas: ${downloadsResult.deleted} archivos.`,
  );

  const recycleResult = await emptyRecycleBinNative();
  writeLog(
    recycleResult.ok
      ? `Papelera vaciada: ${recycleResult.deleted} elementos borrados, ${recycleResult.errors} omitidos.`
      : 'No se pudo acceder a la papelera de reciclaje.',
  );

  writeLog('=== Limpieza de disco - fin ===');
}

// ═══════════════════════════════════════════════════════
// Escaneo de limpieza — ejecucion nativa en Node (sin powershell.exe)
//
// Mismo principio que runCleanupActionNative: evitar el spawn de powershell.exe
// desde un proceso servidor con socket de red. Las mediciones son puramente
// filesystem (tamanios de carpetas, conteo de archivos), sin depender de COM.
// ═══════════════════════════════════════════════════════

async function getDirSizeMB(dirPath) {
  let totalBytes = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      try {
        const full = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalBytes += (await getDirSizeMB(full)) * 1024 * 1024;
        } else if (entry.isFile()) {
          const info = await stat(full);
          totalBytes += info.size;
        }
      } catch { /* archivo bloqueado o sin permiso — ignorar */ }
    }
  } catch { /* directorio no accesible */ }
  return Math.round((totalBytes / (1024 * 1024)) * 10) / 10;
}

async function runCleanupScanNative(ageDays, onOutput) {
  const reportsDir = join(MODULES.cleanup.dir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportsDir, `cleanup-report-${today}.md`);
  const countsPath = join(reportsDir, `cleanup-counts.json`);

  const line = (s) => { onOutput(s); return s; };
  const lines = [];

  lines.push(line(`# Reporte de limpieza de disco - ${today}`));
  lines.push(line(''));

  // ── Temporales ──
  const userTemp = process.env.TEMP;
  const winTemp = join(WINDIR, 'Temp');
  const prefetch = join(WINDIR, 'Prefetch');

  const [userTempMB, winTempMB, prefetchMB] = await Promise.all([
    getDirSizeMB(userTemp),
    getDirSizeMB(winTemp),
    getDirSizeMB(prefetch),
  ]);
  const tempTotalMB = userTempMB + winTempMB + prefetchMB;

  lines.push(line(`## Temporales de Windows (${tempTotalMB} MB)`));
  lines.push(line(''));
  lines.push(line(`- %TEMP% (${userTemp}): ${userTempMB} MB`));
  lines.push(line(`- Windows\\Temp: ${winTempMB} MB`));
  lines.push(line(`- Prefetch: ${prefetchMB} MB`));
  lines.push(line(''));

  // ── Cache de navegadores ──
  const cachePaths = {
    Chrome: join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
    Edge: join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
  };

  lines.push(line('## Cache de navegadores'));
  lines.push(line(''));
  let cacheTotalMB = 0;
  for (const [browser, p] of Object.entries(cachePaths)) {
    const sizeMB = await getDirSizeMB(p);
    cacheTotalMB += sizeMB;
    if (sizeMB > 0) lines.push(line(`- ${browser}: ${sizeMB} MB (${p})`));
  }

  // Firefox cache
  try {
    const ffRoot = join(process.env.APPDATA, 'Mozilla', 'Firefox', 'Profiles');
    const profiles = await readdir(ffRoot);
    for (const profile of profiles) {
      for (const sub of ['cache2', 'startupCache']) {
        const sizeMB = await getDirSizeMB(join(ffRoot, profile, sub));
        cacheTotalMB += sizeMB;
        if (sizeMB > 0) lines.push(line(`- Firefox\\${profile}\\${sub}: ${sizeMB} MB`));
      }
    }
  } catch { /* sin Firefox */ }
  lines.push(line(''));

  // ── Descargas viejas ──
  const downloadsPath = join(process.env.USERPROFILE, 'Downloads');
  let downloadsCount = 0;
  let downloadsTotalMB = 0;
  let downloadsError = false;

  try {
    const entries = await readdir(downloadsPath, { withFileTypes: true });
    const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
    const oldFiles = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = join(downloadsPath, entry.name);
      try {
        const info = await stat(full);
        if (info.mtimeMs < cutoff) {
          oldFiles.push({ name: entry.name, size: info.size, mtime: info.mtime });
        }
      } catch { /* ignorar */ }
    }

    downloadsCount = oldFiles.length;
    downloadsTotalMB = Math.round((oldFiles.reduce((s, f) => s + f.size, 0) / (1024 * 1024)) * 10) / 10;

    lines.push(line(`## Descargas con mas de ${ageDays} dias`));
    lines.push(line(''));
    lines.push(line(`Total: ${downloadsTotalMB} MB en ${downloadsCount} archivos`));
    lines.push(line(''));
    if (oldFiles.length > 0) {
      lines.push(line('```'));
      for (const f of oldFiles.sort((a, b) => a.mtime - b.mtime)) {
        lines.push(line(`${f.mtime.toISOString().slice(0, 10)}  ${(f.size / (1024 * 1024)).toFixed(2)} MB  ${f.name}`));
      }
      lines.push(line('```'));
      lines.push(line(''));
    } else {
      lines.push(line(`No hay archivos con mas de ${ageDays} dias.`));
      lines.push(line(''));
    }
  } catch {
    downloadsError = true;
    lines.push(line('## Descargas con mas de ' + ageDays + ' dias'));
    lines.push(line(''));
    lines.push(line('Carpeta de Descargas no encontrada.'));
    lines.push(line(''));
  }

  // ── Papelera ──
  const recycleRoot = 'C:\\$Recycle.Bin';
  let recycleCount = 0;
  let recycleTotalMB = 0;
  let recycleError = false;

  try {
    const sidDirs = await readdir(recycleRoot);
    for (const sid of sidDirs) {
      const full = join(recycleRoot, sid);
      try {
        const entries = await readdir(full);
        recycleCount += entries.length;
        for (const entry of entries) {
          try {
            const info = await stat(join(full, entry));
            recycleTotalMB += info.size / (1024 * 1024);
          } catch { /* ignorar */ }
        }
      } catch { /* ignorar */ }
    }
    recycleTotalMB = Math.round(recycleTotalMB * 10) / 10;
  } catch {
    recycleError = true;
  }

  lines.push(line('## Papelera de reciclaje'));
  lines.push(line(''));
  lines.push(line(`Elementos en la papelera: ${recycleCount} (${recycleTotalMB} MB)`));
  lines.push(line(''));

  // ── Escribir archivos ──
  writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8');

  const counts = {
    date: today,
    reportPath,
    temp: { total_mb: tempTotalMB, error: false },
    browser_cache: { total_mb: cacheTotalMB, error: false },
    downloads: { total_mb: downloadsTotalMB, count: downloadsCount, error: downloadsError },
    recycle_bin: { total_mb: recycleTotalMB, count: recycleCount, error: recycleError },
  };
  writeFileSync(countsPath, JSON.stringify(counts, null, 2), 'utf-8');

  onOutput(`Reporte generado en: ${reportPath}`);
  onOutput(`Conteos generados en: ${countsPath}`);
}

// ═══════════════════════════════════════════════════════
// Escaneo de actualizaciones — ejecucion nativa en Node (sin powershell.exe)
//
// Diagnostico (2026-06-19): spawn('powershell.exe', ['-File', scriptPath, ...])
// invocado desde DENTRO de este servidor Express muere en ~150ms con exit code 1
// y CERO salida en stdout/stderr (ni siquiera un error de PowerShell), incluso en
// el primer request tras un arranque limpio. El MISMO spawn (mismos args, mismo
// PATH, mismo cwd) ejecutado desde un script de Node suelto (sin servidor HTTP)
// funciona siempre. No se identifico la causa raiz exacta (se probaron PATH, cwd,
// env, num. de requests previos — ninguno explica la diferencia). spawn() de
// binarios nativos (winget.exe, schtasks.exe, taskkill.exe) SI funciona bien desde
// este mismo servidor. Por eso, en vez de invocar Check-Updates.ps1, se invocan
// winget/pip/npm/choco directamente, sin PowerShell de por medio.
//
// spawnCapture() usa shell:false (Win32 CreateProcess directo, args como array
// real — sin riesgo de inyeccion, valores con espacios funcionan bien). Solo
// npm/pip/choco son wrappers .cmd en Windows que `spawn` sin shell no resuelve;
// para esos 3 se usa spawnCaptureShell(), que SI usa shell:true. Node no escapa
// los argumentos en ese modo (advertencia DEP0190) — por eso spawnCaptureShell
// solo se usa con literales fijos del codigo, nunca con datos que puedan tener
// espacios o comillas (ej. nombres de programas o valores de registro).
// ═══════════════════════════════════════════════════════

function spawnCapture(cmd, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let proc;
    try {
      proc = spawn(cmd, args, { windowsHide: true, shell: false });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: err.message });
      return;
    }
    proc.stdout?.on('data', (d) => { stdout += d; });
    proc.stderr?.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err) => resolve({ code: -1, stdout, stderr: err.message }));
  });
}

function spawnCaptureShell(cmd, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let proc;
    try {
      proc = spawn(cmd, args, { windowsHide: true, shell: true });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: err.message });
      return;
    }
    proc.stdout?.on('data', (d) => { stdout += d; });
    proc.stderr?.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err) => resolve({ code: -1, stdout, stderr: err.message }));
  });
}

async function commandExists(cmd) {
  const r = await spawnCapture('where', [cmd]);
  return r.code === 0 && r.stdout.trim().length > 0;
}

/** Detecta si el proceso corre elevado (`net session` solo tiene exito como admin). */
async function isAdminWindows() {
  const r = await spawnCapture('net', ['session']);
  return r.code === 0;
}

function padRight(value, width) {
  return String(value ?? '').padEnd(width);
}

async function checkWingetUpdates() {
  if (!(await commandExists('winget'))) {
    return { count: 0, error: false, block: 'winget no esta disponible en este sistema.' };
  }
  const r = await spawnCapture('winget', ['upgrade', '--include-unknown', '--disable-interactivity', '--accept-source-agreements']);
  const lines = r.stdout.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^Name\s+Id\s+Version\s+Available/.test(l));
  if (headerIdx < 0) {
    if (r.code !== 0 && !r.stdout.trim()) {
      return { count: 0, error: true, block: `Error al ejecutar winget: ${r.stderr || 'codigo ' + r.code}` };
    }
    return { count: 0, error: false, block: 'Todo actualizado.' };
  }
  const tableLines = lines.slice(headerIdx).filter((l) => l.trim() !== '');
  const dataRows = tableLines.filter((l, i) => i !== 0 && !/^-+$/.test(l) && !/^\d+\s+upgrades? available/i.test(l));
  const count = dataRows.length;
  const block = count === 0 ? 'Todo actualizado.' : '```\n' + [tableLines[0], ...dataRows].join('\n') + '\n```';
  return { count, error: false, block };
}

async function checkPipUpdates() {
  if (!(await commandExists('pip'))) {
    return { count: 0, error: false, block: 'pip no esta disponible en este sistema.' };
  }
  const r = await spawnCapture('pip', ['list', '--outdated', '--format=json']);
  try {
    const pkgs = JSON.parse(r.stdout || '[]');
    const count = pkgs.length;
    if (count === 0) return { count, error: false, block: 'Todos los paquetes pip estan actualizados.' };
    const header = padRight('Package', 40) + padRight('Version', 12) + 'Latest';
    const rows = pkgs.map((p) => padRight(p.name, 40) + padRight(p.version, 12) + p.latest_version);
    return { count, error: false, block: '```\n' + header + '\n' + rows.join('\n') + '\n```' };
  } catch (err) {
    return { count: 0, error: true, block: `Error al ejecutar pip: ${err.message}` };
  }
}

async function checkNpmUpdates() {
  if (!(await commandExists('npm'))) {
    return { count: 0, error: false, block: 'npm no esta disponible en este sistema.' };
  }
  const r = await spawnCaptureShell('npm', ['outdated', '-g', '--json']);
  const text = (r.stdout || '').trim();
  if (!text || text === '{}') return { count: 0, error: false, block: 'Todos los paquetes npm globales estan actualizados.' };
  try {
    const obj = JSON.parse(text);
    if (obj.error) return { count: 0, error: true, block: `Error al ejecutar npm: ${obj.error.summary || JSON.stringify(obj.error)}` };
    const names = Object.keys(obj);
    const count = names.length;
    if (count === 0) return { count, error: false, block: 'Todos los paquetes npm globales estan actualizados.' };
    const header = padRight('Package', 30) + padRight('Current', 12) + 'Latest';
    const rows = names.map((n) => padRight(n, 30) + padRight(obj[n].current, 12) + obj[n].latest);
    return { count, error: false, block: '```\n' + header + '\n' + rows.join('\n') + '\n```' };
  } catch (err) {
    return { count: 0, error: true, block: `Error al ejecutar npm: ${err.message}` };
  }
}

async function checkChocoUpdates() {
  if (!(await commandExists('choco'))) {
    return { count: 0, error: false, block: 'Chocolatey no esta instalado en este sistema.' };
  }
  const r = await spawnCapture('choco', ['outdated', '-r', '--no-color']);
  const lines = (r.stdout || '').split(/\r?\n/).filter((l) => l.includes('|'));
  const count = lines.length;
  if (count === 0) return { count, error: false, block: 'Todos los paquetes choco estan actualizados.' };
  const rows = lines.map((l) => {
    const parts = l.split('|');
    return padRight(parts[0], 30) + padRight(parts[1], 12) + (parts[2] || '');
  });
  const header = padRight('Package', 30) + padRight('Current', 12) + 'Available';
  return { count, error: false, block: '```\n' + header + '\n' + rows.join('\n') + '\n```' };
}

async function runUpdatesScanNative(onOutput) {
  const reportsDir = join(MODULES.updates.dir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportsDir, `update-report-${today}.md`);
  const countsPath = join(reportsDir, 'update-counts.json');

  onOutput('Revisando winget...');
  const winget = await checkWingetUpdates();
  onOutput('Revisando pip...');
  const pip = await checkPipUpdates();
  onOutput('Revisando npm...');
  const npm = await checkNpmUpdates();
  onOutput('Revisando choco...');
  const choco = await checkChocoUpdates();

  const fmt = (label, r) => (r.error ? `- ${label}: error (ver detalle abajo)` : `- ${label}: ${r.count} disponibles`);

  const lines = [
    `# Reporte de actualizaciones - ${today}`, '',
    '## Resumen', '',
    fmt('Winget', winget), fmt('Pip', pip), fmt('npm', npm), fmt('Choco', choco), '',
    '## Winget (apps y drivers)', '', winget.block, '',
    '## Python (pip)', '', pip.block, '',
    '## npm (paquetes globales)', '', npm.block, '',
    '## Chocolatey', '', choco.block, '',
  ];

  writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8');
  writeFileSync(countsPath, JSON.stringify({
    date: today,
    reportPath,
    winget: { count: winget.count, error: winget.error },
    pip: { count: pip.count, error: pip.error },
    npm: { count: npm.count, error: npm.error },
    choco: { count: choco.count, error: choco.error },
  }, null, 2), 'utf-8');

  onOutput(`Reporte generado en: ${reportPath}`);
  onOutput(`Conteos generados en: ${countsPath}`);
}

/** Instala lo detectado por el scan: winget/pip/npm/choco directo, sin PowerShell. */
async function runUpdatesActionNative(onOutput) {
  const logDir = join(MODULES.updates.dir, 'reports');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, MODULES.updates.logFile);

  const writeLog = (message) => {
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const line = `[${stamp}] ${message}`;
    appendFileSync(logPath, line + '\n');
    onOutput(line);
  };

  writeLog('=== Aplicar actualizaciones - inicio ===');

  if (await commandExists('winget')) {
    onOutput('Ejecutando winget upgrade --all...');
    const r = await spawnCapture('winget', [
      'upgrade', '--all', '--include-unknown', '--disable-interactivity',
      '--accept-source-agreements', '--accept-package-agreements',
    ]);
    writeLog(r.code === 0 ? 'winget upgrade --all completado.' : `winget upgrade fallo (codigo ${r.code}): ${(r.stderr || r.stdout).slice(0, 300)}`);
  } else {
    writeLog('winget no disponible, se omite.');
  }

  if (await commandExists('pip')) {
    const listResult = await spawnCapture('pip', ['list', '--outdated', '--format=json']);
    try {
      const outdated = JSON.parse(listResult.stdout || '[]');
      if (outdated.length === 0) {
        writeLog('No hay paquetes pip desactualizados.');
      } else {
        const ok = [];
        const failed = [];
        for (const pkg of outdated) {
          onOutput(`Instalando ${pkg.name}...`);
          const r = await spawnCapture('pip', ['install', '-U', pkg.name]);
          (r.code === 0 ? ok : failed).push(pkg.name);
        }
        writeLog(`pip install -U OK: ${ok.join(', ') || '(ninguno)'}`);
        if (failed.length > 0) writeLog(`pip install -U FALLO en: ${failed.join(', ')}`);
      }
    } catch (err) {
      writeLog(`pip update fallo: ${err.message}`);
    }
  } else {
    writeLog('pip no disponible, se omite.');
  }

  if (await commandExists('npm')) {
    onOutput('Ejecutando npm update -g...');
    const r = await spawnCaptureShell('npm', ['update', '-g']);
    writeLog(r.code === 0 ? 'npm update -g completado.' : `npm update fallo (codigo ${r.code}).`);
  } else {
    writeLog('npm no disponible, se omite.');
  }

  if (await commandExists('choco')) {
    onOutput('Ejecutando choco upgrade all...');
    const r = await spawnCapture('choco', ['upgrade', 'all', '-y', '--no-color']);
    writeLog(r.code === 0 ? 'choco upgrade all completado.' : `choco upgrade fallo (codigo ${r.code}).`);
  } else {
    writeLog('Chocolatey no disponible, se omite.');
  }

  writeLog('=== Aplicar actualizaciones - fin ===');
}

// ═══════════════════════════════════════════════════════
// Startup optimizer — ejecucion nativa en Node (sin powershell.exe)
//
// Mismo principio que cleanup/updates: evitar powershell.exe especificamente
// (ver "Bug critico conocido" en PROJECT_CONTEXT.md), usando binarios nativos
// (reg.exe, schtasks.exe) en su lugar. Limitaciones aceptadas:
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

const STARTUP_FOLDERS = [
  { dir: join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), label: 'Carpeta Startup (usuario)' },
  { dir: join(process.env.ProgramData || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), label: 'Carpeta Startup (global)' },
];

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

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function runStartupScanNative(onOutput) {
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
async function runStartupActionNative(envVars, onOutput) {
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

function parseIndexSelection(selection, maxLength) {
  if (!selection) return [];
  const trimmed = selection.trim().toLowerCase();
  if (trimmed === 'todos') return Array.from({ length: maxLength }, (_, i) => i);
  const result = [];
  for (const part of selection.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n >= 1 && n <= maxLength) result.push(n - 1);
  }
  return result;
}

// ═══════════════════════════════════════════════════════
// Wrapper: captura errores y responde sin leak de stack
// ═══════════════════════════════════════════════════════

/**
 * Envuelve handlers async/sync para que errores no atrapados
 * no revelen stack traces del sistema operativo al cliente.
 */
function safeHandler(handler) {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

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

  // cleanup y updates → escaneo nativo en Node (sin powershell.exe, ver
  // seccion "Bug critico conocido" en PROJECT_CONTEXT.md)
  if (req.params.module === 'cleanup') {
    const ageDays = req.body?.downloadsAgeDays !== undefined
      ? validateDays(req.body.downloadsAgeDays)
      : 30;
    runNativeOverSSE(res, (onOutput) => runCleanupScanNative(ageDays, onOutput));
    return;
  }

  if (req.params.module === 'updates') {
    runNativeOverSSE(res, (onOutput) => runUpdatesScanNative(onOutput));
    return;
  }

  if (req.params.module === 'startup') {
    runNativeOverSSE(res, (onOutput) => runStartupScanNative(onOutput));
    return;
  }
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

  // Ningun modulo invoca powershell.exe para su accion: los 3 se ejecutan
  // nativos en Node para evitar el cuelgue al spawnear desde este proceso
  // servidor (ver "Bug critico conocido" en PROJECT_CONTEXT.md).
  // Las acciones instalan/cambian cosas reales (winget/pip/npm/choco, registro,
  // tareas) y pueden tardar mucho mas que un escaneo de solo lectura — ej.
  // "winget upgrade --all" tardo 3m28s en una prueba real. Timeout mas alto
  // que el default de runNativeOverSSE (2 min, pensado para escaneos).
  const ACTION_TIMEOUT_MS = 600000;

  if (req.params.module === 'cleanup') {
    runNativeOverSSE(res, (onOutput) => runCleanupActionNative(envVars, onOutput), ACTION_TIMEOUT_MS);
    return;
  }

  if (req.params.module === 'updates') {
    runNativeOverSSE(res, (onOutput) => runUpdatesActionNative(onOutput), ACTION_TIMEOUT_MS);
    return;
  }

  if (req.params.module === 'startup') {
    runNativeOverSSE(res, (onOutput) => runStartupActionNative(envVars, onOutput), ACTION_TIMEOUT_MS);
    return;
  }
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
