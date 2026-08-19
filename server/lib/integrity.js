import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText, WINDIR,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Auditor de Integridad de Componentes Windows (DISM & SFC)
//
// Verifica la salud del almacén de componentes (WinSxS)
// y los archivos protegidos del sistema operativo,
// permitiendo recuperar espacio y corregir inconsistencias.
// ═══════════════════════════════════════════════════════

export function parseDismHealth(stdout) {
  if (!stdout || typeof stdout !== 'string') return 'DESCONOCIDO';
  const text = stdout.toLowerCase();

  if (text.includes('no component store corruption detected') || text.includes('no se detectaron daños en el almacén de componentes')) {
    return 'SALUDABLE';
  }
  if (text.includes('component store is repairable') || text.includes('el almacén de componentes se puede reparar')) {
    return 'REPARABLE';
  }
  if (text.includes('corruption') || text.includes('daños')) {
    return 'CORRUPTO';
  }
  return 'DESCONOCIDO';
}

export function parseSfcVerify(stdout) {
  if (!stdout || typeof stdout !== 'string') return 'DESCONOCIDO';
  const text = stdout.toLowerCase();

  if (text.includes('did not find any integrity violations') || text.includes('no encontró ninguna infracción de integridad')) {
    return 'INTEGRO';
  }
  if (text.includes('found corrupt files') || text.includes('encontró archivos dañados')) {
    return 'ARCHIVOS_CORRUPTOS';
  }
  return 'DESCONOCIDO';
}

export async function runIntegrityScanNative(onOutput) {
  const paths = prepareReport('integrity');
  const { today, reportPath } = paths;

  onOutput('Iniciando auditoría rápida de integridad de Windows (DISM /CheckHealth)...');
  const dismCheck = await spawnCapture('dism', ['/Online', '/Cleanup-Image', '/CheckHealth'], 30000);
  const dismStatus = parseDismHealth(dismCheck.stdout);
  onOutput(`- Estado del Almacén de Componentes (DISM): ${dismStatus}`);

  onOutput('Verificando archivos de sistema protegidos (SFC /verifyonly)...');
  const sfcCheck = await spawnCapture('sfc', ['/verifyonly'], 45000);
  const sfcStatus = parseSfcVerify(sfcCheck.stdout);
  onOutput(`- Estado de Archivos de Sistema (SFC): ${sfcStatus}`);

  const lines = [
    `# Reporte de Integridad de Componentes y Almacén WinSxS - ${today}`, '',
    `## Diagnóstico de Salud del Sistema`, '',
    `- **Almacén de Componentes (DISM)**: ${dismStatus}`,
    `- **Archivos Protegidos de Windows (SFC)**: ${sfcStatus}`,
    '',
    `## Acciones Recomendadas`, '',
  ];

  if (dismStatus === 'REPARABLE' || dismStatus === 'CORRUPTO') {
    lines.push('- [REQUERIDO] Ejecutar reparación de imagen con DISM /RestoreHealth.');
  } else {
    lines.push('- Almacén de componentes en estado saludable.');
  }

  if (sfcStatus === 'ARCHIVOS_CORRUPTOS') {
    lines.push('- [REQUERIDO] Ejecutar SFC /scannow para reparar archivos dañados.');
  } else {
    lines.push('- Archivos protegidos del sistema íntegros.');
  }

  lines.push('- [OPCIONAL] Limpiar componentes obsoletos de WinSxS (StartComponentCleanup) para recuperar espacio.');
  lines.push('');

  const items = [
    {
      id: 'winsxs_cleanup',
      name: 'Limpieza de Componentes Antiguos de WinSxS',
      desc: 'Elimina versiones obsoletas de actualizaciones previas de Windows para liberar varios gigabytes.',
      action: 'StartComponentCleanup',
      recommended: true,
    },
    {
      id: 'dism_restore',
      name: 'Reparación de Imagen de Componentes (DISM /RestoreHealth)',
      desc: 'Descarga y restaura archivos base corruptos de Windows desde Windows Update.',
      action: 'RestoreHealth',
      recommended: dismStatus !== 'SALUDABLE',
    },
    {
      id: 'sfc_repair',
      name: 'Reparación de Archivos Protegidos (SFC /scannow)',
      desc: 'Verifica y repara automáticamente archivos de sistema dañados utilizando la copia local segura.',
      action: 'SfcScannow',
      recommended: sfcStatus !== 'INTEGRO',
    },
  ];

  finishReport(paths, lines, {
    date: today,
    reportPath,
    dismStatus,
    sfcStatus,
    healthy: dismStatus === 'SALUDABLE' && sfcStatus === 'INTEGRO',
  }, onOutput, items);
}

export async function runIntegrityActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('integrity', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('integrity', { dryRun, writeLog });

  const chosenActions = String(envVars.ACTIONS || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (chosenActions.length === 0) {
    const err = new Error('No se seleccionó ninguna acción de integridad para ejecutar.');
    err.statusCode = 400;
    throw err;
  }

  writeLog(`Iniciando tareas de integridad y mantenimiento de componentes (Modo: ${dryRun ? 'SIMULACIÓN' : 'APLICAR'})...`);

  for (let i = 0; i < chosenActions.length; i++) {
    const act = chosenActions[i];
    if (onProgress) onProgress(Math.round(((i + 1) / chosenActions.length) * 100));

    if (act === 'winsxs_cleanup' || act === 'StartComponentCleanup') {
      writeLog('Ejecutando limpieza de componentes WinSxS (DISM /StartComponentCleanup)...');
      const r = await guard(
        'Limpieza de componentes obsoletos WinSxS',
        () => spawnCapture('dism', ['/Online', '/Cleanup-Image', '/StartComponentCleanup'], 900000),
        { target: 'WinSxS\\ComponentCleanup', irreversible: true },
      );
      if (r.simulated) continue;
      if (r.ok) {
        writeLog('✓ Limpieza de WinSxS completada con éxito.');
      } else {
        writeLog(`Error en limpieza WinSxS: ${errText(r)}`);
      }
    } else if (act === 'dism_restore' || act === 'RestoreHealth') {
      writeLog('Ejecutando restauración de imagen de Windows (DISM /RestoreHealth)...');
      const r = await guard(
        'Restauración de imagen de Windows',
        () => spawnCapture('dism', ['/Online', '/Cleanup-Image', '/RestoreHealth'], 900000),
        { target: 'DISM\\RestoreHealth', irreversible: true },
      );
      if (r.simulated) continue;
      if (r.ok) {
        writeLog('✓ Imagen de Windows reparada con éxito.');
      } else {
        writeLog(`Error en restauración DISM: ${errText(r)}`);
      }
    } else if (act === 'sfc_repair' || act === 'SfcScannow') {
      writeLog('Ejecutando reparación de archivos del sistema (SFC /scannow)...');
      const r = await guard(
        'Reparación SFC de archivos de sistema',
        () => spawnCapture('sfc', ['/scannow'], 900000),
        { target: 'SFC\\Scannow', irreversible: true },
      );
      if (r.simulated) continue;
      if (r.ok) {
        writeLog('✓ SFC /scannow completado con éxito.');
      } else {
        writeLog(`Error en SFC: ${errText(r)}`);
      }
    }
  }

  writeLog('Mantenimiento de integridad finalizado.');
}
