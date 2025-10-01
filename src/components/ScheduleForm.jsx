import React, { useState, useEffect, useRef } from 'react';
import { toDateStrLocal } from '../utils/date';

const EMOJI_OPTIONS = [
  { value: '', label: 'なし', emoji: '' },
  { value: '✔️', label: 'チェックマーク', emoji: '✔️' },
  { value: '✖️', label: 'バツ', emoji: '✖️' },
  { value: '🟡', label: '進行中', emoji: '🟡' },
  { value: '🟢', label: '確認済み', emoji: '🟢' },
  { value: '🔴', label: '未対応', emoji: '🔴' },
  { value: '⚠️', label: '注意', emoji: '⚠️' },
  { value: '🚩', label: 'フラグ', emoji: '🚩' },
  { value: '🎯', label: 'ターゲット', emoji: '🎯' },
  { value: '💼', label: '仕事', emoji: '💼' },
  { value: '📚', label: '勉強', emoji: '📚' },
  { value: '📝', label: 'メモ', emoji: '📝' },
  { value: '📞', label: '電話', emoji: '📞' },
  { value: '💻', label: 'PC作業', emoji: '💻' },
  { value: '🤝', label: 'ミーティング', emoji: '🤝' },
  { value: '✅', label: '振込済み', emoji: '✅' },
  { value: '☑️', label: '支払い済み', emoji: '☑️' },
  { value: '💰', label: '支払い', emoji: '💰' },
  { value: '💸', label: '支払い予定', emoji: '💸' },
  { value: '💳', label: 'カード', emoji: '💳' },
  { value: '🧾', label: '請求書', emoji: '🧾' },
  { value: '🎉', label: 'イベント', emoji: '🎉' },
  { value: '🎂', label: '誕生日', emoji: '🎂' },
  { value: '🍽️', label: '食事', emoji: '🍽️' },
  { value: '✈️', label: '旅行', emoji: '✈️' },
  { value: '🏥', label: '通院', emoji: '🏥' },
  { value: '🏠', label: '家の用事', emoji: '🏠' },
  { value: '🛒', label: '買い物', emoji: '🛒' }
];

const MAX_NOTIFICATIONS = 3;

const createInitialFormData = (schedule) => {
  const now = new Date();
  const base = {
    id: schedule?.id ?? null,
    name: schedule?.name ?? '',
    date: schedule?.date ?? toDateStrLocal(now),
    time: schedule?.time ?? '',
    memo: schedule?.memo ?? '',
    emoji: schedule?.emoji ?? '',
    allDay: schedule?.allDay ?? !(schedule?.time),
    notifications: schedule?.notifications ? schedule.notifications.map((n) => ({ ...n })) : [],
    isTask: schedule?.isTask ?? false,
    completed: schedule?.completed ?? false
  };

  if (!base.time) {
    base.allDay = true;
  }

  return base;
};

