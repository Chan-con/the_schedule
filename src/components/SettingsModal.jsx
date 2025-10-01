import React, { useState, useEffect, useRef } from 'react';

const SettingsModal = ({ isOpen, onClose }) => {
  const [hotkey, setHotkey] = useState('');
  const [startWithSystem, setStartWithSystem] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [discordNotifyEnabled, setDiscordNotifyEnabled] = useState(false);
  const [discordTestStatus, setDiscordTestStatus] = useState(null); // null | 'ok' | 'ng'
  const [shortcuts, setShortcuts] = useState({
    undo: 'Control+Z',
    redo: 'Control+Shift+Z',
  });
  const [editingShortcut, setEditingShortcut] = useState(null);
  const [pendingKeys, setPendingKeys] = useState([]);
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [previousHotkey, setPreviousHotkey] = useState(''); // キャンセル時の復元用
  // 各ショートカット用のref（フォーカスが当たらないとBackspace/Deleteが発火しない問題対策）
  const shortcutRefs = useRef({});
  const hotkeyBoxRef = useRef(null);
  // 重複などのエラー保持
  const [shortcutErrors, setShortcutErrors] = useState({});

  useEffect(() => {
    if (isOpen && window.electronAPI) {
      // 現在の設定を読み込み
      window.electronAPI.getSettings().then((settings) => {
        // 空文字 '' は未設定として尊重するため undefined/null の時だけデフォルト
        if (settings.hotkey === undefined || settings.hotkey === null) {
          setHotkey('');
        } else {
          setHotkey(settings.hotkey);
        }
  setStartWithSystem(settings.startWithSystem || false);
  setMinimizeToTray(settings.minimizeToTray || true);
  setDiscordWebhookUrl(settings.discordWebhookUrl || '');
  setDiscordNotifyEnabled(!!settings.discordNotifyEnabled);
      });
    }
    
    // ショートカット設定の読み込み
    const savedShortcuts = localStorage.getItem('scheduleAppShortcuts');
    if (savedShortcuts) {
      setShortcuts(JSON.parse(savedShortcuts));
    }

    // モーダル開いている間は背景のスクロールを防止
    if (isOpen) {
      // より強力なスクロール防止
      const preventAllScroll = (e) => {
        // モーダル内のスクロールは許可
        const isInModal = e.target.closest('.settings-modal-content');
        if (!isInModal) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      };

      // Escキーでモーダルを閉じる
      const handleEscKey = (e) => {
        if (e.key === 'Escape') {
          if (isCapturingHotkey) {
            cancelHotkeyCapture();
          } else if (editingShortcut) {
            setEditingShortcut(null);
            setPendingKeys([]);
          } else {
            onClose();
          }
        }
      };

      // bodyのスクロールを無効化（CSS制御併用）
      document.body.classList.add('modal-open');
      document.body.style.overflow = 'hidden';
      
      // 複数の方法でスクロールイベントを防止
      document.addEventListener('wheel', preventAllScroll, { passive: false, capture: true });
      document.addEventListener('touchmove', preventAllScroll, { passive: false, capture: true });
      document.addEventListener('keydown', handleEscKey);
      
      return () => {
        // クリーンアップ
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.removeEventListener('wheel', preventAllScroll, { capture: true });
        document.removeEventListener('touchmove', preventAllScroll, { capture: true });
        document.removeEventListener('keydown', handleEscKey);
      };
    }
  }, [isOpen, isCapturingHotkey, editingShortcut]);

  // ホットキーキャプチャ専用のイベントリスナー
  useEffect(() => {
    if (isCapturingHotkey) {
      const handleGlobalKeyDown = (e) => {
        handleHotkeyKeyDown(e);
      };

      document.addEventListener('keydown', handleGlobalKeyDown, true);
      
      return () => {
        document.removeEventListener('keydown', handleGlobalKeyDown, true);
      };
    }
  }, [isCapturingHotkey]);

  const handleSave = async () => {
    if (window.electronAPI) {
      const settings = {
        hotkey,
        startWithSystem,
  minimizeToTray,
  discordWebhookUrl,
  discordNotifyEnabled
      };
      
      await window.electronAPI.saveSettings(settings);
      
      // グローバルホットキー更新（未設定なら解除のみ）
      if (hotkey) {
        await window.electronAPI.registerGlobalShortcut(hotkey);
      } else {
        await window.electronAPI.unregisterGlobalShortcut();
      }
      
      // ショートカット設定を保存
      localStorage.setItem('scheduleAppShortcuts', JSON.stringify(shortcuts));
      
      onClose();
    }
  };

  // ショートカットキー入力の処理
  const handleKeyDown = (e) => {
    if (!editingShortcut) return;

    console.log('ショートカットキーダウン:', e.key, 'editing:', editingShortcut);
    
    e.preventDefault();
    
    // Backspace または Delete で削除
    if (e.key === 'Backspace' || e.key === 'Delete') {
      console.log('Backspace/Delete検出 - ショートカットをクリア');
      const newShortcuts = {
        ...shortcuts,
        [editingShortcut]: ''
      };
      setShortcuts(newShortcuts);
      setEditingShortcut(null);
      setPendingKeys([]);
      setShortcutErrors(prev => { if (!prev[editingShortcut]) return prev; const c={...prev}; delete c[editingShortcut]; return c; });
  // 即時保存（ユーザが保存ボタンを押さなくても空が保持されるように）
  localStorage.setItem('scheduleAppShortcuts', JSON.stringify(newShortcuts));
      // グローバルホットキーを復元
      if (window.electronAPI && hotkey) {
        window.electronAPI.registerGlobalShortcut(hotkey).then(() => {
          console.log('ショートカット削除完了: グローバルホットキーを復元');
        });
      }
      return;
    }

    // Escape でキャンセル
    if (e.key === 'Escape') {
      cancelEditing(); // cancelEditing内でグローバルホットキーを復元
      return;
    }
    
    const keys = [];
    if (e.ctrlKey) keys.push('Control');
    if (e.shiftKey) keys.push('Shift');
    if (e.altKey) keys.push('Alt');
    if (e.metaKey) keys.push('Meta');
    
    // 修飾キー以外のキーを追加
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
      keys.push(e.key.toUpperCase());
    }

    const modifierKeys = keys.filter(k => ['Control','Shift','Alt','Meta'].includes(k));
    const normalKeys = keys.filter(k => !['Control','Shift','Alt','Meta'].includes(k));
    const isFunctionKey = /^F([1-9]|1\d|2[0-4])$/.test(normalKeys[0] || '');

    // 確定条件: 修飾+通常 or 単独Fキー
    if ((modifierKeys.length > 0 && normalKeys.length > 0) || (modifierKeys.length === 0 && normalKeys.length === 1 && isFunctionKey)) {
      const shortcutString = keys.join('+');
      // 重複チェック
      const hasDuplicate = Object.entries(shortcuts).some(([k,v]) => k !== editingShortcut && v && v === shortcutString);
      if (hasDuplicate) {
        setShortcutErrors(prev => ({ ...prev, [editingShortcut]: '他と重複しています' }));
        return;
      }
      const newShortcuts = { ...shortcuts, [editingShortcut]: shortcutString };
      setShortcuts(newShortcuts);
      localStorage.setItem('scheduleAppShortcuts', JSON.stringify(newShortcuts));
      setEditingShortcut(null);
      setPendingKeys([]);
      setShortcutErrors(prev => { if (!prev[editingShortcut]) return prev; const c={...prev}; delete c[editingShortcut]; return c; });
      // グローバルホットキー復元
      if (window.electronAPI && hotkey) {
        window.electronAPI.registerGlobalShortcut(hotkey);
      }
    } else {
      setPendingKeys(keys);
    }
  };

  const handleKeyUp = async () => { /* onKeyDownで確定するため空実装 */ };

  // ショートカット編集開始
  const startEditingShortcut = async (shortcutKey) => {
    setEditingShortcut(shortcutKey);
    setPendingKeys([]);
    
    // グローバルホットキーを一時的に無効化
    if (window.electronAPI && hotkey) {
      await window.electronAPI.unregisterGlobalShortcut();
      console.log('ショートカット編集中: グローバルホットキーを一時無効化');
    }

    // 少し遅延して対象ボックスへフォーカス（クリック後でもフォーカスが当たらないケース対策）
    setTimeout(() => {
      const el = shortcutRefs.current[shortcutKey];
      if (el && document.activeElement !== el) {
        el.focus();
        // フォーカス取得できたかをデバッグ
        console.log('ショートカット編集用要素へフォーカス:', shortcutKey);
      }
    }, 30);
  };

  // 編集キャンセル
  const cancelEditing = async () => {
    setEditingShortcut(null);
    setPendingKeys([]);
    
    // グローバルホットキーを復元
    if (window.electronAPI && hotkey) {
      await window.electronAPI.registerGlobalShortcut(hotkey);
      console.log('ショートカット編集キャンセル: グローバルホットキーを復元');
    }
  };

  // デフォルトに戻す
  const resetShortcutsToDefaults = () => {
    const defaultShortcuts = {
      undo: 'Control+Z',
      redo: 'Control+Shift+Z',
    };
    setShortcuts(defaultShortcuts);
  };

  // 入力欄からのホットキー変更はホットキーキャプチャで扱うため関数は不要

  const startHotkeyCapture = async () => {
    // 現在のホットキーを保存（キャンセル時の復元用）
    setPreviousHotkey(hotkey);
    
    setIsCapturingHotkey(true);
    setPendingKeys([]);
    
    // グローバルホットキーを一時的に無効化
    if (window.electronAPI) {
      await window.electronAPI.unregisterGlobalShortcut();
      console.log('グローバルホットキーを一時無効化しました');
    }
    
    // フォーカスを設定（少し遅延させる）
    setTimeout(() => {
      // ref優先でフォーカス
      const target = hotkeyBoxRef.current || document.querySelector('[data-hotkey-capture="true"]');
      if (target) {
        target.focus();
        console.log('ホットキー入力エリアにフォーカスしました(ref)');
      } else {
        console.warn('ホットキー入力エリアを取得できませんでした');
      }
    }, 100);
  };

  const handleHotkeyKeyDown = (e) => {
    // キャプチャ中でなくても Backspace/Delete だけはクリアを許可
    if (!isCapturingHotkey && !(e.key === 'Backspace' || e.key === 'Delete')) return;

    console.log('ホットキーキーダウン:', e.key, e.ctrlKey, e.altKey, e.shiftKey, 'capturing:', isCapturingHotkey);

    // Backspace/Delete はいつでもクリア
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      e.stopPropagation();
      if (hotkey) {
        console.log('Backspace/Delete検出 - ホットキーをクリア');
      }
      setHotkey('');
      setIsCapturingHotkey(false);
      setPendingKeys([]);
      setPreviousHotkey('');
      if (window.electronAPI) {
        // 即時保存して永続化
        window.electronAPI.saveSettings({
          hotkey: '',
          startWithSystem,
          minimizeToTray,
          discordWebhookUrl,
          discordNotifyEnabled
        });
        window.electronAPI.unregisterGlobalShortcut().then(() => {
          console.log('グローバルホットキーを削除（未設定保存済み）');
        });
      }
      return;
    }

    // ここからはキャプチャ中のみ処理
    if (!isCapturingHotkey) return;

    e.preventDefault();
    e.stopPropagation();

    // Escape でキャンセル
    if (e.key === 'Escape') {
      cancelHotkeyCapture();
      return;
    }

    const keys = [];
    if (e.ctrlKey) keys.push('Control');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push('Meta');

    // 特殊キーではない場合、実際のキーを追加
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      keys.push(e.key.toUpperCase());
    }

    // 最低限修飾キー1つ+通常キー1つが必要
    const modifierKeys = keys.filter(k => ['Control', 'Alt', 'Shift', 'Meta'].includes(k));
    const normalKeys = keys.filter(k => !['Control', 'Alt', 'Shift', 'Meta'].includes(k));
    const isFunctionKey = /^F([1-9]|1\d|2[0-4])$/.test(normalKeys[0] || '');

    // 条件:
    // 1) 修飾 + 通常キー, または 2) Fキー単体
    if ((modifierKeys.length > 0 && normalKeys.length > 0) || (modifierKeys.length === 0 && normalKeys.length === 1 && isFunctionKey)) {
      const newHotkey = keys.join('+');
      setHotkey(newHotkey);
      setIsCapturingHotkey(false);
      setPendingKeys([]);
      setPreviousHotkey('');
      if (window.electronAPI) {
        window.electronAPI.registerGlobalShortcut(newHotkey).then(() => {
          console.log('新しいグローバルホットキーを登録しました:', newHotkey);
          // 永続化
          window.electronAPI.saveSettings({ hotkey: newHotkey, startWithSystem, minimizeToTray, discordWebhookUrl, discordNotifyEnabled });
        }).catch((error) => {
          console.error('グローバルホットキーの登録に失敗:', error);
        });
      }
    } else if (keys.length > 0) {
      setPendingKeys(keys);
    }
  };

  const cancelHotkeyCapture = async () => {
    setIsCapturingHotkey(false);
    setPendingKeys([]);
    
    // 元のグローバルホットキーを復元
    if (window.electronAPI && previousHotkey) {
      await window.electronAPI.registerGlobalShortcut(previousHotkey);
      console.log('元のグローバルホットキーを復復元しました:', previousHotkey);
    }
    
    // 前の状態をクリア
    setPreviousHotkey('');
  };

  const shortcutLabels = {
    undo: '元に戻す',
    redo: 'やり直し',
  };

  if (!isOpen) return null;

  // オーバーレイクリックでモーダルを閉じる
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // モーダル内でのホイールイベント処理
  const handleModalWheel = (e) => {
    // モーダル内のスクロールのみ許可、外部への伝播を停止
    e.stopPropagation();
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]"
      onClick={handleOverlayClick}
      onWheel={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div 
        className="settings-modal-content bg-white rounded-lg shadow-xl w-96 max-w-[90vw]"
        onWheel={handleModalWheel}
      >
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
        <div 
          className="p-4 space-y-6 bg-white max-h-96 overflow-y-auto custom-scrollbar"
          onWheel={(e) => {
            // 設定画面内のスクロールは正常に動作させる
            e.stopPropagation();
          }}
        >
          {/* ホットキー設定 */}
          <div className="p-4 bg-gradient-to-r from-gray-50 to-indigo-50 rounded-lg border border-indigo-100">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              グローバルホットキー
            </label>
            <div 
              className={`w-full px-4 py-3 border-2 rounded-lg font-medium text-center transition-all duration-200 cursor-pointer ${
                isCapturingHotkey 
                  ? 'border-indigo-400 bg-blue-50 text-gray-700 animate-pulse' 
                  : 'border-indigo-200 bg-white text-gray-900 hover:border-indigo-300 hover:bg-indigo-50'
              }`}
              onClick={!isCapturingHotkey ? startHotkeyCapture : undefined}
              onKeyDown={handleHotkeyKeyDown}
              tabIndex={0}
              data-hotkey-capture={isCapturingHotkey}
              style={{ outline: 'none' }}
              ref={hotkeyBoxRef}
            >
              {isCapturingHotkey ? (
                pendingKeys.length > 0 ? pendingKeys.join(' + ') + ' + ...' : 'キーを押してください...'
              ) : (
                hotkey ? hotkey : '未設定'
              )}
              {!isCapturingHotkey && hotkey && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    // クリアボタン
                    setHotkey('');
                    if (window.electronAPI) {
                      window.electronAPI.saveSettings({ hotkey: '', startWithSystem, minimizeToTray, discordWebhookUrl, discordNotifyEnabled });
                      window.electronAPI.unregisterGlobalShortcut();
                    }
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-red-500 px-1"
                >×</span>
              )}
            </div>
            <p className="text-xs text-indigo-600 mt-2 font-medium">
              クリックしてキーを設定、Backspace/Deleteで削除、Escでキャンセル
            </p>
          </div>

          {/* ショートカットキー設定 */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">アプリ内ショートカット</h3>
            
            <div className="space-y-3">
              {Object.entries(shortcuts).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between p-4 bg-gradient-to-r from-gray-50 to-indigo-50 rounded-lg border border-indigo-100 shadow-sm">
                  <span className="text-sm font-medium text-gray-700">{shortcutLabels[key]}</span>
                  <div className="flex items-center gap-2">
                    <div 
                      className={`px-4 py-2 text-sm rounded-lg border cursor-pointer min-w-[120px] text-center font-medium transition-all duration-200 ${
                        editingShortcut === key
                          ? 'bg-gradient-to-r from-blue-100 to-indigo-100 border-blue-300 text-blue-700 shadow-md'
                          : shortcutErrors[key]
                            ? 'bg-red-50 border-red-400 text-red-700 animate-pulse'
                            : 'bg-white border-indigo-200 text-gray-700 hover:bg-gradient-to-r hover:from-indigo-50 hover:to-purple-50 hover:border-indigo-300 shadow-sm hover:shadow-md'
                      }`}
                      onClick={() => editingShortcut === key ? cancelEditing() : startEditingShortcut(key)}
                      onKeyDown={handleKeyDown}
                      onKeyUp={handleKeyUp}
                      tabIndex={0}
                      ref={(el) => { shortcutRefs.current[key] = el; }}
                    >
                      {editingShortcut === key 
                        ? (pendingKeys.length > 0 ? pendingKeys.join('+') : 'キーを押してください...')
                        : (value ? value : '未設定')
                      }
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <p className="text-xs text-indigo-600 mt-3 font-medium">
              クリックしてキーを設定、Backspace/Deleteで削除、Escでキャンセル
            </p>
            {Object.keys(shortcutErrors).length > 0 && (
              <div className="mt-2 space-y-1">
                {Object.entries(shortcutErrors).map(([k,msg]) => (
                  <p key={k} className="text-xs text-red-600 font-medium">[{(shortcutLabels[k]||k)}] {msg}</p>
                ))}
              </div>
            )}

            <div className="mt-3">
              <button
                onClick={resetShortcutsToDefaults}
                className="px-4 py-2 text-sm text-indigo-600 hover:text-indigo-800 bg-gradient-to-r from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 border border-indigo-200 rounded-md transition-all duration-200 shadow-sm hover:shadow-md"
              >
                ショートカットをデフォルトに戻す
              </button>
            </div>
          </div>

          {/* システム起動時の設定 */}
          <div className="flex items-center p-3 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-100">
            <input
              type="checkbox"
              id="startWithSystem"
              checked={startWithSystem}
              onChange={(e) => setStartWithSystem(e.target.checked)}
              className="custom-checkbox"
            />
            <label htmlFor="startWithSystem" className="ml-3 text-sm font-medium text-gray-700 cursor-pointer">
              システム起動時に自動実行
            </label>
          </div>

          {/* タスクトレイ最小化設定 */}
          <div className="flex items-center p-3 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-100">
            <input
              type="checkbox"
              id="minimizeToTray"
              checked={minimizeToTray}
              onChange={(e) => setMinimizeToTray(e.target.checked)}
              className="custom-checkbox"
            />
            <label htmlFor="minimizeToTray" className="ml-3 text-sm font-medium text-gray-700 cursor-pointer">
              閉じるボタンでタスクトレイに最小化
            </label>
          </div>

          {/* Discord 通知設定 */}
          <div className="p-4 bg-gradient-to-r from-gray-50 to-purple-50 rounded-lg border border-purple-200 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Discord 通知</label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="discordNotifyEnabled"
                  checked={discordNotifyEnabled}
                  onChange={(e) => setDiscordNotifyEnabled(e.target.checked)}
                  className="custom-checkbox"
                />
                <label htmlFor="discordNotifyEnabled" className="text-xs text-gray-600 cursor-pointer">有効</label>
              </div>
            </div>
            <input
              type="text"
              placeholder="Discord Webhook URL"
              value={discordWebhookUrl}
              onChange={(e) => setDiscordWebhookUrl(e.target.value.trim())}
              className="w-full px-3 py-2 border border-purple-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white text-gray-800 placeholder-gray-400 shadow-sm"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  setDiscordTestStatus(null);
                  if (!window.electronAPI) return;
                  // 一時保存（URL/有効フラグ）
                  await window.electronAPI.saveSettings({ hotkey, startWithSystem, minimizeToTray, discordWebhookUrl, discordNotifyEnabled });
                  const res = await window.electronAPI.discordTest();
                  setDiscordTestStatus(res.success ? 'ok' : 'ng');
                  setTimeout(() => setDiscordTestStatus(null), 4000);
                }}
                disabled={!discordNotifyEnabled || !discordWebhookUrl}
                className={`px-3 py-1.5 text-xs rounded-md border transition ${(!discordNotifyEnabled || !discordWebhookUrl) ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white text-purple-600 border-purple-300 hover:bg-purple-50 hover:border-purple-400'}`}
              >テスト送信</button>
              {discordTestStatus === 'ok' && <span className="text-xs text-green-600 font-medium">OK</span>}
              {discordTestStatus === 'ng' && <span className="text-xs text-red-600 font-medium">失敗</span>}
            </div>
            <p className="text-xs text-purple-600 leading-relaxed">
              有効化するとスケジュール通知時に同じ内容を Discord Webhook へ送信します。
            </p>
          </div>
        </div>

        {/* フッター */}
        <div className="flex items-center justify-end space-x-3 p-4 border-t border-indigo-100 bg-gradient-to-r from-gray-50 to-indigo-50">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 bg-white hover:bg-gray-50 border border-gray-300 hover:border-gray-400 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-sm font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
