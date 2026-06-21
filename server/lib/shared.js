import { spawn } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve, normalize } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, '..', '..');

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

export const WINDIR = process.env.WINDIR || 'C:\\WINDOWS';

// ── Whitelist: unica fuente de verdad para scripts validos ──
// Previene command injection via object-key lookup directo.
// Ningun input de usuario se concatena en rutas de archivo; solo se indexa este objeto.
export const MODULES = Object.freeze({
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
  }),
  ram: Object.freeze({
    dir: join(PROJECT_ROOT, 'ram-optimizer'),
    scan: 'Scan-RAM.ps1',
    action: 'Free-RAM.ps1',
    countsFile: 'ram-counts.json',
    reportPrefix: 'ram-report',
    taskName: 'RAMOptimizer_Weekly',
    logFile: 'optimize-log.txt',
  }),
});

export const TASK_TO_MODULE = Object.fromEntries(
  Object.entries(MODULES).map(([key, mod]) => [mod.taskName, mod]),
);

export const VALID_MODULES = Object.keys(MODULES);
export const VALID_TASKS = Object.values(MODULES).map((m) => m.taskName);

// ═══════════════════════════════════════════════════════
// Security helpers
// ═══════════════════════════════════════════════════════

/** Valida que el parametro :module exista en la whitelist. */
export function validateModule(module) {
  if (!VALID_MODULES.includes(module)) {
    const err = new Error('Modulo no permitido');
    err.statusCode = 404;
    throw err;
  }
  return MODULES[module];
}

/** Valida formato de fecha YYYY-MM-DD y que sea una fecha real (no 2026-02-30). */
export function validateDate(dateStr) {
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
  // Rango razonable: no hardcodeado, asi no hay que tocarlo en 80 anos
  if (y < 2020 || y > new Date().getFullYear() + 10) {
    const err = new Error('Fecha fuera de rango permitido');
    err.statusCode = 400;
    throw err;
  }
  return dateStr;
}

/** Valida que el parametro :task exista en la whitelist. */
export function validateTask(task) {
  if (!VALID_TASKS.includes(task)) {
    const err = new Error('Tarea no permitida');
    err.statusCode = 404;
    throw err;
  }
  return task;
}

export const VALID_WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Valida hora en formato HH:MM (24h). */
export function validateTime(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    const err = new Error('time debe tener formato HH:MM (24h)');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

/** Valida frecuencia ("daily" o "weekly"). */
export function validateFrequency(value) {
  if (value !== 'daily' && value !== 'weekly') {
    const err = new Error('frequency debe ser "daily" o "weekly"');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

/** Valida lista de dias de la semana (solo para frequency=weekly). */
export function validateWeekdays(value) {
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
export function validateIntervalDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 365) {
    const err = new Error('intervalDays debe ser entero entre 1 y 365');
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/** Valida que un body field sea booleano estricto (no truthy/falsy). */
export function validateBooleanField(value, fieldName) {
  if (value !== true && value !== false) {
    const err = new Error(`${fieldName} debe ser booleano (true o false)`);
    err.statusCode = 400;
    throw err;
  }
  return value;
}

/** Valida lista de indices: string de numeros separados por coma, sin negativos. */
export function validateIndexList(value, fieldName) {
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
export function validateDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 365) {
    const err = new Error('DownloadsAgeDays debe ser entero entre 1 y 365');
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/**
 * Valida el umbral minimo de RAM (modulo ram). Se usa tanto en /api/scan/ram
 * como en /api/action/ram para que ambos construyan la MISMA lista de
 * candidatos - si solo uno de los dos lo aplicara, los indices que el
 * usuario marca en el reporte del scan podrian referirse a un proceso
 * distinto al momento de ejecutar la accion.
 */
export function validateMinRamMB(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 10 || n > 500) {
    const err = new Error('minRamMB debe ser entero entre 10 y 500');
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
export function normalizeSchTaskStatus(raw) {
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

export function loadJsonSafe(filePath, fallback = null) {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`loadJsonSafe: ${filePath} corrupto o ilegible (${err.message})`);
    return fallback;
  }
}

export function findLatestReport(moduleDir, prefix) {
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
export function buildReportPath(moduleDir, prefix, date) {
  const reportsDir = join(moduleDir, 'reports');
  const candidate = normalize(join(reportsDir, `${prefix}-${date}.md`));
  // Verifica que la ruta normalizada no haya escapado del directorio reports
  if (!candidate.startsWith(reportsDir + '\\') && !candidate.startsWith(reportsDir + '/')) {
    return null;
  }
  return existsSync(candidate) ? candidate : null;
}

// ═══════════════════════════════════════════════════════
// Proceso externo — spawn helpers compartidos por los 4 modulos
//
// Diagnostico (2026-06-19): spawn('powershell.exe', ['-File', scriptPath, ...])
// invocado desde DENTRO de este servidor Express muere en ~150ms con exit code 1
// y CERO salida en stdout/stderr, incluso en el primer request tras un arranque
// limpio. El MISMO spawn ejecutado desde un script de Node suelto (sin servidor
// HTTP) funciona siempre. No se identifico la causa raiz exacta. spawn() de
// binarios nativos (winget.exe, schtasks.exe, taskkill.exe) SI funciona bien
// desde este mismo servidor, y los -Command cortos de PowerShell tambien — por
// eso cada modulo invoca sus binarios nativos directo, sin -File de PowerShell.
//
// spawnCapture() usa shell:false (Win32 CreateProcess directo, args como array
// real — sin riesgo de inyeccion, valores con espacios funcionan bien). Solo
// npm/pip/choco son wrappers .cmd en Windows que `spawn` sin shell no resuelve;
// para esos se usa spawnCaptureShell(), que SI usa shell:true. Node no escapa
// los argumentos en ese modo (advertencia DEP0190) — por eso spawnCaptureShell
// solo se usa con literales fijos del codigo, nunca con datos que puedan tener
// espacios o comillas (ej. nombres de programas o valores de registro).
// ═══════════════════════════════════════════════════════

export function spawnCapture(cmd, args) {
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

export function spawnCaptureShell(cmd, args) {
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

export async function commandExists(cmd) {
  const r = await spawnCapture('where', [cmd]);
  return r.code === 0 && r.stdout.trim().length > 0;
}

/** Detecta si el proceso corre elevado (`net session` solo tiene exito como admin). */
export async function isAdminWindows() {
  const r = await spawnCapture('net', ['session']);
  return r.code === 0;
}

export function padRight(value, width) {
  return String(value ?? '').padEnd(width);
}

export function parseCsvLine(line) {
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

export function parseIndexSelection(selection, maxLength) {
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

/**
 * Envuelve handlers async/sync para que errores no atrapados
 * no revelen stack traces del sistema operativo al cliente.
 */
export function safeHandler(handler) {
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
