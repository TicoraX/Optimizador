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

const { app, BrowserWindow, dialog, shell } = require('electron');
log('electron requerido OK');

const PORT = process.env.PORT || 3001;
const APP_ORIGIN = `http://127.0.0.1:${PORT}`;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // Electron pinta blanco hasta que el renderer dibuja, y el backend tarda
    // unos segundos en levantar: se veia un recuadro blanco en una esquina de
    // la pantalla. `show: false` la muestra recien cuando ya pinto, y el color
    // de fondo (el mismo --color-paper del tema oscuro) cubre los repintados.
    show: false,
    backgroundColor: '#0e1218',
    autoHideMenuBar: true,
    // Los defaults de Electron 33 ya son estos, pero declararlos evita que un
    // upgrade futuro los afloje en silencio.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Los reportes se renderizan como Markdown y pueden contener links. Sin esto,
  // un link externo navega la ventana fuera de la app y el destino queda
  // corriendo con el origin del backend.
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

  // El layout es responsive (rail + Bento se reacomodan en 1100px y 760px),
  // asi que abrir maximizada aprovecha el monitor en vez de dejar una ventana
  // de 1280x800 perdida en una esquina.
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  win.loadURL(APP_ORIGIN);
}

// Sin esto, una segunda instancia intenta bindear el puerto, el server sale con
// EADDRINUSE y la ventana queda en ERR_CONNECTION_REFUSED sin explicacion.
if (!app.requestSingleInstanceLock()) {
  log('Ya hay una instancia corriendo, saliendo');
  app.quit();
  return;
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  try {
    // app.asar es de solo lectura; los reportes de cada modulo necesitan una carpeta real
    process.env.OPTIMIZADOR_DATA_DIR = app.getPath('userData');

    // Notify.ps1 lo ejecuta el Task Scheduler con `powershell -File`, asi que
    // tiene que ser un archivo real en disco. Empaquetado va como
    // extraResources (fuera del asar, que PowerShell no sabe leer), y su ruta
    // no coincide con la de datos: apuntarlo a userData creaba tareas con un
    // -File inexistente.
    process.env.OPTIMIZADOR_SCRIPTS_DIR = app.isPackaged
      ? path.join(process.resourcesPath, 'scripts')
      : path.join(__dirname, '..', 'scripts');
    log(`whenReady: importando server.js (data dir: ${process.env.OPTIMIZADOR_DATA_DIR})`);
    // Arranca el backend Express en el mismo proceso (ya bindea solo a 127.0.0.1:3001)
    await import('../server/server.js');
    log('server.js importado OK, creando ventana');
    createWindow();
    // require()'d aqui (no al top del archivo): el getter de electron-updater
    // construye el AppUpdater al accederlo, y necesita `app` ya listo (post whenReady)
    require('electron-updater').autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    log(`ERROR fatal: ${err.stack || err}`);
    dialog.showErrorBox('Optimizador - Error al iniciar', String(err.stack || err));
  }
});

app.on('window-all-closed', () => app.quit());
