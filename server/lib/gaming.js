import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Optimizador de Rendimiento Gaming & GPU
//
// Audita y ajusta configuraciones de bajo nivel de Windows
// para reducir la latencia de entrada (input lag), mejorar
// el frame-pacing y priorizar la GPU/CPU en juegos.
// ═══════════════════════════════════════════════════════

export const GAMING_SETTINGS = [
  {
    id: 'hags',
    name: 'Hardware-Accelerated GPU Scheduling (HAGS)',
    desc: 'Permite a la GPU gestionar directamente su memoria de video, reduciendo la latencia de CPU.',
    key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
    value: 'HwSchMode',
    type: 'REG_DWORD',
    optimizedValue: '2',
    optimizedLabel: 'Activado (Modo 2)',
    defaultLabel: 'Desactivado o por defecto',
  },
  {
    id: 'gamemode',
    name: 'Modo de Juego de Windows (Game Mode)',
    desc: 'Prioriza hilos de procesamiento y previene que tareas secundarias interrumpan el juego activo.',
    key: 'HKCU\\Software\\Microsoft\\GameBar',
    value: 'AllowAutoGameMode',
    type: 'REG_DWORD',
    optimizedValue: '1',
    optimizedLabel: 'Activado (1)',
    defaultLabel: 'Desactivado (0)',
  },
  {
    id: 'gamedvr',
    name: 'Desactivar Game DVR en Segundo Plano',
    desc: 'Evita que Windows grabe video constantemente en segundo plano, eliminando micro-stuttering.',
    key: 'HKCU\\System\\GameConfigStore',
    value: 'GameDVR_Enabled',
    type: 'REG_DWORD',
    optimizedValue: '0',
    optimizedLabel: 'Desactivado (Sin sobrecarga)',
    defaultLabel: 'Activado (Grabando)',
  },
  {
    id: 'fse',
    name: 'Optimización de Pantalla Completa y Ventana',
    desc: 'Mejora el paso de frames en juegos ejecutados en modo ventana sin bordes.',
    key: 'HKCU\\System\\GameConfigStore',
    value: 'GameDVR_FSEBehaviorMode',
    type: 'REG_DWORD',
    optimizedValue: '2',
    optimizedLabel: 'Optimizado (2)',
    defaultLabel: 'Por defecto (0)',
  },
  {
    id: 'networkThrottle',
    name: 'Desactivar Network Throttling Multimedia',
    desc: 'Evita la limitación artificial del tráfico de red en Windows cuando hay juegos o audio activo.',
    key: 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile',
    value: 'NetworkThrottlingIndex',
    type: 'REG_DWORD',
    optimizedValue: '4294967295', // 0xFFFFFFFF
    optimizedLabel: 'Sin limitación (0xFFFFFFFF)',
    defaultLabel: 'Limitado (10/Default)',
  },
  {
    id: 'systemResponsiveness',
    name: 'Prioridad de Rendimiento (System Responsiveness)',
    desc: 'Asigna el 100% de la capacidad de procesamiento al juego en primer plano.',
    key: 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile',
    value: 'SystemResponsiveness',
    type: 'REG_DWORD',
    optimizedValue: '0',
    optimizedLabel: '100% para juegos (0)',
    defaultLabel: '20% reservado (20)',
  },
];

export function parseRegDword(stdout) {
  if (!stdout || typeof stdout !== 'string') return null;
  const m = stdout.match(/0x([\da-fA-F]+)/);
  return m ? String(parseInt(m[1], 16)) : null;
}

export function isOptimized(setting, currentValue) {
  if (currentValue === null) return false;
  return currentValue === setting.optimizedValue;
}

/**
 * Detecta la tarjeta gráfica activa mediante wmic.
 */
export async function detectActiveGPU() {
  try {
    const { stdout, code } = await spawnCapture('wmic', [
      'path', 'win32_VideoController', 'get', 'Name,DriverVersion', '/format:csv',
    ], 3000);

    if (code === 0 && stdout) {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      for (const line of lines.slice(1)) {
        const parts = line.split(',').map((s) => s.trim());
        if (parts.length >= 3 && parts[1] && parts[2]) {
          return {
            name: parts[2] || parts[1],
            driverVersion: parts[1] || 'N/A',
          };
        }
      }
    }
  } catch {
    // Fallback
  }

  try {
    const ps = await spawnCapture('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion | ConvertTo-Json -Compress',
    ], 4000);
    if (ps.code === 0 && ps.stdout) {
      const raw = JSON.parse(ps.stdout);
      const gpu = Array.isArray(raw) ? raw[0] : raw;
      if (gpu?.Name) {
        return {
          name: gpu.Name,
          driverVersion: gpu.DriverVersion || 'N/A',
        };
      }
    }
  } catch {}

  return { name: 'GPU Compatible con DirectX / Vulkan', driverVersion: 'N/A' };
}

