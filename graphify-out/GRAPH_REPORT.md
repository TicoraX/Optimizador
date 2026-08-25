# Graph Report - D1  (2026-08-24)

## Corpus Check
- 100 files · ~75,148 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 491 nodes · 1253 edges · 23 communities (22 shown, 1 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 49 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Core Server, Reports & Change Journal
- Apps Management & Winget Integration
- React Frontend UI & Components
- Frontend Linting & Tooling
- Electron Host & Window Lifecycle
- Electron Packaging & Updater Config
- Network Diagnostics & DNS Optimization
- RAM & Process Manager
- Startup Programs & Scheduled Tasks
- Server Dependencies & Express Setup
- Adblock & Hosts Protection
- Disk Cleanup & Cache Eviction
- Large Files Hunter
- Context Menu & Shell Extensions
- System Privacy & Telemetry Directives
- Live System Hardware Telemetry
- Gaming & GPU Optimization
- Server MIME Types

## God Nodes (most connected - your core abstractions)
1. `spawnCapture()` - 80 edges
2. `makeLogger()` - 46 edges
3. `prepareReport()` - 45 edges
4. `finishReport()` - 44 edges
5. `errText()` - 42 edges
6. `makeGuard()` - 39 edges
7. `runStartupActionNative()` - 16 edges
8. `API_BASE` - 13 edges
9. `runCleanupActionNative()` - 11 edges
10. `runNetworkScanNative()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `runAdblockScanNative()` --calls--> `finishReport()`  [EXTRACTED]
  server/lib/adblock.js → server/lib/shared.js
- `runAdblockScanNative()` --calls--> `prepareReport()`  [EXTRACTED]
  server/lib/adblock.js → server/lib/shared.js
- `runAdblockActionNative()` --calls--> `errText()`  [EXTRACTED]
  server/lib/adblock.js → server/lib/shared.js
- `runAdblockActionNative()` --calls--> `makeGuard()`  [EXTRACTED]
  server/lib/adblock.js → server/lib/shared.js
- `runAdblockActionNative()` --calls--> `makeLogger()`  [EXTRACTED]
  server/lib/adblock.js → server/lib/shared.js

## Import Cycles
- None detected.

## Communities (23 total, 1 thin omitted)

### Community 0 - "Core Server, Reports & Change Journal"
Cohesion: 0.05
Nodes (58): listAllChanges(), REVERTERS, undoChange(), generateSystemExport(), getAllChanges(), calculateHealthScore(), createRestorePoint(), getRestorePoints() (+50 more)

### Community 1 - "Apps Management & Winget Integration"
Cohesion: 0.09
Nodes (52): isProtectedApp(), parseWingetList(), PROTECTED_APP_PATTERNS, runAppsActionNative(), runAppsScanNative(), DNS_ACTIONS, parseDisplayDns(), runDnsFlushActionNative() (+44 more)

### Community 2 - "React Frontend UI & Components"
Cohesion: 0.06
Nodes (38): App(), CATEGORY_COLORS, CleanupBreakdownChart(), fmtSize(), CommandPalette(), BootChart, Dashboard(), usePersistedModuleLayout() (+30 more)

### Community 3 - "Frontend Linting & Tooling"
Cohesion: 0.04
Nodes (48): eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, @fontsource/inter, @fontsource/space-grotesk, @fontsource-variable/jetbrains-mono, dependencies (+40 more)

### Community 4 - "Electron Host & Window Lifecycle"
Cohesion: 0.07
Nodes (24): { app, BrowserWindow, dialog, shell }, fs, logFile, os, path, build, appId, extraResources (+16 more)

### Community 5 - "Electron Packaging & Updater Config"
Cohesion: 0.08
Nodes (24): electron, electron-builder, electron-updater, dependencies, electron-updater, express, express-rate-limit, helmet (+16 more)

### Community 6 - "Network Diagnostics & DNS Optimization"
Cohesion: 0.22
Nodes (20): analizarPings(), compararDns(), descubrirMtu(), esRespuesta(), medirBajoCarga(), parseTracert(), percentil(), runNetworkActionNative() (+12 more)

### Community 7 - "RAM & Process Manager"
Cohesion: 0.14
Nodes (19): classifyProcessTier(), CRITICAL_PROCESSES, CRITICAL_SET_LOWER, getProtectedPids(), KNOWN_LOWER, KNOWN_PROCESSES, RISKY_PROCESSES, RISKY_SET_LOWER (+11 more)

### Community 8 - "Startup Programs & Scheduled Tasks"
Cohesion: 0.24
Nodes (17): normalizeSchTaskStatus(), disabledRegistryManifestPath(), getAutoStartServices(), getDisabledShortcuts(), getDisabledStartupItems(), getLogonScheduledTasks(), getRegistryStartupEntries(), getShortcutStartupEntries() (+9 more)

### Community 9 - "Server Dependencies & Express Setup"
Cohesion: 0.11
Nodes (17): dependencies, express, express-rate-limit, helmet, description, engines, node, express (+9 more)

### Community 10 - "Adblock & Hosts Protection"
Cohesion: 0.26
Nodes (13): aplicarHosts(), descargarFuentes(), estadoHosts(), FUENTES, FUENTES_VALIDAS, HOSTS_PATH, leerHosts(), listaPath() (+5 more)

### Community 11 - "Disk Cleanup & Cache Eviction"
Cohesion: 0.50
Nodes (10): deleteOldDownloads(), emptyRecycleBinNative(), getDirSizeBytes(), getDirSizeMB(), getSafeTargets(), measureRecycleBin(), removeDirContents(), removeMatchingFiles() (+2 more)

### Community 12 - "Large Files Hunter"
Cohesion: 0.33
Nodes (9): CATEGORY_MAP, classifyFile(), findLargeFiles(), formatBytes(), getUserScanRoots(), IGNORED_DIR_NAMES, revealInExplorer(), scanDirForLargeFiles() (+1 more)

### Community 13 - "Context Menu & Shell Extensions"
Cohesion: 0.39
Nodes (7): CONTEXT_LOCATIONS, isAllowedContextLocation(), isMicrosoftHandler(), MICROSOFT_BUILTINS, parseRegKeys(), runContextMenuActionNative(), runContextMenuScanNative()

### Community 14 - "System Privacy & Telemetry Directives"
Cohesion: 0.44
Nodes (7): isSafe(), parseRegValue(), PRIVACY_SETTINGS, readRegValue(), runPrivacyActionNative(), runPrivacyScanNative(), statusLabel()

### Community 15 - "Live System Hardware Telemetry"
Cohesion: 0.56
Nodes (7): formatUptime(), getCpuUsage(), getLogicalDisks(), getNetworkInterfacesSummary(), getRamMetrics(), getSystemTelemetry(), parseLogicalDisks()

### Community 16 - "Gaming & GPU Optimization"
Cohesion: 0.54
Nodes (6): detectActiveGPU(), GAMING_SETTINGS, isOptimized(), parseRegDword(), runGamingActionNative(), runGamingScanNative()

## Knowledge Gaps
- **114 isolated node(s):** `fs`, `os`, `path`, `logFile`, `{ app, BrowserWindow, dialog, shell }` (+109 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `build` connect `Electron Host & Window Lifecycle` to `Electron Packaging & Updater Config`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **What connects `fs`, `os`, `path` to the rest of the system?**
  _114 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Core Server, Reports & Change Journal` be split into smaller, more focused modules?**
  _Cohesion score 0.05468215994531784 - nodes in this community are weakly interconnected._
- **Should `Apps Management & Winget Integration` be split into smaller, more focused modules?**
  _Cohesion score 0.08526315789473685 - nodes in this community are weakly interconnected._
- **Should `React Frontend UI & Components` be split into smaller, more focused modules?**
  _Cohesion score 0.0579476861167002 - nodes in this community are weakly interconnected._
- **Should `Frontend Linting & Tooling` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._
- **Should `Electron Host & Window Lifecycle` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._