# Optimizador — Automatizaciones de mantenimiento para Windows

Conjunto de herramientas de mantenimiento local para Windows: actualizaciones de software, limpieza de disco, optimización de inicio, administración de RAM, red, servicios, energía y aplicaciones — controlados desde un dashboard web moderno.

> Todo corre **localmente en tu equipo**. Sin nube, sin telemetría, ningún dato sale de tu PC.

---

## Qué hace

| Módulo | Qué hace |
|---|---|
| **Update Checker** | Busca actualizaciones pendientes en winget (apps/drivers), pip, npm global y Chocolatey. No instala nada sin confirmación. |
| **Disk Cleanup** | Escanea espacio recuperable: archivos temporales, caché de navegadores (Chrome/Edge/Firefox), descargas >30 días y papelera de reciclaje. Borra solo lo que elijas. |
| **Startup Optimizer** | Audita y deshabilita programas, servicios auto-start y tareas que se lanzan al **iniciar sesión**. Deshabilitar es reversible desde el mismo dashboard. |
| **RAM Optimizer** | Escanea procesos por consumo de memoria y los clasifica en 4 categorías de riesgo: seguro (se puede liberar automáticamente), riesgoso (editores/navegadores), desconocido (revisión manual) y crítico (nunca se toca). Libera RAM seleccionando qué cerrar. |
| **Network Optimizer** | Diagnostica conectividad: cuenta entradas de caché DNS, mide latencia contra 8.8.8.8, enumera adaptadores activos/desconectados. Acción: vacía caché DNS y re-registra DNS. |
| **Services Optimizer** | Lista servicios con inicio automático y separa los de Microsoft de los de terceros por ruta del binario y por una lista de servicios críticos protegidos (Defender, firewall, Windows Update). Permite **detener y deshabilitar** servicios de terceros que no necesites (Adobe, Steam, etc.). Difiere de Inicio: estos servicios corren en segundo plano aunque nadie haya iniciado sesión — no son programas que se abren al login. |
| **Power Optimizer** | Muestra el plan de energía activo con su descripción, el estado de la batería (carga %, tiempo restante) y estima el consumo en watts. Permite cambiar de plan al instante. |
| **App Manager** | Lista aplicaciones instaladas mediante winget con su ID, versión y origen. Permite desinstalar varias a la vez de forma silenciosa (`winget uninstall --silent`). |
| **Privacy Optimizer** | Revisa 8 ajustes de privacidad de Windows (telemetría, Cortana, ID publicitario, ubicación, cámara, micrófono, etc.) y los protege con un clic mediante `reg add`. |

Cada módulo sigue el mismo patrón:
- **Scan** — lee el sistema y genera un reporte en Markdown, un JSON de conteos y un JSON de elementos seleccionables. No modifica nada.
- **Acción** — toca solo lo que seleccionaste. Se puede simular antes de aplicar, y cada cambio queda en el diario con su valor anterior.

---

## Estructura del proyecto

```
Optimizador/
├── server/
│   ├── server.js            # Express: rutas, seguridad, SSE
│   └── lib/                 # La logica de los 21 modulos, nativa en Node
│       ├── shared.js        # Whitelist, validadores, spawn, barrera y diario
│       ├── changes.js       # Deshacer un cambio aplicado
│       └── <modulo>.js      # Un archivo por modulo: scan + accion
├── frontend/                # React + Vite
│   ├── src/modules.js       # Registro declarativo de los 21 modulos
│   ├── src/styles/tokens.css# Sistema de diseno (color, espaciado, tipografia)
│   └── src/components/
├── electron/                # App de escritorio, con auto-update
├── scripts/Notify.ps1       # Unico PowerShell: lo invocan las tareas programadas
└── <modulo>/reports/        # Reportes, conteos, items, logs y diario de cambios
```

---

## Requisitos

- Windows 10 u 11
- [Node.js 18+](https://nodejs.org/) y `npm`
- Opcionales, según el módulo: `winget`, `pip`, `npm`, `choco`. Los que falten se omiten sin error.

---

## Inicio rápido — App de escritorio (Electron)

La forma más simple de correr el proyecto: una sola app instalable que empaqueta el backend y el dashboard, con auto-actualización vía GitHub Releases.

```powershell
git clone https://github.com/TicoraX/Optimizador.git
cd Optimizador
npm install
npm run build:frontend   # compila el frontend y las dependencias del server
npx electron .            # abre la app
```

Para generar el instalador `.exe`:

```powershell
npm run dist       # genera el instalador en dist/, sin publicar
npm run release    # genera y lo publica como GitHub Release (requiere GITHUB_TOKEN con permiso repo)
```

Los clientes que ya tengan la app instalada detectan releases nuevos automáticamente (`electron-updater`).

---

## Inicio rápido — Dashboard web (backend + frontend por separado)

Alternativa para desarrollo: corre el backend y el frontend como dos procesos independientes en el navegador, en vez de la app Electron empaquetada.

### 1. Clonar el repositorio

```powershell
git clone https://github.com/TicoraX/Optimizador.git
cd Optimizador
```

### 2. Levantar el backend (API)

```powershell
cd server
npm install
npm start
```

El servidor arranca en `http://127.0.0.1:3001`. Solo acepta conexiones desde `localhost` — **no es accesible desde tu red local**.

> Para desarrollo con recarga automática: `npm run dev`

### 3. Levantar el frontend web

Abre una segunda terminal:

```powershell
cd frontend
npm install
npm run dev
```

Abre tu navegador en **http://localhost:5173**

El indicador de estado en la esquina superior derecha se pondrá verde cuando el frontend se conecte al backend.

---

## Automatización semanal

El programador vive en la app: entrá a **Programador**, elegí el módulo y la
frecuencia. La app crea la tarea de Windows apuntando a `scripts/Notify.ps1`,
que corre el escaneo y muestra un resumen.

Si preferís crear la tarea a mano:

```powershell
schtasks /Create /TN "RAMOptimizer_Weekly" /SC WEEKLY /D SAT /ST 10:00 /RL LIMITED /F ^
  /TR "powershell.exe -ep Bypass -nop -w Hidden -File \"<RUTA>\scripts\Notify.ps1\" -Module ram -Port 3001"
```

`<RUTA>` es la raíz del repo si corrés desde el código. En la app instalada el
script vive en `%LOCALAPPDATA%\Programs\optimizador\resources\scripts`, fuera
del `app.asar` justamente para que PowerShell pueda leerlo.

`-Module` acepta: `updates`, `cleanup`, `startup`, `ram`, `network`, `services`,
`power`, `apps`, `privacy`. El escaneo es de solo lectura: nunca modifica el
sistema por su cuenta.

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
