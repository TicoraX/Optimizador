import { rm, readdir, stat, unlink, realpath } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  WINDIR, makeLogger, prepareReport, finishReport, appendChange,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Limpieza de disco y optimizador de almacenamiento
//
// Diseñado con garantías estrictas de seguridad:
// 1. Whitelist inmutable de rutas conocidas y regenerables.
// 2. Verificación de frontera real (`realpath`) con profundidad > 1 para
//    prevenir cualquier borrado accidental de raíces o carpetas maestras.
// 3. Omisión silenciosa de archivos en uso (EBUSY/EPERM).
// 4. Modo dryRun no-destructivo para previsualizar antes de ejecutar.
// 5. Diario de cambios persistido en changes.json.
// ═══════════════════════════════════════════════════════

/**
 * Calcula el tamaño en bytes de un directorio de forma recursiva.
 * Tolera archivos bloqueados o sin permisos.
 */
export async function getDirSizeBytes(dirPath) {
  if (!dirPath || !existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += await getDirSizeBytes(full);
        } else if (entry.isFile()) {
          const info = await stat(full);
          total += info.size;
        }
      } catch {
        // archivo bloqueado o sin permisos — ignorar
      }
    }
  } catch {
    // directorio no accesible
  }
  return total;
}

/** Calcula tamaño en Megabytes redondeado a un decimal. */
export async function getDirSizeMB(dirPath) {
  const bytes = await getDirSizeBytes(dirPath);
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

/**
 * Borra el contenido (archivos y subcarpetas) de dirPath sin borrar dirPath en sí.
 * Antes de tocar nada, resuelve symlinks/junctions reales y rechaza si el resultado
 * es una raíz de disco o está a profundidad <= 1 (ej. "C:\", "C:\Windows", "C:\Program Files").
 */
export async function removeDirContents(dirPath) {
  let deleted = 0;
  let errors = 0;
  let freedBytes = 0;
  if (!dirPath) return { deleted, errors, freedBytes };

  let realDirPath;
  try {
    realDirPath = await realpath(dirPath);
  } catch {
    return { deleted, errors, freedBytes };
  }

  const depth = realDirPath.replace(/^[A-Za-z]:\\?/, '').split('\\').filter(Boolean).length;
  if (depth <= 1) {
    return { deleted, errors, freedBytes };
  }

  let entries;
  try {
    entries = await readdir(realDirPath, { withFileTypes: true });
  } catch {
    return { deleted, errors, freedBytes };
  }

  for (const entry of entries) {
    const full = join(realDirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        const size = await getDirSizeBytes(full);
        await rm(full, { recursive: true, force: true });
        deleted++;
        freedBytes += size;
      } else {
        const info = await stat(full);
        await unlink(full);
        deleted++;
        freedBytes += info.size;
      }
    } catch {
      errors++;
    }
  }
  return { deleted, errors, freedBytes };
}

/**
 * Borra archivos específicos dentro de dirPath que coincidan con regexPattern.
 */
export async function removeMatchingFiles(dirPath, regexPattern) {
  let deleted = 0;
  let errors = 0;
  let freedBytes = 0;
  if (!dirPath) return { deleted, errors, freedBytes };

  let realDirPath;
  try {
    realDirPath = await realpath(dirPath);
  } catch {
    return { deleted, errors, freedBytes };
  }

  const depth = realDirPath.replace(/^[A-Za-z]:\\?/, '').split('\\').filter(Boolean).length;
  if (depth <= 1) return { deleted, errors, freedBytes };

  let entries;
  try {
    entries = await readdir(realDirPath, { withFileTypes: true });
  } catch {
    return { deleted, errors, freedBytes };
  }

  for (const entry of entries) {
    if (entry.isFile() && regexPattern.test(entry.name)) {
      const full = join(realDirPath, entry.name);
      try {
        const info = await stat(full);
        await unlink(full);
        deleted++;
        freedBytes += info.size;
      } catch {
        errors++;
      }
    }
  }
  return { deleted, errors, freedBytes };
}

/**
 * Borra archivos de Descargas con fecha de modificación más vieja que ageDays.
 * Con dryRun no borra nada y lista los archivos que se borrarían.
 */
