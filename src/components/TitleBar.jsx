import React, { useState, useEffect } from 'react';

const TitleBar = ({ onSettingsClick, auth }) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const user = auth?.user || null;
  const isAuthLoading = auth?.isLoading || false;
  const isAuthProcessing = auth?.isProcessing || false;

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

  const handleLogin = async () => {
    if (auth?.onLogin && !isAuthProcessing) {
      try {
        await auth.onLogin();
      } catch (error) {
        console.error('[Auth] ログインに失敗しました:', error);
      }
    }
  };

  const handleLogout = async () => {
    if (auth?.onLogout && !isAuthProcessing) {
      try {
        await auth.onLogout();
      } catch (error) {
        console.error('[Auth] ログアウトに失敗しました:', error);
      }
    }
  };

  const userDisplayName = user?.user_metadata?.full_name
    || user?.user_metadata?.name
    || user?.email
    || user?.phone
    || 'ログイン中';

  return (
    <div className="flex items-center justify-between bg-gradient-to-r from-indigo-800 to-purple-800 text-white h-8 px-4 select-none" 
         style={{ WebkitAppRegion: 'drag' }}>
      <div className="flex items-center space-x-3" style={{ WebkitAppRegion: 'no-drag' }}>
        <span className="text-sm font-semibold tracking-wide">スケジュール帳</span>
        {auth && (
          <div className="flex items-center space-x-2">
            {user ? (
              <>
                <span
                  className="max-w-[160px] truncate text-xs text-indigo-100"
                  title={userDisplayName}
                >
                  {userDisplayName}
                </span>
                <button
                  onClick={handleLogout}
                  disabled={isAuthProcessing}
                  className={`px-2 py-0.5 rounded text-[11px] border border-white/40 transition-all duration-200 ${isAuthProcessing ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/20'}`}
                  style={{ WebkitAppRegion: 'no-drag' }}
                >
                  ログアウト
                </button>
              </>
            ) : (
              <button
                onClick={handleLogin}
                disabled={isAuthLoading || isAuthProcessing}
                className={`px-2 py-0.5 rounded text-[11px] border border-white/50 bg-white/10 backdrop-blur-sm transition-all duration-200 ${isAuthLoading || isAuthProcessing ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/20'}`}
                style={{ WebkitAppRegion: 'no-drag' }}
              >
                Googleでログイン
              </button>
            )}
          </div>
        )}
      </div>
      
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
