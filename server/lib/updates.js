import {
  spawnCapture, spawnCaptureShell, commandExists, padRight,
  makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Escaneo y Aplicación de Actualizaciones (updates.js)
//
// Detecta e instala actualizaciones de paquetes (winget, pip, npm, choco).
// Ejecuta las instalaciones secuencialmente con flags silenciosos
// para evitar superposición de diálogos UAC o instaladores concurrentes.
// ═══════════════════════════════════════════════════════

export async function checkWingetUpdates() {
  if (!(await commandExists('winget'))) {
    return { count: 0, error: false, items: [], block: 'winget no está disponible en este sistema.' };
  }
  const r = await spawnCapture('winget', [
    'upgrade', '--disable-interactivity', '--accept-source-agreements',
  ]);
  const lines = r.stdout.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^Name\s+Id\s+Version\s+Available/i.test(l));
  if (headerIdx < 0) {
    if (r.code !== 0 && !r.stdout.trim()) {
      return { count: 0, error: true, items: [], block: `Error al ejecutar winget: ${r.stderr || 'código ' + r.code}` };
    }
    return { count: 0, error: false, items: [], block: 'Todo actualizado.' };
  }

  const headerLine = lines[headerIdx];
  const idCol = headerLine.indexOf('Id');
  const verCol = headerLine.indexOf('Version');
  const availCol = headerLine.indexOf('Available');
  const sourceCol = headerLine.indexOf('Source');

  const tableLines = lines.slice(headerIdx).filter((l) => l.trim() !== '');
  const dataRows = tableLines.filter((l, i) => i !== 0 && !/^-+$/.test(l) && !/^\d+\s+upgrades? available/i.test(l) && !/have version numbers that cannot be determined/i.test(l));

  const items = [];
  for (const row of dataRows) {
    if (row.length < idCol) continue;
    const name = row.slice(0, idCol).trim();
    const id = (verCol > idCol ? row.slice(idCol, verCol) : row.slice(idCol)).trim();
    const version = (availCol > verCol ? row.slice(verCol, availCol) : '').trim();
    const available = (sourceCol > availCol ? row.slice(availCol, sourceCol) : row.slice(availCol)).trim();
    const source = sourceCol > -1 ? row.slice(sourceCol).trim() : 'winget';

    if (id && name) {
      items.push({
        id,
        name,
        manager: 'winget',
        currentVersion: version,
        availableVersion: available,
        source,
      });
    }
  }

  const count = items.length;
  const block = count === 0 ? 'Todo actualizado.' : '```\n' + [tableLines[0], ...dataRows].join('\n') + '\n```';
  return { count, error: false, items, block };
}

export async function checkPipUpdates() {
  if (!(await commandExists('pip'))) {
    return { count: 0, error: false, items: [], block: 'pip no está disponible en este sistema.' };
  }
  const r = await spawnCapture('pip', ['list', '--outdated', '--format=json']);
  try {
    const pkgs = JSON.parse(r.stdout || '[]');
    const count = pkgs.length;
    if (count === 0) return { count, error: false, items: [], block: 'Todos los paquetes pip están actualizados.' };
    const items = pkgs.map((p) => ({
      id: `pip:${p.name}`,
      name: p.name,
      manager: 'pip',
      currentVersion: p.version,
      availableVersion: p.latest_version,
      source: 'PyPI',
    }));
    const header = padRight('Package', 40) + padRight('Version', 12) + 'Latest';
    const rows = pkgs.map((p) => padRight(p.name, 40) + padRight(p.version, 12) + p.latest_version);
    return { count, error: false, items, block: '```\n' + header + '\n' + rows.join('\n') + '\n```' };
  } catch (err) {
    return { count: 0, error: true, items: [], block: `Error al ejecutar pip: ${err.message}` };
  }
}

export async function checkNpmUpdates() {
  if (!(await commandExists('npm'))) {
    return { count: 0, error: false, items: [], block: 'npm no está disponible en este sistema.' };
  }
  const r = await spawnCaptureShell('npm', ['outdated', '-g', '--json']);
  const text = (r.stdout || '').trim();
  if (!text || text === '{}') return { count: 0, error: false, items: [], block: 'Todos los paquetes npm globales están actualizados.' };
  try {
    const obj = JSON.parse(text);
    if (obj.error) return { count: 0, error: true, items: [], block: `Error al ejecutar npm: ${obj.error.summary || JSON.stringify(obj.error)}` };
    const names = Object.keys(obj);
    const count = names.length;
    if (count === 0) return { count, error: false, items: [], block: 'Todos los paquetes npm globales están actualizados.' };
    const items = names.map((n) => ({
      id: `npm:${n}`,
      name: n,
      manager: 'npm',
      currentVersion: obj[n].current,
      availableVersion: obj[n].latest,
      source: 'npm',
    }));
    const header = padRight('Package', 30) + padRight('Current', 12) + 'Latest';
    const rows = names.map((n) => padRight(n, 30) + padRight(obj[n].current, 12) + obj[n].latest);
    return { count, error: false, items, block: '```\n' + header + '\n' + rows.join('\n') + '\n```' };
  } catch (err) {
    return { count: 0, error: true, items: [], block: `Error al ejecutar npm: ${err.message}` };
  }
}

