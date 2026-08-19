import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Auditor y Limpiador de Dispositivos Fantasma Huérfanos
//
// Identifica y limpia dispositivos desconectados (PnP)
// que permanecen en el registro de Windows ralentizando la
// enumeración de hardware (USB antiguos, discos, periféricos).
// ═══════════════════════════════════════════════════════

const PROTECTED_CLASSES = new Set([
  'system',
  'processor',
  'computer',
  'volume',
  'volumesnapshot',
  'firmware',
  'biometric',
  'securitydevices',
]);

export function isSafeGhostDevice(instanceId = '', className = '') {
  const c = (className || '').toLowerCase().trim();
  const id = (instanceId || '').toUpperCase().trim();

  if (PROTECTED_CLASSES.has(c)) return false;
  if (id.startsWith('ROOT\\') || id.startsWith('ACPI\\') || id.startsWith('SWD\\')) return false;

  return true;
}

export function parsePnpUtilDisconnected(stdout) {
  if (!stdout || typeof stdout !== 'string') return [];
  const devices = [];
  const blocks = stdout.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    let instanceId = '';
    let name = '';
    let className = '';
    let status = '';

    for (const l of lines) {
      const parts = l.split(':');
      if (parts.length < 2) continue;
      const key = parts[0].trim().toLowerCase().replace(/[^a-z]/g, '');
      const val = parts.slice(1).join(':').trim();

      if (key.includes('instancia') || key.includes('instanceid')) {
        instanceId = val;
      } else if (key.includes('descripci') || key.includes('description')) {
        name = val;
      } else if (key.includes('clase') || key.includes('classname')) {
        className = val;
      } else if (key.includes('estado') || key.includes('status')) {
        status = val;
      }
    }

    if (instanceId) {
      const isSafe = isSafeGhostDevice(instanceId, className);
      devices.push({
        id: instanceId,
        name: name || instanceId,
        className: className || 'Desconocido',
        status: status || 'Desconectado',
        isSafe,
        recommended: isSafe,
      });
    }
  }

  return devices;
}

export async function runGhostDevicesScanNative(onOutput) {
  const paths = prepareReport('ghostdevices');
  const { today, reportPath } = paths;

  onOutput('Consultando dispositivos desconectados y registros PnP huérfanos con pnputil...');
  const r = await spawnCapture('pnputil', ['/enum-devices', '/disconnected'], 10000);

  const allDevices = r.code === 0 ? parsePnpUtilDisconnected(r.stdout) : [];
  const safeDevices = allDevices.filter((d) => d.isSafe);

  const lines = [
    `# Reporte de Dispositivos Fantasma Huérfanos - ${today}`, '',
    `## Resumen de Diagnóstico`, '',
    `- **Dispositivos Desconectados Totales**: ${allDevices.length}`,
    `- **Periféricos y USB Seguros de Limpiar**: ${safeDevices.length}`,
    '',
    `## Lista de Dispositivos Desconectados Seguros`, '',
  ];

  lines.push('```');
  if (safeDevices.length === 0) {
    lines.push('[LIMPIO] No se encontraron dispositivos huérfanos acumulados.');
  } else {
    safeDevices.forEach((d, idx) => {
      lines.push(`[${idx + 1}] [${d.className}] ${d.name} (${d.id})`);
    });
  }
  lines.push('```');
  lines.push('');

  finishReport(paths, lines, {
    date: today,
    reportPath,
    totalCount: allDevices.length,
    safeCount: safeDevices.length,
  }, onOutput, safeDevices);
}

export async function runGhostDevicesActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('ghostdevices', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('ghostdevices', { dryRun, writeLog });

  const rawDevices = String(envVars.DEVICES || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (rawDevices.length === 0) {
    const err = new Error('No se seleccionó ningún dispositivo para remover.');
    err.statusCode = 400;
    throw err;
  }

  writeLog(`Iniciando purga de dispositivos fantasma huérfanos (Modo: ${dryRun ? 'SIMULACIÓN' : 'APLICAR'})...`);

  for (let i = 0; i < rawDevices.length; i++) {
    const devId = rawDevices[i];
    if (onProgress) onProgress(Math.round(((i + 1) / rawDevices.length) * 100));

    if (!isSafeGhostDevice(devId)) {
      writeLog(`- Omitiendo ${devId}: Dispositivo de infraestructura del sistema protegido.`);
      continue;
    }

    const result = await guard(
      `Remover dispositivo desconectado huérfano: ${devId}`,
      () => spawnCapture('pnputil', ['/remove-device', devId]),
      {
        target: `PnP\\${devId}`,
        irreversible: true,
      },
    );

    if (result.simulated) continue;
    if (result.ok) {
      writeLog(`- ${devId}: Removido exitosamente del registro.`);
    } else {
      writeLog(`- Error removiendo ${devId}: ${errText(result)}`);
    }
  }

  writeLog('Purga de dispositivos fantasma finalizada.');
}
