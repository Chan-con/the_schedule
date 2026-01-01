const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const ensureDirSync = (dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    // ignore
  }
};

// Windows環境でChromiumのDisk/GPUキャッシュ作成に失敗して
// レンダラープロセスが落ちるケースがあるため、キャッシュ保存先を明示する。
// (アクセス拒否で "Unable to create cache" が出る場合の回避)
try {
  const cacheRoot = path.join(app.getPath('userData'), 'chromium-cache');
  const sessionRoot = path.join(cacheRoot, `session-${process.pid}`);
  const diskCacheDir = path.join(sessionRoot, 'disk');
  const gpuCacheDir = path.join(sessionRoot, 'gpu');

  ensureDirSync(diskCacheDir);
  ensureDirSync(gpuCacheDir);

  app.commandLine.appendSwitch('disk-cache-dir', diskCacheDir);
  app.commandLine.appendSwitch('gpu-disk-cache-dir', gpuCacheDir);
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
} catch (error) {
  console.error('[Cache] Failed to configure Chromium cache dirs:', error);
}

let mainWindow;
let tray = null;
let isQuitting = false;
const protocolScheme = 'schedule-app';
let pendingAuthUrl = null;
let pendingSupabaseJobs = 0;
let isWaitingForSupabaseToClose = false;
const supabaseJobWaiters = [];

const waitForSupabaseJobs = () => {
  if (pendingSupabaseJobs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    supabaseJobWaiters.push(resolve);
  });
};

const resolveSupabaseJobWaiters = () => {
  while (supabaseJobWaiters.length > 0) {
    const resolve = supabaseJobWaiters.shift();
    try {
      resolve();
    } catch (error) {
      console.error('[SupabaseJob] Failed to resolve waiter:', error);
    }
  }
};

// 設定ファイルのパス
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// デフォルト設定
// hotkey はデフォルト無し（未設定=空文字）
const defaultSettings = {
  hotkey: '',
  startWithSystem: false,
  minimizeToTray: true,
  discordWebhookUrl: '',
  discordNotifyEnabled: false,
  splitRatio: 50,           // カレンダー:タイムライン 比率 (％)
  allDayHeight: 200         // 終日エリア高さ(px)
};

// 設定の読み込み
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const user = JSON.parse(data);
  // hotkey 未定義なら空文字を補う
  if (user.hotkey === undefined || user.hotkey === null) user.hotkey = '';
  if (user.discordWebhookUrl === undefined || user.discordWebhookUrl === null) user.discordWebhookUrl = '';
  if (user.discordNotifyEnabled === undefined) user.discordNotifyEnabled = false;
  if (typeof user.splitRatio !== 'number' || isNaN(user.splitRatio)) user.splitRatio = 50;
  if (user.splitRatio < 20 || user.splitRatio > 80) user.splitRatio = 50;
  if (typeof user.allDayHeight !== 'number' || isNaN(user.allDayHeight)) user.allDayHeight = 200;
  if (user.allDayHeight < 80) user.allDayHeight = 80;
  return { ...defaultSettings, ...user };
    }
  } catch (error) {
    console.error('設定の読み込みに失敗:', error);
  }
  return { ...defaultSettings };
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

const deepLinkMatcher = new RegExp(`^${protocolScheme}://`, 'i');

const extractDeepLinkFromArgs = (argv = []) => {
  if (!Array.isArray(argv)) return null;
  return argv.find((arg) => typeof arg === 'string' && deepLinkMatcher.test(arg)) || null;
};

const dispatchAuthCallback = (url) => {
  if (!url) return;
  try {
    console.log('[Auth] Dispatching Supabase OAuth callback URL:', url);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.webContents.isLoading()) {
        pendingAuthUrl = url;
        return;
      }
      mainWindow.webContents.send('supabase-auth-callback', url);
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    } else {
      pendingAuthUrl = url;
    }
  } catch (error) {
    console.error('[Auth] Failed to dispatch OAuth callback:', error);
    pendingAuthUrl = url;
  }
};

