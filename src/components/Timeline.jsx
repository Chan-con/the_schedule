import React from 'react';

const Timeline = ({ schedules, selectedDate, onEdit, onAdd }) => {
  // 終日予定と時間指定予定を分ける
  const allDaySchedules = schedules.filter(s => s.allDay);
  const timeSchedules = schedules.filter(s => !s.allDay);
  
  // 時間指定予定を時間順にソート
  const sortedTimeSchedules = [...timeSchedules].sort((a, b) => {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  });

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
          onClick={onAdd}
          className="flex items-center justify-center w-8 h-8 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full shadow-lg hover:from-blue-700 hover:to-indigo-700 hover:shadow-xl transition-all duration-200 transform hover:scale-105 border-2 border-white font-bold text-sm"
          title="予定を追加"
        >
          +
        </button>
      </div>
      
      {/* 終日予定エリア（控えめに表示） */}
      {allDaySchedules.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-gray-500 mb-2 px-2">終日</div>
          <div className="space-y-2">
            {allDaySchedules.map(s => (
              <div 
                key={s.id} 
                className="bg-amber-50 border-l-3 border-amber-400 px-3 py-2 rounded-r cursor-pointer hover:bg-amber-100 transition"
                onClick={() => onEdit(s)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-amber-600 px-2 py-0.5 rounded bg-amber-200">終日</span>
                  <span className="font-medium text-gray-800">{s.name}</span>
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
                  onClick={() => onEdit(s)}
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
