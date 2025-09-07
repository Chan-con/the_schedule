// Electron preload script
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
  
  // URL操作のAPI
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  
  // 通知関連のAPI
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),
  scheduleNotification: (options) => ipcRenderer.invoke('schedule-notification', options),
  cancelNotification: (id) => ipcRenderer.invoke('cancel-notification', id),
  cancelAllNotifications: () => ipcRenderer.invoke('cancel-all-notifications'),
};
