import { existsSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { MODULES, spawnCapture, spawnCaptureShell, commandExists, padRight } from './shared.js';

// ═══════════════════════════════════════════════════════
// Escaneo de actualizaciones — ejecucion nativa en Node (sin powershell.exe)
//
// Mismo bug critico documentado en shared.js: en vez de invocar Check-Updates.ps1,
// se invocan winget/pip/npm/choco directamente, sin PowerShell de por medio.
// ═══════════════════════════════════════════════════════

async function checkWingetUpdates() {
  if (!(await commandExists('winget'))) {
    return { count: 0, error: false, block: 'winget no esta disponible en este sistema.' };
  }
  const r = await spawnCapture('winget', ['upgrade', '--include-unknown', '--disable-interactivity', '--accept-source-agreements']);
  const lines = r.stdout.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^Name\s+Id\s+Version\s+Available/.test(l));
  if (headerIdx < 0) {
    if (r.code !== 0 && !r.stdout.trim()) {
      return { count: 0, error: true, block: `Error al ejecutar winget: ${r.stderr || 'codigo ' + r.code}` };
    }
    return { count: 0, error: false, block: 'Todo actualizado.' };
  }
  const tableLines = lines.slice(headerIdx).filter((l) => l.trim() !== '');
  const dataRows = tableLines.filter((l, i) => i !== 0 && !/^-+$/.test(l) && !/^\d+\s+upgrades? available/i.test(l));
  const count = dataRows.length;
  const block = count === 0 ? 'Todo actualizado.' : '```\n' + [tableLines[0], ...dataRows].join('\n') + '\n```';
  return { count, error: false, block };
}

async function checkPipUpdates() {
  if (!(await commandExists('pip'))) {
    return { count: 0, error: false, block: 'pip no esta disponible en este sistema.' };
  }
  const r = await spawnCapture('pip', ['list', '--outdated', '--format=json']);
  try {
    const pkgs = JSON.parse(r.stdout || '[]');
    const count = pkgs.length;
    if (count === 0) return { count, error: false, block: 'Todos los paquetes pip estan actualizados.' };
    const header = padRight('Package', 40) + padRight('Version', 12) + 'Latest';
    const rows = pkgs.map((p) => padRight(p.name, 40) + padRight(p.version, 12) + p.latest_version);
    return { count, error: false, block: '```\n' + header + '\n' + rows.join('\n') + '\n```' };
  } catch (err) {
    return { count: 0, error: true, block: `Error al ejecutar pip: ${err.message}` };
  }
}

async function checkNpmUpdates() {
  if (!(await commandExists('npm'))) {
    return { count: 0, error: false, block: 'npm no esta disponible en este sistema.' };
  }
  const r = await spawnCaptureShell('npm', ['outdated', '-g', '--json']);
  const text = (r.stdout || '').trim();
  if (!text || text === '{}') return { count: 0, error: false, block: 'Todos los paquetes npm globales estan actualizados.' };
  try {
    const obj = JSON.parse(text);
    if (obj.error) return { count: 0, error: true, block: `Error al ejecutar npm: ${obj.error.summary || JSON.stringify(obj.error)}` };
    const names = Object.keys(obj);
    const count = names.length;
    if (count === 0) return { count, error: false, block: 'Todos los paquetes npm globales estan actualizados.' };
    const header = padRight('Package', 30) + padRight('Current', 12) + 'Latest';
    const rows = names.map((n) => padRight(n, 30) + padRight(obj[n].current, 12) + obj[n].latest);
    return { count, error: false, block: '```\n' + header + '\n' + rows.join('\n') + '\n```' };
  } catch (err) {
    return { count: 0, error: true, block: `Error al ejecutar npm: ${err.message}` };
  }
}

async function checkChocoUpdates() {
  if (!(await commandExists('choco'))) {
    return { count: 0, error: false, block: 'Chocolatey no esta instalado en este sistema.' };
  }
  const r = await spawnCapture('choco', ['outdated', '-r', '--no-color']);
  const lines = (r.stdout || '').split(/\r?\n/).filter((l) => l.includes('|'));
  const count = lines.length;
  if (count === 0) return { count, error: false, block: 'Todos los paquetes choco estan actualizados.' };
  const rows = lines.map((l) => {
    const parts = l.split('|');
    return padRight(parts[0], 30) + padRight(parts[1], 12) + (parts[2] || '');
  });
  const header = padRight('Package', 30) + padRight('Current', 12) + 'Available';
  return { count, error: false, block: '```\n' + header + '\n' + rows.join('\n') + '\n```' };
}

