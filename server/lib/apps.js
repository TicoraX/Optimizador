import {
  spawnCapture, makeLogger, prepareReport, finishReport, errText,
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
  }, onOutput);
}

export async function runAppsActionNative(envVars, onOutput) {
  const writeLog = makeLogger('apps', onOutput);

  writeLog('=== Desinstalacion de aplicaciones - inicio ===');

  const selection = envVars.OPTIMIZE_APPS || '';
  const ids = selection.split(',').map((s) => s.trim()).filter(Boolean);

  if (ids.length === 0) {
    writeLog('No se seleccionaron aplicaciones para desinstalar.');
    writeLog('=== Desinstalacion de aplicaciones - fin ===');
    return;
  }

  let uninstalled = 0, errors = 0;

  for (const id of ids) {
    writeLog(`Desinstalando: ${id}...`);
    const ur = await spawnCapture('winget', ['uninstall', '--id', id, '--silent', '--accept-source-agreements']);
    if (ur.code === 0) {
      uninstalled++;
      writeLog(`  Desinstalado: ${id}`);
    } else {
      errors++;
      writeLog(`  ERROR desinstalando ${id}: ${errText(ur)}`);
    }
  }

  writeLog(`Resumen: ${uninstalled} desinstalados, ${errors} errores`);
  writeLog('=== Desinstalacion de aplicaciones - fin ===');
}
