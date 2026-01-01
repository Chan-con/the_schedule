
import React, { useState, useEffect, useCallback, useRef, useContext, useMemo } from 'react';
import { toDateStrLocal, fromDateStrLocal } from './utils/date';

import Calendar from './components/Calendar';
import Timeline from './components/Timeline';
import CurrentDateTimeBar from './components/CurrentDateTimeBar';
import ScheduleForm from './components/ScheduleForm';
import TitleBar from './components/TitleBar';
import SettingsModal from './components/SettingsModal';
import QuickMemoPad from './components/QuickMemoPad';
import { fetchQuickMemoForUser, saveQuickMemoForUser } from './utils/supabaseQuickMemo';
import { supabase } from './lib/supabaseClient';
import {
  fetchNotesForUser,
  fetchNoteForUserById,
  createNoteForUser,
  updateNoteForUser,
  deleteNoteForUser,
  fetchNoteDatesForUserInRange,
} from './utils/supabaseNotes';
import { clearDateHash, clearNoteHash, parseDateStrFromHash, parseNoteIdFromHash } from './utils/noteShare';
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
});

const normalizeSchedules = (schedules) => {
  if (!Array.isArray(schedules)) return [];
  return schedules.map(normalizeSchedule);
};

const createTempId = () => Date.now();

const QUICK_MEMO_STORAGE_KEY = 'quickMemoPadContent';
const NOTES_STORAGE_KEY = 'notes';
const NOTE_ARCHIVE_FLAGS_STORAGE_KEY = 'noteArchiveFlagsV1';
const NOTE_IMPORTANT_FLAGS_STORAGE_KEY = 'noteImportantFlagsV1';
const MEMO_SPLIT_STORAGE_KEY = 'memoSplitRatio';
const DEFAULT_MEMO_SPLIT_RATIO = 70;
const MEMO_TIMELINE_MIN = 35;
const MEMO_TIMELINE_MAX = 90;

const buildNoteArchiveUserKey = (userId) => (userId ? `u:${userId}` : 'local');

const normalizeArchiveFlags = (value) => {
  if (!value || typeof value !== 'object') return {};
  const next = {};
  Object.entries(value).forEach(([key, flag]) => {
    if (flag) {
      next[String(key)] = true;
    }
  });
  return next;
};

const applyImportantFlagsToNotes = (notes, flags) => {
  const list = Array.isArray(notes) ? notes : [];
  const safeFlags = normalizeArchiveFlags(flags);
  return list.map((note) => {
    const id = note?.id ?? null;
    if (id == null) return note;
    const explicit = note?.important;
    const important = typeof explicit === 'boolean' ? explicit : !!safeFlags[String(id)];
    return { ...note, important };
  });
};

const applyNoteFlagsToNotes = (notes, { archiveFlags, importantFlags } = {}) => {
  const withArchive = applyArchiveFlagsToNotes(notes, archiveFlags);
  return applyImportantFlagsToNotes(withArchive, importantFlags);
};

const applyArchiveFlagsToNotes = (notes, flags) => {
  const list = Array.isArray(notes) ? notes : [];
  const safeFlags = normalizeArchiveFlags(flags);
  return list.map((note) => {
    const id = note?.id ?? null;
    if (id == null) return note;
    const explicit = note?.archived;
    const archived = typeof explicit === 'boolean' ? explicit : !!safeFlags[String(id)];
    return { ...note, archived };
  });
};