export async function deleteOldDownloads(ageDays, { dryRun = false } = {}) {
  const home = process.env.USERPROFILE;
  if (!home) return { deleted: 0, error: true, files: [], freedBytes: 0 };
  const downloadsPath = join(home, 'Downloads');
  let entries;
  try {
    entries = await readdir(downloadsPath);
  } catch {
    return { deleted: 0, error: true, files: [], freedBytes: 0 };
  }
  const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let freedBytes = 0;
  const files = [];

  for (const name of entries) {
    const filePath = join(downloadsPath, name);
    try {
      const info = await stat(filePath);
      if (info.isFile() && info.mtimeMs < cutoff) {
        files.push({ name, mb: Math.round((info.size / (1024 * 1024)) * 10) / 10, bytes: info.size });
        if (!dryRun) {
          await unlink(filePath);
          deleted++;
          freedBytes += info.size;
        }
      }
    } catch {
      // archivo en uso o sin permisos
    }
  }
  return { deleted, error: false, files, freedBytes };
}

const RECYCLE_BIN_ROOT = `${(process.env.SystemDrive || 'C:').replace(/\\$/, '')}\\$Recycle.Bin`;

/** Cuenta y mide elementos en la papelera de reciclaje por SID. */
export async function measureRecycleBin() {
  const recycleRoot = RECYCLE_BIN_ROOT;
  let sidDirs;
  try {
    sidDirs = await readdir(recycleRoot);
  } catch {
    return { count: 0, mb: 0, bytes: 0, ok: false };
  }
  let count = 0;
  let totalBytes = 0;
  for (const sid of sidDirs) {
    try {
      const entries = await readdir(join(recycleRoot, sid));
      for (const e of entries) {
        if (e.startsWith('$I')) continue; // metadatos de eliminación
        count++;
        try {
          const info = await stat(join(recycleRoot, sid, e));
          totalBytes += info.size;
        } catch {}
      }
    } catch {}
  }
  return { count, mb: Math.round((totalBytes / (1024 * 1024)) * 10) / 10, bytes: totalBytes, ok: true };
}

/** Vacía la papelera de reciclaje borrando los contenidos por SID. */
export async function emptyRecycleBinNative() {
  const recycleRoot = RECYCLE_BIN_ROOT;
  let deleted = 0;
  let errors = 0;
  let freedBytes = 0;
  let sidDirs;
  try {
    sidDirs = await readdir(recycleRoot);
  } catch {
    return { deleted, errors, freedBytes, ok: false };
  }
  for (const sid of sidDirs) {
    const result = await removeDirContents(join(recycleRoot, sid));
    deleted += result.deleted;
    errors += result.errors;
    freedBytes += result.freedBytes;
  }
  return { deleted, errors, freedBytes, ok: true };
}

// ═══════════════════════════════════════════════════════
// Whitelist de Categorías de Limpieza Seguras
// ═══════════════════════════════════════════════════════

