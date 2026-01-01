import React from 'react';

const TitleBar = ({ onSettingsClick, auth }) => {
  const user = auth?.user || null;
  const isAuthLoading = auth?.isLoading || false;
  const isAuthProcessing = auth?.isProcessing || false;

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
    <div className="flex items-center justify-between bg-gradient-to-r from-indigo-800 to-purple-800 text-white h-8 px-4 select-none">
      <div className="flex items-center space-x-3">
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
                  className={`appearance-none bg-transparent text-white h-auto px-2 py-0.5 rounded text-[11px] border border-white/40 transition-all duration-200 ${isAuthProcessing ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/20'}`}
                >
                  ログアウト
                </button>
              </>
            ) : (
              <button
                onClick={handleLogin}
                disabled={isAuthLoading || isAuthProcessing}
                className={`h-auto px-2 py-0.5 rounded text-[11px] border border-white/50 bg-white/10 backdrop-blur-sm transition-all duration-200 ${isAuthLoading || isAuthProcessing ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/20'}`}
              >
                Googleでログイン
              </button>
            )}
          </div>
        )}
      </div>
      
      <div className="flex items-center space-x-1 text-white">
        <button
          onClick={onSettingsClick}
          className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-white hover:bg-opacity-20 rounded text-xs"
          title="設定"
        >
          ⚙️
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
