import React, { useState, useEffect } from 'react';

const ScheduleForm = ({ schedule, onSave, onClose, onDelete }) => {
  const [formData, setFormData] = useState({
    id: null,
    name: '',
    date: '',
    time: '',
    memo: '',
    allDay: false
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 初期データを設定（新規作成時は空、編集時は既存データ）
  useEffect(() => {
    if (schedule) {
      setFormData(schedule);
    } else {
      // 新規作成時、日付は今日の日付を初期値に
      const today = new Date().toISOString().slice(0, 10);
      setFormData({
        id: null,
        name: '',
        date: today,
        time: '',
        memo: '',
        allDay: false
      });
    }
  }, [schedule]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let newFormData = {
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    };

    // 開始時刻の変更に応じて終日フラグを自動設定
    if (name === 'time') {
      newFormData.allDay = value === '';
    }

    setFormData(newFormData);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleDelete = () => {
    if (onDelete && formData.id) {
      onDelete(formData.id);
    }
  };

  return (
    <div className="p-6 w-full max-w-md">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          {formData.id ? '予定を編集' : '新規予定登録'}
        </h2>
        <button 
          onClick={onClose}
          className="text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100 bg-white border border-gray-200 transition-colors duration-200"
          aria-label="閉じる"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-gray-700 font-medium mb-2">予定名</label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
            required
            placeholder="予定名を入力してください"
          />
        </div>
        
        <div>
          <label className="block text-gray-700 font-medium mb-2">日付</label>
          <input
            type="date"
            name="date"
            value={formData.date}
            onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
            required
          />
        </div>
        
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-gray-700 font-medium">開始時間</label>
            <span className={`text-xs px-2 py-1 rounded-full ${formData.allDay ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
              {formData.allDay ? '終日' : '時間指定'}
            </span>
          </div>
          <input
            type="time"
            name="time"
            value={formData.time}
            onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
            placeholder="空欄の場合は終日になります"
          />
          <div className="text-xs text-gray-500 mt-1">
            時間を入力しない場合は、自動的に終日予定になります
          </div>
        </div>
        
        <div>
          <label className="block text-gray-700 font-medium mb-2">メモ</label>
          <textarea
            name="memo"
            value={formData.memo}
            onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 h-28 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition resize-none"
            placeholder="メモを入力してください（任意）"
          ></textarea>
        </div>

        {showDeleteConfirm ? (
          <div className="bg-red-50 p-4 rounded-lg border border-red-200 mt-4">
            <p className="text-red-800 mb-3 font-medium">この予定を削除しますか？</p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 transition-colors duration-200"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors duration-200 shadow-sm"
              >
                削除する
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-center pt-4 border-t border-gray-200">
            {onDelete && formData.id ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-red-600 hover:text-red-800 font-medium hover:bg-red-50 bg-white border border-red-200 px-3 py-2 rounded-lg transition-colors duration-200"
              >
                削除
              </button>
            ) : <div></div>}
            
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-50 transition"
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-lg hover:from-indigo-700 hover:to-blue-700 transition shadow-md"
              >
                保存
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};

export default ScheduleForm;
