import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import MemoWithLinks from './MemoWithLinks';

// 予定が過去かどうかを判定する関数
const isSchedulePast = (schedule, selectedDate) => {
  const now = new Date();
  const scheduleDate = new Date(selectedDate);
  
  if (schedule.allDay) {
    // 終日予定の場合、日付のみで比較（当日は過去扱いしない）
    const today = new Date();
    today.setHours(23, 59, 59, 999); // 当日の終了時刻
    return scheduleDate < today;
  } else {
    // 時間指定予定の場合、時刻も含めて比較
    if (!schedule.time) return false;
    
    const [hours, minutes] = schedule.time.split(':').map(Number);
    const scheduleDateTime = new Date(scheduleDate);
    scheduleDateTime.setHours(hours, minutes, 0, 0);
    
    return scheduleDateTime < now;
  }
};

const shouldDimForTask = (schedule) => {
  if (!schedule?.isTask) return false;
  return !!schedule.completed;
};

const Timeline = ({ schedules, selectedDate, onEdit, onAdd, onScheduleUpdate, onToggleTask }) => {
  const [draggedAllDayId, setDraggedAllDayId] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [allDayHeight, setAllDayHeight] = useState(200); // 終日エリア高さ（settings から初期化）
  const [heightLoaded, setHeightLoaded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStartY, setResizeStartY] = useState(0); // リサイズ開始時のマウスY座標
  const [resizeStartHeight, setResizeStartHeight] = useState(0); // リサイズ開始時の高さ
  const [isMemoHovering, setIsMemoHovering] = useState(false); // メモホバー状態
  const timelineRef = useRef(null);
  const resizeRef = useRef(null);

  // 終日予定と時間指定予定を分ける
  const allDaySchedules = schedules.filter(s => s.allDay);
  const timeSchedules = schedules.filter(s => !s.allDay);
  
  // 時間指定予定を時間順にソート
  const sortedTimeSchedules = [...timeSchedules].sort((a, b) => {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  });

  // リサイズハンドラー
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing || !timelineRef.current) return;
      
      const rect = timelineRef.current.getBoundingClientRect();
      const headerHeight = 60; // ヘッダー部分の高さ
      const minHeight = 100; // 最小高さ
      const maxHeight = rect.height - headerHeight - 100; // 最大高さ
      
      // マウス移動の差分を計算
      const deltaY = e.clientY - resizeStartY;
      const newHeight = Math.max(minHeight, Math.min(maxHeight, resizeStartHeight + deltaY));
      setAllDayHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isResizing, resizeStartY, resizeStartHeight]);

  const handleResizeStart = (e) => {
    e.preventDefault();
    setIsResizing(true);
    setResizeStartY(e.clientY);
    setResizeStartHeight(allDayHeight);
  };

  // 初期ロード時に settings から復元
  useLayoutEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (window.electronAPI) {
          const s = await window.electronAPI.getSettings();
          if (!mounted) return;
          const val = typeof s.allDayHeight === 'number' ? s.allDayHeight : 200;
          const container = timelineRef.current;
          const rect = container ? container.getBoundingClientRect() : null;
            const headerHeight = 60;
            const minHeight = 100;
            const dynamicMax = rect ? Math.max(minHeight, rect.height - headerHeight - 100) : 600;
            const clamped = Math.min(Math.max(val, minHeight), dynamicMax);
            setAllDayHeight(clamped);
            setHeightLoaded(true);
        } else {
          const stored = localStorage.getItem('allDayHeight');
          if (!stored) return;
          const raw = parseInt(stored, 10);
          if (!isNaN(raw)) {
            setAllDayHeight(raw);
            setHeightLoaded(true);
          }
        }
      } catch (e) {
        console.warn('終日エリア高さの読み込みに失敗:', e);
        setHeightLoaded(true);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  // 高さ変更を保存（ドラッグ終了時）
  useEffect(() => {
    if (!heightLoaded) return; // 初期ロード前は保存しない
    if (!isResizing) {
      if (window.electronAPI) {
        window.electronAPI.saveLayout({ allDayHeight });
      } else {
        localStorage.setItem('allDayHeight', String(allDayHeight));
      }
    }
  }, [allDayHeight, isResizing, heightLoaded]);

  // 終日予定の並び替え処理
  const handleAllDayDragStart = (e, schedule) => {
    // メモにホバー中は並び替えを無効化
    if (isMemoHovering) {
      e.preventDefault();
      return;
    }
    
    setDraggedAllDayId(schedule.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.outerHTML);
    e.target.style.opacity = '0.5';
  };

  const handleAllDayDragEnd = (e) => {
    e.target.style.opacity = '1';
    setDraggedAllDayId(null);
    setDragOverIndex(null);
  };

  const handleAllDayDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleAllDayDragLeave = (e) => {
    // 子要素から出た場合は無視
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverIndex(null);
    }
  };

  const handleAllDayDrop = (e, dropIndex) => {
    e.preventDefault();
    setDragOverIndex(null);
    
    if (!draggedAllDayId || draggedAllDayId === null) return;
    
    const draggedSchedule = allDaySchedules.find(s => s.id === draggedAllDayId);
    if (!draggedSchedule) return;
    
    const currentIndex = allDaySchedules.findIndex(s => s.id === draggedAllDayId);
    if (currentIndex === dropIndex) return;
    
    // 新しい順序で配列を再構築
    const newAllDaySchedules = [...allDaySchedules];
    newAllDaySchedules.splice(currentIndex, 1);
    newAllDaySchedules.splice(dropIndex, 0, draggedSchedule);
    
    // orderプロパティを更新
    const updatedSchedules = newAllDaySchedules.map((schedule, index) => ({
      ...schedule,
      allDayOrder: index
    }));
    
    // 親コンポーネントに更新を通知
    if (onScheduleUpdate) {
      updatedSchedules.forEach(schedule => {
        onScheduleUpdate(schedule);
      });
    }
    
    console.log('📋 All-day schedules reordered:', {
      from: currentIndex,
      to: dropIndex,
      scheduleId: draggedAllDayId
    });
    
    setDraggedAllDayId(null);
  };

  // 選択日付のフォーマット
  const formattedDate = selectedDate 
    ? selectedDate.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }) 
    : '選択された日付';

  return (
    <div 
      ref={timelineRef}
      className="bg-white rounded-lg shadow-lg p-3 h-full flex flex-col overflow-hidden"
      style={{
        '--scrollbar-width': '6px',
        '--scrollbar-track': '#f1f5f9',
        '--scrollbar-thumb': '#cbd5e1',
        '--scrollbar-thumb-hover': '#94a3b8'
      }}
    >
      <style>{`
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
        }
        
        .custom-scrollbar::-webkit-scrollbar {
          width: var(--scrollbar-width);
        }
        
        .custom-scrollbar::-webkit-scrollbar-track {
          background: var(--scrollbar-track);
          border-radius: 3px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--scrollbar-thumb);
          border-radius: 3px;
          transition: background-color 0.2s ease;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: var(--scrollbar-thumb-hover);
        }
        
        .resize-handle {
          background: transparent;
          width: 100%;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }
        
        .resize-handle::before {
          content: '';
          width: 48px;
          height: 3px;
          background: #9ca3af;
          border-radius: 2px;
        }
      `}</style>
      
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-gray-800">タイムライン</h2>
          <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
            {formattedDate}
          </span>
        </div>
        
        <button
          onClick={() => {
            console.log('➕ Timeline add button clicked');
            console.log('➕ onAdd function exists:', typeof onAdd === 'function');
            if (onAdd) {
              onAdd();
            } else {
              console.error('❌ onAdd function is not available');
            }
          }}
          className="text-gray-300 hover:text-gray-500 transition-colors duration-200 cursor-pointer font-bold text-lg p-1 bg-transparent border-none outline-none"
          title="予定を追加"
        >
          +
        </button>
      </div>
      
      {/* 終日予定エリア（リサイズ可能） */}
      {allDaySchedules.length > 0 && (
        <div className="flex flex-col">
          <div 
            className="custom-scrollbar overflow-auto"
            style={{ height: `${allDayHeight}px` }}
          >
            <div className="text-xs font-medium text-gray-500 mb-2 px-2 flex items-center gap-2">
              <span>終日</span>
              <span className="text-xs text-gray-400">（ドラッグで並び替え可能）</span>
            </div>
            <div className="space-y-2 pr-2">
              {allDaySchedules
                .sort((a, b) => (a.allDayOrder || 0) - (b.allDayOrder || 0))
                .map((s, index) => {
                  const isPast = isSchedulePast(s, selectedDate);
                  const isDimTask = shouldDimForTask(s);
                  return (
                <div 
                  key={s.id}
                  draggable={!isMemoHovering}
                  onDragStart={(e) => handleAllDayDragStart(e, s)}
                  onDragEnd={handleAllDayDragEnd}
                  onDragOver={(e) => handleAllDayDragOver(e, index)}
                  onDragLeave={handleAllDayDragLeave}
                  onDrop={(e) => handleAllDayDrop(e, index)}
                  className={`
                    ${isPast ? 'bg-amber-50 border-l-3 border-amber-300' : 'bg-amber-50 border-l-3 border-amber-400'} px-3 py-2 rounded-r ${isMemoHovering ? 'cursor-text' : 'cursor-grab'} ${(isPast || isDimTask) ? 'hover:bg-amber-100 opacity-60' : 'hover:bg-amber-100'} transition-all duration-200
                    ${draggedAllDayId === s.id ? 'opacity-50 transform scale-95' : ''}
                    ${dragOverIndex === index && draggedAllDayId !== s.id ? 'transform translate-y-1 shadow-lg bg-amber-200' : ''}
                  `}
                  onClick={(e) => {
                    // メモにホバー中はクリックを無効化
                    if (isMemoHovering) {
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    console.log('👆 All-day schedule clicked:', s.name);
                    onEdit(s);
                  }}
                  onDoubleClick={(e) => {
                    // メモにホバー中はダブルクリックを無効化
                    if (isMemoHovering) {
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    e.stopPropagation();
                    console.log('📝 All-day schedule double-clicked for edit:', s.name);
                    console.log('📝 onEdit function exists:', typeof onEdit === 'function');
                    onEdit(s);
                  }}
                >
                  <div className="flex items-center gap-2">
                    {s.isTask && (
                      <button
                        type="button"
                        className={`w-4 h-4 flex items-center justify-center rounded border text-[10px] leading-none ${s.completed ? 'bg-green-500 border-green-600 text-white' : 'bg-white border-gray-300 text-transparent'}`}
                        title={s.completed ? '完了済み' : '未完了'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onToggleTask) onToggleTask(s.id, !s.completed);
                        }}
                      >
                        ✓
                      </button>
                    )}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${isPast ? 'text-amber-500 bg-amber-100' : 'text-amber-600 bg-amber-200'}`}>終日</span>
                    <span className={`font-medium ${isPast ? 'text-gray-500' : 'text-gray-800'}`}>{s.emoji || ''}{s.emoji ? ' ' : ''}{s.name}</span>
                    <div className="ml-auto opacity-40 hover:opacity-80 transition-opacity">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                      </svg>
                    </div>
                  </div>
                  {s.memo && (
                    <MemoWithLinks 
                      memo={s.memo}
                      className="text-sm text-gray-600 mt-1 pl-8"
                      onHoverChange={setIsMemoHovering}
                    />
                  )}
                </div>
                );
              })}
            </div>
          </div>
          
          {/* リサイズハンドル */}
          <div 
            ref={resizeRef}
            className="resize-handle relative h-4 cursor-row-resize select-none"
            onMouseDown={handleResizeStart}
            title="ドラッグして境界を調整"
          />
        </div>
      )}
      
      {/* 時間指定予定エリア */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {sortedTimeSchedules.length === 0 && allDaySchedules.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p>この日の予定はありません</p>
          </div>
        ) : sortedTimeSchedules.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <p className="text-sm">時間指定の予定はありません</p>
          </div>
        ) : (
          <div className="flex-1 custom-scrollbar overflow-auto">
            <div className="text-xs font-medium text-gray-500 mb-3 px-2">時間指定</div>
            <ul className="space-y-3 pr-2">
              {sortedTimeSchedules.map(s => {
                const isPast = isSchedulePast(s, selectedDate);
                const isDimTask = shouldDimForTask(s);
                return (
                <li 
                  key={s.id} 
                  className={`border-l-4 ${(isPast || isDimTask) ? 'border-blue-300 opacity-60' : 'border-blue-500'} pl-4 flex flex-col gap-1 ${isMemoHovering ? 'cursor-text' : 'cursor-pointer'} ${isPast ? 'hover:bg-blue-50' : 'hover:bg-blue-50'} rounded-md transition p-2`}
                  onClick={(e) => {
                    // メモにホバー中はクリックを無効化
                    if (isMemoHovering) {
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    console.log('👆 Time schedule clicked:', s.name);
                    onEdit(s);
                  }}
                  onDoubleClick={(e) => {
                    // メモにホバー中はダブルクリックを無効化
                    if (isMemoHovering) {
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    e.stopPropagation();
                    console.log('📝 Time schedule double-clicked for edit:', s.name);
                    console.log('📝 onEdit function exists:', typeof onEdit === 'function');
                    onEdit(s);
                  }}
                >
                  <div className="flex items-center gap-3">
                    {s.isTask && (
                      <button
                        type="button"
                        className={`w-4 h-4 flex items-center justify-center rounded border text-[10px] leading-none ${s.completed ? 'bg-green-500 border-green-600 text-white' : 'bg-white border-gray-300 text-transparent'}`}
                        title={s.completed ? '完了済み' : '未完了'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onToggleTask) onToggleTask(s.id, !s.completed);
                        }}
                      >
                        ✓
                      </button>
                    )}
                    <span className={`font-semibold text-lg min-w-[4rem] ${(isPast || isDimTask) ? 'text-blue-400' : 'text-blue-600'}`}>{s.time}</span>
                    <span className={`font-bold ${(isPast || isDimTask) ? 'text-gray-500' : 'text-gray-900'}`}>{s.emoji || ''}{s.emoji ? ' ' : ''}{s.name}</span>
                  </div>
                  {s.memo && (
                    <MemoWithLinks 
                      memo={s.memo}
                      className="text-gray-500 text-sm pl-2 border-l-2 border-gray-200 ml-1"
                      onHoverChange={setIsMemoHovering}
                    />
                  )}
                </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default Timeline;
