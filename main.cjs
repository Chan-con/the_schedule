const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let tray = null;
let isQuitting = false;

// 設定ファイルのパス
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// デフォルト設定
const defaultSettings = {
  hotkey: 'Control+Alt+S',
  startWithSystem: false,
  minimizeToTray: true
};

// 設定の読み込み
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('設定の読み込みに失敗:', error);
  }
  return defaultSettings;
}

// 設定の保存
function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    console.error('設定の保存に失敗:', error);
    return false;
  }
}

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
  });
  
  // デバッグ用：コンソールメッセージを表示
  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`Console [${level}]:`, message);
  });
  
  // デバッグ用：読み込み失敗時のエラー表示
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  // ウィンドウのクローズ動作をカスタマイズ
  mainWindow.on('close', (event) => {
    const settings = loadSettings();
    if (!isQuitting && settings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
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

// タスクトレイの作成
function createTray() {
  const iconPath = isDev 
    ? path.join(__dirname, 'asset', 'icon.PNG')
    : path.join(process.resourcesPath, 'asset', 'icon.PNG');

  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'スケジュール帳を表示',
      click: () => {
        showWindow();
      }
    },
    {
      type: 'separator'
    },
    {
      label: '終了',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('スケジュール帳');
  tray.setContextMenu(contextMenu);
  
  // トレイアイコンのダブルクリックでウィンドウを表示
  tray.on('double-click', () => {
    showWindow();
  });
}

// ウィンドウの表示/非表示を切り替え
function toggleWindow() {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

// ウィンドウを表示
function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
}

// グローバルショートカットの登録
function registerGlobalShortcut(accelerator) {
  // 既存のショートカットを解除
  globalShortcut.unregisterAll();
  
  // 新しいショートカットを登録
  const ret = globalShortcut.register(accelerator, () => {
    toggleWindow();
  });

  if (!ret) {
    console.error('ショートカットの登録に失敗:', accelerator);
  } else {
    console.log('ショートカットを登録:', accelerator);
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
  const settings = loadSettings();
  if (settings.minimizeToTray) {
    mainWindow.hide();
  } else {
    isQuitting = true;
    mainWindow.close();
  }
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow.isMaximized();
});

// 設定関連のIPC
ipcMain.handle('get-settings', () => {
  return loadSettings();
});

ipcMain.handle('save-settings', (event, settings) => {
  const success = saveSettings(settings);
  if (success && settings.startWithSystem) {
    app.setLoginItemSettings({
      openAtLogin: settings.startWithSystem
    });
  }
  return success;
});

ipcMain.handle('register-global-shortcut', (event, accelerator) => {
  registerGlobalShortcut(accelerator);
});

// URLをデフォルトブラウザで開く
ipcMain.handle('open-url', (event, url) => {
  try {
    shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Error opening URL:', error);
    return { success: false, error: error.message };
  }
});

// 通知関連のIPC
ipcMain.handle('show-notification', (event, options) => {
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: options.title || 'スケジュール通知',
        body: options.body || '',
        icon: isDev 
          ? path.join(__dirname, 'asset', 'icon.PNG')
          : path.join(process.resourcesPath, 'asset', 'icon.PNG'),
        urgency: 'normal',
        timeoutType: 'default'
      });

      notification.on('click', () => {
        // 通知をクリックした時にアプリを表示
        showWindow();
      });

      notification.show();
      return { success: true };
    } else {
      console.warn('Notifications not supported');
      return { success: false, error: 'Notifications not supported' };
    }
  } catch (error) {
    console.error('Error showing notification:', error);
    return { success: false, error: error.message };
  }
});

// 通知のスケジュール管理
let notificationTimers = new Map();

ipcMain.handle('schedule-notification', (event, options) => {
  try {
    const { id, time, title, body } = options;
    const now = new Date().getTime();
    const notificationTime = new Date(time).getTime();
    const delay = notificationTime - now;

    // 既存のタイマーがあれば削除
    if (notificationTimers.has(id)) {
      clearTimeout(notificationTimers.get(id));
    }

    if (delay > 0) {
      const timer = setTimeout(() => {
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: title || 'スケジュール通知',
            body: body || '',
            icon: isDev 
              ? path.join(__dirname, 'asset', 'icon.PNG')
              : path.join(process.resourcesPath, 'asset', 'icon.PNG'),
            urgency: 'normal',
            timeoutType: 'default'
          });

          notification.on('click', () => {
            showWindow();
          });

          notification.show();
        }
        
        // タイマーをMapから削除
        notificationTimers.delete(id);
      }, delay);

      notificationTimers.set(id, timer);
      return { success: true, scheduledFor: new Date(notificationTime).toISOString() };
    } else {
      return { success: false, error: 'Notification time is in the past' };
    }
  } catch (error) {
    console.error('Error scheduling notification:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cancel-notification', (event, id) => {
  try {
    if (notificationTimers.has(id)) {
      clearTimeout(notificationTimers.get(id));
      notificationTimers.delete(id);
      return { success: true };
    }
    return { success: false, error: 'Notification not found' };
  } catch (error) {
    console.error('Error canceling notification:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cancel-all-notifications', () => {
  try {
    for (const timer of notificationTimers.values()) {
      clearTimeout(timer);
    }
    notificationTimers.clear();
    return { success: true };
  } catch (error) {
    console.error('Error canceling all notifications:', error);
    return { success: false, error: error.message };
  }
});

// 多重起動防止
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 2回目の起動時は既存のウィンドウを表示
    if (mainWindow) {
      showWindow();
    }
  });
}

app.whenReady().then(() => {
  // アプリのアイコンを設定
  app.setAppUserModelId('com.schedule.app');
  
  createWindow();
  createTray();
  
  // 初期設定のホットキーを登録
  const settings = loadSettings();
  registerGlobalShortcut(settings.hotkey);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // macOS以外では、すべてのウィンドウが閉じられてもアプリは終了しない（タスクトレイで動作）
  if (process.platform !== 'darwin' && !isQuitting) {
    // アプリは終了しない
  } else if (process.platform === 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  // グローバルショートカットの解除
  globalShortcut.unregisterAll();
});
