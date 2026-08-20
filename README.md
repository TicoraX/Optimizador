# Optimizador — Suite Integral de Mantenimiento y Optimización para Windows

Conjunto de herramientas de optimización y mantenimiento de alto rendimiento para Windows: **21 módulos nativos en Node.js**, telemetría de hardware en tiempo real, cálculo de Health Score, gestión de puntos de restauración y panel de control moderno (React + Vite + Electron).

> Todo corre **localmente en tu equipo**. Sin servicios en la nube, sin telemetría de terceros, ningún dato sale de tu PC.

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
| **Gaming Mode** | Optimiza el sistema para juegos: GameDVR, optimizaciones de pantalla completa (FSO), DirectStorage y prioridad de GPU. |
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

## Características Adicionales

- **Telemetría de Hardware en Vivo (Bento Grid 4-Cards)**: Monitoreo en tiempo real de CPU (uso %, núcleos, GHz), Memoria RAM (usada, libre, %), Almacenamiento Local (espacio libre por partición) y Red & Conectividad (adaptadores activos, IP local, hostname).
- **Health Score**: Algoritmo ponderado (0 a 100) que califica la salud general del sistema y ofrece recomendaciones prioritarias.
- **Cazador de Archivos Grandes (Large Files Hunter)**: Localiza archivos pesados (>100MB) y permite abrirlos directamente en el Explorador.
- **Gestor de Puntos de Restauración**: Creación, listado y consulta de puntos de restauración de Windows con control de throttling.
- **Optimización Rápida (Quick Optimize)**: Ejecución con 1 clic de escaneo y optimización combinada de los módulos más seguros.

---

## Estructura del proyecto

```
Optimizador/
├── server/
│   ├── server.js            # Express: rutas, seguridad, SSE, rate limiting
│   └── lib/                 # La logica de los 21 modulos, 100% nativa en Node.js
│       ├── shared.js        # Whitelist, validadores, spawn, barrera y diario
│       ├── changes.js       # Reversion atomica de cambios aplicados
│       └── <modulo>.js      # Un archivo por modulo: scan + accion
├── frontend/                # React 18 + Vite
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

La forma más simple de correr el proyecto: una sola app instalable que empaqueta el backend y el dashboard, con auto-actualización vía GitHub Releases.

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

> Los scripts `Scan-*.ps1` y `Optimize-*.ps1` de cada carpeta se eliminaron. La
> lógica de los 21 módulos vive en `server/lib/` y corre nativa en Node: mantener
> dos implementaciones en paralelo hacía que divergieran. `scripts/Notify.ps1`
> es el único PowerShell que queda, y solo llama al backend.

---

## Antes de que algo cambie

Toda acción destructiva tiene tres capas de contención:

1. **Simulación.** El botón *Ver qué va a pasar* corre la acción completa sin
   tocar nada y lista exactamente qué haría: cuántos MB, qué archivos, qué
   servicios.
2. **Listas de protección.** No se desinstalan runtimes ni drivers (VC++, .NET,
   WebView2, NVIDIA, Intel), no se deshabilitan servicios críticos (Defender,
   firewall, Windows Update, RPC), y nunca se tocan procesos del sistema.
3. **Historial con deshacer.** Cada cambio aplicado queda en **Historial** con el
   valor que tenía antes. Lo reversible tiene botón; lo que no lo es (un archivo
   borrado, una app desinstalada) se marca como tal en vez de mentir.

---

## Opcional: comandos rápidos de PowerShell

Agrega estas funciones a tu perfil de PowerShell (`notepad $PROFILE`) para acceso rápido desde cualquier terminal:

```powershell
function Optimizador {
    param([ValidateSet('updates','cleanup','startup','ram','network','services','power','apps','privacy','adblock','gaming','integrity','contextmenu','oemdebloat','timers','ghostdevices','searchindex','dnsflush','networkprivacy','pagefile','werfault')]
          [string]$Module)
    powershell -ep Bypass -nop -File "<RUTA_COMPLETA>\scripts\Notify.ps1" -Module $Module -Port 3001
}
```

Después: `Optimizador ram`, `Optimizador cleanup`, etc. Requiere que la app esté
abierta, porque el script llama al backend local.

Recarga tu perfil después de editarlo: `. $PROFILE`

---

## Arquitectura

```
Navegador  http://localhost:5173
    │
    ├── GET  /api/status          →  Dashboard: metricas consolidadas (consulta cada 30s)
    ├── GET  /api/reports/:module →  Visor de reportes: Markdown renderizado
    ├── POST /api/scan/:module    →  Salida de escaneo en vivo (stream Server-Sent Events)
    ├── POST /api/action/:module  →  Salida de accion en vivo (stream Server-Sent Events)
    ├── GET  /api/scheduler                  →  Estado de tareas programadas
    ├── POST /api/scheduler/:task/toggle     →  Habilitar / deshabilitar una tarea
    ├── POST /api/scheduler/:task/reschedule →  Cambiar dia/hora/frecuencia (diaria o semanal)
    ├── GET  /api/reports/:module/items      →  Elementos seleccionables, ya estructurados
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
                │   winget.exe, pip, npm) — NO invoca powershell.exe para nada de esto
                └── Llama a schtasks.exe para consultar / activar / reprogramar tareas
