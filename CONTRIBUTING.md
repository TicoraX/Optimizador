# Guía de Contribución — Optimizador

Gracias por tu interés en contribuir al Optimizador de Windows.

## 1. Principios de Arquitectura & Código

- **Lazy Senior Dev Mode (Ponytail & YAGNI)**: No agregues abstracciones innecesarias ni dependencias nuevas si la librería estándar o el lenguaje nativo ya lo resuelven.
- **Node.js Nativo**: Toda la lógica de optimización vive en módulos de Node.js en `server/lib/`. No se permiten llamadas directas a scripts PowerShell externos no autorizados.
- **Seguridad Primero**:
  - `spawn()` siempre con `shell: false` y argumentos como array.
  - Validación rigurosa de entradas y rutas con whitelist.
  - Comandos destructivos requieren confirmación y deben soportar simulación (`dryRun`).
  - Registro de cambios reversibles en el diario (`changes.js`).

## 2. Configuración del Entorno de Desarrollo

Requisitos:
- Node.js >= 20 (recomendado 22 LTS)
- Windows 10/11
- npm >= 9

Instalación:
```bash
# 1. Instalar dependencias raíz y subproyectos
npm install
npm install --prefix server
npm install --prefix frontend

# 2. Ejecutar frontend en modo desarrollo
npm run dev --prefix frontend

# 3. Ejecutar servidor backend
npm start --prefix server
```

## 3. Ejecución de Pruebas

Antes de enviar un Pull Request, ejecuta la suite de tests unitarios:
```bash
npm test
```

## 4. Convenciones de Commits y PRs

- Mensajes de commit directos, descriptivos y en español o inglés técnico sin emojis.
- Explicar el problema de raíz resuelto antes del diff.
- Si agregas un módulo nuevo, debe incluir su archivo de pruebas en `server/tests/<modulo>.test.js`.
