import os from 'node:os';
import { getSystemTelemetry } from './system.js';
import { MODULES, readChanges, getScanTimeline } from './shared.js';
import { calculateHealthScore } from './healthscore.js';

export function getAllChanges() {
  const changes = [];
  for (const mod of Object.keys(MODULES)) {
    const list = readChanges(mod);
    for (const item of list) {
      changes.push({ module: mod, ...item });
    }
  }
  return changes.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

// ═══════════════════════════════════════════════════════
// Generador y Exportador de Informes Técnicos del Sistema
//
// Produce auditorías consolidadas en Markdown y JSON
// listas para técnicos, respaldos o análisis comparativos.
// ═══════════════════════════════════════════════════════

export async function generateSystemExport(status, format = 'markdown') {
  const telemetry = await getSystemTelemetry();
  const health = calculateHealthScore(status);
  const changes = getAllChanges();
  const timeline = getScanTimeline();
  const now = new Date();
  const dateStr = now.toISOString().replace(/T/, ' ').replace(/\..+/, '');

  if (format === 'json') {
    return JSON.stringify({
      generatedAt: dateStr,
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      healthScore: health,
      telemetry,
      status,
      recentChanges: changes.slice(0, 20),
      recentTimeline: timeline.slice(0, 20),
    }, null, 2);
  }

  // Markdown format
  const lines = [
    '# Informe Técnico de Diagnóstico y Optimización del Sistema',
    `**Generado el**: ${dateStr}`,
    `**Equipo**: \`${os.hostname()}\` | **Sistema Operativo**: Windows ${os.release()} (${os.arch()})`,
    `**Uptime**: ${telemetry.system?.uptimeFormatted || 'Desconocido'}`,
    '',
    '---',
    '',
    '## 1. Puntuación Global de Salud del Sistema (Health Score)',
    '',
    `### **${health.score} / 100** — Grado: **${health.grade}**`,
    '',
    '| Pilar de Rendimiento | Puntuación Obtenida | Estado |',
    '|---|---|---|',
  ];

  for (const b of health.breakdown || []) {
    lines.push(`| **${b.category}** | ${b.score} / ${b.max} pts | ${b.score === b.max ? 'Óptimo' : 'Requiere optimización'} |`);
  }

  lines.push(
    '',
    '---',
    '',
    '## 2. Telemetría de Hardware en Tiempo Real',
    '',
    `- **Carga de CPU**: ${telemetry.cpu?.usagePercent}% (${telemetry.cpu?.model || 'Desconocido'}, ${telemetry.cpu?.cores || 0} núcleos)`,
    `- **Memoria RAM**: ${telemetry.ram?.usedFormatted} usados de ${telemetry.ram?.totalFormatted} (${telemetry.ram?.usedPercent}% ocupado, ${telemetry.ram?.freeFormatted} libres)`,
    '',
    '### Particiones de Disco',
    '| Unidad | Sistema de Archivos | Espacio Libre | Tamaño Total | Porcentaje Libre |',
    '|---|---|---|---|---|',
  );

  for (const d of telemetry.disks || []) {
    lines.push(`| **${d.drive}** | ${d.filesystem || 'NTFS'} | ${d.freeFormatted} | ${d.totalFormatted} | ${d.percentFree}% libre |`);
  }

  lines.push('', '---', '', '## 3. Estado de los Módulos de Optimización', '');
  lines.push('| Módulo | Último Escaneo | Métrica Clave |');
  lines.push('|---|---|---|');

  if (status.cleanup) {
    lines.push(`| **Limpieza de Disco** | ${status.cleanup.lastScan || 'Nunca'} | ${status.cleanup.totalRecoverableMB || 0} MB recuperables |`);
  }
  if (status.startup) {
    lines.push(`| **Inicio de Windows** | ${status.startup.lastScan || 'Nunca'} | ${status.startup.total || 0} elementos en inicio |`);
  }
  if (status.ram) {
    lines.push(`| **Optimización de RAM** | ${status.ram.lastScan || 'Nunca'} | ${status.ram.standbyMb || 0} MB en standby |`);
  }
  if (status.gaming) {
    lines.push(`| **Gaming & GPU** | ${status.gaming.lastScan || 'Nunca'} | ${status.gaming.optimizedCount || 0}/${status.gaming.total || 6} ajustes activos |`);
  }
  if (status.integrity) {
    lines.push(`| **Integridad DISM/SFC** | ${status.integrity.lastScan || 'Nunca'} | DISM: ${status.integrity.dismStatus || 'OK'} · SFC: ${status.integrity.sfcStatus || 'OK'} |`);
  }
  if (status.contextmenu) {
    lines.push(`| **Menú Clic Derecho** | ${status.contextmenu.lastScan || 'Nunca'} | ${status.contextmenu.activeThirdParty || 0} extensiones de terceros activas |`);
  }
  if (status.oemdebloat) {
    lines.push(`| **Debloat OEM** | ${status.oemdebloat.lastScan || 'Nunca'} | ${status.oemdebloat.autoCount || 0} servicios OEM automáticos |`);
  }

  lines.push('', '---', '', '## 4. Últimos Cambios y Optimizaciones Aplicadas', '');
  if (changes.length === 0) {
    lines.push('*No hay cambios registrados en el diario de auditoría.*');
  } else {
    lines.push('| Fecha | Módulo | Acción | Reversible |');
    lines.push('|---|---|---|---|');
    for (const c of changes.slice(0, 15)) {
      lines.push(`| ${c.timestamp || ''} | \`${c.module || ''}\` | ${c.description || ''} | ${c.reversible ? 'Sí' : 'No'} |`);
    }
  }

  lines.push('', '---', '', '*Informe generado automáticamente por Optimizador D1.*');

  return lines.join('\n');
}
