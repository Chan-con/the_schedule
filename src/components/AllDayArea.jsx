import React from 'react';

const AllDayArea = ({ schedules }) => {
  const allDaySchedules = schedules.filter(s => s.allDay);
  
  return (
    <div className="bg-white rounded-lg shadow-lg p-6 w-full">
      <h3 className="text-lg font-semibold text-gray-700 mb-4 border-b pb-2">終日エリア</h3>
      {allDaySchedules.length === 0 ? (
        <div className="text-gray-400 text-center py-2 text-sm">終日予定はありません</div>
      ) : (
        <div className="card-stack">
          {allDaySchedules.map(s => (
            <div 
              key={s.id} 
              className="flex items-start bg-blue-50 border-l-4 border-blue-500 p-2 rounded"
            >
              <div className="flex-1">
                <div className="font-semibold text-gray-800">{s.name}</div>
                {s.memo && <div className="text-sm text-gray-600 mt-1">{s.memo}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AllDayArea;
