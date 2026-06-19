# Update Checker

Scripts de PowerShell que revisan y, opcionalmente, instalan actualizaciones pendientes de:

- **Winget** (apps y drivers gestionados por winget)
- **Python (pip)** — paquetes desactualizados del entorno activo
- **npm** (paquetes globales `-g`)
- **Chocolatey** (si está instalado)

## Archivos

| Archivo | Qué hace |
|---|---|
| `Check-Updates.ps1` | Escanea. Genera `reports/update-report-YYYY-MM-DD.md` + `reports/update-counts.json`. No instala nada. |
| `Apply-Updates.ps1` | Instala, preguntando sí/no por categoría antes de cada acción. Loguea en `reports/apply-log.txt`. |
| `Notify-Updates.ps1` | Corre el check, muestra un popup con el resumen, y si aceptas lanza `Apply-Updates.ps1`. |
| `Common.psm1` | Funciones compartidas (`Test-CommandExists`, `Confirm-Action`, `Write-Log`) usadas por los scripts anteriores. |

## Uso manual

```powershell
powershell -ExecutionPolicy Bypass -File Check-Updates.ps1
```

### Parámetro opcional

```powershell
-ReportDir <ruta>   # carpeta donde guardar el reporte (default: ./reports)
```

Para instalar interactivamente (pregunta por categoría antes de tocar nada):

```powershell
powershell -ExecutionPolicy Bypass -File Apply-Updates.ps1
```

Para el flujo completo con popup (pensado para uso recurrente):

```powershell
powershell -ExecutionPolicy Bypass -File Notify-Updates.ps1
```

## Portabilidad — qué cambiar si usas esto en tu propia máquina

Los 4 archivos de esta carpeta (`Check-Updates.ps1`, `Apply-Updates.ps1`, `Notify-Updates.ps1`,
`Common.psm1`) **no tienen rutas ni datos hardcodeados** — usan `$PSScriptRoot` para ubicarse y
variables de entorno (`$env:TEMP`, `$env:USERPROFILE`, etc.) para todo lo demás. Puedes copiar
la carpeta completa a cualquier lugar y correr los scripts directo, sin editar nada.

Lo que **sí** depende de dónde pongas la carpeta, porque vive fuera de estos archivos:

1. **Tarea programada de Windows** (opcional, para que corra solo cada semana):
   ```powershell
   schtasks /Create /TN "UpdateChecker_Weekly" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"<RUTA_COMPLETA>\Notify-Updates.ps1`"" /SC WEEKLY /D MON /ST 09:00 /RL LIMITED /F
   ```
   Reemplaza `<RUTA_COMPLETA>` por la ruta donde clonaste/copiaste el repo.
   - Activar/desactivar: `schtasks /Change /TN "UpdateChecker_Weekly" /ENABLE` o `/DISABLE`
   - Correr ahora: `schtasks /Run /TN "UpdateChecker_Weekly"`
   - Requiere sesión de Windows iniciada para que se vea el popup.

2. **Comando directo en PowerShell** (opcional, función en tu `$PROFILE`):
   ```powershell
   function Update-Check {
       powershell -ExecutionPolicy Bypass -File "<RUTA_COMPLETA>\Notify-Updates.ps1"
   }
   ```
   Agrega esto a tu perfil (`$PROFILE` — corre `notepad $PROFILE` para editarlo) con la ruta
   real, y recarga con `. $PROFILE`. Después, escribes `Update-Check` desde cualquier terminal.

## Requisitos

- Windows con PowerShell (5.1 o superior, o PowerShell Core/`pwsh`).
- Al menos uno de winget / pip / npm / choco instalado. Si falta alguno, esa sección del
  reporte simplemente indica "no disponible" sin que el script falle.

## Notas

- `Check-Updates.ps1` nunca instala nada — solo reporta. La instalación es siempre una
  decisión explícita (confirmación por categoría en `Apply-Updates.ps1`).
- `winget upgrade` no tiene salida JSON oficial (verificado en v1.28); el parsing de su
  tabla se hace por posición de columnas del encabezado. Si Microsoft cambia ese formato,
  revisar la sección de winget en `Check-Updates.ps1`.
