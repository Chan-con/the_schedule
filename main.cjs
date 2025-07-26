const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 320,  // スマホサイズまで縮小可能
    minHeight: 480, // スマホサイズまで縮小可能
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
    frame: false, // フレームレスウィンドウ
    titleBarStyle: 'hidden', // タイトルバーを隠す
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    show: false, // 最初は非表示
  });
  
  // ウィンドウの準備ができたら表示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  mainWindow.loadURL('http://localhost:5173');
}

// IPC通信ハンドラー
ipcMain.handle('window-minimize', () => {
  mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('window-close', () => {
  mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow.isMaximized();
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
