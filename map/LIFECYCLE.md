# Ciclo de Vida y Flujos de Ejecución (map/LIFECYCLE.md)

Este documento detalla el ciclo de vida de los tres procesos fundamentales del sistema: Escaneo, Acción y Empaquetado.

---

## 1. Ciclo de Vida del Escaneo (Scan)

```text
[ UI: Botón "Escanear" ]
        │
        ▼ POST /api/scan/:module (body opcional)
[ server.js: scan handler ]
        │
        ▼ runNativeOverSSE()
[ lib/<module>.js: run*ScanNative() ]
        │ (Emite logs y progreso en SSE)
        ▼ finishReport()
[ Disco: <module>/reports/ ] ───► report.md (texto legible)
                             ───► items.json (elementos estructurados)
        │
        ▼ event: done
[ UI: useModuleItems ] ───► GET /api/reports/:module/items ───► Renderiza checkboxes
```

1. La interfaz solicita el escaneo vía `POST /api/scan/:module`.
2. El servidor valida el nombre del módulo en la lista blanca `VALID_MODULES` y despacha a `SCAN_HANDLERS`.
3. La función `run<Module>ScanNative` recopila el estado actual de Windows sin mutar el sistema.
4. `finishReport()` guarda atómicamente el informe en `<module>/reports/report.md` y la lista estructurada en `<module>/reports/items.json`.
5. Al recibir el evento SSE `done`, el hook `useModuleItems` del frontend consume `/api/reports/:module/items` y carga los checkboxes con el `defaultCheck` correspondiente.

---

## 2. Ciclo de Vida de la Acción (Action)

```text
[ UI: Botón "Aplicar" ]
        │
        ▼ POST /api/action/:module (body: { dryRun, <bodyKey>: [...] })
[ server.js: action handler ]
        │ Valida contra SELECTION_FIELDS (Error 400 si está vacío)
        ▼ Mapea body a envVars (mayúsculas)
[ lib/<module>.js: run*ActionNative(envVars, onOutput, onProgress) ]
        │
        ▼ makeGuard(dryRun)
        ├─ Si dryRun === true: Simula y emite logs de prueba
        └─ Si dryRun === false: Ejecuta mutación real (reg, sc, winget, fs)
                 │
                 ▼ recordChange()
        [ Disco: <module>/reports/changes.json ] (Snapshot del valor anterior)
        │
        ▼ event: done
[ UI: ReportViewer ] ───► Muestra log de finalización y refresca estado
```

- **Compuerta de Selección**: `SELECTION_FIELDS` en `server.js` previene llamadas no intencionadas. Si ninguna clave de selección tiene valores, la petición es abortada con HTTP 400.
- **Rollback**: Cada cambio con valor previo genera una entrada en `changes.json`. El usuario puede deshacerlo desde la vista `/historial` llamando a `POST /api/changes/:id/revert`.

---

## 3. Ciclo de Empaquetado y Distribución (Packaging)

- **Comando**: `npm run pack`
- **Etapa 1 (Frontend)**: `npm run build:frontend` ejecuta `vite build`, emitiendo assets optimizados en `frontend/dist/`.
- **Etapa 2 (Electron)**: `electron-builder --dir` compila el ejecutable nativo en `dist/win-unpacked/Optimizador.exe`.
- **Invariante UAC**: Empaquetado con `requestedExecutionLevel: "asInvoker"` para arrancar sin exigir credenciales de administrador obligatorias al inicio.
