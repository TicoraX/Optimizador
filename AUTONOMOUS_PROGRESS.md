# Bitácora de Desarrollo Autónomo — Optimizador D1

**Rama Activa**: `experiment/autonomous-explorer`  
**Última Actualización**: 2026-08-19  
**Ingeniero**: Senior Full-Stack & System Engineer (Antigravity)

---

## 1. Mejoras Implementadas y Verificadas (100% Autónomo)

### Fase 0: Línea Base y Consolidación de Seguridad
- **Validación de Línea Base**: 127 tests pasando originalmente.
- **Limpieza Segura de Disco (`server/lib/cleanup.js`)**:
  - Implementadas las 9 categorías seguras (`temp`, `windowsUpdate`, `crashDumps`, `devCache`, `shaderCache`, `browserCache`, `thumbnails`, `recycle`, `downloads`).
  - Validación estricta con `realpath`, rechazo de raíces de unidad o profundidad $\le 1$, y soporte integral para `dryRun`.
  - **Commit**: `5170b4b` — `feat(cleanup): implement 9 safe categories with dryRun and realpath validation`.

### Mejora 1: Telemetría de Hardware en Vivo (CPU, RAM, Discos y Uptime)
- **Backend (`server/lib/system.js`)**:
  - `getCpuUsage(sampleMs)`: Cálculo del delta de ticks de CPU (`user`, `sys`, `idle`) de Node.js sin shells externos.
  - `getRamMetrics()`: Total, usado, libre y porcentaje exacto.
  - `getLogicalDisks()`: Parseo seguro CSV de `wmic logicaldisk DriveType=3` sin cuelgues.
  - `getSystemTelemetry()`: Endpoint `GET /api/system/metrics`.
- **Frontend (`frontend/src/components/SystemTelemetry.jsx`)**:
  - Panel interactivo con medidores de carga, barras de estado por color y polling suave de 5s. Integrado en `Dashboard.jsx`.
- **Tests**: `server/tests/system.test.js` (6 tests unitarios).
- **Commit**: `7f10876` — `feat(telemetry): add live CPU, RAM, and Disk telemetry widget with GET /api/system/metrics`.

### Mejora 2: Desglose Gráfico de Categorías de Limpieza de Almacenamiento
- **Backend (`server/lib/cleanup.js`)**:
  - Exportación de `cleanup-items.json` estructurado con peso en MB y nivel de riesgo (`SAFE` vs `CAUTION`).
- **Frontend (`frontend/src/components/CleanupBreakdownChart.jsx`)**:
  - Gráfico interactivo con `Recharts` (código diferido/code-split) que permite alternar selección de categorías desde el gráfico o tarjetas.
- **Tests**: `server/tests/cleanup.test.js`.
- **Commit**: `62103b2` — `feat(cleanup): add visual interactive storage category breakdown chart with safety badges`.

### Mejora 3: Gestor de Puntos de Restauración de Windows
- **Backend (`server/lib/restore.js`)**:
  - `getRestorePoints()`: Consulta segura de puntos existentes con PowerShell (`Get-ComputerRestorePoint`).
  - `createRestorePoint(description)`: Validación estricta anti-inyección y creación de puntos de seguridad.
  - Endpoints `GET /api/restore/points` y `POST /api/restore/create`.
- **Frontend (`frontend/src/components/RestoreManager.jsx`)**:
  - Vista completa en `/restauracion` para crear y listar puntos de restauración previos a cambios.
- **Tests**: `server/tests/restore.test.js` (5 tests unitarios).
- **Commit**: `0b79153` — `feat(restore): add Windows System Restore points manager with creation API and UI`.

### Mejora 4: Timeline Unificado y Auditoría de Escaneos
- **Backend (`server/lib/shared.js`)**:
  - `recordScanSnapshot(moduleKey, counts)`: Registro automático en `scan-timeline.json` (FIFO max 100).
  - Endpoint `GET /api/timeline`.
- **Frontend (`frontend/src/components/History.jsx`)**:
  - Pestañas duales: *Diario de Cambios* (con deshacer atómico) y *Línea de Tiempo de Escaneos* con filtro por módulo y acceso directo a reportes.
- **Tests**: `server/tests/shared.test.js`.
- **Commit**: `00936c3` — `feat(history): add unified scan timeline tracking and audit history tab`.

