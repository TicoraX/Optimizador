import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { MODULES, spawnCapture } from './shared.js';

export async function runServicesScanNative(onOutput) {
  const reportsDir = join(MODULES.services.dir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportsDir, `services-report-${today}.md`);
  const countsPath = join(reportsDir, 'services-counts.json');

  let scanError = false;
  onOutput('Obteniendo servicios...');
  const psResult = await spawnCapture('powershell', [
    '-NoProfile', '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq "Auto" } | Select-Object Name,DisplayName,State,ProcessId,PathName | ConvertTo-Json -Compress',
  ]);

  let thirdParty = [], system = [];
  if (psResult.code === 0 && psResult.stdout.trim()) {
    try {
      const raw = JSON.parse(psResult.stdout.trim());
      const services = Array.isArray(raw) ? raw : [raw];
      for (const s of services) {
        const path = (s.PathName || '').toLowerCase();
        const isMs = path.includes('\\windows\\') || path.includes('\\system32\\') || path.includes('\\winsxs\\') || path === '';
        const entry = { name: s.Name, displayName: s.DisplayName || s.Name, state: s.State, pid: s.ProcessId };
        if (isMs) system.push(entry);
        else thirdParty.push(entry);
      }
    } catch (e) {
      onOutput(`Error parseando servicios: ${e.message}`);
      scanError = true;
    }
  } else {
    scanError = true;
  }

  onOutput('Obteniendo consumo de memoria...');
  const pidMem = new Map();
  const memResult = await spawnCapture('wmic', ['process', 'get', 'ProcessId,WorkingSetSize', '/FORMAT:CSV']);
  if (memResult.code === 0) {
    for (const line of memResult.stdout.trim().split(/\r?\n/)) {
      const cols = [];
      let cur = '', inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) { cols.push(cur); cur = ''; }
        else cur += ch;
      }
      cols.push(cur);
      const pid = parseInt(cols[1], 10);
      const wsBytes = parseInt(cols[2], 10);
      if (pid > 0 && Number.isFinite(wsBytes)) {
        pidMem.set(pid, Math.round(wsBytes / (1024 * 1024)));
      }
    }
  } else { scanError = true; }

  const allServices = [...thirdParty, ...system];
  for (const s of allServices) {
    s.memMB = s.pid > 0 ? (pidMem.get(s.pid) || 0) : 0;
  }

  const running3rd = thirdParty.filter((s) => s.state === 'Running');
  const stopped3rd = thirdParty.filter((s) => s.state !== 'Running');
  const runningSys = system.filter((s) => s.state === 'Running');

  thirdParty.sort((a, b) => (b.state === 'Running' ? 1 : 0) - (a.state === 'Running' ? 1 : 0) || b.memMB - a.memMB);

  const total3rdMem = running3rd.reduce((acc, s) => acc + s.memMB, 0);

  const lines = [
    `# Reporte de Servicios - ${today}`, '',
    `## Servicios de Terceros (Auto) — ${thirdParty.length}`, '',
  ];

  if (thirdParty.length > 0) {
    lines.push('```');
    thirdParty.forEach((s, i) => {
      const state = s.state === 'Running' ? `${s.memMB} MB` : 'Detenido';
      lines.push(`[${i + 1}] ${s.name} — ${s.displayName} — ${state}`);
    });
    lines.push('```');
  } else {
    lines.push('No hay servicios de terceros con inicio automatico.');
  }
  lines.push('');

  lines.push(`## Servicios del Sistema (Auto) — ${system.length}`, '');
  if (system.length > 0) {
    lines.push('```');
    system.forEach((s) => {
      const state = s.state === 'Running' ? `${s.memMB} MB` : 'Detenido';
      lines.push(`${s.name} — ${s.displayName} — ${state}`);
    });
    lines.push('```');
  } else {
    lines.push('No hay servicios del sistema con inicio automatico.');
  }
  lines.push('');

  lines.push(`## Resumen`, '');
  lines.push(`- Servicios de terceros (Auto): ${thirdParty.length} (${running3rd.length} ejecutandose, ~${total3rdMem} MB)`);
  lines.push(`- Servicios del sistema (Auto): ${system.length} (${runningSys.length} ejecutandose)`);
  lines.push('');

  writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8');

  writeFileSync(countsPath, JSON.stringify({
    date: today, reportPath,
    third_party_total: thirdParty.length,
    third_party_running: running3rd.length,
    third_party_memory_mb: total3rdMem,
    system_total: system.length,
    system_running: runningSys.length,
    error: scanError,
  }, null, 2), 'utf-8');

  onOutput(`Reporte generado en: ${reportPath}`);
}

export async function runServicesActionNative(envVars, onOutput) {
  const logDir = join(MODULES.services.dir, 'reports');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, 'optimize-log.txt');

  const writeLog = (message) => {
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const line = `[${stamp}] ${message}`;
    appendFileSync(logPath, line + '\n');
    onOutput(line);
  };

  writeLog('=== Optimizacion de Servicios - inicio ===');

  const selection = envVars.OPTIMIZE_SERVICES || '';
  const indices = selection.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 1);

  if (indices.length === 0) {
    writeLog('No se seleccionaron servicios para optimizar.');
    writeLog('=== Optimizacion de Servicios - fin ===');
    return;
  }

  // Re-scan para obtener la misma lista de terceros
  const psResult = await spawnCapture('powershell', [
    '-NoProfile', '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq "Auto" } | Select-Object Name,DisplayName,State,ProcessId,PathName | ConvertTo-Json -Compress',
  ]);

  let thirdParty = [];
  if (psResult.code === 0 && psResult.stdout.trim()) {
    try {
      const raw = JSON.parse(psResult.stdout.trim());
      const services = Array.isArray(raw) ? raw : [raw];
      for (const s of services) {
        const path = (s.PathName || '').toLowerCase();
        const isMs = path.includes('\\windows\\') || path.includes('\\system32\\') || path.includes('\\winsxs\\') || path === '';
        if (!isMs) thirdParty.push(s);
      }
    } catch (e) {
      writeLog(`Error re-escaneando servicios: ${e.message}`);
    }
  }

  let stopped = 0, disabled = 0, errors = 0;

  for (const idx of indices) {
    const s = thirdParty[idx - 1];
    if (!s) {
      writeLog(`Indice ${idx} fuera de rango, ignorado.`);
      continue;
    }
    writeLog(`Procesando: ${s.Name} (${s.DisplayName})`);

    if (s.State === 'Running') {
      const stopResult = await spawnCapture('sc', ['stop', s.Name]);
      if (stopResult.code === 0) {
        stopped++;
        writeLog(`  Detenido: ${s.Name}`);
      } else {
        errors++;
        writeLog(`  ERROR deteniendo ${s.Name}: ${(stopResult.stderr || stopResult.stdout || '').trim().slice(0, 200)}`);
        continue;
      }
    }

    const configResult = await spawnCapture('sc', ['config', s.Name, 'start=', 'disabled']);
    if (configResult.code === 0) {
      disabled++;
      writeLog(`  Deshabilitado: ${s.Name}`);
    } else {
      errors++;
      writeLog(`  ERROR deshabilitando ${s.Name}: ${(configResult.stderr || configResult.stdout || '').trim().slice(0, 200)}`);
    }
  }

  writeLog(`Resumen: ${stopped} detenidos, ${disabled} deshabilitados, ${errors} errores`);
  writeLog('=== Optimizacion de Servicios - fin ===');
}
