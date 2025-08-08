import React, { useState, useEffect, useRef } from 'react';
import { isJapaneseHoliday, getJapaneseHolidayName } from '../utils/holidays';

const getMonthDays = (year, month) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days = [];
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }
  return days;
};

const Calendar = ({ schedules, onDateClick, selectedDate, onScheduleCopy, onScheduleDelete, onScheduleUpdate, onAdd, onEdit, isMobile }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [draggedSchedule, setDraggedSchedule] = useState(null);
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [dragOverDate, setDragOverDate] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCustomDragging, setIsCustomDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  
  // 終日予定の並び替え用
  const [draggedAllDaySchedule, setDraggedAllDaySchedule] = useState(null);
  const [dropTargetAllDaySchedule, setDropTargetAllDaySchedule] = useState(null);
  
  const calendarRef = useRef(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // 月の移動関数
  const prevMonth = () => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() - 1);
    setCurrentDate(newDate);
  };

  const nextMonth = () => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + 1);
    setCurrentDate(newDate);
  };

  // 今月に戻る関数
  const goToCurrentMonth = () => {
    const today = new Date();
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    console.log('📅 Jumped to current month:', {
      year: today.getFullYear(),
      month: today.getMonth() + 1
    });
  };

  // 中ボタンクリック（今日にジャンプ）
  const handleMiddleClick = (e) => {
    if (e.button === 1) { // 中ボタン（ホイールクリック）
      e.preventDefault();
      goToCurrentMonth();
      // 今日の日付を選択状態にする
      const today = new Date();
      onDateClick(today);
    }
  };

  // 終日予定の並び替えハンドラー
  const handleAllDayDragStart = (e, schedule) => {
    // 終日予定のみ並び替え可能
    if (!schedule.allDay) return;
    
    e.stopPropagation(); // カスタムドラッグイベントとの競合を防ぐ
    setDraggedAllDaySchedule(schedule);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify(schedule));
    console.log('🏷️ All-day schedule drag started:', schedule.name);
  };

  const handleAllDayDragEnd = () => {
    setDraggedAllDaySchedule(null);
    setDropTargetAllDaySchedule(null);
  };

  const handleAllDayDragOver = (e, targetSchedule) => {
    // 終日予定のみドロップ対象
    if (!targetSchedule.allDay || !draggedAllDaySchedule) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // 同じ日付の終日予定のみ並び替え可能
    if (draggedAllDaySchedule.date === targetSchedule.date) {
      e.dataTransfer.dropEffect = 'move';
      setDropTargetAllDaySchedule(targetSchedule);
    }
  };

  const handleAllDayDrop = (e, targetSchedule) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedAllDaySchedule || !targetSchedule.allDay) return;
    if (draggedAllDaySchedule.id === targetSchedule.id) return;
    if (draggedAllDaySchedule.date !== targetSchedule.date) return;

    // 同じ日付の終日予定を取得
    const sameDateAllDaySchedules = schedules.filter(s => 
      s.date === draggedAllDaySchedule.date && s.allDay
    ).sort((a, b) => (a.allDayOrder || 0) - (b.allDayOrder || 0));

    const draggedIndex = sameDateAllDaySchedules.findIndex(s => s.id === draggedAllDaySchedule.id);
    const targetIndex = sameDateAllDaySchedules.findIndex(s => s.id === targetSchedule.id);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // 新しい順序で配列を再構築
    const newSchedules = [...sameDateAllDaySchedules];
    newSchedules.splice(draggedIndex, 1);
    newSchedules.splice(targetIndex, 0, draggedAllDaySchedule);

    // allDayOrderを更新
    const updatedSchedules = newSchedules.map((schedule, index) => ({
      ...schedule,
      allDayOrder: index
    }));

    // 親コンポーネントに更新を通知
    if (onScheduleUpdate) {
      updatedSchedules.forEach(schedule => {
        onScheduleUpdate(schedule);
      });
    }

    console.log('🔄 All-day schedules reordered in calendar:', {
      from: draggedIndex,
      to: targetIndex,
      draggedId: draggedAllDaySchedule.id,
      targetId: targetSchedule.id
    });

    setDraggedAllDaySchedule(null);
    setDropTargetAllDaySchedule(null);
  };  // キーボードイベントの監視
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.altKey && !isAltPressed) {
        console.log('🔑 ALT key pressed');
        setIsAltPressed(true);
      }
    };
    
    const handleKeyUp = (e) => {
      if (!e.altKey && isAltPressed) {
        console.log('🔓 ALT key released');
        setIsAltPressed(false);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isAltPressed]);

  // ドラッグ中の特別なwheelイベント監視
  useEffect(() => {
    if (draggedSchedule) {
      console.log('🔥 Setting up drag-specific wheel monitoring');
      
      const handleDragSpecificWheel = (e) => {
        console.log('🎯 Drag-specific wheel event:', {
          deltaY: e.deltaY,
          isDragging: true,
          draggedItemId: draggedSchedule.id
        });
        
        // カレンダー要素の存在チェック
        const calendarElement = calendarRef.current;
        if (!calendarElement) return;
        
        // イベントターゲットがカレンダー内かチェック
        const rect = calendarElement.getBoundingClientRect();
        const isInCalendar = (
          e.clientX >= rect.left && 
          e.clientX <= rect.right && 
          e.clientY >= rect.top && 
          e.clientY <= rect.bottom
        );
        
        if (!isInCalendar) return;
        
        if (Math.abs(e.deltaY) >= 10) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          if (e.deltaY < 0) {
            console.log('⬆️ Drag wheel: previous month');
            prevMonth();
          } else {
            console.log('⬇️ Drag wheel: next month');
            nextMonth();
          }
        }
      };
      
      // より積極的にwheelイベントをキャッチ
      const targets = [document, window, document.body];
      const options = [
        { passive: false, capture: true },
        { passive: false, capture: false },
        { passive: false }
      ];
      
      targets.forEach(target => {
        options.forEach(option => {
          target.addEventListener('wheel', handleDragSpecificWheel, option);
        });
      });
      
      return () => {
        targets.forEach(target => {
          options.forEach(option => {
            target.removeEventListener('wheel', handleDragSpecificWheel, option);
          });
        });
      };
    }
  }, [draggedSchedule, month, year]);

  // カスタムドラッグのマウスイベント処理とwheelイベント統合
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isCustomDragging) {
        setMousePosition({ x: e.clientX, y: e.clientY });
        
        // ドラッグ中のホバー日付を計算
        const calendarElement = calendarRef.current;
        if (calendarElement) {
          const rect = calendarElement.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right && 
              e.clientY >= rect.top && e.clientY <= rect.bottom) {
            // カレンダー内の日付セルを特定
            const cells = calendarElement.querySelectorAll('button[data-date]');
            let hoveredDate = null;
            
            cells.forEach(cell => {
              const cellRect = cell.getBoundingClientRect();
              if (e.clientX >= cellRect.left && e.clientX <= cellRect.right &&
                  e.clientY >= cellRect.top && e.clientY <= cellRect.bottom) {
                hoveredDate = cell.getAttribute('data-date');
              }
            });
            
            setDragOverDate(hoveredDate);
          }
        }
      }
    };
    
    const handleMouseUp = (e) => {
      if (isCustomDragging) {
        console.log('🏁 Custom drag ended');
        
        if (dragOverDate && draggedSchedule && dragOverDate !== draggedSchedule.date) {
          if (isAltPressed && onScheduleCopy) {
            // ALTキー押下時: コピー（新しいIDで複製）
            const newSchedule = {
              ...draggedSchedule,
              date: dragOverDate,
              id: Date.now() // 新しいIDでコピー
            };
            console.log('📋 Copying schedule to new date:', { 
              originalId: draggedSchedule.id, 
              newId: newSchedule.id, 
              newDate: dragOverDate 
            });
            onScheduleCopy(newSchedule);
          } else if (onScheduleCopy && onScheduleDelete) {
            // 通常のドラッグ: 移動（元の予定を削除して同じIDで新しい日付に作成）
            console.log('🚚 Moving schedule to new date:', { 
              scheduleId: draggedSchedule.id, 
              fromDate: draggedSchedule.date, 
              toDate: dragOverDate 
            });
            
            // 1. 元の予定を削除
            onScheduleDelete(draggedSchedule.id);
            
            // 2. 新しい日付で同じIDの予定を作成（移動）
            const movedSchedule = {
              ...draggedSchedule,
              date: dragOverDate
              // IDは変更しない（移動なので）
            };
            onScheduleCopy(movedSchedule);
          }
        }
        
        setIsCustomDragging(false);
        setDraggedSchedule(null);
        setDragOverDate(null);
        setIsDragging(false);
      }
    };

    // 統合されたwheelイベントハンドラー - カスタムドラッグ中でも機能
    const handleWheel = (e) => {
      console.log('🎯 Integrated wheel event:', {
        deltaY: e.deltaY,
        isCustomDragging,
        isDragging,
        isAltPressed,
        targetTag: e.target?.tagName
      });

      // スクロール量が小さい場合は無視
      if (Math.abs(e.deltaY) < 10) {
        console.log('🚫 Wheel ignored: deltaY too small');
        return;
      }
      
      // カレンダー要素の存在チェック
      const calendarElement = calendarRef.current;
      if (!calendarElement) {
        console.log('🚫 Wheel ignored: no calendar element');
        return;
      }
      
      // イベントターゲットがカレンダー内かチェック
      const rect = calendarElement.getBoundingClientRect();
      const isInCalendar = (
        e.clientX >= rect.left && 
        e.clientX <= rect.right && 
        e.clientY >= rect.top && 
        e.clientY <= rect.bottom
      );
      
      if (!isInCalendar) {
        console.log('🚫 Wheel ignored: outside calendar area');
        return;
      }

      // ホイールイベントを処理（ドラッグ中でも通常時でも動作）
      e.preventDefault();
      e.stopPropagation();
      
      console.log('✅ Wheel event processing:', {
        direction: e.deltaY < 0 ? 'up (previous)' : 'down (next)',
        currentMonth: month,
        currentYear: year
      });
      
      if (e.deltaY < 0) {
        console.log('⬆️ Wheel up: previous month');
        prevMonth();
      } else {
        console.log('⬇️ Wheel down: next month');
        nextMonth();
      }
    };

    // グローバルイベントリスナーを追加
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('wheel', handleWheel);
    };
  }, [isCustomDragging, dragOverDate, draggedSchedule, isAltPressed, onScheduleCopy, onScheduleDelete, month, year, prevMonth, nextMonth]);

  // カレンダーグリッドを6週間分（42日）で構築
  const getCalendarDays = () => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    
    // 月曜日始まりに調整
    const dayOfWeek = (firstDay.getDay() + 6) % 7;
    startDate.setDate(firstDay.getDate() - dayOfWeek);
    
    const days = [];
    for (let i = 0; i < 42; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      days.push(date);
    }
    
    return days;
  };
  
  const calendarDays = getCalendarDays();

  // 初期表示時に今月を表示
  useEffect(() => {
    setCurrentDate(new Date());
  }, []);

  // 日付ごとの予定を取得（終日予定はallDayOrderでソート）
  const getSchedulesForDate = dateStr => {
    const daySchedules = schedules.filter(s => s.date === dateStr);
    
    // 終日予定と時間指定予定を分ける
    const allDaySchedules = daySchedules.filter(s => s.allDay);
    const timeSchedules = daySchedules.filter(s => !s.allDay);
    
    // 終日予定をallDayOrder順でソート（タイムラインと同じ順序）
    const sortedAllDaySchedules = allDaySchedules.sort((a, b) => (a.allDayOrder || 0) - (b.allDayOrder || 0));
    
    // 時間指定予定を時間順でソート
    const sortedTimeSchedules = timeSchedules.sort((a, b) => {
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });
    
    // 終日予定を先に、その後に時間指定予定を配置
    return [...sortedAllDaySchedules, ...sortedTimeSchedules];
  };
  
  // 日付が選択されているかチェック
  const isSelected = dateStr => {
    if (!selectedDate) return false;
    return selectedDate.toISOString().slice(0, 10) === dateStr;
  };
  
  // 今日の日付かチェック（OSの現在時刻を使用）
  const isToday = dateStr => {
    const today = new Date();
    // OSの現在日付を取得（タイムゾーンを考慮）
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    return todayStr === dateStr;
  };
  
  // 現在の月の日付かチェック  
  const isCurrentMonth = date => {
    return date.getMonth() === month && date.getFullYear() === year;
  };

  return (
    <div 
      ref={calendarRef}
      className="bg-white rounded-lg shadow-lg p-3 w-full h-full flex flex-col overflow-hidden"
      onMouseDown={handleMiddleClick}
    >
      <div className="flex justify-between items-center mb-3 flex-shrink-0">
        <button 
          onClick={prevMonth}
          className="text-gray-600 hover:text-white p-2 rounded-full bg-gray-100 hover:bg-indigo-500 transition-colors duration-200 shadow-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        <h2 
          className="text-base font-bold text-gray-800 cursor-pointer hover:text-indigo-600 transition-colors duration-200 select-none" 
          onDoubleClick={goToCurrentMonth}
          title="ダブルクリックで今月に戻る"
        >
          {year}年{month + 1}月
        </h2>
        
        <button 
          onClick={nextMonth}
          className="text-gray-600 hover:text-white p-2 rounded-full bg-gray-100 hover:bg-indigo-500 transition-colors duration-200 shadow-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      
      <div className="grid grid-cols-7 gap-1 mb-2 flex-shrink-0">
        {["月","火","水","木","金","土","日"].map((w, i) => (
          <div 
            key={i} 
            className={`text-center font-medium text-xs py-1 ${i === 5 ? 'text-blue-500' : i === 6 ? 'text-red-500' : 'text-gray-600'}`}
          >
            {w}
          </div>
        ))}
      </div>
      
      <div 
        className="grid grid-cols-7 grid-rows-6 gap-1 flex-1"
      >
        {calendarDays.map((date, index) => {
          // ローカル時間で日付文字列を生成
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;
          
          const daySchedules = getSchedulesForDate(dateStr);
          const selected = isSelected(dateStr);
          const today = isToday(dateStr);
          const currentMonth = isCurrentMonth(date);
          
          return (
            <button
              key={index}
              data-date={dateStr}
              onClick={() => onDateClick(new Date(dateStr))}
              onDoubleClick={(e) => {
                // 予定要素でのダブルクリックの場合は新規作成しない
                if (e.target.closest('.schedule-item')) {
                  return;
                }
                if (onAdd) {
                  // 空き部分のダブルクリックで新規予定作成
                  onAdd(new Date(dateStr));
                  console.log('📅 Empty area double-clicked to create new schedule:', dateStr);
                }
              }}
              className={`
                p-1 border relative flex flex-col bg-white
                focus:outline-none
                ${dragOverDate === dateStr ? 
                  'bg-green-100 border-green-300 hover:border-green-300' : 
                  selected ? 
                    'border-indigo-300 hover:border-indigo-300' : 
                  today ? 
                    'bg-orange-50 border-orange-300 hover:border-orange-300' : 
                    'border-gray-200 hover:border-gray-200'}
                ${!currentMonth ? 'opacity-30' : ''}
              `}
            >
              {/* 日付部分 - 固定の高さ */}
              <div className="flex-shrink-0 mb-0.5 flex justify-center">
                <span className={`
                  text-xs font-medium
                  ${isJapaneseHoliday(date) ? 'text-green-600' : 
                    date.getDay() === 0 ? 'text-red-500' : 
                    date.getDay() === 6 ? 'text-blue-500' : 'text-gray-400'}
                  ${today ? 'font-bold' : ''}
                  ${!currentMonth ? 'text-gray-400' : ''}
                `}
                title={isJapaneseHoliday(date) ? getJapaneseHolidayName(date) : ''}
                >
                  {date.getDate()}
                </span>
              </div>
              
              {/* 予定部分 - 残りのスペースを使用 */}
              <div className="flex-1 w-full overflow-hidden space-y-0.5">
                {currentMonth && daySchedules.slice(0, 3).map((schedule, i) => {
                  // 表示テキストを決定
                  const displayText = schedule.allDay 
                    ? schedule.name 
                    : `${schedule.time} ${schedule.name}`;
                  
                  return (
                    <div 
                      key={i}
                      // カスタムドラッグシステムのみ使用
                      draggable={false}
                      className={`
                        schedule-item text-xs px-1 py-0.5 rounded truncate w-full leading-tight select-none
                        ${schedule.allDay ? 'bg-yellow-200 text-yellow-800 hover:bg-yellow-300 cursor-grab' : 'bg-blue-200 text-blue-800 hover:bg-blue-300 cursor-pointer'}
                        ${draggedSchedule?.id === schedule.id ? 'opacity-50' : ''}
                        ${isCustomDragging && draggedSchedule?.id === schedule.id ? 'opacity-30 transform scale-95' : ''}
                        ${draggedAllDaySchedule?.id === schedule.id ? 'opacity-60 transform scale-95' : ''}
                        ${dropTargetAllDaySchedule?.id === schedule.id ? 'bg-green-300 border-2 border-green-500' : ''}
                        transition-all duration-150
                      `}
                      title={displayText}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        console.log('🚀 Custom drag started:', {
                          scheduleId: schedule.id,
                          scheduleName: schedule.name,
                          isAllDay: schedule.allDay,
                          isAltPressed: isAltPressed,
                          mousePosition: { x: e.clientX, y: e.clientY }
                        });
                        
                        setDraggedSchedule(schedule);
                        setIsCustomDragging(true);
                        setDragOffset({
                          x: e.clientX - e.currentTarget.getBoundingClientRect().left,
                          y: e.clientY - e.currentTarget.getBoundingClientRect().top
                        });
                        setMousePosition({ x: e.clientX, y: e.clientY });
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // 予定をダブルクリックで編集
                        console.log('📝 Calendar schedule double-clicked for edit:', schedule.name);
                        console.log('📝 onEdit function exists:', typeof onEdit === 'function');
                        if (onEdit) {
                          onEdit(schedule);
                        } else {
                          console.error('❌ onEdit function is not available');
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        // 日付選択を実行（タイムライン更新のため）
                        onDateClick(new Date(dateStr));
                      }}
                      onContextMenu={(e) => {
                        if (isAltPressed) {
                          e.preventDefault();
                          if (onScheduleDelete) {
                            onScheduleDelete(schedule.id);
                          }
                        }
                      }}
                    >
                      <div className="flex items-center pointer-events-none">
                        {isAltPressed && (
                          <span className="mr-1 text-xs opacity-70">
                            {draggedSchedule?.id === schedule.id ? '📋' : '⚡'}
                          </span>
                        )}
                        <span className="truncate">{displayText}</span>
                      </div>
                    </div>
                  );
                })}
                
                {currentMonth && daySchedules.length > 3 && (
                  <div className="text-xs text-gray-500 px-1 py-0.5">
                    他{daySchedules.length - 3}件
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* カスタムドラッグ中のフローティング要素 */}
      {isCustomDragging && draggedSchedule && (
        <div
          className="fixed z-50 pointer-events-none select-none"
          style={{
            left: mousePosition.x - (dragOffset.x || 0),
            top: mousePosition.y - (dragOffset.y || 0),
            transform: 'rotate(-5deg)',
          }}
        >
          <div className={`
            text-xs px-2 py-1 rounded shadow-lg border-2 opacity-80
            ${draggedSchedule.allDay 
              ? 'bg-yellow-300 text-yellow-900 border-yellow-400' 
              : 'bg-blue-300 text-blue-900 border-blue-400'
            }
          `}>
            <div className="flex items-center">
              {isAltPressed && (
                <span className="mr-1 text-xs opacity-70">📋</span>
              )}
              <span className="font-medium">
                {draggedSchedule.allDay 
                  ? draggedSchedule.name 
                  : `${draggedSchedule.time} ${draggedSchedule.name}`}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Calendar;