export function getSafeTargets() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  const userProfile = process.env.USERPROFILE || '';
  const programData = process.env.ProgramData || 'C:\\ProgramData';

  return {
    temp: {
      name: 'Archivos temporales del sistema',
      safety: 'SAFE',
      paths: [
        process.env.TEMP,
        join(WINDIR, 'Temp'),
      ].filter(Boolean),
    },
    windowsUpdate: {
      name: 'Caché de descargas de Windows Update',
      safety: 'SAFE',
      paths: [
        join(WINDIR, 'SoftwareDistribution', 'Download'),
        join(WINDIR, 'SoftwareDistribution', 'DeliveryOptimization'),
      ],
    },
    crashDumps: {
      name: 'Volcados de error y Crash Dumps',
      safety: 'SAFE',
      paths: [
        join(localAppData, 'CrashDumps'),
        join(programData, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
        join(programData, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
        join(programData, 'Microsoft', 'Windows', 'WER', 'Temp'),
        join(WINDIR, 'Minidump'),
      ],
    },
    devCache: {
      name: 'Cachés de paquetes y herramientas de desarrollo',
      safety: 'SAFE',
      paths: [
        join(localAppData, 'npm-cache'),
        join(appData, 'npm-cache'),
        join(userProfile, '.npm', '_cacache'),
        join(localAppData, 'pip', 'cache'),
        join(localAppData, 'uv', 'cache'),
        join(localAppData, 'Yarn', 'Cache'),
        join(localAppData, 'pnpm', 'store'),
        join(localAppData, 'NuGet', 'v3-cache'),
        join(userProfile, '.cargo', 'registry', 'cache'),
        join(appData, 'Code', 'Cache'),
        join(appData, 'Code', 'CachedData'),
      ],
    },
    shaderCache: {
      name: 'Cachés de shaders de gráficos (GPU)',
      safety: 'SAFE',
      paths: [
        join(localAppData, 'D3DSCache'),
        join(localAppData, 'NVIDIA', 'DXCache'),
        join(localAppData, 'NVIDIA', 'GLCache'),
        join(localAppData, 'AMD', 'DxCache'),
        join(localAppData, 'Intel', 'ShaderCache'),
      ],
    },
    browserCache: {
      name: 'Caché de navegadores web (sin cookies ni logins)',
      safety: 'SAFE',
      paths: [
        join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
        join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
        join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
        join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache'),
        join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Cache'),
        join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Code Cache'),
        join(localAppData, 'Arc', 'User Data', 'Default', 'Cache'),
        join(localAppData, 'Vivaldi', 'User Data', 'Default', 'Cache'),
        join(localAppData, 'Opera Software', 'Opera Stable', 'Cache'),
      ],
      customScan: async () => {
        let mb = 0;
        try {
          const ffRoot = join(appData, 'Mozilla', 'Firefox', 'Profiles');
          const profiles = await readdir(ffRoot);
          for (const profile of profiles) {
            for (const sub of ['cache2', 'startupCache']) {
              mb += await getDirSizeMB(join(ffRoot, profile, sub));
            }
          }
        } catch {}
        return mb;
      },
      customClean: async (dryRun) => {
        let deleted = 0;
        let errors = 0;
        let freedBytes = 0;
        try {
          const ffRoot = join(appData, 'Mozilla', 'Firefox', 'Profiles');
          const profiles = await readdir(ffRoot);
          for (const profile of profiles) {
            for (const sub of ['cache2', 'startupCache']) {
              const target = join(ffRoot, profile, sub);
              if (dryRun) {
                freedBytes += await getDirSizeBytes(target);
              } else {
                const r = await removeDirContents(target);
                deleted += r.deleted;
                errors += r.errors;
                freedBytes += r.freedBytes;
              }
            }
          }
        } catch {}
        return { deleted, errors, freedBytes };
      },
    },
    thumbnails: {
      name: 'Caché de miniaturas de Windows Explorer',
      safety: 'SAFE',
      paths: [],
      customScan: async () => {
        const explorerDir = join(localAppData, 'Microsoft', 'Windows', 'Explorer');
        let total = 0;
        try {
          const entries = await readdir(explorerDir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isFile() && /^(thumbcache|iconcache)_.*\.db$/i.test(e.name)) {
              try {
                const info = await stat(join(explorerDir, e.name));
                total += info.size;
              } catch {}
            }
          }
        } catch {}
        return Math.round((total / (1024 * 1024)) * 10) / 10;
      },
      customClean: async (dryRun) => {
        const explorerDir = join(localAppData, 'Microsoft', 'Windows', 'Explorer');
        if (dryRun) {
          const bytes = (await getDirSizeMB(explorerDir)) * 1024 * 1024;
          return { deleted: 0, errors: 0, freedBytes: bytes };
        }
        return removeMatchingFiles(explorerDir, /^(thumbcache|iconcache)_.*\.db$/i);
      },
    },
    recycle: {
      name: 'Papelera de reciclaje',
      safety: 'CAUTION',
    },
    downloads: {
      name: 'Descargas antiguas',
      safety: 'CAUTION',
    },
  };
}

// ═══════════════════════════════════════════════════════
// Escaneo de Almacenamiento
// ═══════════════════════════════════════════════════════

