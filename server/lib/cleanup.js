import { existsSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { rm, readdir, stat, unlink, realpath } from 'fs/promises';
import { join } from 'path';
import { MODULES, WINDIR } from './shared.js';

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

/**
 * Borra el contenido (no la carpeta) de dirPath. Ignora entradas bloqueadas/sin permiso.
 * Antes de tocar nada, resuelve symlinks/junctions reales y rechaza si el resultado
 * es una raiz de disco o esta un solo nivel debajo de ella (ej. "C:\" o "C:\Windows") -
 * todos los llamadores pasan rutas fijas (TEMP, Prefetch, etc.), pero si alguna de esas
 * variables de entorno o un junction apuntara mal, esto evita un rm recursivo catastrofico.
 */
export async function removeDirContents(dirPath) {
  let deleted = 0;
  let errors = 0;
  let entries;
  let realDirPath;
  try {
    realDirPath = await realpath(dirPath);
  } catch {
    return { deleted, errors };
  }
  const depth = realDirPath.replace(/^[A-Za-z]:\\?/, '').split('\\').filter(Boolean).length;
  if (depth <= 1) {
    return { deleted, errors };
  }
  try {
    entries = await readdir(realDirPath);
  } catch {
    return { deleted, errors };
  }
  dirPath = realDirPath;
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
export async function emptyRecycleBinNative() {
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
export async function deleteOldDownloads(ageDays) {
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
export async function runCleanupActionNative(envVars, onOutput) {
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

export async function getDirSizeMB(dirPath) {
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

export async function runCleanupScanNative(ageDays, onOutput) {
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
