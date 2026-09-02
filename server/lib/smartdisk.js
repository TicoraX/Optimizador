import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, appendChange, errText,
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
];

export async function checkTrimStatus() {
  const r = await spawnCapture('fsutil', ['behavior', 'query', 'DisableDeleteNotify']);
  if (r.code !== 0) return { enabled: false, raw: r.stderr };
  // DisableDeleteNotify = 0 significa que TRIM está HABILITADO
  const enabled = r.stdout.includes('= 0') || r.stdout.includes('0 (Habilitado)') || r.stdout.includes('0 (Enabled)');
  return { enabled, raw: r.stdout.trim() };
}

export async function getPhysicalDisks() {
  // Consulta PowerShell ligera a Get-PhysicalDisk para obtener tipo de medio (SSD/HDD), salud y bus
  const psCmd = 'Get-PhysicalDisk | Select-Object DeviceId, FriendlyName, MediaType, HealthStatus, OperationalStatus, Size | ConvertTo-Json -Compress';
  const r = await spawnCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd]);
  if (r.code !== 0 || !r.stdout.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(r.stdout.trim());
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((d) => ({
      id: String(d.DeviceId ?? ''),
      name: String(d.FriendlyName ?? 'Unidad de Disco'),
      type: String(d.MediaType ?? 'Desconocido'),
      health: String(d.HealthStatus ?? 'Healthy'),
      status: String(d.OperationalStatus ?? 'OK'),
      sizeGB: d.Size ? (Number(d.Size) / (1024 ** 3)).toFixed(1) : 'Desconocido',
    }));
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
    ...disks.map((d) => `| ${d.id} | ${d.name} | ${d.type} | ${d.sizeGB} GB | ${d.health} | ${d.status} |`),
    '',
    '## Acciones Recomendadas',
    '',
    trim.enabled
      ? '- El comando TRIM se encuentra correctamente habilitado en Windows.'
      : '- Se recomienda habilitar DisableDeleteNotify para evitar degradación en unidades SSD.',
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

  writeLog(`Iniciando optimización de almacenamiento SSD (Modo: ${dryRun ? 'SIMULACIÓN (dryRun)' : 'REAL'})...`);
  if (onProgress) onProgress({ percent: 15, message: 'Preparando comando defrag TRIM...' });

  const result = await guard(
    'Ejecutar TRIM y Optimización en Unidades SSD (defrag.exe /O /C)',
    () => spawnCapture('defrag.exe', ['/O', '/C']),
    {
      target: 'All_SSD_Volumes',
      action: 'TRIM_OPTIMIZE',
    },
  );

  if (onProgress) onProgress({ percent: 100, message: 'Optimización TRIM finalizada' });
  writeLog('Optimización de unidades de disco completada exitosamente.');
  return { ok: true, dryRun, result };
}