### Mejora 5: Optimizador de Rendimiento Gráfico & Latencia (Gaming & GPU Optimizations)
- **Backend (`server/lib/gaming.js`)**:
  - Ajustes de bajo nivel: *Hardware-Accelerated GPU Scheduling (HAGS)* (`HwSchMode`), *Game Mode* (`AllowAutoGameMode`), *Game DVR Background Recording* (`GameDVR_Enabled`), *FSE Behavior Mode*, *Multimedia Network Throttling Index* y *System Responsiveness*.
  - Detección de GPU activa vía WMI.
  - Reversión atómica y registro en `changes.json`.
- **Frontend**:
  - Registro de módulo `gaming` en `frontend/src/modules.js` e integración interactiva en `ReportViewer.jsx`.
- **Tests**: `server/tests/gaming.test.js` (4 tests unitarios).
- **Commit**: `83cba91` — `feat(gaming): add Gaming & GPU performance optimization module with reversible registry tweaks`.

### Mejora 6: Buscador de Archivos Gigantes (Large Files & Space Hogs Hunter)
- **Backend (`server/lib/largefiles.js`)**:
  - Escaneo recursivo asíncrono con control de profundidad en carpetas de usuario (`Downloads`, `Videos`, `Documents`, `Desktop`, `Temp`).
  - Clasificación automática por tipo (`.iso`, `.vmdk`, `.mp4`, `.zip`, `.msi`, `.dmp`).
  - Endpoints `GET /api/large-files` (filtro por tamaño mínimo en MB) y `POST /api/large-files/reveal` (apertura segura con `explorer.exe /select`).
- **Frontend (`frontend/src/components/LargeFilesHunter.jsx`)**:
  - Vista completa en `/archivos-grandes` con selector de umbral (100MB a 5GB), búsqueda en vivo, filtro por categoría y botón para abrir en el Explorador.
- **Tests**: `server/tests/largefiles.test.js` (3 tests unitarios).
- **Commit**: `760c590` — `feat(large-files): add Large Files & Space Hogs Hunter with category filtering and Explorer reveal`.

### Mejora 7: Auditor de Integridad de Componentes de Windows (`DISM` / `SFC` Health Check)
- **Backend (`server/lib/integrity.js`)**:
  - Auditoría de salud del almacén de componentes de Windows (`DISM /Online /Cleanup-Image /CheckHealth`) y verificación de integridad de archivos (`SFC /verifyonly`).
  - Mantenimiento opcional para purga de componentes obsoletos (`DISM /StartComponentCleanup`).
  - Módulo registrado en `server/server.js` y `server/lib/shared.js`.
- **Frontend**:
  - Módulo `integrity` en `frontend/src/modules.js` y opciones interactivas en `ReportViewer.jsx`.
- **Tests**: `server/tests/integrity.test.js` (3 tests unitarios).
- **Commit**: `67478c7` — `feat(integrity): add Windows Component Store and protected files integrity audit (DISM, SFC, WinSxS cleanup)`.

### Mejora 8: Widget de Diagnóstico Global 0-100 y One-Click Optimizer
- **Backend (`server/lib/healthscore.js`)**:
  - Motor de cálculo algorítmico de salud global (0-100) evaluando los 6 pilares: Almacenamiento, Memoria RAM, Inicio, Actualizaciones, Privacidad y Gaming.
  - Generación de lista estructurada de *Quick Fixes* seguros.
  - Endpoints `GET /api/health-score` y `POST /api/quick-optimize` (con soporte para `dryRun`).
- **Frontend (`frontend/src/components/HealthScoreCard.jsx`)**:
  - Medidor radial / circular gauge con grado dinámico (Excelente, Bueno, Regular, Crítico).
  - Barras horizontales por pilar y botón de *Optimización Rápida en 1-Clic* con modo simulación. Integrado en cabecera de `Dashboard.jsx`.
- **Tests**: `server/tests/healthscore.test.js` (3 tests unitarios).
- **Commit**: `63c2695` — `feat(healthscore): add Global Health Score gauge (0-100) with pillar breakdown and One-Click Quick Optimizer`.

### Mejora 9: Gestor de Menú Contextual (Clic Derecho)
- **Backend (`server/lib/contextmenu.js`)**:
  - Escaneo de handlers de shell registrados en el registro (`HKCR\*\shellex\ContextMenuHandlers`, etc.).
  - Detección de handlers nativos protegidos de Microsoft vs extensiones de terceros (WinRAR, 7-Zip, Notepad++, etc.).
  - Desactivación y activación reversible (`changes.json`).
