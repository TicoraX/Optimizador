# Optimizador — Automatizaciones de mantenimiento para Windows

Conjunto de herramientas de mantenimiento local para Windows: scripts automatizados para actualizaciones de software, limpieza de disco y optimización de inicio — controlados desde un dashboard web moderno.

> Todo corre **localmente en tu equipo**. Sin nube, sin telemetría, ningún dato sale de tu PC.

---

## Qué hace

| Módulo | Qué automatiza |
|---|---|
| **Update Checker** | Detecta actualizaciones pendientes de winget (apps/drivers), pip, paquetes globales de npm y Chocolatey |
| **Disk Cleanup** | Encuentra espacio recuperable: temporales de Windows, caché de navegadores, descargas viejas, papelera de reciclaje |
| **Startup Optimizer** | Audita programas de inicio (registro + carpeta Startup), servicios auto-start y tareas programadas de logon. Deshabilitar es reversible — reactiva cualquier cosa desde el dashboard |
| **RAM Optimizer** | Escanea el uso de memoria, clasifica procesos por riesgo (seguro/riesgoso/desconocido) y libera RAM cerrando los que elijas. Nunca toca procesos críticos del sistema |

Cada módulo sigue el mismo patrón:
- **Scan** — lee el sistema, genera un reporte en Markdown + JSON estructurado. No modifica nada.
- **Action** — pide confirmación por categoría antes de hacer cualquier cosa. Registra cada acción en un log.
- **Notify** — la tarea programada semanal de Windows muestra un popup con el resumen y opcionalmente lanza el script de acción.

---

## Estructura del proyecto

```
Optimizador/
├── update-checker/          # Scripts de deteccion e instalacion de actualizaciones
├── disk-cleanup/            # Scripts de escaneo y limpieza de espacio en disco
├── startup-optimizer/       # Scripts de auditoria y optimizacion de inicio
├── ram-optimizer/           # Scripts de escaneo y liberacion de memoria RAM
├── server/                  # Backend Node.js REST + SSE (Express), logica por modulo en server/lib/
└── frontend/                # Dashboard web en React + Vite
```

---

## Requisitos

### Solo scripts (sin interfaz web)
- Windows 10 u 11
- PowerShell 5.1+ (incluido en Windows) o PowerShell Core (`pwsh`)
- Al menos una de: `winget`, `pip`, `npm`, `choco` (las que falten se omiten sin error)

