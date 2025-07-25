
import React, { useState, useEffect } from 'react';

import Calendar from './components/Calendar';
import Timeline from './components/Timeline';
import ScheduleForm from './components/ScheduleForm';
import TitleBar from './components/TitleBar';

// サンプルデータ - 今日の日付に合わせて調整
const getTodayDateStr = () => {
  const today = new Date();
  return today.toISOString().split('T')[0];
};

const initialSchedules = [
  { id: 1, date: getTodayDateStr(), time: '09:00', name: '打ち合わせ', memo: 'ZoomリンクはSlack参照', allDay: false },
  { id: 2, date: getTodayDateStr(), time: '', name: '終日イベント', memo: '終日エリアに表示', allDay: true },
];

function App() {
  const [schedules, setSchedules] = useState(() => {
    // ローカルストレージから予定を読み込む
    const savedSchedules = localStorage.getItem('schedules');
    return savedSchedules ? JSON.parse(savedSchedules) : initialSchedules;
  });
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [showForm, setShowForm] = useState(false);
  
  // 分割比率の状態管理（デフォルト50%）
  const [splitRatio, setSplitRatio] = useState(() => {
    const savedRatio = localStorage.getItem('splitRatio');
    return savedRatio ? parseFloat(savedRatio) : 50;
  });
  const [isDragging, setIsDragging] = useState(false);

  // 予定が変更されたらローカルストレージに保存
  useEffect(() => {
    localStorage.setItem('schedules', JSON.stringify(schedules));
  }, [schedules]);
  
  // 分割比率が変更されたらローカルストレージに保存
  useEffect(() => {
    localStorage.setItem('splitRatio', splitRatio.toString());
  }, [splitRatio]);
  
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
  
  // グローバルマウスイベントの設定
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

  // 日付選択ハンドラー
  const handleDateClick = (date) => {
    setSelectedDate(date);
  };

  // 予定編集ハンドラー
  const handleEdit = (schedule) => {
    setEditingSchedule(schedule);
    setShowForm(true);
  };

  // 予定追加ハンドラー
  const handleAdd = () => {
    setEditingSchedule({
      date: selectedDate.toISOString().split('T')[0],
      time: '',
      name: '',
      memo: '',
      allDay: false
    });
    setShowForm(true);
  };

  // 予定保存ハンドラー
  const handleSave = (schedule) => {
    if (schedule.id) {
      setSchedules(schedules.map(s => s.id === schedule.id ? schedule : s));
    } else {
      setSchedules([...schedules, { ...schedule, id: Date.now() }]);
    }
    setShowForm(false);
  };

  // 予定削除ハンドラー
  const handleDelete = (id) => {
    setSchedules(schedules.filter(s => s.id !== id));
    setShowForm(false);
  };

  // フォーム閉じるハンドラー
  const handleClose = () => setShowForm(false);

  // 選択された日付の予定のみ表示
  const selectedDateStr = selectedDate ? selectedDate.toISOString().split('T')[0] : '';
  const filteredSchedules = schedules.filter(s => s.date === selectedDateStr);

  return (
    <div className="w-screen h-screen bg-gradient-to-br from-indigo-900 to-gray-900 text-gray-900 font-sans flex flex-col overflow-hidden">
      <TitleBar />
      <main 
        className="flex-1 p-2 overflow-hidden flex relative"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* カレンダー部分 */}
        <div 
          className="flex flex-col overflow-hidden pr-1"
          style={{ width: `${splitRatio}%` }}
        >
          <Calendar 
            schedules={schedules} 
            onDateClick={handleDateClick} 
            selectedDate={selectedDate}
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
          <Timeline 
            schedules={filteredSchedules} 
            selectedDate={selectedDate} 
            onEdit={handleEdit}
            onAdd={handleAdd}
          />
        </div>
      </main>
      
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <ScheduleForm 
              schedule={editingSchedule} 
              onSave={handleSave} 
              onClose={handleClose} 
              onDelete={editingSchedule?.id ? handleDelete : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
