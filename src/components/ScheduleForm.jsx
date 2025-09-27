import React, { useState, useEffect, useRef } from 'react';

const EMOJI_OPTIONS = [
  { value: '', label: 'なし', emoji: '' },
  // リマインド・ステータス
  { value: '✔️', label: 'チェックマーク', emoji: '✔️' },
  { value: '✖️', label: 'バツ', emoji: '✖️' },
  { value: '❗', label: '重要', emoji: '❗' },
  { value: '⚠️', label: '注意', emoji: '⚠️' },
  // 仕事・勉強
  { value: '💼', label: '仕事', emoji: '💼' },
  { value: '📚', label: '勉強', emoji: '📚' },
  { value: '📝', label: 'メモ', emoji: '📝' },
  { value: '📞', label: '電話', emoji: '📞' },
  { value: '💻', label: 'PC作業', emoji: '💻' },
  { value: '🤝', label: 'ミーティング', emoji: '🤝' },
  // お金・支払いステータス
  { value: '✅', label: '振込済み', emoji: '✅' },
  { value: '☑️', label: '支払い済み', emoji: '☑️' },
  { value: '🟢', label: '入金確認済み', emoji: '🟢' },
  // お金・支払い
  { value: '💰', label: '支払い', emoji: '💰' },
  { value: '💵', label: '現金', emoji: '💵' },
  { value: '💸', label: '支払い', emoji: '💸' },
  { value: '💳', label: 'カード', emoji: '💳' },
  { value: '🧾', label: '請求書', emoji: '🧾' },
  { value: '🏦', label: '銀行', emoji: '🏦' },
  // 運動・健康
  { value: '💪', label: '筋トレ', emoji: '💪' },
  { value: '🏋️', label: 'ウェイト', emoji: '🏋️' },
  { value: '🧘', label: 'ヨガ', emoji: '🧘' },
  { value: '🚴', label: 'サイクリング', emoji: '🚴' },
  { value: '🏃', label: 'ランニング', emoji: '🏃' },
  // イベント・趣味
  { value: '🎂', label: '誕生日', emoji: '🎂' },
  { value: '🎉', label: 'イベント', emoji: '🎉' },
  { value: '🎤', label: 'ライブ', emoji: '🎤' },
  { value: '🎬', label: '映画', emoji: '🎬' },
  { value: '🎮', label: 'ゲーム', emoji: '🎮' },
  // 外出・生活
  { value: '✈️', label: '旅行', emoji: '✈️' },
  { value: '🏖️', label: '休暇', emoji: '🏖️' },
  { value: '🏥', label: '病院', emoji: '🏥' },
  { value: '🛒', label: '買い物', emoji: '🛒' },
  { value: '🚗', label: 'ドライブ', emoji: '🚗' },  
];

