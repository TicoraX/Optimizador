# Arquitectura del Sistema (map/CONTEXT.md)

Este documento define la infraestructura, restricciones de seguridad y principios de diseño vigentes para el Optimizador D1.

## 1. Topología del Sistema

```text
[ Electron (main.cjs) ] 
       │ (Carga local)
       ▼
[ Frontend React (Vite) ] ─── HTTP / SSE ───► [ Backend Express (server.js:3001) ]
                                                       │
                                                       ▼
                                           [ 23 Módulos (server/lib/*.js) ]
                                                       │
                                                       ▼
                                           [ Windows OS / APIs / CLI ]
```

- **Frontend**: SPA construida con React 18 y Vite (`frontend/`). Compilada a `frontend/dist/`.
- **Backend**: Servidor HTTP y SSE en Node.js (`server/server.js`). Corre en el puerto `3001` escuchando exclusivamente en `127.0.0.1`.
- **Desktop Shell**: Envoltorio de escritorio con Electron (`electron/main.cjs`). Maneja el ciclo de vida de la ventana, System Tray resiliente (con icono fallback de bitmap en memoria), arranque de Express con `waitForServer` y auto-actualizaciones deshabilitadas en entorno local.
- **CLI Headless**: `server/cli.js` permite auditar y optimizar por terminal con flag `--json` sin levantar interfaz gráfica.

## 2. Invariantes de Seguridad y Diseño

1. **Sin dependencias de scripts PowerShell externos**:
   - Anteriormente existían scripts `.ps1` que sufrían bloqueos intermitentes al spawnearse desde servidores de larga duración (ver bitácora histórica en `PROJECT_CONTEXT.md`).
   - Toda la lógica fue reescrita en Node.js estándar (`child_process.spawn` nativo en `server/lib/shared.js`).
2. **Aislamiento de Red**:
   - `server.js` se enlaza únicamente a `127.0.0.1`.
   - Middleware de validación estricta de encabezados `Origin` y `Sec-Fetch-Site`.
   - Cabeceras de seguridad inyectadas vía `helmet` y limitador de tasa (`express-rate-limit`).
3. **Protección Contra Acciones Destructivas Accidentales**:
   - Todo endpoint `POST /api/action/:module` exige que el usuario envíe una selección explícita mediante `SELECTION_FIELDS`. Si la lista de elementos está vacía, el servidor rechaza con código HTTP 400.
   - Todo módulo soporta simulación mediante `dryRun: true` (sin realizar mutaciones reales).
4. **Diario de Cambios Reversible**:
   - Toda mutación sobre el registro de Windows (`reg add`) o servicios registra el valor anterior en `changes.json` y expone rollback atómico vía `POST /api/changes/:id/revert`.
5. **UAC y Privilegios**:
   - El ejecutable principal se distribuye con `requestedExecutionLevel: "asInvoker"` para arrancar fluidamente en sesiones estándar.
   - Las operaciones que requieren privilegios de Administrador (drivers, SDKs, componentes WinSxS) solicitan elevación puntual o emiten diagnóstico `requires_elevation`.
