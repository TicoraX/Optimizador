#!/usr/bin/env node
import { getConsolidatedStatus } from './lib/status.js';
import { getProfiles, applyProfile } from './lib/profiles.js';
import { calculateHealthScore } from './lib/healthscore.js';
import { getSystemTelemetry } from './lib/system.js';
import { MODULES, VALID_MODULES } from './lib/shared.js';
import { runGamingActionNative } from './lib/gaming.js';
import { runCleanupActionNative } from './lib/cleanup.js';
import { runRamActionNative } from './lib/ram.js';
import { runSmartDiskActionNative } from './lib/smartdisk.js';
import { runShaderCacheActionNative } from './lib/shadercache.js';
import { runDnsFlushActionNative } from './lib/dnsflush.js';

// ═══════════════════════════════════════════════════════
// Optimizador D1 — CLI Headless (server/cli.js)
// ═══════════════════════════════════════════════════════

const args = process.argv.slice(2);
const command = (args[0] || '').toLowerCase();
const target = (args[1] || '').toLowerCase();
const isDryRun = args.includes('--dry-run') || args.includes('-d');
const isJson = args.includes('--json') || args.includes('-j');

function printHelp() {
  console.log(`
Uso: optimizador <comando> [opciones]

Comandos disponibles:
  status                Muestra el estado consolidado de todos los módulos
  health                Calcula el Health Score del sistema (0-100)
  profiles              Lista los perfiles de optimización disponibles
  profile <id>          Aplica un perfil predefinido (gaming, work, battery, dev)
  clean                 Ejecuta la limpieza segura de archivos temporales
  ram                   Optimiza la memoria RAM (libera procesos seguros)
  trim                  Ejecuta TRIM en todas las unidades SSD
  shaders               Purga la caché de sombreadores de GPU
  dns                   Purga y renueva la caché de resolución DNS

Opciones:
  --dry-run, -d         Modo simulación (no realiza cambios reales)
  --json, -j            Emite salida formateada en JSON
  --help, -h            Muestra esta ayuda
`);
}

async function main() {
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  if (command === 'status') {
    const status = getConsolidatedStatus();
    if (isJson) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log('=== ESTADO CONSOLIDADO DEL SISTEMA (Optimizador D1) ===');
      console.log(`Módulos registrados: ${VALID_MODULES.length}`);
      for (const [key, data] of Object.entries(status)) {
        console.log(`  - [${key.padEnd(16)}] Último escaneo: ${data.lastScan || 'Pendiente'}`);
      }
    }
    return;
  }

  if (command === 'health') {
    const status = getConsolidatedStatus();
    const telemetry = await getSystemTelemetry();
    const health = calculateHealthScore(status, telemetry);
    if (isJson) {
      console.log(JSON.stringify(health, null, 2));
    } else {
      console.log(`\n=== HEALTH SCORE DEL SISTEMA: ${health.score}/100 [${health.grade || 'Óptimo'}] ===`);
      console.log('\nMétricas evaluadas:');
      for (const m of health.breakdown || []) {
        console.log(`  - ${m.category}: ${m.score}/${m.max} pts`);
      }
      if (health.quickFixes && health.quickFixes.length > 0) {
        console.log('\nAcciones recomendadas inmediatas:');
        for (const f of health.quickFixes) {
          console.log(`  * [${f.module}] ${f.title}: ${f.desc}`);
        }
      }
    }
    return;
  }

  if (command === 'profiles') {
    const list = getProfiles();
    if (isJson) {
      console.log(JSON.stringify(list, null, 2));
    } else {
      console.log('\n=== PERFILES DE OPTIMIZACIÓN DISPONIBLES ===');
      for (const p of list) {
        console.log(`\n[${p.id}] ${p.name}`);
        console.log(`  Descripción: ${p.desc}`);
        console.log(`  Pasos: ${p.stepCount} módulos`);
      }
    }
    return;
  }

  if (command === 'profile') {
    if (!target) {
      console.error('Error: Debes especificar el ID del perfil (ej. optimizador profile gaming)');
      process.exit(1);
    }
    console.log(`Aplicando perfil '${target}' (dryRun: ${isDryRun})...\n`);
    const res = await applyProfile(target, { dryRun: isDryRun }, (line) => console.log(`  ${line}`));
    if (isJson) console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === 'clean') {
    console.log(`Ejecutando limpieza segura de temporales (dryRun: ${isDryRun})...`);
    const res = await runCleanupActionNative(
      { DRY_RUN: isDryRun ? 'true' : 'false', CLEAN_CATEGORIES: 'temp,thumbnails,devCache' },
      (line) => console.log(`  ${line}`),
    );
    if (isJson) console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === 'ram') {
    console.log(`Ejecutando optimización de memoria RAM (dryRun: ${isDryRun})...`);
    const res = await runRamActionNative(
      { DRY_RUN: isDryRun ? 'true' : 'false', CLEAN_MODE: 'soft', MIN_RAM_MB: '50', OPTIMIZE_PROCESSES: '1234' },
      (line) => console.log(`  ${line}`),
    );
    if (isJson) console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === 'trim') {
    console.log(`Ejecutando TRIM en unidades SSD (dryRun: ${isDryRun})...`);
    const res = await runSmartDiskActionNative(
      { DRY_RUN: isDryRun ? 'true' : 'false' },
      (line) => console.log(`  ${line}`),
    );
    if (isJson) console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === 'shaders') {
    console.log(`Purgando caché de sombreadores GPU (dryRun: ${isDryRun})...`);
    const res = await runShaderCacheActionNative(
      { DRY_RUN: isDryRun ? 'true' : 'false' },
      (line) => console.log(`  ${line}`),
    );
    if (isJson) console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === 'dns') {
    console.log(`Purgando y refrescando caché DNS (dryRun: ${isDryRun})...`);
    const res = await runDnsFlushActionNative(
      { DRY_RUN: isDryRun ? 'true' : 'false', ACTIONS: 'flushdns,registers' },
      (line) => console.log(`  ${line}`),
    );
    if (isJson) console.log(JSON.stringify(res, null, 2));
    return;
  }

  console.error(`Comando desconocido: '${command}'. Usa 'optimizador --help' para ver la lista de comandos.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
