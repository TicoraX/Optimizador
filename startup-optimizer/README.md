# Startup Optimizer

Scripts standalone que escanean y optimizan la configuracion de inicio de Windows:

- Programas de inicio (registry Run keys + carpetas Startup)
- Rendimiento de arranque (EventLog ID 100, con historico y tendencia)
- Servicios en modo Automatico (conteo no-Microsoft vs sistema)
- Tareas programadas con trigger de inicio/logon

El escaneo no modifica nada - solo reporta. La optimizacion es decision explicita del usuario con seleccion item por item.

## Uso manual

```powershell
powershell -ExecutionPolicy Bypass -File Scan-Startup.ps1
```

Genera `reports/startup-report-YYYY-MM-DD.md` + `reports/startup-counts.json` (conteos estructurados por categoria, con flag de error) + `reports/boot-history.json` (historico de tiempos de arranque).

Para optimizar interactivamente (lista numerada y el usuario elige que deshabilitar):

```powershell
powershell -ExecutionPolicy Bypass -File Optimize-Startup.ps1
```

Loguea en `reports/optimize-log.txt`.

## Flujo completo con popup

```powershell
powershell -ExecutionPolicy Bypass -File Notify-Startup.ps1
```

Muestra popup con resumen del escaneo. Si aceptas, abre `Optimize-Startup.ps1` para deshabilitar selectivamente.

## Automatizacion

Tarea programada de Windows `StartupOptimizer_Weekly`: corre cada viernes 9am, genera el reporte y muestra un popup con el resumen (leyendo el JSON, no parseando markdown). Si aceptas, abre `Optimize-Startup.ps1`.

Activar/desactivar:
```
schtasks /Change /TN "StartupOptimizer_Weekly" /DISABLE
schtasks /Change /TN "StartupOptimizer_Weekly" /ENABLE
```

Correr manualmente ahora:
```
schtasks /Run /TN "StartupOptimizer_Weekly"
```

Comando directo en PowerShell (funcion en tu `$PROFILE`):
```powershell
function Startup-Optimize {
    powershell -ExecutionPolicy Bypass -File "<RUTA_COMPLETA>\Notify-Startup.ps1"
}
```

## Portabilidad — que cambiar si usas esto en tu propia maquina

Los scripts (`Scan-Startup.ps1`, `Optimize-Startup.ps1`, `Notify-Startup.ps1`) son autocontenidos — sin rutas ni datos hardcodeados de usuario. Usan `$PSScriptRoot` y variables de entorno. Puedes copiar la carpeta completa a cualquier lugar y correr los scripts directo.

Lo que si depende de donde pongas la carpeta:

1. **Tarea programada de Windows**:
   ```powershell
   schtasks /Create /TN "StartupOptimizer_Weekly" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"<RUTA_COMPLETA>\Notify-Startup.ps1`"" /SC WEEKLY /D FRI /ST 09:00 /RL LIMITED /F
   ```
   Reemplaza `<RUTA_COMPLETA>` por la ruta donde copiaste la carpeta.

2. **Comando directo en PowerShell**: reemplaza `<RUTA_COMPLETA>` en la funcion `Startup-Optimize` de arriba por tu ruta real, agregala a tu `$PROFILE` (`notepad $PROFILE`) y recarga con `. $PROFILE`.

## Requisitos

- Windows con PowerShell 5.1 o superior (o PowerShell Core/`pwsh`).
- Acceso de lectura a `Microsoft-Windows-Diagnostics-Performance/Operational` event log.
- No requiere admin (excepto para leer ciertos logs o deshabilitar tasks de sistema).
