// Electron preload script
const { ipcRenderer } = require('electron');

// ウィンドウ操作用のAPIをwindowオブジェクトに追加
window.electronAPI = {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
};