- **Frontend**:
  - Módulo `contextmenu` en `modules.js` y vista interactiva en `ReportViewer.jsx`.
- **Tests**: `server/tests/contextmenu.test.js` (3 tests unitarios).
- **Commit**: `1020fb6` — `feat(contextmenu): add Windows Explorer context menu handlers optimizer with reversible shell tweaks`.

### Mejora 10: Auditor y Debloater OEM de Fabricantes
- **Backend (`server/lib/oemdebloat.js`)**:
  - Base de datos curada de firmas de telemetría de Dell, HP, Lenovo, ASUS, Razer y Corsair.
  - Escaneo CSV de servicios en ejecución y cambio seguro a inicio `demand` (Manual) o `disabled` con reversión en `changes.json`.
- **Frontend**:
  - Módulo `oemdebloat` en `modules.js` y configuración por modo (Manual vs Deshabilitar) en `ReportViewer.jsx`.
- **Tests**: `server/tests/oemdebloat.test.js` (3 tests unitarios).
- **Commit**: `510f531` — `feat(oemdebloat): add OEM bloatware & manufacturer background services optimizer with manual/disable modes`.

### Mejora 11: Exportador de Informes Técnicos del Sistema
- **Backend (`server/lib/exportreport.js`)**:
  - Consolidación de telemetría, health score, estado de módulos y diario de cambios en formatos Markdown y JSON.
  - Endpoint `GET /api/system/export?format=markdown|json` con cabeceras de descarga `attachment`.
- **Frontend**:
  - Botón de descarga de informe `.md` en la cabecera de `Dashboard.jsx`.
- **Tests**: `server/tests/exportreport.test.js` (2 tests unitarios).
- **Commit**: `c48740f` — `feat(export): add technical system audit report generator with Markdown/JSON export and Dashboard download button`.

### Mejora 12: Medidor y Optimizador de Temporizadores del Sistema (`timers` / BCD Clock)
- **Backend (`server/lib/timers.js`)**:
  - Ajustes de temporización y latencia de interrupciones DPC en arranque BCD: `disabledynamictick` (evita cambios bruscos de reloj en CPUs multi-core), `useplatformclock` (control de HPET vs TSC) y `tscsyncpolicy`.
  - Reversión atómica y segura mediante `bcdedit /set` y `bcdedit /deletevalue`.
- **Frontend**:
  - Módulo `timers` en `modules.js` y selección granular en `ReportViewer.jsx`.
- **Tests**: `server/tests/timers.test.js` (3 tests unitarios).
- **Commit**: `3bcd0ef` — `feat(timers): add high-precision system timer & DPC latency optimizer with reversible bcdedit tweaks`.

### Mejora 13: Limpiador de Drivers y Dispositivos Fantasma Huérfanos (`ghostdevices`)
- **Backend (`server/lib/ghostdevices.js`)**:
  - Identificación y purga segura de registros de periféricos y dispositivos USB desconectados acumulados mediante `pnputil /enum-devices /disconnected` y `pnputil /remove-device`.
  - Filtro estricto de protección para excluir infraestructura crítica (`ACPI`, `ROOT`, `Processor`, `System`, `Firmware`).
- **Frontend**:
  - Módulo `ghostdevices` en `modules.js` y panel de selección en `ReportViewer.jsx`.
- **Tests**: `server/tests/ghostdevices.test.js` (3 tests unitarios).
- **Commit**: `2800635` — `feat(ghostdevices): add orphaned and disconnected PnP ghost devices auditor with safe peripheral cleanup`.

### Mejora 14: Navegación Estructurada y Jerarquía Visual de Módulos
- **Frontend (`frontend/src/App.jsx`, `frontend/src/index.css`)**:
  - Organización del menú lateral (rail de navegación) en secciones semánticas (*Principal* vs *Módulos de Optimización*).
  - Títulos de sección compactos con tipografía y tracking calibrados (`.nav-section-title`).
- **Commit**: `e03c200` — `feat(ui): organize navigation rail into categorized sections with improved visual hierarchy`.

### Mejora 15: Medidor y Optimizador de Windows Search & Indexer (`searchindex`)
- **Backend (`server/lib/searchindex.js`)**:
  - Ajustes de políticas de I/O y CPU: `PreventIndexingLowDiskSpaceMB` (margen de 5GB), `AllowIndexingEncryptedStoresOrItems` (protección de archivos cifrados), `PreventIndexingUncachedRemoteFiles` y `DisableWebSearch`.
  - Auditoría de estado del servicio `WSearch`.
  - Reversión atómica y registro en `changes.json`.