const ScheduleForm = ({ schedule, onSave, onClose, onDelete, sendTestNotification }) => {
  const [formData, setFormData] = useState(() => createInitialFormData(schedule));
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const nameInputRef = useRef(null);

  useEffect(() => {
    setFormData(createInitialFormData(schedule));
    setShowDeleteConfirm(false);
  }, [schedule]);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();

      if (showDeleteConfirm) {
        setShowDeleteConfirm(false);
        return;
      }

      if (onClose) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, showDeleteConfirm]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (name === 'time') {
      setFormData((prev) => {
        const wasAllDay = prev.allDay;
        const isNowAllDay = value === '';
        const next = {
          ...prev,
          time: value,
          allDay: isNowAllDay
        };

        if (!wasAllDay && isNowAllDay) {
          next.notifications = prev.notifications.map((notification) => {
            if (notification.unit === 'minutes' || notification.unit === 'hours') {
              return { ...notification, unit: 'days', value: 1 };
            }
            return notification;
          });
        }

        return next;
      });
      return;
    }

    if (type === 'checkbox') {
      setFormData((prev) => ({ ...prev, [name]: checked }));
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
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

  const addNotification = () => {
    setFormData((prev) => {
      if (prev.notifications.length >= MAX_NOTIFICATIONS) {
        return prev;
      }

      const defaultNotification = prev.allDay
        ? { value: 1, unit: 'days' }
        : { value: 15, unit: 'minutes' };

      return {
        ...prev,
        notifications: [...prev.notifications, defaultNotification]
      };
    });
  };

  const removeNotification = (index) => {
    setFormData((prev) => ({
      ...prev,
      notifications: prev.notifications.filter((_, i) => i !== index)
    }));
  };

  const updateNotification = (index, field, value) => {
    setFormData((prev) => {
      const notifications = prev.notifications.map((notification, i) => {
        if (i !== index) return notification;
        return {
          ...notification,
          [field]: field === 'value' ? Math.max(0, value || 0) : value
        };
      });

      return {
        ...prev,
        notifications
      };
    });
  };

  const isNotificationPast = (notification) => {
    if (!formData.date) return false;

    const now = new Date();
    const [year, month, day] = formData.date.split('-').map(Number);
    const scheduleDate = new Date(year, (month || 1) - 1, day || 1);

    if (formData.allDay) {
      const notificationTime = new Date(scheduleDate);
      notificationTime.setHours(9, 0, 0, 0);

      if (notification.unit === 'days') {
        notificationTime.setDate(notificationTime.getDate() - notification.value);
      }

      return now > notificationTime;
    }

    if (!formData.time) return false;

    const [hours, minutes] = formData.time.split(':').map(Number);
    const scheduleDateTime = new Date(scheduleDate);
    scheduleDateTime.setHours(hours || 0, minutes || 0, 0, 0);

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
      default:
        break;
    }

    return now > notificationTime;
  };

  const handleTimeDoubleClick = () => {
    if (formData.time === '') {
      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5);
      setFormData((prev) => ({
        ...prev,
        time: currentTime,
        allDay: false
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        time: '',
        allDay: true
      }));
    }
  };

  return (
    <div
      className="schedule-form-modal flex flex-col h-full w-full"
      onWheel={(e) => {
        e.stopPropagation();
      }}
    >
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

      <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ minHeight: 0, maxHeight: 'calc(90vh - 160px)' }}>
        <form id="schedule-form" onSubmit={handleSubmit} className="p-6 pt-4 space-y-5">
          <div className="space-y-3">
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-1 shadow-inner">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  aria-pressed={!formData.isTask}
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      isTask: false,
                      completed: false
                    }))
                  }
                  className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                    !formData.isTask
                      ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-200'
                      : 'bg-white text-gray-600 hover:text-indigo-600 hover:bg-indigo-50'
                  }`}
                  title="予定モード"
                >
                  <span className="text-xs font-bold uppercase tracking-wide">予定</span>
                </button>
                <button
                  type="button"
                  aria-pressed={formData.isTask}
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      isTask: true,
                      emoji: '',
                      completed: prev.completed || false
                    }))
                  }
                  className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                    formData.isTask
                      ? 'bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-md shadow-indigo-200'
                      : 'bg-white text-gray-600 hover:text-indigo-600 hover:bg-indigo-50'
                  }`}
                  title="タスクモード"
                >
                  <span className="text-xs font-bold uppercase tracking-wide">タスク</span>
                </button>
              </div>
            </div>

            {formData.isTask && (
              <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm">
                <button
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      completed: !prev.completed,
                      isTask: true
                    }))
                  }
                  className={`inline-flex w-7 aspect-square items-center justify-center rounded-md border transition-colors duration-200 text-[12px] leading-none ${
                    formData.completed
                      ? 'bg-green-500 border-green-600 text-white'
                      : 'bg-white border-gray-300 text-transparent hover:bg-gray-50'
                  }`}
                  title={formData.completed ? '完了済み' : '未完了'}
                  aria-pressed={formData.completed}
                >
                  ✓
                </button>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-700">タスクのチェック</span>
                  <span className="text-xs text-gray-500">チェック済みのタスクはカレンダーで薄く表示されます</span>
                </div>
              </div>
            )}
          </div>

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
              時間を入力しない場合は、自動的に終日予定になります
              <br />
              <span className="text-blue-600">💡 ダブルクリックで現在時刻入力/クリア</span>
            </div>
          </div>

          {!formData.isTask && (
            <div>
              <label className="block text-gray-700 font-medium mb-2">絵文字</label>
              <div className="border border-gray-300 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 p-2 shadow-inner">
                <div
                  className="grid grid-cols-6 gap-1 overflow-y-auto emoji-scrollbar smooth-scroll"
                  style={{
                    height: '112px',
                    maxHeight: '112px',
                    scrollBehavior: 'smooth'
                  }}
                >
                  {EMOJI_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          emoji: option.value
                        }))
                      }
                      title={option.label}
                      className={`
                        w-8 h-8 rounded-md border transition-all duration-200 flex items-center justify-center text-lg hover:scale-110 flex-shrink-0
                        ${
                          formData.emoji === option.value
                            ? 'border-blue-500 bg-blue-100 shadow-md'
                            : 'border-gray-200 hover:border-gray-300 bg-white hover:shadow-sm'
                        }
                      `}
                    >
                      {option.emoji || '－'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-gray-700 font-medium">通知設定</label>
              {formData.notifications.length < MAX_NOTIFICATIONS && (
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
              💡 <strong>通知タイミング：</strong>
              <br />• <strong>終日予定：</strong> 当日9:00に通知
              <br />• <strong>時間指定予定：</strong> 設定時間の指定分/時間/日前に通知
              <br />• <strong>1日前の場合：</strong> 終日予定なら前日9:00、時間指定なら同時刻の1日前
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
                        isPast ? 'bg-gray-100 opacity-60' : 'bg-white'
                      }`}
                    >
                      <input
                        type="number"
                        min="0"
                        max="999"
                        value={notification.value}
                        onChange={(e) =>
                          updateNotification(index, 'value', parseInt(e.target.value, 10) || 0)
                        }
                        className={`w-16 text-center border border-gray-300 rounded px-2 py-1 text-sm notification-input focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          isPast ? 'bg-gray-100 text-gray-500' : 'bg-white'
                        }`}
                      />
                      <select
                        value={notification.unit}
                        onChange={(e) => updateNotification(index, 'unit', e.target.value)}
                        className={`border border-gray-300 rounded px-2 py-1 text-sm notification-select focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          isPast ? 'bg-gray-100 text-gray-500' : 'bg-white'
                        }`}
                      >
                        {!formData.allDay && <option value="minutes" className="bg-white">分前</option>}
                        {!formData.allDay && <option value="hours" className="bg-white">時間前</option>}
                        <option value="days" className="bg-white">日前</option>
                      </select>
                      <div
                        className={`flex-grow text-sm ${
                          isPast ? 'text-gray-400' : 'text-gray-600'
                        } bg-transparent`}
                      >
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
            <style
              dangerouslySetInnerHTML={{
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
              }}
            />
          </div>
        </form>
      </div>

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
            ) : (
              <div></div>
            )}

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
