
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
  
  // モバイル表示の状態管理
  const [isMobile, setIsMobile] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [mouseStart, setMouseStart] = useState(null);
  const [mouseEnd, setMouseEnd] = useState(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  
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
    setEditingSchedule(schedule);
    setShowForm(true);
  };

  // 予定コピー/移動ハンドラー
  const handleScheduleCopy = (schedule) => {
    setSchedules([...schedules, schedule]);
  };

  // 予定削除ハンドラー（ドラッグ&ドロップやAlt+右クリック用）
  const handleScheduleDelete = (id) => {
    setSchedules(schedules.filter(s => s.id !== id));
  };

  // 予定追加ハンドラー
  const handleAdd = () => {
    setEditingSchedule({
      date: selectedDate.toISOString().split('T')[0],
      time: '',
      name: '',
      memo: '',
      allDay: true  // 新規作成時は開始時間が空欄なので終日に設定
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
                isMobile={isMobile}
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
                    <div className="flex-1 overflow-hidden">
                      <Timeline 
                        schedules={filteredSchedules} 
                        selectedDate={selectedDate} 
                        onEdit={handleEdit}
                        onAdd={handleAdd}
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
                isMobile={isMobile}
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
          </>
        )}
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
