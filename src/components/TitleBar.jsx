import React, { useState, useEffect } from 'react';

const TitleBar = ({ onSettingsClick }) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // 最大化状態をチェック
    if (window.electronAPI) {
      window.electronAPI.isMaximized().then(setIsMaximized);
    }
  }, []);

  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.minimize();
    }
  };

  const handleMaximize = () => {
    if (window.electronAPI) {
      window.electronAPI.maximize().then(() => {
        // 状態を更新
        window.electronAPI.isMaximized().then(setIsMaximized);
      });
    }
  };

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.close();
    }
  };

  return (
    <div className="flex items-center justify-between bg-gradient-to-r from-indigo-800 to-purple-800 text-white h-8 px-4 select-none" 
         style={{ WebkitAppRegion: 'drag' }}>
  <div className="flex items-center space-x-3" />
      
      <div className="flex items-center space-x-1 text-white" style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={onSettingsClick}
          className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-white hover:bg-opacity-20 rounded text-xs"
          title="設定"
        >
          ⚙️
        </button>
        
        <button
          onClick={handleMinimize}
          className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-black hover:bg-opacity-10 text-xs font-bold"
          title="最小化"
        >
          −
        </button>
        
        <button
          onClick={handleMaximize}
          className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-black hover:bg-opacity-10 text-xs font-bold"
          title={isMaximized ? "元のサイズに戻す" : "最大化"}
        >
          {isMaximized ? '⧉' : '□'}
        </button>
        
        <button
          onClick={handleClose}
          className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-red-500 text-xs font-bold"
          title="閉じる"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
