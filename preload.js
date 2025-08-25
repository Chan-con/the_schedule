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
  
  // URL操作のAPI
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
};
