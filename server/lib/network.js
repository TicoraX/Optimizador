import {
  spawnCapture, isAdminWindows, makeLogger, prepareReport, finishReport, errText,
} from './shared.js';

export async function runNetworkScanNative(onOutput) {
  const paths = prepareReport('network');
  const { today, reportPath } = paths;

  let scanError = false;
  onOutput('Obteniendo cache DNS...');
  let dnsEntries = 0;
  const dnsResult = await spawnCapture('ipconfig', ['/displaydns']);
  if (dnsResult.code === 0) {
    dnsEntries = dnsResult.stdout.split(/\r?\n/).filter((l) => /^\s+(?:Nombre|Name)\s+\./.test(l)).length;
  } else { scanError = true; }

  onOutput('Probando conectividad...');
  let avgPingMs = null, packetLoss = 0;
  const pingResult = await spawnCapture('ping', ['-n', '4', '8.8.8.8']);
  if (pingResult.code === 0) {
    const avgMatch = pingResult.stdout.match(/(?:Promedio|Average|Moyenne|Durchschnitt|M.dia)\s*=\s*(\d+)/);
    if (avgMatch) avgPingMs = parseInt(avgMatch[1], 10);
    const lossMatch = pingResult.stdout.match(/(\d+)%\s*(?:perdido|loss|verlust|perte|perda)/);
    if (lossMatch) packetLoss = parseInt(lossMatch[1], 10);
  } else {
    scanError = true;
  }

  onOutput('Listando adaptadores...');
  let activeAdapters = 0, disconnectedAdapters = 0;
  const ipResult = await spawnCapture('ipconfig', []);
  if (ipResult.code === 0) {
    const lines = ipResult.stdout.split(/\r?\n/);
    let currentDisconnected = false, inAdapter = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isHeader = /^[A-Za-z]/.test(line) && !line.startsWith(' ') && !line.startsWith('\t');
      if (isHeader) {
        if (inAdapter) {
          if (currentDisconnected) disconnectedAdapters++; else activeAdapters++;
        }
        inAdapter = true;
        currentDisconnected = false;
      } else if (inAdapter && (line.includes('desconectado') || line.includes('disconnected'))) {
        currentDisconnected = true;
      }
    }
    if (inAdapter) {
      if (currentDisconnected) disconnectedAdapters++; else activeAdapters++;
    }
  }

  const fmtMs = (v) => v !== null ? `${v} ms` : 'N/A';

  const lines = [
    `# Reporte de Red - ${today}`, '',
    '## Resumen de conectividad', '',
    `- Caché DNS: ${dnsEntries} entradas`,
    `- Ping a 8.8.8.8: ${fmtMs(avgPingMs)}`,
    `- Pérdida de paquetes: ${packetLoss}%`, '',
    '## Adaptadores de red', '',
    `- Activos: ${activeAdapters}`,
    `- Desconectados: ${disconnectedAdapters}`,
    `- Total: ${activeAdapters + disconnectedAdapters}`, '',
  ];

  finishReport(paths, lines, {
    date: today, reportPath,
    dns_cache_entries: dnsEntries,
    avg_ping_ms: avgPingMs,
    packet_loss: packetLoss,
    active_adapters: activeAdapters,
    disconnected_adapters: disconnectedAdapters,
    error: scanError,
  }, onOutput);
}

export async function runNetworkActionNative(_envVars, onOutput) {
  const writeLog = makeLogger('network', onOutput);

  writeLog('=== Optimizacion de Red - inicio ===');

  writeLog('Limpiando cache DNS...');
  const flushResult = await spawnCapture('ipconfig', ['/flushdns']);
  if (flushResult.code === 0) {
    writeLog('Cache DNS limpiada exitosamente.');
  } else {
    writeLog(`ERROR limpiando cache DNS: ${errText(flushResult)}`);
  }

  const isAdmin = await isAdminWindows();
  if (isAdmin) {
    writeLog('Re-registrando DNS...');
    const regResult = await spawnCapture('ipconfig', ['/registerdns']);
    if (regResult.code === 0) {
      writeLog('DNS re-registrado exitosamente.');
    } else {
      writeLog(`ERROR re-registrando DNS: ${errText(regResult)}`);
    }
  } else {
    writeLog('Omitiendo re-registro DNS (requiere administrador).');
  }

  writeLog('=== Optimizacion de Red - fin ===');
}
