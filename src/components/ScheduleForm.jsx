import React, { useState, useEffect, useRef } from 'react';
import { toDateStrLocal } from '../utils/date';

const EMOJI_OPTIONS = [
{ value: '', label: '-', emoji: '' },
  // 仕事
{ value: '💼', label: '仕事', emoji: '💼' },
{ value: '🤝', label: '対面会議', emoji: '🤝' },
{ value: '💻', label: 'オンライン会議', emoji: '💻' },
{ value: '📚', label: 'セミナー', emoji: '📚' },
{ value: '🧳', label: '出張先で仕事', emoji: '🧳' },
{ value: '🛫', label: '移動（飛行機）', emoji: '🛫' },
{ value: '🚅', label: '移動（新幹線）', emoji: '🚅' },
{ value: '🚃', label: '移動（電車）', emoji: '🚃' },
{ value: '🚕', label: '移動（車）', emoji: '🚕' },
{ value: '🏨', label: '宿泊', emoji: '🏨' },
// タスク
{ value: '🏁', label: 'スタート', emoji: '🏁' },
{ value: '🏆', label: 'ゴール', emoji: '🏆' },
{ value: '🚩', label: 'チェック', emoji: '🚩' },
// 連絡
{ value: '📞', label: '電話', emoji: '📞' },
{ value: '✉️', label: 'メール', emoji: '✉️' },
{ value: '💬', label: 'チャット', emoji: '💬' },

// プライベート
{ value: '🚶', label: '外出', emoji: '🚶' },
{ value: '🍽️', label: '食事', emoji: '🍽️' },
{ value: '🎂', label: '誕生日', emoji: '🎂' },
{ value: '🎉', label: 'パーティ', emoji: '🎉' },
{ value: '🏖️', label: '休暇', emoji: '🏖️' },
{ value: '🏡', label: 'ホーム', emoji: '🏡' },
{ value: '📦', label: '荷物受け取り', emoji: '📦'},
];

const MAX_NOTIFICATIONS = 3;

const createInitialFormData = (schedule) => {
  const now = new Date();
  const isStandaloneTask = schedule?.isStandaloneTask ?? false;
  const base = {
    id: schedule?.id ?? null,
    name: schedule?.name ?? '',
    date: schedule?.date ?? (isStandaloneTask ? '' : toDateStrLocal(now)),
    time: isStandaloneTask ? '' : schedule?.time ?? '',
    memo: schedule?.memo ?? '',
    emoji: schedule?.emoji ?? '',
    allDay: isStandaloneTask ? true : schedule?.allDay ?? !(schedule?.time),
    notifications: schedule?.notifications ? schedule.notifications.map((n) => ({ ...n })) : [],
    isTask: schedule?.isTask ?? false,
    completed: schedule?.completed ?? false,
    isStandaloneTask,
    source: schedule?.source ?? (isStandaloneTask ? 'standaloneTask' : 'schedule'),
  };

  if (!base.time) {
    base.allDay = true;
  }

  return base;
};

