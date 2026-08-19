import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Optimizador del Indexador y Búsqueda de Windows (WSearch)
//
// Audita la base de datos del indexador de Windows y
// aplica políticas de I/O y CPU para prevenir picos
// de uso de disco y proteger archivos confidenciales.
// ═══════════════════════════════════════════════════════

export const SEARCH_SETTINGS = [
  {
    id: 'preventlowdisk',
    name: 'Proteger Espacio en Disco (Margen de 5GB)',
    desc: 'Detiene automáticamente la indexación si el disco principal tiene menos de 5GB libres.',
    key: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search',
    value: 'PreventIndexingLowDiskSpaceMB',
    type: 'REG_DWORD',
    optimizedValue: '5000',
    optimizedLabel: 'Activo (5000 MB)',
    defaultLabel: 'Sin límite configurado',
  },
  {
    id: 'disableencrypted',
    name: 'Desactivar Indexación de Archivos Encriptados',
    desc: 'Evita almacenar volcados de archivos cifrados o certificados en la base de búsqueda de Windows.',
    key: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search',
    value: 'AllowIndexingEncryptedStoresOrItems',
    type: 'REG_DWORD',
    optimizedValue: '0',
    optimizedLabel: 'Desactivado (0)',
    defaultLabel: 'Permitido (1) o por defecto',
  },
  {
    id: 'preventremotefiles',
    name: 'Bloquear Indexación de Archivos de Red No Cacheados',
    desc: 'Previene retrasos y cuelgues del explorador al intentar indexar carpetas compartidas remotas.',
    key: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search',
    value: 'PreventIndexingUncachedRemoteFiles',
    type: 'REG_DWORD',
    optimizedValue: '1',
    optimizedLabel: 'Bloqueado (1)',
    defaultLabel: 'Permitido o no configurado',
  },
  {
    id: 'allowcortana',
    name: 'Restringir Búsqueda Web de Bing en Menú Inicio',
    desc: 'Elimina los resultados web lentos e invasivos al buscar archivos locales en el menú de Windows.',
    key: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search',
    value: 'DisableWebSearch',
    type: 'REG_DWORD',
    optimizedValue: '1',
    optimizedLabel: 'Búsqueda web desactivada (1)',
    defaultLabel: 'Búsqueda web activa (0)',
  },
];

export async function queryRegistryValue(key, value) {
  const r = await spawnCapture('reg', ['query', key, '/v', value], 3000);
  if (r.code !== 0) return null;
  const match = r.stdout.match(new RegExp(`${value}\\s+(REG_\\w+)\\s+(\\S+)`, 'i'));
  if (!match) return null;
  let val = match[2];
  if (val.startsWith('0x')) {
    val = String(parseInt(val, 16));
  }
  return val;
}

export async function getWSearchServiceStatus() {
  const r = await spawnCapture('sc', ['query', 'WSearch'], 3000);
  if (r.code !== 0) return { exists: false, state: 'No encontrado' };
  const isRunning = r.stdout.includes('RUNNING');
  const isStopped = r.stdout.includes('STOPPED');
  return {
    exists: true,
    state: isRunning ? 'En ejecución' : isStopped ? 'Detenido' : 'Desconocido',
    isRunning,
  };
}

export async function runSearchIndexScanNative(onOutput) {
  const paths = prepareReport('searchindex');
  const { today, reportPath } = paths;

  onOutput('Consultando estado del servicio Windows Search (WSearch)...');
  const svc = await getWSearchServiceStatus();

  onOutput('Auditando directivas de indexación en el registro de Windows...');
  const items = [];
  let optimizedCount = 0;

  for (const s of SEARCH_SETTINGS) {
    const cur = await queryRegistryValue(s.key, s.value);
    const isOpt = cur === s.optimizedValue;
    if (isOpt) optimizedCount++;

    items.push({
      id: s.id,
      name: s.name,
      desc: s.desc,
      key: s.key,
      value: s.value,
      type: s.type,
      currentValue: cur ?? 'No configurado',
      currentLabel: isOpt ? s.optimizedLabel : (cur ? `Valor actual: ${cur}` : s.defaultLabel),
      recommendedValue: s.optimizedValue,
      isOptimized: isOpt,
    });
  }

  const lines = [
    `# Reporte de Indexación y Búsqueda de Windows - ${today}`, '',
    `## Estado del Servicio WSearch`, '',
    `- **Servicio**: ${svc.exists ? 'Windows Search' : 'No instalado'}`,
    `- **Estado Actual**: ${svc.state}`,
    '',
    `## Directivas de Optimización de Búsqueda`, '',
    `- **Ajustes Optimizados**: ${optimizedCount} / ${SEARCH_SETTINGS.length}`,
    `- **Ajustes Pendientes**: ${SEARCH_SETTINGS.length - optimizedCount}`,
    '',
    `## Detalle de Configuraciones`, '',
  ];

  lines.push('```');
  items.forEach((it) => {
    const icon = it.isOptimized ? '[OK]' : '[PENDIENTE]';
    lines.push(`${icon} ${it.name}`);
    lines.push(`     Estado: ${it.currentLabel}`);
    lines.push(`     Ruta: ${it.key}\\${it.value}`);
    lines.push('');
  });
  lines.push('```');
  lines.push('');

  finishReport(paths, lines, {
    date: today,
    reportPath,
    serviceState: svc.state,
    optimizedCount,
    pendingCount: SEARCH_SETTINGS.length - optimizedCount,
    total: SEARCH_SETTINGS.length,
  }, onOutput, items);
}

export async function runSearchIndexActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('searchindex', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('searchindex', { dryRun, writeLog });

  const chosenIds = String(envVars.SETTINGS || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (chosenIds.length === 0) {
    const err = new Error('No se seleccionó ningún ajuste de indexación para optimizar.');
    err.statusCode = 400;
    throw err;
  }

  writeLog(`Iniciando optimización de directivas de Windows Search (Modo: ${dryRun ? 'SIMULACIÓN' : 'APLICAR'})...`);

  for (let i = 0; i < chosenIds.length; i++) {
    const id = chosenIds[i];
    if (onProgress) onProgress(Math.round(((i + 1) / chosenIds.length) * 100));

    const s = SEARCH_SETTINGS.find((item) => item.id === id);
    if (!s) {
      writeLog(`- Omitiendo ajuste desconocido: ${id}`);
      continue;
    }

    const prevVal = await queryRegistryValue(s.key, s.value);

    const result = await guard(
      `Optimizar ${s.name} (${s.value}=${s.optimizedValue})`,
      () => spawnCapture('reg', ['add', s.key, '/v', s.value, '/t', s.type, '/d', s.optimizedValue, '/f']),
      {
        target: `${s.key}\\${s.value}`,
        previousValue: prevVal,
        newValue: s.optimizedValue,
      },
    );

    if (result.simulated) continue;
    if (result.ok) {
      writeLog(`- ${s.name}: Aplicado exitosamente.`);
    } else {
      writeLog(`- Error aplicando ${s.name}: ${errText(result)}`);
    }
  }

  writeLog('Optimización de Windows Search finalizada.');
}