const handleDeepLink = (url) => {
  if (!url) return;
  if (!deepLinkMatcher.test(url)) return;
  console.log('[Auth] Received deep link:', url);
  dispatchAuthCallback(url);
};

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = extractDeepLinkFromArgs(argv);
    if (url) {
      handleDeepLink(url);
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    showWindow();
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

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
      preload: path.join(__dirname, 'preload.cjs'),
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

  // デバッグ用：レンダラープロセスが落ちた理由を表示
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Renderer] render-process-gone:', details);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingAuthUrl) {
      try {
        mainWindow.webContents.send('supabase-auth-callback', pendingAuthUrl);
        pendingAuthUrl = null;
      } catch (error) {
        console.error('[Auth] Failed to deliver pending auth URL:', error);
      }
    }
  });

  // ウィンドウのクローズ動作をカスタマイズ
  mainWindow.on('close', (event) => {
    const settings = loadSettings();
    if (!isQuitting && settings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      console.log('ウィンドウをトレイに最小化');
      return;
    }

    if (pendingSupabaseJobs > 0) {
      event.preventDefault();
      if (!isWaitingForSupabaseToClose) {
        isWaitingForSupabaseToClose = true;
        console.log(`[SupabaseJob] ${pendingSupabaseJobs}件の通信が完了するまで終了を保留します。`);
        waitForSupabaseJobs()
          .then(() => {
            isWaitingForSupabaseToClose = false;
            if (mainWindow && !mainWindow.isDestroyed()) {
              console.log('[SupabaseJob] 通信が完了しました。アプリケーションを終了します。');
              isQuitting = true;
              mainWindow.close();
            }
          })
          .catch((error) => {
            isWaitingForSupabaseToClose = false;
            console.error('[SupabaseJob] 通信完了待機中にエラーが発生しました:', error);
            if (mainWindow && !mainWindow.isDestroyed()) {
              isQuitting = true;
              mainWindow.close();
            }
          });
      } else {
        console.log('[SupabaseJob] 終了待機中です。');
      }
      return;
    }

    console.log('ウィンドウを閉じています');
  });

  // ウィンドウが破棄される直前の処理
  mainWindow.on('closed', () => {
    console.log('メインウィンドウが破棄されました');
    mainWindow = null;
  });

  // WebContentsの破棄処理
  mainWindow.webContents.on('destroyed', () => {
    console.log('WebContentsが破棄されました');
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
      click: async () => {
        console.log('トレイメニューから終了が選択されました');
        isQuitting = true;

        try {
          if (pendingSupabaseJobs > 0) {
            console.log(`[SupabaseJob] ${pendingSupabaseJobs}件の通信完了を待ってから終了します。`);
            await waitForSupabaseJobs();
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.once('closed', () => {
              app.quit();
            });
            mainWindow.close();
          } else {
            app.quit();
          }
        } catch (error) {
          console.error('トレイメニュー終了処理中にエラー:', error);
          process.exit(1);
        }
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
  // 一旦すべて解除
  globalShortcut.unregisterAll();
  // 未設定（空文字 / null / undefined）は登録しない
  if (!accelerator) {
    console.log('グローバルショートカット未設定（登録なし）');
    return;
  }
  const ret = globalShortcut.register(accelerator, () => { toggleWindow(); });
  if (!ret) {
    console.error('ショートカットの登録に失敗:', accelerator);
  } else {
    console.log('ショートカットを登録:', accelerator);
  }
}

// グローバルショートカットの解除
function unregisterGlobalShortcut() {
  globalShortcut.unregisterAll();
  console.log('グローバルショートカットを解除しました');
}

// Discord Webhook 送信（軽量）
function postToDiscord(webhookUrl, payload) {
  return new Promise((resolve) => {
    try {
      if (!webhookUrl) return resolve({ success: false, error: 'empty webhook' });
      const url = new URL(webhookUrl);
      const https = require('https');
      const data = JSON.stringify(payload);
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };
      const req = https.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: 'status ' + res.statusCode });
          }
        });
      });
      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.write(data);
      req.end();
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

// Discord テスト送信
ipcMain.handle('discord-test', async () => {
  const settings = loadSettings();
  if (!settings.discordNotifyEnabled || !settings.discordWebhookUrl) {
    return { success: false, error: 'Discord未設定' };
  }
  const payload = { content: '✅ Discord 通知テスト: 連携成功です。' };
  return await postToDiscord(settings.discordWebhookUrl, payload);
});

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
  if (settings.hotkey === undefined || settings.hotkey === null) settings.hotkey = '';
  if (settings.discordWebhookUrl === undefined || settings.discordWebhookUrl === null) settings.discordWebhookUrl = '';
  if (settings.discordNotifyEnabled === undefined) settings.discordNotifyEnabled = false;
  if (typeof settings.splitRatio !== 'number' || isNaN(settings.splitRatio)) settings.splitRatio = 50;
  if (settings.splitRatio < 20 || settings.splitRatio > 80) settings.splitRatio = 50;
  if (typeof settings.allDayHeight !== 'number' || isNaN(settings.allDayHeight)) settings.allDayHeight = 200;
  if (settings.allDayHeight < 80) settings.allDayHeight = 80;
  const success = saveSettings(settings);
  if (success && settings.startWithSystem) {
    app.setLoginItemSettings({
      openAtLogin: settings.startWithSystem
    });
  }
  return success;
});