const ScheduleForm = ({ schedule, onSave, onClose, onDelete, sendTestNotification }) => {
  const [formData, setFormData] = useState(() => createInitialFormData(schedule));
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formError, setFormError] = useState(null);
  const nameInputRef = useRef(null);
  const isStandaloneTaskMode = formData.isTask && formData.isStandaloneTask;

  useEffect(() => {
    setFormData(createInitialFormData(schedule));
    setShowDeleteConfirm(false);
    setIsSaving(false);
    setIsDeleting(false);
    setFormError(null);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!onSave || isSaving || isDeleting) return;

    setFormError(null);
    setIsSaving(true);
    try {
      await onSave(formData);
    } catch (error) {
      console.error('❌ Failed to save schedule:', error);
      setFormError(error?.message || '予定の保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || !formData.id || isDeleting || isSaving) return;

    setFormError(null);
    setIsDeleting(true);
    try {
      await onDelete(formData.id);
    } catch (error) {
      console.error('❌ Failed to delete schedule:', error);
      setFormError(error?.message || '予定の削除に失敗しました。');
      setIsDeleting(false);
      return;
    }
    setIsDeleting(false);
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

  const handleDateDoubleClick = () => {
    if (!isStandaloneTaskMode) return;
    setFormData((prev) => ({
      ...prev,
      date: prev.date ? '' : toDateStrLocal(new Date()),
    }));
  };

  const modalTitle = formData.id
    ? formData.isStandaloneTask
      ? 'タスクを編集'
      : '予定を編集'
    : formData.isStandaloneTask
      ? '新規タスク登録'
      : '新規予定登録';

  const nameLabel = formData.isStandaloneTask ? 'タスク名' : '予定名';

  return (
    <div
      className="schedule-form-modal flex flex-col h-full w-full"
      onWheel={(e) => {
        e.stopPropagation();
      }}
    >
      <div className="flex justify-between items-center p-6 pb-4 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-2xl font-bold text-gray-800">{modalTitle}</h2>
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
            {!formData.isStandaloneTask && (
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-1 shadow-inner">
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    aria-pressed={!formData.isTask}
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        isTask: false,
                        completed: false,
                        isStandaloneTask: false,
                      }))
                    }
                    className={`tab-toggle-button ${!formData.isTask ? 'is-active' : ''}`}
                    title="予定モード"
                  >
                    <span>予定</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={formData.isTask}
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        isTask: true,
                        emoji: '',
                        completed: prev.completed || false,
                        isStandaloneTask: schedule?.isStandaloneTask ?? prev.isStandaloneTask ?? true,
                      }))
                    }
                    className={`tab-toggle-button ${formData.isTask ? 'is-active' : ''}`}
                    title="タスクモード"
                  >
                    <span>タスク</span>
                  </button>
                </div>
              </div>
            )}

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
                  className={`inline-flex size-7 flex-shrink-0 items-center justify-center rounded-lg border p-0 text-[12px] leading-none transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
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
            <label className="block text-gray-700 font-medium mb-2">{nameLabel}</label>
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
            <label className="block text-gray-700 font-medium mb-2">{isStandaloneTaskMode ? '納期' : '日付'}</label>
            <input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleChange}
              onDoubleClick={isStandaloneTaskMode ? handleDateDoubleClick : undefined}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
              required={!isStandaloneTaskMode}
            />
            {isStandaloneTaskMode && (
              <p className="mt-1 text-xs text-gray-500">
                ダブルクリックで今日の日付を入力／クリアできます。
              </p>
            )}
          </div>

          {!isStandaloneTaskMode && (
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
          )}

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
                      onMouseDown={(e) => {
                        // マウスクリック時にフォーカスが当たって黒枠が出ないようにする
                        e.preventDefault();
                      }}
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          emoji: option.value
                        }))
                      }
                      title={option.label}
                      className={`
                        w-8 h-8 rounded-md border transition-all duration-200 flex items-center justify-center text-lg hover:scale-110 flex-shrink-0 outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0
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
                  .tab-toggle-button {
                    position: relative;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 0.35rem;
                    padding: 0.55rem 1rem;
                    border-radius: 0.9rem;
                    font-weight: 600;
                    font-size: 0.85rem;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: #4b5563;
                    background: #f9fafb;
                    cursor: pointer;
                    user-select: none;
                    transition: color 0.15s ease, box-shadow 0.2s ease, background-color 0.2s ease;
                    overflow: hidden;
                  }
                  .tab-toggle-button::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    background: linear-gradient(90deg, #6366f1, #3b82f6);
                    opacity: 0;
                    transition: opacity 0.2s ease;
                    z-index: 0;
                  }
                  .tab-toggle-button > span {
                    position: relative;
                    z-index: 1;
                  }
                  .tab-toggle-button.is-active {
                    color: #ffffff;
                    box-shadow: 0 12px 28px -16px rgba(79, 70, 229, 0.65);
                  }
                  .tab-toggle-button.is-active::before {
                    opacity: 1;
                  }
                  .tab-toggle-button:not(.is-active):hover {
                    color: #4338ca;
                    background: #e0e7ff;
                  }
                  .tab-toggle-button:focus {
                    outline: none;
                  }
                  .tab-toggle-button:focus-visible {
                    outline: none;
                    box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.45);
                  }
                `
              }}
            />
          </div>
        </form>
      </div>

      <div className="border-t border-gray-200 p-4 flex-shrink-0 bg-white">
        {formError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">
            {formError}
          </div>
        )}
        {showDeleteConfirm ? (
          <div className="bg-red-50 p-3 rounded-lg border border-red-200 mb-3">
            <p className="text-red-800 mb-3 font-medium text-sm">この予定を削除しますか？</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className={`px-3 py-1.5 bg-white border border-gray-300 text-gray-800 rounded text-sm transition-colors duration-200 ${isDeleting ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-50'}`}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className={`px-3 py-1.5 rounded text-sm text-white transition-colors duration-200 shadow-sm ${isDeleting ? 'bg-red-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {isDeleting ? '削除中…' : '削除する'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-center">
            {onDelete && formData.id ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isSaving || isDeleting}
                className={`text-red-600 font-medium bg-white border border-red-200 px-2.5 py-1.5 rounded text-sm transition-colors duration-200 ${isSaving || isDeleting ? 'opacity-60 cursor-not-allowed' : 'hover:text-red-800 hover:bg-red-50'}`}
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
                disabled={isSaving || isDeleting}
                className={`px-3 py-1.5 border border-gray-300 text-gray-700 bg-white rounded text-sm transition ${isSaving || isDeleting ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-50'}`}
              >
                キャンセル
              </button>
              <button
                type="submit"
                form="schedule-form"
                disabled={isSaving || isDeleting}
                className={`px-4 py-1.5 text-white rounded text-sm transition shadow-md bg-gradient-to-r from-indigo-600 to-blue-600 ${isSaving || isDeleting ? 'opacity-60 cursor-not-allowed' : 'hover:from-indigo-700 hover:to-blue-700'}`}
              >
                {isSaving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScheduleForm;
