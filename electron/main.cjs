const fs = require('fs');
const os = require('os');
const path = require('path');

const logFile = path.join(os.tmpdir(), 'optimizador-startup.log');
function log(msg) {
  try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

process.on('uncaughtException', (err) => log(`uncaughtException: ${err.stack || err}`));
process.on('unhandledRejection', (err) => log(`unhandledRejection: ${err.stack || err}`));
log('main.cjs cargado');

const { app, BrowserWindow, dialog, shell, Tray, Menu, nativeImage, Notification } = require('electron');
log('electron requerido OK');

const PORT = process.env.PORT || 3001;
const APP_ORIGIN = `http://127.0.0.1:${PORT}`;

let tray = null;
let isQuiting = false;

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: true }).show();
  }
}

async function runTrayAction(endpoint, body, successMsg) {
  try {
    const res = await fetch(`${APP_ORIGIN}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': APP_ORIGIN,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok && text.includes('event: done') && !text.includes('event: error')) {
      showNotification('Optimizador', successMsg);
    } else {
      showNotification('Optimizador', 'No se pudo completar la acción rápida.');
    }
  } catch (err) {
    log(`runTrayAction exception: ${err.message}`);
  }
}

function getTrayIcon() {
  const candidates = [
    path.join(__dirname, '..', 'frontend', 'public', 'favicon.svg'),
    path.join(__dirname, '..', 'frontend', 'dist', 'favicon.svg'),
    path.join(process.resourcesPath, 'frontend', 'dist', 'favicon.svg'),
    path.join(process.resourcesPath, 'app.asar', 'frontend', 'dist', 'favicon.svg'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const img = nativeImage.createFromPath(candidate);
        if (!img.isEmpty()) {
          return img.resize({ width: 16, height: 16 });
        }
      } catch {}
    }
  }

  // Fallback garantizado: Bitmap de 16x16 en memoria (color acento azul #0ea5e9 en orden BGRA)
  const buffer = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < 16 * 16 * 4; i += 4) {
    buffer[i] = 233;    // B
    buffer[i + 1] = 165; // G
    buffer[i + 2] = 14;  // R
    buffer[i + 3] = 255; // Alpha
  }
  return nativeImage.createFromBuffer(buffer, { width: 16, height: 16 });
}

function createTray(win) {
  if (tray) return;

  try {
    const icon = getTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('Optimizador - Suite de Mantenimiento');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Abrir Optimizador',
        click: () => {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Optimizar RAM',
        click: () => {
          runTrayAction('/api/action/ram', { cleanMode: 'soft', globalOptimize: true }, 'Memoria RAM optimizada exitosamente.');
        },
      },
      {
        label: 'Limpieza rápida de temporales',
        click: () => {
          runTrayAction('/api/action/cleanup', { cleanCategories: ['temp', 'thumbnails'] }, 'Archivos temporales limpiados.');
        },
      },
      { type: 'separator' },
      {
        label: 'Salir',
        click: () => {
          isQuiting = true;
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    log('Tray creado correctamente');
  } catch (err) {
    log(`Aviso: No se pudo inicializar System Tray: ${err.message}`);
  }
}

async function waitForServer(url, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return false;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#0e1218',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== APP_ORIGIN) {
        event.preventDefault();
        if (/^https?:/i.test(url)) shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  let hasShown = false;
  const showWindow = () => {
    if (!hasShown && !win.isDestroyed()) {
      hasShown = true;
      log('Mostrando ventana principal');
      win.maximize();
      win.show();
      win.focus();
    }
  };

  win.once('ready-to-show', () => {
    log('Evento ready-to-show recibido');
    showWindow();
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log(`did-fail-load: ${errorCode} (${errorDescription}) en ${validatedURL}`);
    setTimeout(() => {
      if (!win.isDestroyed()) {
        log('Reintentando win.loadURL tras fallo de conexion inicial...');
        win.loadURL(APP_ORIGIN);
      }
    }, 600);
  });

  win.webContents.on('did-finish-load', () => {
    log('did-finish-load completado');
    showWindow();
  });

  win.on('close', (event) => {
    if (!isQuiting) {
      event.preventDefault();
      win.hide();
      return false;
    }
  });

  // Fallback de seguridad: asegurar visibilidad si ready-to-show demora
  setTimeout(() => {
    showWindow();
  }, 2000);

  win.loadURL(APP_ORIGIN);
  createTray(win);
}

if (!app.requestSingleInstanceLock()) {
  log('Ya hay una instancia corriendo, saliendo');
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.on('before-quit', () => {
    isQuiting = true;
  });

  app.whenReady().then(async () => {
    try {
      process.env.OPTIMIZADOR_DATA_DIR = app.getPath('userData');
      process.env.OPTIMIZADOR_SCRIPTS_DIR = app.isPackaged
        ? path.join(process.resourcesPath, 'scripts')
        : path.join(__dirname, '..', 'scripts');
      log(`whenReady: importando server.js (data dir: ${process.env.OPTIMIZADOR_DATA_DIR})`);
      await import('../server/server.js');
      log('server.js importado OK, esperando readiness del servidor HTTP');
      const ready = await waitForServer(APP_ORIGIN, 8000);
      log(`Servidor HTTP listo: ${ready}`);
      createWindow();
      if (app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
        try {
          require('electron-updater').autoUpdater.checkForUpdatesAndNotify().catch((err) => {
            log(`autoUpdater catch: ${err.message}`);
          });
        } catch (err) {
          log(`autoUpdater aviso: ${err.message}`);
        }
      }
    } catch (err) {
      log(`ERROR fatal: ${err.stack || err}`);
      dialog.showErrorBox('Optimizador - Error al iniciar', String(err.stack || err));
    }
  });

  app.on('window-all-closed', () => {
    if (isQuiting) {
      app.quit();
    }
  });
}