export async function checkChocoUpdates() {
  if (!(await commandExists('choco'))) {
    return { count: 0, error: false, items: [], block: 'Chocolatey no está instalado en este sistema.' };
  }
  const r = await spawnCapture('choco', ['outdated', '-r', '--no-color']);
  const lines = (r.stdout || '').split(/\r?\n/).filter((l) => l.includes('|'));
  const count = lines.length;
  if (count === 0) return { count, error: false, items: [], block: 'Todos los paquetes choco están actualizados.' };
  const items = lines.map((l) => {
    const parts = l.split('|');
    return {
      id: `choco:${parts[0]}`,
      name: parts[0],
      manager: 'choco',
      currentVersion: parts[1],
      availableVersion: parts[2] || '',
      source: 'Chocolatey',
    };
  });
  const rows = lines.map((l) => {
    const parts = l.split('|');
    return padRight(parts[0], 30) + padRight(parts[1], 12) + (parts[2] || '');
  });
  const header = padRight('Package', 30) + padRight('Current', 12) + 'Available';
  return { count, error: false, items, block: '```\n' + header + '\n' + rows.join('\n') + '\n```' };
}

export async function runUpdatesScanNative(onOutput, onProgress) {
  const paths = prepareReport('updates');
  const { today, reportPath } = paths;

  const gestores = [
    ['winget', checkWingetUpdates],
    ['pip', checkPipUpdates],
    ['npm', checkNpmUpdates],
    ['choco', checkChocoUpdates],
  ];

  onOutput('Auditando actualizaciones en gestores de paquetes (winget, pip, npm, choco)...');
  let completed = 0;
  const entries = await Promise.all(
    gestores.map(async ([nombre, check]) => {
      onOutput(`Consultando ${nombre}...`);
      const result = await check();
      completed++;
      onProgress?.({
        current: completed,
        total: gestores.length,
        percentage: Math.round((completed / gestores.length) * 100),
      });
      return [nombre, result];
    }),
  );

  const resultados = Object.fromEntries(entries);
  const { winget, pip, npm, choco } = resultados;

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

  const allItems = [
    ...(winget.items || []),
    ...(pip.items || []),
    ...(npm.items || []),
    ...(choco.items || []),
  ];

  finishReport(paths, lines, {
    date: today,
    reportPath,
    winget: { count: winget.count, error: winget.error },
    pip: { count: pip.count, error: pip.error },
    npm: { count: npm.count, error: npm.error },
    choco: { count: choco.count, error: choco.error },
    total: allItems.length,
  }, onOutput, allItems);
}

