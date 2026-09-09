# Matriz de Impacto de Cambios — The 5-Files Rule (map/IMPACT.md)

Cuando un agente agrega un nuevo módulo o modifica el contrato de uno existente, **debe tocar o verificar exactamente 5 archivos en el repositorio**. Si alguno se omite, el flujo se rompe.

---

## The 5-Files Rule (Lista de Verificación Obligatoria)

```text
1. [Backend Logic]      server/lib/<module>.js
2. [Server Dispatcher]  server/server.js
3. [UI Hook Config]     frontend/src/hooks/useModuleItems.js
4. [UI Panel Layout]    frontend/src/components/panelConfig.js
5. [Automated Tests]    server/tests/<module>.test.js & e2e-qa-safe.test.js
```

---

### Detalle de Responsabilidades por Archivo

### 1. `server/lib/<module>.js`
- **Debe exportar**:
  - `run<Module>ScanNative(onOutput, onProgress)`: Función de escaneo que guarde `report.md` y `items.json` con `finishReport()`.
  - `run<Module>ActionNative(envVars, onOutput, onProgress)`: Función de optimización que soporte `dryRun` mediante `makeGuard`.
- **Invariante**: No lanzar scripts `.ps1` sueltos. Usar `spawnCapture` de `shared.js`.

### 2. `server/server.js`
- **Debe registrar**:
  - `VALID_MODULES`: Añadir el nombre del módulo.
  - `SCAN_HANDLERS`: Mapear clave del módulo a `run<Module>ScanNative`.
  - `ACTION_HANDLERS`: Mapear clave del módulo a `run<Module>ActionNative`.
  - **Mapeo de Parámetros**: Convertir `req.body.<param>` a `envVars.<PARAM>` (en mayúsculas) con validadores como `validateIdList`.
  - `SELECTION_FIELDS`: Declarar las claves de `envVars` requeridas para que la petición no sea rechazada con 400.

### 3. `frontend/src/hooks/useModuleItems.js`
- **Debe registrar**:
  - `MODULE_CONFIG`: Definir `{ idKey, defaultCheck: (item) => boolean }`.
  - Controla qué propiedad actúa como ID único y qué casillas vienen marcadas por defecto al cargar `/api/reports/:module/items`.

### 4. `frontend/src/components/panelConfig.js`
- **Debe registrar en `GENERIC_PANEL_CONFIG`**:
  - `label`: Título de la sección de selección.
  - `hint`: Instrucción para el usuario.
  - `bodyKey`: Nombre del campo en el body HTTP (ej. `packages`, `services`, `actions`).
  - `bodyFormat`: Formato de envío (`'csv'` o `'json'`).
  - `renderItem(item)`: Función que retorna `{ prefix, title, subtitle, statusColor }`.

### 5. `server/tests/<module>.test.js` & `server/tests/e2e-qa-safe.test.js`
- **Debe implementar**:
  - Pruebas unitarias de escaneo y acción en simulación (`DRY_RUN: 'true'`).
  - Añadir el módulo al array `testModules` en `server/tests/e2e-qa-safe.test.js` con su carga útil `body: { dryRun: true, ... }` para verificar el flujo completo de SSE.

---

## Matriz de Impacto Cruzado: ¿Qué se rompe si tocas...?

| Si modificas... | Rompe inmediatamente... | Síntoma evidente |
|---|---|---|
| El nombre de una clave en `server/lib/<mod>.js` (`envVars.FOO`) | `server/server.js` (si no mapea `req.body.foo` a `envVars.FOO`) | La acción se ejecuta en vacío o ignora lo seleccionado por el usuario. |
| El campo `bodyKey` en `panelConfig.js` | `server/server.js` (`SELECTION_FIELDS`) | La UI envía `{ items: [...] }` pero el servidor espera `{ packages: [...] }` -> Error HTTP 400. |
| `items.json` sin propiedad `idKey` | `useModuleItems.js` | Los checkboxes no se pueden marcar ni desmarcar individualmente. |
| Olvidar `defaultCheck` en `useModuleItems.js` | La experiencia de usuario | Todas las casillas aparecen desmarcadas o se marcan elementos peligrosos por error. |
| Olvidar agregar el módulo a `e2e-qa-safe.test.js` | La suite de regresión | El módulo no queda protegido en CI/CD y fallos en endpoints pasan desapercibidos. |
