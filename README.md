# Optimizador — Suite Integral de Mantenimiento y Optimización para Windows

Conjunto de herramientas de optimización y mantenimiento de alto rendimiento para Windows: **21 módulos nativos en Node.js**, telemetría de hardware en tiempo real, cálculo de Health Score, gestión de puntos de restauración, paleta de comandos rápida (`Ctrl+K`) y panel de control moderno (React + Vite + Electron con elevación administrativa UAC).

> Todo el procesamiento y almacenamiento de reportes se ejecuta **localmente en tu equipo**. Sin servicios en la nube ni telemetría propia hacia servidores externos (únicamente *Update Checker* consulta gestores oficiales de paquetes y *AdBlock* descarga listas de dominios públicas).

---

## Qué hace (21 Módulos Nativos)

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

Cada módulo sigue el mismo patrón:
- **Scan** — lee el sistema y genera un reporte en Markdown, un JSON de conteos y un JSON de elementos seleccionables. No modifica nada.
- **Acción** — toca solo lo que seleccionaste. Se puede simular con `dryRun` antes de aplicar, y cada cambio queda registrado en el historial de cambios (`changes.json`) con soporte de reversión atómica (`undo`).

---

## Características Principales

- **Telemetría de Hardware en Vivo (Bento Grid 4-Cards + Sparklines)**: Monitoreo en tiempo real de CPU (uso %, núcleos, GHz, curva histórica SVG), Memoria RAM (usada, libre, %, sparkline en vivo), Almacenamiento Local (espacio libre por partición) y Red & Conectividad (adaptadores activos, IP local, hostname).
- **Paleta Global de Comandos (`Ctrl+K` / `Cmd+K`)**: Buscador instantáneo por teclado para navegar a cualquier módulo, vista principal, alternar modo claro/oscuro o exportar reportes.
- **Selección Masiva y Filtrado Rápido**: Botones *Todos* y *Ninguno* en módulos genéricos, con barra de búsqueda instantánea que preserva la indexación atómica del estado.
- **Health Score & Quick Optimize**: Algoritmo ponderado (0 a 100) que califica la salud general del sistema y ofrece optimización en 1 clic de los módulos más seguros.
- **Cazador de Archivos Grandes (Large Files Hunter)**: Localiza archivos pesados (>100MB) y permite abrirlos directamente en el Explorador de Windows.
- **Gestor de Puntos de Restauración**: Creación, listado y consulta de puntos de restauración de Windows con control de throttling.
- **Elevación Administrativa Integrada (UAC)**: Manifiesto `requireAdministrator` en el instalador de Electron para garantizar que las operaciones sobre el registro del sistema, servicios y BCD se ejecuten sin errores de permisos.

---

## Estructura del proyecto

```
Optimizador/
├── server/
│   ├── server.js            # Express: rutas, seguridad, SSE, rate limiting
│   ├── lib/                 # La logica de los 21 modulos, 100% nativa en Node.js
│   │   ├── shared.js        # Whitelist, validadores, spawn, barrera y diario
│   │   ├── changes.js       # Reversion atomica de cambios aplicados
│   │   └── <modulo>.js      # Un archivo por modulo: scan + accion
│   └── tests/               # 228 pruebas unitarias y suites de integracion E2E
├── frontend/                # React + Vite
│   ├── src/modules.js       # Registro declarativo de los 21 modulos
│   ├── src/styles/tokens.css# Sistema de diseno (color, espaciado, tipografia)
│   └── src/components/      # Componentes UI desacoplados y modulares
├── electron/                # App de escritorio (Electron + electron-updater)
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

## Inicio rápido — Dashboard web (desarrollo por separado)

```powershell
git clone https://github.com/TicoraX/Optimizador.git
cd Optimizador

# 1. Backend
npm --prefix server ci
npm start --prefix server

# 2. Frontend (en otra terminal)
npm --prefix frontend ci
npm run dev --prefix frontend
```

Abre tu navegador en **http://localhost:5173**

---

## Automatización semanal

El programador vive en la app: entra a **Programador**, elige el módulo y la frecuencia. La app crea la tarea de Windows apuntando a `scripts/Notify.ps1`, que corre el escaneo y muestra un resumen.

Si prefieres crear la tarea a mano:

```powershell
schtasks /Create /TN "RAMOptimizer_Weekly" /SC WEEKLY /D SAT /ST 10:00 /RL LIMITED /F ^
  /TR "powershell.exe -ep Bypass -nop -w Hidden -File \"<RUTA>\scripts\Notify.ps1\" -Module ram -Port 3001"
