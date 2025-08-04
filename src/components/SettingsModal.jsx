import React, { useState, useEffect } from 'react';

const SettingsModal = ({ isOpen, onClose }) => {
  const [hotkey, setHotkey] = useState('Control+Alt+S');
  const [startWithSystem, setStartWithSystem] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(true);

  useEffect(() => {
    if (isOpen && window.electronAPI) {
      // 現在の設定を読み込み
      window.electronAPI.getSettings().then((settings) => {
        setHotkey(settings.hotkey || 'Control+Alt+S');
        setStartWithSystem(settings.startWithSystem || false);
        setMinimizeToTray(settings.minimizeToTray || true);
      });
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (window.electronAPI) {
      const settings = {
        hotkey,
        startWithSystem,
        minimizeToTray
      };
      
      await window.electronAPI.saveSettings(settings);
      await window.electronAPI.registerGlobalShortcut(hotkey);
      onClose();
    }
  };

  const handleHotkeyChange = (e) => {
    const value = e.target.value;
    // 基本的なキー組み合わせの検証
    if (value.includes('Control') || value.includes('Alt') || value.includes('Shift')) {
      setHotkey(value);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-96 max-w-[90vw]">
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
          <h2 className="text-lg font-semibold text-gray-800">設定</h2>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 text-sm font-bold bg-transparent hover:bg-gray-100 rounded"
          >
            ×
          </button>
        </div>

        {/* 内容 */}
        <div className="p-4 space-y-4 bg-white">
          {/* ホットキー設定 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              グローバルホットキー
            </label>
            <input
              type="text"
              value={hotkey}
              onChange={handleHotkeyChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-gray-900"
              placeholder="Control+Alt+S"
            />
            <p className="text-xs text-gray-500 mt-1">
              例: Control+Alt+S, Control+Shift+Q
            </p>
          </div>

          {/* システム起動時の設定 */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="startWithSystem"
              checked={startWithSystem}
              onChange={(e) => setStartWithSystem(e.target.checked)}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
            <label htmlFor="startWithSystem" className="ml-2 text-sm text-gray-700">
              システム起動時に自動実行
            </label>
          </div>

          {/* タスクトレイ最小化設定 */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="minimizeToTray"
              checked={minimizeToTray}
              onChange={(e) => setMinimizeToTray(e.target.checked)}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
            <label htmlFor="minimizeToTray" className="ml-2 text-sm text-gray-700">
              閉じるボタンでタスクトレイに最小化
            </label>
          </div>
        </div>

        {/* フッター */}
        <div className="flex items-center justify-end space-x-2 p-4 border-t border-gray-200 bg-white">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 bg-white hover:bg-gray-50 border border-gray-300 rounded-md"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
