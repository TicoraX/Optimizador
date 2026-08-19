import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  MODULES, spawnCapture, loadJsonSafe, parseCsvLine,
  makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

export async function runServicesScanNative(onOutput) {
  const paths = prepareReport('services');
  const { today, reportPath } = paths;

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
        // Misma funcion que usa la accion: si el scan y la accion clasificaran
        // distinto, el reporte volveria a ofrecer algo que la accion rechaza.
        const entry = { name: s.Name, displayName: s.DisplayName || s.Name, state: s.State, pid: s.ProcessId };
        if (isSystemServicePath(s.PathName, s.Name)) system.push(entry);
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
  // Antes esto usaba `wmic`, que Windows 11 24H2+ ya no instala: en esas
  // maquinas fallaba en silencio y todos los servicios quedaban con 0 MB.
  // `tasklist /FO CSV` es nativo, sigue presente y cuesta lo mismo.
  const pidMem = new Map();
  const memResult = await spawnCapture('tasklist', ['/FO', 'CSV', '/NH']);
  if (memResult.code === 0) {
    for (const line of memResult.stdout.trim().split(/\r?\n/)) {
      // "imagen","PID","sesion","num","1.234 KB"
      const cols = parseCsvLine(line).map((c) => c.replace(/^"|"$/g, ''));
      const pid = parseInt(cols[1], 10);
      const memKB = parseInt(String(cols[4] || '').replace(/[^\d]/g, ''), 10);
      if (pid > 0 && Number.isFinite(memKB)) {
        pidMem.set(pid, Math.round(memKB / 1024));
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

  finishReport(paths, lines, {
    date: today, reportPath,
    third_party_total: thirdParty.length,
    third_party_running: running3rd.length,
    third_party_memory_mb: total3rdMem,
    system_total: system.length,
    system_running: runningSys.length,
    error: scanError,
  }, onOutput,
  // La accion selecciona por nombre, asi que el nombre es lo que viaja.
  thirdParty.map((s) => ({
    name: s.name, displayName: s.displayName, state: s.state, memMB: s.memMB,
  })));
}

/** Parsea la salida de `sc qc <nombre>`. Devuelve null si el servicio no existe. */
export function parseScQc(stdout) {
  const field = (label) => {
    const m = stdout.match(new RegExp(`${label}\\s*:\\s*(.+)`));
    return m ? m[1].trim() : null;
  };
  const name = field('SERVICE_NAME');
  if (!name) return null;
  const rawStart = field('START_TYPE'); // ej. "2   AUTO_START"
  return {
    name,
    displayName: field('DISPLAY_NAME') || name,
    binaryPath: field('BINARY_PATH_NAME') || '',
    startTypeCode: rawStart ? parseInt(rawStart, 10) : null,
    startTypeLabel: rawStart || '',
  };
}

// Servicios que NUNCA se ofrecen ni se tocan, por nombre.
//
// La clasificacion por ruta no alcanza: Windows Defender vive en
// C:\ProgramData\Microsoft\Windows Defender\, que no contiene ninguno de los
// fragmentos de abajo, asi que aparecia listado como "de terceros" y quedaba a
// un clic de deshabilitarse. Una heuristica de rutas siempre va a tener huecos;
// para lo critico hace falta una lista por nombre.
const PROTECTED_SERVICES = new Set([
  // Defender y seguridad
  'windefend', 'wdnissvc', 'wdfilter', 'wdboot', 'sense', 'securityhealthservice',
  'wscsvc', 'mpssvc', 'bfe', 'sgrmbroker',
  // Actualizaciones
  'wuauserv', 'usosvc', 'waasmedicsvc', 'trustedinstaller', 'bits', 'dosvc',
  // Nucleo del sistema
  'rpcss', 'dcomlaunch', 'lsm', 'plugplay', 'power', 'profsvc', 'themes',
  'audiosrv', 'audioendpointbuilder', 'eventlog', 'schedule', 'cryptsvc',
  'dhcp', 'dnscache', 'nsi', 'winmgmt', 'lanmanworkstation', 'lanmanserver',
]);

/**
 * Un servicio se considera intocable si esta en la lista de protegidos o si su
 * binario vive en el arbol de Windows. Ante la duda (ruta vacia), protege.
 */
export function isSystemServicePath(binaryPath, serviceName = '') {
  if (PROTECTED_SERVICES.has(String(serviceName).toLowerCase())) return true;
  const p = String(binaryPath || '').toLowerCase();
  if (p === '') return true;
  return p.includes('\\windows\\')
    || p.includes('\\system32\\')
    || p.includes('\\winsxs\\')
    || p.includes('\\windows defender\\')
    || p.includes('\\windowsapps\\');
}

// `sc config start=` acepta estos; el codigo numerico viene de `sc qc`.
const START_TYPE_BY_CODE = { 2: 'auto', 3: 'demand', 4: 'disabled' };

export async function runServicesActionNative(envVars, onOutput) {
  const writeLog = makeLogger('services', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('services', { dryRun, writeLog });

  writeLog(`=== Optimizacion de Servicios - inicio${dryRun ? ' (SIMULACION)' : ''} ===`);

  // Antes la seleccion venia por indice sobre la lista del reporte. El scan la
  // ordena por estado y memoria (arriba), la accion re-escaneaba SIN ordenar, y
  // el indice N terminaba apuntando a otro servicio: el usuario marcaba uno y se
  // deshabilitaba otro, de forma irreversible. Ahora se selecciona por nombre,
  // que es estable entre scan y accion.
  const names = String(envVars.OPTIMIZE_SERVICES || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  if (names.length === 0) {
    writeLog('No se seleccionaron servicios para optimizar.');
    writeLog('=== Optimizacion de Servicios - fin ===');
    return;
  }

  // Manifiesto para poder revertir. `sc config start= disabled` no guarda el
  // valor previo en ningun lado, asi que sin esto deshabilitar es irreversible.
  const manifestPath = join(MODULES.services.dir, 'reports', 'disabled-services.json');
  const manifest = loadJsonSafe(manifestPath, []);

  let stopped = 0, disabled = 0, errors = 0, skipped = 0;

  for (const name of names) {
    // `sc qc` cuesta ~25 ms y devuelve START_TYPE, la ruta del binario y el
    // display name. Reemplaza el re-escaneo con Get-CimInstance, que costaba
    // ~1588 ms para toda la maquina.
    const qc = await spawnCapture('sc.exe', ['qc', name]);
    const info = qc.code === 0 ? parseScQc(qc.stdout) : null;

    if (!info) {
      skipped++;
      writeLog(`Servicio no encontrado, ignorado: ${name}`);
      continue;
    }

    // Salvaguarda: el scan clasifica por ruta, pero la accion se vuelve a
    // asegurar antes de tocar nada. Deshabilitar un servicio de Windows por un
    // payload manipulado no deberia ser posible.
    if (isSystemServicePath(info.binaryPath, info.name)) {
      skipped++;
      writeLog(`Omitido (servicio del sistema): ${info.name} — ${info.binaryPath}`);
      continue;
    }

    writeLog(`Procesando: ${info.name} (${info.displayName})`);

    const queryResult = await spawnCapture('sc.exe', ['query', info.name]);
    const isRunning = queryResult.code === 0 && /STATE\s*:\s*\d+\s+RUNNING/i.test(queryResult.stdout);

    if (isRunning) {
      const stopResult = await guard(
        `Detener servicio ${info.name}`,
        () => spawnCapture('sc.exe', ['stop', info.name]),
        { target: info.name, previousValue: 'Running', newValue: 'Stopped' },
      );
      if (!stopResult.simulated) {
        if (stopResult.ok) {
          stopped++;
          writeLog(`  Detenido: ${info.name}`);
        } else if (/1062|no se ha iniciado|not been started/i.test(errText(stopResult))) {
          writeLog(`  Ya estaba detenido: ${info.name}`);
        } else {
          errors++;
          writeLog(`  ERROR deteniendo ${info.name}: ${errText(stopResult)}`);
          continue;
        }
      }
    } else {
      writeLog(`  Ya estaba detenido: ${info.name}`);
    }

    const previousStartType = START_TYPE_BY_CODE[info.startTypeCode] || 'auto';
    const configResult = await guard(
      `Deshabilitar servicio ${info.name} (era ${previousStartType})`,
      () => spawnCapture('sc.exe', ['config', info.name, 'start=', 'disabled']),
      { target: info.name, previousValue: previousStartType, newValue: 'disabled' },
    );
    if (configResult.simulated) continue;
    if (configResult.ok) {
      disabled++;
      writeLog(`  Deshabilitado: ${info.name}`);
      // El valor previo se copia a la fila, no se referencia: si el servicio
      // cambia despues, el manifiesto sigue diciendo como estaba al momento.
      manifest.push({
        name: info.name,
        displayName: info.displayName,
        binaryPath: info.binaryPath,
        previousStartType: START_TYPE_BY_CODE[info.startTypeCode] || 'auto',
        previousStartTypeLabel: info.startTypeLabel,
        disabledAt: new Date().toISOString(),
      });
    } else {
      errors++;
      writeLog(`  ERROR deshabilitando ${info.name}: ${errText(configResult)}`);
    }
  }

  if (!dryRun) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  writeLog(`Resumen: ${stopped} detenidos, ${disabled} deshabilitados, ${skipped} omitidos, ${errors} errores`);
  writeLog('=== Optimizacion de Servicios - fin ===');
}
