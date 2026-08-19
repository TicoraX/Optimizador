import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

// Una sola consulta para bateria, CPU, GPU, RAM y discos.
//
// Antes esto eran 4 invocaciones separadas de PowerShell, cada una pagando
// ~200 ms solo en arrancar el interprete. Y la de CPU devolvia 4 valores en
// lineas sueltas que se leian POR POSICION: si LoadPercentage venia vacio, el
// array se corria y cpuName terminaba siendo el numero de nucleos. Devolver un
// objeto JSON resuelve las dos cosas.
const SYSTEM_INFO_PS = `$ErrorActionPreference='SilentlyContinue'
$bat = Get-CimInstance Win32_Battery | Select-Object -First 1
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1
$mem = @(Get-CimInstance Win32_PhysicalMemory)
[pscustomobject]@{
  battery = if($bat){@{pct=$bat.EstimatedChargeRemaining;runtime=$bat.EstimatedRunTime;status=$bat.BatteryStatus;full=$bat.FullChargeCapacity;design=$bat.DesignCapacity;volt=$bat.DesignVoltage}}else{$null}
  cpu = @{load=$cpu.LoadPercentage;name=$cpu.Name;cores=$cpu.NumberOfCores}
  gpu = if($gpu){@{name=$gpu.Name;ram=$gpu.AdapterRAM}}else{$null}
  ramBytes = ($mem | Measure-Object -Property Capacity -Sum).Sum
  ramSticks = $mem.Count
  diskCount = @(Get-CimInstance Win32_DiskDrive).Count
} | ConvertTo-Json -Compress -Depth 4`;

