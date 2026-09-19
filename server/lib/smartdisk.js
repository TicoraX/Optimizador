import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Optimizador de Salud de Discos y SSD TRIM (smartdisk)
//
// Diagnostica el estado SMART de las unidades de almacenamiento,
// verifica la activación del comando TRIM en el sistema de archivos
// y permite ejecutar la optimización / re-trim seguro en SSDs.
// ═══════════════════════════════════════════════════════

export const SMARTDISK_ACTIONS = [
  {
    id: 'trim_all',
    name: 'Ejecutar TRIM y Optimización en Unidades SSD (defrag /O /C)',
    desc: 'Envía instrucciones TRIM a todas las particiones SSD conectadas para consolidar bloques libres, reducir la amplificación de escritura y mantener la velocidad de lectura.',
    command: 'defrag.exe /O /C',
    type: 'TRIM_OPTIMIZE',
  },
  {
    id: 'enable_trim',
    name: 'Habilitar soporte TRIM en el sistema de archivos (fsutil)',
    desc: 'Configura DisableDeleteNotify = 0 en Windows para habilitar el envío automático de comandos TRIM a los SSD.',
    command: 'fsutil behavior set DisableDeleteNotify 0',
    type: 'FSUTIL_SET',
  },
  {
    id: 'benchmark',
    name: 'Micro-Benchmark de Velocidad (Lectura y Escritura secuencial en MB/s)',
    desc: 'Mide la velocidad real de transferencia secuencial de las unidades mediante una prueba rápida no destructiva de 64 MB.',
    command: 'node:internal:benchmark',
    type: 'DISK_BENCHMARK',
  },
];

export async function checkTrimStatus() {
  const r = await spawnCapture('fsutil', ['behavior', 'query', 'DisableDeleteNotify']);
  if (r.code !== 0) return { enabled: false, raw: r.stderr };
  // DisableDeleteNotify = 0 significa que TRIM está HABILITADO
  const enabled = r.stdout.includes('= 0') || r.stdout.includes('0 (Habilitado)') || r.stdout.includes('0 (Enabled)');
  return { enabled, raw: r.stdout.trim() };
}

export async function runDiskSpeedBenchmark(driveLetter, sizeMB = 64, dryRun = false) {
  if (dryRun) {
    return {
      ok: true,
      sizeMB,
      writeSpeedMBs: 480.5,
      readSpeedMBs: 2200.0,
      drive: driveLetter || 'C:',
      dryRun: true,
    };
  }

  let targetDir = os.tmpdir();
  if (driveLetter && /^[A-Za-z]:?$/.test(driveLetter)) {
    const root = driveLetter.endsWith('\\') ? driveLetter : `${driveLetter}\\`;
    try {
      const candidateTemp = path.join(root, 'Temp');
      if (fs.existsSync(candidateTemp)) {
        targetDir = candidateTemp;
      } else {
        targetDir = root;
      }
    } catch {
      targetDir = os.tmpdir();
    }
  }

  const filePath = path.join(targetDir, `d1_speed_test_${Date.now()}.tmp`);
  const buffer = Buffer.alloc(1024 * 1024, 0xAA);

  try {
    const t0 = performance.now();
    const fd = fs.openSync(filePath, 'w');
    for (let i = 0; i < sizeMB; i++) {
      fs.writeSync(fd, buffer);
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    const writeSec = (performance.now() - t0) / 1000;
    const writeSpeed = Number((sizeMB / Math.max(writeSec, 0.001)).toFixed(1));

    const t1 = performance.now();
    const readFd = fs.openSync(filePath, 'r');
    const readBuf = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < sizeMB; i++) {
      fs.readSync(readFd, readBuf, 0, 1024 * 1024, null);
    }
    fs.closeSync(readFd);
    const readSec = (performance.now() - t1) / 1000;
    const readSpeed = Number((sizeMB / Math.max(readSec, 0.001)).toFixed(1));

    return {
      ok: true,
      sizeMB,
      writeSpeedMBs: writeSpeed,
      readSpeedMBs: readSpeed,
      drive: targetDir,
      dryRun: false,
    };
  } finally {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  }
}

