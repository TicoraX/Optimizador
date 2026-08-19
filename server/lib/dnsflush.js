import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Monitor y Limpiador de Caché DNS y Pila de Red (dnsflush)
//
// Audita las entradas cacheadas por el cliente DNS de Windows,
// purga registros corruptos/expirados y refresca NetBIOS y WINS.
// ═══════════════════════════════════════════════════════

export const DNS_ACTIONS = [
  {
    id: 'flushdns',
    name: 'Vaciar Caché de Resolución DNS (ipconfig /flushdns)',
    desc: 'Elimina registros IP obsoletos o secuestrados de la memoria del sistema.',
    cmd: ['ipconfig', '/flushdns'],
    recommended: true,
  },
  {
    id: 'registerdns',
    name: 'Renovar y Registrar Nombres DNS (ipconfig /registerdns)',
    desc: 'Fuerza el registro y actualización del nombre del equipo en el servidor DNS/DHCP.',
    cmd: ['ipconfig', '/registerdns'],
    recommended: true,
  },
  {
    id: 'purgenbtstat',
    name: 'Purgar Tabla de Nombres NetBIOS (nbtstat -R)',
    desc: 'Limpia nombres de dispositivos locales cacheados en la red LAN.',
    cmd: ['nbtstat', '-R'],
    recommended: true,
  },
  {
    id: 'releasewins',
    name: 'Refrescar Registro de Nombres NetBIOS (nbtstat -RR)',
    desc: 'Libera y re-registra nombres NetBIOS para prevenir conflictos de IP en red local.',
    cmd: ['nbtstat', '-RR'],
    recommended: false,
  },
];

export function parseDisplayDns(stdout) {
  if (!stdout || typeof stdout !== 'string') return [];
  const records = [];
  const lines = stdout.split(/\r?\n/);

  let currentRecord = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('---')) continue;

    const parts = line.split(':');
    if (parts.length < 2) continue;

    const key = parts[0].trim().toLowerCase().replace(/[^a-z]/g, '');
    const val = parts.slice(1).join(':').trim();

    if (key.includes('nombrederegistro') || key.includes('recordname')) {
      if (currentRecord && currentRecord.name) {
        records.push(currentRecord);
      }
      currentRecord = { name: val, type: '', ttl: '', data: '' };
    } else if (currentRecord) {
      if (key.includes('tipoderegistro') || key.includes('recordtype')) {
        currentRecord.type = val;
      } else if (key.includes('tiempodevida') || key.includes('timetolive') || key.includes('ttl')) {
        currentRecord.ttl = val;
      } else if (key.includes('registro') || key.includes('data') || key.includes('seccin') || key.includes('section')) {
        if (!currentRecord.data && val) {
          currentRecord.data = val;
        }
      }
    }
  }

  if (currentRecord && currentRecord.name) {
    records.push(currentRecord);
  }

  return records;
}

export async function runDnsFlushScanNative(onOutput) {
  const paths = prepareReport('dnsflush');
  const { today, reportPath } = paths;

  onOutput('Consultando entradas en la caché DNS del sistema con ipconfig /displaydns...');
  const r = await spawnCapture('ipconfig', ['/displaydns'], 10000);

  const entries = r.code === 0 ? parseDisplayDns(r.stdout) : [];

  const lines = [
    `# Reporte de Caché DNS y Pila de Red - ${today}`, '',
    `## Resumen de Resolución DNS`, '',
    `- **Registros DNS en Memoria**: ${entries.length}`,
    `- **Acciones Recomendadas**: ${DNS_ACTIONS.filter((a) => a.recommended).length}`,
    '',
    `## Acciones Disponibles`, '',
  ];

  lines.push('```');
  DNS_ACTIONS.forEach((act, idx) => {
    lines.push(`[${idx + 1}] ${act.name}`);
    lines.push(`     ${act.desc}`);
    lines.push(`     Comando: ${act.cmd.join(' ')}`);
    lines.push('');
  });
  lines.push('```');
  lines.push('');

  if (entries.length > 0) {
    lines.push('## Muestra de Dominios Cacheados', '', '```');
    entries.slice(0, 25).forEach((e) => {
      lines.push(`- ${e.name} (TTL: ${e.ttl || 'N/A'})`);
    });
    if (entries.length > 25) {
      lines.push(`... y ${entries.length - 25} dominios más.`);
    }
    lines.push('```', '');
  }

  finishReport(paths, lines, {
    date: today,
    reportPath,
    cachedCount: entries.length,
    totalActions: DNS_ACTIONS.length,
  }, onOutput, DNS_ACTIONS);
}

export async function runDnsFlushActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('dnsflush', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('dnsflush', { dryRun, writeLog });

  const chosenIds = String(envVars.ACTIONS || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (chosenIds.length === 0) {
    const err = new Error('No se seleccionó ninguna acción de refresco de red para ejecutar.');
    err.statusCode = 400;
    throw err;
  }

  writeLog(`Iniciando refresco y purga de caché DNS / NetBIOS (Modo: ${dryRun ? 'SIMULACIÓN' : 'APLICAR'})...`);

  for (let i = 0; i < chosenIds.length; i++) {
    const id = chosenIds[i];
    if (onProgress) onProgress(Math.round(((i + 1) / chosenIds.length) * 100));

    const act = DNS_ACTIONS.find((a) => a.id === id);
    if (!act) {
      writeLog(`- Omitiendo acción desconocida: ${id}`);
      continue;
    }

    const result = await guard(
      `Ejecutar ${act.name}`,
      () => spawnCapture(act.cmd[0], act.cmd.slice(1)),
      {
        target: `Network\\${act.id}`,
        irreversible: true,
      },
    );

    if (result.simulated) continue;
    if (result.ok) {
      writeLog(`- ${act.name}: Completado con éxito.`);
    } else {
      writeLog(`- Error en ${act.name}: ${errText(result)}`);
    }
  }

  writeLog('Refresco de pila DNS finalizado.');
}