export async function runGamingScanNative(onOutput) {
  const paths = prepareReport('gaming');
  const { today, reportPath } = paths;

  onOutput('Consultando hardware gráfico y ajustes de latencia...');
  const gpu = await detectActiveGPU();

  let optimizedCount = 0;
  const results = [];

  for (const setting of GAMING_SETTINGS) {
    const r = await spawnCapture('reg', ['query', setting.key, '/v', setting.value]);
    let currentValue = null;
    if (r.code === 0) {
      currentValue = parseRegDword(r.stdout);
    }

    const optimized = isOptimized(setting, currentValue);
    if (optimized) optimizedCount++;

    results.push({
      id: setting.id,
      name: setting.name,
      desc: setting.desc,
      optimized,
      currentValue,
      currentLabel: optimized ? setting.optimizedLabel : setting.defaultLabel,
      key: setting.key,
      value: setting.value,
      type: setting.type,
      targetValue: setting.optimizedValue,
    });
  }

  const lines = [
    `# Reporte de Optimización Gaming & GPU - ${today}`, '',
    `## Hardware Gráfico Detectado`, '',
    `- **GPU**: ${gpu.name}`,
    `- **Versión de Controlador**: ${gpu.driverVersion}`,
    '',
    `## Estado de Ajustes de Rendimiento (${GAMING_SETTINGS.length} analizados)`, '',
  ];

  lines.push('```');
  results.forEach((s, i) => {
    const status = s.optimized ? '[OPTIMIZADO]' : '[PENDIENTE]';
    lines.push(`[${i + 1}] ${status} ${s.name} (${s.currentLabel})`);
  });
  lines.push('```');
  lines.push('');

  lines.push('## Resumen', '');
  lines.push(`- Ajustes optimizados: ${optimizedCount} / ${GAMING_SETTINGS.length}`);
  lines.push(`- Ajustes pendientes de aceleración: ${GAMING_SETTINGS.length - optimizedCount}`);

  finishReport(paths, lines, {
    date: today,
    reportPath,
    gpu: gpu.name,
    optimizedCount,
    pendingCount: GAMING_SETTINGS.length - optimizedCount,
    total: GAMING_SETTINGS.length,
  }, onOutput, results);
}

export async function runGamingActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('gaming', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('gaming', { dryRun, writeLog });

  const rawSettings = String(envVars.SETTINGS || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (rawSettings.length === 0) {
    const err = new Error('No se seleccionó ningún ajuste para optimizar.');
    err.statusCode = 400;
    throw err;
  }

  const targets = GAMING_SETTINGS.filter((s) => rawSettings.includes(s.id));

  writeLog(`Iniciando optimización Gaming & GPU (Modo: ${dryRun ? 'SIMULACIÓN' : 'APLICAR'})...`);

  for (let i = 0; i < targets.length; i++) {
    const setting = targets[i];
    if (onProgress) onProgress(Math.round(((i + 1) / targets.length) * 100));

    const check = await spawnCapture('reg', ['query', setting.key, '/v', setting.value]);
    const prevVal = check.code === 0 ? parseRegDword(check.stdout) : null;

    if (prevVal === setting.optimizedValue) {
      writeLog(`- ${setting.name}: Ya está optimizado.`);
      continue;
    }

    const regTarget = `${setting.key}\\${setting.value}`;
    const result = await guard(
      `Optimizar ${setting.name}: ${setting.key}\\${setting.value} = ${setting.optimizedValue}`,
      () => spawnCapture('reg', [
        'add', setting.key, '/v', setting.value, '/t', setting.type,
        '/d', setting.optimizedValue, '/f',
      ]),
      {
        target: regTarget,
        settingId: setting.id,
        valueType: setting.type,
        newValue: setting.optimizedValue,
        previousValue: prevVal,
      },
    );

    if (result.simulated) continue;
    if (result.ok) {
      writeLog(`- ${setting.name}: Optimizado correctamente (${setting.optimizedLabel})`);
    } else {
      writeLog(`- Error al optimizar ${setting.name}: ${errText(result)}`);
    }
  }

  writeLog('Optimización Gaming & GPU finalizada.');
}