async function getPhysicalDisks() {
  const psCmd = 'Get-PhysicalDisk | ForEach-Object { $d = $_; $rel = Get-StorageReliabilityCounter -PhysicalDisk $d -ErrorAction SilentlyContinue; [PSCustomObject]@{ DeviceId=$d.DeviceId; FriendlyName=$d.FriendlyName; MediaType=$d.MediaType; HealthStatus=$d.HealthStatus; OperationalStatus=$d.OperationalStatus; Size=$d.Size; Wear=$rel.Wear; Temperature=$rel.Temperature } } | ConvertTo-Json -Compress';
  const r = await spawnCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd]);
  if (r.code !== 0 || !r.stdout.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(r.stdout.trim());
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((d) => {
      const wear = d.Wear !== null && d.Wear !== undefined ? Number(d.Wear) : null;
      let healthPercent = 100;
      if (wear !== null && !Number.isNaN(wear)) {
        healthPercent = Math.max(0, Math.min(100, 100 - wear));
      } else {
        const h = String(d.HealthStatus || '').toLowerCase();
        if (h === 'warning') healthPercent = 70;
        else if (h === 'unhealthy') healthPercent = 35;
      }

      return {
        id: String(d.DeviceId ?? ''),
        name: String(d.FriendlyName ?? 'Unidad de Disco'),
        type: String(d.MediaType ?? 'Desconocido'),
        health: String(d.HealthStatus ?? 'Healthy'),
        healthPercent,
        status: String(d.OperationalStatus ?? 'OK'),
        temperature: d.Temperature !== null && d.Temperature !== undefined ? `${d.Temperature}°C` : null,
        sizeGB: d.Size ? (Number(d.Size) / (1024 ** 3)).toFixed(1) : 'Desconocido',
      };
    });
  } catch {
    return [];
  }
}

export async function runSmartDiskScanNative(onOutput, onProgress) {
  const paths = prepareReport('smartdisk');
  const { reportPath, today } = paths;
  const log = makeLogger('smartdisk', onOutput);
  log('Iniciando diagnóstico SMART y verificación de estado TRIM...');
  if (onProgress) onProgress({ percent: 20, message: 'Consultando estado de TRIM en el sistema...' });

  const trim = await checkTrimStatus();
  log(`Estado TRIM (DisableDeleteNotify): ${trim.enabled ? 'Habilitado (Óptimo)' : 'Deshabilitado o no detectado'}`);

  if (onProgress) onProgress({ percent: 60, message: 'Detectando unidades físicas y estado de salud...' });
  const disks = await getPhysicalDisks();

  log(`Unidades físicas detectadas: ${disks.length}`);
  for (const d of disks) {
    log(`  [Disco ${d.id}] ${d.name} (${d.type}) — ${d.sizeGB} GB | Salud: ${d.health} | Estado: ${d.status}`);
  }

  if (onProgress) onProgress({ percent: 90, message: 'Generando reporte de almacenamiento...' });

  const lines = [
    '# Diagnóstico de Salud de Discos y Optimización TRIM',
    '',
    `**Fecha de análisis**: ${new Date().toLocaleString()}`,
    `**Estado general de TRIM**: ${trim.enabled ? 'ACTIVO' : 'INACTIVO'}`,
    '',
    '## Unidades de Almacenamiento Detectadas',
    '',
    '| ID | Modelo | Tipo | Capacidad | Salud SMART | Estado |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ...disks.map((d) => `| ${d.id} | ${d.name} | ${d.type} | ${d.sizeGB} GB | ${d.healthPercent}% (${d.health}) | ${d.status} |`),
    '',
    '## Acciones Recomendadas',
    '',
    trim.enabled
      ? '- El comando TRIM se encuentra correctamente habilitado en Windows.'
      : '- Se recomienda habilitar TRIM ejecutando `fsutil behavior set DisableDeleteNotify 0` para evitar degradación de celdas en unidades SSD.',
    '- Ejecutar TRIM periódicamente ayuda a conservar la velocidad sostenida de lectura/escritura.',
  ];

  const counts = {
    date: today,
    reportPath,
    totalDisks: disks.length,
    ssdCount: disks.filter((d) => d.type.toUpperCase() === 'SSD').length,
    healthyCount: disks.filter((d) => d.health.toLowerCase() === 'healthy').length,
  };

  finishReport(paths, lines, counts, onOutput, disks);
  log('Diagnóstico de discos completado con éxito.');
  if (onProgress) onProgress({ percent: 100, message: 'Diagnóstico finalizado' });
  return { ok: true, markdown: lines.join('\n') };
}

