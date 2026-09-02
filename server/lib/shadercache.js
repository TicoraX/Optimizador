import fs from 'node:fs/promises';
import path from 'node:path';
import {
  makeLogger, makeGuard, prepareReport, finishReport, appendChange,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Limpiador y Optimizador de Caché de Shaders GPU (shadercache)
//
// Detecta y purga de forma segura las cachés de compilación
// de sombreadores de DirectX, NVIDIA, AMD e Intel para
// recuperar espacio en disco y mitigar micro-stuttering.
// ═══════════════════════════════════════════════════════

export function getShaderTargets() {
  const localApp = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';

  return [
    {
      id: 'directx',
      vendor: 'DirectX',
      name: 'Caché D3D de DirectX',
      path: path.join(localApp, 'D3DSCache'),
      desc: 'Caché central de sombreadores compilados de la API Microsoft Direct3D.',
    },
    {
      id: 'nvidia_dxcache',
      vendor: 'NVIDIA',
      name: 'Caché DX de NVIDIA',
      path: path.join(localApp, 'NVIDIA', 'DXCache'),
      desc: 'Sombreadores DirectX precompilados por controladores GeForce/RTX.',
    },
    {
      id: 'nvidia_glcache',
      vendor: 'NVIDIA',
      name: 'Caché OpenGL de NVIDIA',
      path: path.join(localApp, 'NVIDIA', 'GLCache'),
      desc: 'Caché de sombreadores OpenGL y Vulkan de NVIDIA.',
    },
    {
      id: 'nvidia_computecache',
      vendor: 'NVIDIA',
      name: 'Caché Compute / CUDA de NVIDIA',
      path: path.join(appData, 'NVIDIA', 'ComputeCache'),
      desc: 'Caché de cómputo GPU y aprendizaje acelerado CUDA.',
    },
    {
      id: 'amd_dxccache',
      vendor: 'AMD',
      name: 'Caché Dxc de AMD Radeon',
      path: path.join(localApp, 'AMD', 'DxcCache'),
      desc: 'Sombreadores compilados por el controlador gráfico AMD Adrenalin.',
    },
    {
      id: 'amd_dxcache',
      vendor: 'AMD',
      name: 'Caché DX de AMD Radeon',
      path: path.join(localApp, 'AMD', 'DxCache'),
      desc: 'Archivos temporales de DirectX generados por GPUs Radeon.',
    },
    {
      id: 'intel_shadercache',
      vendor: 'Intel',
      name: 'Caché de Gráficos Intel Arc / Iris',
      path: path.join(localApp, 'Intel', 'ShaderCache'),
      desc: 'Sombreadores compilados por GPUs integradas y dedicadas Intel.',
    },
  ];
}

export async function inspectDirectory(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) return { exists: false, count: 0, bytes: 0 };
  } catch {
    return { exists: false, count: 0, bytes: 0 };
  }

  let count = 0;
  let bytes = 0;

  async function walk(current) {
    try {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          count++;
          try {
            const st = await fs.stat(full);
            bytes += st.size;
          } catch {}
        }
      }
    } catch {}
  }

  await walk(dirPath);
  return { exists: true, count, bytes };
}

export async function deleteDirectoryContents(dirPath, isDryRun, log) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    let deletedCount = 0;
    let deletedBytes = 0;

    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      try {
        let size = 0;
        let count = 1;

        if (entry.isDirectory()) {
          const subInfo = await inspectDirectory(full);
          size = subInfo.bytes;
          count = Math.max(1, subInfo.count);
        } else {
          const st = await fs.stat(full);
          size = st.size;
        }

        if (!isDryRun) {
          if (entry.isDirectory()) {
            await fs.rm(full, { recursive: true, force: true });
          } else {
            await fs.unlink(full);
          }
        }
        deletedCount += count;
        deletedBytes += size;
      } catch (err) {
        log(`  [Aviso] Archivo o directorio en uso o protegido: ${entry.name}`);
      }
    }
    return { deletedCount, deletedBytes };
  } catch {
    return { deletedCount: 0, deletedBytes: 0 };
  }
}

