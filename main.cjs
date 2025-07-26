const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

// 開発環境かプロダクション環境かを判定
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
  // アイコンのパスを環境に応じて設定
  const iconPath = isDev 
    ? path.join(__dirname, 'asset', 'icon.PNG')
    : path.join(process.resourcesPath, 'asset', 'icon.PNG');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 320,  // スマホサイズまで縮小可能
    minHeight: 480, // スマホサイズまで縮小可能
    icon: iconPath, // 環境に応じたアイコンパス
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
    
    // デバッグが必要な場合のみ開発者ツールを開く
    // if (!isDev) {
    //   mainWindow.webContents.openDevTools();
    // }
  });
  
  // デバッグ用：コンソールメッセージを表示
  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`Console [${level}]:`, message);
  });
  
  // デバッグ用：読み込み失敗時のエラー表示
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });
  
  // URLを環境に応じて設定
  if (isDev) {
    console.log('Development mode: Loading from localhost');
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // プロダクション環境では、main.cjsと同じディレクトリのdistフォルダから読み込む
    const htmlPath = path.join(__dirname, 'dist', 'index.html');
    console.log('Production mode - HTML path:', htmlPath);
    console.log('Production mode - __dirname:', __dirname);
    console.log('Production mode - File exists:', require('fs').existsSync(htmlPath));
    
    mainWindow.loadFile(htmlPath);
  }
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
  // アプリのアイコンを設定
  app.setAppUserModelId('com.schedule.app');
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
