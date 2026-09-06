# Optimizador D1 — L0 Agent Router

Suite de optimización y mantenimiento de Windows (Node.js/Express + React/Vite + Electron).

## Reglas Invariantes
- **Cero Emojis**: Prohibido usar emojis en código, commits, respuestas o documentación.
- **Sin scripts PowerShell sueltos**: Toda la lógica vive en Node.js (`server/lib/*.js`). No existen scripts `.ps1`.
- **Servidor Local Estricto**: `127.0.0.1:3001` exclusivo (sin CORS abierto, con validación de Origin, helmet y rate limit).
- **Acciones Protegidas**: Toda llamada a `POST /api/action/:module` requiere selección explícita (rechaza 400 si está vacía) y soporte `dryRun: true`.
- **Modificaciones Atómicas**: Consulta `map/IMPACT.md` antes de editar cualquier módulo.

## Mapa de Enrutamiento Rápido
| Si necesitas... | Abre directamente... |
|---|---|
| Contratos, parámetros y flags de los 23 módulos | [map/MODULES.md](file:///a:/Proyectos/D1/map/MODULES.md) |
| Flujo de escaneo, ejecución SSE, diario y build | [map/LIFECYCLE.md](file:///a:/Proyectos/D1/map/LIFECYCLE.md) |
| Regla de 5 archivos para agregar o modificar un módulo | [map/IMPACT.md](file:///a:/Proyectos/D1/map/IMPACT.md) |
| Arquitectura del sistema, seguridad y runtime | [map/CONTEXT.md](file:///a:/Proyectos/D1/map/CONTEXT.md) |
| Servidor Express y endpoints HTTP/SSE | [server/server.js](file:///a:/Proyectos/D1/server/server.js) |
| Configuración de paneles de selección en UI | [frontend/src/components/panelConfig.js](file:///a:/Proyectos/D1/frontend/src/components/panelConfig.js) |
| Shell de escritorio Electron | [electron/main.cjs](file:///a:/Proyectos/D1/electron/main.cjs) |