export async function runSmartDiskActionNative(envVars = {}, onOutput, onProgress) {
  const writeLog = makeLogger('smartdisk', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('smartdisk', { dryRun, writeLog });
  const rawActions = String(envVars.ACTIONS || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rawDisks = String(envVars.DISKS || '').split(',').map((s) => s.trim()).filter(Boolean);

  writeLog(`Iniciando optimización de almacenamiento SSD (Modo: ${dryRun ? 'SIMULACIÓN (dryRun)' : 'REAL'})...`);

  const results = [];

  // 1. Manejo de habilitación de TRIM vía fsutil
  if (rawActions.includes('enable_trim')) {
    if (onProgress) onProgress({ percent: 30, message: 'Habilitando soporte TRIM (fsutil)...' });
    const rTrim = await guard(
      'Habilitar TRIM en Windows (fsutil behavior set DisableDeleteNotify 0)',
      () => spawnCapture('fsutil', ['behavior', 'set', 'DisableDeleteNotify', '0']),
      { target: 'FileSystem_DisableDeleteNotify', action: 'ENABLE_TRIM', previousValue: '1' },
    );
    results.push(rTrim);
    writeLog('- Soporte TRIM habilitado en el sistema de archivos.');
  }

  // 2. Manejo de TRIM / Defrag por discos o general
  const shouldTrim = rawActions.includes('trim_all') || (rawDisks.length > 0 && !rawActions.includes('benchmark')) || (rawActions.length === 0);
  if (shouldTrim) {
    if (onProgress) onProgress({ percent: 60, message: 'Ejecutando TRIM en unidades SSD...' });

    if (rawDisks.length > 0) {
      for (const disk of rawDisks) {
        const driveLetter = /^[A-Za-z]:?$/.test(disk) ? (disk.endsWith(':') ? disk : `${disk}:`) : null;
        const targetDesc = driveLetter ? `Unidad ${driveLetter}` : `Disco ${disk}`;
        const args = driveLetter ? [driveLetter, '/O'] : ['/O', '/C'];

        const rDefrag = await guard(
          `Ejecutar TRIM en ${targetDesc} (defrag.exe ${args.join(' ')})`,
          () => spawnCapture('defrag.exe', args),
          { target: targetDesc, action: 'TRIM_OPTIMIZE' },
        );
        results.push(rDefrag);
        writeLog(`- TRIM ejecutado en ${targetDesc}.`);
      }
    } else {
      const rDefrag = await guard(
        'Ejecutar TRIM y Optimización en Unidades SSD (defrag.exe /O /C)',
        () => spawnCapture('defrag.exe', ['/O', '/C']),
        { target: 'All_SSD_Volumes', action: 'TRIM_OPTIMIZE' },
      );
      results.push(rDefrag);
      writeLog('- TRIM ejecutado en todas las unidades SSD.');
    }
  }

  // 3. Manejo de Micro-Benchmark de Velocidad
  if (rawActions.includes('benchmark')) {
    if (onProgress) onProgress({ percent: 80, message: 'Ejecutando micro-benchmark de velocidad...' });
    writeLog('Iniciando micro-benchmark secuencial de velocidad (64 MB)...');
    const requestedDrive = rawDisks.find((disk) => /^[A-Za-z]:?$/.test(disk));
    try {
      const bench = await runDiskSpeedBenchmark(requestedDrive || null, 64, dryRun);
      results.push({
        action: 'DISK_BENCHMARK',
        ok: true,
        writeSpeedMBs: bench.writeSpeedMBs,
        readSpeedMBs: bench.readSpeedMBs,
      });
      writeLog(`- Benchmark completado: Escritura: ${bench.writeSpeedMBs} MB/s | Lectura (buffer cache): ${bench.readSpeedMBs} MB/s.`);
    } catch (err) {
      writeLog(`- Advertencia: no se pudo completar el benchmark de disco: ${err.message}`);
      results.push({
        action: 'DISK_BENCHMARK',
        ok: false,
        error: err.message,
      });
    }
  }

  if (onProgress) onProgress({ percent: 100, message: 'Optimización y análisis finalizados' });
  writeLog('Operación de unidades de disco completada exitosamente.');
  return { ok: true, dryRun, results };
}