```

`<RUTA>` es la raíz del repo si corres desde el código. En la app instalada el script vive en `%LOCALAPPDATA%\Programs\optimizador\resources\scripts`.

`-Module` acepta cualquiera de los 21 módulos (`updates`, `cleanup`, `startup`, `ram`, `network`, `services`, `power`, `apps`, `privacy`, `adblock`, `gaming`, `integrity`, `contextmenu`, `oemdebloat`, `timers`, `ghostdevices`, `searchindex`, `dnsflush`, `networkprivacy`, `pagefile`, `werfault`).

Y para habilitar, deshabilitar o correr una tarea a mano:

```powershell
schtasks /Change /TN "UpdateChecker_Weekly" /ENABLE
schtasks /Change /TN "UpdateChecker_Weekly" /DISABLE
schtasks /Run   /TN "UpdateChecker_Weekly"
```

---

## Antes de que algo cambie (Capas de Seguridad)

Toda acción destructiva tiene tres capas de contención:

1. **Simulación.** El botón *Ver qué va a pasar* corre la acción completa sin tocar nada y lista exactamente qué haría: cuántos MB, qué archivos, qué servicios o claves de registro.
2. **Listas de protección.** No se desinstalan runtimes ni drivers (VC++, .NET, WebView2, NVIDIA, Intel), no se deshabilitan servicios críticos (Defender, firewall, Windows Update, RPC), y nunca se tocan procesos esenciales del sistema.
3. **Historial con deshacer.** Cada cambio aplicado queda en **Historial** con el valor que tenía antes. Lo reversible tiene botón de reversión atómica; lo que no lo es (un archivo borrado, una app desinstalada) se marca explícitamente en el diario.

---

## Arquitectura y Seguridad

```
Navegador  http://localhost:5173 / Electron
    │
    ├── GET  /api/status          →  Dashboard: metricas consolidadas (consulta cada 30s)
    ├── GET  /api/reports/:module →  Visor de reportes: Markdown renderizado
    ├── POST /api/scan/:module    →  Salida de escaneo en vivo (stream Server-Sent Events)
    ├── POST /api/action/:module  →  Salida de accion en vivo (stream Server-Sent Events)
    ├── GET  /api/scheduler                  →  Estado de tareas programadas
    ├── POST /api/scheduler/:task/toggle     →  Habilitar / deshabilitar una tarea
    ├── POST /api/scheduler/:task/reschedule →  Cambiar dia/hora/frecuencia (diaria o semanal)
    ├── GET  /api/reports/:module/items      →  Elementos seleccionables estructurados
    ├── GET  /api/changes                    →  Diario de todo lo que la app cambio
    ├── POST /api/changes/:module/:id/undo   →  Revertir un cambio
    ├── GET  /api/logs/:module    →  Ultimas 100 lineas del log de accion
    └── DELETE /api/logs/:module  →  Limpiar o rotar el log de accion
                │
                ▼
    API Express  http://127.0.0.1:3001   (solo localhost)
                │
                ├── Lee reportes JSON / Markdown del disco
                ├── Corre la logica de scan/action nativa en Node (fs, reg.exe, schtasks.exe,
                │   winget.exe, pip, npm) — NO invoca powershell.exe para scan/action
                └── Llama a schtasks.exe para consultar / activar / reprogramar tareas
```

### Modelo de seguridad

| Riesgo | Control |
|---|---|
| Inyección de comandos | Whitelist estricta de módulos + `spawn()` con `shell: false` + argumentos como array |
| Web arbitraria disparando acciones | Validación estricta de headers `Origin` y `Sec-Fetch-Site`. Sin dependencia `cors`: la app se sirve del mismo origen que su API |
| XSS vía nombres del sistema | Renderizado seguro de Markdown sanitizado con HTML crudo desactivado y protocolos restringidos |
| Cabeceras y abuso | `helmet` con CSP explícita + `express-rate-limit` adaptativo (1000/15min global, 120 en scan/action, ilimitado en tests) |
| Exposición en red local | El servidor solo escucha en `127.0.0.1` — inaccesible desde otros equipos de la red |
| Directory traversal | Validación de fecha con chequeo de calendario real + `normalize()` + verificación de límites de ruta |
| Permisos de Administrador | Manifiesto `requireAdministrator` en el empaquetado de Electron para UAC automático |
| DoS | Límite de 16 KB por body + timeout de seguridad en cada scan/action (2 min scan, 10 min action) |

---

## Verificación y Calidad

El proyecto cuenta con una cobertura integral de pruebas automatizadas:

- **Pruebas de Backend**: **228 tests pasando al 100%** (48 suites que validan controladores, parámetros y simulación de los 21 módulos).
- **Pruebas de Frontend**: **10 tests pasando al 100%** (sanitización XSS, renderizado de Markdown, configuración de paneles).
- **Total**: **238 pruebas automatizadas**.

Para ejecutar los tests:

```powershell
npm test --prefix server       # pruebas del backend y suites E2E
npm test --prefix frontend     # pruebas unitarias del frontend
```

---

## Licencia

[MIT](LICENSE)
