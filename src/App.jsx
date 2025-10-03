
import React, { useState, useEffect } from 'react';
import { toDateStrLocal } from './utils/date';

import Calendar from './components/Calendar';
import Timeline from './components/Timeline';
import CurrentDateTimeBar from './components/CurrentDateTimeBar';
import ScheduleForm from './components/ScheduleForm';
import TitleBar from './components/TitleBar';
import SettingsModal from './components/SettingsModal';
import { useNotifications } from './hooks/useNotifications';
import { useHistory } from './hooks/useHistory';

// サンプルデータ - 今日の日付に合わせて調整
const getTodayDateStr = () => toDateStrLocal(new Date());

const initialSchedules = [
  { id: 1, date: getTodayDateStr(), time: '09:00', name: '打ち合わせ', memo: 'ZoomリンクはSlack参照', allDay: false, isTask: false, completed: false },
  { id: 2, date: getTodayDateStr(), time: '', name: '終日イベント', memo: '終日エリアに表示', allDay: true, allDayOrder: 0, isTask: false, completed: false },
];

function App() {
  // ローカルストレージから予定を読み込む
  const savedSchedules = localStorage.getItem('schedules');
  const loadedSchedules = (savedSchedules ? JSON.parse(savedSchedules) : initialSchedules).map(s => ({
    ...s,
    // 既存データにプロパティがなければ既定値
    isTask: s.isTask ?? false,
    completed: s.completed ?? false,
  }));
  
  // 履歴管理機能付きの予定状態
  const {
    state: schedules,
    setState: setSchedules,
    undo,
    redo,
    canUndo,
    canRedo,
    historyLength,
    currentIndex,
    lastActionType
  } = useHistory(loadedSchedules, 100);
  
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // 分割比率の状態管理（デフォルト50%）
  const [splitRatio, setSplitRatio] = useState(50);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // モバイル表示の状態管理
  const [isMobile, setIsMobile] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [mouseStart, setMouseStart] = useState(null);
  const [mouseEnd, setMouseEnd] = useState(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  
  // ハンバーガーメニューの開閉状態
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  // 通知システム
  const { cancelScheduleNotifications, sendTestNotification } = useNotifications(schedules);
  
  // メニュー外クリックでメニューを閉じる
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMenuOpen && !event.target.closest('[data-menu-container]')) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);
  
  // 画面サイズの監視
  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 768; // 768px未満をモバイルとする
      setIsMobile(mobile);
      if (!mobile) {
        setIsTimelineOpen(false); // デスクトップ表示時はタイムラインを閉じる
      }
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // 予定が変更されたらローカルストレージに保存
  useEffect(() => {
    localStorage.setItem('schedules', JSON.stringify(schedules));
    console.log('💾 Schedules saved to localStorage:', {
      count: schedules.length,
      historyIndex: currentIndex,
      historyLength: historyLength,
      lastAction: lastActionType
    });
  }, [schedules, currentIndex, historyLength, lastActionType]);
  
  // 起動時に設定からレイアウト読み込み
  useEffect(() => {
    (async () => {
      let loaded = false;
      if (window.electronAPI) {
        try {
          const s = await window.electronAPI.getSettings();
          if (typeof s.splitRatio === 'number') {
            setSplitRatio(s.splitRatio);
            loaded = true;
            console.log('[layout] splitRatio loaded from settings:', s.splitRatio);
          }
        } catch (e) {
          console.warn('[layout] failed to load splitRatio from settings', e);
        }
      }
      if (!loaded) {
        const savedRatio = localStorage.getItem('splitRatio');
        if (savedRatio) {
          const v = parseFloat(savedRatio);
          if (!isNaN(v)) {
            setSplitRatio(v);
            console.log('[layout] splitRatio loaded from localStorage:', v);
          }
        }
      }
      setLayoutLoaded(true);
    })();
  }, []);

  // 分割比率変更時に保存（ロード完了後）
  useEffect(() => {
    if (!layoutLoaded) return; // 初期ロード完了までは保存しない
    if (window.electronAPI) {
      window.electronAPI.saveLayout({ splitRatio });
    } else {
      localStorage.setItem('splitRatio', String(splitRatio));
    }
  }, [splitRatio, layoutLoaded]);
  
  // マウス移動ハンドラー
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const newRatio = ((e.clientX - rect.left) / rect.width) * 100;
    
    // 20%〜80%の範囲に制限
    if (newRatio >= 20 && newRatio <= 80) {
      setSplitRatio(newRatio);
    }
  };
  
  // マウスアップハンドラー
  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  // マウスダウンハンドラー
  const handleMouseDown = () => {
    setIsDragging(true);
  };
  
  // タイムライン開閉ハンドラー
  const closeTimeline = () => {
    setIsTimelineOpen(false);
  };

  // スワイプジェスチャーのハンドラー
  const handleTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    
    const distance = touchStart - touchEnd;
    const isRightSwipe = distance < -50;
    
    // 左から右へのスワイプでタイムラインを閉じる
    if (isRightSwipe) {
      closeTimeline();
    }
  };

  // マウスドラッグのハンドラー（PC用）
  const handleMouseDownOnTimeline = (e) => {
    setIsMouseDown(true);
    setMouseEnd(null);
    setMouseStart(e.clientX);
  };

  const handleMouseMoveOnTimeline = (e) => {
    if (!isMouseDown) return;
    setMouseEnd(e.clientX);
  };

  const handleMouseUpOnTimeline = () => {
    if (!isMouseDown || !mouseStart || !mouseEnd) {
      setIsMouseDown(false);
      return;
    }
    
    const distance = mouseStart - mouseEnd;
    const isRightDrag = distance < -50;
    
    // 左から右へのドラッグでタイムラインを閉じる
    if (isRightDrag) {
      closeTimeline();
    }
    
    setIsMouseDown(false);
  };  // グローバルマウスイベントの設定
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging]);

  // 日付クリック時の処理
  const handleDateClick = (date) => {
    setSelectedDate(date);
    
    // モバイル時は日付クリックでタイムラインを開く
    if (isMobile) {
      setIsTimelineOpen(true);
    }
  };  // 予定編集ハンドラー
  const handleEdit = (schedule) => {
    console.log('🔧 handleEdit called with:', schedule);
    console.log('🔧 Current showForm state:', showForm);
    console.log('🔧 Current editingSchedule state:', editingSchedule);
    setEditingSchedule(schedule);
    setShowForm(true);
    console.log('🔧 Edit form should now be visible');
  };

  // 予定コピー/移動ハンドラー
  const handleScheduleCopy = (schedule) => {
    const existingScheduleIndex = schedules.findIndex(s => s.id === schedule.id);
    
    if (existingScheduleIndex !== -1) {
      // 既存のスケジュールが見つかった場合（移動）
      const updatedSchedules = [...schedules];
      updatedSchedules[existingScheduleIndex] = schedule;
      setSchedules(updatedSchedules, 'schedule_move');
      console.log('📝 Schedule updated (moved):', { id: schedule.id, newDate: schedule.date });
    } else {
      // 新しいスケジュール（コピー）
      setSchedules([...schedules, schedule], 'schedule_copy');
      console.log('➕ Schedule added (copied):', { id: schedule.id, date: schedule.date });
    }
  };

  // 予定削除ハンドラー（ドラッグ&ドロップやAlt+右クリック用）
  const handleScheduleDelete = (id) => {
    // 通知もキャンセル
    cancelScheduleNotifications(id);
    setSchedules(schedules.filter(s => s.id !== id), 'schedule_delete');
  };

  // 予定更新ハンドラー（並び替え用）
  const handleScheduleUpdate = (updatedSchedule, actionType = 'schedule_reorder') => {
    const updates = Array.isArray(updatedSchedule) ? updatedSchedule : [updatedSchedule];
    if (updates.length === 0) return;

    const updateMap = new Map(updates.map(s => [s.id, s]));
    const newSchedules = schedules.map(s => 
      updateMap.has(s.id) ? { ...s, ...updateMap.get(s.id) } : s
    );

    setSchedules(newSchedules, actionType);
  };

  // タスクのチェック状態トグル
  const handleToggleTask = (id, completed) => {
    const newSchedules = schedules.map(s => s.id === id ? { ...s, completed, isTask: true } : s);
    setSchedules(newSchedules, 'task_toggle');
  };

  // 予定追加ハンドラー
  const handleAdd = (targetDate = null) => {
    // ターゲット日付が指定されていればその日付を使用、なければ選択中の日付を使用
    const dateToUse = targetDate || selectedDate;
  const dateStr = toDateStrLocal(dateToUse);
    
    setEditingSchedule({
      date: dateStr,
      time: '',
      name: '',
      memo: '',
      allDay: true,  // 新規作成時は開始時間が空欄なので終日に設定
      isTask: false,
      completed: false
    });
    setShowForm(true);
    
    // ダブルクリックで作成された場合は、その日付を選択状態にする
    if (targetDate) {
      setSelectedDate(targetDate);
    }
  };

  // 予定保存ハンドラー
  const handleSave = (schedule) => {
    if (schedule.id) {
      // 既存の予定を更新
      const newSchedules = schedules.map(s => s.id === schedule.id ? { ...s, ...schedule } : s);
      setSchedules(newSchedules, 'schedule_edit');
    } else {
      // 新しい予定を追加
      const newSchedule = { 
        ...schedule, 
        id: Date.now(),
        isTask: !!schedule.isTask,
        completed: !!schedule.completed
      };
      
      // 終日予定の場合、allDayOrderを自動設定
      if (newSchedule.allDay) {
        const sameDateAllDaySchedules = schedules.filter(s => 
          s.date === newSchedule.date && s.allDay
        );
        newSchedule.allDayOrder = sameDateAllDaySchedules.length;
      }
      
      setSchedules([...schedules, newSchedule], 'schedule_create');
    }
    setShowForm(false);
  };

  // 予定削除ハンドラー
  const handleDelete = (id) => {
    // 通知もキャンセル
    cancelScheduleNotifications(id);
    setSchedules(schedules.filter(s => s.id !== id), 'schedule_delete');
    setShowForm(false);
  };

  // フォーム閉じるハンドラー
  const handleClose = () => setShowForm(false);

  // 選択された日付の予定のみ表示
  const selectedDateStr = selectedDate ? toDateStrLocal(selectedDate) : '';
  const filteredSchedules = schedules.filter(s => s.date === selectedDateStr);

  return (
    <div 
      className="w-screen h-screen bg-gradient-to-br from-indigo-900 to-gray-900 text-gray-900 font-sans flex flex-col overflow-hidden"
      onWheel={(e) => {
        // モーダルが開いている場合は全体のスクロールを防止
        if (showSettings || showForm) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <TitleBar onSettingsClick={() => setShowSettings(true)} />
      <main 
        className="flex-1 p-2 overflow-hidden flex relative"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* ハンバーガーメニュー */}
        <div 
          className={`
            fixed bottom-4 z-30 transition-all duration-300
            ${isMobile && isTimelineOpen ? 'right-96' : 'right-4'}
          `}
          data-menu-container
        >
          {/* メニューボタン */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`
              w-8 h-8 rounded-full shadow-md transition-all duration-200 flex items-center justify-center relative
              bg-white border border-gray-200 hover:border-indigo-300 hover:shadow-lg hover:scale-105 cursor-pointer
              ${isMenuOpen ? 'bg-indigo-50 border-indigo-400 scale-105 shadow-lg' : ''}
            `}
            title={isMenuOpen ? "メニューを閉じる" : "メニューを開く"}
          >
            {/* ハンバーガー → × アニメーション */}
            <div className="relative w-3 h-3 flex items-center justify-center">
              {/* 1本目の線 */}
              <div className={`
                absolute w-3 h-0.5 rounded-full transition-all duration-300 
                ${isMenuOpen 
                  ? 'bg-indigo-600 rotate-45' 
                  : 'bg-gray-600 rotate-0 -translate-y-1'
                }
              `}></div>
              
              {/* 2本目の線（中央、×の時は消える） */}
              <div className={`
                absolute w-3 h-0.5 rounded-full transition-all duration-300
                ${isMenuOpen 
                  ? 'bg-indigo-600 opacity-0 scale-0' 
                  : 'bg-gray-600 opacity-100 scale-100'
                }
              `}></div>
              
              {/* 3本目の線 */}
              <div className={`
                absolute w-3 h-0.5 rounded-full transition-all duration-300
                ${isMenuOpen 
                  ? 'bg-indigo-600 -rotate-45' 
                  : 'bg-gray-600 rotate-0 translate-y-1'
                }
              `}></div>
            </div>
          </button>
          {/* メニュー項目 */}
          {isMenuOpen && (
            <div className={`
              absolute bottom-10 right-0 bg-white rounded-lg shadow-xl border border-gray-100 py-1 min-w-[120px]
              transition-all duration-200
              ${isMenuOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'}
            `}>
              <button
                onClick={() => {
                  undo();
                  setIsMenuOpen(false);
                }}
                disabled={!canUndo}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 text-sm transition-all duration-200 text-left bg-white
                  ${canUndo 
                    ? 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer' 
                    : 'text-gray-400 cursor-not-allowed'
                  }
                `}
                title={`Ctrl+Z${canUndo ? '' : ' - 利用不可'}`}
              >
                <span className="text-sm">↩️</span>
                <span className="font-medium">元に戻す</span>
              </button>
              <div className="border-t border-gray-100 mx-1"></div>
              <button
                onClick={() => {
                  redo();
                  setIsMenuOpen(false);
                }}
                disabled={!canRedo}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 text-sm transition-all duration-200 text-left bg-white
                  ${canRedo 
                    ? 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer' 
                    : 'text-gray-400 cursor-not-allowed'
                  }
                `}
                title={`Ctrl+Shift+Z${canRedo ? '' : ' - 利用不可'}`}
              >
                <span className="text-sm">↪️</span>
                <span className="font-medium">やり直し</span>
              </button>
            </div>
          )}
        </div>

        {/* モバイル表示 */}
        {isMobile ? (
          <>
            {/* カレンダー部分（モバイル） */}
            <div className="flex flex-col w-full overflow-hidden">
              <Calendar 
                schedules={schedules} 
                onDateClick={handleDateClick} 
                selectedDate={selectedDate}
                onScheduleCopy={handleScheduleCopy}
                onScheduleDelete={handleScheduleDelete}
                onScheduleUpdate={handleScheduleUpdate}
                onAdd={handleAdd}
                onEdit={handleEdit}
                isMobile={isMobile}
                onToggleTask={handleToggleTask}
              />
            </div>
            
            {/* タイムラインオーバーレイ（モバイル） */}
            {isTimelineOpen && (
              <>
                {/* 背景オーバーレイ */}
                <div 
                  className="fixed inset-0 bg-black bg-opacity-50 z-40"
                  onClick={closeTimeline}
                />
                
                {/* タイムラインパネル */}
                <div 
                  className={`
                    fixed top-0 right-0 h-full w-80 bg-white z-50 slide-transition
                    ${isTimelineOpen ? 'translate-x-0' : 'translate-x-full'}
                  `}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onMouseDown={handleMouseDownOnTimeline}
                  onMouseMove={handleMouseMoveOnTimeline}
                  onMouseUp={handleMouseUpOnTimeline}
                  onMouseLeave={handleMouseUpOnTimeline}
                >
                  <div className="h-full flex flex-col">
                    {/* タイムラインコンテンツ */}
                    <div className="flex-1 overflow-hidden flex flex-col">
                      <CurrentDateTimeBar />
                      <Timeline 
                        schedules={filteredSchedules} 
                        selectedDate={selectedDate} 
                        onEdit={handleEdit}
                        onAdd={handleAdd}
                        onScheduleUpdate={handleScheduleUpdate}
                        onToggleTask={handleToggleTask}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          /* デスクトップ表示 */
          <>
            {/* カレンダー部分 */}
            <div 
              className="flex flex-col overflow-hidden pr-1"
              style={{ width: `${splitRatio}%` }}
            >
              <Calendar 
                schedules={schedules} 
                onDateClick={handleDateClick} 
                selectedDate={selectedDate}
                onScheduleCopy={handleScheduleCopy}
                onScheduleDelete={handleScheduleDelete}
                onScheduleUpdate={handleScheduleUpdate}
                onAdd={handleAdd}
                onEdit={handleEdit}
                isMobile={isMobile}
                onToggleTask={handleToggleTask}
              />
            </div>
            
            {/* 分割バー */}
            <div 
              className={`
                w-2 cursor-col-resize transition-colors duration-200 flex-shrink-0 mx-1 bg-transparent hover:bg-transparent
                ${isDragging ? '' : ''}
              `}
              onMouseDown={handleMouseDown}
            >
              <div className="w-full h-full flex items-center justify-center">
                <div className={`
                  w-1 h-12 rounded-full transition-colors duration-200
                  ${isDragging ? 'bg-indigo-500' : 'bg-gray-400 hover:bg-indigo-400'}
                `}></div>
              </div>
            </div>
            
            {/* タイムライン部分 */}
            <div 
              className="flex flex-col overflow-hidden pl-1"
              style={{ width: `${100 - splitRatio}%` }}
            >
              <CurrentDateTimeBar />
              <Timeline 
                schedules={filteredSchedules} 
                selectedDate={selectedDate} 
                onEdit={handleEdit}
                onAdd={handleAdd}
                onScheduleUpdate={handleScheduleUpdate}
                onToggleTask={handleToggleTask}
              />
            </div>
          </>
        )}
      </main>
      
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full h-[90vh] max-h-[90vh] flex flex-col overflow-hidden">
            <ScheduleForm 
              schedule={editingSchedule} 
              onSave={handleSave} 
              onClose={handleClose} 
              onDelete={editingSchedule?.id ? handleDelete : undefined}
              sendTestNotification={sendTestNotification}
            />
          </div>
        </div>
      )}

      {/* 設定モーダル */}
      <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
      />
    </div>
  );
}

export default App;
