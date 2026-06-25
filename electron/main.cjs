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

const { app, BrowserWindow, dialog } = require('electron');
log('electron requerido OK');

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 800, autoHideMenuBar: true });
  win.loadURL('http://127.0.0.1:3001');
}

app.whenReady().then(async () => {
  try {
    // app.asar es de solo lectura; los reportes de cada modulo necesitan una carpeta real
    process.env.OPTIMIZADOR_DATA_DIR = app.getPath('userData');
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
