import { useEffect, useCallback } from 'react';

// 通知時間を計算する関数
const calculateNotificationTime = (schedule, notification) => {
  const scheduleDate = new Date(schedule.date);
  
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
  
  return {
    title: `${schedule.emoji || '📅'} ${schedule.name}`,
    body: `${notification.value}${unitText[notification.unit]}の通知\n${timeText}${schedule.memo ? `\n📝 ${schedule.memo}` : ''}`
  };
};

// 通知管理フック
export const useNotifications = (schedules) => {
  // 全ての通知をスケジュール
  const scheduleAllNotifications = useCallback(async () => {
    if (!window.electronAPI) return;
    
    try {
      // 既存の通知をすべてキャンセル
      await window.electronAPI.cancelAllNotifications();
      
      const now = new Date();
      
      // 各予定の通知をスケジュール
      for (const schedule of schedules) {
        if (!schedule.notifications || schedule.notifications.length === 0) continue;
        
        for (let i = 0; i < schedule.notifications.length; i++) {
          const notification = schedule.notifications[i];
          const notificationTime = calculateNotificationTime(schedule, notification);
          
          if (notificationTime && notificationTime > now) {
            const notificationId = `${schedule.id}-${i}`;
            const { title, body } = generateNotificationText(schedule, notification);
            
            const result = await window.electronAPI.scheduleNotification({
              id: notificationId,
              time: notificationTime.toISOString(),
              title,
              body
            });
            
            if (result.success) {
              console.log(`通知をスケジュールしました: ${title} - ${notificationTime.toLocaleString()}`);
            } else {
              console.error(`通知のスケジュールに失敗: ${result.error}`);
            }
          }
        }
      }
    } catch (error) {
      console.error('通知のスケジュールに失敗:', error);
    }
  }, [schedules]);

  // 特定の予定の通知をキャンセル
  const cancelScheduleNotifications = useCallback(async (scheduleId) => {
    if (!window.electronAPI) return;
    
    try {
      const schedule = schedules.find(s => s.id === scheduleId);
      if (!schedule || !schedule.notifications) return;
      
      for (let i = 0; i < schedule.notifications.length; i++) {
        const notificationId = `${scheduleId}-${i}`;
        await window.electronAPI.cancelNotification(notificationId);
      }
    } catch (error) {
      console.error('通知のキャンセルに失敗:', error);
    }
  }, [schedules]);

  // テスト通知を送信
  const sendTestNotification = useCallback(async (schedule, notification) => {
    if (!window.electronAPI) return;
    
    try {
      const { title, body } = generateNotificationText(schedule, notification);
      
      const result = await window.electronAPI.showNotification({
        title: `【テスト】${title}`,
        body: `これはテスト通知です\n${body}`
      });
      
      if (result.success) {
        console.log('テスト通知を送信しました');
      } else {
        console.error(`テスト通知の送信に失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('テスト通知の送信に失敗:', error);
    }
  }, []);

  // 予定データが変更されたら通知を再スケジュール
  useEffect(() => {
    scheduleAllNotifications();
  }, [scheduleAllNotifications]);

  return {
    scheduleAllNotifications,
    cancelScheduleNotifications,
    sendTestNotification
  };
};

export default useNotifications;