```

> **¿Por qué Node nativo en vez de invocar los scripts `.ps1`?** Invocar `powershell.exe -File`
> desde este servidor Express de larga duración resultó poco confiable — se colgaba
> indefinidamente o salía en silencio sin ninguna salida, mientras que el mismo script
> exacto corría bien desde un proceso suelto. La causa raíz nunca se identificó con certeza,
> así que en vez de seguir peleando con eso, la lógica de scan/action del dashboard se
> reescribió para llamar directamente a las herramientas subyacentes (`reg`, `schtasks`,
> `winget`, `pip`, `npm`, operaciones de filesystem). Los `.ps1` de cada módulo quedaron
> como una segunda implementación que nadie invocaba y terminaron eliminados: mantener dos
> copias solo hacía que divergieran.

### Modelo de seguridad

| Riesgo | Control |
|---|---|
| Inyección de comandos | Whitelist de módulos + `spawn()` con `shell: false` + argumentos como array — ningún input del usuario se concatena en un comando (la única excepción es `npm`, que necesita `shell: true` para resolver su wrapper `.cmd` en Windows — se usa exclusivamente con argumentos fijos) |
| Web arbitraria disparando acciones | Escuchar en `127.0.0.1` **no** alcanza: cualquier página abierta en el navegador puede hacer `fetch` a localhost. Se validan `Origin` y `Sec-Fetch-Site`, headers que el JS de una página no puede falsificar ni omitir. Sin dependencia `cors`: la app se sirve del mismo origen que su API |
| XSS vía nombres del sistema | Los reportes se arman con nombres de procesos y apps, o sea contenido que controla cualquier binario instalado. El Markdown se renderiza con el HTML crudo desactivado y los protocolos de link restringidos |
| Cabeceras y abuso | `helmet` con CSP explícita + `express-rate-limit` (400/15min global, 30 en scan, 10 en acción) |
| Exposición en red local | El servidor solo escucha en `127.0.0.1` — inaccesible desde otros equipos de la red |
| Directory traversal | Validación de fecha con chequeo de calendario real + `normalize()` + verificación de límites en todas las rutas de archivo |
| Filtración de stack trace | El manejador de errores global responde 500 genérico — no llegan detalles del sistema operativo al cliente |
| Validación de input | Chequeo estricto de tipos en todos los parámetros — tipos incorrectos devuelven `400 Bad Request` |
| DoS | Límite de 16 KB por body + timeout de seguridad en cada scan/action (2 min scan, 10 min action) |
| Escalación de privilegios | Los cambios de registro/tareas que requieren admin (ej. entradas `HKLM`) se detectan de antemano y se omiten con un mensaje claro en el log, en vez de fallar a medias |

### Deshabilitar y reactivar elementos de inicio

El módulo Startup Optimizer nunca borra nada de forma irreversible:
- Las entradas del registro `Run` se guardan (nombre + comando + clave) antes de borrarse, para poder recrearlas exactamente como estaban.
- Los accesos directos de la carpeta Startup se mueven a una subcarpeta `Startup_Disabled` en vez de borrarse.
- Las tareas programadas se deshabilitan vía el Programador de Tareas, nunca se borran.

El reporte y el dashboard muestran una sección separada de "Deshabilitados" (aparte de la lista de elementos activos, para no sobrecargarla) con una lista para reactivar lo que hayas deshabilitado.

---

## Portabilidad

No hay rutas ni nombres de usuario hardcodeados: todo sale de variables de entorno estándar (`%TEMP%`, `%USERPROFILE%`, `%LOCALAPPDATA%`). Podés clonar el repo donde quieras.

En el paquete de Electron los reportes se escriben en `userData`, no dentro del `.asar`, que es de solo lectura.

Lo único que hay que reemplazar después de clonar es el placeholder `<RUTA>` de los comandos `schtasks` y la función de perfil de arriba.

---

## Limitaciones conocidas

- `winget upgrade` no tiene salida JSON oficial (verificado en v1.28). La salida se parsea de la tabla de texto por posición de columna. Si Microsoft cambia el formato, los resultados de winget pueden aparecer vacíos — revisa la lógica de parsing de winget en `server/lib/updates.js` si eso pasa.
- El rendimiento de arranque (EventLog de Rendimiento de Windows, ID 100) **no está disponible desde el dashboard web**. La única forma confiable de leerlo sin permisos de administrador es `Get-WinEvent` de PowerShell — `wevtutil` devuelve "Access is denied" para un usuario no-admin aunque `Get-WinEvent` sí funcione. Como el backend evita deliberadamente invocar PowerShell con `-File` (ver la nota de arquitectura arriba), esta métrica se reporta como no disponible en vez de reintroducirla a costa de la estabilidad.
- Los accesos directos (`.lnk`) de la carpeta Startup se listan solo por nombre de archivo desde el dashboard web — resolver su destino real normalmente requiere `WScript.Shell` (COM/PowerShell), que no se usa aquí por la misma razón.
- Los servicios auto-start se listan solo informativamente y nunca se modifican — deshabilitar servicios auto-start sin saber cuáles son críticos puede dejar el sistema inestable.
- La revisión de paquetes globales de npm puede fallar con `ENOENT` si no existe la carpeta global de npm (`%APPDATA%\npm`) — se reporta como error, no como "0 actualizaciones".

---

## Licencia

[MIT](LICENSE)
