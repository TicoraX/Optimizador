import {
  spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText, queryRegistryValue,
} from './shared.js';

// ═══════════════════════════════════════════════════════
// Optimizador de Privacidad en Red y Telemetría Conectada
//
// Audita y bloquea la telemetría que viaja por la red:
// descargas de sugerencias en segundo plano, WiFi Sense,
// pre-renderizado de Edge y sondeo pasivo.
// ═══════════════════════════════════════════════════════

export const NETWORK_PRIVACY_SETTINGS = [
  {
    id: 'wifisense',
    name: 'Desactivar Conexión Automática a Redes Abiertas (WiFi Sense)',
    desc: 'Previene conectarse automáticamente a puntos de acceso no seguros o compartir credenciales.',
    key: 'HKLM\\Software\\Microsoft\\WcmSvc\\wifinetworkmanager\\config',
    value: 'AutoConnectAllowedOEM',
    type: 'REG_DWORD',
    optimizedValue: '0',
    optimizedLabel: 'Desactivado (0)',
    defaultLabel: 'Activo o no configurado',
  },
  {
    id: 'spotlight',
    name: 'Desactivar Descargas en Segundo Plano de Windows Spotlight',
    desc: 'Evita la descarga silenciosa de fondos y anuncios de Bing en la pantalla de bloqueo.',
    key: 'HKCU\\Software\\Policies\\Microsoft\\Windows\\CloudContent',
    value: 'DisableWindowsSpotlightFeatures',
    type: 'REG_DWORD',
    optimizedValue: '1',
    optimizedLabel: 'Bloqueado (1)',
    defaultLabel: 'Descargas activas (0)',
  },
  {
    id: 'consumercontent',
    name: 'Bloquear Instalación Silenciosa de Apps Promocionadas',
    desc: 'Impide que Windows descargue e instale juegos o aplicaciones de la tienda sin tu consentimiento.',
    key: 'HKCU\\Software\\Policies\\Microsoft\\Windows\\CloudContent',
    value: 'DisableWindowsConsumerFeatures',
    type: 'REG_DWORD',
    optimizedValue: '1',
    optimizedLabel: 'Bloqueado (1)',
    defaultLabel: 'Permitido (0)',
  },
  {
    id: 'edgepreloading',
    name: 'Desactivar Pre-carga de Red en Segundo Plano (Edge)',
    desc: 'Evita que el navegador consuma ancho de banda enviando consultas DNS y conexiones previas a enlaces no clickeados.',
    key: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge',
    value: 'NetworkPredictionOptions',
    type: 'REG_DWORD',
    optimizedValue: '2',
    optimizedLabel: 'Pre-carga desactivada (2)',
    defaultLabel: 'Pre-carga activa (0 o 1)',
  },
  {
    id: 'ncsi_passive',
    name: 'Desactivar Sondeo Activo de Conectividad (NCSI / msftconnecttest)',
    desc: 'Previene el envío continuo de telemetría y pings a servidores de Microsoft, aunque desactivarlo puede afectar la detección de portales cautivos/WiFi y causar problemas de conexión en Outlook o descargas de Windows Update.',
    key: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\NlaSvc\\Parameters\\Internet',
    value: 'EnableActiveProbing',
    type: 'REG_DWORD',
    optimizedValue: '0',
    optimizedLabel: 'Sondeo desactivado (0)',
    defaultLabel: 'Sondeo activo (1)',
  },
];

export async function runNetworkPrivacyScanNative(onOutput) {
  const paths = prepareReport('networkprivacy');
  const { today, reportPath } = paths;

  onOutput('Auditando directivas de privacidad de red y telemetría conectada...');
  const items = [];
  let protectedCount = 0;

  for (const s of NETWORK_PRIVACY_SETTINGS) {
    const cur = await queryRegistryValue(s.key, s.value);
    const isOpt = String(cur) === String(s.optimizedValue);
    if (isOpt) protectedCount++;

    items.push({
      id: s.id,
      name: s.name,
      desc: s.desc,
      key: s.key,
      value: s.value,
      type: s.type,
      currentValue: cur ?? 'No configurado',
      currentLabel: isOpt ? s.optimizedLabel : (cur !== null ? `Valor actual: ${cur}` : s.defaultLabel),
      recommendedValue: s.optimizedValue,
      isOptimized: isOpt,
    });
  }

  const lines = [
    `# Reporte de Privacidad en Red y Telemetría Conectada - ${today}`, '',
    `## Resumen de Protección de Red`, '',
    `- **Ajustes Protegidos**: ${protectedCount} / ${NETWORK_PRIVACY_SETTINGS.length}`,
    `- **Ajustes Expuestos**: ${NETWORK_PRIVACY_SETTINGS.length - protectedCount}`,
    '',
    `## Detalle de Directivas de Privacidad en Red`, '',
  ];

  lines.push('```');
  items.forEach((it) => {
    const icon = it.isOptimized ? '[PROTEGIDO]' : '[EXPUESTO]';
    lines.push(`${icon} ${it.name}`);
    lines.push(`     Estado: ${it.currentLabel}`);
    lines.push(`     Ruta: ${it.key}\\${it.value}`);
    lines.push('');
  });
  lines.push('```');
  lines.push('');

  finishReport(paths, lines, {
    date: today,
    reportPath,
    protectedCount,
    exposedCount: NETWORK_PRIVACY_SETTINGS.length - protectedCount,
    total: NETWORK_PRIVACY_SETTINGS.length,
  }, onOutput, items);
}

export async function runNetworkPrivacyActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('networkprivacy', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('networkprivacy', { dryRun, writeLog });

  const chosenIds = String(envVars.SETTINGS || envVars.ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (chosenIds.length === 0) {
    const err = new Error('No se seleccionó ningún ajuste de privacidad en red para proteger.');
    err.statusCode = 400;
    throw err;
  }

  writeLog(`Iniciando protección de privacidad en red (Modo: ${dryRun ? 'SIMULACIÓN' : 'APLICAR'})...`);

  for (let i = 0; i < chosenIds.length; i++) {
    const id = chosenIds[i];
    if (onProgress) onProgress(Math.round(((i + 1) / chosenIds.length) * 100));

    const s = NETWORK_PRIVACY_SETTINGS.find((item) => item.id === id);
    if (!s) {
      writeLog(`- Omitiendo ajuste desconocido: ${id}`);
      continue;
    }

    const prevVal = await queryRegistryValue(s.key, s.value);

    const result = await guard(
      `Proteger ${s.name} (${s.value}=${s.optimizedValue})`,
      () => spawnCapture('reg', ['add', s.key, '/v', s.value, '/t', s.type, '/d', s.optimizedValue, '/f']),
      {
        target: `${s.key}\\${s.value}`,
        valueType: s.type,
        previousValue: prevVal,
        newValue: s.optimizedValue,
      },
    );

    if (result.simulated) continue;
    if (result.ok) {
      writeLog(`- ${s.name}: Protegido exitosamente.`);
    } else {
      writeLog(`- Error protegiendo ${s.name}: ${errText(result)}`);
    }
  }

  writeLog('Protección de privacidad en red finalizada.');
}