/** Instala actualizaciones seleccionadas de forma secuencial y silenciosa. */
export async function runUpdatesActionNative(arg1, arg2, arg3) {
  let envVars = {};
  let onOutput = () => {};
  let onProgress = null;

  if (typeof arg1 === 'object' && arg1 !== null) {
    envVars = arg1;
    if (typeof arg2 === 'function') onOutput = arg2;
    if (typeof arg3 === 'function') onProgress = arg3;
  } else if (typeof arg1 === 'function') {
    onOutput = arg1;
    if (typeof arg2 === 'function') onProgress = arg2;
  }

  const writeLog = makeLogger('updates', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('updates', { dryRun, writeLog });

  const rawPackages = String(envVars.PACKAGES || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const selectedSet = rawPackages.length > 0 ? new Set(rawPackages) : null;

  writeLog(`=== Aplicar actualizaciones - inicio (Modo: ${dryRun ? 'SIMULACIÓN (dryRun)' : 'REAL'}) ===`);

  let targetItems = [];
  if (selectedSet) {
    targetItems = Array.from(selectedSet).map((id) => {
      if (id.startsWith('pip:')) return { id, name: id.slice(4), manager: 'pip' };
      if (id.startsWith('npm:')) return { id, name: id.slice(4), manager: 'npm' };
      if (id.startsWith('choco:')) return { id, name: id.slice(6), manager: 'choco' };
      return { id, name: id, manager: 'winget' };
    });
  } else {
    onOutput('Consultando catálogo de actualizaciones pendientes...');
    const [w, p, n, c] = await Promise.all([
      checkWingetUpdates(), checkPipUpdates(), checkNpmUpdates(), checkChocoUpdates(),
    ]);
    targetItems = [...(w.items || []), ...(p.items || []), ...(n.items || []), ...(c.items || [])];
  }

  if (targetItems.length === 0) {
    writeLog('No hay actualizaciones seleccionadas o pendientes.');
    if (onProgress) onProgress({ percent: 100, message: 'Todo actualizado' });
    return { ok: true, dryRun, results: [] };
  }

  writeLog(`Se procesarán ${targetItems.length} actualizaciones secuencialmente:`);
  const results = [];

  for (let i = 0; i < targetItems.length; i++) {
    const item = targetItems[i];
    const progressPct = Math.round(((i) / targetItems.length) * 100);
    if (onProgress) {
      onProgress({
        percent: progressPct,
        message: `[${i + 1}/${targetItems.length}] Actualizando ${item.name}...`,
      });
    }

    writeLog(`\n[${i + 1}/${targetItems.length}] Actualizando ${item.name} (${item.manager.toUpperCase()})...`);

    try {
      if (item.manager === 'winget') {
        const res = await guard(
          `Actualizar paquete ${item.name} (${item.id}) via winget`,
          async () => {
            const rSilent = await spawnCapture('winget', [
              'upgrade', '--id', item.id, '--exact',
              '--silent', '--disable-interactivity',
              '--accept-source-agreements', '--accept-package-agreements',
            ]);
            if (rSilent.code === 0) return rSilent;

            if (rSilent.stderr && rSilent.stderr.includes('silent')) {
              writeLog(`  [Aviso] El instalador de ${item.name} no soporta --silent. Reintentando...`);
              return spawnCapture('winget', [
                'upgrade', '--id', item.id, '--exact',
                '--disable-interactivity',
                '--accept-source-agreements', '--accept-package-agreements',
              ]);
            }
            return rSilent;
          },
          { target: item.id, action: 'UPGRADE_WINGET' },
        );

        if (res.result?.code === 0 || dryRun) {
          writeLog(`  ✓ ${item.name} actualizado con éxito.`);
          results.push({ item: item.id, ok: true });
        } else {
          const errMsg = (res.result?.stderr || res.result?.stdout || '').trim();
          writeLog(`  ⚠ Falló la actualización de ${item.name} (código ${res.result?.code}): ${errMsg.slice(0, 200)}`);
          results.push({ item: item.id, ok: false, error: errMsg });
        }
      } else if (item.manager === 'pip') {
        const res = await guard(
          `Actualizar paquete Python ${item.name} via pip`,
          () => spawnCapture('pip', ['install', '-U', item.name]),
          { target: item.name, action: 'UPGRADE_PIP' },
        );
        if (res.result?.code === 0 || dryRun) {
          writeLog(`  ✓ Paquete pip ${item.name} actualizado.`);
          results.push({ item: item.id, ok: true });
        } else {
          writeLog(`  ⚠ Falló la actualización de pip ${item.name}.`);
          results.push({ item: item.id, ok: false });
        }
      } else if (item.manager === 'npm') {
        const res = await guard(
          `Actualizar paquete global npm ${item.name}`,
          () => spawnCaptureShell('npm', ['update', '-g', item.name]),
          { target: item.name, action: 'UPGRADE_NPM' },
        );
        if (res.result?.code === 0 || dryRun) {
          writeLog(`  ✓ Paquete npm ${item.name} actualizado.`);
          results.push({ item: item.id, ok: true });
        } else {
          writeLog(`  ⚠ Falló la actualización de npm ${item.name}.`);
          results.push({ item: item.id, ok: false });
        }
      } else if (item.manager === 'choco') {
        const res = await guard(
          `Actualizar paquete Chocolatey ${item.name}`,
          () => spawnCapture('choco', ['upgrade', item.name, '-y', '--no-color']),
          { target: item.name, action: 'UPGRADE_CHOCO' },
        );
        if (res.result?.code === 0 || dryRun) {
          writeLog(`  ✓ Paquete Chocolatey ${item.name} actualizado.`);
          results.push({ item: item.id, ok: true });
        } else {
          writeLog(`  ⚠ Falló la actualización de Chocolatey ${item.name}.`);
          results.push({ item: item.id, ok: false });
        }
      }
    } catch (err) {
      writeLog(`  ⚠ Error al procesar ${item.name}: ${err.message}`);
      results.push({ item: item.id, ok: false, error: err.message });
    }
  }

  if (onProgress) onProgress({ percent: 100, message: 'Actualizaciones finalizadas' });
  writeLog('\n=== Aplicar actualizaciones - fin ===');
  return { ok: results.every((r) => r.ok), dryRun, results };
}
