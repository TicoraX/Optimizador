import {
  spawnCapture, makeLogger, prepareReport, finishReport, errText,
} from './shared.js';

const PRIVACY_SETTINGS = [
  { id: 'telemetry', name: 'Telemetría', desc: 'Envío de datos de diagnóstico',
    key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\DataCollection',
    value: 'AllowTelemetry', type: 'REG_DWORD', safeValue: '0' },
  { id: 'cortana', name: 'Cortana', desc: 'Asistente virtual',
    key: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search',
    value: 'AllowCortana', type: 'REG_DWORD', safeValue: '0' },
  { id: 'ads', name: 'ID de publicidad', desc: 'Identificador de publicidad',
    key: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo',
    value: 'Enabled', type: 'REG_DWORD', safeValue: '0' },
  { id: 'tailored', name: 'Experiencias personalizadas', desc: 'Experiencias a medida con datos de diagnóstico',
    key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy',
    value: 'TailoredExperiencesWithDiagnosticDataEnabled', type: 'REG_DWORD', safeValue: '0' },
  { id: 'activity', name: 'Historial de actividad', desc: 'Historial de actividad en la nube',
    key: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System',
    value: 'EnableActivityFeed', type: 'REG_DWORD', safeValue: '0' },
  { id: 'location', name: 'Ubicación', desc: 'Servicios de ubicación',
    key: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location',
    value: 'Value', type: 'REG_SZ', safeValue: 'Deny' },
  { id: 'camera', name: 'Cámara', desc: 'Acceso a cámara',
    key: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam',
    value: 'Value', type: 'REG_SZ', safeValue: 'Deny' },
  { id: 'microphone', name: 'Micrófono', desc: 'Acceso a micrófono',
    key: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone',
    value: 'Value', type: 'REG_SZ', safeValue: 'Deny' },
];

function readRegValue(key, val) {
  return spawnCapture('reg', ['query', key, '/v', val]);
}

function parseRegValue(setting, stdout) {
  if (setting.type === 'REG_DWORD') {
    const m = stdout.match(/0x([\da-fA-F]+)/);
    return m ? String(parseInt(m[1], 16)) : null;
  }
  const m = stdout.match(/REG_SZ\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function isSafe(setting, currentValue) {
  if (currentValue === null) return false;
  return currentValue === setting.safeValue;
}

function statusLabel(setting, currentValue) {
  if (currentValue === null) return 'No configurado (por defecto)';
  return isSafe(setting, currentValue) ? 'Protegido' : 'No protegido';
}

export async function runPrivacyScanNative(onOutput) {
  const paths = prepareReport('privacy');
  const { today, reportPath } = paths;

  let scanError = false, hardenedCount = 0;
  const results = [];

  onOutput('Escaneando configuración de privacidad...');
  for (const setting of PRIVACY_SETTINGS) {
    const r = await readRegValue(setting.key, setting.value);
    let currentValue = null;
    if (r.code === 0) {
      currentValue = parseRegValue(setting, r.stdout);
    } else if (!/no se encuentra|cannot find|unable to find/i.test(r.stderr || '')) {
      // Una clave ausente es un estado legitimo (el ajuste nunca se toco).
      // Cualquier otro fallo de `reg query` si es un error real de escaneo.
      // Antes scanError se declaraba y nunca se asignaba: el JSON reportaba
      // error:false aunque los 8 reg query hubieran fallado.
      scanError = true;
    }

    const safe = isSafe(setting, currentValue);
    if (safe) hardenedCount++;
    results.push({ ...setting, currentValue, safe });
  }

  const lines = [
    `# Reporte de Privacidad - ${today}`, '',
    `## Configuración de Privacidad (${PRIVACY_SETTINGS.length} ajustes)`, '',
  ];

  if (PRIVACY_SETTINGS.length > 0) {
    lines.push('```');
    results.forEach((s, i) => {
      const label = statusLabel(s, s.currentValue);
      const valStr = s.currentValue !== null ? `(${s.currentValue})` : '';
      lines.push(`[${i + 1}] ${s.name} -- ${s.desc} -- ${label} ${valStr}`);
    });
    lines.push('```');
  }
  lines.push('');

  lines.push('## Resumen', '');
  lines.push(`- Ajustes analizados: ${PRIVACY_SETTINGS.length}`);
  lines.push(`- Ya protegidos: ${hardenedCount}`);
  lines.push(`- Pendientes: ${PRIVACY_SETTINGS.length - hardenedCount}`);
  lines.push('');

  finishReport(paths, lines, {
    date: today, reportPath,
    total_settings: PRIVACY_SETTINGS.length,
    hardened_count: hardenedCount,
    error: scanError,
  }, onOutput);
}

export async function runPrivacyActionNative(envVars, onOutput) {
  const writeLog = makeLogger('privacy', onOutput);

  writeLog('=== Protección de privacidad - inicio ===');

  const selection = envVars.OPTIMIZE_PRIVACY || '';
  const indices = selection.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 1);

  if (indices.length === 0) {
    writeLog('No se seleccionaron ajustes para proteger.');
    writeLog('=== Protección de privacidad - fin ===');
    return;
  }

  let hardened = 0, errors = 0;

  for (const idx of indices) {
    const s = PRIVACY_SETTINGS[idx - 1];
    if (!s) {
      writeLog(`Índice ${idx} fuera de rango, ignorado.`);
      continue;
    }
    writeLog(`Protegiendo: ${s.name} (${s.desc})...`);
    const r = await spawnCapture('reg', ['add', s.key, '/v', s.value, '/t', s.type, '/d', s.safeValue, '/f']);
    if (r.code === 0) {
      hardened++;
      writeLog(`  Protegido: ${s.name}`);
    } else {
      errors++;
      writeLog(`  ERROR protegiendo ${s.name}: ${errText(r)}`);
    }
  }

  writeLog(`Resumen: ${hardened} protegidos, ${errors} errores`);
  writeLog('=== Protección de privacidad - fin ===');
}
