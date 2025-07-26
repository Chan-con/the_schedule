import React, { useState } from 'react';

const Timeline = ({ schedules, selectedDate, onEdit, onAdd, onScheduleUpdate }) => {
  const [draggedAllDayId, setDraggedAllDayId] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // 終日予定と時間指定予定を分ける
  const allDaySchedules = schedules.filter(s => s.allDay);
  const timeSchedules = schedules.filter(s => !s.allDay);
  
  // 時間指定予定を時間順にソート
  const sortedTimeSchedules = [...timeSchedules].sort((a, b) => {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  });

  // 終日予定の並び替え処理
  const handleAllDayDragStart = (e, schedule) => {
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
    <div className="bg-white rounded-lg shadow-lg p-3 h-full flex flex-col overflow-hidden">
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-gray-800">タイムライン</h2>
          <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
            {formattedDate}
          </span>
        </div>
        
        <button
          onClick={(e) => {
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
      
      {/* 終日予定エリア（並び替え可能） */}
      {allDaySchedules.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-gray-500 mb-2 px-2 flex items-center gap-2">
            <span>終日</span>
            <span className="text-xs text-gray-400">（ドラッグで並び替え可能）</span>
          </div>
          <div className="space-y-2">
            {allDaySchedules
              .sort((a, b) => (a.allDayOrder || 0) - (b.allDayOrder || 0))
              .map((s, index) => (
              <div 
                key={s.id}
                draggable={true}
                onDragStart={(e) => handleAllDayDragStart(e, s)}
                onDragEnd={handleAllDayDragEnd}
                onDragOver={(e) => handleAllDayDragOver(e, index)}
                onDragLeave={handleAllDayDragLeave}
                onDrop={(e) => handleAllDayDrop(e, index)}
                className={`
                  bg-amber-50 border-l-3 border-amber-400 px-3 py-2 rounded-r cursor-grab hover:bg-amber-100 transition-all duration-200
                  ${draggedAllDayId === s.id ? 'opacity-50 transform scale-95' : ''}
                  ${dragOverIndex === index && draggedAllDayId !== s.id ? 'transform translate-y-1 shadow-lg bg-amber-200' : ''}
                `}
                onClick={() => {
                  console.log('👆 All-day schedule clicked:', s.name);
                  onEdit(s);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  console.log('📝 All-day schedule double-clicked for edit:', s.name);
                  console.log('📝 onEdit function exists:', typeof onEdit === 'function');
                  onEdit(s);
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-amber-600 px-2 py-0.5 rounded bg-amber-200">終日</span>
                  <span className="font-medium text-gray-800">{s.name}</span>
                  <div className="ml-auto opacity-40 hover:opacity-80 transition-opacity">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                    </svg>
                  </div>
                </div>
                {s.memo && (
                  <div className="text-sm text-gray-600 mt-1 pl-8">
                    {s.memo}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-b border-gray-200 mt-4 mb-4"></div>
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
          <div className="flex-1 overflow-auto">
            <div className="text-xs font-medium text-gray-500 mb-3 px-2">時間指定</div>
            <ul className="space-y-3 pr-2">
              {sortedTimeSchedules.map(s => (
                <li 
                  key={s.id} 
                  className="border-l-4 border-blue-500 pl-4 flex flex-col gap-1 cursor-pointer hover:bg-blue-50 rounded-md transition p-2"
                  onClick={() => {
                    console.log('👆 Time schedule clicked:', s.name);
                    onEdit(s);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    console.log('📝 Time schedule double-clicked for edit:', s.name);
                    console.log('📝 onEdit function exists:', typeof onEdit === 'function');
                    onEdit(s);
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-blue-600 text-lg min-w-[4rem]">{s.time}</span>
                    <span className="font-bold text-gray-900">{s.name}</span>
                  </div>
                  {s.memo && (
                    <div className="text-gray-500 text-sm pl-2 border-l-2 border-gray-200 ml-1">
                      {s.memo}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default Timeline;
