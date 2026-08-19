// ═══════════════════════════════════════════════════════
// Motor de Diagnóstico Global y Health Score (0-100)
//
// Evalúa el estado integral de la máquina a través de 6
// pilares clave (Almacenamiento, Memoria, Inicio, Updates,
// Privacidad y Rendimiento) y sugiere acciones inmediatas.
// ═══════════════════════════════════════════════════════

export function calculateHealthScore(status = {}, telemetry = {}) {
  let score = 100;
  const breakdown = [];
  const quickFixes = [];

  // 1. Almacenamiento (Peso: 20 pts)
  let storageScore = 20;
  const cleanup = status.cleanup || {};
  const tempMb = (cleanup.temp?.total_mb || 0) + (cleanup.browser_cache?.total_mb || 0);
  if (tempMb > 5120) { // > 5 GB
    storageScore -= 12;
  } else if (tempMb > 1024) { // > 1 GB
    storageScore -= 6;
  }
  if (tempMb > 500) {
    quickFixes.push({
      id: 'cleanup',
      title: 'Limpieza de temporales y caché',
      desc: `Recuperar aproximadamente ${(tempMb / 1024).toFixed(1)} GB de archivos residuales.`,
      module: 'cleanup',
      actionEndpoint: '/action/cleanup',
      safety: 'SAFE',
    });
  }
  storageScore = Math.max(0, storageScore);
  breakdown.push({ category: 'Almacenamiento', score: storageScore, max: 20 });
  score -= (20 - storageScore);

  // 2. Memoria RAM (Peso: 20 pts)
  let ramScore = 20;
  const ram = status.ram || {};
  const ramUsage = ram.usagePercent ?? ram.usedPercent ?? telemetry.ram?.usagePercent ?? telemetry.ram?.usedPercent ?? 0;
  if (ramUsage > 85) {
    ramScore -= 12;
  } else if (ramUsage > 70) {
    ramScore -= 6;
  }
  if ((ram.knownProcesses || 0) > 0 && ramUsage > 65) {
    quickFixes.push({
      id: 'ram',
      title: 'Liberar memoria RAM inactiva',
      desc: `Optimizar ${ram.knownProcesses} procesos seguros en segundo plano.`,
      module: 'ram',
      actionEndpoint: '/action/ram',
      safety: 'SAFE',
    });
  }
  ramScore = Math.max(0, ramScore);
  breakdown.push({ category: 'Memoria RAM', score: ramScore, max: 20 });
  score -= (20 - ramScore);

  // 3. Inicio y Arranque (Peso: 15 pts)
  let startupScore = 15;
  const startup = status.startup || {};
  const startupCount = startup.startup_programs?.count || 0;
  if (startupCount > 10) {
    startupScore -= 8;
  } else if (startupCount > 5) {
    startupScore -= 4;
  }
  startupScore = Math.max(0, startupScore);
  breakdown.push({ category: 'Inicio de Sistema', score: startupScore, max: 15 });
  score -= (15 - startupScore);

  // 4. Actualizaciones de Software (Peso: 15 pts)
  let updatesScore = 15;
  const updates = status.updates || {};
  const pendingUpdates = (updates.winget?.count || 0) + (updates.pip?.count || 0) + (updates.npm?.count || 0);
  if (pendingUpdates > 10) {
    updatesScore -= 10;
  } else if (pendingUpdates > 0) {
    updatesScore -= Math.min(8, pendingUpdates * 2);
  }
  updatesScore = Math.max(0, updatesScore);
  breakdown.push({ category: 'Actualizaciones', score: updatesScore, max: 15 });
  score -= (15 - updatesScore);

  // 5. Privacidad y Seguridad (Peso: 15 pts)
  let privacyScore = 15;
  const privacy = status.privacy || {};
  const hasPrivacyScan = privacy.unprotectedCount !== undefined || privacy.hardenedCount !== undefined;
  const unhardened = hasPrivacyScan
    ? (privacy.unprotectedCount ?? ((privacy.totalSettings || 8) - (privacy.hardenedCount || 0)))
    : 0;
  if (unhardened > 4) {
    privacyScore -= 8;
  } else if (unhardened > 0) {
    privacyScore -= unhardened * 1.5;
  }
  if (unhardened > 0) {
    quickFixes.push({
      id: 'privacy',
      title: 'Proteger ajustes de privacidad y telemetría',
      desc: `Aplicar configuración segura a ${unhardened} opciones de Windows.`,
      module: 'privacy',
      actionEndpoint: '/action/privacy',
      safety: 'SAFE',
    });
  }
  privacyScore = Math.max(0, Math.round(privacyScore));
  breakdown.push({ category: 'Privacidad', score: privacyScore, max: 15 });
  score -= (15 - privacyScore);

  // 6. Rendimiento Gráfico & Gaming (Peso: 15 pts)
  let gamingScore = 15;
  const gaming = status.gaming || {};
  const pendingGaming = gaming.pendingCount || 0;
  if (pendingGaming > 3) {
    gamingScore -= 8;
  } else if (pendingGaming > 0) {
    gamingScore -= pendingGaming * 2;
  }
  if (pendingGaming > 0) {
    quickFixes.push({
      id: 'gaming',
      title: 'Acelerar latencia y Modo de Juego',
      desc: `Optimizar ${pendingGaming} ajustes de GPU scheduling y frame pacing.`,
      module: 'gaming',
      actionEndpoint: '/action/gaming',
      safety: 'SAFE',
    });
  }
  gamingScore = Math.max(0, Math.round(gamingScore));
  breakdown.push({ category: 'Rendimiento & Gaming', score: gamingScore, max: 15 });
  score -= (15 - gamingScore);

  score = Math.max(0, Math.min(100, Math.round(score)));

  let grade = 'Excelente';
  let badgeTone = 'is-success';
  if (score < 50) {
    grade = 'Crítico';
    badgeTone = 'is-danger';
  } else if (score < 75) {
    grade = 'Regular';
    badgeTone = 'is-warning';
  } else if (score < 90) {
    grade = 'Bueno';
    badgeTone = 'is-primary';
  }

  return {
    score,
    grade,
    badgeTone,
    breakdown,
    quickFixes,
    fixableCount: quickFixes.length,
  };
}