const ScheduleForm = ({ schedule, onSave, onClose, onDelete, sendTestNotification }) => {
  const [formData, setFormData] = useState({
    id: null,
    name: '',
    date: '',
    time: '',
    memo: '',
    allDay: false,
    emoji: '',
    notifications: []
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // 予定名フィールドへの参照
  const nameInputRef = useRef(null);

  // 初期データを設定（新規作成時は空、編集時は既存データ）
  useEffect(() => {
    if (schedule) {
      setFormData({
        ...schedule,
        notifications: schedule.notifications || [] // 既存データに通知設定がない場合は空配列
      });
    } else {
      // 新規作成時、日付は今日の日付を初期値に
            const today = toDateStrLocal(new Date());
      setFormData({
        id: null,
        name: '',
        date: today,
        time: '',
        memo: '',
        allDay: true,  // 新規作成時は開始時間が空欄なので終日に設定
        emoji: '',
        notifications: []
      });
    }
  }, [schedule]);

  // フォーム表示時に予定名フィールドにフォーカスを当てる
  useEffect(() => {
    if (nameInputRef.current) {
      // 少し遅延を入れてフォーカスを当てる（モーダルのアニメーション完了後）
      const timer = setTimeout(() => {
        nameInputRef.current.focus();
        console.log('🎯 Focus set to schedule name input');
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [schedule]); // scheduleが変更されたときにフォーカスを再設定

  // モーダル表示中は背景のスクロールを防止
  useEffect(() => {
    // より強力なスクロール防止
    const preventAllScroll = (e) => {
      // モーダル内のスクロールは許可
      const isInModal = e.target.closest('.schedule-form-modal');
      if (!isInModal) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    // bodyのスクロールを無効化（CSS制御併用）
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    
    // 複数の方法でスクロールイベントを防止
    document.addEventListener('wheel', preventAllScroll, { passive: false, capture: true });
    document.addEventListener('touchmove', preventAllScroll, { passive: false, capture: true });
    
    return () => {
      // クリーンアップ
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
      document.removeEventListener('wheel', preventAllScroll, { capture: true });
      document.removeEventListener('touchmove', preventAllScroll, { capture: true });
    };
  }, []);

  // ESCキーで閉じる / 削除確認中なら確認を閉じる
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        // 削除確認表示中は確認を閉じるだけ
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
        } else if (onClose) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [showDeleteConfirm, onClose]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let newFormData = {
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    };

    // 開始時刻の変更に応じて終日フラグを自動設定
    if (name === 'time') {
      const wasAllDay = formData.allDay;
      const isNowAllDay = value === '';
      newFormData.allDay = isNowAllDay;
      
      // 終日予定になった場合、通知設定を調整
      if (!wasAllDay && isNowAllDay) {
        newFormData.notifications = formData.notifications.map(notification => {
          if (notification.unit === 'minutes' || notification.unit === 'hours') {
            return { ...notification, unit: 'days', value: 1 };
          }
          return notification;
        });
      }
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

  // 通知設定の管理関数
  const addNotification = () => {
    if (formData.notifications.length < 3) {
      setFormData({
        ...formData,
        notifications: [...formData.notifications, { value: 15, unit: 'minutes' }]
      });
    }
  };

  const removeNotification = (index) => {
    const newNotifications = formData.notifications.filter((_, i) => i !== index);
    setFormData({
      ...formData,
      notifications: newNotifications
    });
  };

  const updateNotification = (index, field, value) => {
    const newNotifications = [...formData.notifications];
    newNotifications[index] = { ...newNotifications[index], [field]: value };
    setFormData({
      ...formData,
      notifications: newNotifications
    });
  };

  // 通知時間が過ぎているかどうかを判定
  const isNotificationPast = (notification) => {
    if (!formData.date) return false;
    
    const now = new Date();
    const scheduleDate = new Date(formData.date);
    
    if (formData.allDay) {
      // 終日予定の場合、当日9:00に通知
      const notificationTime = new Date(scheduleDate);
      notificationTime.setHours(9, 0, 0, 0);
      
      // 日前の場合の計算
      if (notification.unit === 'days') {
        notificationTime.setDate(notificationTime.getDate() - notification.value);
      }
      
      return now > notificationTime;
    } else {
      // 時間指定予定の場合
      if (!formData.time) return false;
      
      const [hours, minutes] = formData.time.split(':').map(Number);
      const scheduleDateTime = new Date(scheduleDate);
      scheduleDateTime.setHours(hours, minutes, 0, 0);
      
      // 通知時間を計算
      const notificationTime = new Date(scheduleDateTime);
      
      switch (notification.unit) {
        case 'minutes':
          notificationTime.setMinutes(notificationTime.getMinutes() - notification.value);
          break;
        case 'hours':
          notificationTime.setHours(notificationTime.getHours() - notification.value);
          break;
        case 'days':
          notificationTime.setDate(notificationTime.getDate() - notification.value);
          break;
      }
      
      return now > notificationTime;
    }
  };

  // 終日予定の状態が変更された時に通知設定を調整
  const adjustNotificationsForAllDay = (isAllDay) => {
    if (isAllDay) {
      // 終日予定になった場合、分前・時間前を日前に変換
      const adjustedNotifications = formData.notifications.map(notification => {
        if (notification.unit === 'minutes' || notification.unit === 'hours') {
          return { ...notification, unit: 'days', value: 1 };
        }
        return notification;
      });
      setFormData({
        ...formData,
        notifications: adjustedNotifications
      });
    }
  };

  // 開始時刻のダブルクリック処理
  const handleTimeDoubleClick = () => {
    if (formData.time === '') {
      // 空の場合：現在時刻を設定
      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5); // HH:MM形式
      setFormData({
        ...formData,
        time: currentTime,
        allDay: false
      });
    } else {
      // 入力されている場合：クリア
      setFormData({
        ...formData,
        time: '',
        allDay: true
      });
    }
  };

  return (
    <div 
      className="schedule-form-modal flex flex-col h-full w-full"
      onWheel={(e) => {
        // モーダル内のスクロールのみ許可、外部への伝播を停止
        e.stopPropagation();
      }}
    >
      {/* ヘッダー部分（固定） */}
      <div className="flex justify-between items-center p-6 pb-4 border-b border-gray-200 flex-shrink-0">
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

      {/* スクロール可能なコンテンツ部分 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ minHeight: 0, maxHeight: 'calc(90vh - 160px)' }}>
        <form id="schedule-form" onSubmit={handleSubmit} className="p-6 pt-4 space-y-5">
        <div>
          <label className="block text-gray-700 font-medium mb-2">予定名</label>
          <input
            ref={nameInputRef}
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
            onDoubleClick={handleTimeDoubleClick}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition cursor-pointer"
            placeholder="空欄の場合は終日になります"
            title="ダブルクリック: 空欄→現在時刻入力 / 入力済み→クリア"
          />
          <div className="text-xs text-gray-500 mt-1">
            時間を入力しない場合は、自動的に終日予定になります<br/>
            <span className="text-blue-600">💡 ダブルクリックで現在時刻入力/クリア</span>
          </div>
        </div>
        
        <div>
          <label className="block text-gray-700 font-medium mb-2">絵文字</label>
          <div className="border border-gray-300 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 p-2 shadow-inner">
            <div 
              className="grid grid-cols-6 gap-1 overflow-y-auto emoji-scrollbar smooth-scroll" 
              style={{ 
                height: '72px', 
                maxHeight: '72px',
                scrollBehavior: 'smooth'
              }}
            >
              {EMOJI_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFormData({...formData, emoji: option.value})}
                  title={option.label}
                  className={`
                    w-8 h-8 rounded-md border transition-all duration-200 flex items-center justify-center text-lg hover:scale-110 flex-shrink-0
                    ${formData.emoji === option.value 
                      ? 'border-blue-500 bg-blue-100 shadow-md' 
                      : 'border-gray-200 hover:border-gray-300 bg-white hover:shadow-sm'
                    }
                  `}
                >
                  {option.emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        {/* 通知設定セクション */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-gray-700 font-medium">通知設定</label>
            {formData.notifications.length < 3 && (
              <button
                type="button"
                onClick={addNotification}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium hover:bg-blue-50 bg-white border border-blue-200 px-2 py-1 rounded transition-colors duration-200 notification-button"
              >
                + 追加
              </button>
            )}
          </div>
          
          <div className="text-xs text-gray-500 mb-3 p-2 bg-blue-50 rounded border border-blue-200">
            💡 <strong>通知タイミング：</strong><br/>
            • <strong>終日予定：</strong> 当日9:00に通知<br/>
            • <strong>時間指定予定：</strong> 設定時間の指定分/時間/日前に通知<br/>
            • <strong>1日前の場合：</strong> 終日予定なら前日9:00、時間指定なら同時刻の1日前
          </div>
          
          {formData.notifications.length === 0 ? (
            <div className="text-gray-500 text-sm italic border border-gray-200 rounded-lg p-3 bg-gray-50">
              通知は設定されていません
            </div>
          ) : (
            <div className="space-y-2">
              {formData.notifications.map((notification, index) => {
                const isPast = isNotificationPast(notification);
                return (
                  <div 
                    key={index} 
                    className={`flex items-center gap-2 p-2 border border-gray-200 rounded-lg transition-colors ${
                      isPast 
                        ? 'bg-gray-100 opacity-60' 
                        : 'bg-white'
                    }`}
                  >
                    <input
                      type="number"
                      min="0"
                      max="999"
                      value={notification.value}
                      onChange={(e) => updateNotification(index, 'value', parseInt(e.target.value) || 0)}
                      className={`w-16 text-center border border-gray-300 rounded px-2 py-1 text-sm notification-input focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        isPast 
                          ? 'bg-gray-100 text-gray-500' 
                          : 'bg-white'
                      }`}
                    />
                    <select
                      value={notification.unit}
                      onChange={(e) => updateNotification(index, 'unit', e.target.value)}
                      className={`border border-gray-300 rounded px-2 py-1 text-sm notification-select focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        isPast 
                          ? 'bg-gray-100 text-gray-500' 
                          : 'bg-white'
                      }`}
                    >
                      {!formData.allDay && <option value="minutes" className="bg-white">分前</option>}
                      {!formData.allDay && <option value="hours" className="bg-white">時間前</option>}
                      <option value="days" className="bg-white">日前</option>
                    </select>
                    <div className={`flex-grow text-sm ${
                      isPast 
                        ? 'text-gray-400' 
                        : 'text-gray-600'
                    } bg-transparent`}>
                      に通知{isPast ? ' (過去)' : ''}
                    </div>
                    {sendTestNotification && !isPast && (
                      <button
                        type="button"
                        onClick={() => sendTestNotification(formData, notification)}
                        className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 bg-white p-1 rounded transition-colors duration-200 text-xs px-2"
                        title="テスト通知"
                      >
                        📢
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeNotification(index)}
                      className={`p-1 rounded transition-colors duration-200 ${
                        isPast 
                          ? 'text-gray-300 hover:text-gray-400 hover:bg-gray-200 bg-gray-100' 
                          : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 bg-white'
                      }`}
                      title="削除"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        <div>
          <label className="block text-gray-700 font-medium mb-2">メモ</label>
          <div className="memo-container">
            <textarea
              name="memo"
              value={formData.memo}
              onChange={handleChange}
              onWheel={(e) => e.stopPropagation()}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 h-28 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition resize-none memo-textarea"
              placeholder="メモを入力してください（任意）"
            ></textarea>
          </div>
          <style dangerouslySetInnerHTML={{
            __html: `
              .memo-textarea::-webkit-scrollbar {
                width: 6px;
              }
              
              .memo-textarea::-webkit-scrollbar-track {
                background: transparent;
              }
              
              .memo-textarea::-webkit-scrollbar-thumb {
                background: #cbd5e1;
                border-radius: 3px;
                transition: background-color 0.2s ease;
              }
              
              .memo-textarea::-webkit-scrollbar-thumb:hover {
                background: #94a3b8;
              }
              
              .memo-textarea::-webkit-scrollbar-corner {
                background: transparent;
              }
            `
          }} />
        </div>
        </form>
      </div>

      {/* ボタン部分（固定） */}
      <div className="border-t border-gray-200 p-4 flex-shrink-0 bg-white">
        {showDeleteConfirm ? (
          <div className="bg-red-50 p-3 rounded-lg border border-red-200 mb-3">
            <p className="text-red-800 mb-3 font-medium text-sm">この予定を削除しますか？</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 bg-white border border-gray-300 text-gray-800 rounded text-sm hover:bg-gray-50 transition-colors duration-200"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors duration-200 shadow-sm"
              >
                削除する
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-center">
            {onDelete && formData.id ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-red-600 hover:text-red-800 font-medium hover:bg-red-50 bg-white border border-red-200 px-2.5 py-1.5 rounded text-sm transition-colors duration-200"
              >
                削除
              </button>
            ) : <div></div>}
            
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 border border-gray-300 text-gray-700 bg-white rounded text-sm hover:bg-gray-50 transition"
              >
                キャンセル
              </button>
              <button
                type="submit"
                form="schedule-form"
                className="px-4 py-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded text-sm hover:from-indigo-700 hover:to-blue-700 transition shadow-md"
              >
                保存
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScheduleForm;
