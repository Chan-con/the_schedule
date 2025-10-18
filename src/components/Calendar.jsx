import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toDateStrLocal } from '../utils/date';
import { isJapaneseHoliday, getJapaneseHolidayName } from '../utils/holidays';

// 予定が過去かどうかを判定する関数
const isSchedulePast = (schedule) => {
  const now = new Date();
  // schedule.date は 'YYYY-MM-DD' 想定。ローカル日付で安全にパースする
  const [y, m, d] = (schedule.date || '').split('-').map(Number);
  const scheduleDateLocal = new Date(y, (m || 1) - 1, d || 1);

  if (schedule.allDay) {
    // 終日予定は「今日より前」のみ過去。当日は過去扱いしない
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return scheduleDateLocal < startOfToday;
  } else {
    // 時間指定予定は日時で比較（時間未指定は過去扱いしない）
    if (!schedule.time) return false;
    const [hours, minutes] = schedule.time.split(':').map(Number);
    const scheduleDateTime = new Date(scheduleDateLocal);
    scheduleDateTime.setHours(hours || 0, minutes || 0, 0, 0);
    return scheduleDateTime < now;
  }
};

// タスクの完了状態に応じた薄表示かどうかを判定
const shouldDimForTask = (schedule) => {
  if (!schedule?.isTask) return false;
  if (!schedule.completed) return false;
  // タスクは当日や未来でも完了済みは薄く表示
  return true;
};

