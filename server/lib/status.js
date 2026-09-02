import { join } from 'path';
import { MODULES, loadJsonSafe } from './shared.js';

// ═══════════════════════════════════════════════════════
// Estado Consolidado del Sistema (server/lib/status.js)
// ═══════════════════════════════════════════════════════

export function getConsolidatedStatus() {
  const emptyMetrics = { count: 0, error: false };

  const updateCounts = loadJsonSafe(
    join(MODULES.updates.dir, 'reports', MODULES.updates.countsFile),
    { date: null, winget: emptyMetrics, pip: emptyMetrics, npm: emptyMetrics, choco: emptyMetrics },
  );

  const cleanupCounts = loadJsonSafe(
    join(MODULES.cleanup.dir, 'reports', MODULES.cleanup.countsFile),
    { date: null, temp: { total_mb: 0, error: false }, browser_cache: { total_mb: 0, error: false }, downloads: { total_mb: 0, count: 0, error: false }, recycle_bin: { total_mb: 0, count: 0, error: false } },
  );

  const startupCounts = loadJsonSafe(
    join(MODULES.startup.dir, 'reports', MODULES.startup.countsFile),
    { date: null, startup_programs: emptyMetrics, boot_performance: { boot_time_ms: 0, trend: 'unknown', error: false }, auto_services: emptyMetrics, logon_tasks: emptyMetrics },
  );

  const bootHistory = loadJsonSafe(
    join(MODULES.startup.dir, 'reports', 'boot-history.json'),
    [],
  );

  const ramCounts = loadJsonSafe(
    join(MODULES.ram.dir, 'reports', MODULES.ram.countsFile),
    { date: null, total_mb: 0, used_mb: 0, free_mb: 0, usage_percent: 0, total_processes: 0, known_processes: 0, unknown_processes: 0, risky_processes: 0, critical_processes: 0, top_processes: [], error: true },
  );

  return {
    timestamp: new Date().toISOString(),
    updates: {
      lastScan: updateCounts.date,
      winget: updateCounts.winget || emptyMetrics,
      pip: updateCounts.pip || emptyMetrics,
      npm: updateCounts.npm || emptyMetrics,
      choco: updateCounts.choco || emptyMetrics,
    },
    cleanup: {
      lastScan: cleanupCounts.date,
      temp: cleanupCounts.temp || { total_mb: 0, error: false },
      browserCache: cleanupCounts.browser_cache || { total_mb: 0, error: false },
      downloads: cleanupCounts.downloads || { total_mb: 0, count: 0, error: false },
      recycleBin: cleanupCounts.recycle_bin || { total_mb: 0, count: 0, error: false },
    },
    startup: {
      lastScan: startupCounts.date,
      startupPrograms: startupCounts.startup_programs || emptyMetrics,
      bootPerformance: startupCounts.boot_performance || { boot_time_ms: 0, trend: 'unknown', error: false },
      autoServices: startupCounts.auto_services || emptyMetrics,
      logonTasks: startupCounts.logon_tasks || emptyMetrics,
      bootHistory: Array.isArray(bootHistory) ? bootHistory : [bootHistory],
    },
    ram: {
      lastScan: ramCounts.date,
      totalMB: ramCounts.total_mb || 0,
      usedMB: ramCounts.used_mb || 0,
      freeMB: ramCounts.free_mb || 0,
      usagePercent: ramCounts.usage_percent || 0,
      totalProcesses: ramCounts.total_processes || 0,
      knownProcesses: ramCounts.known_processes || 0,
      unknownProcesses: ramCounts.unknown_processes || 0,
      riskyProcesses: ramCounts.risky_processes || 0,
      criticalProcesses: ramCounts.critical_processes || 0,
      topProcesses: Array.isArray(ramCounts.top_processes) ? ramCounts.top_processes : [],
      error: ramCounts.error,
    },
    network: (() => {
      const n = loadJsonSafe(
        join(MODULES.network.dir, 'reports', MODULES.network.countsFile),
        { date: null, dns_cache_entries: 0, avg_ping_ms: null, packet_loss: 0, active_adapters: 0, disconnected_adapters: 0, error: true },
      );
      return {
        lastScan: n.date,
        dnsCacheEntries: n.dns_cache_entries || 0,
        avgPingMs: n.avg_ping_ms,
        jitterMs: n.jitter_ms ?? null,
        p95PingMs: n.p95_ping_ms ?? null,
        firstHopMs: n.first_hop_ms ?? null,
        mtu: n.mtu ?? null,
        powerSavingAdapters: n.power_saving_adapters || 0,
        bufferbloatDeltaMs: n.bufferbloat_delta_ms ?? null,
        bestDns: n.best_dns ?? null,
        packetLoss: n.packet_loss || 0,
        activeAdapters: n.active_adapters || 0,
        disconnectedAdapters: n.disconnected_adapters || 0,
        error: n.error,
      };
    })(),
    services: (() => {
      const s = loadJsonSafe(
        join(MODULES.services.dir, 'reports', MODULES.services.countsFile),
        { date: null, third_party_total: 0, third_party_running: 0, third_party_memory_mb: 0, system_total: 0, system_running: 0, error: true },
      );
      return {
        lastScan: s.date,
        thirdPartyTotal: s.third_party_total || 0,
        thirdPartyRunning: s.third_party_running || 0,
        thirdPartyMemoryMB: s.third_party_memory_mb || 0,
        systemTotal: s.system_total || 0,
        systemRunning: s.system_running || 0,
        error: s.error,
      };
    })(),
    power: (() => {
      const p = loadJsonSafe(
        join(MODULES.power.dir, 'reports', MODULES.power.countsFile),
        { date: null, active_plan: 'N/A', battery_present: false, battery_pct: null, battery_status: null, runtime_min: null, power_watts: null, total_est_watts: null, wear_pct: null, capacity_full_mwh: null, capacity_design_mwh: null, cpu_load: null, cpu_name: null, cpu_tdp: null, cpu_est_watts: null, gpu_name: null, gpu_method: null, gpu_watts: null, gpu_est_watts: null, ram_gb: null, ram_sticks: null, ram_watts: null, disk_count: null, disk_watts: null, mobo_watts: null, other_watts: null, error: true },
      );
      return {
        lastScan: p.date,
        activePlan: p.active_plan || 'N/A',
        batteryPresent: p.battery_present || false,
        batteryPct: p.battery_pct,
        batteryStatus: p.battery_status,
        runtimeMin: p.runtime_min,
        powerWatts: p.power_watts,
        totalEstWatts: p.total_est_watts,
        wearPct: p.wear_pct,
        capacityFullMwh: p.capacity_full_mwh,
        capacityDesignMwh: p.capacity_design_mwh,
        cpuLoad: p.cpu_load,
        cpuName: p.cpu_name,
        cpuTdp: p.cpu_tdp,
        cpuEstWatts: p.cpu_est_watts,
        gpuName: p.gpu_name,
        gpuMethod: p.gpu_method,
        gpuWatts: p.gpu_watts,
        gpuEstWatts: p.gpu_est_watts,
        ramGb: p.ram_gb,
        ramSticks: p.ram_sticks,
        ramWatts: p.ram_watts,
        diskCount: p.disk_count,
        diskWatts: p.disk_watts,
        moboWatts: p.mobo_watts,
        otherWatts: p.other_watts,
        error: p.error,
      };
    })(),
    apps: (() => {
      const a = loadJsonSafe(
        join(MODULES.apps.dir, 'reports', MODULES.apps.countsFile),
        { date: null, apps_count: 0, error: true },
      );
      return {
        lastScan: a.date,
        appsCount: a.apps_count || 0,
        error: a.error,
      };
    })(),
    privacy: (() => {
      const p = loadJsonSafe(
        join(MODULES.privacy.dir, 'reports', MODULES.privacy.countsFile),
        { date: null, total_settings: 8, hardened_count: 0, error: true },
      );
      return {
        lastScan: p.date,
        totalSettings: p.total_settings || 8,
        hardenedCount: p.hardened_count || 0,
        error: p.error,
      };
    })(),
    adblock: (() => {
      const a = loadJsonSafe(
        join(MODULES.adblock.dir, 'reports', MODULES.adblock.countsFile),
        { date: null, activo: false, blockedDomains: 0, listDomains: 0, listAgeDays: null, error: true },
      );
      return {
        lastScan: a.date,
        activo: a.activo === true,
        blockedDomains: a.blockedDomains || 0,
        listDomains: a.listDomains || 0,
        listAgeDays: a.listAgeDays,
        error: a.error,
      };
    })(),
    gaming: (() => {
      const g = loadJsonSafe(
        join(MODULES.gaming.dir, 'reports', MODULES.gaming.countsFile),
        { date: null, gpu: null, optimizedCount: 0, pendingCount: 0, total: 6, error: true },
      );
      return {
        lastScan: g.date,
        gpu: g.gpu || null,
        optimizedCount: g.optimizedCount || 0,
        pendingCount: g.pendingCount || 0,
        total: g.total || 6,
        error: g.error,
      };
    })(),
    integrity: (() => {
      const i = loadJsonSafe(
        join(MODULES.integrity.dir, 'reports', MODULES.integrity.countsFile),
        { date: null, dismStatus: 'DESCONOCIDO', sfcStatus: 'DESCONOCIDO', healthy: true, error: true },
      );
      return {
        lastScan: i.date,
        dismStatus: i.dismStatus || 'DESCONOCIDO',
        sfcStatus: i.sfcStatus || 'DESCONOCIDO',
        healthy: i.healthy !== false,
        error: i.error,
      };
    })(),
    contextmenu: (() => {
      const c = loadJsonSafe(
        join(MODULES.contextmenu.dir, 'reports', MODULES.contextmenu.countsFile),
        { date: null, totalHandlers: 0, thirdPartyCount: 0, activeThirdParty: 0, error: true },
      );
      return {
        lastScan: c.date,
        totalHandlers: c.totalHandlers || 0,
        thirdPartyCount: c.thirdPartyCount || 0,
        activeThirdParty: c.activeThirdParty || 0,
        error: c.error,
      };
    })(),
    oemdebloat: (() => {
      const o = loadJsonSafe(
        join(MODULES.oemdebloat.dir, 'reports', MODULES.oemdebloat.countsFile),
        { date: null, detectedCount: 0, autoCount: 0, error: true },
      );
      return {
        lastScan: o.date,
        detectedCount: o.detectedCount || 0,
        autoCount: o.autoCount || 0,
        error: o.error,
      };
    })(),
    timers: (() => {
      const t = loadJsonSafe(
        join(MODULES.timers.dir, 'reports', MODULES.timers.countsFile),
        { date: null, optimizedCount: 0, pendingCount: 0, total: 3, error: true },
      );
      return {
        lastScan: t.date,
        optimizedCount: t.optimizedCount || 0,
        pendingCount: t.pendingCount || 0,
        total: t.total || 3,
        error: t.error,
      };
    })(),
    ghostdevices: (() => {
      const g = loadJsonSafe(
        join(MODULES.ghostdevices.dir, 'reports', MODULES.ghostdevices.countsFile),
        { date: null, totalCount: 0, safeCount: 0, error: true },
      );
      return {
        lastScan: g.date,
        totalCount: g.totalCount || 0,
        safeCount: g.safeCount || 0,
        error: g.error,
      };
    })(),
    searchindex: (() => {
      const s = loadJsonSafe(
        join(MODULES.searchindex.dir, 'reports', MODULES.searchindex.countsFile),
        { date: null, optimizedCount: 0, pendingCount: 0, total: 4, error: true },
      );
      return {
        lastScan: s.date,
        optimizedCount: s.optimizedCount || 0,
        pendingCount: s.pendingCount || 0,
        total: s.total || 4,
        error: s.error,
      };
    })(),
    dnsflush: (() => {
      const d = loadJsonSafe(
        join(MODULES.dnsflush.dir, 'reports', MODULES.dnsflush.countsFile),
        { date: null, cachedCount: 0, totalActions: 4, error: true },
      );
      return {
        lastScan: d.date,
        cachedCount: d.cachedCount || 0,
        totalActions: d.totalActions || 4,
        error: d.error,
      };
    })(),
    networkprivacy: (() => {
      const n = loadJsonSafe(
        join(MODULES.networkprivacy.dir, 'reports', MODULES.networkprivacy.countsFile),
        { date: null, protectedCount: 0, exposedCount: 0, total: 4, error: true },
      );
      return {
        lastScan: n.date,
        protectedCount: n.protectedCount || 0,
        exposedCount: n.exposedCount || 0,
        total: n.total || 4,
        error: n.error,
      };
    })(),
    pagefile: (() => {
      const p = loadJsonSafe(
        join(MODULES.pagefile.dir, 'reports', MODULES.pagefile.countsFile),
        { date: null, optimizedCount: 0, pendingCount: 0, total: 3, error: true },
      );
      return {
        lastScan: p.date,
        optimizedCount: p.optimizedCount || 0,
        pendingCount: p.pendingCount || 0,
        total: p.total || 3,
        error: p.error,
      };
    })(),
    werfault: (() => {
      const w = loadJsonSafe(
        join(MODULES.werfault.dir, 'reports', MODULES.werfault.countsFile),
        { date: null, optimizedCount: 0, pendingCount: 0, total: 4, error: true },
      );
      return {
        lastScan: w.date,
        optimizedCount: w.optimizedCount || 0,
        pendingCount: w.pendingCount || 0,
        total: w.total || 4,
        error: w.error,
      };
    })(),
    smartdisk: (() => {
      const s = loadJsonSafe(
        join(MODULES.smartdisk.dir, 'reports', MODULES.smartdisk.countsFile),
        { date: null, totalDisks: 0, ssdCount: 0, healthyCount: 0, error: true },
      );
      return {
        lastScan: s.date,
        totalDisks: s.totalDisks || 0,
        ssdCount: s.ssdCount || 0,
        healthyCount: s.healthyCount || 0,
        error: s.error,
      };
    })(),
    shadercache: (() => {
      const c = loadJsonSafe(
        join(MODULES.shadercache.dir, 'reports', MODULES.shadercache.countsFile),
        { date: null, totalMB: '0.00', totalFiles: 0, locationsFound: 0, error: true },
      );
      return {
        lastScan: c.date,
        totalMB: c.totalMB || '0.00',
        totalFiles: c.totalFiles || 0,
        locationsFound: c.locationsFound || 0,
        error: c.error,
      };
    })(),
  };
}