export async function runShaderCacheScanNative(onOutput, onProgress) {
  const paths = prepareReport('shadercache');
  const { reportPath, today } = paths;
  const log = makeLogger('shadercache', onOutput);
  log('Iniciando exploración de carpetas de caché de sombreadores GPU...');
  if (onProgress) onProgress({ percent: 15, message: 'Localizando directorios de sombreadores...' });

  const targets = getShaderTargets();
  const results = [];
  let totalBytes = 0;
  let totalFiles = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const percent = 20 + Math.round((i / targets.length) * 70);
    if (onProgress) onProgress({ percent, message: `Analizando ${t.name}...` });

    const info = await inspectDirectory(t.path);
    const sizeMB = (info.bytes / (1024 * 1024)).toFixed(2);
    totalBytes += info.bytes;
    totalFiles += info.count;

    results.push({
      ...t,
      exists: info.exists,
      files: info.count,
      bytes: info.bytes,
      sizeMB,
    });

    if (info.exists && info.count > 0) {
      log(`  Encontrado: ${t.name} (${info.count} archivos, ${sizeMB} MB)`);
    }
  }

  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  log(`Exploración completada. Espacio ocupado en shaders: ${totalMB} MB en ${totalFiles} archivos.`);

  const lines = [
    '# Diagnóstico de Caché de Shaders GPU',
    '',
    `**Fecha de análisis**: ${new Date().toLocaleString()}`,
    `**Espacio total recuperable**: ${totalMB} MB (${totalFiles} archivos)`,
    '',
    '## Detalle por Fabricante y API',
    '',
    '| Fabricante | Caché | Archivos | Tamaño (MB) | Ruta |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...results.map((r) => `| ${r.vendor} | ${r.name} | ${r.files} | ${r.sizeMB} MB | \`${r.path}\` |`),
    '',
    '## Información Técnica',
    '',
    '- La caché de shaders se regenera automáticamente y de forma limpia la próxima vez que ejecutes cada juego.',
    '- Purgar cachés viejas o corruptas ayuda a eliminar tirones (stuttering) tras actualizar drivers gráficos.',
  ];

  const counts = {
    date: today,
    reportPath,
    totalMB,
    totalFiles,
    locationsFound: results.filter((r) => r.exists && r.files > 0).length,
  };

  finishReport(paths, lines, counts, onOutput, results);
  if (onProgress) onProgress({ percent: 100, message: 'Escaneo de shaders finalizado' });
  return { ok: true, markdown: lines.join('\n') };
}

export async function runShaderCacheActionNative(envVars = {}, onOutput, onProgress) {
  const writeLog = makeLogger('shadercache', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('shadercache', { dryRun, writeLog });
  const targets = getShaderTargets();
  const selectedKeys = (envVars.CACHES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  writeLog(`Iniciando purga de caché de shaders GPU (Modo: ${dryRun ? 'SIMULACIÓN (dryRun)' : 'REAL'})...`);
  if (onProgress) onProgress({ percent: 10, message: 'Iniciando purga de archivos de caché...' });

  let purgedCount = 0;
  let purgedBytes = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (selectedKeys.length > 0 && !selectedKeys.includes(t.id.toLowerCase())) {
      continue;
    }

    const percent = 20 + Math.round((i / targets.length) * 70);
    if (onProgress) onProgress({ percent, message: `Procesando ${t.name}...` });

    const info = await inspectDirectory(t.path);
    if (!info.exists || info.count === 0) continue;

    writeLog(`Procesando: ${t.name} en ${t.path}`);
    const result = await guard(
      `Purgar ${t.name} (${t.path})`,
      () => deleteDirectoryContents(t.path, dryRun, writeLog),
      {
        target: t.name,
        path: t.path,
      },
    );

    if (result) {
      purgedCount += result.deletedCount || 0;
      purgedBytes += result.deletedBytes || 0;
    }
  }

  const purgedMB = (purgedBytes / (1024 * 1024)).toFixed(2);
  writeLog(`Purga de shaders finalizada: ${dryRun ? 'Se liberarían' : 'Se liberaron'} ${purgedMB} MB (${purgedCount} archivos).`);

  if (onProgress) onProgress({ percent: 100, message: 'Purga completada' });
  return { ok: true, purgedMB, purgedCount, dryRun };
}
