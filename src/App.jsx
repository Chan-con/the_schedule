
import React, { useState, useEffect, useCallback, useRef, useContext, useMemo } from 'react';
import { toDateStrLocal } from './utils/date';

import Calendar from './components/Calendar';
import Timeline from './components/Timeline';
import CurrentDateTimeBar from './components/CurrentDateTimeBar';
import ScheduleForm from './components/ScheduleForm';
import TitleBar from './components/TitleBar';
import SettingsModal from './components/SettingsModal';
import { useNotifications } from './hooks/useNotifications';
import { useHistory } from './hooks/useHistory';
import { AuthContext } from './context/AuthContextBase';
import {
  fetchSchedulesForUser,
  createScheduleForUser,
  updateScheduleForUser,
  deleteScheduleForUser,
  upsertSchedulesForUser,
} from './utils/supabaseSchedules';
import {
  fetchTasksForUser,
  createTaskForUser,
  updateTaskForUser,
  deleteTaskForUser,
  upsertTasksForUser,
} from './utils/supabaseTasks';

// サンプルデータ - 今日の日付に合わせて調整
const getTodayDateStr = () => toDateStrLocal(new Date());

const initialSchedules = [
  { id: 1, date: getTodayDateStr(), time: '09:00', name: '打ち合わせ', memo: 'ZoomリンクはSlack参照', allDay: false, isTask: false, completed: false },
  { id: 2, date: getTodayDateStr(), time: '', name: '終日イベント', memo: '終日エリアに表示', allDay: true, allDayOrder: 0, isTask: false, completed: false },
];

const normalizeSchedule = (schedule) => ({
  ...schedule,
  isTask: schedule?.isTask ?? false,
  completed: schedule?.completed ?? false,
  isStandaloneTask: schedule?.isStandaloneTask ?? false,
});

const normalizeSchedules = (schedules) => {
  if (!Array.isArray(schedules)) return [];
  return schedules.map(normalizeSchedule);
};

const normalizeTask = (task = {}) => {
  const rawTime = typeof task.time === 'string' ? task.time.trim() : '';
  const normalizedTime = rawTime || '';

  return {
    ...task,
    isTask: true,
    isStandaloneTask: task?.isStandaloneTask ?? true,
    source: task?.source ?? 'standaloneTask',
    time: normalizedTime,
    allDay: true,
    completed: task?.completed ?? false,
    notifications: Array.isArray(task?.notifications) ? task.notifications : [],
  };
};

const normalizeTasks = (tasks) => {
  if (!Array.isArray(tasks)) return [];
  return tasks.map(normalizeTask);
};

const createTempId = () => Date.now();

const rebalanceAllDayOrdersForDates = (schedules, dates) => {
  if (!Array.isArray(schedules)) return [];
  const uniqueDates = Array.from(new Set((dates || []).filter(Boolean)));
  if (uniqueDates.length === 0) {
    return schedules;
  }

  const allDayOrderMap = new Map();
  uniqueDates.forEach((date) => {
    const sorted = schedules
      .filter((schedule) => schedule.allDay && schedule.date === date)
      .sort((a, b) => {
        const orderDiff = (a.allDayOrder || 0) - (b.allDayOrder || 0);
        if (orderDiff !== 0) return orderDiff;
        return String(a.id).localeCompare(String(b.id));
      });

    sorted.forEach((schedule, index) => {
      allDayOrderMap.set(schedule.id, index);
    });
  });

  if (allDayOrderMap.size === 0) {
    return schedules;
  }

  return schedules.map((schedule) => {
    if (!schedule.allDay) return schedule;
    if (!allDayOrderMap.has(schedule.id)) return schedule;
    return {
      ...schedule,
      allDayOrder: allDayOrderMap.get(schedule.id),
    };
  });
};