const clampMemoSplitRatio = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_MEMO_SPLIT_RATIO;
  }
  return Math.min(Math.max(value, MEMO_TIMELINE_MIN), MEMO_TIMELINE_MAX);
};

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

  const loadLocalQuickMemo = useCallback(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    try {
      const stored = window.localStorage.getItem(QUICK_MEMO_STORAGE_KEY);
      if (typeof stored === 'string') {
        return stored;
      }
    } catch (error) {
      console.warn('⚠️ Failed to load quick memo from localStorage:', error);
    }

    return '';
  }, []);

  const loadLocalNotes = useCallback(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const stored = window.localStorage.getItem(NOTES_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      console.warn('⚠️ Failed to load notes from localStorage:', error);
    }

    return [];
  }, []);

  const saveLocalNotes = useCallback((nextNotes) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(Array.isArray(nextNotes) ? nextNotes : []));
    } catch (error) {
      console.warn('⚠️ Failed to persist notes to localStorage:', error);
    }
  }, []);

  const loadNoteArchiveFlags = useCallback((userKey) => {
    if (typeof window === 'undefined') {
      return {};
    }

    const key = typeof userKey === 'string' && userKey ? userKey : 'local';
    try {
      const stored = window.localStorage.getItem(NOTE_ARCHIVE_FLAGS_STORAGE_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return {};
      return normalizeArchiveFlags(parsed[key]);
    } catch (error) {
      console.warn('⚠️ Failed to load note archive flags from localStorage:', error);
      return {};
    }
  }, []);

  const saveNoteArchiveFlags = useCallback((userKey, nextFlags) => {
    if (typeof window === 'undefined') return;

    const key = typeof userKey === 'string' && userKey ? userKey : 'local';
    const safeNext = normalizeArchiveFlags(nextFlags);
    try {
      const stored = window.localStorage.getItem(NOTE_ARCHIVE_FLAGS_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      const root = parsed && typeof parsed === 'object' ? parsed : {};
      root[key] = safeNext;
      window.localStorage.setItem(NOTE_ARCHIVE_FLAGS_STORAGE_KEY, JSON.stringify(root));
    } catch (error) {
      console.warn('⚠️ Failed to persist note archive flags to localStorage:', error);
    }
  }, []);

  const initialLoadedSchedules = useMemo(() => loadLocalSchedules(), [loadLocalSchedules]);
  const historyApi = useHistory({ schedules: initialLoadedSchedules }, 100);

  // 履歴管理機能付きの予定・タスク状態
  const {
    state: historyState,
    setState: setHistoryState,
    replaceState,
    historyLength,
    currentIndex,
    lastActionType,
  } = historyApi;

  const historySetterRef = useRef(setHistoryState);
  useEffect(() => {
    historySetterRef.current = setHistoryState;
  }, [setHistoryState]);

  const schedules = useMemo(
    () => (Array.isArray(historyState?.schedules) ? historyState.schedules : []),
    [historyState?.schedules]
  );
  const taskSchedules = useMemo(
    () => (Array.isArray(schedules) ? schedules.filter((item) => item?.isTask) : []),
    [schedules]
  );

  const auth = useContext(AuthContext);
  const userId = auth?.user?.id || null;
  const noteArchiveUserKey = useMemo(() => buildNoteArchiveUserKey(userId), [userId]);
  const noteArchiveFlagsRef = useRef({});
  const noteImportantFlagsRef = useRef({});

  const loadNoteImportantFlags = useCallback((userKey) => {
    if (typeof window === 'undefined') {
      return {};
    }

    const key = typeof userKey === 'string' && userKey ? userKey : 'local';
    try {
      const stored = window.localStorage.getItem(NOTE_IMPORTANT_FLAGS_STORAGE_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return {};
      return normalizeArchiveFlags(parsed[key]);
    } catch (error) {
      console.warn('⚠️ Failed to load note important flags from localStorage:', error);
      return {};
    }
  }, []);

  const saveNoteImportantFlags = useCallback((userKey, nextFlags) => {
    if (typeof window === 'undefined') return;

    const key = typeof userKey === 'string' && userKey ? userKey : 'local';
    const safeNext = normalizeArchiveFlags(nextFlags);
    try {
      const stored = window.localStorage.getItem(NOTE_IMPORTANT_FLAGS_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      const root = parsed && typeof parsed === 'object' ? parsed : {};
      root[key] = safeNext;
      window.localStorage.setItem(NOTE_IMPORTANT_FLAGS_STORAGE_KEY, JSON.stringify(root));
    } catch (error) {
      console.warn('⚠️ Failed to persist note important flags to localStorage:', error);
    }
  }, []);
  useEffect(() => {
    noteArchiveFlagsRef.current = loadNoteArchiveFlags(noteArchiveUserKey);
    noteImportantFlagsRef.current = loadNoteImportantFlags(noteArchiveUserKey);
  }, [loadNoteArchiveFlags, loadNoteImportantFlags, noteArchiveUserKey]);
  const [isSupabaseSyncing, setIsSupabaseSyncing] = useState(false);
  const [isSupabaseSyncBlocking, setIsSupabaseSyncBlocking] = useState(false);
  const supabaseSyncOverlayTimerRef = useRef(null);
  const [supabaseError, setSupabaseError] = useState(null);
  const schedulesRef = useRef(schedules);
  const hasFetchedRemoteRef = useRef(false);
  const supabaseJobsRef = useRef(0);
  const quickMemoSkipSyncRef = useRef(false);
  const quickMemoLastSavedRef = useRef('');

  const beginSupabaseJob = useCallback(() => {
    supabaseJobsRef.current += 1;
  }, []);

  const endSupabaseJob = useCallback(() => {
    supabaseJobsRef.current = Math.max(0, supabaseJobsRef.current - 1);
  }, []);

  const persistQuickMemoToSupabase = useCallback(async (content) => {
    if (!userId) return;
    const safeContent = typeof content === 'string' ? content : '';
    if (quickMemoLastSavedRef.current === safeContent) {
      return;
    }

    const jobMeta = { kind: 'quickMemoSave' };
    beginSupabaseJob(jobMeta);
    try {
      await saveQuickMemoForUser(safeContent, userId);
      quickMemoLastSavedRef.current = safeContent;
      setSupabaseError(null);
    } catch (error) {
      console.error('[Supabase] Failed to save quick memo:', error);
      setSupabaseError(error.message || 'クイックメモの同期に失敗しました。');
      throw error;
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, endSupabaseJob, setSupabaseError, userId]);

  const commitSchedules = useCallback((nextSchedules, actionType = 'unknown') => {
    const normalizedSchedules = normalizeSchedules(nextSchedules);
    schedulesRef.current = normalizedSchedules;
    setHistoryState(
      {
        schedules: normalizedSchedules,
      },
      actionType
    );
  }, [setHistoryState]);

  const replaceAppState = useCallback(
    (nextSchedules, actionType = 'replace') => {
      const normalizedSchedules = normalizeSchedules(nextSchedules);
      schedulesRef.current = normalizedSchedules;

      const applyHistory = typeof replaceState === 'function' ? replaceState : historySetterRef.current;
      applyHistory(
        {
          schedules: normalizedSchedules,
        },
        actionType
      );
    },
    [replaceState]
  );

  useEffect(() => {
    schedulesRef.current = schedules;
  }, [schedules]);

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

  const notificationEntries = useMemo(
    () => (Array.isArray(schedules) ? schedules : []),
    [schedules]
  );
  
  const [selectedDate, setSelectedDate] = useState(new Date());
  const selectedDateStr = useMemo(() => (selectedDate ? toDateStrLocal(selectedDate) : ''), [selectedDate]);
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
  const [memoSplitRatio, setMemoSplitRatio] = useState(DEFAULT_MEMO_SPLIT_RATIO);
  const [isMemoResizing, setIsMemoResizing] = useState(false);
  const [quickMemo, setQuickMemo] = useState('');
  const [isQuickMemoLoaded, setIsQuickMemoLoaded] = useState(false);

  const [notes, setNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [sharedNoteId, setSharedNoteId] = useState(null);
  const lastLoginRequestForNoteRef = useRef(null);
  const notesRef = useRef([]);

  useEffect(() => {
    notesRef.current = Array.isArray(notes) ? notes : [];
  }, [notes]);

  const openSharedNote = useCallback(
    (noteId) => {
      if (noteId == null) return;
      setTimelineActiveTab('notes');

      const shouldOpenTimeline = isMobile
        || (typeof window !== 'undefined' && window.innerWidth < 768);
      if (shouldOpenTimeline) {
        setIsTimelineOpen(true);
      }

      setActiveNoteId(noteId);
    },
    [isMobile]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const parseDateStrFromSearch = () => {
      try {
        const params = new URLSearchParams(window.location.search || '');
        const value = params.get('date');
        if (value == null) return null;
        const trimmed = String(value).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
        return trimmed;
      } catch {
        return null;
      }
    };

    const clearDateSearchParam = () => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('date');
        window.history.replaceState(null, '', url.toString());
      } catch {
        // ignore
      }
    };

    const applyFromHash = () => {
      const noteId = parseNoteIdFromHash(window.location.hash);
      setSharedNoteId(noteId);

      const dateStrFromHash = parseDateStrFromHash(window.location.hash);
      const dateStrFromSearch = parseDateStrFromSearch();
      const dateStr = dateStrFromHash || dateStrFromSearch;
      if (dateStr) {
        const nextDate = fromDateStrLocal(dateStr);
        if (nextDate) {
          setSelectedDate(nextDate);
          setTimelineActiveTab('timeline');
          if (isMobile) {
            setIsTimelineOpen(true);
          }
        }

        // 通知クリックなど一時的な深いリンク用途なので、適用後にURLをクリーンにする。
        if (dateStrFromHash) {
          clearDateHash();
        }
        if (dateStrFromSearch) {
          clearDateSearchParam();
        }
      }
    };

    applyFromHash();
    window.addEventListener('hashchange', applyFromHash);
    return () => window.removeEventListener('hashchange', applyFromHash);
  }, [isMobile]);

  useEffect(() => {
    if (sharedNoteId == null) return;
    if (isAuthLoading) return;

    if (!userId) {
      if (typeof authLogin === 'function' && !isAuthProcessing) {
        const key = String(sharedNoteId);
        if (lastLoginRequestForNoteRef.current !== key) {
          lastLoginRequestForNoteRef.current = key;
          authLogin().catch((error) => {
            console.error('[Share] Failed to start login for shared note:', error);
          });
        }
      }
      return;
    }

    let cancelled = false;
    fetchNoteForUserById({ userId, id: sharedNoteId })
      .then((fresh) => {
        if (cancelled) return;
        const resolvedId = fresh?.id ?? sharedNoteId;
        setNotes((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const archived = typeof fresh?.archived === 'boolean'
            ? fresh.archived
            : !!noteArchiveFlagsRef.current?.[String(resolvedId)];
          const important = typeof fresh?.important === 'boolean'
            ? fresh.important
            : !!noteImportantFlagsRef.current?.[String(resolvedId)];
          const nextNote = { ...fresh, archived, important };
          const exists = list.some((n) => (n?.id ?? null) === resolvedId);
          if (exists) {
            return list.map((n) => ((n?.id ?? null) === resolvedId ? nextNote : n));
          }
          return [nextNote, ...list];
        });
        openSharedNote(resolvedId);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[Share] Failed to fetch shared note:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [authLogin, isAuthLoading, isAuthProcessing, openSharedNote, sharedNoteId, userId]);
  const [calendarNoteDates, setCalendarNoteDates] = useState([]);
  const calendarVisibleRangeRef = useRef(null);
  const notePendingPatchRef = useRef(new Map());
  const noteSaveTimersRef = useRef(new Map());
  const supabaseSyncStateRef = useRef({
    timerId: null,
    inFlight: false,
    pending: false,
    lastReason: null,
  });
  const applyQuickMemoValue = useCallback((value = '') => {
    const safeValue = typeof value === 'string' ? value : '';
    quickMemoSkipSyncRef.current = true;
    quickMemoLastSavedRef.current = safeValue;
    setQuickMemo(safeValue);
  }, []);
  const timelineRef = useRef(null);
  const mobileTimelineRef = useRef(null);
  const memoResizeContextRef = useRef(null);
  
  // ハンバーガーメニューの開閉状態
  
  // 通知システム
  const { cancelScheduleNotifications, sendTestNotification } = useNotifications(notificationEntries);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(MEMO_SPLIT_STORAGE_KEY);
      if (!stored) return;
      const parsed = parseFloat(stored);
      if (!Number.isNaN(parsed)) {
        setMemoSplitRatio(clampMemoSplitRatio(parsed));
      }
    } catch (error) {
      console.warn('⚠️ Failed to load memo split ratio:', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(MEMO_SPLIT_STORAGE_KEY, String(memoSplitRatio));
    } catch (error) {
      console.warn('⚠️ Failed to persist memo split ratio:', error);
    }
  }, [memoSplitRatio]);

  const refreshFromSupabase = useCallback(
    async (actionType = 'supabase_resync', options = {}) => {
      if (!userId) return;

      const { showSpinner = false, isCancelled } = options;
      const isCancelledFn = typeof isCancelled === 'function' ? isCancelled : () => false;

      if (showSpinner) {
        setIsSupabaseSyncing(true);
        setIsSupabaseSyncBlocking(false);
        if (supabaseSyncOverlayTimerRef.current) {
          clearTimeout(supabaseSyncOverlayTimerRef.current);
          supabaseSyncOverlayTimerRef.current = null;
        }
        supabaseSyncOverlayTimerRef.current = setTimeout(() => {
          setIsSupabaseSyncBlocking(true);
        }, 1000);
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
        const visibleRange = calendarVisibleRangeRef.current;
        const hasVisibleRange = !!(visibleRange?.startDate && visibleRange?.endDate);

        const [remoteSchedules, remoteQuickMemo, remoteNotes, remoteNoteDates] = await Promise.all([
          fetchSchedulesForUser(userId),
          fetchQuickMemoForUser(userId),
          fetchNotesForUser(userId),
          hasVisibleRange
            ? fetchNoteDatesForUserInRange({
                userId,
                startDate: visibleRange.startDate,
                endDate: visibleRange.endDate,
              })
            : Promise.resolve(null),
        ]);
        if (isCancelledFn()) return;

        replaceAppState(remoteSchedules, actionType);
        applyQuickMemoValue(remoteQuickMemo);

        // ノート同期: pending patch（未送信の編集）と下書きを保持して上書き事故を防ぐ
        {
          const remoteList = Array.isArray(remoteNotes) ? remoteNotes : [];
          const pendingMap = notePendingPatchRef.current;
          const localList = Array.isArray(notesRef.current) ? notesRef.current : [];
          const draftNotes = localList.filter((note) => note?.__isDraft);
          const draftIdSet = new Set(draftNotes.map((note) => note?.id).filter((id) => id != null));

          const mergedRemote = remoteList.map((note) => {
            const id = note?.id ?? null;
            if (id == null) return note;
            const pendingPatch = pendingMap.get(id);
            if (!pendingPatch) return note;
            const localNote = localList.find((n) => (n?.id ?? null) === id) || null;
            const nextUpdatedAt = localNote?.updated_at ?? note?.updated_at;
            return {
              ...note,
              ...pendingPatch,
              ...(nextUpdatedAt ? { updated_at: nextUpdatedAt } : {}),
            };
          });

          const combined = [...draftNotes, ...mergedRemote.filter((note) => !draftIdSet.has(note?.id ?? null))];
          setNotes(applyNoteFlagsToNotes(combined, {
            archiveFlags: noteArchiveFlagsRef.current,
            importantFlags: noteImportantFlagsRef.current,
          }));
        }

        if (Array.isArray(remoteNoteDates)) {
          setCalendarNoteDates(remoteNoteDates);
        }

        setSupabaseError(null);
        hasFetchedRemoteRef.current = true;
        console.info('[SupabaseSync] payload', JSON.stringify({
          actionType,
          schedules: remoteSchedules.slice(0, 10),
        }));
        console.info('[SupabaseSync] success', JSON.stringify({
          actionType,
          count: remoteSchedules.length,
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
          setIsSupabaseSyncBlocking(false);
          if (supabaseSyncOverlayTimerRef.current) {
            clearTimeout(supabaseSyncOverlayTimerRef.current);
            supabaseSyncOverlayTimerRef.current = null;
          }
        }
        console.info('[SupabaseSync] finished', JSON.stringify({
          actionType,
          showSpinner,
          cancelled: isCancelledFn(),
        }));
      }
    },
    [applyQuickMemoValue, beginSupabaseJob, endSupabaseJob, replaceAppState, userId]
  );

  useEffect(() => {
    // ログイン/ログアウトやユーザー切替で確実に解除
    setIsSupabaseSyncing(false);
    setIsSupabaseSyncBlocking(false);
    if (supabaseSyncOverlayTimerRef.current) {
      clearTimeout(supabaseSyncOverlayTimerRef.current);
      supabaseSyncOverlayTimerRef.current = null;
    }
  }, [userId]);

  const requestSupabaseSync = useCallback(
    (reason = 'unknown', options = {}) => {
      if (!userId) return;
      const { showSpinner = false } = options;
      const state = supabaseSyncStateRef.current;
      state.pending = true;
      state.lastReason = reason;

      if (state.timerId) {
        clearTimeout(state.timerId);
      }

      state.timerId = setTimeout(async () => {
        const runState = supabaseSyncStateRef.current;
        runState.timerId = null;

        if (runState.inFlight) {
          runState.pending = true;
          return;
        }

        runState.inFlight = true;
        const actionType = `supabase_resync:${String(runState.lastReason || 'unknown')}`;
        runState.pending = false;
        try {
          await refreshFromSupabase(actionType, { showSpinner });
        } catch {
          // refreshFromSupabase がエラー状態を保持するためここでは握りつぶす
        } finally {
          runState.inFlight = false;
          if (runState.pending) {
            // 直近の要求が残っていればもう一度（短いデバウンス）
            requestSupabaseSync(runState.lastReason || 'pending', { showSpinner: false });
          }
        }
      }, 250);
    },
    [refreshFromSupabase, userId]
  );

  useEffect(() => {
    if (auth?.isLoading) return;

    if (!userId) {
      hasFetchedRemoteRef.current = false;
      setSupabaseError(null);
      setIsSupabaseSyncing(false);
      replaceAppState(loadLocalSchedules(), 'local_restore');
      const localMemo = loadLocalQuickMemo();
      applyQuickMemoValue(localMemo);

      // ローカルノート
      const allNotes = loadLocalNotes();
      const nextNotes = allNotes
        .slice()
        .sort((a, b) => String(b?.updated_at ?? '').localeCompare(String(a?.updated_at ?? '')));
      setNotes(applyNoteFlagsToNotes(nextNotes, {
        archiveFlags: noteArchiveFlagsRef.current,
        importantFlags: noteImportantFlagsRef.current,
      }));
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
  }, [applyQuickMemoValue, auth?.isLoading, loadLocalNotes, loadLocalQuickMemo, loadLocalSchedules, refreshFromSupabase, replaceAppState, selectedDateStr, userId]);

  // Web: フォーカス復帰/表示復帰/オンライン復帰で安全に再同期
  useEffect(() => {
    if (!userId) return;
    if (typeof window === 'undefined') return;

    const handleFocus = () => requestSupabaseSync('focus');
    const handleOnline = () => requestSupabaseSync('online');
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestSupabaseSync('visibility');
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [requestSupabaseSync, userId]);

  // Supabase Realtime: 他端末/他ウィンドウのノート変更を検知して再同期
  useEffect(() => {
    if (!userId) return;

    let isDisposed = false;
    const channel = supabase
      .channel(`notes:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notes',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (isDisposed) return;
          console.info('[SupabaseRealtime] notes changed', JSON.stringify({
            eventType: payload?.eventType,
            table: payload?.table,
            timestamp: new Date().toISOString(),
          }));
          requestSupabaseSync('realtime:notes');
        }
      )
      .subscribe((status) => {
        console.info('[SupabaseRealtime] notes subscription', JSON.stringify({ status }));
      });

    return () => {
      isDisposed = true;
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, [requestSupabaseSync, userId]);

  // フォーカスが変わらない（デスクトップアプリ等）環境向けの保険: 定期的に再同期
  useEffect(() => {
    if (!userId) return;
    if (typeof window === 'undefined') return;

    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      requestSupabaseSync('interval');
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [requestSupabaseSync, userId]);

  const refreshCalendarNoteDates = useCallback(async () => {
    const range = calendarVisibleRangeRef.current;
    if (!range?.startDate || !range?.endDate) return;

    if (!userId) {
      const allNotes = loadLocalNotes();
      const dateSet = new Set();
      allNotes.forEach((note) => {
        const createdAt = note?.created_at;
        if (!createdAt) return;
        const createdDate = toDateStrLocal(new Date(createdAt));
        if (!createdDate) return;
        if (createdDate >= range.startDate && createdDate <= range.endDate) {
          dateSet.add(createdDate);
        }
      });
      setCalendarNoteDates(Array.from(dateSet));
      return;
    }

    try {
      const dates = await fetchNoteDatesForUserInRange({
        userId,
        startDate: range.startDate,
        endDate: range.endDate,
      });
      setCalendarNoteDates(Array.isArray(dates) ? dates : []);
    } catch (error) {
      console.error('[Supabase] Failed to fetch note dates:', error);
    }
  }, [loadLocalNotes, userId]);

  const handleCalendarVisibleRangeChange = useCallback((range) => {
    if (!range?.startDate || !range?.endDate) return;
    calendarVisibleRangeRef.current = { startDate: range.startDate, endDate: range.endDate };
    refreshCalendarNoteDates().catch(() => {});
  }, [refreshCalendarNoteDates]);

  const handleAddNote = useCallback(async () => {
    if (!selectedDateStr) return;
    const nowIso = new Date().toISOString();

    const draftNote = {
      id: createTempId(),
      date: selectedDateStr,
      title: '',
      content: '',
      created_at: nowIso,
      updated_at: nowIso,
      archived: false,
      __isDraft: !!userId,
    };

    // 「＋」を押したら即モーダルを開く（DB待ちしない）
    setNotes((prev) => [draftNote, ...(Array.isArray(prev) ? prev : [])]);
    setActiveNoteId(draftNote.id);

    if (!userId) {
      const allNotes = [...loadLocalNotes(), { ...draftNote, __isDraft: false }];
      saveLocalNotes(allNotes);
      refreshCalendarNoteDates().catch(() => {});
      return;
    }
  }, [loadLocalNotes, refreshCalendarNoteDates, saveLocalNotes, selectedDateStr, userId]);

  const handleUpdateNote = useCallback((noteId, patch) => {
    if (noteId == null) return;
    const safePatch = patch && typeof patch === 'object' ? patch : {};
    const nowIso = new Date().toISOString();

    setNotes((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map((note) => {
        if ((note?.id ?? null) !== noteId) return note;
        return { ...note, ...safePatch, updated_at: nowIso };
      });
    });

    if (!userId) {
      const allNotes = loadLocalNotes();
      const nextAllNotes = allNotes.map((note) => {
        if ((note?.id ?? null) !== noteId) return note;
        return { ...note, ...safePatch, updated_at: nowIso };
      });
      saveLocalNotes(nextAllNotes);
      return;
    }

    const currentNote = notesRef.current.find((note) => (note?.id ?? null) === noteId) || null;
    if (currentNote?.__isDraft) {
      // 下書き（未保存）はDBへ送らない。閉じるタイミングで作成する。
      return;
    }

    const pendingMap = notePendingPatchRef.current;
    const existing = pendingMap.get(noteId) || {};
    pendingMap.set(noteId, { ...existing, ...safePatch });

    const timers = noteSaveTimersRef.current;
    if (timers.has(noteId)) {
      clearTimeout(timers.get(noteId));
    }

    const timeoutId = setTimeout(async () => {
      const mergedPatch = pendingMap.get(noteId);
      pendingMap.delete(noteId);
      const jobMeta = { kind: 'noteUpdate' };
      beginSupabaseJob(jobMeta);
      try {
        const updated = await updateNoteForUser({ userId, id: noteId, patch: mergedPatch });
        setNotes((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          return list.map((note) => {
            if ((note?.id ?? null) !== noteId) return note;
            const archived = typeof note?.archived === 'boolean' ? note.archived : !!noteArchiveFlagsRef.current?.[String(noteId)];
            const important = typeof note?.important === 'boolean' ? note.important : !!noteImportantFlagsRef.current?.[String(noteId)];
            return { ...updated, archived, important };
          });
        });
        setSupabaseError(null);
      } catch (error) {
        console.error('[Supabase] Failed to update note:', error);
        setSupabaseError(error.message || 'ノートの更新に失敗しました。');
      } finally {
        endSupabaseJob(jobMeta);
      }
    }, 600);

    timers.set(noteId, timeoutId);
  }, [beginSupabaseJob, endSupabaseJob, loadLocalNotes, saveLocalNotes, userId]);

  const handleToggleArchiveNote = useCallback((note, nextArchived) => {
    if (!note) return;
    const noteId = note?.id ?? null;
    if (noteId == null) return;
    if (note?.__isDraft) return;

    // ログイン中はDBへ同期
    if (userId) {
      handleUpdateNote(noteId, { archived: !!nextArchived });
      return;
    }

    const idKey = String(noteId);
    const archived = !!nextArchived;
    const nextFlags = { ...(noteArchiveFlagsRef.current || {}) };
    if (archived) {
      nextFlags[idKey] = true;
    } else {
      delete nextFlags[idKey];
    }

    noteArchiveFlagsRef.current = nextFlags;
    saveNoteArchiveFlags(noteArchiveUserKey, nextFlags);

    setNotes((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map((n) => ((n?.id ?? null) === noteId ? { ...n, archived } : n));
    });

    const allNotes = loadLocalNotes();
    const nextAllNotes = allNotes.map((n) => ((n?.id ?? null) === noteId ? { ...n, archived } : n));
    saveLocalNotes(nextAllNotes);
  }, [handleUpdateNote, loadLocalNotes, noteArchiveUserKey, saveLocalNotes, saveNoteArchiveFlags, userId]);

  const handleToggleImportantNote = useCallback((note, nextImportant) => {
    if (!note) return;
    const noteId = note?.id ?? null;
    if (noteId == null) return;
    if (note?.__isDraft) return;

    const idKey = String(noteId);
    const important = !!nextImportant;
    const nextFlags = { ...(noteImportantFlagsRef.current || {}) };
    if (important) {
      nextFlags[idKey] = true;
    } else {
      delete nextFlags[idKey];
    }

    noteImportantFlagsRef.current = nextFlags;
    saveNoteImportantFlags(noteArchiveUserKey, nextFlags);

    setNotes((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map((n) => ((n?.id ?? null) === noteId ? { ...n, important } : n));
    });

    const allNotes = loadLocalNotes();
    const nextAllNotes = allNotes.map((n) => ((n?.id ?? null) === noteId ? { ...n, important } : n));
    saveLocalNotes(nextAllNotes);
  }, [loadLocalNotes, noteArchiveUserKey, saveLocalNotes, saveNoteImportantFlags]);

  const handleRequestCloseNote = useCallback((noteId) => {
    setActiveNoteId(null);

    if (typeof window !== 'undefined') {
      const fromHash = parseNoteIdFromHash(window.location.hash);
      if (fromHash != null && noteId != null && String(fromHash) === String(noteId)) {
        clearNoteHash();
        // clearNoteHash() は replaceState を使うので hashchange が発火しない。
        // sharedNoteId を明示的にリセットしないと、同じ共有リンクを再クリックしても
        // state が変わらず「2回目以降に開けない」ことがある。
        setSharedNoteId(null);
      }
    }
    if (noteId == null) return;

    const currentNote = notesRef.current.find((note) => (note?.id ?? null) === noteId) || null;
    if (!currentNote) return;

    const titleTrimmed = typeof currentNote.title === 'string' ? currentNote.title.trim() : '';
    const contentTrimmed = typeof currentNote.content === 'string' ? currentNote.content.trim() : '';
    const shouldDeleteBecauseEmpty = !titleTrimmed && !contentTrimmed;

    if (!userId) {
      if (!shouldDeleteBecauseEmpty) {
        return;
      }

      const allNotes = loadLocalNotes();
      const nextAllNotes = allNotes.filter((n) => (n?.id ?? null) !== noteId);
      saveLocalNotes(nextAllNotes);
      setNotes((prev) => (Array.isArray(prev) ? prev.filter((n) => (n?.id ?? null) !== noteId) : []));
      refreshCalendarNoteDates().catch(() => {});
      return;
    }

    if (currentNote.__isDraft) {
      if (shouldDeleteBecauseEmpty) {
        setNotes((prev) => (Array.isArray(prev) ? prev.filter((n) => (n?.id ?? null) !== noteId) : []));
        return;
      }

      const jobMeta = { kind: 'noteCreate' };
      beginSupabaseJob(jobMeta);
      createNoteForUser({
        userId,
        date: currentNote.date || selectedDateStr,
        title: currentNote.title ?? '',
        content: currentNote.content ?? '',
      })
        .then(async (created) => {
          setNotes((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const filtered = list.filter((n) => (n?.id ?? null) !== noteId);
            return [created, ...filtered];
          });
          setSupabaseError(null);
          refreshCalendarNoteDates().catch(() => {});
          try {
            const freshAll = await fetchNotesForUser(userId);
            setNotes(applyNoteFlagsToNotes(Array.isArray(freshAll) ? freshAll : [], {
              archiveFlags: noteArchiveFlagsRef.current,
              importantFlags: noteImportantFlagsRef.current,
            }));
          } catch {
            // 失敗しても作成済みのローカル状態は維持
          }
        })
        .catch((error) => {
          console.error('[Supabase] Failed to create note:', error);
          setSupabaseError(error.message || 'ノートの作成に失敗しました。');
        })
        .finally(() => {
          endSupabaseJob(jobMeta);
        });
      return;
    }

    // 既存ノート: タイトル/本文が空なら削除
    if (shouldDeleteBecauseEmpty) {
      const timers = noteSaveTimersRef.current;
      const pendingMap = notePendingPatchRef.current;
      if (timers.has(noteId)) {
        clearTimeout(timers.get(noteId));
        timers.delete(noteId);
      }
      pendingMap.delete(noteId);

      const jobMeta = { kind: 'noteDelete' };
      beginSupabaseJob(jobMeta);
      deleteNoteForUser({ userId, id: noteId })
        .then(async () => {
          setNotes((prev) => (Array.isArray(prev) ? prev.filter((n) => (n?.id ?? null) !== noteId) : []));
          setSupabaseError(null);
          refreshCalendarNoteDates().catch(() => {});
          try {
            const freshAll = await fetchNotesForUser(userId);
            setNotes(applyNoteFlagsToNotes(Array.isArray(freshAll) ? freshAll : [], {
              archiveFlags: noteArchiveFlagsRef.current,
              importantFlags: noteImportantFlagsRef.current,
            }));
          } catch {
            // ignore
          }
        })
        .catch((error) => {
          console.error('[Supabase] Failed to delete note:', error);
          setSupabaseError(error.message || 'ノートの削除に失敗しました。');
        })
        .finally(() => {
          endSupabaseJob(jobMeta);
        });
      return;
    }

    // 既存ノート: 閉じるタイミングで、未送信のpatchがあれば即flush
    const pendingMap = notePendingPatchRef.current;
    const timers = noteSaveTimersRef.current;
    const mergedPatch = pendingMap.get(noteId);

    if (timers.has(noteId)) {
      clearTimeout(timers.get(noteId));
      timers.delete(noteId);
    }

    if (!mergedPatch || Object.keys(mergedPatch).length === 0) {
      return;
    }

    pendingMap.delete(noteId);
    const jobMeta = { kind: 'noteUpdate' };
    beginSupabaseJob(jobMeta);
    updateNoteForUser({ userId, id: noteId, patch: mergedPatch })
      .then(async (updated) => {
        setNotes((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          return list.map((note) => {
            if ((note?.id ?? null) !== noteId) return note;
            const archived = typeof note?.archived === 'boolean' ? note.archived : !!noteArchiveFlagsRef.current?.[String(noteId)];
            const important = typeof note?.important === 'boolean' ? note.important : !!noteImportantFlagsRef.current?.[String(noteId)];
            return { ...updated, archived, important };
          });
        });
        setSupabaseError(null);
        try {
          const freshAll = await fetchNotesForUser(userId);
          setNotes(applyNoteFlagsToNotes(Array.isArray(freshAll) ? freshAll : [], {
            archiveFlags: noteArchiveFlagsRef.current,
            importantFlags: noteImportantFlagsRef.current,
          }));
        } catch {
          // ignore
        }
      })
      .catch((error) => {
        console.error('[Supabase] Failed to update note:', error);
        setSupabaseError(error.message || 'ノートの更新に失敗しました。');
      })
      .finally(() => {
        endSupabaseJob(jobMeta);
      });
  }, [
    beginSupabaseJob,
    endSupabaseJob,
    loadLocalNotes,
    refreshCalendarNoteDates,
    saveLocalNotes,
    selectedDateStr,
    userId,
  ]);

  useEffect(() => {
    if (!userId) return;
    if (activeNoteId == null) return;

    const currentNote = notesRef.current.find((note) => (note?.id ?? null) === activeNoteId) || null;
    if (!currentNote || currentNote.__isDraft) return;

    let cancelled = false;
    fetchNoteForUserById({ userId, id: activeNoteId })
      .then((fresh) => {
        if (cancelled) return;
        setNotes((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          return list.map((note) => {
            if ((note?.id ?? null) !== activeNoteId) return note;
            const archived = typeof note?.archived === 'boolean' ? note.archived : !!noteArchiveFlagsRef.current?.[String(activeNoteId)];
            const important = typeof note?.important === 'boolean' ? note.important : !!noteImportantFlagsRef.current?.[String(activeNoteId)];
            return { ...fresh, archived, important };
          });
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[Supabase] Failed to fetch note:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [activeNoteId, userId]);

  const handleDeleteNote = useCallback(async (note) => {
    if (!note) return;
    const noteId = note?.id ?? null;
    if (noteId == null) return;

    // 重要フラグの掃除（ログイン有無に関わらずローカル保持）
    {
      const idKey = String(noteId);
      const nextFlags = { ...(noteImportantFlagsRef.current || {}) };
      if (nextFlags[idKey]) {
        delete nextFlags[idKey];
        noteImportantFlagsRef.current = nextFlags;
        saveNoteImportantFlags(noteArchiveUserKey, nextFlags);
      }
    }

    if (!userId) {
      const allNotes = loadLocalNotes();
      const nextAllNotes = allNotes.filter((n) => (n?.id ?? null) !== noteId);
      saveLocalNotes(nextAllNotes);
      setNotes((prev) => (Array.isArray(prev) ? prev.filter((n) => (n?.id ?? null) !== noteId) : []));
      refreshCalendarNoteDates().catch(() => {});
      return;
    }

    const jobMeta = { kind: 'noteDelete' };
    beginSupabaseJob(jobMeta);
    try {
      await deleteNoteForUser({ userId, id: noteId });
      setNotes((prev) => (Array.isArray(prev) ? prev.filter((n) => (n?.id ?? null) !== noteId) : []));
      setSupabaseError(null);
      refreshCalendarNoteDates().catch(() => {});
    } catch (error) {
      console.error('[Supabase] Failed to delete note:', error);
      setSupabaseError(error.message || 'ノートの削除に失敗しました。');
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, endSupabaseJob, loadLocalNotes, noteArchiveUserKey, refreshCalendarNoteDates, saveLocalNotes, saveNoteImportantFlags, userId]);
  
  // メニュー外クリックでメニューを閉じる
  
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

  // モバイルブラウザのビューポート高さを動的に設定
  useEffect(() => {
    const setViewportHeight = () => {
      // visualViewportを使用（より正確）
      const visualViewport = window.visualViewport;
      const viewportHeight = visualViewport ? visualViewport.height : window.innerHeight;
      
      // 実際のビューポート高さを取得してCSS変数に設定
      const vh = viewportHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
      
      // デバッグログ
      if (isMobile) {
        console.log('📐 Viewport height updated:', {
          innerHeight: window.innerHeight,
          visualViewportHeight: visualViewport ? visualViewport.height : 'N/A',
          vh: vh,
          calculated: viewportHeight
        });
      }
    };

    // 初期設定
    setViewportHeight();
    
    // 短い遅延後にもう一度実行（初期レンダリング後）
    setTimeout(setViewportHeight, 100);
    setTimeout(setViewportHeight, 500);
    setTimeout(setViewportHeight, 1000);
    
    // リサイズ時とオリエンテーション変更時に更新
    window.addEventListener('resize', setViewportHeight);
    window.addEventListener('orientationchange', setViewportHeight);
    
    // ビューポートの変更を検知（よりアグレッシブに）
    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener('resize', setViewportHeight);
      visualViewport.addEventListener('scroll', setViewportHeight);
    }
    
    // iOS Safariでスクロール時にアドレスバーが表示/非表示になる場合に対応
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setViewportHeight();
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('resize', setViewportHeight);
      window.removeEventListener('orientationchange', setViewportHeight);
      window.removeEventListener('scroll', handleScroll);
      if (visualViewport) {
        visualViewport.removeEventListener('resize', setViewportHeight);
        visualViewport.removeEventListener('scroll', setViewportHeight);
      }
    };
  }, [isMobile]);

  // シンプルメモの読み込み
  useEffect(() => {
    const localMemo = loadLocalQuickMemo();
    applyQuickMemoValue(localMemo);
    setIsQuickMemoLoaded(true);
  }, [applyQuickMemoValue, loadLocalQuickMemo]);

  // シンプルメモの保存
  useEffect(() => {
    if (!isQuickMemoLoaded || typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(QUICK_MEMO_STORAGE_KEY, quickMemo);
    } catch (error) {
      console.warn('⚠️ Failed to persist quick memo:', error);
    }
  }, [isQuickMemoLoaded, quickMemo]);

  useEffect(() => {
    if (!isQuickMemoLoaded || !userId) return;

    if (quickMemoSkipSyncRef.current) {
      quickMemoSkipSyncRef.current = false;
      return;
    }

    const handler = setTimeout(() => {
      persistQuickMemoToSupabase(quickMemo).catch(() => {});
    }, 800);

    return () => clearTimeout(handler);
  }, [isQuickMemoLoaded, persistQuickMemoToSupabase, quickMemo, userId]);

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

  // 起動時に設定からレイアウト読み込み
  useEffect(() => {
    (async () => {
      const savedRatio = localStorage.getItem('splitRatio');
      if (savedRatio) {
        const v = parseFloat(savedRatio);
        if (!isNaN(v)) {
          setSplitRatio(v);
          console.log('[layout] splitRatio loaded from localStorage:', v);
        }
      }
      setLayoutLoaded(true);
    })();
  }, []);

  // 分割比率変更時に保存（ロード完了後）
  useEffect(() => {
    if (!layoutLoaded) return; // 初期ロード完了までは保存しない
    localStorage.setItem('splitRatio', String(splitRatio));
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

  // タッチダウンハンドラー（モバイル用リサイズ）
  const handleTouchStartResize = useCallback((event) => {
    if (!event || !event.touches || event.touches.length === 0) {
      return;
    }

    const target = event.target;
    if (!target || !target.closest('[data-layout-handle]')) {
      return;
    }

    event.preventDefault();
    setIsDragging(true);
  }, []);

  // タッチムーブハンドラー（モバイル用リサイズ）
  const handleTouchMoveResize = useCallback((event) => {
    if (!isDragging || !event.touches || event.touches.length === 0) {
      return;
    }
    event.preventDefault();
    handleMouseMove({ clientX: event.touches[0].clientX });
  }, [isDragging, handleMouseMove]);

  // タッチエンドハンドラー（モバイル用リサイズ）
  const handleTouchEndResize = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  // タイムライン開閉ハンドラー
  const closeTimeline = () => {
    setIsTimelineOpen(false);
  };

  const handleQuickMemoChange = useCallback((value) => {
    setQuickMemo(value);
  }, [setQuickMemo]);

  const updateMemoSplitFromClientY = useCallback((clientY) => {
    const context = memoResizeContextRef.current;
    if (!context || !context.rect || typeof clientY !== 'number') return;
    const { top, height } = context.rect;
    if (!height) return;
    const relative = ((clientY - top) / height) * 100;
    setMemoSplitRatio((prev) => {
      const next = clampMemoSplitRatio(relative);
      return prev === next ? prev : next;
    });
  }, []);

  const handleMemoResizeStart = useCallback((event, containerRef) => {
    if (!containerRef?.current) return;
    if ('button' in event && event.button !== 0) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    if (!rect || !rect.height) return;

    event.preventDefault();
    event.stopPropagation();
    memoResizeContextRef.current = { rect };
    setIsMemoResizing(true);

    const clientY = 'touches' in event ? event.touches?.[0]?.clientY : event.clientY;
    if (typeof clientY === 'number') {
      updateMemoSplitFromClientY(clientY);
    }
  }, [updateMemoSplitFromClientY]);

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
    const onTouchMove = (event) => handleTouchMoveResize(event);
    const onTouchEnd = () => handleTouchEndResize();

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [handleMouseMove, handleMouseUp, handleTouchMoveResize, handleTouchEndResize, isDragging]);

  useEffect(() => {
    if (!isMemoResizing) return undefined;

    const handleMove = (event) => {
      const clientY = event.touches ? event.touches[0]?.clientY : event.clientY;
      if (typeof clientY === 'number') {
        if (event.cancelable) {
          event.preventDefault();
        }
        updateMemoSplitFromClientY(clientY);
      }
    };

    const stopResizing = () => {
      setIsMemoResizing(false);
      memoResizeContextRef.current = null;
      document.body.style.userSelect = '';
    };

    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', stopResizing);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', stopResizing);
    document.addEventListener('touchcancel', stopResizing);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', stopResizing);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', stopResizing);
      document.removeEventListener('touchcancel', stopResizing);
      document.body.style.userSelect = '';
    };
  }, [isMemoResizing, updateMemoSplitFromClientY]);

  // 日付クリック時の処理
  const handleDateClick = (date) => {
    setSelectedDate(date);
    
    // モバイル時は日付クリックでタイムラインを開く
    if (isMobile) {
      setIsTimelineOpen(true);
    }
  };  // 予定編集ハンドラー

  const handleCalendarScheduleClick = useCallback((schedule, date) => {
    if (date) {
      setSelectedDate(date);
    }

    // 予定ならタイムライン、タスクならタスクタブ
    setTimelineActiveTab(schedule?.isTask ? 'tasks' : 'timeline');

    if (isMobile) {
      setIsTimelineOpen(true);
    }
  }, [isMobile]);
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
        : schedulesRef.current.find((item) => item.id === target);

    if (!entry || !entry.id) return;

    console.info('[EntryDelete] request', JSON.stringify({
      entryType: entry.isTask ? 'task_schedule' : 'schedule',
      entryId: entry.id,
      timestamp: new Date().toISOString(),
    }));

    cancelScheduleNotifications(entry.id);

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
      requestSupabaseSync('schedule_delete_success');
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
      requestSupabaseSync('schedule_delete_error');
      if (throwOnError) {
        throw error;
      }
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, cancelScheduleNotifications, commitSchedules, endSupabaseJob, requestSupabaseSync, setSupabaseError, userId]);

  // 予定移動ハンドラー（ドラッグ&ドロップ用）
  const handleScheduleMove = useCallback((schedule, nextDate) => {
    if (!schedule?.id || !nextDate) return;

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
  const updated = normalizeSchedule({ ...existing, ...schedule, date: nextDate });

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
          requestSupabaseSync('schedule_move_success');
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
          requestSupabaseSync('schedule_move_error');
        } finally {
          endSupabaseJob(jobMeta);
        }
      })();
    }
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, requestSupabaseSync, setSupabaseError, userId]);

  // 予定コピー（ALTドラッグ複製など）
  const handleScheduleCopy = useCallback((schedule) => {
    if (!schedule) return;
  const normalized = normalizeSchedule({ ...schedule });
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
          requestSupabaseSync('schedule_copy_success');
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
          requestSupabaseSync('schedule_copy_error');
        } finally {
          endSupabaseJob(jobMeta);
        }
      })();
    }
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, handleScheduleMove, requestSupabaseSync, setSupabaseError, userId]);

  // 予定更新ハンドラー（並び替え用）
  const handleScheduleUpdate = useCallback((updatedSchedule, actionType = 'schedule_reorder') => {
    const updates = Array.isArray(updatedSchedule) ? updatedSchedule : [updatedSchedule];
    if (updates.length === 0) return;

    const scheduleUpdates = updates.map(normalizeSchedule).filter(Boolean);

    if (scheduleUpdates.length === 0) {
      return;
    }
    console.info('[ScheduleUpdate] request', JSON.stringify({
      actionType,
      count: scheduleUpdates.length,
      ids: scheduleUpdates.map((item) => item.id),
      timestamp: new Date().toISOString(),
    }));
    const current = schedulesRef.current;
    const updateMap = new Map(scheduleUpdates.map((item) => [item.id, item]));

    let optimistic = current.map((schedule) =>
      updateMap.has(schedule.id) ? { ...schedule, ...updateMap.get(schedule.id) } : schedule
    );

    const affectedDates = scheduleUpdates.filter((item) => item.allDay).map((item) => item.date);
    if (affectedDates.length > 0) {
      optimistic = rebalanceAllDayOrdersForDates(optimistic, affectedDates);
    }

    commitSchedules(optimistic, actionType);
    console.info('[ScheduleUpdate] optimistic applied', JSON.stringify({
      actionType,
      count: scheduleUpdates.length,
    }));

    if (userId) {
      (async () => {
        const jobMeta = { kind: 'upsertSchedules', actionType, count: scheduleUpdates.length };
        beginSupabaseJob(jobMeta);
        const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
        try {
          const persisted = await upsertSchedulesForUser(scheduleUpdates, userId);
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
          requestSupabaseSync('schedule_update_success');
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
          requestSupabaseSync('schedule_update_error');
        } finally {
          endSupabaseJob(jobMeta);
        }
      })();
    }
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, requestSupabaseSync, setSupabaseError, userId]);

  // タスクのチェック状態トグル
  const handleToggleTask = useCallback((target, completed) => {
    if (target == null) return;

    const entry =
      typeof target === 'object'
        ? target
        : schedulesRef.current.find((item) => item.id === target);

    if (!entry) return;

    const scheduleId = entry.id;
    console.info('[TaskToggle] request', JSON.stringify({
      scheduleId,
      completed,
      timestamp: new Date().toISOString(),
    }));

    const updatedSchedule = normalizeSchedule({
      ...entry,
      completed,
      isTask: entry?.isTask ?? true,
    });

    const currentSchedules = schedulesRef.current;
    const optimisticSchedules = currentSchedules.map((item) =>
      item.id === scheduleId ? updatedSchedule : item
    );
    commitSchedules(optimisticSchedules, 'task_toggle');
    console.info('[TaskToggle] optimistic applied', JSON.stringify({
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
          requestSupabaseSync('task_toggle_success');
          console.info('[TaskToggle] synced', JSON.stringify({
            scheduleId: persisted.id,
            completed: persisted.completed,
            durationMs:
              (typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? Math.round(performance.now() - startedAt)
                : Math.round(Date.now() - startedAt)),
          }));
        } catch (error) {
          console.error('[Supabase] Failed to toggle task state:', error);
          setSupabaseError(error.message || 'タスク状態の更新に失敗しました。');
          requestSupabaseSync('task_toggle_error');
        } finally {
          endSupabaseJob(jobMeta);
        }
      })();
    }
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, requestSupabaseSync, setSupabaseError, userId]);

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
    const baseDate = targetDate ? toDateStrLocal(targetDate) : '';
    setEditingSchedule({
      date: baseDate,
      time: '',
      name: '',
      memo: '',
      allDay: true,
      isTask: true,
      source: 'scheduleTask',
      completed: false,
    });
    setShowForm(true);

    if (targetDate) {
      setSelectedDate(targetDate);
    }
  }, [setSelectedDate]);

  // 予定保存ハンドラー
  const handleSave = useCallback(async (schedule) => {
    if (!schedule) return;

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
  const updated = normalizeSchedule({ ...existing, ...schedule });

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
          requestSupabaseSync('schedule_save_success');
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
          requestSupabaseSync('schedule_save_error');
          throw error;
        } finally {
          endSupabaseJob(jobMeta);
        }
      }
    } else {
  const baseSchedule = normalizeSchedule({ ...schedule });
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
          requestSupabaseSync('schedule_create_success');
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
          requestSupabaseSync('schedule_create_error');
          throw error;
        } finally {
          endSupabaseJob(jobMeta);
        }
      }
    }

    setShowForm(false);
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, requestSupabaseSync, setShowForm, setSupabaseError, userId]);

  // 予定削除ハンドラー（フォーム用）
  const handleDelete = useCallback(async (id) => {
  await handleScheduleDelete(id, { throwOnError: true });
    setShowForm(false);
  }, [handleScheduleDelete]);

  // フォーム閉じるハンドラー
  const handleClose = () => setShowForm(false);

  // 選択された日付の予定のみ表示
  const filteredSchedules = useMemo(() => {
    if (!selectedDateStr) return [];
    const allSchedules = Array.isArray(schedules) ? schedules : [];
    return allSchedules.filter((entry) => entry.date === selectedDateStr);
  }, [schedules, selectedDateStr]);

  return (
    <div 
      className={`w-screen bg-gradient-to-br from-indigo-900 to-gray-900 text-gray-900 font-sans flex flex-col overflow-hidden ${isMobile ? 'm-0 p-0' : 'h-screen'}`}
      style={isMobile ? {
        height: 'calc(var(--vh, 1vh) * 100)',
        maxHeight: '-webkit-fill-available'
      } : undefined}
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
        </>
      )}

      {isAuthenticated && !supabaseError && isSupabaseSyncing && isSupabaseSyncBlocking && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-6" role="alert" aria-live="polite">
          <div className="w-full max-w-sm rounded-xl bg-white px-6 py-5 shadow-xl">
            <div className="flex items-center gap-3">
              <div
                className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-500"
                aria-hidden="true"
              />
              <div className="text-sm font-semibold text-gray-800">Supabaseと同期中です…</div>
            </div>
            <div className="mt-2 text-xs text-gray-500">少し時間がかかっています。完了までお待ちください。</div>
          </div>
        </div>
      )}
      <main 
        className={`flex-1 overflow-hidden flex relative ${isMobile ? 'p-0' : 'px-2 py-2'}`}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseDown={handleMouseDown}
        onTouchMove={handleTouchMoveResize}
        onTouchEnd={handleTouchEndResize}
        ref={layoutContainerRef}
      >
        

        {/* モバイル表示 */}
        {isMobile ? (
          <>
            {/* カレンダー部分（モバイル） */}
            <div className="flex flex-col w-full h-full overflow-hidden">
              <Calendar 
                schedules={schedules} 
                onDateClick={handleDateClick} 
                onScheduleClick={handleCalendarScheduleClick}
                selectedDate={selectedDate}
                onScheduleCopy={handleScheduleCopy}
                onScheduleDelete={handleScheduleDelete}
                onScheduleMove={handleScheduleMove}
                onScheduleUpdate={handleScheduleUpdate}
                onAdd={handleAdd}
                onEdit={handleEdit}
                isMobile={isMobile}
                onToggleTask={handleToggleTask}
                noteDates={calendarNoteDates}
                onVisibleRangeChange={handleCalendarVisibleRangeChange}
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
                    fixed top-0 right-0 h-full w-full bg-white z-50 slide-transition
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
                  <div className="flex h-full flex-col gap-1 overflow-hidden" ref={mobileTimelineRef}>
                    <div
                      className="flex flex-col min-h-0 gap-2 overflow-hidden"
                      style={{ flexGrow: memoSplitRatio, flexShrink: 1, flexBasis: 0 }}
                    >
                      <div className="flex-1 overflow-hidden">
                        <Timeline 
                          schedules={filteredSchedules} 
                          selectedDate={selectedDate} 
                          selectedDateStr={selectedDateStr}
                          onEdit={handleEdit}
                          onAdd={handleAdd}
                          onAddTask={handleAddTask}
                          onAddNote={handleAddNote}
                          onUpdateNote={handleUpdateNote}
                          onDeleteNote={handleDeleteNote}
                          onToggleArchiveNote={handleToggleArchiveNote}
                          onToggleImportantNote={handleToggleImportantNote}
                          canShareNotes={isAuthenticated}
                          activeNoteId={activeNoteId}
                          onActiveNoteIdChange={setActiveNoteId}
                          onRequestCloseNote={handleRequestCloseNote}
                          onScheduleUpdate={handleScheduleUpdate}
                          onToggleTask={handleToggleTask}
                          onScheduleDelete={handleScheduleDelete}
                          activeTab={timelineActiveTab}
                          onTabChange={setTimelineActiveTab}
                          onClosePanel={closeTimeline}
                          tasks={taskSchedules}
                          notes={notes}
                        />
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center justify-center">
                      <div className="flex h-3 w-full max-w-[96px] items-center justify-center">
                        <div
                          className={`h-1 w-11 rounded-full transition-colors duration-200 ${
                            isMemoResizing ? 'bg-indigo-500' : 'bg-gray-400 hover:bg-indigo-400'
                          }`}
                          role="separator"
                          aria-label="タイムラインとメモの表示比率を変更"
                          onMouseDown={(event) => handleMemoResizeStart(event, mobileTimelineRef)}
                          onTouchStart={(event) => handleMemoResizeStart(event, mobileTimelineRef)}
                          data-memo-handle
                        />
                      </div>
                    </div>
                    <div
                      className="flex flex-col min-h-0 pb-2"
                      style={{ flexGrow: Math.max(1, 100 - memoSplitRatio), flexShrink: 1, flexBasis: 0 }}
                    >
                      <QuickMemoPad
                        value={quickMemo}
                        onChange={handleQuickMemoChange}
                        className="flex h-full flex-col"
                        textareaClassName="flex-1"
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
              className="flex flex-col h-full overflow-hidden pr-1"
              style={{ width: `${splitRatio}%` }}
            >
              <Calendar 
                schedules={schedules} 
                onDateClick={handleDateClick} 
                onScheduleClick={handleCalendarScheduleClick}
                selectedDate={selectedDate}
                onScheduleCopy={handleScheduleCopy}
                onScheduleDelete={handleScheduleDelete}
                onScheduleMove={handleScheduleMove}
                onScheduleUpdate={handleScheduleUpdate}
                onAdd={handleAdd}
                onEdit={handleEdit}
                isMobile={isMobile}
                onToggleTask={handleToggleTask}
                noteDates={calendarNoteDates}
                onVisibleRangeChange={handleCalendarVisibleRangeChange}
              />
            </div>
            
            {/* 分割バー */}
            <div 
              className={`
                w-2 cursor-col-resize transition-colors duration-200 flex-shrink-0 mx-1 bg-transparent hover:bg-transparent
                ${isDragging ? '' : ''}
              `}
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStartResize}
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
              className="flex min-h-0 flex-col gap-1 pl-1 overflow-hidden"
              style={{ width: `${100 - splitRatio}%` }}
              ref={timelineRef}
            >
              <div
                className="flex flex-col min-h-0 gap-2 overflow-hidden"
                style={{ flexGrow: memoSplitRatio, flexShrink: 1, flexBasis: 0 }}
              >
                <CurrentDateTimeBar />
                <div className="flex-1 overflow-hidden">
                  <Timeline 
                    schedules={filteredSchedules} 
                    selectedDate={selectedDate} 
                    selectedDateStr={selectedDateStr}
                    onEdit={handleEdit}
                    onAdd={handleAdd}
                    onAddTask={handleAddTask}
                    onAddNote={handleAddNote}
                    onUpdateNote={handleUpdateNote}
                    onDeleteNote={handleDeleteNote}
                    onToggleArchiveNote={handleToggleArchiveNote}
                    onToggleImportantNote={handleToggleImportantNote}
                    canShareNotes={isAuthenticated}
                    activeNoteId={activeNoteId}
                    onActiveNoteIdChange={setActiveNoteId}
                    onRequestCloseNote={handleRequestCloseNote}
                    onScheduleUpdate={handleScheduleUpdate}
                    onToggleTask={handleToggleTask}
                    onScheduleDelete={handleScheduleDelete}
                    activeTab={timelineActiveTab}
                    onTabChange={setTimelineActiveTab}
                    tasks={taskSchedules}
                    notes={notes}
                  />
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center justify-center">
                <div className="flex h-3 w-full max-w-[100px] items-center justify-center">
                  <div
                    className={`h-1 w-11 rounded-full transition-colors duration-200 ${
                      isMemoResizing ? 'bg-indigo-500' : 'bg-gray-400 hover:bg-indigo-400'
                    }`}
                    role="separator"
                    aria-label="タイムラインとメモの表示比率を変更"
                    onMouseDown={(event) => handleMemoResizeStart(event, timelineRef)}
                    onTouchStart={(event) => handleMemoResizeStart(event, timelineRef)}
                    data-memo-handle
                  />
                </div>
              </div>
              <div
                className="flex flex-col min-h-0"
                style={{ flexGrow: Math.max(1, 100 - memoSplitRatio), flexShrink: 1, flexBasis: 0 }}
              >
                <QuickMemoPad
                  value={quickMemo}
                  onChange={handleQuickMemoChange}
                  className="flex h-full flex-col"
                  textareaClassName="flex-1"
                />
              </div>
            </div>
          </>
        )}
      </main>
      
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[calc(100svh-2rem)] flex flex-col overflow-hidden overflow-x-hidden">
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
