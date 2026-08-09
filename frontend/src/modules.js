/**
 * Registro declarativo de los 9 modulos.
 *
 * Antes esto vivia repartido: `MODULE_LABELS` en Dashboard.jsx con solo los
 * nombres, `MODULE_SCRIPTS` en ReportViewer.jsx, y 460 lineas de JSX casi
 * identico con una tarjeta escrita a mano por modulo, cada una con su SVG
 * inline. Agregar un modulo significaba tocar cuatro lugares.
 *
 * `span` controla el area en el Bento: los modulos no importan todos igual.
 */

// Iconos como path de SVG: el wrapper comun vive en <ModuleIcon>.
const ICONS = {
  updates: 'M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16',
  cleanup: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  startup: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  ram: 'M6 19v2M10 19v2M14 19v2M18 19v2M4 15h16M5 5h14a2 2 0 0 1 2 2v8H3V7a2 2 0 0 1 2-2z',
  network: 'M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01',
  services: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 16 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  power: 'M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10',
  apps: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  privacy: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
};

const fmtSize = (mb) => {
  if (mb == null) return '—';
  return mb < 1024 ? `${Number(mb).toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
};

/** `tone` pinta el valor: se usa solo cuando el numero significa algo. */
const tone = (value, { warn, danger }) => {
  if (danger !== undefined && value >= danger) return 'is-danger';
  if (warn !== undefined && value >= warn) return 'is-warning';
  return null;
};

export const MODULES = {
  updates: {
    label: 'Actualizaciones',
    blurb: 'winget, pip, npm global y Chocolatey',
    icon: ICONS.updates,
    span: 'wide',
    metrics: (d) => [
      { label: 'winget', value: d.winget?.count ?? 0, tone: tone(d.winget?.count ?? 0, { warn: 1 }) },
      { label: 'pip', value: d.pip?.count ?? 0 },
      { label: 'npm global', value: d.npm?.count ?? 0 },
      { label: 'Chocolatey', value: d.choco?.count ?? 0 },
    ],
  },
  cleanup: {
    label: 'Limpieza de disco',
    blurb: 'Temporales, caché, descargas y papelera',
    icon: ICONS.cleanup,
    span: 'wide',
    metrics: (d) => [
      { label: 'Temporales', value: fmtSize(d.temp?.total_mb), tone: tone(d.temp?.total_mb ?? 0, { warn: 1024, danger: 10240 }) },
      { label: 'Caché de navegadores', value: fmtSize(d.browserCache?.total_mb) },
      { label: 'Descargas viejas', value: `${d.downloads?.count ?? 0} archivos` },
      { label: 'Papelera', value: `${d.recycleBin?.count ?? 0} elementos` },
    ],
  },
  ram: {
    label: 'Memoria RAM',
    blurb: 'Procesos por consumo, en 4 niveles de riesgo',
    icon: ICONS.ram,
    span: 'full',
    metrics: (d) => [
      { label: 'En uso', value: `${d.usagePercent ?? 0}%`, tone: tone(d.usagePercent ?? 0, { warn: 75, danger: 90 }) },
      { label: 'Total', value: fmtSize(d.totalMB) },
      { label: 'Libre', value: fmtSize(d.freeMB) },
      { label: 'Procesos', value: d.totalProcesses ?? 0 },
      { label: 'Seguros de liberar', value: d.knownProcesses ?? 0, tone: 'is-success' },
      { label: 'Sin identificar', value: d.unknownProcesses ?? 0 },
      { label: 'No recomendados', value: d.riskyProcesses ?? 0, tone: 'is-warning' },
      { label: 'Críticos (no se tocan)', value: d.criticalProcesses ?? 0 },
    ],
  },
  startup: {
    label: 'Inicio de sesión',
    blurb: 'Programas, servicios y tareas al arrancar',
    icon: ICONS.startup,
    span: 'wide',
    metrics: (d) => [
      { label: 'Programas de inicio', value: d.startupPrograms?.count ?? 0, tone: tone(d.startupPrograms?.count ?? 0, { warn: 10, danger: 20 }) },
      { label: 'Servicios automáticos', value: d.autoServices?.count ?? 0 },
      { label: 'De terceros', value: d.autoServices?.nonMicrosoft ?? 0 },
      { label: 'Tareas al iniciar sesión', value: d.logonTasks?.count ?? 0 },
    ],
  },
  services: {
    label: 'Servicios',
    blurb: 'Automáticos, separando Microsoft de terceros',
    icon: ICONS.services,
    span: 'wide',
    metrics: (d) => [
      { label: 'De terceros', value: d.thirdPartyTotal ?? 0 },
      { label: 'Ejecutándose', value: d.thirdPartyRunning ?? 0, tone: tone(d.thirdPartyRunning ?? 0, { warn: 10 }) },
      { label: 'Memoria que ocupan', value: fmtSize(d.thirdPartyMemoryMB) },
      { label: 'Del sistema', value: d.systemTotal ?? 0 },
    ],
  },
  network: {
    label: 'Red',
    blurb: 'DNS, latencia y adaptadores',
    icon: ICONS.network,
    metrics: (d) => [
      { label: 'Ping a 8.8.8.8', value: d.avgPingMs != null ? `${d.avgPingMs} ms` : '—', tone: tone(d.avgPingMs ?? 0, { warn: 80, danger: 150 }) },
      { label: 'Pérdida de paquetes', value: `${d.packetLoss ?? 0}%`, tone: tone(d.packetLoss ?? 0, { warn: 1, danger: 10 }) },
      { label: 'Caché DNS', value: `${d.dnsCacheEntries ?? 0} entradas` },
      { label: 'Adaptadores activos', value: d.activeAdapters ?? 0 },
    ],
  },
  power: {
    label: 'Energía',
    blurb: 'Plan activo, batería y consumo estimado',
    icon: ICONS.power,
    metrics: (d) => [
      { label: 'Plan activo', value: d.activePlan ?? '—' },
      { label: 'Consumo estimado', value: d.totalEstWatts != null ? `${d.totalEstWatts} W` : '—' },
      ...(d.batteryPresent
        ? [{ label: 'Batería', value: `${d.batteryPct ?? 0}% · ${d.batteryStatus ?? ''}` }]
        : [{ label: 'Batería', value: 'Sin batería' }]),
    ],
  },
  apps: {
    label: 'Aplicaciones',
    blurb: 'Instaladas vía winget',
    icon: ICONS.apps,
    metrics: (d) => [
      { label: 'Instaladas', value: d.appsCount ?? 0 },
    ],
  },
  privacy: {
    label: 'Privacidad',
    blurb: '8 ajustes de telemetría y permisos',
    icon: ICONS.privacy,
    metrics: (d) => [
      { label: 'Protegidos', value: `${d.hardenedCount ?? 0} / ${d.totalSettings ?? 0}`,
        tone: (d.hardenedCount ?? 0) < (d.totalSettings ?? 0) ? 'is-warning' : 'is-success' },
    ],
  },
};

export const MODULE_KEYS = Object.keys(MODULES);