- **Frontend**:
  - Módulo `searchindex` en `modules.js` y selección granular en `ReportViewer.jsx`.
- **Tests**: `server/tests/searchindex.test.js` (3 tests unitarios).
- **Commit**: `da4aa4c` — `feat(searchindex): add Windows Search indexer optimizer with I/O policies, low-disk safeguards and web search disabling`.

### Mejora 16: Monitor y Limpiador de Caché DNS y Pila de Red (`dnsflush`)
- **Backend (`server/lib/dnsflush.js`)**:
  - Consulta y análisis de entradas cacheadas con `ipconfig /displaydns`.
  - Operaciones de mantenimiento: `ipconfig /flushdns`, `ipconfig /registerdns`, `nbtstat -R` (purga NetBIOS) y `nbtstat -RR` (liberación WINS).
- **Frontend**:
  - Módulo `dnsflush` en `modules.js` y selector de acciones en `ReportViewer.jsx`.
- **Tests**: `server/tests/dnsflush.test.js` (3 tests unitarios).
- **Commit**: `6f773c6` — `feat(dnsflush): add DNS resolver cache flush, NetBIOS table purging and WINS registration tool`.

### Mejora 17: Optimizador de Privacidad en Red y Telemetría Conectada (`networkprivacy`)
- **Backend (`server/lib/networkprivacy.js`)**:
  - Bloqueo de telemetría de red: WiFi Sense auto-connect (`AutoConnectAllowedOEM`), descargas de fondo de Windows Spotlight (`DisableWindowsSpotlightFeatures`), apps promocionadas silenciosas (`DisableWindowsConsumerFeatures`) y pre-carga / pre-renderizado de Edge (`NetworkPredictionOptions`).
  - Reversión atómica en `changes.json`.
- **Frontend**:
  - Módulo `networkprivacy` en `modules.js` e integración en `ReportViewer.jsx`.
- **Tests**: `server/tests/networkprivacy.test.js` (2 tests unitarios).
- **Commit**: `8edcc22` — `feat(networkprivacy): add connected network telemetry and privacy optimizer with WiFi Sense, Spotlight, and Edge pre-fetching restrictions`.

### Mejora 18: Gestor y Optimizador de Memoria Virtual y Archivo de Paginación (`pagefile`)
- **Backend (`server/lib/pagefile.js`)**:
  - Directivas de `Memory Management`: `DisablePagingExecutive` (fuerza kernel y controladores en RAM física, ideal para equipos >=16GB), `LargeSystemCache` (prioridad de RAM a juegos y aplicaciones) y `ClearPageFileAtShutdown` (apagado rápido sin sobrescrito de ceros en `pagefile.sys`).
  - Detección de archivos de paginación existentes (`ExistingPageFiles`).
  - Reversión atómica en `changes.json`.
- **Frontend**:
  - Módulo `pagefile` en `modules.js` e integración interactiva en `ReportViewer.jsx`.
- **Tests**: `server/tests/pagefile.test.js` (2 tests unitarios).
- **Commit**: `2f4a683` — `feat(pagefile): add virtual memory management and pagefile optimizer with DisablePagingExecutive and fast shutdown tweaks`.

### Mejora 19: Optimizador de Informes de Errores y Telemetría de Fallos WerFault (`werfault`)
- **Backend (`server/lib/werfault.js`)**:
  - Directivas de Windows Error Reporting: `Disabled` (previene pausas por recolección de volcados de memoria hacia Microsoft), `DontShowUI` (cierra procesos colgados sin cuadros de diálogo emergentes bloqueantes), `DontSendAdditionalData` (bloquea el envío de volcados de memoria y archivos personales) y `LoggingDisabled` (reduce la saturación de I/O en disco por logs de sucesos).
  - Reversión atómica en `changes.json`.
- **Frontend**:
  - Módulo `werfault` en `modules.js` e integración interactiva en `ReportViewer.jsx`.
- **Tests**: `server/tests/werfault.test.js` (2 tests unitarios).
- **Commit**: `f350188` — `feat(werfault): add Windows Error Reporting and WerFault telemetry optimizer with crash dialog and minidump suppression`.