export async function runCleanupScanNative(ageDays = 30, onOutput) {
  const paths = prepareReport('cleanup');
  const { today, reportPath } = paths;
  const line = (s) => { onOutput(s); return s; };
  const lines = [];

  lines.push(line(`# Reporte de Liberación de Espacio en Disco - ${today}`));
  lines.push(line(''));

  const targets = getSafeTargets();
  const summary = {};
  let grandTotalMB = 0;

  // 1. Temporales
  let tempMB = 0;
  for (const p of targets.temp.paths) tempMB += await getDirSizeMB(p);
  tempMB = Math.round(tempMB * 10) / 10;
  summary.temp = { total_mb: tempMB, error: false };
  grandTotalMB += tempMB;
  lines.push(line(`## Archivos Temporales (${tempMB} MB)`));
  lines.push(line(`- Temporales de usuario (%TEMP%): ${await getDirSizeMB(process.env.TEMP)} MB`));
  lines.push(line(`- Temporales de Windows (%WINDIR%\\Temp): ${await getDirSizeMB(join(WINDIR, 'Temp'))} MB`));
  lines.push(line(''));

  // 2. Windows Update
  let winUpdateMB = 0;
  for (const p of targets.windowsUpdate.paths) winUpdateMB += await getDirSizeMB(p);
  winUpdateMB = Math.round(winUpdateMB * 10) / 10;
  summary.windows_update = { total_mb: winUpdateMB, error: false };
  grandTotalMB += winUpdateMB;
  lines.push(line(`## Windows Update Download Cache (${winUpdateMB} MB)`));
  lines.push(line(`- SoftwareDistribution\\Download: ${await getDirSizeMB(join(WINDIR, 'SoftwareDistribution', 'Download'))} MB`));
  lines.push(line(`- Delivery Optimization: ${await getDirSizeMB(join(WINDIR, 'SoftwareDistribution', 'DeliveryOptimization'))} MB`));
  lines.push(line(''));

  // 3. Crash Dumps
  let crashMB = 0;
  for (const p of targets.crashDumps.paths) crashMB += await getDirSizeMB(p);
  crashMB = Math.round(crashMB * 10) / 10;
  summary.crash_dumps = { total_mb: crashMB, error: false };
  grandTotalMB += crashMB;
  lines.push(line(`## Volcados de Error y Crash Dumps (${crashMB} MB)`));
  lines.push(line(`- Volcados en AppData y WER: ${crashMB} MB`));
  lines.push(line(''));

  // 4. Developer Caches
  let devMB = 0;
  for (const p of targets.devCache.paths) devMB += await getDirSizeMB(p);
  devMB = Math.round(devMB * 10) / 10;
  summary.dev_cache = { total_mb: devMB, error: false };
  grandTotalMB += devMB;
  lines.push(line(`## Cachés de Desarrollo (npm, pip, yarn, nuget, vscode) (${devMB} MB)`));
  for (const p of targets.devCache.paths) {
    const size = await getDirSizeMB(p);
    if (size > 0) lines.push(line(`- \`${p}\`: ${size} MB`));
  }
  lines.push(line(''));

  // 5. Shader Caches
  let shaderMB = 0;
  for (const p of targets.shaderCache.paths) shaderMB += await getDirSizeMB(p);
  shaderMB = Math.round(shaderMB * 10) / 10;
  summary.shader_cache = { total_mb: shaderMB, error: false };
  grandTotalMB += shaderMB;
  lines.push(line(`## Cachés de Shaders GPU (${shaderMB} MB)`));
  lines.push(line(`- DirectX / Vulkan / NVIDIA / AMD / Intel: ${shaderMB} MB`));
  lines.push(line(''));

  // 6. Navegadores
  let browserMB = 0;
  for (const p of targets.browserCache.paths) browserMB += await getDirSizeMB(p);
  browserMB += await targets.browserCache.customScan();
  browserMB = Math.round(browserMB * 10) / 10;
  summary.browser_cache = { total_mb: browserMB, error: false };
  grandTotalMB += browserMB;
  lines.push(line(`## Caché de Navegadores Web (${browserMB} MB)`));
  lines.push(line(`- Chrome, Edge, Firefox, Brave: ${browserMB} MB`));
  lines.push(line(''));

  // 7. Miniaturas
  const thumbMB = await targets.thumbnails.customScan();
  summary.thumbnails = { total_mb: thumbMB, error: false };
  grandTotalMB += thumbMB;
  lines.push(line(`## Miniaturas de Explorador (${thumbMB} MB)`));
  lines.push(line(`- Caché de Explorer (thumbcache_*.db): ${thumbMB} MB`));
  lines.push(line(''));

  // 8. Papelera
  const rb = await measureRecycleBin();
  summary.recycle_bin = { total_mb: rb.mb, count: rb.count, error: !rb.ok };
  grandTotalMB += rb.mb;
  lines.push(line(`## Papelera de Reciclaje (${rb.mb} MB)`));
  lines.push(line(`- Elementos en papelera: ${rb.count} (${rb.mb} MB)`));
  lines.push(line(''));

  // 9. Descargas
  const dlResult = await deleteOldDownloads(ageDays, { dryRun: true });
  const dlMB = Math.round((dlResult.files.reduce((s, f) => s + f.bytes, 0) / (1024 * 1024)) * 10) / 10;
  summary.downloads = { total_mb: dlMB, count: dlResult.files.length, error: dlResult.error };
  grandTotalMB += dlMB;
  lines.push(line(`## Descargas Antiguas (> ${ageDays} días) (${dlMB} MB)`));
  lines.push(line(`- Archivos detectados: ${dlResult.files.length} (${dlMB} MB)`));
  if (dlResult.files.length > 0) {
    lines.push(line('```'));
    for (const f of dlResult.files.slice(0, 30)) {
      lines.push(line(`${f.mb.toFixed(1)} MB  ${f.name}`));
    }
    if (dlResult.files.length > 30) lines.push(line(`... y ${dlResult.files.length - 30} archivos más`));
    lines.push(line('```'));
  }
  lines.push(line(''));

  grandTotalMB = Math.round(grandTotalMB * 10) / 10;
  lines.push(line(`---`));
  lines.push(line(`**Espacio Total Recuperable Estimado: ${grandTotalMB >= 1024 ? (grandTotalMB / 1024).toFixed(2) + ' GB' : grandTotalMB + ' MB'}**`));

  const cleanupItems = [
    { key: 'temp', label: targets.temp.name, sizeMB: tempMB, safety: targets.temp.safety, hint: '%TEMP% y Windows\\Temp' },
    { key: 'windowsUpdate', label: targets.windowsUpdate.name, sizeMB: winUpdateMB, safety: targets.windowsUpdate.safety, hint: 'Instaladores descargados ya aplicados' },
    { key: 'crashDumps', label: targets.crashDumps.name, sizeMB: crashMB, safety: targets.crashDumps.safety, hint: 'Crash dumps y reportes pasados' },
    { key: 'devCache', label: targets.devCache.name, sizeMB: devMB, safety: targets.devCache.safety, hint: 'npm, pip, yarn, nuget, vscode' },
    { key: 'shaderCache', label: targets.shaderCache.name, sizeMB: shaderMB, safety: targets.shaderCache.safety, hint: 'DirectX, Vulkan, NVIDIA, AMD' },
    { key: 'browserCache', label: targets.browserCache.name, sizeMB: browserMB, safety: targets.browserCache.safety, hint: 'Chrome, Edge, Brave y Firefox (sin cookies)' },
    { key: 'thumbnails', label: targets.thumbnails.name, sizeMB: thumbMB, safety: targets.thumbnails.safety, hint: 'Caché de vistas previas de Explorer' },
    { key: 'recycle', label: targets.recycle.name, sizeMB: rb.mb, count: rb.count, safety: targets.recycle.safety, hint: 'Vacía la papelera del sistema' },
    { key: 'downloads', label: targets.downloads.name, sizeMB: dlMB, count: dlResult.files.length, safety: targets.downloads.safety, hint: `Archivos con más de ${ageDays} días` },
  ];

  finishReport(paths, lines, {
    date: today,
    reportPath,
    total_recoverable_mb: grandTotalMB,
    ...summary,
  }, onOutput, cleanupItems);
}

