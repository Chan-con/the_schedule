import { useEffect, useCallback, useRef } from 'react';
import { fromDateStrLocal } from '../utils/date';
import { setDateHash } from '../utils/noteShare';

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

// Web通知を表示
const showWebNotification = (title, body, { dateStr } = {}) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    console.warn('通知の権限がありません');
    return;
  }
  
  const notification = new Notification(title, {
    body,
    icon: './icon.png', // アイコンのパスを指定
    badge: './icon.png',
    requireInteraction: false,
    tag: 'schedule-notification'
  });
  
  notification.onclick = () => {
    window.focus();
    if (dateStr) {
      // 同じhashだとhashchangeが発火しないケースがあるので一度クリア
      try {
        const nextHash = new URLSearchParams({ date: String(dateStr) }).toString();
        const current = String(window.location.hash || '').replace(/^#/, '');
        if (current === nextHash) {
          window.location.hash = '';
          setTimeout(() => setDateHash(dateStr), 0);
        } else {
          setDateHash(dateStr);
        }
      } catch {
        setDateHash(dateStr);
      }
    }
    notification.close();
  };
  
  // 10秒後に自動で閉じる
  setTimeout(() => {
    notification.close();
  }, 10000);
};

// 通知時間を計算する関数
const calculateNotificationTime = (schedule, notification) => {
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
const generateNotificationText = (schedule, notification) => {
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
  
  // Web版で通知をスケジュール
  const scheduleWebNotification = useCallback(async (notificationId, notificationTime, title, body, { dateStr } = {}) => {
    const now = new Date();
    const delay = notificationTime.getTime() - now.getTime();
    
    // 過去の時間はスキップ
    if (delay <= 0) {
      console.log(`⏰ 過去の通知時間のためスキップ: ${notificationTime.toLocaleString()}`);
      return;
    }
    
    // 24時間以内の通知のみスケジュール（ブラウザの制限を考慮）
    const maxDelay = 24 * 60 * 60 * 1000; // 24時間
    if (delay > maxDelay) {
      console.log(`⚠️ 通知時間が遠すぎます（24時間以内のみ対応）: ${title}`);
      return;
    }
    
    // 通知権限をチェック
    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) {
      console.warn('通知の権限がありません');
      return;
    }
    
    // タイマーをセット
    const timerId = setTimeout(() => {
      showWebNotification(title, body, { dateStr });
      notificationTimersRef.current.delete(notificationId);
    }, delay);
    
    notificationTimersRef.current.set(notificationId, timerId);
    console.log(`✅ Web通知をスケジュールしました: ${title} - ${notificationTime.toLocaleString()}`);
  }, []);
  
  // 全ての通知をスケジュール
  const scheduleAllNotifications = useCallback(async () => {
    clearAllWebTimers();

    const now = new Date();
    console.log('🔔 Web通知 - 現在時刻:', now.toLocaleString());

    // 各予定の通知をスケジュール
    for (const schedule of schedules) {
      if (!schedule.notifications || schedule.notifications.length === 0) continue;

      for (let i = 0; i < schedule.notifications.length; i++) {
        const notification = schedule.notifications[i];
        const notificationTime = calculateNotificationTime(schedule, notification);

        if (notificationTime && notificationTime > now) {
          const notificationId = `${schedule.id}-${i}`;
          const { title, body } = generateNotificationText(schedule, notification);

          await scheduleWebNotification(notificationId, notificationTime, title, body, { dateStr: schedule.date });
        }
      }
    }
  }, [schedules, clearAllWebTimers, scheduleWebNotification]);

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
  const sendTestNotification = useCallback(async (schedule, notification) => {
    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) {
      alert('通知の権限がありません。ブラウザの設定で通知を許可してください。');
      return;
    }

    const { title, body } = generateNotificationText(schedule, notification);
    showWebNotification(`【テスト】${title}`, `これはテスト通知です\n${body}`);
    console.log('Web版テスト通知を送信しました');
  }, []);

  // コンポーネントがアンマウントされたときにタイマーをクリア
  useEffect(() => {
    return () => {
      clearAllWebTimers();
    };
  }, [clearAllWebTimers]);

  // 予定データが変更されたら通知を再スケジュール（デバウンス付き）
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      console.log('🔄 予定データ変更により通知を再スケジュール');
      scheduleAllNotifications();
    }, 500); // 500ms のデバウンス

    return () => {
      clearTimeout(debounceTimer);
    };
  }, [scheduleAllNotifications]);

  return {
    scheduleAllNotifications,
    cancelScheduleNotifications,
    sendTestNotification
  };
};

export default useNotifications;
