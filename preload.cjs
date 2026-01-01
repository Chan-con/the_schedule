/* eslint-env node */
/* eslint-disable no-undef */
// Electron preload script (CommonJS)
const { ipcRenderer } = require('electron');

// ウィンドウ操作用のAPIをwindowオブジェクトに追加
window.electronAPI = {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // 設定関連のAPI
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  registerGlobalShortcut: (accelerator) => ipcRenderer.invoke('register-global-shortcut', accelerator),
  unregisterGlobalShortcut: () => ipcRenderer.invoke('unregister-global-shortcut'),
  saveLayout: (layout) => ipcRenderer.invoke('save-layout', layout),

  // URL操作のAPI
  openUrl: (url) => ipcRenderer.invoke('open-url', url),

  // 通知関連のAPI
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),
  scheduleNotification: (options) => ipcRenderer.invoke('schedule-notification', options),
  cancelNotification: (id) => ipcRenderer.invoke('cancel-notification', id),
  cancelAllNotifications: () => ipcRenderer.invoke('cancel-all-notifications'),
  // Discord
  discordTest: () => ipcRenderer.invoke('discord-test'),
  // Supabase OAuth
  onAuthCallback: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, url) => {
      callback(url);
    };
    ipcRenderer.on('supabase-auth-callback', listener);
    return () => {
      ipcRenderer.removeListener('supabase-auth-callback', listener);
    };
  },
  getPendingAuthUrl: () => ipcRenderer.invoke('get-pending-auth-url'),
  supabaseJobStart: (meta) => ipcRenderer.send('supabase-job-start', meta),
  supabaseJobEnd: (meta) => ipcRenderer.send('supabase-job-end', meta),
};