// ═══════════════════════════════════════════════════════
// Acción de Limpieza
// ═══════════════════════════════════════════════════════

export async function runCleanupActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('cleanup', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';

  const rawCats = String(envVars.CLEAN_CATEGORIES || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Alias de compatibilidad
  const selected = new Set(rawCats.map((c) => (c === 'cache' ? 'browserCache' : c)));
  const targets = getSafeTargets();

  writeLog(`=== Limpieza de Disco y Almacenamiento - Inicio${dryRun ? ' (SIMULACION)' : ''} ===`);
  writeLog(`Categorias seleccionadas: ${[...selected].join(', ')}`);

  const categoryList = [
    'temp', 'windowsUpdate', 'crashDumps', 'devCache', 'shaderCache',
    'browserCache', 'thumbnails', 'recycle', 'downloads',
  ].filter((c) => selected.has(c));

  let totalFreedBytes = 0;
  let totalDeletedFiles = 0;

  for (let i = 0; i < categoryList.length; i++) {
    const cat = categoryList[i];
    if (onProgress) {
      onProgress({ current: i + 1, total: categoryList.length, percentage: Math.round(((i + 1) / categoryList.length) * 100) });
    }

    if (cat === 'temp') {
      if (dryRun) {
        let mb = 0;
        for (const p of targets.temp.paths) mb += await getDirSizeMB(p);
        writeLog(`[SIMULACION] Temporales: se liberarian ~${mb} MB`);
      } else {
        let freed = 0;
        let del = 0;
        for (const p of targets.temp.paths) {
          const r = await removeDirContents(p);
          freed += r.freedBytes;
          del += r.deleted;
        }
        totalFreedBytes += freed;
        totalDeletedFiles += del;
        writeLog(`Temporales: liberados ${(freed / (1024 * 1024)).toFixed(1)} MB (${del} elementos)`);
      }
    }

    if (cat === 'windowsUpdate') {
      if (dryRun) {
        let mb = 0;
        for (const p of targets.windowsUpdate.paths) mb += await getDirSizeMB(p);
        writeLog(`[SIMULACION] Windows Update Cache: se liberarian ~${mb} MB`);
      } else {
        let freed = 0;
        let del = 0;
        for (const p of targets.windowsUpdate.paths) {
          const r = await removeDirContents(p);
          freed += r.freedBytes;
          del += r.deleted;
        }
        totalFreedBytes += freed;
        totalDeletedFiles += del;
        writeLog(`Windows Update Cache: liberados ${(freed / (1024 * 1024)).toFixed(1)} MB`);
      }
    }

    if (cat === 'crashDumps') {
      if (dryRun) {
        let mb = 0;
        for (const p of targets.crashDumps.paths) mb += await getDirSizeMB(p);
        writeLog(`[SIMULACION] Crash Dumps & WER: se liberarian ~${mb} MB`);
      } else {
        let freed = 0;
        let del = 0;
        for (const p of targets.crashDumps.paths) {
          const r = await removeDirContents(p);
          freed += r.freedBytes;
          del += r.deleted;
        }
        totalFreedBytes += freed;
        totalDeletedFiles += del;
        writeLog(`Crash Dumps & WER: liberados ${(freed / (1024 * 1024)).toFixed(1)} MB`);
      }
    }

    if (cat === 'devCache') {
      if (dryRun) {
        let mb = 0;
        for (const p of targets.devCache.paths) mb += await getDirSizeMB(p);
        writeLog(`[SIMULACION] Cachés de Desarrollo (npm/pip/yarn/nuget/vscode): se liberarian ~${mb} MB`);
      } else {
        let freed = 0;
        let del = 0;
        for (const p of targets.devCache.paths) {
          const r = await removeDirContents(p);
          freed += r.freedBytes;
          del += r.deleted;
        }
        totalFreedBytes += freed;
        totalDeletedFiles += del;
        writeLog(`Cachés de Desarrollo: liberados ${(freed / (1024 * 1024)).toFixed(1)} MB`);
      }
    }

    if (cat === 'shaderCache') {
      if (dryRun) {
        let mb = 0;
        for (const p of targets.shaderCache.paths) mb += await getDirSizeMB(p);
        writeLog(`[SIMULACION] Cachés de Shaders GPU: se liberarian ~${mb} MB`);
      } else {
        let freed = 0;
        let del = 0;
        for (const p of targets.shaderCache.paths) {
          const r = await removeDirContents(p);
          freed += r.freedBytes;
          del += r.deleted;
        }
        totalFreedBytes += freed;
        totalDeletedFiles += del;
        writeLog(`Cachés de Shaders GPU: liberados ${(freed / (1024 * 1024)).toFixed(1)} MB`);
      }
    }

    if (cat === 'browserCache') {
      if (dryRun) {
        let mb = 0;
        for (const p of targets.browserCache.paths) mb += await getDirSizeMB(p);
        mb += await targets.browserCache.customScan();
        writeLog(`[SIMULACION] Caché de Navegadores: se liberarian ~${mb.toFixed(1)} MB`);
      } else {
        let freed = 0;
        let del = 0;
        for (const p of targets.browserCache.paths) {
          const r = await removeDirContents(p);
          freed += r.freedBytes;
          del += r.deleted;
        }
        const ff = await targets.browserCache.customClean(false);
        freed += ff.freedBytes;
        del += ff.deleted;
        totalFreedBytes += freed;
        totalDeletedFiles += del;
        writeLog(`Caché de Navegadores: liberados ${(freed / (1024 * 1024)).toFixed(1)} MB`);
      }
    }

    if (cat === 'thumbnails') {
      if (dryRun) {
        const r = await targets.thumbnails.customClean(true);
        writeLog(`[SIMULACION] Miniaturas Explorer: se liberarian ${(r.freedBytes / (1024 * 1024)).toFixed(1)} MB (${r.deleted} archivos)`);
      } else {
        const r = await targets.thumbnails.customClean(false);
        totalFreedBytes += r.freedBytes;
        totalDeletedFiles += r.deleted;
        writeLog(`Miniaturas Explorer: liberados ${(r.freedBytes / (1024 * 1024)).toFixed(1)} MB (${r.deleted} archivos)`);
      }
    }

    if (cat === 'recycle') {
      if (dryRun) {
        const rb = await measureRecycleBin();
        writeLog(`[SIMULACION] Papelera: se vaciarian ${rb.count} elementos (~${rb.mb} MB). ESTO NO SE PUEDE DESHACER.`);
      } else {
        const r = await emptyRecycleBinNative();
        totalFreedBytes += r.freedBytes;
        totalDeletedFiles += r.deleted;
        writeLog(`Papelera: vaciada con éxito (${(r.freedBytes / (1024 * 1024)).toFixed(1)} MB liberados)`);
      }
    }

    if (cat === 'downloads') {
      const ageDays = envVars.DOWNLOADS_AGE_DAYS ? Number(envVars.DOWNLOADS_AGE_DAYS) : 30;
      if (dryRun) {
        const r = await deleteOldDownloads(ageDays, { dryRun: true });
        writeLog(`[SIMULACION] Descargas antiguas (> ${ageDays} dias): ${r.files.length} archivos detectados`);
        for (const f of r.files.slice(0, 20)) writeLog(`  - ${f.name} (${f.mb} MB)`);
      } else {
        const r = await deleteOldDownloads(ageDays, { dryRun: false });
        totalFreedBytes += r.freedBytes;
        totalDeletedFiles += r.deleted;
        writeLog(`Descargas antiguas: eliminados ${r.deleted} archivos (${(r.freedBytes / (1024 * 1024)).toFixed(1)} MB liberados)`);
      }
    }
  }

  const totalFreedMB = Math.round((totalFreedBytes / (1024 * 1024)) * 10) / 10;
  if (!dryRun && totalFreedMB > 0) {
    appendChange('cleanup', {
      action: 'disk_clean',
      categories: [...selected],
      freedMB: totalFreedMB,
      deletedFiles: totalDeletedFiles,
    });
  }

  writeLog(`=== Limpieza de Disco - Fin (${dryRun ? 'Simulacion completada' : 'Liberados ' + totalFreedMB + ' MB en total'}) ===`);
}