### Mejora 20: Barrido Integral de Calidad, Robustez y Cohesión de Arquitectura
- **Documentación, Scripts y Electron**:
  - `README.md`: Actualizadas referencias de módulos (de 9 a 21) en la arquitectura del proyecto, estructura de carpetas y comandos de PowerShell.
  - `scripts/Notify.ps1`: Expandido `ValidateSet` a los 21 módulos válidos.
  - `scripts/Apply-Hosts.ps1`: Retorno seguro de `HashSet` con el operador coma `,` para evitar desenrollado en pipeline.
  - `electron/main.cjs`: Validación exacta de `new URL(url).origin !== APP_ORIGIN` en `will-navigate` para evitar spoofing de origen.
- **Frontend y Accesibilidad**:
  - `frontend/package.json`: Script de test multiplataforma compatible con Windows (`node --test "src/lib/*.test.js"`).
  - `frontend/src/main.jsx`: Import de `@fontsource/inter/700.css` para soportar títulos `.nav-section-title`.
  - `frontend/src/styles/tokens.css` y `index.css`: Definición y uso de tokens `--color-well-ink`, `--color-well-ink-2`, `--color-well-ink-3` en terminal, visor de logs y bloques de código Markdown. Eliminado selector huérfano `.module-card[data-span='wide']`.
  - `frontend/src/modules.js`: Manejo de `NaN` en `fmtSize` y descripciones técnicas para los 21 módulos.
  - `frontend/src/components/ReportViewer.jsx`: Uso dinámico de `MODULES[module]?.description`, reseteo limpio de `adblock`, validaciones `Array.isArray`, claves estables `regPath` en `contextmenu`, y filtrado sobre `availableCategories` en `cleanup`.
  - `frontend/src/components/Dashboard.jsx`: Enlace directo a `/system/export?format=markdown`, seguimiento de timeout en `handleScan`, y cálculo puro de orden y visibilidad de tarjetas.
  - `frontend/src/components/HealthScoreCard.jsx`: Protección contra división por cero en `pct` y panel de error en línea sin `alert` bloqueante.
  - `frontend/src/components/History.jsx`, `LargeFilesHunter.jsx`, `LogViewer.jsx`, `RestoreManager.jsx`, `Scheduler.jsx`, `SystemTelemetry.jsx`, `Terminal.jsx`: Manejo de señales `AbortController`, verificación `res.ok`, pausa en `visibilitychange`, roles ARIA `progressbar`.
  - `frontend/src/lib/markdown.test.js`: Pruebas de rechazo de links `javascript:` y valores nulos/indefinidos (7/7 tests pasando).
- **Backend y Servicios del Sistema**:
  - `server/lib/shared.js`: Captura de errores en `makeLogger` con `try-catch`, lectura y escritura síncrona atómica de `appendChange` y `recordScanSnapshot`, manejo de `child.on('error')` en `killTree`, y función compartida `queryRegistryValue(key, value)`.
  - `server/lib/changes.js`: Desglose seguro de claves simples en `splitRegTarget`, re-lectura fresca del diario en `undoChange`, y separación de argumentos `start=` en `sc.exe`.
  - `server/lib/cleanup.js`: `RECYCLE_BIN_ROOT` dinámico según `process.env.SystemDrive` y medición exacta de miniaturas en `dryRun`.
  - `server/lib/contextmenu.js`: Validación contra `CONTEXT_LOCATIONS` antes de tocar el registro.
  - `server/lib/exportreport.js`: Telemetría vinculada en el cálculo de salud y propiedades alineadas con el sistema.
  - `server/lib/ghostdevices.js`: Corrección de clase `volumesnapshot`.
  - `server/lib/integrity.js`: Fallback a `DESCONOCIDO` ante salidas imprevistas de DISM/SFC, error 400 en ausencia de acciones y timeouts extendidos a 15m.
  - `server/lib/largefiles.js`: Validación estricta de rutas con letra de unidad, rechazo de UNC y verificación de existencia antes de lanzar el Explorador.
  - `server/lib/network.js`: Límite de 50MB y timeout de 15s en pruebas bajo carga.
  - `server/lib/networkprivacy.js` y `pagefile.js`: Uso centralizado de `queryRegistryValue`, metadatos `valueType` en guard y notas de advertencia física en el archivo de paginación.
  - `server/lib/oemdebloat.js`: Corrección tipográfica, fallback de consulta con PowerShell CIM y separación de argumentos `start= demand|disabled` en `sc.exe`.
  - `server/lib/power.js`: Aplanado de bloques anidados y diagnóstico claro en fallos de listado de planes.
  - `server/lib/privacy.js`: Detección independiente de idioma de claves ausentes mediante código de salida 1 de `reg query`.
  - `server/lib/restore.js`: Timeout de 120s, soporte de formato `/Date(ms+-offset)/`, detección de throttling de 24h y reporte fidedigno de estado.
  - `server/lib/services.js`: Comprobación previa de ejecución con `sc query` antes de detener servicios y protección de escritura del manifiesto en `dryRun`.
  - `server/lib/startup.js`: Guard de escritura de manifiesto en `dryRun`.
  - `server/lib/system.js`: Fallback a PowerShell CIM en `getLogicalDisks` y derivación matemática exacta de porcentajes de disco.
  - `server/lib/timers.js`: Timeout de 5s en `bcdedit` y aviso de reinicio requerido.
  - `server/lib/searchindex.js`: Renombrado semántico de directiva web search y metadatos `valueType`.
  - `server/lib/gaming.js`: Validación 400 ante configuración vacía y fallback CIM para detección de GPU.
  - `server/server.js`: Rate limiting específico y validación de listas en `POST /api/quick-optimize`, e inyección de parámetros contextuales por módulo.

