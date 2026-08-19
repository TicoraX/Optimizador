import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText, queryRegistryValue,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Gestor y Optimizador de Memoria Virtual (Pagefile)
//
// Administra directivas del Administrador de Memoria de Windows:
// DisablePagingExecutive (mantener kernel en RAM física),
// LargeSystemCache (prioridad a apps) y ClearPageFileAtShutdown.
// ═══════════════════════════════════════════════════════

export const PAGEFILE_SETTINGS = [
  {
    id: 'disablepagingexecutive',
    name: 'Mantener Kernel y Drivers en Memoria Física (DisablePagingExecutive)',
    desc: 'Evita que el núcleo y controladores del sistema se paginen al disco. Aumenta la capacidad de respuesta en sistemas con 16 GB o más de RAM.',
    key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management',
    value: 'DisablePagingExecutive',
    type: 'REG_DWORD',
    optimizedValue: '1',
    optimizedLabel: 'En RAM física (1)',
    defaultLabel: 'Paginado a disco (0)',
  },
  {
    id: 'largesystemcache',
    name: 'Prioridad de Memoria para Aplicaciones y Juegos (LargeSystemCache)',
    desc: 'Asigna el tamaño estándar de caché del sistema operativo para otorgar máxima prioridad de RAM a programas y videojuegos.',
    key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management',
    value: 'LargeSystemCache',
    type: 'REG_DWORD',
    optimizedValue: '0',
    optimizedLabel: 'Prioridad Aplicaciones (0)',
    defaultLabel: 'Prioridad Caché Sistema (1)',
  },
  {
    id: 'clearpagefile',
    name: 'Apagado Rápido sin Purgado de Memoria Virtual (ClearPageFileAtShutdown)',
    desc: 'Desactiva el sobrescrito exhaustivo del archivo de paginación durante el apagado, acelerando el cierre del sistema. Nota: en discos sin BitLocker, restos del archivo pueden ser accesibles mediante análisis forense físico.',
    key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management',
    value: 'ClearPageFileAtShutdown',
    type: 'REG_DWORD',
    optimizedValue: '0',
    optimizedLabel: 'Apagado Rápido (0)',
    defaultLabel: 'Sobrescrito activo (1)',
  },
];

export async function getExistingPagefiles() {
  const r = await spawnCapture('reg', [
    'query',
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management',
    '/v',
    'ExistingPageFiles',
  ], 3000);
  if (r.code !== 0) return [];
  const match = r.stdout.match(/ExistingPageFiles\s+REG_MULTI_SZ\s+(.+)/i);
  if (!match) return [];
  return match[1].split('\\0').map((s) => s.trim()).filter(Boolean);
}

export async function runPagefileScanNative(onOutput) {
  const paths = prepareReport('pagefile');
  const { today, reportPath } = paths;

  onOutput('Auditando directivas de memoria virtual y archivo de paginación (pagefile.sys)...');
  const items = [];
  let optimizedCount = 0;

  for (const s of PAGEFILE_SETTINGS) {
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

  const existingFiles = await getExistingPagefiles();

  const lines = [
    `# Reporte de Memoria Virtual y Archivo de Paginación - ${today}`, '',
    `## Resumen de Gestión de Memoria`, '',
    `- **Ajustes Optimizados**: ${optimizedCount} / ${PAGEFILE_SETTINGS.length}`,
    `- **Ajustes Pendientes**: ${PAGEFILE_SETTINGS.length - optimizedCount}`,
    `- **Archivos de Paginación Detectados**: ${existingFiles.length > 0 ? existingFiles.join(', ') : 'Gestionado por Windows'}`,
    '',
    `## Directivas de Memory Management`, '',
  ];

  lines.push('```');
  items.forEach((it) => {
    const icon = it.isOptimized ? '[OPTIMIZADO]' : '[PENDIENTE]';
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
    optimizedCount,
    pendingCount: PAGEFILE_SETTINGS.length - optimizedCount,
    total: PAGEFILE_SETTINGS.length,
    existingFiles,
  }, onOutput, items);
}

export async function runPagefileActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('pagefile', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('pagefile', { dryRun, writeLog });

  const chosenIds = String(envVars.SETTINGS || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (chosenIds.length === 0) {
    const err = new Error('No se seleccionó ninguna directiva de memoria virtual para optimizar.');
    err.statusCode = 400;
    throw err;
  }

  writeLog(`Iniciando optimización de memoria virtual (Modo: ${dryRun ? 'SIMULACIÓN' : 'APLICAR'})...`);

  for (let i = 0; i < chosenIds.length; i++) {
    const id = chosenIds[i];
    if (onProgress) onProgress(Math.round(((i + 1) / chosenIds.length) * 100));

    const s = PAGEFILE_SETTINGS.find((item) => item.id === id);
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
        valueType: s.type,
        previousValue: prevVal,
        newValue: s.optimizedValue,
      },
    );

    if (result.simulated) continue;
    if (result.ok) {
      writeLog(`- ${s.name}: Optimizado exitosamente.`);
    } else {
      writeLog(`- Error optimizando ${s.name}: ${errText(result)}`);
    }
  }

  writeLog('Optimización de memoria virtual finalizada.');
}