function fmtMinutes(totalMin) {
  if (!totalMin || totalMin <= 0) return 'N/A';
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export async function runPowerScanNative(onOutput) {
  const paths = prepareReport('power');
  const { today, reportPath } = paths;

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
  } else {
    scanError = true;
    onOutput(`Error listando planes de energía: ${errText(listResult)}`);
  }

  let batteryPct = null, batteryStatus = '', runtimeMin = null, powerWatts = null;
  let capFull = null, capDesign = null, wearPct = null;
  onOutput('Consultando hardware del sistema...');
  const sysResult = await spawnCapture('powershell', [
    '-NoProfile', '-NonInteractive', '-Command', SYSTEM_INFO_PS,
  ]);
  let sysInfo = null;
  if (sysResult.code === 0 && sysResult.stdout.trim()) {
    try {
      sysInfo = JSON.parse(sysResult.stdout.trim());
    } catch (e) {
      onOutput(`Error parseando informacion del sistema: ${e.message}`);
      scanError = true;
    }
  } else {
    scanError = true;
    onOutput(`Error consultando hardware: ${errText(sysResult)}`);
  }

  const b = sysInfo?.battery;
  if (b && b.pct != null) {
    batteryPct = parseInt(b.pct, 10);
    if (!Number.isFinite(batteryPct)) batteryPct = null;

    const rawRunTime = parseInt(b.runtime, 10);
    if (rawRunTime === 4294967295 || !Number.isFinite(rawRunTime) || rawRunTime <= 0) {
      runtimeMin = null;
    } else {
      // EstimatedRunTime está documentado en segundos, pero algunos drivers reportan minutos.
      // Si rawRunTime > 3600 (>1h en segundos) → seguro son segundos.
      // Si rawRunTime < 600 (<10min en segundos) → podría ser minutos (ej. 180 = 3h).
      if (rawRunTime > 3600) {
        runtimeMin = Math.round(rawRunTime / 60);
      } else {
        // Valor ambiguo: asumir segundos. Si la batería tiene >50% y el runtime
        // en minutos da <5, el valor probablemente son minutos.
        const mins = Math.round(rawRunTime / 60);
        if (mins < 5 && batteryPct !== null && batteryPct > 50) {
          runtimeMin = Math.round(rawRunTime);
        } else {
          runtimeMin = mins;
        }
      }
    }

    const bs = parseInt(b.status, 10);
    if (bs === 1) batteryStatus = 'Descargando';
    else if (bs === 2 || bs === 3) batteryStatus = 'En CA';
    else if (bs === 4) batteryStatus = 'Batería baja';
    else if (bs === 5) batteryStatus = 'Batería crítica';
    else if (bs >= 6 && bs <= 9) batteryStatus = 'Cargando';
    else if (bs === 10) batteryStatus = 'Cargando';
    else if (bs === 11) batteryStatus = 'Parcialmente cargada';
    else batteryStatus = 'Conectado';

    capFull = parseInt(b.full, 10);
    capDesign = parseInt(b.design, 10);
    if (!Number.isFinite(capFull) || capFull <= 0) capFull = null;
    if (!Number.isFinite(capDesign) || capDesign <= 0) capDesign = null;

    // Desgaste de batería (si tenemos ambas capacidades)
    if (capFull && capDesign && capDesign > 0) {
      wearPct = Math.round((1 - capFull / capDesign) * 100);
      if (wearPct < 0) wearPct = 0;
    }

    // Consumo estimado: disponible siempre que tengamos batería y datos suficientes
    if (capFull && batteryPct !== null) {
      const currentMWh = capFull * (batteryPct / 100);
      if (bs === 1 && runtimeMin > 0 && runtimeMin !== null) {
        // Descargando con runtime conocido → cálculo preciso
        powerWatts = Math.round(currentMWh / 1000 / (runtimeMin / 60));
      } else if (runtimeMin && runtimeMin > 0) {
        // En CA pero con runtime del último descargo → estimado
        powerWatts = Math.round(currentMWh / 1000 / (runtimeMin / 60));
      }
    }
  }

  const hasBattery = batteryPct !== null;

  // ── Estimación de componentes (CPU, GPU, RAM, discos) ──
  let cpuLoad = null, cpuName = '', cpuTDP = 65, cpuMethod = '';
  let gpuWattsVal = null, gpuName = '', gpuMethod = 'none', gpuTDP = 0;
  let ramGB = 0, ramSticks = 0, ramWatts = 0;
  let diskCount = 0, diskWatts = 0;
  let moboWatts = 15, otherWatts = 5;

  // Los datos ya vinieron en la consulta batcheada de arriba.
  if (sysInfo?.cpu) {
    const lp = parseFloat(sysInfo.cpu.load);
    if (Number.isFinite(lp) && lp >= 0) cpuLoad = Math.round(lp);
    cpuName = String(sysInfo.cpu.name || '').trim();
    // Estimar TDP por modelo
    const cn = cpuName.toLowerCase();
    if (cn.includes('i9') || cn.includes('9 99') || cn.includes('threadripper') || cn.includes('5950') || cn.includes('7950')) cpuTDP = 125;
    else if (cn.includes('i7') || cn.includes('7 8') || cn.includes('7 7') || cn.includes('7 9') || cn.includes('5800') || cn.includes('7800')) cpuTDP = 95;
    else if (cn.includes('i5') || cn.includes('5 6') || cn.includes('5 5') || cn.includes('5 7') || cn.includes('5600') || cn.includes('7600')) cpuTDP = 65;
    else if (cn.includes('i3') || cn.includes('3 1') || cn.includes('3 2') || cn.includes('ryzen 3')) cpuTDP = 60;
    else if (cn.includes('ultra') || cn.includes('u 1') || cn.includes('u 2')) cpuTDP = 28;
    else if (cn.includes('mobile') || cn.includes(' m ')) cpuTDP = 15;
    // Si es laptop (tiene batería), TDP más bajo por lo general
    if (hasBattery && cpuTDP > 45) cpuTDP = 45;
    cpuMethod = 'estimated';
  }

  // GPU: nvidia-smi en tiempo real
  const nvResult = await spawnCapture('nvidia-smi', ['--query-gpu=power.draw,name', '--format=csv,noheader,nounits']);
  if (nvResult.code === 0 && nvResult.stdout.trim()) {
    const g = nvResult.stdout.trim().split(',');
    const w = parseFloat(g[0]);
    if (Number.isFinite(w) && w > 0) {
      gpuWattsVal = Math.round(w * 10) / 10;
      gpuName = (g[1] || '').trim();
      gpuMethod = 'real';
    }
  }
  // Fallback GPU: nombre del batch + estimación por TDP
  if (!gpuWattsVal) {
    {
      {
        const v = sysInfo?.gpu;
        if (v && v.name) {
          gpuName = v.name;
          const gn = gpuName.toLowerCase();
          // RTX 40 series
          if (gn.includes('rtx 4090')) gpuTDP = 450;
          else if (gn.includes('rtx 4080')) gpuTDP = 320;
          else if (gn.includes('rtx 4070')) gpuTDP = 200;
          else if (gn.includes('rtx 4060')) gpuTDP = 115;
          // RTX 30 series
          else if (gn.includes('rtx 3090')) gpuTDP = 350;
          else if (gn.includes('rtx 3080')) gpuTDP = 320;
          else if (gn.includes('rtx 3070')) gpuTDP = 220;
          else if (gn.includes('rtx 3060')) gpuTDP = 170;
          else if (gn.includes('rtx 3050')) gpuTDP = 130;
          // RTX 20 series
          else if (gn.includes('rtx 2080')) gpuTDP = 215;
          else if (gn.includes('rtx 2070')) gpuTDP = 175;
          else if (gn.includes('rtx 2060')) gpuTDP = 160;
          // GTX 16 series
          else if (gn.includes('gtx 1660')) gpuTDP = 120;
          else if (gn.includes('gtx 1650')) gpuTDP = 75;
          // GTX 10 series
          else if (gn.includes('gtx 1080')) gpuTDP = 180;
          else if (gn.includes('gtx 1070')) gpuTDP = 150;
          else if (gn.includes('gtx 1060')) gpuTDP = 120;
          else if (gn.includes('gtx 1050')) gpuTDP = 75;
          // RX 7000
          else if (gn.includes('rx 7900')) gpuTDP = 355;
          else if (gn.includes('rx 7800')) gpuTDP = 263;
          else if (gn.includes('rx 7700')) gpuTDP = 200;
          else if (gn.includes('rx 7600')) gpuTDP = 165;
          // RX 6000
          else if (gn.includes('rx 6900') || gn.includes('rx 6800')) gpuTDP = 300;
          else if (gn.includes('rx 6700')) gpuTDP = 230;
          else if (gn.includes('rx 6600')) gpuTDP = 132;
          else if (gn.includes('rx 6500')) gpuTDP = 107;
          // Integrated / basic
          else if (gn.includes('intel') || gn.includes('uhd') || gn.includes('iris')) gpuTDP = 0; // shared with CPU
          else if (gn.includes('vega') || gn.includes('radeon') && (gn.includes('mobile') || gn.includes(' graphics'))) gpuTDP = 0; // integrated
          else gpuTDP = 75; // unknown GPU default

          // Si es laptop, escalar TDP
          if (hasBattery && gpuTDP > 100) gpuTDP = Math.round(gpuTDP * 0.6);

          gpuMethod = gpuTDP > 0 ? 'tdp' : 'shared';
        }
      }
    }
  }

  // RAM y discos: tambien del batch.
  if (sysInfo) {
    const totalBytes = parseFloat(sysInfo.ramBytes);
    if (Number.isFinite(totalBytes) && totalBytes > 0) ramGB = Math.round(totalBytes / (1024 * 1024 * 1024));
    ramSticks = parseInt(sysInfo.ramSticks, 10);
    if (!Number.isFinite(ramSticks) || ramSticks < 1) ramSticks = Math.max(1, Math.round(ramGB / 8));
    ramWatts = ramSticks * 3;

    diskCount = parseInt(sysInfo.diskCount, 10);
    if (Number.isFinite(diskCount) && diskCount > 0) diskWatts = diskCount * 5;
    else diskCount = 0;
  }

  // Armar desglose de componentes
  const compBreakdown = [];
  let totalEstWatts = 0;

  // CPU
  const cpuEstWatts = cpuLoad !== null ? Math.round((cpuLoad / 100) * cpuTDP) : Math.round(cpuTDP * 0.1);
  compBreakdown.push({ name: cpuName || 'CPU', watts: cpuEstWatts, tdp: cpuTDP, pct: cpuLoad, note: cpuLoad !== null ? `CPU al ${cpuLoad}%` : 'Idle' });
  totalEstWatts += cpuEstWatts;

  // GPU
  if (gpuWattsVal) {
    compBreakdown.push({ name: gpuName || 'GPU', watts: Math.round(gpuWattsVal), real: true });
    totalEstWatts += Math.round(gpuWattsVal);
  } else if (gpuTDP > 0) {
    // GPU sin medición real: usar TDP escalado por carga de CPU como proxy
    const gpuLoad = cpuLoad !== null ? cpuLoad : 10;
    const gpuEst = Math.round((gpuLoad / 100) * gpuTDP);
    compBreakdown.push({ name: gpuName || 'GPU', watts: gpuEst, tdp: gpuTDP, note: 'Estimado por TDP' });
    totalEstWatts += gpuEst;
  } else if (gpuMethod === 'shared') {
    compBreakdown.push({ name: gpuName || 'GPU (integrada)', watts: 0, note: 'Comparte consumo con CPU' });
  } else {
    compBreakdown.push({ name: 'GPU', watts: 0, note: 'No detectada' });
  }

  // RAM
  if (ramWatts > 0) {
    compBreakdown.push({ name: `RAM (${ramGB} GB, ${ramSticks} módulos)`, watts: ramWatts });
    totalEstWatts += ramWatts;
  }

  // Discos
  if (diskWatts > 0) {
    compBreakdown.push({ name: `${diskCount} disco(s)`, watts: diskWatts });
    totalEstWatts += diskWatts;
  }

  // Placa madre
  compBreakdown.push({ name: 'Placa madre / chipset', watts: moboWatts });
  totalEstWatts += moboWatts;

  // Otros (USB, ventiladores, etc.)
  compBreakdown.push({ name: 'Otros (USB, ventiladores)', watts: otherWatts });
  totalEstWatts += otherWatts;

  // Para desktops sin batería: usar total estimado como powerWatts
  if (!hasBattery && totalEstWatts > 0) {
    powerWatts = totalEstWatts;
  }

  // ── Listado de planes (sin leer settings internas) ──
  // Las settings de Windows suelen ser identicas entre planes en desktops modernos
  // y su lectura por GUID es fragil. Solo mostramos los nombres y permitimos cambiar.
  function planDesc(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('balanced') || n.includes('equilibrado')) return 'CPU 5%-100%, enfriamiento pasivo, suspension a los 30min.';
    if (n.includes('high performance') || n.includes('alto rendimiento') || n.includes('ultimate')) return 'CPU 100% fijo, enfriamiento activo, sin suspension.';
    if (n.includes('power saver') || n.includes('ahorrador')) return 'CPU 5%-100%, enfriamiento pasivo, suspension a los 15min, brillo reducido.';
    return 'Personalizado.';
  }

  const lines = [
    `# Reporte de Energia - ${today}`, '',
    '## Plan activo', '',
    `- **${activeName || 'Desconocido'}** — ${planDesc(activeName)}`, '',
    '## Planes disponibles', '',
  ];
  if (plans.length > 0) {
    lines.push('```');
    plans.forEach((p, i) => {
      const marker = p.active ? ' (ACTIVO)' : '';
      lines.push(`[${i + 1}] ${p.name}${marker}`);
    });
    lines.push('```');
  }
  lines.push('');

  // ── Bateria (si existe) ──
  if (hasBattery) {
    lines.push('## Bateria', '');
    lines.push(`- Estado: ${batteryStatus}`);
    lines.push(`- Carga: ${batteryPct}%`);
    if (runtimeMin !== null) lines.push(`- Tiempo restante: ${fmtMinutes(runtimeMin)}`);
    if (powerWatts !== null) lines.push(`- Consumo total: ~${powerWatts} W`);
    if (capFull !== null && capDesign !== null) {
      lines.push(`- Capacidad actual: ${(capFull / 1000).toFixed(1)} Wh`);
      lines.push(`- Capacidad de diseño: ${(capDesign / 1000).toFixed(1)} Wh`);
      lines.push(`- Desgaste: ${wearPct}%`);
    }
    lines.push('');
  }

  // ── Consumo por componente ──
  lines.push('## Consumo por componente', '');
  lines.push('| Componente | Consumo | Detalle |');
  lines.push('| --- | --- | --- |');
  for (const c of compBreakdown) {
    const wStr = c.real ? `${c.watts} W (real)` : c.watts === 0 ? (c.note || '—') : `${c.watts} W`;
    const detail = c.real ? 'Medido por sensor' : (c.note || (c.tdp ? `TDP ${c.tdp}W` : ''));
    lines.push(`| ${c.name} | ${wStr} | ${detail} |`);
  }
  lines.push(`| **Total estimado** | **${totalEstWatts} W** | |`);
  lines.push('');

  if (hasBattery && powerWatts !== null) {
    lines.push(`(Bateria marca ${powerWatts} W total vs ${totalEstWatts} W estimado. Diferencia por picos y eficiencia de fuente.)`);
    lines.push('');
  } else {
    lines.push('(Consumo estimado sumando TDP de componentes escalado por carga. Para medicion precisa usa medidor de pared.)');
    lines.push('');
  }

  lines.push('## Resumen', '');
  lines.push(`- Plan activo: ${activeName || 'N/A'}`);
  lines.push(`- Batería presente: ${hasBattery ? 'Sí' : 'No'}`);
  if (hasBattery) {
    lines.push(`- Carga: ${batteryPct}%`);
    if (runtimeMin !== null) lines.push(`- Autonomía: ${fmtMinutes(runtimeMin)}`);
    if (wearPct !== null) lines.push(`- Desgaste: ${wearPct}%`);
  }
  lines.push(`- Consumo total estimado: ~${totalEstWatts} W`);
  lines.push(`- CPU: ${cpuName ? cpuName.split('(')[0].trim() : 'N/A'} al ${cpuLoad !== null ? cpuLoad + '%' : 'N/A'}`);
  if (gpuName) lines.push(`- GPU: ${gpuName}`);
  lines.push(`- RAM: ${ramGB} GB (${ramSticks} módulos)`);
  if (diskCount > 0) lines.push(`- Discos: ${diskCount}`);
  lines.push('');

  finishReport(paths, lines, {
    date: today, reportPath,
    active_plan: activeName || 'Unknown',
    active_guid: activeGuid,
    plans_count: plans.length,
    battery_present: hasBattery,
    battery_pct: batteryPct,
    battery_status: batteryStatus || null,
    runtime_min: runtimeMin,
    power_watts: powerWatts,
    total_est_watts: totalEstWatts,
    wear_pct: wearPct,
    capacity_full_mwh: capFull,
    capacity_design_mwh: capDesign,
    cpu_load: cpuLoad,
    cpu_name: cpuName || null,
    cpu_tdp: cpuTDP,
    cpu_est_watts: cpuEstWatts,
    gpu_name: gpuName || null,
    gpu_method: gpuMethod,
    gpu_watts: gpuWattsVal ? gpuWattsVal : (gpuTDP > 0 ? gpuTDP : null),
    gpu_est_watts: compBreakdown.filter(c => c.name.includes('GPU') || c.name.includes('gpu'))[0]?.watts || null,
    ram_gb: ramGB,
    ram_sticks: ramSticks,
    ram_watts: ramWatts,
    disk_count: diskCount,
    disk_watts: diskWatts,
    mobo_watts: moboWatts,
    other_watts: otherWatts,
    plan_max_proc: null,
    plan_min_proc: null,
    plan_display_off: null,
    plan_cooling: null,
    plan_sleep_standby: null,
    error: scanError,
  }, onOutput,
  // `guid` es lo que la accion usa para resolver el plan. `index` queda solo
  // para numerar la lista en el reporte.
  plans.map((p, i) => ({ index: i + 1, guid: p.guid, name: p.name, active: p.active })));
}

