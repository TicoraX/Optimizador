import { runGamingActionNative } from './gaming.js';
import { runTimersActionNative } from './timers.js';
import { runWerFaultActionNative } from './werfault.js';
import { runNetworkPrivacyActionNative } from './networkprivacy.js';
import { runDnsFlushActionNative } from './dnsflush.js';
import { runCleanupActionNative } from './cleanup.js';
import { runRamActionNative } from './ram.js';

// ═══════════════════════════════════════════════════════
// Motor de Perfiles de Optimización del Sistema (profiles.js)
//
// Permite aplicar presets integrales de configuración en 1 clic
// para escenarios específicos: Gaming, Oficina/Trabajo, Batería y Dev.
// ═══════════════════════════════════════════════════════

export const PROFILES = [
  {
    id: 'gaming',
    name: 'Perfil Gaming / Máximo Rendimiento',
    desc: 'Optimiza la latencia de entrada, activa HAGS, configura timers BCD de alta precisión y silencia diálogos de error para evitar caídas de FPS.',
    icon: 'gaming',
    accent: 'var(--color-primary)',
    steps: [
      { module: 'gaming', params: { settings: 'hags,gamedvr,fso,gpu_priority' } },
      { module: 'timers', params: { settings: 'disabledynamictick,useplatformclock' } },
      { module: 'werfault', params: { settings: 'dontshowui,loggingdisabled' } },
      { module: 'ram', params: { cleanMode: 'soft', minRamMB: 50, processes: '1234' } },
    ],
  },
  {
    id: 'work',
    name: 'Perfil Oficina & Productividad',
    desc: 'Equilibrio entre rendimiento y estabilidad: asegura la búsqueda local rápida de Windows Search y protege la privacidad de red.',
    icon: 'searchindex',
    accent: 'var(--color-success)',
    steps: [
      { module: 'networkprivacy', params: { settings: 'wifisense,spotlight' } },
      { module: 'dnsflush', params: { actions: 'flushdns' } },
    ],
  },
  {
    id: 'battery',
    name: 'Perfil Laptop & Ahorro de Batería',
    desc: 'Reduce la actividad de fondo innecesaria, suprime telemetría de red y minimiza la indexación en reposo para extender la autonomía.',
    icon: 'power',
    accent: 'var(--color-warning)',
    steps: [
      { module: 'networkprivacy', params: { settings: 'wifisense,spotlight,edgepreload' } },
      { module: 'werfault', params: { settings: 'loggingdisabled' } },
    ],
  },
  {
    id: 'dev',
    name: 'Perfil Desarrollador & Compilación',
    desc: 'Purga cachés de compiladores (npm, pip, cargo, uv), renueva la pila DNS y libera memoria standby retenida.',
    icon: 'cleanup',
    accent: 'var(--color-info, #47bfff)',
    steps: [
      { module: 'cleanup', params: { cleanCategories: ['devCache', 'temp'] } },
      { module: 'dnsflush', params: { actions: 'flushdns,registers' } },
      { module: 'ram', params: { cleanMode: 'soft', minRamMB: 50, processes: '1234' } },
    ],
  },
];

export function getProfiles() {
  return PROFILES.map((p) => ({
    id: p.id,
    name: p.name,
    desc: p.desc,
    icon: p.icon,
    accent: p.accent,
    stepCount: p.steps.length,
  }));
}

export async function applyProfile(profileId, { dryRun = false } = {}, onOutput = () => {}) {
  const profile = PROFILES.find((p) => p.id === profileId);
  if (!profile) {
    const err = new Error(`Perfil '${profileId}' no encontrado`);
    err.statusCode = 404;
    throw err;
  }

  onOutput(`[PERFIL] Iniciando aplicación del ${profile.name} (Modo: ${dryRun ? 'SIMULACIÓN (dryRun)' : 'REAL'})...`);
  const results = [];

  for (const step of profile.steps) {
    onOutput(`[PERFIL] Ejecutando módulo: ${step.module}...`);
    const envVars = {
      DRY_RUN: dryRun ? 'true' : 'false',
      ...step.params,
    };

    try {
      let res;
      if (step.module === 'gaming') {
        res = await runGamingActionNative(envVars, onOutput);
      } else if (step.module === 'timers') {
        res = await runTimersActionNative(envVars, onOutput);
      } else if (step.module === 'werfault') {
        res = await runWerFaultActionNative(envVars, onOutput);
      } else if (step.module === 'networkprivacy') {
        res = await runNetworkPrivacyActionNative(envVars, onOutput);
      } else if (step.module === 'dnsflush') {
        res = await runDnsFlushActionNative(envVars, onOutput);
      } else if (step.module === 'cleanup') {
        res = await runCleanupActionNative(envVars, onOutput);
      } else if (step.module === 'ram') {
        res = await runRamActionNative(envVars, onOutput);
      }
      results.push({ module: step.module, ok: true, res });
    } catch (err) {
      onOutput(`[ERROR] Falló el paso ${step.module}: ${err.message}`);
      results.push({ module: step.module, ok: false, error: err.message });
    }
  }

  onOutput(`[PERFIL] Aplicación del ${profile.name} completada.`);
  return { ok: true, profileId, dryRun, results };
}
