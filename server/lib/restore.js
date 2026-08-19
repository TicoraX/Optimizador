import { spawnCapture, appendChange, localStamp } from './shared.js';

// ═══════════════════════════════════════════════════════
// Gestor de Puntos de Restauración de Windows
//
// Permite auditar y crear puntos de restauración de Windows
// antes de aplicar modificaciones mayores al sistema.
// ═══════════════════════════════════════════════════════

const RESTORE_POINT_TYPES = {
  0: 'APPLICATION_INSTALL',
  1: 'APPLICATION_UNINSTALL',
  10: 'DEVICE_DRIVER_INSTALL',
  12: 'MODIFY_SETTINGS',
  13: 'CANCELLED_OPERATION',
};

/**
 * Parsea la salida JSON de Get-ComputerRestorePoint.
 */
export function parseRestorePointsJson(rawJson) {
  if (!rawJson || typeof rawJson !== 'string') return [];
  const trimmed = rawJson.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : [parsed];

    return list
      .filter((item) => item && (item.SequenceNumber !== undefined || item.Description))
      .map((item) => {
        let dateStr = item.CreationTime || '';
        // PowerShell puede devolver fechas en formato /Date(1234567890)/ o string ISO/locale
        if (typeof dateStr === 'string' && dateStr.startsWith('/Date(')) {
          const match = dateStr.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
          if (match) {
            dateStr = new Date(Number(match[1])).toLocaleString();
          }
        }

        const typeNum = Number(item.RestorePointType);
        const typeName = RESTORE_POINT_TYPES[typeNum] || `TYPE_${typeNum || 'UNKNOWN'}`;

        return {
          sequenceNumber: item.SequenceNumber ?? 0,
          description: String(item.Description || 'Sin descripción').trim(),
          creationTime: dateStr,
          type: typeName,
          eventType: item.EventType ?? 100, // 100 = BEGIN_SYSTEM_CHANGE
        };
      })
      .sort((a, b) => b.sequenceNumber - a.sequenceNumber);
  } catch {
    return [];
  }
}

/**
 * Valida la descripción para un nuevo punto de restauración.
 * Solo permite caracteres alfanuméricos, espacios, guiones y puntos (longitud 3-100).
 */
export function validateRestoreDescription(desc) {
  if (typeof desc !== 'string') {
    const err = new Error('La descripción debe ser un texto.');
    err.statusCode = 400;
    throw err;
  }
  const trimmed = desc.trim();
  if (trimmed.length < 3 || trimmed.length > 100) {
    const err = new Error('La descripción debe tener entre 3 y 100 caracteres.');
    err.statusCode = 400;
    throw err;
  }
  if (!/^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ\s_\-.:]+$/.test(trimmed)) {
    const err = new Error('La descripción contiene caracteres no permitidos.');
    err.statusCode = 400;
    throw err;
  }
  return trimmed;
}

/**
 * Consulta la lista de puntos de restauración existentes en Windows.
 */
export async function getRestorePoints() {
  try {
    const { stdout, code } = await spawnCapture('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-ComputerRestorePoint | Select-Object SequenceNumber, Description, CreationTime, RestorePointType, EventType | ConvertTo-Json -Compress',
    ], 10000);

    if (code === 0 && stdout) {
      const points = parseRestorePointsJson(stdout);
      return {
        ok: true,
        points,
        protectionEnabled: true,
      };
    }
  } catch {
    // Si falla o no tiene permisos
  }

  return {
    ok: false,
    points: [],
    protectionEnabled: false,
  };
}

/**
 * Crea un nuevo punto de restauración del sistema Windows.
 */
export async function createRestorePoint(rawDescription) {
  const description = validateRestoreDescription(rawDescription || 'Optimizador D1 - Seguridad');

  // PowerShell Checkpoint-Computer requiere elevación en Windows
  const psCmd = `Checkpoint-Computer -Description "${description}" -RestorePointType "MODIFY_SETTINGS"`;

  const { stdout, stderr, code } = await spawnCapture('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    psCmd,
  ], 120000);

  if (code !== 0) {
    const errorMsg = (stderr || stdout || 'Error desconocido al crear punto de restauración').trim();
    let userMsg = `No se pudo crear el punto de restauración: ${errorMsg.slice(0, 200)}`;
    if (errorMsg.includes('Access is denied') || errorMsg.includes('administrador') || errorMsg.includes('permission')) {
      userMsg = 'Se requieren permisos de Administrador para crear puntos de restauración de Windows.';
    } else if (errorMsg.includes('0x80042306') || errorMsg.includes('24') || errorMsg.toLowerCase().includes('frequency')) {
      userMsg = 'Windows limita la creación de puntos de restauración automáticos a uno cada 24 horas por directiva del sistema.';
    }
    return {
      ok: false,
      error: userMsg,
    };
  }

  const { date, time } = localStamp();
  appendChange('restore', {
    action: 'create_restore_point',
    description,
    timestamp: `${date} ${time}`,
  });

  return {
    ok: true,
    description,
    createdAt: `${date} ${time}`,
  };
}
