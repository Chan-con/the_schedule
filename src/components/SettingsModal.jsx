import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/useAuth';
import {
  getExistingPushSubscription,
  isPushSupported,
  subscribePush,
  unsubscribePush,
} from '../utils/push';
import {
  deactivatePushSubscriptionForUser,
  upsertPushSubscriptionForUser,
} from '../utils/supabasePushSubscriptions';
import {
  fetchQuestReminderSettingsForUser,
  upsertQuestReminderSettingsForUser,
} from '../utils/supabaseQuestReminderSettings';

const timeMinutesToHHMM = (minutes) => {
  const m = Number(minutes);
  if (!Number.isFinite(m)) return '21:00';
  const clamped = Math.max(0, Math.min(1439, Math.floor(m)));
  const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mm = String(clamped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
};

const hhmmToTimeMinutes = (hhmm) => {
  const raw = String(hhmm || '').trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  return hh * 60 + mm;
};

const SettingsModal = ({ isOpen, onClose }) => {
  const auth = useAuth();
  const userId = auth?.user?.id || null;
  const [voltModifierKey, setVoltModifierKey] = useState('ctrlOrCmd'); // 'ctrlOrCmd' | 'alt'
  const [shortcuts, setShortcuts] = useState({
    undo: 'Control+Z',
    redo: 'Control+Shift+Z',
  });
  const [editingShortcut, setEditingShortcut] = useState(null);
  const [pendingKeys, setPendingKeys] = useState([]);
  // 各ショートカット用のref（フォーカスが当たらないとBackspace/Deleteが発火しない問題対策）
  const shortcutRefs = useRef({});
  // 重複などのエラー保持
  const [shortcutErrors, setShortcutErrors] = useState({});

  const [pushStatus, setPushStatus] = useState({
    supported: false,
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
    subscribed: false,
    isBusy: false,
    error: null,
  });

  const [questReminderStatus, setQuestReminderStatus] = useState({
    loaded: false,
    enabled: false,
    timeHHMM: '21:00',
    isBusy: false,
    error: null,
  });

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const refreshPushState = async () => {
      const supported = isPushSupported();
      const permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';
      if (!supported) {
        if (!cancelled) {
          setPushStatus((prev) => ({
            ...prev,
            supported,
            permission,
            subscribed: false,
          }));
        }
        return;
      }

      try {
        const sub = await getExistingPushSubscription();
        if (cancelled) return;
        setPushStatus((prev) => ({
          ...prev,
          supported,
          permission,
          subscribed: !!sub,
        }));
      } catch {
        if (cancelled) return;
        setPushStatus((prev) => ({
          ...prev,
          supported,
          permission,
          subscribed: false,
        }));
      }
    };

    refreshPushState();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const refreshQuestReminderSettings = async () => {
      if (!userId) {
        if (!cancelled) {
          setQuestReminderStatus((prev) => ({ ...prev, loaded: true, error: null }));
        }
        return;
      }

      try {
        const row = await fetchQuestReminderSettingsForUser({ userId });
        if (cancelled) return;
        setQuestReminderStatus((prev) => ({
          ...prev,
          loaded: true,
          enabled: !!row?.enabled,
          timeHHMM: timeMinutesToHHMM(row?.reminder_time_minutes ?? 21 * 60),
          error: null,
        }));
      } catch (error) {
        if (cancelled) return;
        setQuestReminderStatus((prev) => ({
          ...prev,
          loaded: true,
          error: error?.message || 'クエスト通知設定の取得に失敗しました。',
        }));
      }
    };

    refreshQuestReminderSettings();
    return () => {
      cancelled = true;
    };
  }, [isOpen, userId]);

  useEffect(() => {
    // ショートカット設定の読み込み
    const savedShortcuts = localStorage.getItem('scheduleAppShortcuts');
    if (savedShortcuts) {
      setShortcuts(JSON.parse(savedShortcuts));
    }

    // Voltモードの修飾キー設定の読み込み
    try {
      const storedVoltModifier = localStorage.getItem('voltModifierKey');
      if (storedVoltModifier === 'alt' || storedVoltModifier === 'ctrlOrCmd') {
        setVoltModifierKey(storedVoltModifier);
      }
    } catch {
      // ignore
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
          if (editingShortcut) {
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
  }, [isOpen, editingShortcut, onClose]);

  const handleSave = async () => {
    localStorage.setItem('scheduleAppShortcuts', JSON.stringify(shortcuts));
    try {
      localStorage.setItem('voltModifierKey', voltModifierKey);
      window.dispatchEvent(
        new CustomEvent('voltModifierKeyChanged', { detail: { value: voltModifierKey } })
      );
    } catch {
      // ignore
    }
    onClose();
  };

  const handleEnablePush = async () => {
    if (pushStatus.isBusy) return;
    setPushStatus((prev) => ({ ...prev, isBusy: true, error: null }));
    try {
      if (!userId) {
        throw new Error('Push通知を有効化するにはログインが必要です。');
      }

      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      const sub = await subscribePush({ vapidPublicKey });

      const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
      await upsertPushSubscriptionForUser({
        userId,
        subscription: sub?.toJSON ? sub.toJSON() : sub,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        timezoneOffsetMinutes,
      });

      setPushStatus((prev) => ({
        ...prev,
        permission: typeof Notification !== 'undefined' ? Notification.permission : prev.permission,
        subscribed: true,
      }));
    } catch (error) {
      setPushStatus((prev) => ({
        ...prev,
        error: error?.message || 'Push通知の有効化に失敗しました。',
      }));
    } finally {
      setPushStatus((prev) => ({ ...prev, isBusy: false }));
    }
  };

  const handleDisablePush = async () => {
    if (pushStatus.isBusy) return;
    setPushStatus((prev) => ({ ...prev, isBusy: true, error: null }));
    try {
      const existing = await getExistingPushSubscription();
      const endpoint = existing?.endpoint || null;

      if (userId && endpoint) {
        await deactivatePushSubscriptionForUser({ userId, endpoint });
      }

      await unsubscribePush();
      setPushStatus((prev) => ({
        ...prev,
        permission: typeof Notification !== 'undefined' ? Notification.permission : prev.permission,
        subscribed: false,
      }));
    } catch (error) {
      setPushStatus((prev) => ({
        ...prev,
        error: error?.message || 'Push通知の無効化に失敗しました。',
      }));
    } finally {
      setPushStatus((prev) => ({ ...prev, isBusy: false }));
    }
  };

  const handleSaveQuestReminder = async () => {
    if (questReminderStatus.isBusy) return;
    setQuestReminderStatus((prev) => ({ ...prev, isBusy: true, error: null }));
    try {
      if (!userId) {
        throw new Error('クエスト通知を保存するにはログインが必要です。');
      }
      if (!pushStatus.subscribed) {
        throw new Error('クエスト通知はPush通知が有効な場合のみ届きます。先にPush通知を有効化してください。');
      }

      const timeMinutes = hhmmToTimeMinutes(questReminderStatus.timeHHMM);
      if (timeMinutes == null) {
        throw new Error('通知時刻は HH:MM 形式で入力してください。');
      }

      const saved = await upsertQuestReminderSettingsForUser({
        userId,
        enabled: questReminderStatus.enabled,
        reminderTimeMinutes: timeMinutes,
      });

      setQuestReminderStatus((prev) => ({
        ...prev,
        enabled: !!saved?.enabled,
        timeHHMM: timeMinutesToHHMM(saved?.reminder_time_minutes ?? timeMinutes),
      }));
    } catch (error) {
      setQuestReminderStatus((prev) => ({
        ...prev,
        error: error?.message || 'クエスト通知設定の保存に失敗しました。',
      }));
    } finally {
      setQuestReminderStatus((prev) => ({ ...prev, isBusy: false }));
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
    } else {
      setPendingKeys(keys);
    }
  };

  const handleKeyUp = async () => { /* onKeyDownで確定するため空実装 */ };

  // ショートカット編集開始
  const startEditingShortcut = async (shortcutKey) => {
    setEditingShortcut(shortcutKey);
    setPendingKeys([]);

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
  };

  // デフォルトに戻す
  const resetShortcutsToDefaults = () => {
    const defaultShortcuts = {
      undo: 'Control+Z',
      redo: 'Control+Shift+Z',
    };
    setShortcuts(defaultShortcuts);
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
        style={{ colorScheme: 'light' }}
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
          {/* Push通知 */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Push通知（通知はこれのみ）</h3>

            {!pushStatus.supported ? (
              <p className="text-xs text-gray-600">
                この端末/ブラウザはPush通知に対応していません。
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-600">
                  状態: {pushStatus.subscribed ? '有効' : '無効'} / 権限: {String(pushStatus.permission)}
                </p>

                <p className="text-xs text-gray-600">
                  予定/タスク/ループの通知は workers からのPush通知で配信されます。Pushが無効だと通知は届きません。
                </p>

                {pushStatus.error && (
                  <p className="text-xs text-red-600 font-medium">{pushStatus.error}</p>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleEnablePush}
                    disabled={pushStatus.isBusy || pushStatus.subscribed}
                    className={`px-4 py-2 text-sm font-medium rounded-md border transition-all duration-200 ${
                      pushStatus.isBusy || pushStatus.subscribed
                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                        : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                    }`}
                  >
                    有効化
                  </button>
                  <button
                    type="button"
                    onClick={handleDisablePush}
                    disabled={pushStatus.isBusy || !pushStatus.subscribed}
                    className={`px-4 py-2 text-sm font-medium rounded-md border transition-all duration-200 ${
                      pushStatus.isBusy || !pushStatus.subscribed
                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    無効化
                  </button>
                </div>

                <p className="text-xs text-gray-600">
                  iOS Safari は「ホーム画面に追加」したアプリから有効化してください。
                </p>
              </div>
            )}
          </div>

          {/* クエストリマインド */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">クエストリマインド（デイリー）</h3>

            {!userId ? (
              <p className="text-xs text-gray-600">ログインすると設定できます。</p>
            ) : !pushStatus.supported ? (
              <p className="text-xs text-gray-600">この端末/ブラウザはPush通知に対応していません。</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-600">
                  今日のデイリークエストが未完了のとき、指定時刻に「クエスト忘れてませんか？」を通知します。
                </p>

                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-indigo-600"
                    checked={questReminderStatus.enabled}
                    onChange={(e) =>
                      setQuestReminderStatus((prev) => ({
                        ...prev,
                        enabled: !!e.target.checked,
                      }))
                    }
                    disabled={!questReminderStatus.loaded}
                  />
                  有効化
                </label>

                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-700">通知時刻</label>
                  <input
                    type="time"
                    value={questReminderStatus.timeHHMM}
                    onChange={(e) =>
                      setQuestReminderStatus((prev) => ({
                        ...prev,
                        timeHHMM: e.target.value,
                      }))
                    }
                    className="px-2 py-1 text-sm border border-gray-200 rounded-md"
                    disabled={!questReminderStatus.loaded}
                  />

                  <button
                    type="button"
                    onClick={handleSaveQuestReminder}
                    disabled={questReminderStatus.isBusy || !questReminderStatus.loaded}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-all duration-200 ${
                      questReminderStatus.isBusy || !questReminderStatus.loaded
                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                        : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                    }`}
                  >
                    保存
                  </button>
                </div>

                {!pushStatus.subscribed && (
                  <p className="text-xs text-gray-600">※ クエスト通知を受けるには、上のPush通知を有効化してください。</p>
                )}

                {questReminderStatus.error && (
                  <p className="text-xs text-red-600 font-medium">{questReminderStatus.error}</p>
                )}
              </div>
            )}
          </div>

          {/* Voltモード */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Voltモード（複数選択/一括移動）</h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="voltModifierKey"
                  value="ctrlOrCmd"
                  className="accent-indigo-600"
                  checked={voltModifierKey === 'ctrlOrCmd'}
                  onChange={() => setVoltModifierKey('ctrlOrCmd')}
                />
                Ctrl / Cmd
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="voltModifierKey"
                  value="alt"
                  className="accent-indigo-600"
                  checked={voltModifierKey === 'alt'}
                  onChange={() => setVoltModifierKey('alt')}
                />
                Alt
              </label>
              <p className="text-xs text-gray-600">
                ブラウザのAlt系ショートカットと競合する場合は、Ctrl/Cmd を推奨します。
              </p>
            </div>
          </div>

          {/* ホットキー設定 */}
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
