# Disk Cleanup

Scripts standalone que detectan y limpian espacio recuperable en disco:

- Temporales de Windows (%TEMP%, Windows\Temp, Prefetch)
- Cache de navegadores (Chrome, Edge, Firefox)
- Archivos en Descargas con mas de N dias (default 30)
- Papelera de reciclaje

El escaneo no borra nada - solo reporta. El borrado es decision explicita del usuario con confirmacion por categoria.

## Uso manual

```powershell
powershell -ExecutionPolicy Bypass -File Scan-Cleanup.ps1
```

Genera `reports/cleanup-report-YYYY-MM-DD.md` + `reports/cleanup-counts.json` (conteos estructurados por categoria, con flag de error).

Para limpiar interactivamente (pregunta por categoria antes de borrar):

```powershell
powershell -ExecutionPolicy Bypass -File Clean-Disk.ps1
```

Loguea en `reports/apply-log.txt`.

## Automatizacion

Tarea programada de Windows `DiskCleanup_Weekly`: corre cada miercoles 9am,
genera el reporte y muestra un popup con el resumen (leyendo el JSON, no parseando markdown).
Si aceptas, abre `Clean-Disk.ps1` para limpiar con confirmacion por categoria.

Activar/desactivar:
```
schtasks /Change /TN "DiskCleanup_Weekly" /DISABLE
schtasks /Change /TN "DiskCleanup_Weekly" /ENABLE
```

Correr manualmente ahora:
```
schtasks /Run /TN "DiskCleanup_Weekly"
```

Comando directo en PowerShell (función en tu `$PROFILE`):
```powershell
function Disk-Cleanup {
    powershell -ExecutionPolicy Bypass -File "<RUTA_COMPLETA>\Notify-Cleanup.ps1"
}
```

## Portabilidad — qué cambiar si usas esto en tu propia máquina

Todos los archivos de esta carpeta (`Scan-Cleanup.ps1`, `Clean-Disk.ps1`, `Notify-Cleanup.ps1`,
`Common.psm1`) son autocontenidos — sin rutas ni datos hardcodeados de usuario. Usan
`$PSScriptRoot` y variables de entorno (`$env:TEMP`, `$env:USERPROFILE`, etc.). Puedes copiar
la carpeta completa a cualquier lugar (o clonar este repo) y correr los scripts directo, sin
depender de ninguna otra carpeta.

Lo que sí depende de dónde pongas la carpeta, porque vive fuera de estos archivos:

1. **Tarea programada de Windows**:
   ```powershell
   schtasks /Create /TN "DiskCleanup_Weekly" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"<RUTA_COMPLETA>\Notify-Cleanup.ps1`"" /SC WEEKLY /D WED /ST 09:00 /RL LIMITED /F
   ```
   Reemplaza `<RUTA_COMPLETA>` por la ruta donde copiaste la carpeta.

2. **Comando directo en PowerShell**: reemplaza `<RUTA_COMPLETA>` en la función `Disk-Cleanup`
   de arriba por tu ruta real, agrégala a tu `$PROFILE` (`notepad $PROFILE`) y recarga con
   `. $PROFILE`.

## Requisitos

- Windows con PowerShell (5.1 o superior, o PowerShell Core/`pwsh`).
