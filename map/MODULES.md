# Catálogo Maestro de Módulos (map/MODULES.md)

Tabla de referencia técnica de los 23 módulos de optimización. Cada fila resume el contrato entre Backend, Frontend y Pruebas.

## Matriz de Módulos de Optimización

| Clave | Archivo Backend | Función Escaneo | Claves Selección (`envVars`) | Config UI (`panelConfig.js`) | Test Automatizado |
|---|---|---|---|---|---|
| `updates` | `lib/updates.js` | `runUpdatesScanNative` | `PACKAGES`, `ITEMS` | `packages` (csv) | `tests/updates.test.js`, `tests/updates-tdd.test.js` |
| `cleanup` | `lib/cleanup.js` | `runCleanupScanNative` | `CLEAN_CATEGORIES` | `cleanCategories` (array) | `tests/cleanup.test.js` |
| `startup` | `lib/startup.js` | `runStartupScanNative` | `OPTIMIZE_PROGRAMS`, `OPTIMIZE_TASKS` | Panel específico (`StartupPanel.jsx`) | `tests/actions.test.js` |
| `ram` | `lib/ram.js` | `runRamScanNative` | `OPTIMIZE_PROCESSES`, `CLEAN_MODE`, `MIN_RAM_MB` | Panel específico (`RamPanel.jsx`) | `tests/actions.test.js` |
| `services` | `lib/services.js` | `runServicesScanNative` | `SERVICES`, `OPTIMIZE_SERVICES` | `services` (csv) | `tests/actions.test.js` |
| `apps` | `lib/apps.js` | `runAppsScanNative` | `APPS`, `OPTIMIZE_APPS` | `apps` (csv) | `tests/actions.test.js` |
| `privacy` | `lib/privacy.js` | `runPrivacyScanNative` | `PRIVACY`, `OPTIMIZE_PRIVACY` | `privacy` (csv) | `tests/actions.test.js` |
| `power` | `lib/power.js` | `runPowerScanNative` | `PLAN_GUID` | Panel específico | `tests/actions.test.js` |
| `gaming` | `lib/gaming.js` | `runGamingScanNative` | `SETTINGS` | `settings` (csv) | `tests/gaming.test.js` |
| `smartdisk` | `lib/smartdisk.js` | `runSmartDiskScanNative` | `ACTIONS`, `DISKS` | `actions` (csv) | `tests/smartdisk.test.js` |
| `shadercache` | `lib/shadercache.js` | `runShaderCacheScanNative` | `CACHES` | `caches` (csv) | `tests/shadercache.test.js` |
| `integrity` | `lib/integrity.js` | `runIntegrityScanNative` | `ACTIONS` | `actions` (csv) | `tests/integrity.test.js` |
| `contextmenu` | `lib/contextmenu.js` | `runContextMenuScanNative` | `HANDLERS` | `handlers` (csv) | `tests/contextmenu.test.js` |
| `oemdebloat` | `lib/oemdebloat.js` | `runOemDebloatScanNative` | `SERVICES`, `OPTIMIZE_SERVICES`, `MODE` | `services` (csv) | `tests/oemdebloat.test.js` |
| `timers` | `lib/timers.js` | `runTimersScanNative` | `SETTINGS` | `settings` (csv) | `tests/timers.test.js` |
| `ghostdevices` | `lib/ghostdevices.js` | `runGhostDevicesScanNative` | `DEVICES` | `devices` (csv) | `tests/ghostdevices.test.js` |
| `searchindex` | `lib/searchindex.js` | `runSearchIndexScanNative` | `SETTINGS` | `settings` (csv) | `tests/searchindex.test.js` |
| `dnsflush` | `lib/dnsflush.js` | `runDnsFlushScanNative` | `ACTIONS` | `actions` (csv) | `tests/dnsflush.test.js` |
| `networkprivacy`| `lib/networkprivacy.js`| `runNetworkPrivacyScanNative` | `SETTINGS` | `settings` (csv) | `tests/networkprivacy.test.js` |
| `pagefile` | `lib/pagefile.js` | `runPagefileScanNative` | `SETTINGS` | `settings` (csv) | `tests/pagefile.test.js` |
| `werfault` | `lib/werfault.js` | `runWerFaultScanNative` | `SETTINGS` | `settings` (csv) | `tests/werfault.test.js` |
| `network` | `lib/network.js` | `runNetworkScanNative` | N/A (Configuración global) | Panel específico | `tests/e2e-qa-safe.test.js` |
| `adblock` | `lib/adblock.js` | `runAdblockScanNative` | `ADBLOCK_SOURCES`, `ADBLOCK_ACTION` | Panel específico | `tests/adblock.test.js` |

---

## Servicios Centrales del Servidor (`server/lib/`)

- **`shared.js`**: Infraestructura de ejecución de procesos (`spawnCapture`, `spawnCaptureShell`), sanitización, comprobación de binarios (`commandExists`), logger (`makeLogger`), guardrails (`makeGuard`) y runner SSE (`runNativeOverSSE`).
- **`changes.js`**: Motor inmutable de auditoría y diario de cambios (`changes.json`). Registra `id`, fecha, módulo, valor anterior, valor nuevo y estado `reversible`. Expone `revertChange(id)`.
- **`restore.js`**: API de puntos de restauración nativos de Windows mediante WMI (`SystemRestore.CreateRestorePoint`).
- **`system.js`**: Telemetría en tiempo real de hardware (CPU delta ticks, RAM disponible/total y espacio de almacenamiento de particiones lógicas).
- **`profiles.js`**: Perfiles de optimización preconfigurados (Gaming, Trabajo, Rendimiento Extremo, Batería).
- **`exportreport.js`**: Exportador consolidado del estado del sistema en Markdown y JSON.