### Mejora 21: Auditoría Modular Exhaustiva, Paralelización y Reversibilidad Ampliada
- **Updates (`updates.js` y `updates.test.js`)**:
  - Paralelización concurrente del escaneo de 4 gestores (`winget`, `pip`, `npm`, `choco`) con `Promise.all` y reporte de progreso individual (reduciendo el tiempo total al estar acotado por el gestor individual más lento en lugar de la suma secuencial).
  - Soporte de modo simulación (`dryRun`) y polimorfismo de argumentos en `runUpdatesActionNative`.
  - Nueva suite de pruebas unitarias (`server/tests/updates.test.js`).
- **Cleanup (`cleanup.js`)**:
  - Incorporación de cachés de desarrollo modernas (`uv`, `pnpm`, `cargo`) y navegadores (`Arc`, `Vivaldi`, `Opera`) en la whitelist de rutas seguras.
- **RAM (`ram.js`)**:
  - Métricas instantáneas de memoria total y libre mediante API nativa `os.totalmem()` / `freemem()` de Node.js, independiente de la disponibilidad de `wmic`.
- **Apps (`apps.js`)**:
  - Soporte de alias de selección (`OPTIMIZE_APPS`, `ITEMS`, `APPS`).
- **AdBlock (`adblock.js`)**:
  - Nuevas fuentes curadas de hosts (`adaway` y `danpollock`).
- **Ghost Devices (`ghostdevices.js`)**:
  - Protección de buses de hardware e infraestructura base (`HTREE\`, `PCI\`, `UEFI\`).
- **Network (`network.js` y `network.test.js`)**:
  - Soporte de simulación `dryRun` y progreso `onProgress` en la purga/registro DNS.
  - Pruebas unitarias de acción en `network.test.js`.
- **Services (`services.js`)**:
  - Emisión de progreso en tiempo real durante la detención y desactivación de servicios.
- **Power (`power.js`, `changes.js` y `power.test.js`)**:
  - Integración de `makeGuard` y reversibilidad atómica de esquemas de energía en `changes.json` (`REVERTERS.power`).
  - Nueva suite de pruebas unitarias (`server/tests/power.test.js`).
- **Network Privacy (`networkprivacy.js` y `networkprivacy.test.js`)**:
  - Nueva directiva de desactivación de sondeo activo NCSI (`ncsi_passive` / `EnableActiveProbing=0`).
- **Privacy (`privacy.js` y `privacy.test.js`)**:
  - Resolución dual de selección por identificador textual (`telemetry`, `ads`) o índice numérico (`1`, `2`).
  - Nueva suite de pruebas unitarias (`server/tests/privacy.test.js`).
### Mejora 22: Telemetría de Red y Bento Grid 4-Cards de Hardware
- **Backend (`system.js` y `system.test.js`)**:
  - Incorporación de `getNetworkInterfacesSummary` para extracción instantánea (0ms) de interfaces de red activas no internas, IP local, máscara y MAC mediante API nativa de Node.js.
  - Inclusión de array `network` en la respuesta de `/api/system/metrics` y `getSystemTelemetry`.
  - Nueva prueba unitaria en `server/tests/system.test.js`.
- **Frontend (`SystemTelemetry.jsx`)**:
  - Ampliación del dashboard de telemetría a una cuadrícula Bento de 4 tarjetas equilibradas: CPU, RAM, Almacenamiento Local y Red & Conectividad.
  - Renderizado dinámico de adaptadores de red activos, arquitectura del procesador y velocidad en GHz.

### Mejora 23: Paleta Global de Comandos (`Ctrl+K`) y Navegación Rápida
- **Frontend (`CommandPalette.jsx` y `App.jsx`)**:
  - Implementación de la paleta modal global `CommandPalette` activable mediante el atajo universal `Ctrl+K` / `Cmd+K` o botón en la barra lateral.
  - Búsqueda por texto y filtrado instantáneo por palabras clave a través de los 21 módulos, 5 vistas principales (Dashboard, Historial, Restauración, Archivos Grandes, Programador) y acciones rápidas (descarga de informes en Markdown y JSON, cambio de tema).
  - Navegación por teclado completa (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`) con desenfoque de fondo y diseño adaptado a los tokens de diseño de la aplicación.

