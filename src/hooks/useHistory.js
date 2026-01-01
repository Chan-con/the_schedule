import { useState, useEffect, useCallback, useRef } from 'react';

const isHistoryDebugEnabled =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEBUG_HISTORY === 'true';

const historyDebugLog = (...args) => {
  if (!isHistoryDebugEnabled) return;
  console.debug(...args);
};

/**
 * Undo/Redo機能を提供するカスタムフック
 * @param {any} initialState - 初期状態
 * @param {number} maxHistorySize - 履歴の最大サイズ（デフォルト100）
 * @returns {object} - { state, setState, undo, redo, canUndo, canRedo, clearHistory }
 */
export const useHistory = (initialState, maxHistorySize = 100) => {
  const clampMaxSize = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 1;
    return Math.floor(numeric);
  };

  const maxSize = clampMaxSize(maxHistorySize);

  // 現在の状態
  const [state, setInternalState] = useState(initialState);

  // 履歴スタック（全履歴）
  const [history, setHistory] = useState([initialState]);

  // 現在の履歴インデックス
  const [currentIndex, setCurrentIndex] = useState(0);

  // 操作タイプの追跡（デバッグ用）
  const [lastActionType, setLastActionType] = useState(null);

  // 履歴追加を一時的に無効化するフラグ
  const skipHistoryRef = useRef(false);

  // state/index/history の最新値を参照するためのref
  const historyRef = useRef(history);
  const indexRef = useRef(currentIndex);
  const stateRef = useRef(state);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    indexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setState = useCallback((newState, actionType = 'unknown') => {
    if (skipHistoryRef.current) {
      setInternalState(newState);
      return;
    }

    setHistory((prevHistory) => {
      const baseIndex = indexRef.current;
      const trimmed = Array.isArray(prevHistory)
        ? prevHistory.slice(0, Math.max(0, baseIndex) + 1)
        : [];
      trimmed.push(newState);

      let nextHistory = trimmed;
      let nextIndex = nextHistory.length - 1;

      if (nextHistory.length > maxSize) {
        const overflow = nextHistory.length - maxSize;
        nextHistory = nextHistory.slice(overflow);
        nextIndex = Math.max(0, nextIndex - overflow);
      }

      // index の更新は history 更新と同期させる
      setCurrentIndex(nextIndex);
      return nextHistory;
    });

    setInternalState(newState);
    setLastActionType(actionType);

    historyDebugLog('📚 History: Added new state', {
      actionType,
      nextIndex: indexRef.current + 1,
    });
  }, [maxSize]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    const idx = indexRef.current;
    if (!Array.isArray(h) || h.length === 0) return;
    if (idx <= 0) return;

    const newIndex = idx - 1;
    const previousState = h[newIndex];

    setCurrentIndex(newIndex);
    skipHistoryRef.current = true;
    setInternalState(previousState);
    skipHistoryRef.current = false;
    setLastActionType('undo');

    historyDebugLog('↩️ Undo: Restored state', {
      fromIndex: idx,
      toIndex: newIndex,
    });
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const idx = indexRef.current;
    if (!Array.isArray(h) || h.length === 0) return;
    if (idx >= h.length - 1) return;

    const newIndex = idx + 1;
    const nextState = h[newIndex];

    setCurrentIndex(newIndex);
    skipHistoryRef.current = true;
    setInternalState(nextState);
    skipHistoryRef.current = false;
    setLastActionType('redo');

    historyDebugLog('↪️ Redo: Restored state', {
      fromIndex: idx,
      toIndex: newIndex,
    });
  }, []);

  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  const clearHistory = useCallback(() => {
    const current = stateRef.current;
    setHistory([current]);
    setCurrentIndex(0);
    setLastActionType('clear');
    historyDebugLog('🗑️ History: Cleared all history');
  }, []);

  const replaceState = useCallback((newState, actionType = 'replace') => {
    skipHistoryRef.current = true;
    setInternalState(newState);
    skipHistoryRef.current = false;

    setHistory([newState]);
    setCurrentIndex(0);
    setLastActionType(actionType);

    historyDebugLog('🔄 History: State replaced', {
      actionType,
      historyLength: 1,
      currentIndex: 0,
    });
  }, []);

  const overwriteState = useCallback((newState, actionType = 'overwrite') => {
    skipHistoryRef.current = true;
    setInternalState(newState);
    skipHistoryRef.current = false;

    setHistory((prevHistory) => {
      const list = Array.isArray(prevHistory) && prevHistory.length > 0 ? [...prevHistory] : [newState];
      const idx = Math.max(0, Math.min(indexRef.current, list.length - 1));
      list[idx] = newState;
      return list;
    });

    setLastActionType(actionType);

    historyDebugLog('📝 History: Overwrote current state', {
      actionType,
      currentIndex: indexRef.current,
      historyLength: historyRef.current?.length,
    });
  }, []);
  
  // キーボードショートカットの処理
  useEffect(() => {
    const handleKeyDown = (e) => {
      // フォーム内やテキスト入力中は無効化
      const isInInput = e.target.tagName === 'INPUT' || 
                       e.target.tagName === 'TEXTAREA' || 
                       e.target.contentEditable === 'true';
      
      if (isInInput) return;

      // 設定からショートカットを読み込み
      const savedShortcuts = localStorage.getItem('scheduleAppShortcuts');
      const shortcuts = savedShortcuts ? JSON.parse(savedShortcuts) : {
        undo: 'Control+Z',
        redo: 'Control+Shift+Z'
      };

      // Undoショートカットの処理（未設定ならスキップ）
      if (shortcuts.undo) {
        const undoKeys = shortcuts.undo.split('+').filter(k => k);
        const isUndoShortcut = undoKeys.length > 0 && undoKeys.every(key => {
          switch(key) {
            case 'Control': return e.ctrlKey;
            case 'Shift': return e.shiftKey;
            case 'Alt': return e.altKey;
            case 'Meta': return e.metaKey;
            default: return e.key.toUpperCase() === key;
          }
        }) && undoKeys.length === (
          (e.ctrlKey ? 1 : 0) + 
          (e.shiftKey ? 1 : 0) + 
          (e.altKey ? 1 : 0) + 
          (e.metaKey ? 1 : 0) + 1
        );
        if (isUndoShortcut) {
          e.preventDefault();
          if (canUndo) undo();
          return;
        }
      }

      // Redoショートカットの処理（未設定ならスキップ）
      if (shortcuts.redo) {
        const redoKeys = shortcuts.redo.split('+').filter(k => k);
        const isRedoShortcut = redoKeys.length > 0 && redoKeys.every(key => {
          switch(key) {
            case 'Control': return e.ctrlKey;
            case 'Shift': return e.shiftKey;
            case 'Alt': return e.altKey;
            case 'Meta': return e.metaKey;
            default: return e.key.toUpperCase() === key;
          }
        }) && redoKeys.length === (
          (e.ctrlKey ? 1 : 0) + 
          (e.shiftKey ? 1 : 0) + 
          (e.altKey ? 1 : 0) + 
          (e.metaKey ? 1 : 0) + 1
        );
        if (isRedoShortcut) {
          e.preventDefault();
          if (canRedo) redo();
          return;
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, undo, redo]);
  
  // デバッグ情報の出力
  useEffect(() => {
    historyDebugLog('📊 History Status:', {
      currentIndex,
      historyLength: history.length,
      canUndo,
      canRedo,
      lastActionType,
      maxHistorySize
    });
  }, [currentIndex, history.length, canUndo, canRedo, lastActionType, maxHistorySize]);
  
  return {
    state,
    setState,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    replaceState,
    overwriteState,
    historyLength: history.length,
    currentIndex,
    lastActionType
  };
};

export default useHistory;
