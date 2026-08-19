import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Optimizador de Informes de Errores y WerFault
//
// Administra directivas de Windows Error Reporting (WER):
// previene congelamientos por recolección de minidumps,
// subida de volcados de memoria a servidores de telemetría
// y cuadros de diálogo bloqueantes ante fallos de procesos.
// ═══════════════════════════════════════════════════════

export const WERFAULT_SETTINGS = [
  {
    id: 'disabled',
    name: 'Desactivar Reporte Automático de Errores a Microsoft (WER)',
    desc: 'Evita que Windows congele la ejecución para enviar informes de diagnóstico y volcados de memoria por internet ante fallos de aplicaciones.',
    key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting',
    value: 'Disabled',
    type: 'REG_DWORD',
    optimizedValue: '1',
    optimizedLabel: 'Desactivado (1)',
    defaultLabel: 'Envío activo (0 o ausente)',
  },
  {
    id: 'dontshowui',
    name: 'Suprimir Cuadros de Diálogo Bloqueantes por Fallo (DontShowUI)',
    desc: 'Cierra silenciosamente los procesos colgados sin bloquear la pantalla con ventanas emergentes de "Buscando solución al problema...".',
    key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting',
    value: 'DontShowUI',
    type: 'REG_DWORD',
    optimizedValue: '1',
    optimizedLabel: 'Sin interfaz emergente (1)',
    defaultLabel: 'Diálogos activos (0)',
  },
  {
    id: 'dontsenddata',
    name: 'Bloquear Envío de Datos Adicionales y Minidumps (DontSendAdditionalData)',
    desc: 'Protege la privacidad impidiendo la transmisión de archivos temporales, registros de memoria y fragmentos de código del usuario.',
    key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting',
    value: 'DontSendAdditionalData',
    type: 'REG_DWORD',
    optimizedValue: '1',
    optimizedLabel: 'Datos protegidos (1)',
    defaultLabel: 'Envío permitido (0)',
  },
  {
    id: 'loggingdisabled',
    name: 'Desactivar Escritura Continua de Registros WER en Disco (LoggingDisabled)',
    desc: 'Reduce el desgaste de I/O en SSD al evitar que WerFault registre eventos masivos en el visor de sucesos.',
    key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting',
    value: 'LoggingDisabled',
    type: 'REG_DWORD',
    optimizedValue: '1',
    optimizedLabel: 'Registro silenciado (1)',
    defaultLabel: 'Registro continuo (0)',
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

export async function runWerFaultScanNative(onOutput) {
  const paths = prepareReport('werfault');
  const { today, reportPath } = paths;

  onOutput('Auditando directivas de Windows Error Reporting (WerFault.exe)...');
  const items = [];
  let optimizedCount = 0;

  for (const s of WERFAULT_SETTINGS) {
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
    `# Reporte de Windows Error Reporting y WerFault - ${today}`, '',
    `## Resumen de Diagnósticos de Fallo`, '',
    `- **Ajustes Optimizados**: ${optimizedCount} / ${WERFAULT_SETTINGS.length}`,
    `- **Ajustes Pendientes**: ${WERFAULT_SETTINGS.length - optimizedCount}`,
    '',
    `## Directivas de Diagnóstico y Telemetría de Fallos`, '',
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
    pendingCount: WERFAULT_SETTINGS.length - optimizedCount,
    total: WERFAULT_SETTINGS.length,
  }, onOutput, items);
}

export async function runWerFaultActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('werfault', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('werfault', { dryRun, writeLog });

  const chosenIds = String(envVars.SETTINGS || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (chosenIds.length === 0) {
    const err = new Error('No se seleccionó ninguna directiva de reporte de errores para optimizar.');
    err.statusCode = 400;
    throw err;
  }

  writeLog(`Iniciando optimización de Windows Error Reporting (Modo: ${dryRun ? 'SIMULACIÓN' : 'APLICAR'})...`);

  for (let i = 0; i < chosenIds.length; i++) {
    const id = chosenIds[i];
    if (onProgress) onProgress(Math.round(((i + 1) / chosenIds.length) * 100));

    const s = WERFAULT_SETTINGS.find((item) => item.id === id);
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
      writeLog(`- ${s.name}: Optimizado exitosamente.`);
    } else {
      writeLog(`- Error optimizando ${s.name}: ${errText(result)}`);
    }
  }

  writeLog('Optimización de Windows Error Reporting finalizada.');
}
