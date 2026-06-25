import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { MODULES, spawnCapture } from './shared.js';

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
  const reportsDir = join(MODULES.apps.dir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportsDir, `apps-report-${today}.md`);
  const countsPath = join(reportsDir, 'apps-counts.json');

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

  writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8');
  writeFileSync(countsPath, JSON.stringify({
    date: today, reportPath,
    apps_count: apps.length,
    error: scanError,
  }, null, 2), 'utf-8');

  onOutput(`Reporte generado en: ${reportPath}`);
}

export async function runAppsActionNative(envVars, onOutput) {
  const logDir = join(MODULES.apps.dir, 'reports');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, 'optimize-log.txt');

  const writeLog = (message) => {
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const line = `[${stamp}] ${message.replace(/[\r\n]/g, ' ')}`;
    appendFileSync(logPath, line + '\n');
    onOutput(line);
  };

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
      writeLog(`  ERROR desinstalando ${id}: ${(ur.stderr || ur.stdout || '').trim().slice(0, 200)}`);
    }
  }

  writeLog(`Resumen: ${uninstalled} desinstalados, ${errors} errores`);
  writeLog('=== Desinstalacion de aplicaciones - fin ===');
}
