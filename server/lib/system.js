import os from 'os';
import { spawnCapture } from './shared.js';

// ═══════════════════════════════════════════════════════
// Telemetría en Tiempo Real del Sistema
//
// Provee métricas rápidas de hardware sin lanzar escaneos pesados:
// 1. CPU: modelo, núcleos, velocidad y porcentaje de uso calculado.
// 2. RAM: memoria total, usada, libre y porcentaje de uso instantáneo.
// 3. Discos: particiones lógicas montadas (DeviceID, Total GB, Libre GB, % uso).
// 4. Uptime del sistema y plataforma.
// ═══════════════════════════════════════════════════════

/**
 * Calcula el porcentaje de uso de CPU comparando dos muestras de ticks de os.cpus().
 * Devuelve una promesa con el porcentaje total redondeado a 1 decimal.
 */
export function getCpuUsage(sampleMs = 150) {
  return new Promise((resolve) => {
    const startCpus = os.cpus();
    setTimeout(() => {
      const endCpus = os.cpus();
      let totalDiff = 0;
      let idleDiff = 0;

      for (let i = 0; i < startCpus.length; i++) {
        const start = startCpus[i].times;
        const end = endCpus[i].times;

        const startTotal = start.user + start.nice + start.sys + start.idle + start.irq;
        const endTotal = end.user + end.nice + end.sys + end.idle + end.irq;

        totalDiff += (endTotal - startTotal);
        idleDiff += (end.idle - start.idle);
      }

      if (totalDiff <= 0) {
        resolve(0);
        return;
      }

      const usage = Math.max(0, Math.min(100, ((totalDiff - idleDiff) / totalDiff) * 100));
      resolve(Math.round(usage * 10) / 10);
    }, sampleMs);
  });
}

/**
 * Obtiene métricas de memoria RAM del sistema.
 */
export function getRamMetrics() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;

  const totalGB = Math.round((totalBytes / (1024 ** 3)) * 100) / 100;
  const freeGB = Math.round((freeBytes / (1024 ** 3)) * 100) / 100;
  const usedGB = Math.round((usedBytes / (1024 ** 3)) * 100) / 100;
  const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

  return {
    totalGB,
    freeGB,
    usedGB,
    usagePercent,
  };
}

/**
 * Parsea la salida CSV de wmic logicaldisk para listar las unidades de disco fijas (DriveType=3).
 */
export function parseLogicalDisks(csvOutput) {
  if (!csvOutput || typeof csvOutput !== 'string') return [];
  const lines = csvOutput.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const disks = [];

  for (const line of lines) {
    // Formato CSV de wmic: Node,DeviceID,FreeSpace,Size,VolumeName o DeviceID,FreeSpace,Size,VolumeName
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length >= 3) {
      // Buscar la parte que parece letra de unidad (ej. "C:")
      const driveIdx = parts.findIndex((p) => /^[A-Za-z]:$/.test(p));
      if (driveIdx !== -1 && parts.length > driveIdx + 2) {
        const drive = parts[driveIdx];
        const freeSpaceBytes = Number(parts[driveIdx + 1]);
        const sizeBytes = Number(parts[driveIdx + 2]);
        const volumeName = parts[driveIdx + 3] || '';

        if (Number.isFinite(sizeBytes) && sizeBytes > 0) {
          const totalGB = Math.round((sizeBytes / (1024 ** 3)) * 10) / 10;
          const freeGB = Math.round((freeSpaceBytes / (1024 ** 3)) * 10) / 10;
          const usedGB = Math.round((totalGB - freeGB) * 10) / 10;
          const usagePercent = totalGB > 0 ? Math.round(((totalGB - freeGB) / totalGB) * 100) : 0;

          disks.push({
            drive,
            volumeName,
            totalGB,
            freeGB,
            usedGB,
            usagePercent,
          });
        }
      }
    }
  }

  return disks;
}

/**
 * Obtiene la lista de discos lógicos de Windows mediante wmic (rápido y seguro).
 */
export async function getLogicalDisks() {
  try {
    const { stdout, code } = await spawnCapture('wmic', [
      'logicaldisk', 'where', 'DriveType=3', 'get', 'DeviceID,FreeSpace,Size,VolumeName', '/format:csv',
    ], 3000);

    if (code === 0 && stdout) {
      return parseLogicalDisks(stdout);
    }
  } catch {
    // Fallback silencioso si wmic falla
  }

  return [];
}

/**
 * Formatea el tiempo de actividad (uptime) en formato legible.
 */
export function formatUptime(uptimeSeconds) {
  const sec = Math.floor(uptimeSeconds || 0);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Obtiene el snapshot completo de telemetría del sistema en tiempo real.
 */
export async function getSystemTelemetry() {
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model.trim() : 'CPU';
  const cpuCores = cpus.length;
  const cpuSpeedMHz = cpus.length > 0 ? cpus[0].speed : 0;

  const [cpuUsage, disks] = await Promise.all([
    getCpuUsage(100),
    getLogicalDisks(),
  ]);

  const ram = getRamMetrics();
  const uptimeSeconds = os.uptime();
  const uptimeFormatted = formatUptime(uptimeSeconds);

  return {
    timestamp: new Date().toISOString(),
    cpu: {
      model: cpuModel,
      cores: cpuCores,
      speedMHz: cpuSpeedMHz,
      usagePercent: cpuUsage,
    },
    ram,
    disks,
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptimeSeconds,
      uptimeFormatted,
    },
  };
}
