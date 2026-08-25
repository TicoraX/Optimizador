import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Optimizador de Temporizadores del Sistema y Latencia
//
// Audita y optimiza el comportamiento del reloj del sistema (BCD),
// Dynamic Ticking y sincronización de TSC para reducir el
// micro-stuttering en juegos y audio de baja latencia.
// ═══════════════════════════════════════════════════════

export const TIMER_SETTINGS = [
  {
    id: 'disabledynamictick',
    name: 'Desactivar Dynamic Ticking (disabledynamictick)',
    param: 'disabledynamictick',
    optimizedValue: 'Yes',
    desc: 'Mantiene una frecuencia de reloj constante en la CPU, eliminando micro-pausas en juegos y DAWs.',
    category: 'Reloj y Latencia',
  },
  {
    id: 'useplatformclock',
    name: 'Priorizar TSC sobre HPET (useplatformclock=No)',
    param: 'useplatformclock',
    optimizedValue: 'No',
    desc: 'Usa el contador de ciclos del procesador (TSC) en vez del temporizador del chipset (HPET), reduciendo la sobrecarga de interrupciones.',
    category: 'Reloj y Latencia',
  },
  {
    id: 'tscsyncpolicy',
    name: 'Sincronización Avanzada de TSC (tscsyncpolicy=Enhanced)',
    param: 'tscsyncpolicy',
    optimizedValue: 'Enhanced',
    desc: 'Garantiza sincronización estricta del temporizador entre todos los núcleos de la CPU.',
    category: 'Sincronización de Núcleos',
  },
];

export function parseBcdeditOutput(stdout) {
  if (!stdout || typeof stdout !== 'string') return {};
  const map = {};
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length >= 2) {
      const key = parts[0].trim().toLowerCase();
      const val = parts[1].trim();
      map[key] = val;
    }
  }
  return map;
}

export async function runTimersScanNative(onOutput) {
  const paths = prepareReport('timers');
  const { today, reportPath } = paths;

  onOutput('Consultando configuración del almacén de datos de arranque (BCD)...');
  const r = await spawnCapture('bcdedit', ['/enum', '{current}'], 5000);

  const bcdMap = r.code === 0 ? parseBcdeditOutput(r.stdout) : {};

  const items = TIMER_SETTINGS.map((setting) => {
    const currentVal = bcdMap[setting.param.toLowerCase()] || 'Default (No configurado)';
    const isOptimized = (bcdMap[setting.param.toLowerCase()] || '').toLowerCase() === setting.optimizedValue.toLowerCase();

    return {
      ...setting,
      currentValue: currentVal,
      isOptimized,
      recommended: !isOptimized,
    };
  });

  const optimizedCount = items.filter((i) => i.isOptimized).length;
  const pendingCount = items.length - optimizedCount;

  const lines = [
    `# Reporte de Temporizadores y Latencia del Sistema - ${today}`, '',
    `## Resumen de Diagnóstico`, '',
    `- **Ajustes de Reloj Optimizados**: ${optimizedCount} de ${items.length}`,
    `- **Pendientes por Optimizar**: ${pendingCount}`,
    '',
    `## Lista de Ajustes BCD`, '',
  ];

  lines.push('```');
  items.forEach((item, idx) => {
    const status = item.isOptimized ? '[OPTIMIZADO]' : '[PENDIENTE]';
    lines.push(`[${idx + 1}] ${status} ${item.name}`);
    lines.push(`    Valor actual: ${item.currentValue} | Recomendado: ${settingToDisplay(item)}`);
    lines.push(`    Descripción: ${item.desc}`);
  });
  lines.push('```');
  lines.push('');

  finishReport(paths, lines, {
    date: today,
    reportPath,
    total: items.length,
    optimizedCount,
    pendingCount,
  }, onOutput, items);
}

function settingToDisplay(item) {
  return `${item.param} = ${item.optimizedValue}`;
}

export async function runTimersActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('timers', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('timers', { dryRun, writeLog });

  const rawSettings = String(envVars.SETTINGS || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (rawSettings.length === 0) {
    const err = new Error('No se seleccionó ningún ajuste de temporizador para aplicar.');
    err.statusCode = 400;
    throw err;
  }

  writeLog(`Iniciando optimización de temporizadores BCD (Modo: ${dryRun ? 'SIMULACIÓN' : 'APLICAR'})...`);

  // Consultar valores previos
  const bcd = await spawnCapture('bcdedit', ['/enum', '{current}']);
  const bcdMap = bcd.code === 0 ? parseBcdeditOutput(bcd.stdout) : {};

  for (let i = 0; i < rawSettings.length; i++) {
    const settingId = rawSettings[i];
    const setting = TIMER_SETTINGS.find((s) => s.id === settingId);
    if (!setting) {
      writeLog(`- Omitiendo ajuste desconocido: ${settingId}`);
      continue;
    }

    if (onProgress) onProgress(Math.round(((i + 1) / rawSettings.length) * 100));

    const prevVal = bcdMap[setting.param.toLowerCase()] || null;

    if (prevVal && prevVal.toLowerCase() === setting.optimizedValue.toLowerCase()) {
      writeLog(`- ${setting.name}: Ya está optimizado (${setting.optimizedValue}).`);
      continue;
    }

    const result = await guard(
      `Ajustar temporizador BCD: ${setting.param} = ${setting.optimizedValue}`,
      () => spawnCapture('bcdedit', ['/set', setting.param, setting.optimizedValue], 5000),
      {
        target: `BCD\\{current}\\${setting.param}`,
        previousValue: prevVal,
        newValue: setting.optimizedValue,
      },
    );

    if (result.simulated) continue;
    if (result.ok) {
      writeLog(`- ${setting.name}: Configurado a ${setting.optimizedValue}.`);
    } else {
      writeLog(`- Error configurando ${setting.name}: ${errText(result)}`);
    }
  }

  writeLog('Nota: Los cambios en el almacén de arranque (BCD) surtirán efecto completo tras reiniciar el equipo.');
  writeLog('Optimización de temporizadores finalizada.');
}
