import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

function parseWingetList(stdout) {
  const apps = [];
  let started = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (!started) {
      if (line.startsWith('---')) { started = true; }
      continue;
    }
    if (!line.trim()) continue;
    const parts = line.split(/\s{2,}/).map((s) => s.trim());
    if (parts.length < 3) continue;
    apps.push({
      name: parts[0],
      id: parts[1],
      version: parts[2] || '',
      source: parts.length >= 4 ? parts[parts.length - 1] : '',
    });
  }
  return apps;
}

export async function runAppsScanNative(onOutput) {
  const paths = prepareReport('apps');
  const { today, reportPath } = paths;

  let scanError = false;
  onOutput('Listando aplicaciones instaladas (winget)...');
  const r = await spawnCapture('winget', ['list', '--accept-source-agreements']);
  const apps = r.code === 0 ? parseWingetList(r.stdout) : [];
  if (r.code !== 0) scanError = true;

  const lines = [
    `# Reporte de Aplicaciones - ${today}`, '',
    `## Aplicaciones Instaladas (${apps.length})`, '',
  ];

  if (apps.length > 0) {
    lines.push('```');
    apps.forEach((a, i) => {
      lines.push(`[${i + 1}] ${a.name} -- ${a.id} -- ${a.version} -- ${a.source}`);
    });
    lines.push('```');
  } else {
    lines.push('No se pudieron obtener aplicaciones via winget.');
  }
  lines.push('');

  lines.push('## Resumen', '');
  lines.push(`- Total: ${apps.length}`);
  lines.push('');

  finishReport(paths, lines, {
    date: today, reportPath,
    apps_count: apps.length,
    error: scanError,
  }, onOutput,
  // `protected` viaja calculado: el frontend no deberia reimplementar la
  // lista de paquetes criticos para poder deshabilitar el checkbox.
  apps.map((a) => ({
    id: a.id, name: a.name, version: a.version, source: a.source,
    protected: isProtectedApp(a.id),
  })));
}

// Paquetes que NUNCA se desinstalan desde aca. Desinstalar un runtime o un
// driver no rompe "una app": rompe todo lo que depende de el, y winget lo hace
// en silencio con --silent. Se comparan en minusculas contra el ID de winget.
//
// La lista es deliberadamente conservadora: ante la duda, se omite. Desinstalar
// esto sigue siendo posible desde el propio Windows, que si avisa.
const PROTECTED_APP_PATTERNS = [
  'microsoft.vclibs', 'microsoft.vcredist', 'microsoft.visualcpp',
  'microsoft.dotnet', 'microsoft.netframework', 'microsoft.aspnetcore',
  'microsoft.windowsappruntime', 'microsoft.ui.xaml', 'microsoft.winget',
  'microsoft.desktopappinstaller', 'microsoft.edgewebview',
  'microsoft.powershell', 'microsoft.windowsterminal',
  'nvidia.', 'intel.', 'amd.', 'realtek.',
  'microsoft.windows', 'microsoft.storeexperiencehost',
];

/** Un paquete esta protegido si su ID empieza con o contiene un patron de la lista. */
export function isProtectedApp(id) {
  const s = String(id || '').toLowerCase();
  if (!s) return true;
  return PROTECTED_APP_PATTERNS.some((p) => s.includes(p));
}

export async function runAppsActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('apps', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('apps', { dryRun, writeLog });

  writeLog(`=== Desinstalacion de aplicaciones - inicio${dryRun ? ' (SIMULACION)' : ''} ===`);

  const selection = envVars.OPTIMIZE_APPS || envVars.ITEMS || envVars.APPS || '';
  const ids = selection.split(',').map((s) => s.trim()).filter(Boolean);

  if (ids.length === 0) {
    writeLog('No se seleccionaron aplicaciones para desinstalar.');
    writeLog('=== Desinstalacion de aplicaciones - fin ===');
    return;
  }

  let uninstalled = 0, errors = 0, skipped = 0;

  for (const [i, id] of ids.entries()) {
    // Desinstalar varias apps con winget tarda minutos; sin esto la unica
    // senial de avance eran las lineas del log.
    onProgress?.({
      current: i + 1,
      total: ids.length,
      percentage: Math.round(((i + 1) / ids.length) * 100),
    });

    if (isProtectedApp(id)) {
      skipped++;
      writeLog(`OMITIDO (paquete protegido del sistema): ${id}`);
      continue;
    }

    writeLog(`Desinstalando: ${id}...`);
    const r = await guard(
      `Desinstalar ${id}`,
      () => spawnCapture('winget', ['uninstall', '--id', id, '--silent', '--accept-source-agreements']),
      // Sin previousValue: desinstalar no se puede deshacer desde la app.
      { target: id },
    );
    if (r.simulated) continue;
    if (r.ok) {
      uninstalled++;
      writeLog(`  Desinstalado: ${id}`);
    } else {
      errors++;
      writeLog(`  ERROR desinstalando ${id}: ${errText(r)}`);
    }
  }

  writeLog(
    dryRun
      ? `Simulacion: ${ids.length - skipped} se desinstalarian, ${skipped} omitidos por proteccion`
      : `Resumen: ${uninstalled} desinstalados, ${skipped} omitidos por proteccion, ${errors} errores`,
  );
  writeLog('=== Desinstalacion de aplicaciones - fin ===');
}