const Calendar = ({ schedules, onDateClick, selectedDate, onScheduleCopy, onScheduleDelete, onScheduleMove, onAdd, onEdit, onToggleTask, onScheduleUpdate }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [draggedSchedule, setDraggedSchedule] = useState(null);
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [dragOverDate, setDragOverDate] = useState(null);
  const [dragOverScheduleInfo, setDragOverScheduleInfo] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCustomDragging, setIsCustomDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [maxSchedulesPerCell, setMaxSchedulesPerCell] = useState(3); // 動的に調整される
  const [_scrollTrigger, setScrollTrigger] = useState(0); // スクロール時の再レンダリング用（未使用変数のLint回避）
  
  // 終日予定の並び替え用（未使用のため削除）
  
  const calendarRef = useRef(null);

  const adjustDateCellScroll = useCallback((dateCell, deltaY) => {
    if (!dateCell) return false;
    const dateStr = dateCell.getAttribute('data-date');
    if (!dateStr) return false;

    const daySchedules = schedules.filter(s => s.date === dateStr);
    if (daySchedules.length <= maxSchedulesPerCell) {
      return false;
    }

    const currentOffset = parseInt(dateCell.getAttribute('data-scroll-offset') || '0', 10);
    const maxOffset = Math.max(0, daySchedules.length - maxSchedulesPerCell);
    let newOffset = currentOffset;

    if (deltaY < 0) {
      newOffset = Math.max(0, currentOffset - 1);
    } else {
      newOffset = Math.min(maxOffset, currentOffset + 1);
    }

    if (newOffset !== currentOffset) {
      dateCell.setAttribute('data-scroll-offset', newOffset.toString());
      setScrollTrigger(prev => prev + 1);
      return true;
    }

    return false;
  }, [schedules, maxSchedulesPerCell]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // カレンダーのサイズ変更を監視して表示件数を調整
  useEffect(() => {
    const updateMaxSchedules = () => {
      if (!calendarRef.current) return;
      
      const calendarHeight = calendarRef.current.clientHeight;
      const headerHeight = 80; // ヘッダー部分の高さ
      const availableHeight = calendarHeight - headerHeight;
      const rowHeight = availableHeight / 6; // 6週間分
      
      // 日付表示部分（約20px）とスケジュール間隔（2px）を考慮
  const dateHeight = 20;
  const scheduleHeight = 18; // 1スケジュールの高さ
  const scheduleSpacing = 2; // スケジュール間の余白
  const otherItemsHeight = 18; // "他○件"の高さ
  const padding = 8; // セル内のパディング
      
      const availableForSchedules = rowHeight - dateHeight - padding;
      const maxSchedules = Math.max(1, Math.floor((availableForSchedules - otherItemsHeight) / (scheduleHeight + scheduleSpacing)));
      
  setMaxSchedulesPerCell(Math.min(maxSchedules, 5)); // 最大5件まで
      
      console.log('📏 Calendar size updated:', {
        calendarHeight,
        availableHeight,
        rowHeight,
        maxSchedules: Math.min(maxSchedules, 6)
      });
    };

    // 初期サイズ計算
    updateMaxSchedules();

    // ResizeObserverでサイズ変更を監視
    const resizeObserver = new ResizeObserver(updateMaxSchedules);
    if (calendarRef.current) {
      resizeObserver.observe(calendarRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // 全ての日付セルのスクロールオフセットをリセット
  const resetAllScrollOffsets = useCallback(() => {
    setTimeout(() => {
      const dateCells = document.querySelectorAll('.date-cell');
      dateCells.forEach(cell => {
        cell.setAttribute('data-scroll-offset', '0');
      });
      console.log('📅 Reset all scroll offsets');
    }, 50); // 少し遅延させてDOMの更新を待つ
  }, []);

  // 月の移動関数
  const prevMonth = useCallback(() => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() - 1);
      return newDate;
    });
    resetAllScrollOffsets();
  }, [resetAllScrollOffsets]);

  const nextMonth = useCallback(() => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + 1);
      return newDate;
    });
    resetAllScrollOffsets();
  }, [resetAllScrollOffsets]);

  // 今月に戻る関数
  const goToCurrentMonth = useCallback(() => {
    const today = new Date();
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    // スクロールオフセットをリセット
    resetAllScrollOffsets();
    console.log('📅 Jumped to current month:', {
      year: today.getFullYear(),
      month: today.getMonth() + 1
    });
  }, [resetAllScrollOffsets]);

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
  // キーボードイベントの監視
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

        // ポインタ直下の日付セルがスクロール可能なら、月移動を無効化
        const cells = calendarElement.querySelectorAll('button[data-date]');
        let hoveredCell = null;
        cells.forEach(cell => {
          const r = cell.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            hoveredCell = cell;
          }
        });
        if (hoveredCell) {
          const dateStr = hoveredCell.getAttribute('data-date');
          const daySchedules = schedules.filter(s => s.date === dateStr);
          const isScrollable = daySchedules.length > maxSchedulesPerCell;
          if (isScrollable) {
            const scrolled = adjustDateCellScroll(hoveredCell, e.deltaY);
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (scrolled) {
              console.log('🌀 Drag scrolling within date cell');
            } else {
              console.log('🚫 Month navigation disabled during drag: cell is scrollable but at limit');
            }
            return;
          }
        }
        
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
  }, [adjustDateCellScroll, draggedSchedule, maxSchedulesPerCell, month, nextMonth, prevMonth, schedules, year]);

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

            if (draggedSchedule?.allDay) {
              let hoverInfo = null;
              if (hoveredDate) {
                const calendarElement = calendarRef.current;
                const dateButton = calendarElement?.querySelector(`button[data-date="${hoveredDate}"]`);
                if (dateButton) {
                  const scheduleElements = Array.from(
                    dateButton.querySelectorAll('.schedule-item[data-schedule-id][data-all-day="true"]')
                  );
                  const draggedScheduleId = draggedSchedule?.id != null ? String(draggedSchedule.id) : null;

                  if (scheduleElements.length > 0) {
                    const pointerY = e.clientY;
                    let insertionIndex = scheduleElements.length;
                    let hoverScheduleId = null;

                    const normalizeId = (value) => {
                      if (value == null || value === '') {
                        return null;
                      }
                      return value;
                    };

                    for (let index = 0; index < scheduleElements.length; index += 1) {
                      const element = scheduleElements[index];
                      const rectSchedule = element.getBoundingClientRect();
                      const scheduleId = normalizeId(element.getAttribute('data-schedule-id'));

                      if (pointerY < rectSchedule.top) {
                        insertionIndex = index;
                        hoverScheduleId = scheduleId;
                        break;
                      }

                      if (pointerY <= rectSchedule.bottom) {
                        insertionIndex = index;
                        hoverScheduleId = scheduleId;
                        break;
                      }
                    }

                    if (hoverScheduleId == null) {
                      const lastElement = scheduleElements[scheduleElements.length - 1];
                      const lastRect = lastElement.getBoundingClientRect();
                      if (pointerY > lastRect.bottom) {
                        insertionIndex = scheduleElements.length;
                      }
                    }

                    if (draggedScheduleId != null && hoverScheduleId === draggedScheduleId) {
                      hoverScheduleId = null;
                    }

                    hoverInfo = {
                      scheduleId: hoverScheduleId,
                      index: insertionIndex,
                      date: hoveredDate,
                    };
                  } else {
                    hoverInfo = { scheduleId: null, date: hoveredDate, index: 0 };
                  }
                }
              }

              setDragOverScheduleInfo(hoverInfo);
            } else {
              setDragOverScheduleInfo(null);
            }
          }
        }
      }
    };

    if (!isCustomDragging) {
      setDragOverScheduleInfo(null);
    };
    
    const handleMouseUp = () => {
      if (isCustomDragging) {
        console.log('🏁 Custom drag ended');
        
        if (dragOverDate && draggedSchedule) {
          if (dragOverDate !== draggedSchedule.date) {
            if (isAltPressed && onScheduleCopy) {
              // ALTキー押下時: コピー（新しいIDで複製）
              const newSchedule = {
                ...draggedSchedule,
                date: dragOverDate,
                id: Date.now(), // 新しいIDでコピー
                notificationSettings: null // 通知設定をリセット（コピー時は通知設定も複製しない）
              };
              console.log('📋 Copying schedule to new date:', { 
                originalId: draggedSchedule.id, 
                newId: newSchedule.id, 
                newDate: dragOverDate,
                notificationReset: true
              });
              onScheduleCopy(newSchedule);
            } else if (onScheduleMove) {
              // 通常のドラッグ: 移動（同じIDで日付を更新）
              console.log('🚚 Moving schedule to new date:', { 
                scheduleId: draggedSchedule.id, 
                fromDate: draggedSchedule.date, 
                toDate: dragOverDate 
              });

              const movedSchedule = {
                ...draggedSchedule,
                date: dragOverDate
              };
              onScheduleMove(movedSchedule, dragOverDate);
            }
          } else if (draggedSchedule.allDay && dragOverScheduleInfo?.date === draggedSchedule.date) {
            const dayAllDaySchedules = schedules
              .filter(s => s.date === draggedSchedule.date && s.allDay);
            if (dayAllDaySchedules.length > 1 && onScheduleUpdate) {
              const sortedAllDay = [...dayAllDaySchedules].sort((a, b) => {
                const orderDiff = (a.allDayOrder || 0) - (b.allDayOrder || 0);
                if (orderDiff !== 0) return orderDiff;
                return String(a.id).localeCompare(String(b.id));
              });

              const originalOrderIds = sortedAllDay.map(s => String(s.id));
              const withoutDragged = sortedAllDay.filter(s => String(s.id) !== String(draggedSchedule.id));

              let insertionIndex = withoutDragged.length;
              if (typeof dragOverScheduleInfo.index === 'number') {
                insertionIndex = dragOverScheduleInfo.index;
              }

              insertionIndex = Math.max(0, Math.min(insertionIndex, withoutDragged.length));

              const reordered = [...withoutDragged];
              reordered.splice(insertionIndex, 0, draggedSchedule);

              const newOrderIds = reordered.map(s => String(s.id));
              const orderChanged = originalOrderIds.length !== newOrderIds.length ||
                originalOrderIds.some((id, index) => id !== newOrderIds[index]);

              if (orderChanged) {
                const updatedSchedules = reordered.map((schedule, index) => ({
                  ...schedule,
                  allDayOrder: index
                }));

                onScheduleUpdate(updatedSchedules, 'schedule_reorder_all_day_calendar');
              }
            }
          }
        }
        
        setIsCustomDragging(false);
        setDraggedSchedule(null);
        setDragOverDate(null);
        setDragOverScheduleInfo(null);
        setIsDragging(false);
      }
    };

    // 統合されたwheelイベントハンドラー - 日付セル内外を区別して処理
    const handleWheel = (e) => {
      console.log('🎯 Integrated wheel event:', {
        deltaY: e.deltaY,
        isCustomDragging,
        isDragging,
        isAltPressed,
        targetTag: e.target?.tagName,
        targetClass: e.target?.className
      });

      // モーダルが開いている場合はカレンダーのスクロールを無効化
      const isModalOpen = document.querySelector('.settings-modal-content, .schedule-form-modal, [role="dialog"]');
      if (isModalOpen) {
        console.log('🚫 Wheel ignored: modal is open');
        return;
      }

      // フォーム要素内では月切り替えを無効化
      const isInFormElement = e.target.closest('form, .modal, [role="dialog"]');
      if (isInFormElement) {
        console.log('🚫 Wheel ignored: inside form element');
        return;
      }

      // スクロール量が小さい場合は無視
      if (Math.abs(e.deltaY) < 5) {
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

      // 日付セル内かどうかを判定
      const dateCell = e.target.closest('.date-cell');
      const schedulesContainer = e.target.closest('.schedules-container');
      
      if (dateCell && schedulesContainer) {
        // 日付セルがスクロール可能な場合は、月移動を無効化し、セル内スクロールのみを許可
        const dateStr = dateCell.getAttribute('data-date');
        const daySchedules = schedules.filter(s => s.date === dateStr);
        const isScrollable = daySchedules.length > maxSchedulesPerCell;

        if (isScrollable) {
          const scrolled = adjustDateCellScroll(dateCell, e.deltaY);
          e.preventDefault();
          e.stopPropagation();
          if (scrolled) {
            console.log('📅 Cell scroll via wheel during drag or hover');
          }
          return;
        }

        // スクロールできないセルなら月移動
        handleMonthNavigation(e);
      } else {
        // 日付枠外での月切り替え処理
        handleMonthNavigation(e);
      }
    };

    // 月切り替え処理
    const handleMonthNavigation = (e) => {
      // ホイールイベントを処理（ドラッグ中でも通常時でも動作）
      e.preventDefault();
      e.stopPropagation();
      
      console.log('✅ Month navigation:', {
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
  }, [
    isCustomDragging,
    isDragging,
    dragOverDate,
    draggedSchedule,
    dragOverScheduleInfo,
    isAltPressed,
  onScheduleCopy,
  onScheduleDelete,
  onScheduleMove,
  onScheduleUpdate,
    schedules,
    month,
    year,
    prevMonth,
    nextMonth,
    adjustDateCellScroll,
    maxSchedulesPerCell
  ]);

  // カレンダーグリッドを6週間分（42日）で構築
  const getCalendarDays = () => {
    const firstDay = new Date(year, month, 1);
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
    return toDateStrLocal(selectedDate) === dateStr;
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
            className={`text-center font-bold text-xs py-1 ${i === 5 ? 'text-blue-500' : i === 6 ? 'text-red-500' : 'text-gray-600'}`}
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
          const y = date.getFullYear();
          const mStr = String(date.getMonth() + 1).padStart(2, '0');
          const dStr = String(date.getDate()).padStart(2, '0');
          const dateStr = `${y}-${mStr}-${dStr}`;
          
          const daySchedules = getSchedulesForDate(dateStr);
          const selected = isSelected(dateStr);
          const today = isToday(dateStr);
          const currentMonth = isCurrentMonth(date);
          
          return (
            <button
              key={index}
              data-date={dateStr}
              data-scroll-offset="0"
              className={`
                date-cell p-1 relative flex flex-col bg-white
                focus:outline-none
                ${dragOverDate === dateStr ? 
                  'bg-green-100 border border-green-300 hover:border-green-300' : 
                  today && selected ?
                    'bg-orange-50' :
                  selected ? 
                    'border border-indigo-300 hover:border-indigo-300' : 
                  today ? 
                    'bg-orange-50 border border-orange-400 hover:border-orange-400' : 
                    (currentMonth ? 'border border-gray-300 hover:border-gray-400' : 'border border-gray-200 hover:border-gray-200')}
                ${!currentMonth ? 'bg-gray-50' : ''}
              `}
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
              style={{
                ...(today && selected ? {
                  border: '1px solid transparent',
                  borderRadius: '6px',
                  background: `linear-gradient(white, white) padding-box, 
                              linear-gradient(135deg, #fb923c 0%, #fb923c 50%, #6366f1 50%, #6366f1 100%) border-box`
                } : {})
              }}
            >
              {/* 日付部分 - 固定の高さ */}
              <div className="flex-shrink-0 mb-0.5 flex justify-center">
                {(() => {
                  const dow = date.getDay();
                  const holiday = isJapaneseHoliday(date);
                  let dateTextColorClass = '';
                  if (holiday) {
                    dateTextColorClass = currentMonth ? 'text-green-600' : 'text-green-400';
                  } else if (dow === 0) {
                    dateTextColorClass = currentMonth ? 'text-red-500' : 'text-red-300';
                  } else if (dow === 6) {
                    dateTextColorClass = currentMonth ? 'text-blue-500' : 'text-blue-300';
                  } else {
                    dateTextColorClass = currentMonth ? 'text-gray-400' : 'text-gray-300';
                  }
                  return (
                    <span
                      className={`text-xs font-bold ${dateTextColorClass}`}
                      title={holiday ? getJapaneseHolidayName(date) : ''}
                    >
                      {date.getDate()}
                    </span>
                  );
                })()}
              </div>
              
              {/* 予定部分 - 残りのスペースを使用（表示中の全日付で予定を表示） */}
              <div className="schedules-container flex-1 w-full overflow-hidden space-y-0.5">
                {(() => {
                  // スクロールオフセットを取得
                  const scrollOffset = parseInt(document.querySelector(`[data-date="${dateStr}"]`)?.getAttribute('data-scroll-offset') || '0');
                  // オフセットを適用して表示する予定を決定
                  const visibleSchedules = daySchedules.slice(scrollOffset, scrollOffset + maxSchedulesPerCell);
                  
                  const draggedScheduleId = draggedSchedule?.id != null ? String(draggedSchedule.id) : null;

                  const rendered = visibleSchedules.map((schedule, index) => {
                    const scheduleId = schedule.id != null ? String(schedule.id) : null;
                    const displayText = schedule.allDay || !schedule.time
                      ? schedule.name
                      : `${schedule.time} ${schedule.name}`;

                    const isPast = isSchedulePast(schedule);
                    const isDimTask = shouldDimForTask(schedule);
                    const isHoverTarget =
                      isCustomDragging &&
                      draggedSchedule?.allDay &&
                      schedule.allDay &&
                      dragOverScheduleInfo?.date === dateStr &&
                      (dragOverScheduleInfo?.scheduleId ?? null) === (scheduleId ?? null);
                    const isDraggedSchedule = draggedScheduleId != null && scheduleId === draggedScheduleId;

                    return (
                      <div
                        key={scheduleId ?? index}
                        draggable={false}
                        data-schedule-id={scheduleId ?? ''}
                        data-all-day={schedule.allDay ? 'true' : 'false'}
                        className={`
                          schedule-item text-[0.7rem] px-1 py-[3px] rounded truncate w-full leading-snug select-none
                          ${schedule.allDay
                            ? isPast
                              ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200 cursor-grab'
                              : 'bg-yellow-200 text-yellow-800 hover:bg-yellow-300 cursor-grab'
                            : isPast
                              ? 'bg-blue-100 text-blue-600 hover:bg-blue-200 cursor-pointer'
                              : 'bg-blue-200 text-blue-800 hover:bg-blue-300 cursor-pointer'}
                          ${isPast || isDimTask ? 'opacity-60' : ''}
                          ${isDraggedSchedule ? 'opacity-50' : ''}
                          ${isCustomDragging && isDraggedSchedule ? 'opacity-30 transform scale-95' : ''}
                          ${isHoverTarget ? 'ring-2 ring-indigo-300 ring-offset-1 ring-offset-white bg-indigo-50 relative' : ''}
                          transition-all duration-150
                        `}
                        title={displayText}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();

                          console.log('🚀 Custom drag started:', {
                            scheduleId: schedule.id,
                            scheduleName: schedule.name,
                            isAllDay: schedule.allDay,
                            isAltPressed,
                            mousePosition: { x: event.clientX, y: event.clientY },
                          });

                          setDraggedSchedule(schedule);
                          setIsCustomDragging(true);
                          setDragOffset({
                            x: event.clientX - event.currentTarget.getBoundingClientRect().left,
                            y: event.clientY - event.currentTarget.getBoundingClientRect().top,
                          });
                          setMousePosition({ x: event.clientX, y: event.clientY });
                        }}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          console.log('📝 Calendar schedule double-clicked for edit:', schedule.name);
                          if (onEdit) {
                            onEdit(schedule);
                          }
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDateClick(new Date(dateStr));
                        }}
                        onContextMenu={(event) => {
                          if (isAltPressed) {
                            event.preventDefault();
                            if (onScheduleDelete) {
                              onScheduleDelete(schedule);
                            }
                          }
                        }}
                      >
                        <div className="flex items-center gap-1">
                          {isAltPressed && (
                            <span className="text-[10px] font-bold opacity-70">
                              {isDraggedSchedule ? '📋' : '⚡'}
                            </span>
                          )}
                          <span className={`truncate pointer-events-none text-left text-[0.66rem] font-bold flex-1 ${schedule.isTask ? 'text-gray-700' : 'text-gray-800'}`}>
                            {displayText}
                          </span>
                          {schedule.isTask && (
                            <button
                              type="button"
                              className={`ml-1 inline-flex h-3 w-3 shrink-0 items-center justify-center rounded border p-0 text-[8px] leading-none transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${schedule.completed ? 'bg-green-500 border-green-600 text-white' : 'bg-white border-gray-300 text-transparent hover:border-gray-400'}`}
                              title={schedule.completed ? '完了済み' : '未完了'}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (onToggleTask) {
                                  onToggleTask(schedule, !schedule.completed);
                                }
                              }}
                            >
                              ✓
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  });

                  return rendered;
                })()}

                {(() => {
                  const scrollOffset = parseInt(document.querySelector(`[data-date="${dateStr}"]`)?.getAttribute('data-scroll-offset') || '0');
                  const totalSchedules = daySchedules.length;
                  const hiddenSchedules = totalSchedules - maxSchedulesPerCell - scrollOffset;
                  
                  if (totalSchedules > maxSchedulesPerCell) {
                    if (scrollOffset > 0 && hiddenSchedules > 0) {
                      // 上にも下にも隠れた予定がある場合
                      return (
                        <div
                          className="schedule-hidden-indicator flex items-center justify-center gap-2 text-center px-1 py-[1px] text-[0.5rem] font-medium leading-[0.7rem] text-gray-500"
                          title="スクロールすると隠れた予定を表示できます"
                          aria-label={`隠れた予定: 上に${scrollOffset}件、下に${hiddenSchedules}件。スクロールで確認できます`}
                        >
                          <span className="flex items-center justify-center gap-[2px]">
                            <span className="text-[0.42rem] text-gray-400">↑</span>
                            <span>{scrollOffset}</span>
                          </span>
                          <span className="text-gray-400 text-[0.42rem] tracking-[0.2em]">•••</span>
                          <span className="flex items-center justify-center gap-[2px]">
                            <span>{hiddenSchedules}</span>
                            <span className="text-[0.42rem] text-gray-400">↓</span>
                          </span>
                        </div>
                      );
                    } else if (scrollOffset > 0) {
                      // 上にのみ隠れた予定がある場合
                      return (
                        <div
                          className="schedule-hidden-indicator flex items-center justify-center gap-2 text-center px-1 py-[1px] text-[0.5rem] font-medium leading-[0.7rem] text-gray-500"
                          title="上方向にスクロールすると隠れた予定を表示できます"
                          aria-label={`隠れた予定: 上に${scrollOffset}件。スクロールで確認できます`}
                        >
                          <span className="flex items-center justify-center gap-[2px]">
                            <span className="text-[0.42rem] text-gray-400">↑</span>
                            <span>{scrollOffset}</span>
                          </span>
                        </div>
                      );
                    } else {
                      // 下にのみ隠れた予定がある場合
                      return (
                        <div
                          className="schedule-hidden-indicator flex items-center justify-center gap-2 text-center px-1 py-[1px] text-[0.5rem] font-medium leading-[0.7rem] text-gray-500"
                          title="下方向にスクロールすると隠れた予定を表示できます"
                          aria-label={`隠れた予定: 下に${hiddenSchedules}件。スクロールで確認できます`}
                        >
                          <span className="flex items-center justify-center gap-[2px]">
                            <span>{hiddenSchedules}</span>
                            <span className="text-[0.42rem] text-gray-400">↓</span>
                          </span>
                        </div>
                      );
                    }
                  }
                  return null;
                })()}
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
              <span className="font-bold">
                {draggedSchedule.allDay || !draggedSchedule.time
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
