import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Gestor de Extensiones de Menú Contextual (Clic Derecho)
//
// Audita handlers registrados en el Explorador de Windows.
// Permite deshabilitar extensiones de terceros que ralentizan
// la apertura del menú de clic derecho.
// ═══════════════════════════════════════════════════════

const CONTEXT_LOCATIONS = [
  { key: 'HKCR\\*\\shellex\\ContextMenuHandlers', target: 'Archivos generales' },
  { key: 'HKCR\\Directory\\shellex\\ContextMenuHandlers', target: 'Carpetas' },
  { key: 'HKCR\\Directory\\Background\\shellex\\ContextMenuHandlers', target: 'Fondo del Explorador/Escritorio' },
  { key: 'HKCR\\Drive\\shellex\\ContextMenuHandlers', target: 'Unidades de disco' },
];

const MICROSOFT_BUILTINS = new Set([
  'workfolders',
  'sharing',
  'modernsharing',
  'epp',
  'wshopenwith',
  '{a2a9545d-a0c2-42b4-9708-a0b2badd77c8}',
  '{90aa3a4e-1c66-4382-acbc-29c343e01c5f}',
  '{a470f8cf-a1dd-4921-8339-e4524b55977d}',
  'briefcase',
  'offline files',
  'pin to start',
]);

export function isMicrosoftHandler(name, clsid = '') {
  const n = (name || '').toLowerCase().trim();
  const c = (clsid || '').toLowerCase().trim();
  return MICROSOFT_BUILTINS.has(n) || MICROSOFT_BUILTINS.has(c);
}

export function parseRegKeys(stdout) {
  if (!stdout || typeof stdout !== 'string') return [];
  const lines = stdout.trim().split(/\r?\n/);
  return lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith('HKEY_') || l.startsWith('HKCR\\'));
}

export async function runContextMenuScanNative(onOutput) {
  const paths = prepareReport('contextmenu');
  const { today, reportPath } = paths;

  onOutput('Escaneando handlers del menú contextual del Explorador de Windows...');
  const items = [];

  for (const loc of CONTEXT_LOCATIONS) {
    const r = await spawnCapture('reg', ['query', loc.key], 5000);
    if (r.code !== 0) continue;

    const subkeys = parseRegKeys(r.stdout);
    for (const sub of subkeys) {
      const parts = sub.split('\\');
      const name = parts[parts.length - 1];
      if (!name) continue;

      // Consultar el valor por defecto (CLSID o descripción)
      const q = await spawnCapture('reg', ['query', sub, '/ve'], 3000);
      let clsid = '';
      if (q.code === 0 && q.stdout) {
        const m = q.stdout.match(/REG_SZ\s+(.*)/);
        if (m) clsid = m[1].trim();
      }

      const isSystem = isMicrosoftHandler(name, clsid);
      const isBlocked = clsid.startsWith('-') || name.startsWith('_disabled');

      items.push({
        id: `${loc.key}\\${name}`,
        name,
        location: loc.target,
        regPath: sub,
        clsid,
        isSystem,
        isBlocked,
        recommendedDisable: !isSystem && !isBlocked,
      });
    }
  }

  const thirdPartyCount = items.filter((i) => !i.isSystem).length;
  const activeThirdParty = items.filter((i) => !i.isSystem && !i.isBlocked).length;

  const lines = [
    `# Reporte de Menú Contextual (Clic Derecho) - ${today}`, '',
    `## Handlers Detectados (${items.length} totales)`, '',
    `- **Extensiones de Terceros**: ${thirdPartyCount} (${activeThirdParty} activas)`,
    `- **Extensiones del Sistema**: ${items.length - thirdPartyCount}`,
    '',
    `## Lista de Extensiones de Terceros`, '',
  ];

  lines.push('```');
  items
    .filter((i) => !i.isSystem)
    .forEach((item, idx) => {
      const status = item.isBlocked ? '[DESACTIVADO]' : '[ACTIVO]';
      lines.push(`[${idx + 1}] ${status} ${item.name} (${item.location}) -> ${item.clsid || 'Sin CLSID'}`);
    });
  lines.push('```');
  lines.push('');

  finishReport(paths, lines, {
    date: today,
    reportPath,
    totalHandlers: items.length,
    thirdPartyCount,
    activeThirdParty,
  }, onOutput, items);
}

export async function runContextMenuActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('contextmenu', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('contextmenu', { dryRun, writeLog });

  const rawTargets = String(envVars.HANDLERS || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (rawTargets.length === 0) {
    const err = new Error('No se seleccionó ningún handler para deshabilitar.');
    err.statusCode = 400;
    throw err;
  }

  writeLog(`Iniciando optimización del menú contextual (Modo: ${dryRun ? 'SIMULACIÓN' : 'APLICAR'})...`);

  for (let i = 0; i < rawTargets.length; i++) {
    const targetKey = rawTargets[i];
    if (onProgress) onProgress(Math.round(((i + 1) / rawTargets.length) * 100));

    // Leer el valor actual
    const check = await spawnCapture('reg', ['query', targetKey, '/ve']);
    let currentClsid = '';
    if (check.code === 0 && check.stdout) {
      const m = check.stdout.match(/REG_SZ\s+(.*)/);
      if (m) currentClsid = m[1].trim();
    }

    if (!currentClsid || currentClsid.startsWith('-')) {
      writeLog(`- ${targetKey}: Ya está deshabilitado o no tiene CLSID.`);
      continue;
    }

    const disabledClsid = `-${currentClsid}`;
    const result = await guard(
      `Deshabilitar handler de menú: ${targetKey}`,
      () => spawnCapture('reg', ['add', targetKey, '/ve', '/t', 'REG_SZ', '/d', disabledClsid, '/f']),
      {
        target: `${targetKey}\\(Default)`,
        valueType: 'REG_SZ',
        newValue: disabledClsid,
        previousValue: currentClsid,
      },
    );

    if (result.simulated) continue;
    if (result.ok) {
      writeLog(`- ${targetKey}: Deshabilitado correctamente.`);
    } else {
      writeLog(`- Error deshabilitando ${targetKey}: ${errText(result)}`);
    }
  }

  writeLog('Optimización del menú contextual finalizada.');
}
