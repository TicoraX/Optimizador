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
    const http = require('http');
    const data = JSON.stringify(body);
    const req = http.request(`${APP_ORIGIN}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Origin': APP_ORIGIN,
      },
    }, (res) => {
      let isDone = false;
      let hasError = false;
      let rawData = '';

      res.on('data', (chunk) => {
        rawData += chunk.toString();
        if (rawData.includes('event: done')) isDone = true;
        if (rawData.includes('event: error')) hasError = true;
      });

      res.on('end', () => {
        if (res.statusCode === 200 && isDone && !hasError) {
          showNotification('Optimizador', successMsg);
        } else if (hasError || res.statusCode >= 400) {
          showNotification('Optimizador', 'No se pudo completar la acción rápida.');
        }
      });
    });
    req.on('error', (err) => {
      log(`runTrayAction error: ${err.message}`);
    });
    req.write(data);
    req.end();
  } catch (err) {
    log(`runTrayAction exception: ${err.message}`);
  }
}

function createTray(win) {
  if (tray) return;

  // Icono SVG o fallback nativo 16x16
  const iconPath = path.join(__dirname, '..', 'frontend', 'public', 'favicon.svg');
  let icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

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
        runTrayAction('/api/action/ram', { cleanMode: 'soft', minRamMB: 50, processes: '1234' }, 'Memoria RAM optimizada exitosamente.');
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

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  win.on('close', (event) => {
    if (!isQuiting) {
      event.preventDefault();
      win.hide();
      return false;
    }
  });

  win.loadURL(APP_ORIGIN);
  createTray(win);
}

if (!app.requestSingleInstanceLock()) {
  log('Ya hay una instancia corriendo, saliendo');
  app.quit();
  return;
}

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
    log('server.js importado OK, creando ventana');
    createWindow();
    require('electron-updater').autoUpdater.checkForUpdatesAndNotify();
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
