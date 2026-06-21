# RAM Optimizer

Scripts standalone que escanean el uso de memoria RAM y permiten liberar recursos terminando procesos innecesarios:

- RAM fisica total, usada y libre
- Procesos ordenados por consumo de memoria
- Identificacion de procesos seguros de liberar vs criticos del sistema
- Terminacion selectiva de procesos con confirmacion

El escaneo no modifica nada - solo reporta. La liberacion es decision explicita del usuario con seleccion item por item.

## Uso manual

```powershell
powershell -ExecutionPolicy Bypass -File Scan-RAM.ps1
```

Genera `reports/ram-report-YYYY-MM-DD.md` + `reports/ram-counts.json` (conteos estructurados con flag de error).

Para liberar RAM interactivamente (lista numerada y el usuario elige que procesos terminar):

```powershell
powershell -ExecutionPolicy Bypass -File Free-RAM.ps1
```

Loguea en `reports/optimize-log.txt`.

## Flujo completo con popup

```powershell
powershell -ExecutionPolicy Bypass -File Notify-RAM.ps1
```

Muestra popup con resumen del escaneo. Si aceptas, abre `Free-RAM.ps1` para liberar selectivamente.

## Automatizacion

Tarea programada de Windows `RAMOptimizer_Weekly`: corre cada sabado 10am, genera el reporte y muestra un popup con el resumen (leyendo el JSON, no parseando markdown). Si aceptas, abre `Free-RAM.ps1`.

Activar/desactivar:
```
schtasks /Change /TN "RAMOptimizer_Weekly" /DISABLE
schtasks /Change /TN "RAMOptimizer_Weekly" /ENABLE
```

Correr manualmente ahora:
```
schtasks /Run /TN "RAMOptimizer_Weekly"
```

Comando directo en PowerShell (funcion en tu `$PROFILE`):
```powershell
function RAM-Optimize {
    powershell -ExecutionPolicy Bypass -File "<RUTA_COMPLETA>\Notify-RAM.ps1"
}
```

## Portabilidad — que cambiar si usas esto en tu propia maquina

Los scripts (`Scan-RAM.ps1`, `Free-RAM.ps1`, `Notify-RAM.ps1`) son autocontenidos — sin rutas ni datos hardcodeados de usuario. Usan `$PSScriptRoot` y variables de entorno. Puedes copiar la carpeta completa a cualquier lugar y correr los scripts directo.

Lo que si depende de donde pongas la carpeta:

1. **Tarea programada de Windows**:
   ```powershell
   schtasks /Create /TN "RAMOptimizer_Weekly" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"<RUTA_COMPLETA>\Notify-RAM.ps1`"" /SC WEEKLY /D SAT /ST 10:00 /RL LIMITED /F
   ```
   Reemplaza `<RUTA_COMPLETA>` por la ruta donde copiaste la carpeta.

2. **Comando directo en PowerShell**: reemplaza `<RUTA_COMPLETA>` en la funcion `RAM-Optimize` de arriba por tu ruta real, agregala a tu `$PROFILE` (`notepad $PROFILE`) y recarga con `. $PROFILE`.

## Requisitos

- Windows con PowerShell 5.1 o superior (o PowerShell Core/`pwsh`).
- No requiere admin, pero algunos procesos de sistema pueden requerirlo para ser terminados (se omiten gracefulmente).
