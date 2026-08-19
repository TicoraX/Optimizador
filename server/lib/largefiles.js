import { stat, opendir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname, basename, isAbsolute } from 'path';
import { spawnCapture, makeLogger, makeGuard, spawnCaptureShell, WINDIR } from './shared.js';

// ═══════════════════════════════════════════════════════
// Buscador de Archivos Gigantes (Space Hogs Hunter)
//
// Identifica archivos de gran tamaño (>250 MB por defecto)
// en las carpetas de usuario para que el operador pueda
// auditar y liberar espacio masivo de forma consciente.
// ═══════════════════════════════════════════════════════

const CATEGORY_MAP = {
  '.iso': 'Imagen de Disco',
  '.vmdk': 'Disco Virtual',
  '.vhd': 'Disco Virtual',
  '.vhdx': 'Disco Virtual',
  '.qcow2': 'Disco Virtual',
  '.mp4': 'Video',
  '.mkv': 'Video',
  '.avi': 'Video',
  '.mov': 'Video',
  '.zip': 'Archivo Comprimido',
  '.rar': 'Archivo Comprimido',
  '.7z': 'Archivo Comprimido',
  '.tar': 'Archivo Comprimido',
  '.gz': 'Archivo Comprimido',
  '.exe': 'Instalador / Ejecutable',
  '.msi': 'Instalador / Paquete',
  '.dmp': 'Crash Dump',
  '.dump': 'Crash Dump',
  '.log': 'Registro de Logs',
  '.bak': 'Copia de Seguridad',
};

const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  'appdata',
  'application data',
  'windows',
  'winsxs',
  'program files',
  'program files (x86)',
  '$recycle.bin',
  'system volume information',
]);

export function classifyFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  return CATEGORY_MAP[ext] || 'Otro archivo grande';
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Escanea recursivamente un directorio buscando archivos que superen minSizeBytes.
 * Límite estricto de profundidad y tiempo para evitar bloquear el event loop.
 */
export async function scanDirForLargeFiles(dirPath, minSizeBytes, maxDepth = 4, currentDepth = 0, results = []) {
  if (currentDepth > maxDepth || results.length >= 200) return results;

  try {
    const dir = await opendir(dirPath);
    for await (const dirent of dir) {
      const nameLower = dirent.name.toLowerCase();
      if (IGNORED_DIR_NAMES.has(nameLower) || nameLower.startsWith('.')) continue;

      const fullPath = join(dirPath, dirent.name);

      if (dirent.isDirectory()) {
        await scanDirForLargeFiles(fullPath, minSizeBytes, maxDepth, currentDepth + 1, results);
      } else if (dirent.isFile()) {
        try {
          const s = await stat(fullPath);
          if (s.size >= minSizeBytes) {
            results.push({
              path: fullPath,
              name: dirent.name,
              sizeBytes: s.size,
              sizeMB: Math.round((s.size / (1024 * 1024)) * 10) / 10,
              sizeFormatted: formatBytes(s.size),
              category: classifyFile(dirent.name),
              mtime: s.mtime.toISOString().slice(0, 10),
            });
          }
        } catch {
          // Archivo inaccesible o bloqueado
        }
      }
    }
  } catch {
    // Directorio no accesible
  }

  return results;
}

/**
 * Obtiene las rutas estándar de usuario para escanear.
 */
export function getUserScanRoots() {
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
  const roots = [
    join(userProfile, 'Downloads'),
    join(userProfile, 'Videos'),
    join(userProfile, 'Documents'),
    join(userProfile, 'Desktop'),
    process.env.TEMP || join(userProfile, 'AppData', 'Local', 'Temp'),
  ];
  return roots.filter(Boolean);
}

/**
 * Busca archivos grandes en todas las carpetas de usuario.
 */
export async function findLargeFiles(minSizeMB = 250) {
  const minSizeBytes = Number(minSizeMB) * 1024 * 1024;
  const roots = getUserScanRoots();
  const allFiles = [];

  for (const root of roots) {
    if (allFiles.length >= 200) break;
    await scanDirForLargeFiles(root, minSizeBytes, 4, 0, allFiles);
  }

  // Ordenar de mayor a menor tamaño
  allFiles.sort((a, b) => b.sizeBytes - a.sizeBytes);

  const totalBytes = allFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  return {
    minSizeMB,
    fileCount: allFiles.length,
    totalBytes,
    totalFormatted: formatBytes(totalBytes),
    files: allFiles,
  };
}

/**
 * Revela un archivo en el Explorador de Windows sin ejecutarlo.
 */
export async function revealInExplorer(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Ruta de archivo inválida');
  }
  const cleanPath = filePath.trim();
  // Validar ruta local de Windows con letra de unidad absoluta y sin comodines ni rutas de red UNC
  if (!/^[A-Za-z]:\\[^"<>|?*]+$/.test(cleanPath) || cleanPath.startsWith('\\\\')) {
    throw new Error('Ruta inválida o no permitida');
  }
  if (!existsSync(cleanPath)) {
    throw new Error('El archivo no existe en el disco');
  }
  // explorer.exe /select,"<ruta>"
  return spawnCapture('explorer.exe', [`/select,${cleanPath}`], 5000);
}