export async function runUpdatesScanNative(onOutput) {
  const reportsDir = join(MODULES.updates.dir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportsDir, `update-report-${today}.md`);
  const countsPath = join(reportsDir, 'update-counts.json');

  onOutput('Revisando winget...');
  const winget = await checkWingetUpdates();
  onOutput('Revisando pip...');
  const pip = await checkPipUpdates();
  onOutput('Revisando npm...');
  const npm = await checkNpmUpdates();
  onOutput('Revisando choco...');
  const choco = await checkChocoUpdates();

  const fmt = (label, r) => (r.error ? `- ${label}: error (ver detalle abajo)` : `- ${label}: ${r.count} disponibles`);

  const lines = [
    `# Reporte de actualizaciones - ${today}`, '',
    '## Resumen', '',
    fmt('Winget', winget), fmt('Pip', pip), fmt('npm', npm), fmt('Choco', choco), '',
    '## Winget (apps y drivers)', '', winget.block, '',
    '## Python (pip)', '', pip.block, '',
    '## npm (paquetes globales)', '', npm.block, '',
    '## Chocolatey', '', choco.block, '',
  ];

  writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8');
  writeFileSync(countsPath, JSON.stringify({
    date: today,
    reportPath,
    winget: { count: winget.count, error: winget.error },
    pip: { count: pip.count, error: pip.error },
    npm: { count: npm.count, error: npm.error },
    choco: { count: choco.count, error: choco.error },
  }, null, 2), 'utf-8');

  onOutput(`Reporte generado en: ${reportPath}`);
  onOutput(`Conteos generados en: ${countsPath}`);
}

/** Instala lo detectado por el scan: winget/pip/npm/choco directo, sin PowerShell. */
export async function runUpdatesActionNative(onOutput) {
  const logDir = join(MODULES.updates.dir, 'reports');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, MODULES.updates.logFile);

  const writeLog = (message) => {
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const line = `[${stamp}] ${message}`;
    appendFileSync(logPath, line + '\n');
    onOutput(line);
  };

  writeLog('=== Aplicar actualizaciones - inicio ===');

  if (await commandExists('winget')) {
    onOutput('Ejecutando winget upgrade --all...');
    const r = await spawnCapture('winget', [
      'upgrade', '--all', '--include-unknown', '--disable-interactivity',
      '--accept-source-agreements', '--accept-package-agreements',
    ]);
    writeLog(r.code === 0 ? 'winget upgrade --all completado.' : `winget upgrade fallo (codigo ${r.code}): ${(r.stderr || r.stdout).slice(0, 300)}`);
  } else {
    writeLog('winget no disponible, se omite.');
  }

  if (await commandExists('pip')) {
    const listResult = await spawnCapture('pip', ['list', '--outdated', '--format=json']);
    try {
      const outdated = JSON.parse(listResult.stdout || '[]');
      if (outdated.length === 0) {
        writeLog('No hay paquetes pip desactualizados.');
      } else {
        const ok = [];
        const failed = [];
        for (const pkg of outdated) {
          onOutput(`Instalando ${pkg.name}...`);
          const r = await spawnCapture('pip', ['install', '-U', pkg.name]);
          (r.code === 0 ? ok : failed).push(pkg.name);
        }
        writeLog(`pip install -U OK: ${ok.join(', ') || '(ninguno)'}`);
        if (failed.length > 0) writeLog(`pip install -U FALLO en: ${failed.join(', ')}`);
      }
    } catch (err) {
      writeLog(`pip update fallo: ${err.message}`);
    }
  } else {
    writeLog('pip no disponible, se omite.');
  }

  if (await commandExists('npm')) {
    onOutput('Ejecutando npm update -g...');
    const r = await spawnCaptureShell('npm', ['update', '-g']);
    writeLog(r.code === 0 ? 'npm update -g completado.' : `npm update fallo (codigo ${r.code}).`);
  } else {
    writeLog('npm no disponible, se omite.');
  }

  if (await commandExists('choco')) {
    onOutput('Ejecutando choco upgrade all...');
    const r = await spawnCapture('choco', ['upgrade', 'all', '-y', '--no-color']);
    writeLog(r.code === 0 ? 'choco upgrade all completado.' : `choco upgrade fallo (codigo ${r.code}).`);
  } else {
    writeLog('Chocolatey no disponible, se omite.');
  }

  writeLog('=== Aplicar actualizaciones - fin ===');
}
