import React, { useState, useEffect } from 'react';

const getMonthDays = (year, month) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days = [];
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }
  return days;
};

const Calendar = ({ schedules, onDateClick, selectedDate, onScheduleCopy, onScheduleDelete, isMobile }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [draggedSchedule, setDraggedSchedule] = useState(null);
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [dragOverDate, setDragOverDate] = useState(null);
  
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  // キーボードイベントの監視
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.altKey) {
        setIsAltPressed(true);
      }
    };
    
    const handleKeyUp = (e) => {
      if (!e.altKey) {
        setIsAltPressed(false);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
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
  
  // 前月・次月に移動
  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };
  
  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  // 初期表示時に今月を表示
  useEffect(() => {
    setCurrentDate(new Date());
  }, []);

  // 日付ごとの予定を取得
  const getSchedulesForDate = dateStr => {
    return schedules.filter(s => s.date === dateStr);
  };
  
  // 日付が選択されているかチェック
  const isSelected = dateStr => {
    if (!selectedDate) return false;
    return selectedDate.toISOString().slice(0, 10) === dateStr;
  };
  
  // 今日の日付かチェック
  const isToday = dateStr => {
    const today = new Date();
    return today.toISOString().slice(0, 10) === dateStr;
  };
  
  // 現在の月の日付かチェック  
  const isCurrentMonth = date => {
    return date.getMonth() === month && date.getFullYear() === year;
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-3 w-full h-full flex flex-col overflow-hidden">
      <div className="flex justify-between items-center mb-3 flex-shrink-0">
        <button 
          onClick={prevMonth}
          className="text-gray-600 hover:text-white p-2 rounded-full bg-gray-100 hover:bg-indigo-500 transition-colors duration-200 shadow-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        <h2 className="text-base font-bold text-gray-800">{year}年{month + 1}月</h2>
        
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
      
      <div className="grid grid-cols-7 grid-rows-6 gap-1 flex-1">
        {calendarDays.map((date, index) => {
          const dateStr = date.toISOString().slice(0, 10);
          const daySchedules = getSchedulesForDate(dateStr);
          const selected = isSelected(dateStr);
          const today = isToday(dateStr);
          const currentMonth = isCurrentMonth(date);
          
          return (
            <button
              key={index}
              onClick={() => onDateClick(new Date(dateStr))}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverDate(dateStr);
              }}
              onDragLeave={(e) => {
                // 子要素に移動した場合はdragLeaveを無視
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  setDragOverDate(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverDate(null);
                
                if (draggedSchedule && dateStr !== draggedSchedule.date) {
                  const newSchedule = {
                    ...draggedSchedule,
                    date: dateStr,
                    id: isAltPressed ? Date.now() : draggedSchedule.id // コピーの場合は新しいID
                  };
                  
                  if (isAltPressed && onScheduleCopy) {
                    // コピー
                    onScheduleCopy(newSchedule);
                  } else if (onScheduleCopy) {
                    // 移動（既存の予定を削除して新しい日付で作成）
                    onScheduleDelete(draggedSchedule.id);
                    onScheduleCopy(newSchedule);
                  }
                }
                setDraggedSchedule(null);
              }}
              className={`
                p-1 border border-gray-200 hover:bg-gray-50 transition-colors duration-200 relative flex flex-col
                ${selected ? 'bg-indigo-100 border-indigo-300' : 'bg-white'}
                ${today && !selected ? 'bg-blue-50 border-blue-300' : ''}
                ${!currentMonth ? 'opacity-30' : ''}
                ${dragOverDate === dateStr ? 'bg-green-100 border-green-300' : ''}
              `}
            >
              {/* 日付部分 - 固定の高さ */}
              <div className="flex-shrink-0 mb-0.5">
                <span className={`
                  text-xs font-medium
                  ${selected ? 'text-indigo-700' : today ? 'text-blue-700 font-bold' : 
                    date.getDay() === 0 ? 'text-red-500' : date.getDay() === 6 ? 'text-blue-500' : 'text-gray-700'}
                  ${!currentMonth ? 'text-gray-400' : ''}
                `}>
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
                      draggable={true}
                      className={`
                        text-xs px-1 py-0.5 rounded truncate w-full leading-tight cursor-pointer
                        ${schedule.allDay ? 'bg-yellow-200 text-yellow-800 hover:bg-yellow-300' : 'bg-blue-200 text-blue-800 hover:bg-blue-300'}
                        ${draggedSchedule?.id === schedule.id ? 'opacity-50' : ''}
                        transition-colors duration-150
                      `}
                      title={displayText}
                      onDragStart={(e) => {
                        setDraggedSchedule(schedule);
                        e.dataTransfer.effectAllowed = isAltPressed ? 'copy' : 'move';
                        e.dataTransfer.setData('text/plain', JSON.stringify(schedule));
                      }}
                      onDragEnd={() => {
                        setDraggedSchedule(null);
                        setDragOverDate(null);
                      }}
                      onClick={(e) => {
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
                      <div className="flex items-center">
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
    </div>
  );
};

export default Calendar;
