import { useEffect, useCallback, useRef } from 'react';
import { fromDateStrLocal } from '../utils/date';

// Web Notifications API の権限をリクエスト
const requestNotificationPermission = async () => {
  if (!('Notification' in window)) {
    console.warn('このブラウザは通知をサポートしていません');
    return false;
  }
  
  if (Notification.permission === 'granted') {
    return true;
  }
  
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  
  return false;
};

// 未使用（将来用）: workers（push）に一本化するため現状は呼ばない
const _requestNotificationPermission = requestNotificationPermission;

// 通知は workers（push）に一本化するため、クライアント側のローカル通知は送らない。
const _showWebNotification = () => {};

// 通知時間を計算する関数
const _calculateNotificationTime = (schedule, notification) => {
  const scheduleDate = fromDateStrLocal(schedule.date); // ローカル日の 00:00 基準
  
  if (schedule.allDay) {
    // 終日予定の場合、当日9:00に通知
    const notificationTime = new Date(scheduleDate);
    notificationTime.setHours(9, 0, 0, 0);
    
    // 日前の場合の計算
    if (notification.unit === 'days') {
      notificationTime.setDate(notificationTime.getDate() - notification.value);
    }
    
    return notificationTime;
  } else {
    // 時間指定予定の場合
    if (!schedule.time) return null;
    
    const [hours, minutes] = schedule.time.split(':').map(Number);
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
    
    return notificationTime;
  }
};

// 通知テキストを生成する関数
const _generateNotificationText = (schedule, notification) => {
  const unitText = {
    minutes: '分前',
    hours: '時間前',
    days: '日前'
  };
  
  const timeText = schedule.allDay 
    ? '終日予定' 
    : `${schedule.time}`;
  
  // 0分前の場合は「開始時刻」と表示
  let notificationTypeText;
  if (notification.value === 0 && notification.unit === 'minutes') {
    notificationTypeText = '開始時刻';
  } else {
    notificationTypeText = `${notification.value}${unitText[notification.unit]}`;
  }
  
  const title = schedule.name || '名称未設定の予定';
  const memoText = schedule.memo ? `\nメモ: ${schedule.memo}` : '';

  return {
    title,
    body: `${notificationTypeText}の通知\n${timeText}${memoText}`
  };
};

// 通知管理フック
export const useNotifications = (schedules) => {
  const notificationTimersRef = useRef(new Map());
  
  // Web版の通知タイマーをクリア
  const clearAllWebTimers = useCallback(() => {
    notificationTimersRef.current.forEach(timerId => clearTimeout(timerId));
    notificationTimersRef.current.clear();
  }, []);
  
  // workers（push）一本化のため、ローカル通知はスケジュールしない。
  const _scheduleWebNotification = useCallback(async () => {}, []);
  
  // 全ての通知をスケジュール
  const scheduleAllNotifications = useCallback(async () => {
    clearAllWebTimers();
  }, [clearAllWebTimers]);

  // 特定の予定の通知をキャンセル
  const cancelScheduleNotifications = useCallback(async (scheduleId) => {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (!schedule || !schedule.notifications) return;

    for (let i = 0; i < schedule.notifications.length; i++) {
      const notificationId = `${scheduleId}-${i}`;
      const timerId = notificationTimersRef.current.get(notificationId);
      if (timerId) {
        clearTimeout(timerId);
        notificationTimersRef.current.delete(notificationId);
      }
    }
  }, [schedules]);

  // テスト通知を送信
  const sendTestNotification = useCallback(async () => {
    alert('通知はworkers（push）から送信されます。テスト通知は未対応です。');
  }, []);

  // コンポーネントがアンマウントされたときにタイマーをクリア
  useEffect(() => {
    return () => {
      clearAllWebTimers();
    };
  }, [clearAllWebTimers]);

  // workers（push）一本化のため、ローカル通知の再スケジュールは行わない。

  return {
    scheduleAllNotifications,
    cancelScheduleNotifications,
    sendTestNotification
  };
};

export default useNotifications;