export async function runPowerActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('power', onOutput);
  const dryRun = envVars?.DRY_RUN === 'true';
  const guard = makeGuard('power', { dryRun, writeLog });

  writeLog(`=== Cambio de plan de energía - inicio${dryRun ? ' (SIMULACION)' : ''} ===`);

  // Por GUID, no por posicion. `powercfg /list` puede cambiar de orden si se
  // crea o borra un plan entre el escaneo y el clic, y ahi el indice N pasa a
  // apuntar a otro plan. El GUID identifica al plan sin ambiguedad.
  const planGuid = String(envVars?.PLAN_GUID || envVars?.GUID || envVars?.PLAN || '').trim().toLowerCase();
  if (!planGuid) {
    writeLog('No se seleccionó un plan válido.');
    writeLog('=== Cambio de plan de energía - fin ===');
    return;
  }

  onProgress?.(25);

  let currentActiveGuid = '';
  const activeResult = await spawnCapture('powercfg', ['/getactivescheme']);
  if (activeResult.code === 0) {
    const m = activeResult.stdout.match(/[\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12}/);
    if (m) currentActiveGuid = m[0];
  }

  const listResult = await spawnCapture('powercfg', ['/list']);
  const plans = [];
  if (listResult.code === 0) {
    for (const line of listResult.stdout.split(/\r?\n/)) {
      const guidM = line.match(/([\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12})/);
      const nameM = line.match(/\((.+?)\)/);
      if (guidM && nameM) plans.push({ guid: guidM[1], name: nameM[1] });
    }
  }

  onProgress?.(50);

  const target = plans.find((p) => p.guid.toLowerCase() === planGuid);
  if (!target) {
    writeLog(`El plan ${planGuid} ya no existe en este equipo. Volvé a escanear.`);
    writeLog('=== Cambio de plan de energía - fin ===');
    return;
  }

  writeLog(`Cambiando a: ${target.name} (${target.guid})`);
  const setResult = await guard(
    `Activar plan de energía ${target.name}`,
    () => spawnCapture('powercfg', ['/setactive', target.guid]),
    {
      target: target.guid,
      previousValue: currentActiveGuid || null,
      newValue: target.guid,
    },
  );

  if (setResult.simulated) {
    onProgress?.(100);
    writeLog('=== Cambio de plan de energía - fin ===');
    return;
  }

  if (setResult.ok) {
    writeLog(`Plan activado: ${target.name}`);
  } else {
    writeLog(`ERROR al cambiar plan: ${errText(setResult)}`);
  }

  onProgress?.(100);
  writeLog('=== Cambio de plan de energía - fin ===');
}