### Dashboard web (backend + frontend)
- [Node.js 18+](https://nodejs.org/) (se recomienda la versión LTS)
- `npm` (incluido con Node.js)

---

## Inicio rápido — Dashboard web

Esta es la forma recomendada de usar el proyecto. El dashboard te da una interfaz visual para escanear, revisar reportes, ejecutar acciones y administrar tareas programadas.

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

## Inicio rápido — Solo scripts (sin Node.js)

Puedes usar los scripts de PowerShell directamente, sin el dashboard web.

### Correr un escaneo

```powershell
# Revisar actualizaciones de software pendientes
powershell -ExecutionPolicy Bypass -File update-checker\Check-Updates.ps1

# Escanear espacio recuperable en disco
powershell -ExecutionPolicy Bypass -File disk-cleanup\Scan-Cleanup.ps1

# Auditar la configuracion de inicio
powershell -ExecutionPolicy Bypass -File startup-optimizer\Scan-Startup.ps1

# Escanear uso de RAM y procesos candidatos a liberar
powershell -ExecutionPolicy Bypass -File ram-optimizer\Scan-RAM.ps1
```

Los reportes se guardan en la carpeta `reports/` de cada módulo.

### Aplicar acciones interactivamente

```powershell
# Instalar actualizaciones pendientes (pregunta por categoria antes de hacer algo)
powershell -ExecutionPolicy Bypass -File update-checker\Apply-Updates.ps1

# Limpiar disco (pregunta por categoria antes de borrar)
powershell -ExecutionPolicy Bypass -File disk-cleanup\Clean-Disk.ps1

# Deshabilitar programas de inicio / tareas de logon (lista numerada, tu eliges)
powershell -ExecutionPolicy Bypass -File startup-optimizer\Optimize-Startup.ps1

# Liberar RAM cerrando procesos candidatos (lista numerada, tu eliges)
powershell -ExecutionPolicy Bypass -File ram-optimizer\Free-RAM.ps1
```

---

## Configurar automatización semanal (opcional)

Los scripts pueden correr automáticamente cada semana usando el Programador de Tareas de Windows. Reemplaza `<RUTA_COMPLETA>` con la ruta absoluta donde clonaste este repo.

```powershell
# Update Checker — todos los lunes a las 9:00 AM
schtasks /Create /TN "UpdateChecker_Weekly" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"<RUTA_COMPLETA>\update-checker\Notify-Updates.ps1`"" /SC WEEKLY /D MON /ST 09:00 /RL LIMITED /F

# Disk Cleanup — todos los miercoles a las 9:00 AM
schtasks /Create /TN "DiskCleanup_Weekly" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"<RUTA_COMPLETA>\disk-cleanup\Notify-Cleanup.ps1`"" /SC WEEKLY /D WED /ST 09:00 /RL LIMITED /F

# Startup Optimizer — todos los viernes a las 9:00 AM
schtasks /Create /TN "StartupOptimizer_Weekly" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"<RUTA_COMPLETA>\startup-optimizer\Notify-Startup.ps1`"" /SC WEEKLY /D FRI /ST 09:00 /RL LIMITED /F

# RAM Optimizer — todos los sabados a las 10:00 AM
schtasks /Create /TN "RAMOptimizer_Weekly" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"<RUTA_COMPLETA>\ram-optimizer\Notify-RAM.ps1`"" /SC WEEKLY /D SAT /ST 10:00 /RL LIMITED /F
```

Cada tarea programada muestra una notificación popup. Aceptar el popup lanza el script de acción interactivo.

También puedes habilitar, deshabilitar o correr las tareas manualmente:

```powershell
schtasks /Change /TN "UpdateChecker_Weekly" /ENABLE
schtasks /Change /TN "UpdateChecker_Weekly" /DISABLE
schtasks /Run   /TN "UpdateChecker_Weekly"
```

También puedes administrar todas las tareas desde la pestaña **Programador** del dashboard web — habilitar/deshabilitar, o hacer clic en "Configurar horario" para cambiar el día, hora y frecuencia (semanal en los días que elijas, o diaria / cada N días) sin tocar `schtasks` directamente.

---

## Opcional: comandos rápidos de PowerShell

Agrega estas funciones a tu perfil de PowerShell (`notepad $PROFILE`) para acceso rápido desde cualquier terminal:

```powershell
function Update-Check    { powershell -ExecutionPolicy Bypass -File "<RUTA_COMPLETA>\update-checker\Notify-Updates.ps1" }
function Disk-Cleanup    { powershell -ExecutionPolicy Bypass -File "<RUTA_COMPLETA>\disk-cleanup\Notify-Cleanup.ps1" }
function Startup-Optimize{ powershell -ExecutionPolicy Bypass -File "<RUTA_COMPLETA>\startup-optimizer\Notify-Startup.ps1" }
function RAM-Optimize    { powershell -ExecutionPolicy Bypass -File "<RUTA_COMPLETA>\ram-optimizer\Notify-RAM.ps1" }
```

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
> `winget`, `pip`, `npm`, operaciones de filesystem). Los scripts `.ps1` de cada módulo
> siguen siendo completamente funcionales y son los que corren las tareas programadas
> semanales y los accesos rápidos de PowerShell — solo el backend del dashboard web evita
> invocar PowerShell.

### Modelo de seguridad

| Riesgo | Control |
|---|---|
| Inyección de comandos | Whitelist de módulos + `spawn()` con `shell: false` + argumentos como array — ningún input del usuario se concatena en un comando (la única excepción es `npm`, que necesita `shell: true` para resolver su wrapper `.cmd` en Windows — se usa exclusivamente con argumentos fijos, nunca con input del usuario) |
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

## Cómo manejan los scripts las confirmaciones (AUTO_CONFIRM)

`Confirm-Action` (usada por los scripts `.ps1`) lee la variable de entorno `AUTO_CONFIRM` y aprueba automáticamente en vez de esperar input de `Read-Host` cuando está en `true`.

Esto significa:
- **Corriendo los scripts manualmente desde una terminal** → interactivo, pregunta antes de cada paso.
- **Corriendo la tarea programada semanal / `Notify-*.ps1`** → sigue siendo interactivo a menos que aceptes el popup, que entonces corre el script de acción normalmente.
- **Corriendo desde el dashboard web** → no pasa por estos scripts `.ps1` en absoluto (ver la nota de arquitectura arriba), así que no hay nada que confirmar — las acciones corren de inmediato sobre lo que seleccionaste en la interfaz.

---

## Portabilidad

Todos los scripts de PowerShell son autocontenidos. Usan `$PSScriptRoot` para su propia ubicación y variables de entorno estándar (`$env:TEMP`, `$env:USERPROFILE`, etc.) para todo lo demás. No hay rutas ni nombres de usuario hardcodeados. Puedes clonar este repo en cualquier lugar y correr los scripts sin editarlos.

Lo único que necesitas actualizar después de clonar es el placeholder `<RUTA_COMPLETA>` en los comandos de `schtasks` y las funciones de perfil de PowerShell de arriba.

---

## Limitaciones conocidas

- `winget upgrade` no tiene salida JSON oficial (verificado en v1.28). La salida se parsea de la tabla de texto por posición de columna. Si Microsoft cambia el formato, los resultados de winget pueden aparecer vacíos — revisa la lógica de parsing de winget en `server/lib/updates.js` (o `update-checker/Check-Updates.ps1` para la vía de solo-scripts) si eso pasa.
- El rendimiento de arranque (EventLog de Rendimiento de Windows, ID 100) **no está disponible desde el dashboard web**. La única forma confiable de leerlo sin permisos de administrador es `Get-WinEvent` de PowerShell — `wevtutil` devuelve "Access is denied" para un usuario no-admin aunque `Get-WinEvent` sí funcione. Como el backend del dashboard evita deliberadamente invocar PowerShell (ver la nota de arquitectura arriba), esta métrica se reporta como no disponible en vez de reintroducirla a costa de la estabilidad. Sigue siendo visible corriendo `startup-optimizer/Scan-Startup.ps1` directamente.
- Los accesos directos (`.lnk`) de la carpeta Startup se listan solo por nombre de archivo desde el dashboard web — resolver su destino real normalmente requiere `WScript.Shell` (COM/PowerShell), que no se usa aquí por la misma razón.
- Los servicios auto-start se listan solo informativamente y nunca se modifican — deshabilitar servicios auto-start sin saber cuáles son críticos puede dejar el sistema inestable.
- La revisión de paquetes globales de npm puede fallar con `ENOENT` si no existe la carpeta global de npm (`%APPDATA%\npm`) — se reporta como error, no como "0 actualizaciones".

---

## READMEs de cada módulo

Cada módulo tiene su propio README con notas detalladas de uso y portabilidad:

- [`update-checker/README.md`](update-checker/README.md)
- [`disk-cleanup/README.md`](disk-cleanup/README.md)
- [`startup-optimizer/README.md`](startup-optimizer/README.md)

---

## Licencia

[MIT](LICENSE)
