import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { MODULES, spawnCapture } from './shared.js';

function fmtMinutes(totalMin) {
  if (!totalMin || totalMin <= 0) return 'N/A';
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export async function runPowerScanNative(onOutput) {
  const reportsDir = join(MODULES.power.dir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportsDir, `power-report-${today}.md`);
  const countsPath = join(reportsDir, 'power-counts.json');

  let scanError = false;
  onOutput('Obteniendo plan de energía activo...');
  let activeGuid = '', activeName = '';
  const activeResult = await spawnCapture('powercfg', ['/getactivescheme']);
  if (activeResult.code === 0) {
    const m = activeResult.stdout.match(/[\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12}/);
    const n = activeResult.stdout.match(/\((.+?)\)/);
    if (m) activeGuid = m[0];
    if (n) activeName = n[1];
  } else { scanError = true; }

  onOutput('Listando planes disponibles...');
  const plans = [];
  const listResult = await spawnCapture('powercfg', ['/list']);
  if (listResult.code === 0) {
    for (const line of listResult.stdout.split(/\r?\n/)) {
      const guidM = line.match(/([\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12})/);
      const nameM = line.match(/\((.+?)\)/);
      if (guidM && nameM) {
        plans.push({ guid: guidM[1], name: nameM[1], active: line.includes('*') });
      }
    }
  } else { scanError = true; }

  let batteryPct = null, batteryStatus = '', runtimeMin = null, powerWatts = null;
  onOutput('Consultando batería...');
  const batResult = await spawnCapture('powershell', [
    '-NoProfile', '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_Battery | Select-Object -First 1 | Select-Object EstimatedChargeRemaining,EstimatedRunTime,BatteryStatus,FullChargeCapacity | ConvertTo-Json -Compress',
  ]);
  if (batResult.code === 0 && batResult.stdout.trim()) {
    try {
      const b = JSON.parse(batResult.stdout.trim());
      if (b && b.EstimatedChargeRemaining != null) {
        batteryPct = parseInt(b.EstimatedChargeRemaining, 10);
        if (!Number.isFinite(batteryPct)) batteryPct = null;

        const rawRunTime = parseInt(b.EstimatedRunTime, 10);
        if (rawRunTime === 4294967295 || !Number.isFinite(rawRunTime) || rawRunTime <= 0) {
          runtimeMin = null;
        } else {
          runtimeMin = Math.round(rawRunTime / 60);
        }

        const bs = parseInt(b.BatteryStatus, 10);
        if (bs === 1) batteryStatus = 'Descargando';
        else if (bs === 2 || bs === 3) batteryStatus = 'En CA';
        else if (bs === 4) batteryStatus = 'Batería baja';
        else if (bs === 5) batteryStatus = 'Batería crítica';
        else if (bs >= 6 && bs <= 9) batteryStatus = 'Cargando';
        else if (bs === 10) batteryStatus = 'Cargando';
        else if (bs === 11) batteryStatus = 'Parcialmente cargada';
        else batteryStatus = 'Conectado';

        const capacityMWh = parseInt(b.FullChargeCapacity, 10);
        if (bs === 1 && runtimeMin > 0 && capacityMWh > 0 && batteryPct > 0) {
          const currentMWh = capacityMWh * (batteryPct / 100);
          powerWatts = Math.round(currentMWh / 1000 / (runtimeMin / 60));
        }
      }
    } catch (e) {
      onOutput(`Error parseando batería: ${e.message}`);
    }
  }

  const hasBattery = batteryPct !== null;

  function planDesc(name) {
    const n = name.toLowerCase();
    if (n.includes('equilibrado') || n.includes('balanced')) return 'Equilibra rendimiento y consumo. Recomendado para uso diario.';
    if (n.includes('alto rendimiento') || n.includes('high performance') || n.includes('rendimiento maximo') || n.includes('ultimate')) return 'Maximo rendimiento, mayor consumo. Ideal para gaming o tareas pesadas.';
    if (n.includes('ahorrador') || n.includes('power saver') || n.includes('economizador')) return 'Minimiza consumo de energia. Reduce brillo y rendimiento.';
    return 'Plan personalizado o del fabricante.';
  }

  const lines = [
    `# Reporte de Energía - ${today}`, '',
    '## Plan de energia activo', '',
    `- ${activeName || 'Desconocido'} — ${planDesc(activeName)}`, '',
    '## Planes disponibles', '',
  ];

  if (plans.length > 0) {
    lines.push('```');
    plans.forEach((p, i) => {
      const marker = p.active ? ' (ACTIVO)' : '';
      lines.push(`[${i + 1}] ${p.name} -- ${planDesc(p.name)}${marker}`);
    });
    lines.push('```');
  }
  lines.push('');

  if (hasBattery) {
    lines.push('## Batería', '');
    lines.push(`- Estado: ${batteryStatus}`);
    lines.push(`- Carga: ${batteryPct}%`);
    lines.push(`- Tiempo restante: ${fmtMinutes(runtimeMin)}`);
    if (powerWatts !== null) lines.push(`- Consumo estimado: ${powerWatts} W`);
    lines.push('');
  }

  lines.push('## Resumen', '');
  lines.push(`- Plan activo: ${activeName || 'N/A'}`);
  lines.push(`- Batería presente: ${hasBattery ? 'Sí' : 'No'}`);
  if (powerWatts !== null) lines.push(`- Consumo: ${powerWatts} W`);
  lines.push('');

  writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8');

  writeFileSync(countsPath, JSON.stringify({
    date: today, reportPath,
    active_plan: activeName || 'Unknown',
    active_guid: activeGuid,
    plans_count: plans.length,
    battery_present: hasBattery,
    battery_pct: batteryPct,
    battery_status: batteryStatus || null,
    runtime_min: runtimeMin,
    power_watts: powerWatts,
    error: scanError,
  }, null, 2), 'utf-8');

  onOutput(`Reporte generado en: ${reportPath}`);
}

export async function runPowerActionNative(envVars, onOutput) {
  const logDir = join(MODULES.power.dir, 'reports');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, 'optimize-log.txt');

  const writeLog = (message) => {
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const line = `[${stamp}] ${message}`;
    appendFileSync(logPath, line + '\n');
    onOutput(line);
  };

  writeLog('=== Cambio de plan de energía - inicio ===');

  const planIndex = parseInt(envVars.PLAN_INDEX, 10);
  if (!planIndex || planIndex < 1) {
    writeLog('No se seleccionó un plan válido.');
    writeLog('=== Cambio de plan de energía - fin ===');
    return;
  }

  // Re-escanear planes
  const listResult = await spawnCapture('powercfg', ['/list']);
  const plans = [];
  if (listResult.code === 0) {
    for (const line of listResult.stdout.split(/\r?\n/)) {
      const m = line.match(/^Power Scheme GUID:\s+(\S+)\s+\((.+?)\)/);
      if (m) plans.push({ guid: m[1], name: m[2] });
    }
  }

  const target = plans[planIndex - 1];
  if (!target) {
    writeLog(`Índice ${planIndex} fuera de rango.`);
    writeLog('=== Cambio de plan de energía - fin ===');
    return;
  }

  writeLog(`Cambiando a: ${target.name} (${target.guid})`);
  const setResult = await spawnCapture('powercfg', ['/setactive', target.guid]);
  if (setResult.code === 0) {
    writeLog(`Plan activado: ${target.name}`);
  } else {
    writeLog(`ERROR al cambiar plan: ${(setResult.stderr || setResult.stdout || '').trim().slice(0, 200)}`);
  }

  writeLog('=== Cambio de plan de energía - fin ===');
}
