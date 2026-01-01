import React, { useState, useEffect, useRef } from 'react';
import { toDateStrLocal } from '../utils/date';

const MAX_NOTIFICATIONS = 3;

const createInitialFormData = (schedule) => {
  const now = new Date();
  const isTaskEntry = schedule?.isTask ?? false;
  const base = {
    id: schedule?.id ?? null,
    name: schedule?.name ?? '',
    date: schedule?.date ?? toDateStrLocal(now),
    time: schedule?.time ?? '',
  memo: schedule?.memo ?? '',
    allDay: schedule?.allDay ?? !(schedule?.time),
    notifications: schedule?.notifications ? schedule.notifications.map((n) => ({ ...n })) : [],
    isTask: isTaskEntry,
    completed: schedule?.completed ?? false,
    source: schedule?.source ?? (isTaskEntry ? 'scheduleTask' : 'schedule'),
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
  const isTaskMode = !!formData.isTask;

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
              return { ...notification, unit: 'days', value: 0 };
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
      const normalizedFormData = {
        ...formData,
        notifications: (formData.notifications || []).map((notification) => ({
          ...notification,
          value: Number(notification.value) || 0
        }))
      };

      await onSave(normalizedFormData);
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
        ? { value: 0, unit: 'days' }
        : { value: 0, unit: 'hours' };

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

        if (field === 'value') {
          if (value === '') {
            return { ...notification, value: '' };
          }

          const numericValue = Number(value);
          return {
            ...notification,
            value: Math.max(0, Number.isFinite(numericValue) ? numericValue : 0)
          };
        }

        return { ...notification, [field]: value };
      });

      return {
        ...prev,
        notifications
      };
    });
  };

  const isNotificationPast = (notification) => {
    if (!formData.date) return false;

    const notificationValue = Number(notification?.value) || 0;

    const now = new Date();
    const [year, month, day] = formData.date.split('-').map(Number);
    const scheduleDate = new Date(year, (month || 1) - 1, day || 1);

    if (formData.allDay) {
      const notificationTime = new Date(scheduleDate);
      notificationTime.setHours(9, 0, 0, 0);

      if (notification.unit === 'days') {
        notificationTime.setDate(notificationTime.getDate() - notificationValue);
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
        notificationTime.setMinutes(notificationTime.getMinutes() - notificationValue);
        break;
      case 'hours':
        notificationTime.setHours(notificationTime.getHours() - notificationValue);
        break;
      case 'days':
        notificationTime.setDate(notificationTime.getDate() - notificationValue);
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

  const modalTitle = formData.id
    ? isTaskMode
      ? 'タスクを編集'
      : '予定を編集'
    : isTaskMode
      ? '新規タスク登録'
      : '新規予定登録';

  const nameLabel = isTaskMode ? 'タスク名' : '予定名';

  return (
    <div
      className="schedule-form-modal flex min-h-0 w-full min-w-0 flex-col"
      onWheel={(e) => {
        e.stopPropagation();
      }}
    >
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-4 pb-3 sm:p-6 sm:pb-4">
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

      <div className="custom-scrollbar flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
        <form id="schedule-form" onSubmit={handleSubmit} className="max-w-full min-w-0 space-y-5 p-4 pt-3 sm:p-6 sm:pt-4">
          <div className="space-y-3">
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-1 shadow-inner">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  aria-pressed={!isTaskMode}
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      isTask: false,
                      completed: false,
                      source: 'schedule',
                      date: prev.date || toDateStrLocal(new Date()),
                    }))
                  }
                  className={`tab-toggle-button ${!isTaskMode ? 'is-active' : ''}`}
                  title="予定モード"
                >
                  <span>予定</span>
                </button>
                <button
                  type="button"
                  aria-pressed={isTaskMode}
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      isTask: true,
                      source: 'scheduleTask',
                      date: prev.date || toDateStrLocal(new Date()),
                    }))
                  }
                  className={`tab-toggle-button ${isTaskMode ? 'is-active' : ''}`}
                  title="タスクモード"
                >
                  <span>タスク</span>
                </button>
              </div>
            </div>

            {isTaskMode && (
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
            <label className="block text-gray-700 font-medium mb-2">日付</label>
            <input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleChange}
              className="w-full min-w-0 max-w-full border border-gray-300 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
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
              className="w-full min-w-0 max-w-full border border-gray-300 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition cursor-pointer"
              placeholder="空欄の場合は終日になります"
              title="ダブルクリック: 空欄→現在時刻入力 / 入力済み→クリア"
            />
            <div className="text-xs text-gray-500 mt-1">
              時間を入力しない場合は、自動的に終日扱いになります
              <br />
              <span
                className="text-blue-600"
                role="button"
                tabIndex={0}
                onClick={handleTimeDoubleClick}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  handleTimeDoubleClick();
                }}
                title="タップ(モバイル) / ダブルクリック(PC)で現在時刻入力/クリア"
              >
                💡 タップで現在時刻入力/クリア
              </span>
            </div>
          </div>

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
                        onChange={(e) => updateNotification(index, 'value', e.target.value)}
                        onFocus={() => {
                          if ((Number(notification.value) || 0) === 0) {
                            updateNotification(index, 'value', '');
                          }
                        }}
                        onBlur={() => {
                          if (notification.value === '') {
                            updateNotification(index, 'value', 0);
                          }
                        }}
                        className={`w-16 flex-shrink-0 text-center border border-gray-300 rounded px-2 py-1 text-sm notification-input focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          isPast ? 'bg-gray-100 text-gray-500' : 'bg-white'
                        }`}
                      />
                      <select
                        value={notification.unit}
                        onChange={(e) => updateNotification(index, 'unit', e.target.value)}
                        className={`w-20 flex-shrink-0 border border-gray-300 rounded px-2 py-1 text-sm notification-select focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          isPast ? 'bg-gray-100 text-gray-500' : 'bg-white'
                        }`}
                      >
                        {!formData.allDay && <option value="minutes" className="bg-white">分前</option>}
                        {!formData.allDay && <option value="hours" className="bg-white">時間前</option>}
                        <option value="days" className="bg-white">日前</option>
                      </select>
                      <div
                        className={`min-w-0 flex-1 text-sm ${
                          isPast ? 'text-gray-400' : 'text-gray-600'
                        } bg-transparent`}
                      >
                        に通知{isPast ? ' (過去)' : ''}
                      </div>
                      <div className="ml-auto flex flex-shrink-0 items-center gap-1">
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

      <div className="flex-shrink-0 border-t border-gray-200 bg-white p-3 sm:p-4">
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
