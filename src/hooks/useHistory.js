import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Undo/Redo機能を提供するカスタムフック
 * @param {any} initialState - 初期状態
 * @param {number} maxHistorySize - 履歴の最大サイズ（デフォルト100）
 * @returns {object} - { state, setState, undo, redo, canUndo, canRedo, clearHistory }
 */
export const useHistory = (initialState, maxHistorySize = 100) => {
  // 現在の状態
  const [state, setInternalState] = useState(initialState);
  
  // 履歴スタック（過去の状態）
  const [history, setHistory] = useState([initialState]);
  
  // 現在の履歴インデックス
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // 操作タイプの追跡（デバッグ用）
  const [lastActionType, setLastActionType] = useState(null);
  
  // 履歴追加を一時的に無効化するフラグ
  const skipHistoryRef = useRef(false);
  
  // 状態を設定する関数（履歴に追加）
  const setState = useCallback((newState, actionType = 'unknown') => {
    // 履歴追加をスキップする場合
    if (skipHistoryRef.current) {
      setInternalState(newState);
      return;
    }
    
    setHistory(prevHistory => {
      setCurrentIndex(prevIndex => {
        // 現在のインデックス以降の履歴を削除（新しい操作により分岐を防ぐ）
        const newHistory = prevHistory.slice(0, prevIndex + 1);
        
        // 新しい状態を履歴に追加
        newHistory.push(newState);
        
        // 履歴サイズを制限
        if (newHistory.length > maxHistorySize) {
          newHistory.shift(); // 最も古い履歴を削除
          return prevIndex; // インデックスは変更しない（最古が削除されたため）
        }
        
        return newHistory.length - 1; // 新しいインデックス
      });
      
      // 履歴を更新
      const newHistory = prevHistory.slice(0, currentIndex + 1);
      newHistory.push(newState);
      
      if (newHistory.length > maxHistorySize) {
        return newHistory.slice(1); // 最古を削除
      }
      
      return newHistory;
    });
    
    setInternalState(newState);
    setLastActionType(actionType);
    
    console.log('📚 History: Added new state', {
      actionType,
      currentIndex: currentIndex + 1,
      historyLength: history.length + 1
    });
  }, [currentIndex, history.length, maxHistorySize]);
  
  // Undo操作
  const undo = useCallback(() => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      const previousState = history[newIndex];
      
      setCurrentIndex(newIndex);
      
      // 履歴追加をスキップして状態を更新
      skipHistoryRef.current = true;
      setInternalState(previousState);
      skipHistoryRef.current = false;
      
      setLastActionType('undo');
      
      console.log('↩️ Undo: Restored state', {
        fromIndex: currentIndex,
        toIndex: newIndex,
        restoredState: previousState
      });
    }
  }, [currentIndex, history]);
  
  // Redo操作
  const redo = useCallback(() => {
    if (currentIndex < history.length - 1) {
      const newIndex = currentIndex + 1;
      const nextState = history[newIndex];
      
      setCurrentIndex(newIndex);
      
      // 履歴追加をスキップして状態を更新
      skipHistoryRef.current = true;
      setInternalState(nextState);
      skipHistoryRef.current = false;
      
      setLastActionType('redo');
      
      console.log('↪️ Redo: Restored state', {
        fromIndex: currentIndex,
        toIndex: newIndex,
        restoredState: nextState
      });
    }
  }, [currentIndex, history]);
  
  // Undo可能かどうか
  const canUndo = currentIndex > 0;
  
  // Redo可能かどうか
  const canRedo = currentIndex < history.length - 1;
  
  // 履歴をクリア
  const clearHistory = useCallback(() => {
    setHistory([state]);
    setCurrentIndex(0);
    setLastActionType('clear');
    console.log('🗑️ History: Cleared all history');
  }, [state]);
  
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
    console.log('📊 History Status:', {
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
    historyLength: history.length,
    currentIndex,
    lastActionType
  };
};

export default useHistory;
