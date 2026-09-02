# Optimizador — Suite Integral de Mantenimiento y Optimización para Windows

Conjunto de herramientas de optimización y mantenimiento de alto rendimiento para Windows: **23 módulos nativos en Node.js**, motor de perfiles de optimización en 1 clic, interfaz CLI headless para terminal, minimizado a la bandeja del sistema (System Tray), telemetría de hardware en tiempo real, cálculo de Health Score, gestión de puntos de restauración, paleta de comandos rápida (`Ctrl+K`) y panel de control de escritorio (React + Vite + Electron con elevación administrativa UAC).

> Todo el procesamiento y almacenamiento de reportes se ejecuta **localmente en tu equipo**. Sin servicios en la nube ni telemetría propia hacia servidores externos (únicamente *Update Checker* consulta gestores oficiales de paquetes y *AdBlock* descarga listas de dominios públicas).

---

## Qué hace (23 Módulos Nativos)

| Módulo | Qué hace |
|---|---|
| **Update Checker** | Busca actualizaciones en winget (apps/drivers), pip, npm global y Chocolatey en paralelo con `Promise.all`. |
| **Disk Cleanup** | Escanea y limpia archivos temporales, papelera de reciclaje y cachés de desarrollo (`uv`, `pnpm`, `cargo`) y navegadores (`Chrome`, `Edge`, `Firefox`, `Arc`, `Vivaldi`, `Opera`). |
| **Startup Optimizer** | Audita y deshabilita programas, servicios auto-start y tareas de inicio de sesión con manifiesto de reactivación y soporte `dryRun`. |
| **RAM Optimizer** | Análisis instantáneo de consumo de memoria y clasificación por nivel de riesgo (seguro, riesgoso, crítico de sistema). |
| **Network Optimizer** | Diagnostica conectividad, latencia, recuento de caché DNS y adaptadores de red. Permite purga y re-registro. |
| **Services Optimizer** | Lista y clasifica servicios automáticos distinguiendo Microsoft de terceros. Permite detener y deshabilitar servicios innecesarios. |
| **Power Optimizer** | Monitorea el plan activo, batería y consumo estimado. Permite cambio de esquema con reversibilidad atómica en el historial. |
| **App Manager** | Lista aplicaciones instaladas mediante winget y permite desinstalación silenciosa por lotes. |
| **Privacy Optimizer** | Audita y endurece directivas de privacidad de Windows (telemetría, publicidad, Cortana, sensores, diagnósticos). |
| **AdBlock Optimizer** | Bloquea dominios de telemetría y publicidad inyectando fuentes curadas (`adaway`, `danpollock`, `stevenblack`) en el archivo hosts con backup automático. |
| **Gaming Mode** | Optimiza el sistema para juegos: HAGS, GameDVR, optimizaciones de pantalla completa (FSE), DirectStorage y prioridad de GPU. |
| **System Integrity** | Ejecuta verificaciones y reparaciones del almacén de componentes de Windows mediante SFC y DISM con seguimiento en vivo. |
| **Context Menu** | Limpia entradas residuales e innecesarias del menú contextual de Windows sin tocar las del sistema operativo. |
| **OEM Debloat** | Identifica y neutraliza software preinstalado de fabricantes (Dell, HP, Lenovo, ASUS, Acer) sin afectar controladores. |
| **System Timers** | Optimiza la latencia de interrupciones y precisión del reloj BCD (`useplatformclock`, `syntheticclock`, `tscsyncpolicy`). |
| **Ghost Devices** | Detecta dispositivos de hardware desconectados o duplicados en el Administrador de Dispositivos con protección de buses de sistema (`PCI\`, `HTREE\`, `UEFI\`). |
| **Search Indexer** | Optimiza el servicio Windows Search y desactiva la búsqueda web/Bing en el menú Inicio para acelerar búsquedas locales. |
| **DNS Flush** | Purga la caché de resolución DNS y re-registra nombres de host para resolver problemas de conexión. |
| **Network Privacy** | Desactiva protocolos de red inseguros o con fugas de datos (LLMNR, NetBIOS, WPAD, sondeo activo NCSI). |
| **Virtual Memory / Pagefile** | Diagnostica la memoria paginada, paginación del kernel y directivas de administración de memoria. |
| **WerFault Optimizer** | Suprime cuadros de diálogo de cuelgue, generación de minidumps masivos y telemetría de errores de Windows. |
| **SSD Health & TRIM** | Diagnóstico de salud SMART de unidades físicas, verificación de activación TRIM y optimización de desgaste de celdas SSD (`defrag.exe /O /C`). |
| **GPU Shader Cache** | Localiza y purga cachés residuales de sombreadores DirectX, NVIDIA, AMD e Intel para corregir stuttering tras actualizar drivers. |

Cada módulo sigue el mismo patrón:
- **Scan** — lee el sistema y genera un reporte en Markdown, un JSON de conteos y un JSON de elementos seleccionables. No modifica nada.
- **Acción** — toca solo lo que seleccionaste. Se puede simular con `dryRun` antes de aplicar, y cada cambio queda registrado en el historial de cambios (`changes.json`) con soporte de reversión atómica (`undo`).

---

## Características Principales

- **Perfiles de Optimización en 1 Clic**: Presets configurados para escenarios frecuentes (Gaming, Oficina & Productividad, Laptop & Batería, Desarrollador & Compilación) con ejecución encadenada y simulación `dryRun`.
- **CLI Headless para Terminal (`server/cli.js`)**: Ejecución de comandos de diagnóstico, limpieza, optimización de RAM, TRIM y perfiles desde PowerShell/CMD sin interfaz gráfica.
- **Bandeja del Sistema (System Tray)**: La aplicación de escritorio minimiza a segundo plano sin interrumpir procesos, ofreciendo acciones rápidas de optimización desde el menú contextual del icono en la barra de tareas.
- **Telemetría de Hardware en Vivo**: Monitoreo en tiempo real de CPU (uso %, núcleos, GHz, curva histórica SVG), Memoria RAM (usada, libre, %, sparkline en vivo), Almacenamiento Local (espacio libre por partición) y Red & Conectividad (adaptadores activos, IP local, hostname).
- **Paleta Global de Comandos (`Ctrl+K` / `Cmd+K`)**: Buscador instantáneo por teclado para navegar a cualquier módulo, vista principal, alternar modo claro/oscuro o exportar reportes.
- **Health Score & Quick Optimize**: Algoritmo ponderado (0 a 100) que califica la salud general del sistema y ofrece optimización en 1 clic de los módulos más seguros.
- **Cazador de Archivos Grandes (Large Files Hunter)**: Localiza archivos pesados (>100MB) y permite abrirlos directamente en el Explorador de Windows.
- **Gestor de Puntos de Restauración**: Creación, listado y consulta de puntos de restauración de Windows con control de throttling.
- **Elevación Administrativa Integrada (UAC)**: Manifiesto `requireAdministrator` en el instalador de Electron para garantizar que las operaciones sobre el registro del sistema, servicios y BCD se ejecuten sin errores de permisos.

---

## Uso por Terminal (CLI Headless)

El backend incluye una herramienta CLI para ejecutar diagnósticos y mantenimientos directamente desde la terminal:

```powershell
# Ver estado consolidado de todos los módulos
node server/cli.js status

# Calcular Health Score y ver acciones recomendadas
node server/cli.js health

# Listar perfiles disponibles
node server/cli.js profiles

# Aplicar perfil Gaming en modo simulación (dryRun)
node server/cli.js profile gaming --dry-run

# Aplicar perfil Gaming en modo real
node server/cli.js profile gaming

# Ejecutar limpieza segura de temporales
node server/cli.js clean

# Ejecutar optimización de memoria RAM
node server/cli.js ram

# Ejecutar TRIM en unidades SSD
node server/cli.js trim

# Purgar caché de sombreadores de GPU
node server/cli.js shaders
```

---

## Estructura del proyecto

```
Optimizador/
├── server/
│   ├── server.js            # Express: rutas, seguridad, SSE, rate limiting
│   ├── cli.js               # CLI Headless para terminal
│   ├── lib/                 # La logica de los 23 modulos, 100% nativa en Node.js
│   │   ├── shared.js        # Whitelist, validadores, spawn, barrera y diario
│   │   ├── changes.js       # Reversion atomica de cambios aplicados
│   │   ├── status.js        # Estado consolidado desacoplado
│   │   ├── profiles.js      # Motor de perfiles de optimización
│   │   ├── smartdisk.js     # Módulo SMART SSD y TRIM
│   │   ├── shadercache.js   # Módulo de purga de caché de shaders GPU
│   │   └── <modulo>.js      # Un archivo por modulo: scan + accion
│   └── tests/               # Suites de pruebas unitarias y de integracion E2E
├── frontend/                # React + Vite
│   ├── src/modules.js       # Registro declarativo de los 23 modulos
│   ├── src/styles/tokens.css# Sistema de diseno (color, espaciado, tipografia)
│   └── src/components/      # Componentes UI desacoplados y modulares
├── electron/                # App de escritorio (Electron + Tray + electron-updater)
├── scripts/Notify.ps1       # Tareas programadas de notificaciones semanales
└── <modulo>/reports/        # Reportes, conteos, items, logs y diario de cambios
```

---

## Requisitos

- Windows 10 u 11 (64-bit)
- [Node.js 20+](https://nodejs.org/) y `npm >= 9`
- Opcionales, según el módulo: `winget`, `pip`, `npm`, `choco`. Los que falten se omiten sin error.

---

## Inicio rápido — App de escritorio (Electron)

La forma más simple de correr el proyecto: una sola app instalable que empaqueta el backend y el dashboard, con elevación UAC y auto-actualización vía GitHub Releases.

```powershell
git clone https://github.com/TicoraX/Optimizador.git
cd Optimizador
npm ci                     # instalacion reproducible desde lockfile
npm run build:frontend     # compila el frontend y dependencias
npx electron .              # abre la app
```

Para generar el instalador `.exe`:

```powershell
npm run dist       # genera el instalador en dist/, sin publicar
npm run release    # genera y lo publica como GitHub Release (requiere GITHUB_TOKEN con permiso repo)
```

---

## Inicio rápido — Modo Servidor Web

Si preferís correr solo el backend y abrir el dashboard en tu navegador (`http://localhost:5173` en desarrollo o `http://localhost:3001` con build estático):

```powershell
# En una terminal — Backend
cd server
npm start

# En otra terminal — Frontend (modo desarrollo)
cd frontend
npm run dev
```

---

## Seguridad

El proyecto implementa un modelo de seguridad por capas auditado contra las guías OWASP y STRIDE:

1. **Localhost Binding Estricto**: El servidor Express se enlaza exclusivamente a `127.0.0.1`. Bloquea conexiones externas de LAN o Internet.
2. **Sin Inyección de Comandos**: Ningún comando usa shells intermedias como `exec()` con concatenación. Todo el procesamiento de procesos se realiza con `spawn()` y arrays de argumentos tipados y delimitados.
3. **Whitelist de Módulos**: Solo se permite la ejecución de los 23 módulos formalmente registrados en `MODULES`. Cualquier llamada fuera de lista es rechazada con HTTP 400.
4. **Validación de Rutas Seguras con `realpath`**: Todo borrado en disco valida que el path sea una subcarpeta estricta y canónica de directorios permitidos (`%TEMP%`, `Caches`, etc.).
5. **Modo `dryRun` en Acciones**: Todas las mutaciones del sistema admiten el flag `dryRun` para previsualizar exactamente qué cambios ocurrirían sin modificar el estado del sistema.
6. **Reversibilidad Atómica (`changes.json`)**: Cada cambio aplicado guarda su valor previo para permitir deshacer modificaciones (`undo`) de forma individual.
7. **Rate Limiting y Headers de Seguridad**: Protección contra abusos de endpoints con `express-rate-limit` y `helmet`.