ipcMain.on('supabase-job-start', (_event, meta = {}) => {
  pendingSupabaseJobs += 1;
  console.log('[SupabaseJob] start', {
    pendingSupabaseJobs,
    meta,
  });
});

ipcMain.on('supabase-job-end', (_event, meta = {}) => {
  pendingSupabaseJobs = Math.max(0, pendingSupabaseJobs - 1);
  console.log('[SupabaseJob] end', {
    pendingSupabaseJobs,
    meta,
  });
  if (pendingSupabaseJobs === 0) {
    resolveSupabaseJobWaiters();
  }
});

ipcMain.handle('register-global-shortcut', (event, accelerator) => {
  if (!accelerator) {
    unregisterGlobalShortcut();
    console.log('（IPC）未設定のためショートカット登録スキップ');
    return;
  }
  registerGlobalShortcut(accelerator);
});

ipcMain.handle('unregister-global-shortcut', () => {
  unregisterGlobalShortcut();
});

// レイアウトのみ保存 (頻繁に呼ばれるため軽量)
ipcMain.handle('save-layout', (event, layout) => {
  try {
    const settings = loadSettings();
    const next = { ...settings };
    if (typeof layout.splitRatio === 'number' && !isNaN(layout.splitRatio)) {
      next.splitRatio = Math.min(80, Math.max(20, layout.splitRatio));
    }
    if (typeof layout.allDayHeight === 'number' && !isNaN(layout.allDayHeight)) {
      next.allDayHeight = Math.max(80, layout.allDayHeight);
    }
    saveSettings(next);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
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

ipcMain.handle('get-pending-auth-url', () => {
  const url = pendingAuthUrl;
  pendingAuthUrl = null;
  return url;
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

    console.log(`🔔 通知スケジュール: ${title}`);
    console.log(`📅 現在時刻: ${new Date(now).toLocaleString()}`);
    console.log(`⏰ 通知時刻: ${new Date(notificationTime).toLocaleString()}`);
    console.log(`⏱️ 遅延: ${delay}ms (${Math.round(delay / 1000)}秒)`);

    // 既存のタイマーがあれば削除
    if (notificationTimers.has(id)) {
      clearTimeout(notificationTimers.get(id));
      console.log(`🗑️ 既存タイマーを削除: ${id}`);
    }

    // 最小遅延時間を設定（1秒）
    if (delay <= 1000) {
      console.log(`❌ 通知時間が過去または直近すぎます: ${delay}ms`);
      return { success: false, error: 'Notification time is in the past or too soon' };
    }

    // JavaScriptのsetTimeoutの最大値チェック（約24.8日）
    const MAX_TIMEOUT = 2147483647; // 32ビット整数の最大値
    
    if (delay > MAX_TIMEOUT) {
      console.log(`⚠️ 通知時間が遠すぎます (${Math.round(delay / 86400000)}日後)`);
      console.log(`🚫 JavaScript setTimeout制限により、この通知はスケジュールできません`);
      
      // 24日以内の通知のみスケジュール可能であることをユーザーに通知
      return { 
        success: false, 
        error: 'Notification time is too far in the future (max 24 days)',
        maxDays: Math.floor(MAX_TIMEOUT / 86400000)
      };
    }

    const timer = setTimeout(() => {
      console.log(`🔔 通知実行: ${title}`);
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
      // Discord 連携（失敗しても無視）
      try {
        const settings = loadSettings();
        if (settings.discordNotifyEnabled && settings.discordWebhookUrl) {
          const content = `**${(title || 'スケジュール通知').slice(0,100)}**\n${(body || '').slice(0,1800)}`;
          postToDiscord(settings.discordWebhookUrl, { content });
        }
      } catch (e) {
        console.error('Discord通知失敗:', e);
      }
        
      // タイマーをMapから削除
      notificationTimers.delete(id);
    }, delay);

    notificationTimers.set(id, timer);
    console.log(`✅ 通知タイマー設定完了: ${id}`);
    return { success: true, scheduledFor: new Date(notificationTime).toISOString() };
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

if (gotSingleInstanceLock) {
app.whenReady().then(() => {
  try {
    console.log('Electronアプリケーション起動中...');
    
    // アプリのアイコンを設定
    app.setAppUserModelId('com.schedule.app');

    if (process.platform === 'win32') {
      if (process.defaultApp) {
        if (process.argv.length >= 2) {
          app.setAsDefaultProtocolClient(protocolScheme, process.execPath, [path.resolve(process.argv[1])]);
        }
      } else {
        app.setAsDefaultProtocolClient(protocolScheme);
      }
    } else {
      app.setAsDefaultProtocolClient(protocolScheme);
    }
    
    createWindow();
    createTray();
    
    // 初期設定のホットキーを登録
    const settings = loadSettings();
    if (settings.hotkey) {
      registerGlobalShortcut(settings.hotkey);
    } else {
      console.log('起動時ホットキー未設定');
    }

    const initialDeepLink = extractDeepLinkFromArgs(process.argv);
    if (initialDeepLink) {
      handleDeepLink(initialDeepLink);
    }
    
    console.log('アプリケーション起動完了');
  } catch (error) {
    console.error('アプリケーション起動中にエラー:', error);
    app.quit();
  }

  app.on('activate', () => {
    try {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else {
        showWindow();
      }
    } catch (error) {
      console.error('activate処理中にエラー:', error);
    }
  });
}).catch((error) => {
  console.error('アプリケーション起動に失敗:', error);
  process.exit(1);
});
}

app.on('window-all-closed', () => {
  console.log('全てのウィンドウが閉じられました');
  // macOS以外では、すべてのウィンドウが閉じられてもアプリは終了しない（タスクトレイで動作）
  if (process.platform !== 'darwin' && !isQuitting) {
    console.log('タスクトレイで動作継続');
    // アプリは終了しない
  } else if (process.platform === 'darwin') {
    console.log('macOS: アプリケーション終了');
    app.quit();
  }
});

// デバッグ用：子プロセス（GPUなど）が落ちた理由を表示
app.on('child-process-gone', (_event, details) => {
  console.error('[Process] child-process-gone:', details);
});

app.on('before-quit', () => {
  console.log('アプリケーション終了処理を開始');
  isQuitting = true;
  
  try {
    // 全ての通知タイマーをクリア
    console.log(`通知タイマーをクリア中: ${notificationTimers.size}個`);
    for (const timer of notificationTimers.values()) {
      clearTimeout(timer);
    }
    notificationTimers.clear();
    
    // トレイアイコンを破棄
    if (tray) {
      tray.destroy();
      tray = null;
      console.log('トレイアイコンを破棄');
    }
    
    console.log('終了処理完了');
  } catch (error) {
    console.error('終了処理中にエラー:', error);
  }
});

app.on('will-quit', (event) => {
  try {
    // グローバルショートカットの解除
    globalShortcut.unregisterAll();
    console.log('グローバルショートカットを解除');
    
    // 最終的なクリーンアップ
    if (notificationTimers.size > 0) {
      console.warn(`警告: まだクリアされていないタイマー: ${notificationTimers.size}個`);
      for (const timer of notificationTimers.values()) {
        clearTimeout(timer);
      }
      notificationTimers.clear();
    }
  } catch (error) {
    console.error('will-quit処理中にエラー:', error);
    // エラーが発生してもアプリの終了は継続
  }
});

// プロセス終了時の緊急クリーンアップ
process.on('exit', () => {
  console.log('プロセス終了: 緊急クリーンアップ実行');
  try {
    if (notificationTimers.size > 0) {
      for (const timer of notificationTimers.values()) {
        clearTimeout(timer);
      }
      notificationTimers.clear();
    }
  } catch (error) {
    console.error('緊急クリーンアップ中にエラー:', error);
  }
});

// 未処理の例外をキャッチ
process.on('uncaughtException', (error) => {
  console.error('未処理の例外:', error);
  try {
    // 緊急クリーンアップ
    if (notificationTimers.size > 0) {
      for (const timer of notificationTimers.values()) {
        clearTimeout(timer);
      }
      notificationTimers.clear();
    }
    if (tray) {
      tray.destroy();
    }
  } catch (cleanupError) {
    console.error('緊急クリーンアップエラー:', cleanupError);
  }
  process.exit(1);
});

// 未処理のPromise拒否をキャッチ
process.on('unhandledRejection', (reason, promise) => {
  console.error('未処理のPromise拒否:', reason);
  console.error('Promise:', promise);
});
