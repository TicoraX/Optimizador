import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Auditor y Optimizador de Servicios OEM (Fabricantes)
//
// Identifica servicios secundarios de fabricantes (Dell, HP,
// Lenovo, ASUS, Razer, Corsair, etc.) que consumen recursos
// y telemetría, permitiendo cambiarlos a inicio manual o desactivarlos.
// ═══════════════════════════════════════════════════════

export const OEM_SIGNATURES = [
  // Dell
  { id: 'dell_supportassist', oem: 'Dell', name: 'Dell SupportAssist', serviceNames: ['supportassistagent', 'dellsupportassist', 'ddvdatacollector'], desc: 'Telemetría y soporte en segundo plano de Dell.' },
  { id: 'dell_optimizer', oem: 'Dell', name: 'Dell Optimizer Core', serviceNames: ['delloptimizerservice', 'dellclientmanagement'], desc: 'Servicio de telemetría y perfiles de Dell.' },
  // HP
  { id: 'hp_analytics', oem: 'HP', name: 'HP Analytics & Touchpoint', serviceNames: ['hptouchpointanalytics', 'hpanalyticsservice', 'hpapphelpercap'], desc: 'Recolección de telemetría y diagnósticos de HP.' },
  { id: 'hp_network', oem: 'HP', name: 'HP Network Optimizer Cap', serviceNames: ['hpnetworkcap', 'hpcommrecovery'], desc: 'Gestor de conectividad en segundo plano de HP.' },
  // Lenovo
  { id: 'lenovo_vantage', oem: 'Lenovo', name: 'Lenovo Vantage / System Interface', serviceNames: ['imcontrollerservice', 'lenovovantageservice'], desc: 'Interfaz de telemetría y servicios de Lenovo.' },
  // ASUS
  { id: 'asus_armoury', oem: 'ASUS', name: 'ASUS Armoury Crate Services', serviceNames: ['armourycratecontrolinterface', 'asusroglslservice', 'asussoftwaremanager', 'asuslinknear'], desc: 'Servicios de iluminación y telemetría de ASUS.' },
  // Razer
  { id: 'razer_synapse', oem: 'Razer', name: 'Razer Synapse Background Services', serviceNames: ['razersynapseservice', 'razercentralservice', 'razerchromastreaming'], desc: 'Servicios de sincronización y telemetría de periféricos Razer.' },
  // Corsair
  { id: 'corsair_icue', oem: 'Corsair', name: 'Corsair iCUE Services', serviceNames: ['corsairservice', 'corsairgamingaudioconfigservice'], desc: 'Controlador de iluminación y métricas de Corsair.' },
];

export function matchOemService(serviceName, displayName = '') {
  const sLower = serviceName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const dLower = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const sig of OEM_SIGNATURES) {
    for (const name of sig.serviceNames) {
      const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (sLower.includes(cleanName) || dLower.includes(cleanName)) {
        return sig;
      }
    }
  }
  return null;
}

export function parseServicesCsv(stdout) {
  if (!stdout || typeof stdout !== 'string') return [];
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const services = [];

  for (const line of lines.slice(1)) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length >= 4) {
      // Node, DisplayName, Name, StartMode, State
      services.push({
        displayName: parts[1] || parts[2],
        name: parts[2] || parts[1],
        startMode: parts[3] || 'Auto',
        state: parts[4] || 'Unknown',
      });
    }
  }
  return services;
}

export async function runOemDebloatScanNative(onOutput) {
  const paths = prepareReport('oemdebloat');
  const { today, reportPath } = paths;

  onOutput('Auditanado servicios de fabricantes y suites OEM...');
  const r = await spawnCapture('wmic', [
    'service', 'get', 'DisplayName,Name,StartMode,State', '/format:csv',
  ], 10000);

  const detectedOemServices = [];
  if (r.code === 0 && r.stdout) {
    const allServices = parseServicesCsv(r.stdout);
    for (const s of allServices) {
      const match = matchOemService(s.name, s.displayName);
      if (match) {
        detectedOemServices.push({
          id: s.name,
          name: s.displayName,
          serviceName: s.name,
          oem: match.oem,
          desc: match.desc,
          startMode: s.startMode,
          state: s.state,
          isAuto: s.startMode.toLowerCase() === 'auto',
          recommendedManual: s.startMode.toLowerCase() === 'auto',
        });
      }
    }
  }

  const lines = [
    `# Reporte de Servicios y Bloatware OEM - ${today}`, '',
    `## Resumen de Diagnóstico`, '',
    `- **Servicios OEM Detectados**: ${detectedOemServices.length}`,
    `- **Con inicio automático en arranque**: ${detectedOemServices.filter((s) => s.isAuto).length}`,
    '',
    `## Lista de Servicios de Fabricantes`, '',
  ];

  lines.push('```');
  if (detectedOemServices.length === 0) {
    lines.push('[LIMPIO] No se detectaron servicios pesados de fabricantes OEM.');
  } else {
    detectedOemServices.forEach((s, idx) => {
      lines.push(`[${idx + 1}] [${s.oem}] ${s.name} (${s.serviceName}) -> ${s.startMode} [${s.state}]`);
    });
  }
  lines.push('```');
  lines.push('');

  finishReport(paths, lines, {
    date: today,
    reportPath,
    detectedCount: detectedOemServices.length,
    autoCount: detectedOemServices.filter((s) => s.isAuto).length,
  }, onOutput, detectedOemServices);
}

export async function runOemDebloatActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('oemdebloat', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const targetMode = envVars.MODE === 'disable' ? 'disabled' : 'demand'; // 'demand' = Manual
  const guard = makeGuard('oemdebloat', { dryRun, writeLog });

  const rawServices = String(envVars.SERVICES || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (rawServices.length === 0) {
    const err = new Error('No se seleccionó ningún servicio OEM para optimizar.');
    err.statusCode = 400;
    throw err;
  }

  writeLog(`Iniciando optimización de servicios OEM a modo [${targetMode.toUpperCase()}] (Modo: ${dryRun ? 'SIMULACIÓN' : 'APLICAR'})...`);

  for (let i = 0; i < rawServices.length; i++) {
    const svc = rawServices[i];
    if (onProgress) onProgress(Math.round(((i + 1) / rawServices.length) * 100));

    // Consultar estado previo del servicio con sc qc
    const qc = await spawnCapture('sc', ['qc', svc]);
    let prevStart = 'auto';
    if (qc.code === 0 && qc.stdout) {
      if (qc.stdout.includes('DEMAND_START')) prevStart = 'demand';
      else if (qc.stdout.includes('DISABLED')) prevStart = 'disabled';
      else if (qc.stdout.includes('AUTO_START')) prevStart = 'auto';
    }

    if (prevStart === targetMode) {
      writeLog(`- ${svc}: Ya está configurado en inicio ${targetMode}.`);
      continue;
    }

    const result = await guard(
      `Configurar servicio OEM ${svc} a inicio ${targetMode}`,
      () => spawnCapture('sc', ['config', svc, `start= ${targetMode}`]),
      {
        target: `Service\\${svc}`,
        previousValue: prevStart,
        newValue: targetMode,
      },
    );

    if (result.simulated) continue;
    if (result.ok) {
      writeLog(`- ${svc}: Configurado correctamente a inicio ${targetMode}.`);
    } else {
      writeLog(`- Error configurando ${svc}: ${errText(result)}`);
    }
  }

  writeLog('Optimización de servicios OEM finalizada.');
}