### Mejora 24: Mini-Sparklines de Tendencia en Vivo y Búsqueda en Listas de Módulos
- **Frontend (`SystemTelemetry.jsx`)**:
  - Componente `MiniSparkline` con renderizado SVG vectorial ultraligero (0 dependencias) que traza la curva histórica de las últimas 15 muestras en tiempo real de uso de CPU y RAM con gradiente y código de color según nivel de carga.
- **Frontend (`ItemCheckboxList.jsx`)**:
  - Incorporación automática de barra de búsqueda y filtrado en vivo para listas con más de 5 elementos (aplicaciones, servicios, ajustes de privacidad, etc.), permitiendo localizar elementos por nombre, descripción o ruta preservando los índices originales para selecciones atómicas.

### Mejora 26: Corrección Crítica en Deserialización y Envío de Parámetros de Acción
- **Backend (`server/server.js`)**:
  - Corrección de la extracción de `req.body.settings`, `req.body.actions`, `req.body.handlers`, `req.body.devices` y `req.body.mode` en la ruta `POST /api/action/:module`.
  - Mapeo correcto y seguro a `envVars.SETTINGS`, `envVars.ACTIONS`, `envVars.HANDLERS`, `envVars.DEVICES`, `envVars.SERVICES`, `envVars.APPS`, `envVars.PRIVACY` y `envVars.MODE`.
  - Actualización de `SELECTION_FIELDS` para los 21 módulos, eliminando el fallo donde módulos como *Gaming*, *Integridad*, *Menú Contextual*, *OEM Debloat*, *Timers*, *Dispositivos Fantasma*, *Windows Search*, *DNS Flush*, *Privacidad de Red*, *Memoria Virtual* y *WerFault* arrojaban erróneamente "No se seleccionó ningún elemento".
- **Frontend (`ItemCheckboxList.jsx`)**:
  - Alineación total de la selección de checkboxes con el hook `useModuleItems`, garantizando que la marcación/desmarcación por índice se mantenga fiel a los elementos originales incluso bajo filtrado de búsqueda.
- **Suite de Pruebas (`server/tests/action-params.test.js`)**:
  - 13 nuevas pruebas unitarias automatizadas que verifican la recepción y ejecución en `dryRun` de parámetros para todos los módulos genéricos.

---

## 2. Estado de Calidad y Verificación
- **Tests Unitarios Backend**: **212 / 212 tests pasando al 100%** (48 suites de test completas).
- **Tests Unitarios Frontend**: **7 / 7 tests pasando al 100%**.
- **Total Tests Automatizados**: **219 / 219 tests pasando exitosamente**.
- **Compilación del Frontend**: **0 errores / 0 advertencias**, bundles y chunks de Vite v8.0.16 optimizados.
- **Empaquetado Electron (v1.3.0)**:
  - Ejecutable binario descomprimido generado en `dist/win-unpacked/Optimizador.exe`.
  - Instalador autónomo final generado en `dist/Optimizador Setup 1.3.0.exe` (83.5 MB).
- **Seguridad y Reversibilidad**: Todos los cambios de registro, servicios, esquemas de energía y BCD quedan anotados en `changes.json` con restauración atómica y soporte para modo simulación (`dryRun`).