function App() {
  const loadLocalSchedules = useCallback(() => {
    if (typeof window === 'undefined') {
      return normalizeSchedules(initialSchedules);
    }

    try {
      const stored = window.localStorage.getItem('schedules');
      if (stored) {
        return normalizeSchedules(JSON.parse(stored));
      }
    } catch (error) {
      console.warn('⚠️ Failed to parse schedules from localStorage:', error);
    }

    return normalizeSchedules(initialSchedules);
  }, []);

  const loadLocalTasks = useCallback(() => {
    if (typeof window === 'undefined') {
      return normalizeTasks([]);
    }

    try {
      const stored = window.localStorage.getItem('tasks');
      if (stored) {
        return normalizeTasks(JSON.parse(stored));
      }
    } catch (error) {
      console.warn('⚠️ Failed to parse tasks from localStorage:', error);
    }

    return normalizeTasks([]);
  }, []);

  const initialLoadedSchedules = useMemo(() => loadLocalSchedules(), [loadLocalSchedules]);
  const initialLoadedTasks = useMemo(() => loadLocalTasks(), [loadLocalTasks]);
  
  // 履歴管理機能付きの予定状態
  const {
    state: schedules,
    setState: setSchedules,
    replaceState,
    undo,
    redo,
    canUndo,
    canRedo,
    historyLength,
    currentIndex,
    lastActionType
  } = useHistory(initialLoadedSchedules, 100);

  const [tasks, setTasksState] = useState(initialLoadedTasks);

  const auth = useContext(AuthContext);
  const userId = auth?.user?.id || null;
  const [isSupabaseSyncing, setIsSupabaseSyncing] = useState(false);
  const [supabaseError, setSupabaseError] = useState(null);
  const schedulesRef = useRef(schedules);
  const tasksRef = useRef(tasks);
  const hasFetchedRemoteRef = useRef(false);
  const supabaseJobsRef = useRef(0);

  const beginSupabaseJob = useCallback((meta = {}) => {
    supabaseJobsRef.current += 1;
    if (typeof window !== 'undefined' && window?.electronAPI?.supabaseJobStart) {
      try {
        window.electronAPI.supabaseJobStart(meta);
      } catch (error) {
        console.warn('[SupabaseJob] Failed to notify main process (start):', error);
      }
    }
  }, []);

  const endSupabaseJob = useCallback((meta = {}) => {
    supabaseJobsRef.current = Math.max(0, supabaseJobsRef.current - 1);
    if (typeof window !== 'undefined' && window?.electronAPI?.supabaseJobEnd) {
      try {
        window.electronAPI.supabaseJobEnd(meta);
      } catch (error) {
        console.warn('[SupabaseJob] Failed to notify main process (end):', error);
      }
    }
  }, []);

  const commitSchedules = useCallback((nextSchedules, actionType = 'unknown') => {
    const normalized = normalizeSchedules(nextSchedules);
    schedulesRef.current = normalized;
    setSchedules(normalized, actionType);
  }, [setSchedules]);

  const commitTasks = useCallback((nextTasks, actionType = 'unknown') => {
    const normalized = normalizeTasks(nextTasks);
    tasksRef.current = normalized;
    setTasksState(normalized);
    console.log('💾 Tasks committed:', {
      actionType,
      count: normalized.length,
    });
  }, [setTasksState]);

  useEffect(() => {
    schedulesRef.current = schedules;
  }, [schedules]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const authUser = auth?.user ?? null;
  const isAuthLoading = auth?.isLoading ?? false;
  const isAuthProcessing = auth?.isProcessing ?? false;
  const authLogin = auth?.signInWithGoogle;
  const authLogout = auth?.signOut;
  const isAuthenticated = !!userId;

  const titleBarAuth = useMemo(() => ({
    user: authUser,
    isLoading: isAuthLoading,
    isProcessing: isAuthProcessing,
    onLogin: authLogin,
    onLogout: authLogout,
  }), [authLogin, authLogout, authUser, isAuthLoading, isAuthProcessing]);

  const notificationEntries = useMemo(() => {
    const scheduleEntries = Array.isArray(schedules) ? schedules : [];
    const taskEntries = Array.isArray(tasks) ? tasks : [];
    return [...scheduleEntries, ...taskEntries];
  }, [schedules, tasks]);
  
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // 分割比率の状態管理（デフォルト50%）
  const [splitRatio, setSplitRatio] = useState(50);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const layoutContainerRef = useRef(null);
  
  // モバイル表示の状態管理
  const [isMobile, setIsMobile] = useState(false);
  const [timelineActiveTab, setTimelineActiveTab] = useState('timeline');
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [mouseStart, setMouseStart] = useState(null);
  const [mouseEnd, setMouseEnd] = useState(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  
  // ハンバーガーメニューの開閉状態
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  // 通知システム
  const { cancelScheduleNotifications, sendTestNotification } = useNotifications(notificationEntries);

  const refreshFromSupabase = useCallback(
    async (actionType = 'supabase_resync', options = {}) => {
      if (!userId) return;

      const { showSpinner = false, isCancelled } = options;
      const isCancelledFn = typeof isCancelled === 'function' ? isCancelled : () => false;

      if (showSpinner) {
        setIsSupabaseSyncing(true);
      }

      const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      console.info('[SupabaseSync] start', JSON.stringify({
        actionType,
        showSpinner,
        userId,
        timestamp: new Date().toISOString(),
      }));
      beginSupabaseJob({ actionType, kind: 'fetchData' });
      try {
        const [remoteSchedules, remoteTasks] = await Promise.all([
          fetchSchedulesForUser(userId),
          fetchTasksForUser(userId),
        ]);
        if (isCancelledFn()) return;

        replaceState(remoteSchedules, actionType);
        commitTasks(remoteTasks, `${actionType}_tasks`);
        setSupabaseError(null);
        hasFetchedRemoteRef.current = true;
        console.info('[SupabaseSync] payload', JSON.stringify({
          actionType,
          schedules: remoteSchedules.slice(0, 10),
          tasks: remoteTasks.slice(0, 10),
        }));
        console.info('[SupabaseSync] success', JSON.stringify({
          actionType,
          count: remoteSchedules.length,
          taskCount: remoteTasks.length,
          durationMs:
            (typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? Math.round(performance.now() - startedAt)
              : Math.round(Date.now() - startedAt)),
        }));
      } catch (error) {
        if (isCancelledFn()) return;

        console.error('[Supabase] Failed to synchronise schedules:', error);
        setSupabaseError(error.message || 'Supabaseとの同期に失敗しました。');
        console.error('[SupabaseSync] error', JSON.stringify({
          actionType,
          durationMs:
            (typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? Math.round(performance.now() - startedAt)
              : Math.round(Date.now() - startedAt)),
          message: error.message,
        }));
        throw error;
      } finally {
        endSupabaseJob({ actionType, kind: 'fetchData' });
        if (showSpinner && !isCancelledFn()) {
          setIsSupabaseSyncing(false);
        }
        console.info('[SupabaseSync] finished', JSON.stringify({
          actionType,
          showSpinner,
          cancelled: isCancelledFn(),
        }));
      }
    },
    [beginSupabaseJob, commitTasks, endSupabaseJob, replaceState, userId]
  );

  useEffect(() => {
    if (auth?.isLoading) return;

    if (!userId) {
      hasFetchedRemoteRef.current = false;
      setSupabaseError(null);
      setIsSupabaseSyncing(false);
      replaceState(loadLocalSchedules(), 'local_restore');
      commitTasks(loadLocalTasks(), 'local_restore');
      return;
    }

    let cancelled = false;
    refreshFromSupabase('supabase_initial_sync', {
      showSpinner: true,
      isCancelled: () => cancelled,
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [auth?.isLoading, userId, loadLocalSchedules, loadLocalTasks, refreshFromSupabase, replaceState, commitTasks]);
  
  // メニュー外クリックでメニューを閉じる
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMenuOpen && !event.target.closest('[data-menu-container]')) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);
  
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
    console.log('💾 Schedules saved to localStorage:', {
      count: schedules.length,
      historyIndex: currentIndex,
      historyLength: historyLength,
      lastAction: lastActionType
    });
  }, [schedules, currentIndex, historyLength, lastActionType]);

  useEffect(() => {
    localStorage.setItem('tasks', JSON.stringify(tasks));
    console.log('💾 Tasks saved to localStorage:', {
      count: tasks.length,
    });
  }, [tasks]);
  
  // 起動時に設定からレイアウト読み込み
  useEffect(() => {
    (async () => {
      let loaded = false;
      if (window.electronAPI) {
        try {
          const s = await window.electronAPI.getSettings();
          if (typeof s.splitRatio === 'number') {
            setSplitRatio(s.splitRatio);
            loaded = true;
            console.log('[layout] splitRatio loaded from settings:', s.splitRatio);
          }
        } catch (e) {
          console.warn('[layout] failed to load splitRatio from settings', e);
        }
      }
      if (!loaded) {
        const savedRatio = localStorage.getItem('splitRatio');
        if (savedRatio) {
          const v = parseFloat(savedRatio);
          if (!isNaN(v)) {
            setSplitRatio(v);
            console.log('[layout] splitRatio loaded from localStorage:', v);
          }
        }
      }
      setLayoutLoaded(true);
    })();
  }, []);

  // 分割比率変更時に保存（ロード完了後）
  useEffect(() => {
    if (!layoutLoaded) return; // 初期ロード完了までは保存しない
    if (window.electronAPI) {
      window.electronAPI.saveLayout({ splitRatio });
    } else {
      localStorage.setItem('splitRatio', String(splitRatio));
    }
  }, [splitRatio, layoutLoaded]);
  
  // マウス移動ハンドラー
  const handleMouseMove = useCallback((event) => {
    if (!isDragging) return;

    const container = layoutContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const newRatio = ((event.clientX - rect.left) / rect.width) * 100;

    // 20%〜80%の範囲に制限
    if (newRatio >= 20 && newRatio <= 80) {
      setSplitRatio(newRatio);
    }
  }, [isDragging]);
  
  // マウスアップハンドラー
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  // マウスダウンハンドラー
  const handleMouseDown = useCallback((event) => {
    if (!event || event.button !== 0) {
      return;
    }

    const target = event.target;
    if (!target || !target.closest('[data-layout-handle]')) {
      return;
    }

    event.preventDefault();
    setIsDragging(true);
  }, []);
  
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
    if (!isDragging) return undefined;

    const onMouseMove = (event) => handleMouseMove(event);
    const onMouseUp = () => handleMouseUp();

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [handleMouseMove, handleMouseUp, isDragging]);

  // 日付クリック時の処理
  const handleDateClick = (date) => {
    setSelectedDate(date);
    
    // モバイル時は日付クリックでタイムラインを開く
    if (isMobile) {
      setIsTimelineOpen(true);
    }
  };  // 予定編集ハンドラー
  const handleEdit = (schedule) => {
    console.log('🔧 handleEdit called with:', schedule);
    console.log('🔧 Current showForm state:', showForm);
    console.log('🔧 Current editingSchedule state:', editingSchedule);
    setEditingSchedule(schedule);
    setShowForm(true);
    console.log('🔧 Edit form should now be visible');
  };

  // 予定削除ハンドラー（ドラッグ&ドロップやAlt+右クリック用）
  const handleScheduleDelete = useCallback(async (target, options = {}) => {
    if (!target) return;

    const { throwOnError = false } = options;
    const entry =
      typeof target === 'object'
        ? target
        : schedulesRef.current.find((item) => item.id === target) || tasksRef.current.find((item) => item.id === target);

    if (!entry || !entry.id) return;

  const entryType = entry.isTask && entry.isStandaloneTask ? 'task' : 'schedule';
    console.info('[EntryDelete] request', JSON.stringify({
      entryType,
      entryId: entry.id,
      timestamp: new Date().toISOString(),
    }));

    cancelScheduleNotifications(entry.id);

  if (entry.isTask && entry.isStandaloneTask) {
      const currentTasks = tasksRef.current;
      const optimisticTasks = currentTasks.filter((item) => item.id !== entry.id);
      commitTasks(optimisticTasks, 'task_delete');
      console.info('[TaskDelete] optimistic applied', JSON.stringify({
        taskId: entry.id,
        remainingCount: optimisticTasks.length,
      }));

      if (!userId) return;

      const jobMeta = { kind: 'deleteTask', taskId: entry.id };
      beginSupabaseJob(jobMeta);
      const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      try {
        await deleteTaskForUser(entry.id, userId);
        setSupabaseError(null);
        console.info('[TaskDelete] synced', JSON.stringify({
          taskId: entry.id,
          durationMs:
            (typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? Math.round(performance.now() - startedAt)
              : Math.round(Date.now() - startedAt)),
        }));
      } catch (error) {
        console.error('[Supabase] Failed to delete task:', error);
        setSupabaseError(error.message || 'タスクの削除に失敗しました。');
        refreshFromSupabase('supabase_resync').catch(() => {});
        if (throwOnError) {
          throw error;
        }
      } finally {
        endSupabaseJob(jobMeta);
      }
      return;
    }

    const scheduleId = entry.id;
    const currentSchedules = schedulesRef.current;
    const optimisticSchedules = currentSchedules.filter((item) => item.id !== scheduleId);
    commitSchedules(optimisticSchedules, 'schedule_delete');
    console.info('[ScheduleDelete] optimistic applied', JSON.stringify({
      scheduleId,
      remainingCount: optimisticSchedules.length,
    }));

    if (!userId) return;

    const jobMeta = { kind: 'deleteSchedule', scheduleId };
    beginSupabaseJob(jobMeta);
    const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    try {
      await deleteScheduleForUser(scheduleId, userId);
      setSupabaseError(null);
      console.info('[ScheduleDelete] synced', JSON.stringify({
        scheduleId,
        durationMs:
          (typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? Math.round(performance.now() - startedAt)
            : Math.round(Date.now() - startedAt)),
      }));
    } catch (error) {
      console.error('[Supabase] Failed to delete schedule:', error);
      setSupabaseError(error.message || '予定の削除に失敗しました。');
      refreshFromSupabase('supabase_resync').catch(() => {});
      if (throwOnError) {
        throw error;
      }
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, cancelScheduleNotifications, commitSchedules, commitTasks, endSupabaseJob, refreshFromSupabase, setSupabaseError, userId]);

  // 予定移動ハンドラー（ドラッグ&ドロップ用）
  const handleScheduleMove = useCallback((schedule, nextDate) => {
    if (!schedule?.id || !nextDate) return;

  if (schedule.isTask && schedule.isStandaloneTask) {
      const currentTasks = tasksRef.current;
      const existingTask = currentTasks.find((item) => item.id === schedule.id);
      if (!existingTask) return;

      const updatedTask = normalizeTask({ ...existingTask, ...schedule, date: nextDate });
      const optimisticTasks = currentTasks.map((item) => (item.id === updatedTask.id ? updatedTask : item));

      commitTasks(optimisticTasks, 'task_move');
      console.info('[TaskMove] optimistic applied', JSON.stringify({
        taskId: updatedTask.id,
        toDate: updatedTask.date,
      }));

      if (userId) {
        (async () => {
          const jobMeta = { kind: 'updateTask', taskId: updatedTask.id, action: 'move' };
          beginSupabaseJob(jobMeta);
          const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
          try {
            const persisted = await updateTaskForUser(updatedTask, userId);
            const latestTasks = tasksRef.current;
            const syncedTasks = latestTasks.map((item) => (item.id === persisted.id ? normalizeTask(persisted) : item));
            commitTasks(syncedTasks, 'task_move_sync');
            setSupabaseError(null);
            console.info('[TaskMove] synced', JSON.stringify({
              taskId: persisted.id,
              toDate: persisted.date,
              durationMs:
                (typeof performance !== 'undefined' && typeof performance.now === 'function'
                  ? Math.round(performance.now() - startedAt)
                  : Math.round(Date.now() - startedAt)),
            }));
          } catch (error) {
            console.error('[Supabase] Failed to move task:', error);
            setSupabaseError(error.message || 'タスクの移動に失敗しました。');
            refreshFromSupabase('supabase_resync').catch(() => {});
          } finally {
            endSupabaseJob(jobMeta);
          }
        })();
      }

      return;
    }

    const current = schedulesRef.current;
    const existing = current.find((item) => item.id === schedule.id);
    if (!existing) return;

    const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    console.info('[ScheduleMove] request', JSON.stringify({
      scheduleId: schedule.id,
      fromDate: existing.date,
      toDate: nextDate,
      allDay: existing.allDay,
      timestamp: new Date().toISOString(),
    }));

    const previousDate = existing.date;
  const updated = normalizeSchedule({ ...existing, ...schedule, date: nextDate, isStandaloneTask: false });

    let optimistic = current.map((item) => (item.id === updated.id ? updated : item));
    if (updated.allDay) {
      optimistic = rebalanceAllDayOrdersForDates(optimistic, [previousDate, updated.date]);
    }

    commitSchedules(optimistic, 'schedule_move');
    console.info('[ScheduleMove] optimistic applied', JSON.stringify({
      scheduleId: updated.id,
      toDate: updated.date,
      durationMs:
        (typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? Math.round(performance.now() - startedAt)
          : Math.round(Date.now() - startedAt)),
    }));

    if (userId) {
      (async () => {
        const jobMeta = { kind: 'updateSchedule', scheduleId: updated.id, action: 'move' };
        beginSupabaseJob(jobMeta);
        const syncStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
        try {
          const persisted = await updateScheduleForUser(updated, userId);
          let latest = schedulesRef.current;
          let synced = latest.map((item) => (item.id === persisted.id ? persisted : item));
          if (persisted.allDay) {
            synced = rebalanceAllDayOrdersForDates(synced, [previousDate, persisted.date]);
          }
          commitSchedules(synced, 'schedule_move_sync');
          setSupabaseError(null);
          console.info('[ScheduleMove] synced', JSON.stringify({
            scheduleId: persisted.id,
            toDate: persisted.date,
            durationMs:
              (typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? Math.round(performance.now() - syncStartedAt)
                : Math.round(Date.now() - syncStartedAt)),
          }));
        } catch (error) {
          console.error('[Supabase] Failed to move schedule:', error);
          setSupabaseError(error.message || '予定の移動に失敗しました。');
          refreshFromSupabase('supabase_resync').catch(() => {});
        } finally {
          endSupabaseJob(jobMeta);
        }
      })();
    }
  }, [beginSupabaseJob, commitSchedules, commitTasks, endSupabaseJob, refreshFromSupabase, setSupabaseError, userId]);

  // 予定コピー（ALTドラッグ複製など）
  const handleScheduleCopy = useCallback((schedule) => {
    if (!schedule) return;

    if (schedule.isTask && schedule.isStandaloneTask) {
      const taskPayload = {
        ...schedule,
        time: '',
        allDay: true,
        isTask: true,
        isStandaloneTask: true,
        source: schedule?.source ?? 'standaloneTask',
      };
      const normalizedTask = normalizeTask(taskPayload);
      const latestTasks = tasksRef.current;

      if (normalizedTask.id && latestTasks.some((item) => item.id === normalizedTask.id)) {
        const optimisticTasks = latestTasks.map((item) => (item.id === normalizedTask.id ? normalizedTask : item));
        commitTasks(optimisticTasks, 'task_copy_replace');
        handleScheduleMove(normalizedTask, normalizedTask.date);
        return;
      }

      const tempId = normalizedTask.id || createTempId();
      const placeholder = { ...normalizedTask, id: tempId };

      commitTasks([...latestTasks, placeholder], 'task_copy');
      console.info('[TaskCopy] optimistic applied', JSON.stringify({
        tempId,
        date: placeholder.date,
      }));

      if (userId) {
        (async () => {
          const jobMeta = { kind: 'createTask', tempId, action: 'copy' };
          beginSupabaseJob(jobMeta);
          const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
          try {
            const payload = { ...normalizedTask };
            delete payload.id;
            const created = await createTaskForUser(payload, userId);
            jobMeta.taskId = created.id;

            const latest = tasksRef.current;
            let replaced = latest.map((item) => (item.id === tempId ? normalizeTask(created) : item));
            if (!replaced.some((item) => item.id === created.id)) {
              replaced = [...latest.filter((item) => item.id !== tempId), normalizeTask(created)];
            }
            commitTasks(replaced, 'task_copy_sync');
            setSupabaseError(null);
            console.info('[TaskCopy] synced', JSON.stringify({
              taskId: created.id,
              date: created.date,
              durationMs:
                (typeof performance !== 'undefined' && typeof performance.now === 'function'
                  ? Math.round(performance.now() - startedAt)
                  : Math.round(Date.now() - startedAt)),
            }));
          } catch (error) {
            console.error('[Supabase] Failed to copy task:', error);
            setSupabaseError(error.message || 'タスクのコピーに失敗しました。');
            refreshFromSupabase('supabase_resync').catch(() => {});
          } finally {
            endSupabaseJob(jobMeta);
          }
        })();
      }

      return;
    }

  const normalized = normalizeSchedule({ ...schedule, isStandaloneTask: false });
    const latest = schedulesRef.current;

    console.info('[ScheduleCopy] request', JSON.stringify({
      originalId: schedule.id,
      normalizedId: normalized.id,
      date: normalized.date,
      timestamp: new Date().toISOString(),
    }));

    if (normalized.id && latest.some((item) => item.id === normalized.id)) {
      handleScheduleMove(normalized, normalized.date);
      return;
    }

    const tempId = normalized.id || createTempId();
    const placeholder = { ...normalized, id: tempId };

    let optimistic = [...latest, placeholder];
    if (placeholder.allDay) {
      optimistic = rebalanceAllDayOrdersForDates(optimistic, [placeholder.date]);
    }

    commitSchedules(optimistic, 'schedule_copy');
    console.info('[ScheduleCopy] optimistic applied', JSON.stringify({
      tempId: tempId,
      date: placeholder.date,
      isAllDay: placeholder.allDay,
    }));

    if (userId) {
      (async () => {
        const jobMeta = { kind: 'createSchedule', tempId, action: 'copy' };
        beginSupabaseJob(jobMeta);
        const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
        try {
          const payload = { ...placeholder };
          delete payload.id;
          const created = await createScheduleForUser(payload, userId);

          let latestState = schedulesRef.current;
          let replaced = latestState.map((item) => (item.id === tempId ? created : item));
          if (!replaced.some((item) => item.id === created.id)) {
            replaced = [...latestState.filter((item) => item.id !== tempId), created];
          }
          if (created.allDay) {
            replaced = rebalanceAllDayOrdersForDates(replaced, [created.date]);
          }

          commitSchedules(replaced, 'schedule_copy_sync');
          setSupabaseError(null);
          console.info('[ScheduleCopy] synced', JSON.stringify({
            createdId: created.id,
            date: created.date,
            durationMs:
              (typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? Math.round(performance.now() - startedAt)
                : Math.round(Date.now() - startedAt)),
          }));
        } catch (error) {
          console.error('[Supabase] Failed to copy schedule:', error);
          setSupabaseError(error.message || '予定のコピーに失敗しました。');
          refreshFromSupabase('supabase_resync').catch(() => {});
        } finally {
          endSupabaseJob(jobMeta);
        }
      })();
    }
  }, [beginSupabaseJob, commitSchedules, commitTasks, endSupabaseJob, handleScheduleMove, refreshFromSupabase, setSupabaseError, userId]);

  // 予定更新ハンドラー（並び替え用）
  const handleScheduleUpdate = useCallback((updatedSchedule, actionType = 'schedule_reorder') => {
    const updates = Array.isArray(updatedSchedule) ? updatedSchedule : [updatedSchedule];
    if (updates.length === 0) return;

    const normalizedUpdates = updates
      .filter((item) => !item?.isTask)
      .map(normalizeSchedule);

    if (normalizedUpdates.length === 0) {
      return;
    }
    console.info('[ScheduleUpdate] request', JSON.stringify({
      actionType,
      count: normalizedUpdates.length,
      ids: normalizedUpdates.map((item) => item.id),
      timestamp: new Date().toISOString(),
    }));
    const current = schedulesRef.current;
    const updateMap = new Map(normalizedUpdates.map((item) => [item.id, item]));

    let optimistic = current.map((schedule) =>
      updateMap.has(schedule.id) ? { ...schedule, ...updateMap.get(schedule.id) } : schedule
    );

    const affectedDates = normalizedUpdates.filter((item) => item.allDay).map((item) => item.date);
    if (affectedDates.length > 0) {
      optimistic = rebalanceAllDayOrdersForDates(optimistic, affectedDates);
    }

    commitSchedules(optimistic, actionType);
    console.info('[ScheduleUpdate] optimistic applied', JSON.stringify({
      actionType,
      count: normalizedUpdates.length,
    }));

    if (userId) {
      (async () => {
        const jobMeta = { kind: 'upsertSchedules', actionType, count: normalizedUpdates.length };
        beginSupabaseJob(jobMeta);
        const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
        try {
          const persisted = await upsertSchedulesForUser(normalizedUpdates, userId);
          if (Array.isArray(persisted) && persisted.length > 0) {
            let latest = schedulesRef.current;
            const persistedMap = new Map(persisted.map((item) => [item.id, item]));
            let synced = latest.map((schedule) =>
              persistedMap.has(schedule.id) ? persistedMap.get(schedule.id) : schedule
            );
            const persistedDates = persisted.filter((item) => item.allDay).map((item) => item.date);
            if (persistedDates.length > 0) {
              synced = rebalanceAllDayOrdersForDates(synced, persistedDates);
            }
            commitSchedules(synced, `${actionType}_sync`);
          }
          setSupabaseError(null);
          console.info('[ScheduleUpdate] synced', JSON.stringify({
            actionType,
            count: Array.isArray(persisted) ? persisted.length : 0,
            durationMs:
              (typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? Math.round(performance.now() - startedAt)
                : Math.round(Date.now() - startedAt)),
          }));
        } catch (error) {
          console.error('[Supabase] Failed to update schedules:', error);
          setSupabaseError(error.message || '予定の更新に失敗しました。');
          refreshFromSupabase('supabase_resync').catch(() => {});
        } finally {
          endSupabaseJob(jobMeta);
        }
      })();
    }
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, refreshFromSupabase, setSupabaseError, userId]);

  // タスクのチェック状態トグル
  const handleToggleTask = useCallback((target, completed) => {
    if (target == null) return;

    const entry =
      typeof target === 'object'
        ? target
        : tasksRef.current.find((item) => item.id === target) || schedulesRef.current.find((item) => item.id === target);

    if (!entry) return;

  if (entry.isTask && entry.isStandaloneTask) {
      const currentTasks = tasksRef.current;
      console.info('[TaskToggle] request', JSON.stringify({
        taskId: entry.id,
        completed,
        timestamp: new Date().toISOString(),
      }));
      const updatedTask = normalizeTask({ ...entry, completed });
      const optimisticTasks = currentTasks.map((item) => (item.id === updatedTask.id ? updatedTask : item));
      commitTasks(optimisticTasks, 'task_toggle');
      console.info('[TaskToggle] optimistic applied', JSON.stringify({
        taskId: updatedTask.id,
        completed,
      }));

      if (userId) {
        (async () => {
          const jobMeta = { kind: 'updateTask', taskId: updatedTask.id, action: 'task_toggle' };
          beginSupabaseJob(jobMeta);
          const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
          try {
            const persisted = await updateTaskForUser(updatedTask, userId);
            const latestTasks = tasksRef.current;
            const syncedTasks = latestTasks.map((item) => (item.id === persisted.id ? normalizeTask(persisted) : item));
            commitTasks(syncedTasks, 'task_toggle_sync');
            setSupabaseError(null);
            console.info('[TaskToggle] synced', JSON.stringify({
              taskId: persisted.id,
              completed: persisted.completed,
              durationMs:
                (typeof performance !== 'undefined' && typeof performance.now === 'function'
                  ? Math.round(performance.now() - startedAt)
                  : Math.round(Date.now() - startedAt)),
            }));
          } catch (error) {
            console.error('[Supabase] Failed to toggle task state:', error);
            setSupabaseError(error.message || 'タスク状態の更新に失敗しました。');
            refreshFromSupabase('supabase_resync').catch(() => {});
          } finally {
            endSupabaseJob(jobMeta);
          }
        })();
      }

      return;
    }

    const currentSchedules = schedulesRef.current;
    const scheduleId = entry.id;
  const updatedSchedule = { ...entry, completed, isTask: true, isStandaloneTask: false };
    const optimisticSchedules = currentSchedules.map((item) => (item.id === scheduleId ? updatedSchedule : item));
    commitSchedules(optimisticSchedules, 'task_toggle');
    console.info('[TaskToggle] optimistic applied (schedule fallback)', JSON.stringify({
      scheduleId,
      completed,
    }));

    if (userId) {
      (async () => {
        const jobMeta = { kind: 'updateSchedule', scheduleId, action: 'task_toggle' };
        beginSupabaseJob(jobMeta);
        const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
        try {
          const persisted = await updateScheduleForUser(updatedSchedule, userId);
          const latest = schedulesRef.current;
          const synced = latest.map((item) => (item.id === persisted.id ? persisted : item));
          commitSchedules(synced, 'task_toggle_sync');
          setSupabaseError(null);
          console.info('[TaskToggle] synced (schedule fallback)', JSON.stringify({
            scheduleId: persisted.id,
            completed: persisted.completed,
            durationMs:
              (typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? Math.round(performance.now() - startedAt)
                : Math.round(Date.now() - startedAt)),
          }));
        } catch (error) {
          console.error('[Supabase] Failed to toggle task state (schedule fallback):', error);
          setSupabaseError(error.message || 'タスク状態の更新に失敗しました。');
          refreshFromSupabase('supabase_resync').catch(() => {});
        } finally {
          endSupabaseJob(jobMeta);
        }
      })();
    }
  }, [beginSupabaseJob, commitSchedules, commitTasks, endSupabaseJob, refreshFromSupabase, setSupabaseError, userId]);
  const handleAdd = (targetDate = null) => {
    // ターゲット日付が指定されていればその日付を使用、なければ選択中の日付を使用
    const dateToUse = targetDate || selectedDate;
  const dateStr = toDateStrLocal(dateToUse);
    
    setEditingSchedule({
      date: dateStr,
      time: '',
      name: '',
      memo: '',
      allDay: true,  // 新規作成時は開始時間が空欄なので終日に設定
      isTask: false,
      completed: false
    });
    setShowForm(true);
    
    // ダブルクリックで作成された場合は、その日付を選択状態にする
    if (targetDate) {
      setSelectedDate(targetDate);
    }
  };

  const handleAddTask = useCallback((targetDate = null) => {
    const dateToUse = targetDate || selectedDate;
    const dateStr = toDateStrLocal(dateToUse);

    setEditingSchedule({
      date: dateStr,
      time: '',
      name: '',
      memo: '',
      allDay: true,
      isTask: true,
      isStandaloneTask: true,
      source: 'standaloneTask',
      completed: false,
    });
    setShowForm(true);

    if (targetDate) {
      setSelectedDate(targetDate);
    }
  }, [selectedDate]);

  // 予定保存ハンドラー
  const handleSave = useCallback(async (schedule) => {
    if (!schedule) return;

    if (schedule.isTask && schedule.isStandaloneTask) {
      const taskPayload = {
        ...schedule,
        time: '',
        allDay: true,
        isTask: true,
        isStandaloneTask: true,
        source: schedule?.source ?? 'standaloneTask',
      };

      const normalizedTask = normalizeTask(taskPayload);

      if (normalizedTask.id) {
        const currentTasks = tasksRef.current;
        const existingTask = currentTasks.find((item) => item.id === normalizedTask.id);

        if (!existingTask) {
          console.warn('[TaskSave] update target not found, fallback to create');
        } else {
          const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
          console.info('[TaskSave] update request', JSON.stringify({
            taskId: normalizedTask.id,
            date: normalizedTask.date,
            timestamp: new Date().toISOString(),
          }));

          const optimisticTasks = currentTasks.map((item) => (item.id === normalizedTask.id ? normalizedTask : item));
          commitTasks(optimisticTasks, 'task_edit');
          console.info('[TaskSave] update optimistic applied', JSON.stringify({
            taskId: normalizedTask.id,
            date: normalizedTask.date,
          }));

          if (userId) {
            const jobMeta = { kind: 'updateTask', taskId: normalizedTask.id, action: 'save' };
            beginSupabaseJob(jobMeta);
            try {
              const persisted = await updateTaskForUser(normalizedTask, userId);
              const latestTasks = tasksRef.current;
              const syncedTasks = latestTasks.map((item) => (item.id === persisted.id ? normalizeTask(persisted) : item));
              commitTasks(syncedTasks, 'task_edit_sync');
              setSupabaseError(null);
              console.info('[TaskSave] update synced', JSON.stringify({
                taskId: persisted.id,
                date: persisted.date,
                durationMs:
                  (typeof performance !== 'undefined' && typeof performance.now === 'function'
                    ? Math.round(performance.now() - startedAt)
                    : Math.round(Date.now() - startedAt)),
              }));
            } catch (error) {
              console.error('[Supabase] Failed to update task:', error);
              setSupabaseError(error.message || 'タスクの更新に失敗しました。');
              refreshFromSupabase('supabase_resync').catch(() => {});
              throw error;
            } finally {
              endSupabaseJob(jobMeta);
            }
          }

          setShowForm(false);
          return;
        }
      }

  const baseTask = normalizeTask({ ...taskPayload, id: undefined });
      const tempId = createTempId();
      const placeholder = { ...baseTask, id: tempId };

      const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      console.info('[TaskSave] create request', JSON.stringify({
        tempId,
        date: baseTask.date,
        timestamp: new Date().toISOString(),
      }));

      commitTasks([...tasksRef.current, placeholder], 'task_create');
      console.info('[TaskSave] create optimistic applied', JSON.stringify({
        tempId,
        date: placeholder.date,
      }));

      if (userId) {
        const jobMeta = { kind: 'createTask', tempId, action: 'save' };
        beginSupabaseJob(jobMeta);
        try {
          const payload = { ...baseTask };
          delete payload.id;
          const created = await createTaskForUser(payload, userId);
          jobMeta.taskId = created.id;

          const latestTasks = tasksRef.current;
          let replaced = latestTasks.map((item) => (item.id === tempId ? normalizeTask(created) : item));
          if (!replaced.some((item) => item.id === created.id)) {
            replaced = [...latestTasks.filter((item) => item.id !== tempId), normalizeTask(created)];
          }
          commitTasks(replaced, 'task_create_sync');
          setSupabaseError(null);
          console.info('[TaskSave] create synced', JSON.stringify({
            taskId: created.id,
            date: created.date,
            durationMs:
              (typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? Math.round(performance.now() - startedAt)
                : Math.round(Date.now() - startedAt)),
          }));
        } catch (error) {
          console.error('[Supabase] Failed to create task:', error);
          setSupabaseError(error.message || 'タスクの作成に失敗しました。');
          refreshFromSupabase('supabase_resync').catch(() => {});
          throw error;
        } finally {
          endSupabaseJob(jobMeta);
        }
      }

      setShowForm(false);
      return;
    }

  if (schedule.id) {
      const current = schedulesRef.current;
      const existing = current.find((item) => item.id === schedule.id);
      if (!existing) {
        throw new Error('対象の予定が見つかりませんでした。');
      }

      const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      console.info('[ScheduleSave] update request', JSON.stringify({
        scheduleId: schedule.id,
        originalDate: existing.date,
        nextDate: schedule.date,
        timestamp: new Date().toISOString(),
      }));
  const updated = normalizeSchedule({ ...existing, ...schedule, isStandaloneTask: false });

      let optimistic = current.map((item) => (item.id === updated.id ? updated : item));
      if (updated.allDay) {
        optimistic = rebalanceAllDayOrdersForDates(optimistic, [updated.date]);
      }
      commitSchedules(optimistic, 'schedule_edit');
      console.info('[ScheduleSave] update optimistic applied', JSON.stringify({
        scheduleId: updated.id,
        date: updated.date,
      }));

      if (userId) {
        const jobMeta = { kind: 'updateSchedule', scheduleId: updated.id, action: 'save' };
        beginSupabaseJob(jobMeta);
        try {
          const persisted = await updateScheduleForUser(updated, userId);
          let latest = schedulesRef.current;
          let synced = latest.map((item) => (item.id === persisted.id ? persisted : item));
          if (persisted.allDay) {
            synced = rebalanceAllDayOrdersForDates(synced, [persisted.date]);
          }
          commitSchedules(synced, 'schedule_edit_sync');
          setSupabaseError(null);
          console.info('[ScheduleSave] update synced', JSON.stringify({
            scheduleId: persisted.id,
            date: persisted.date,
            durationMs:
              (typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? Math.round(performance.now() - startedAt)
                : Math.round(Date.now() - startedAt)),
          }));
        } catch (error) {
          console.error('[Supabase] Failed to update schedule:', error);
          setSupabaseError(error.message || '予定の更新に失敗しました。');
          refreshFromSupabase('supabase_resync').catch(() => {});
          throw error;
        } finally {
          endSupabaseJob(jobMeta);
        }
      }
    } else {
  const baseSchedule = normalizeSchedule({ ...schedule, isStandaloneTask: false });
      const tempId = createTempId();
      const placeholder = { ...baseSchedule, id: tempId };

      const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      console.info('[ScheduleSave] create request', JSON.stringify({
        targetDate: baseSchedule.date,
        isAllDay: baseSchedule.allDay,
        tempId,
        timestamp: new Date().toISOString(),
      }));

      let optimistic = [...schedulesRef.current, placeholder];
      if (placeholder.allDay) {
        optimistic = rebalanceAllDayOrdersForDates(optimistic, [placeholder.date]);
      }
      commitSchedules(optimistic, 'schedule_create');
      console.info('[ScheduleSave] create optimistic applied', JSON.stringify({
        tempId,
        date: placeholder.date,
      }));

      if (userId) {
        const jobMeta = { kind: 'createSchedule', tempId, action: 'save' };
        beginSupabaseJob(jobMeta);
        try {
          const payload = { ...baseSchedule };
          delete payload.id;
          const created = await createScheduleForUser(payload, userId);
          jobMeta.scheduleId = created.id;

          let latest = schedulesRef.current;
          let replaced = latest.map((item) => (item.id === tempId ? created : item));
          if (!replaced.some((item) => item.id === created.id)) {
            replaced = [...latest.filter((item) => item.id !== tempId), created];
          }
          if (created.allDay) {
            replaced = rebalanceAllDayOrdersForDates(replaced, [created.date]);
          }
          commitSchedules(replaced, 'schedule_create_sync');
          setSupabaseError(null);
          console.info('[ScheduleSave] create synced', JSON.stringify({
            scheduleId: created.id,
            date: created.date,
            durationMs:
              (typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? Math.round(performance.now() - startedAt)
                : Math.round(Date.now() - startedAt)),
          }));
        } catch (error) {
          console.error('[Supabase] Failed to create schedule:', error);
          setSupabaseError(error.message || '予定の作成に失敗しました。');
          refreshFromSupabase('supabase_resync').catch(() => {});
          throw error;
        } finally {
          endSupabaseJob(jobMeta);
        }
      }
    }

    setShowForm(false);
  }, [beginSupabaseJob, commitSchedules, commitTasks, endSupabaseJob, refreshFromSupabase, setShowForm, setSupabaseError, userId]);

  // 予定削除ハンドラー（フォーム用）
  const handleDelete = useCallback(async (id) => {
  await handleScheduleDelete(id, { throwOnError: true });
    setShowForm(false);
  }, [handleScheduleDelete]);

  // フォーム閉じるハンドラー
  const handleClose = () => setShowForm(false);

  // 選択された日付の予定のみ表示
  const selectedDateStr = selectedDate ? toDateStrLocal(selectedDate) : '';
  const filteredSchedules = useMemo(() => {
    if (!selectedDateStr) return [];
    const allSchedules = Array.isArray(schedules) ? schedules : [];
    return allSchedules.filter((entry) => entry.date === selectedDateStr);
  }, [schedules, selectedDateStr]);

  return (
    <div 
      className="w-screen h-screen bg-gradient-to-br from-indigo-900 to-gray-900 text-gray-900 font-sans flex flex-col overflow-hidden"
      onWheel={(e) => {
        // モーダルが開いている場合は全体のスクロールを防止
        if (showSettings || showForm) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <TitleBar onSettingsClick={() => setShowSettings(true)} auth={titleBarAuth} />
      {isAuthenticated && (
        <>
          {supabaseError && (
            <div className="bg-red-600 text-white text-sm px-4 py-2 shadow-inner">
              Supabase同期でエラーが発生しました: {supabaseError}
            </div>
          )}
          {!supabaseError && isSupabaseSyncing && (
            <div className="bg-indigo-700 text-white text-sm px-4 py-2 shadow-inner">
              Supabaseと同期中です…
            </div>
          )}
        </>
      )}
      <main 
        className="flex-1 p-2 overflow-hidden flex relative"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseDown={handleMouseDown}
        ref={layoutContainerRef}
      >
        {/* ハンバーガーメニュー */}
        <div 
          className={`
            fixed bottom-4 z-30 transition-all duration-300
            ${isMobile && isTimelineOpen ? 'right-96' : 'right-4'}
          `}
          data-menu-container
        >
          {/* メニューボタン */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`
              w-8 h-8 rounded-full shadow-md transition-all duration-200 flex items-center justify-center relative
              bg-white border border-gray-200 hover:border-indigo-300 hover:shadow-lg hover:scale-105 cursor-pointer
              ${isMenuOpen ? 'bg-indigo-50 border-indigo-400 scale-105 shadow-lg' : ''}
            `}
            title={isMenuOpen ? "メニューを閉じる" : "メニューを開く"}
          >
            {/* ハンバーガー → × アニメーション */}
            <div className="relative w-3 h-3 flex items-center justify-center">
              {/* 1本目の線 */}
              <div className={`
                absolute w-3 h-0.5 rounded-full transition-all duration-300 
                ${isMenuOpen 
                  ? 'bg-indigo-600 rotate-45' 
                  : 'bg-gray-600 rotate-0 -translate-y-1'
                }
              `}></div>
              
              {/* 2本目の線（中央、×の時は消える） */}
              <div className={`
                absolute w-3 h-0.5 rounded-full transition-all duration-300
                ${isMenuOpen 
                  ? 'bg-indigo-600 opacity-0 scale-0' 
                  : 'bg-gray-600 opacity-100 scale-100'
                }
              `}></div>
              
              {/* 3本目の線 */}
              <div className={`
                absolute w-3 h-0.5 rounded-full transition-all duration-300
                ${isMenuOpen 
                  ? 'bg-indigo-600 -rotate-45' 
                  : 'bg-gray-600 rotate-0 translate-y-1'
                }
              `}></div>
            </div>
          </button>
          {/* メニュー項目 */}
          {isMenuOpen && (
            <div className={`
              absolute bottom-10 right-0 bg-white rounded-lg shadow-xl border border-gray-100 py-1 min-w-[120px]
              transition-all duration-200
              ${isMenuOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'}
            `}>
              <button
                onClick={() => {
                  undo();
                  setIsMenuOpen(false);
                }}
                disabled={!canUndo}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 text-sm transition-all duration-200 text-left bg-white
                  ${canUndo 
                    ? 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer' 
                    : 'text-gray-400 cursor-not-allowed'
                  }
                `}
                title={`Ctrl+Z${canUndo ? '' : ' - 利用不可'}`}
              >
                <span className="text-sm">↩️</span>
                <span className="font-medium">元に戻す</span>
              </button>
              <div className="border-t border-gray-100 mx-1"></div>
              <button
                onClick={() => {
                  redo();
                  setIsMenuOpen(false);
                }}
                disabled={!canRedo}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 text-sm transition-all duration-200 text-left bg-white
                  ${canRedo 
                    ? 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer' 
                    : 'text-gray-400 cursor-not-allowed'
                  }
                `}
                title={`Ctrl+Shift+Z${canRedo ? '' : ' - 利用不可'}`}
              >
                <span className="text-sm">↪️</span>
                <span className="font-medium">やり直し</span>
              </button>
            </div>
          )}
        </div>

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
                onScheduleMove={handleScheduleMove}
                onScheduleUpdate={handleScheduleUpdate}
                onAdd={handleAdd}
                onEdit={handleEdit}
                isMobile={isMobile}
                onToggleTask={handleToggleTask}
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
                    <div className="flex-1 overflow-hidden flex flex-col">
                      <CurrentDateTimeBar />
                      <Timeline 
                        schedules={filteredSchedules} 
                        selectedDate={selectedDate} 
                        onEdit={handleEdit}
                        onAdd={handleAdd}
                        onAddTask={handleAddTask}
                        onScheduleUpdate={handleScheduleUpdate}
                        onToggleTask={handleToggleTask}
                        activeTab={timelineActiveTab}
                        onTabChange={setTimelineActiveTab}
                        tasks={tasks}
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
                onScheduleMove={handleScheduleMove}
                onScheduleUpdate={handleScheduleUpdate}
                onAdd={handleAdd}
                onEdit={handleEdit}
                isMobile={isMobile}
                onToggleTask={handleToggleTask}
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
                `}
                data-layout-handle
                ></div>
              </div>
            </div>
            
            {/* タイムライン部分 */}
            <div 
              className="flex flex-col overflow-hidden pl-1"
              style={{ width: `${100 - splitRatio}%` }}
            >
              <CurrentDateTimeBar />
              <Timeline 
                schedules={filteredSchedules} 
                selectedDate={selectedDate} 
                onEdit={handleEdit}
                onAdd={handleAdd}
                onAddTask={handleAddTask}
                onScheduleUpdate={handleScheduleUpdate}
                onToggleTask={handleToggleTask}
                activeTab={timelineActiveTab}
                onTabChange={setTimelineActiveTab}
                tasks={tasks}
              />
            </div>
          </>
        )}
      </main>
      
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full h-[90vh] max-h-[90vh] flex flex-col overflow-hidden">
            <ScheduleForm 
              schedule={editingSchedule} 
              onSave={handleSave} 
              onClose={handleClose} 
              onDelete={editingSchedule?.id ? handleDelete : undefined}
              sendTestNotification={sendTestNotification}
            />
          </div>
        </div>
      )}

      {/* 設定モーダル */}
      <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
      />
    </div>
  );
}

export default App;
