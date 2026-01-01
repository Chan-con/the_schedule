import { useState, useEffect, useCallback, useRef, useReducer, useMemo } from 'react';

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

  const initial = useMemo(
    () => ({ history: [initialState], index: 0, lastActionType: null }),
    // initialState は初回のみ評価したい
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const reducer = (prev, action) => {
    const currentHistory = Array.isArray(prev?.history) && prev.history.length > 0 ? prev.history : [initialState];
    const currentIndex = Math.max(0, Math.min(Number(prev?.index) || 0, currentHistory.length - 1));

    switch (action?.type) {
      case 'push': {
        const nextState = action.state;
        const actionType = action.actionType || 'unknown';
        const trimmed = currentHistory.slice(0, currentIndex + 1);
        trimmed.push(nextState);

        let nextHistory = trimmed;
        let nextIndex = nextHistory.length - 1;

        if (nextHistory.length > maxSize) {
          const overflow = nextHistory.length - maxSize;
          nextHistory = nextHistory.slice(overflow);
          nextIndex = Math.max(0, nextIndex - overflow);
        }

        return { history: nextHistory, index: nextIndex, lastActionType: actionType };
      }
      case 'undo': {
        if (currentIndex <= 0) return { ...prev, lastActionType: 'undo' };
        return { history: currentHistory, index: currentIndex - 1, lastActionType: 'undo' };
      }
      case 'redo': {
        if (currentIndex >= currentHistory.length - 1) return { ...prev, lastActionType: 'redo' };
        return { history: currentHistory, index: currentIndex + 1, lastActionType: 'redo' };
      }
      case 'clear': {
        const current = currentHistory[currentIndex];
        return { history: [current], index: 0, lastActionType: 'clear' };
      }
      case 'replace': {
        const nextState = action.state;
        return { history: [nextState], index: 0, lastActionType: action.actionType || 'replace' };
      }
      case 'overwrite': {
        const nextState = action.state;
        const actionType = action.actionType || 'overwrite';
        const nextHistory = [...currentHistory];
        nextHistory[currentIndex] = nextState;
        return { history: nextHistory, index: currentIndex, lastActionType: actionType };
      }
      default:
        return prev;
    }
  };

  const [historyState, dispatch] = useReducer(reducer, initial);
  const history = Array.isArray(historyState?.history) && historyState.history.length > 0 ? historyState.history : [initialState];
  const currentIndex = Math.max(0, Math.min(Number(historyState?.index) || 0, history.length - 1));
  const state = history[currentIndex];
  const lastActionType = historyState?.lastActionType ?? null;

  // 既存コードのために ref は維持（外部から参照される可能性を避ける）
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setState = useCallback((newState, actionType = 'unknown') => {
    dispatch({ type: 'push', state: newState, actionType });
    historyDebugLog('📚 History: Added new state', { actionType });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'undo' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'redo' });
  }, []);

  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  const clearHistory = useCallback(() => {
    dispatch({ type: 'clear' });
    historyDebugLog('🗑️ History: Cleared all history');
  }, []);

  const replaceState = useCallback((newState, actionType = 'replace') => {
    dispatch({ type: 'replace', state: newState, actionType });
    historyDebugLog('🔄 History: State replaced', { actionType });
  }, []);

  const overwriteState = useCallback((newState, actionType = 'overwrite') => {
    dispatch({ type: 'overwrite', state: newState, actionType });
    historyDebugLog('📝 History: Overwrote current state', { actionType });
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
