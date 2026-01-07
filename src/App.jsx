
import React, { useState, useEffect, useCallback, useRef, useContext, useMemo } from 'react';
import { toDateStrLocal, fromDateStrLocal } from './utils/date';

import Calendar from './components/Calendar';
import AiConciergeModal from './components/AiConciergeModal';
import Timeline from './components/Timeline';
import CurrentDateTimeBar from './components/CurrentDateTimeBar';
import ScheduleForm from './components/ScheduleForm';
import TitleBar from './components/TitleBar';
import SettingsModal from './components/SettingsModal';
import CornerFloatingMenu from './components/CornerFloatingMenu';
import ScheduleSearchModal from './components/ScheduleSearchModal';
import { fetchQuickMemoForUser, saveQuickMemoForUser } from './utils/supabaseQuickMemo';
import { supabase } from './lib/supabaseClient';
import {
  fetchDailyQuestTasksForUserByDate,
  fetchDailyQuestTasksForUserInRange,
  createDailyQuestTaskForUser,
  updateDailyQuestTaskForUser,
  deleteDailyQuestTaskForUser,
  reorderDailyQuestTasks,
} from './utils/supabaseDailyQuestTasks';
import {
  fetchDailyQuestSnapshotsForUserInRange,
  recordDailyQuestSnapshot,
} from './utils/supabaseDailyQuestSnapshots';
import {
  fetchLoopTimelineMarkersForUser,
  fetchLoopTimelineStateForUser,
  saveLoopTimelineStateForUser,
  createLoopTimelineMarkerForUser,
  deleteLoopTimelineMarkerForUser,
  updateLoopTimelineMarkerForUser,
} from './utils/supabaseLoopTimeline';
import {
  fetchNotesForUser,
  fetchActiveNotesForUser,
  fetchArchivedNotesPageForUser,
  fetchNoteForUserById,
  createNoteForUser,
  updateNoteForUser,
  deleteNoteForUser,
  fetchNoteDatesForUserInRange,
} from './utils/supabaseNotes';
import { clearDateHash, clearNoteHash, parseDateStrFromHash, parseNoteIdFromHash, setNoteHash } from './utils/noteShare';
import { useHistory } from './hooks/useHistory';
import { AuthContext } from './context/AuthContextBase';
import { createTempId } from './utils/id';
import {
  fetchSchedulesForUser,
  fetchActiveSchedulesForUser,
  fetchSchedulesForUserInRange,
  fetchActiveTasksForUser,
  fetchCompletedTasksPageForUser,
  createScheduleForUser,
  updateScheduleForUser,
  deleteScheduleForUser,
  upsertSchedulesForUser,
  searchSchedulesForUser,
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

const QUICK_MEMO_STORAGE_KEY = 'quickMemoPadContent';
const NOTES_STORAGE_KEY = 'notes';
const DAILY_QUEST_TASKS_STORAGE_KEY = 'dailyQuestTasksByDateV1';
const DAILY_QUEST_SNAPSHOTS_STORAGE_KEY = 'dailyQuestSnapshotsV1';
const DAILY_QUEST_TICK_MS = 30_000;
const NOTE_ARCHIVE_FLAGS_STORAGE_KEY = 'noteArchiveFlagsV1';
const NOTE_IMPORTANT_FLAGS_STORAGE_KEY = 'noteImportantFlagsV1';

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

  const loadLocalDailyQuestTasksByDate = useCallback(() => {
    if (typeof window === 'undefined') {
      return {};
    }

    try {
      const stored = window.localStorage.getItem(DAILY_QUEST_TASKS_STORAGE_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.warn('⚠️ Failed to load daily quest tasks from localStorage:', error);
      return {};
    }
  }, []);

  const saveLocalDailyQuestTasksByDate = useCallback((nextMap) => {
    if (typeof window === 'undefined') return;
    try {
      const safe = nextMap && typeof nextMap === 'object' ? nextMap : {};
      window.localStorage.setItem(DAILY_QUEST_TASKS_STORAGE_KEY, JSON.stringify(safe));
    } catch (error) {
      console.warn('⚠️ Failed to persist daily quest tasks to localStorage:', error);
    }
  }, []);

  const loadLocalDailyQuestSnapshots = useCallback(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const stored = window.localStorage.getItem(DAILY_QUEST_SNAPSHOTS_STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('⚠️ Failed to load daily quest snapshots from localStorage:', error);
      return [];
    }
  }, []);

  const saveLocalDailyQuestSnapshots = useCallback((nextList) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DAILY_QUEST_SNAPSHOTS_STORAGE_KEY, JSON.stringify(Array.isArray(nextList) ? nextList : []));
    } catch (error) {
      console.warn('⚠️ Failed to persist daily quest snapshots to localStorage:', error);
    }
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
    overwriteState,
    undo,
    redo,
    canUndo,
    canRedo,
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

  // タスクタブ用: 未完了タスクは可視範囲(schedules)とは別で保持
  const [activeTasks, setActiveTasks] = useState(() => []);
  const activeTasksRef = useRef([]);
  useEffect(() => {
    activeTasksRef.current = Array.isArray(activeTasks) ? activeTasks : [];
  }, [activeTasks]);

  const COMPLETED_TASK_PAGE_SIZE = 5;
  const [completedTasks, setCompletedTasks] = useState(() => []);
  const completedTasksRef = useRef([]);
  const [completedTasksCursor, setCompletedTasksCursor] = useState(null);
  const [completedTasksHasMore, setCompletedTasksHasMore] = useState(false);
  const [completedTasksLoading, setCompletedTasksLoading] = useState(false);

  useEffect(() => {
    completedTasksRef.current = Array.isArray(completedTasks) ? completedTasks : [];
  }, [completedTasks]);

  const taskSchedules = useMemo(() => {
    const hasActiveTasks = Array.isArray(activeTasks) && activeTasks.length > 0;
    const base = hasActiveTasks
      ? activeTasks
      : (Array.isArray(schedules) ? schedules.filter((item) => item?.isTask && !item?.completed) : []);
    const done = Array.isArray(completedTasks) ? completedTasks : [];
    return [...base, ...done];
  }, [activeTasks, completedTasks, schedules]);

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

  const realtimeSelfWriteRef = useRef({
    notes: new Map(),
    schedules: new Map(),
    quick_memos: new Map(),
    loop_timeline_state: new Map(),
    loop_timeline_markers: new Map(),
    daily_quest_tasks: new Map(),
    daily_quest_snapshots: new Map(),
  });
  const REALTIME_SELF_WRITE_WINDOW_MS = 2000;

  const markRealtimeSelfWrite = useCallback((table, ids) => {
    const key = typeof table === 'string' ? table : '';
    const store = realtimeSelfWriteRef.current?.[key];
    if (!store || typeof store.set !== 'function') return;

    const now = Date.now();
    const list = Array.isArray(ids) ? ids : [ids];
    list
      .filter((id) => id != null)
      .forEach((id) => {
        store.set(String(id), now);
      });

    // cleanup
    for (const [id, ts] of store.entries()) {
      if (!ts || now - ts > REALTIME_SELF_WRITE_WINDOW_MS * 3) {
        store.delete(id);
      }
    }
  }, []);

  const shouldIgnoreRealtimeEvent = useCallback((table, rowId) => {
    const key = typeof table === 'string' ? table : '';
    const store = realtimeSelfWriteRef.current?.[key];
    if (!store || rowId == null) return false;
    const ts = store.get(String(rowId));
    if (!ts) return false;
    return Date.now() - ts <= REALTIME_SELF_WRITE_WINDOW_MS;
  }, []);

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
      markRealtimeSelfWrite('quick_memos', userId);
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
  }, [beginSupabaseJob, endSupabaseJob, markRealtimeSelfWrite, setSupabaseError, userId]);

  const commitSchedules = useCallback((nextSchedules, actionType = 'unknown') => {
    const normalizedSchedules = normalizeSchedules(nextSchedules);
    schedulesRef.current = normalizedSchedules;
    setHistoryState(
      {
        schedules: normalizedSchedules,
      },
      actionType
    );

    // カレンダー表示範囲内で編集されたタスクの内容を、タスクタブ側にも反映
    setActiveTasks((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      if (base.length === 0) return base;
      const updates = normalizedSchedules
        .filter((s) => s?.isTask && !s?.completed && (s?.id ?? null) != null);
      if (updates.length === 0) return base;
      const updateMap = new Map(updates.map((t) => [t.id, t]));
      return base.map((t) => {
        const id = t?.id ?? null;
        if (id == null) return t;
        return updateMap.has(id) ? updateMap.get(id) : t;
      });
    });
  }, [setActiveTasks, setHistoryState]);

  const replaceAppState = useCallback(
    (nextSchedules, actionType = 'replace', options = {}) => {
      const normalizedSchedules = normalizeSchedules(nextSchedules);
      schedulesRef.current = normalizedSchedules;

      const mode = options?.mode === 'overwrite' ? 'overwrite' : 'replace';

      const applyHistory =
        mode === 'overwrite' && typeof overwriteState === 'function'
          ? overwriteState
          : typeof replaceState === 'function'
            ? replaceState
            : historySetterRef.current;
      applyHistory(
        {
          schedules: normalizedSchedules,
        },
        actionType
      );
    },
    [overwriteState, replaceState]
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
  const [wideMode, setWideMode] = useState('none');
  
  // モバイル表示の状態管理
  const [isMobile, setIsMobile] = useState(false);
  const [timelineActiveTab, setTimelineActiveTab] = useState('timeline');
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const touchStartRef = useRef(null);
  const touchEndRef = useRef(null);
  const [mouseStart, setMouseStart] = useState(null);
  const [mouseEnd, setMouseEnd] = useState(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [quickMemo, setQuickMemo] = useState('');
  const quickMemoRef = useRef('');
  const [isQuickMemoLoaded, setIsQuickMemoLoaded] = useState(false);

  const [notes, setNotes] = useState([]);

  // 予定/タスク検索モーダル
  const [showScheduleSearch, setShowScheduleSearch] = useState(false);
  const [scheduleSearchKeyword, setScheduleSearchKeyword] = useState('');
  const [scheduleSearchResults, setScheduleSearchResults] = useState(() => []);
  const [scheduleSearchLoading, setScheduleSearchLoading] = useState(false);
  const scheduleSearchTimerRef = useRef(null);

  // AIコンシェルジュモーダル
  const [showAiConcierge, setShowAiConcierge] = useState(false);

  const ARCHIVED_NOTE_PAGE_SIZE = 5;
  const [archivedNotesCursor, setArchivedNotesCursor] = useState(null);
  const [archivedNotesHasMore, setArchivedNotesHasMore] = useState(false);
  const [archivedNotesLoading, setArchivedNotesLoading] = useState(false);
  const [dailyQuestDateStr, setDailyQuestDateStr] = useState(() => toDateStrLocal(new Date()));
  const [dailyQuestTasks, setDailyQuestTasks] = useState(() => []);
  const [calendarDailyQuestSnapshots, setCalendarDailyQuestSnapshots] = useState(() => []);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [sharedNoteId, setSharedNoteId] = useState(null);
  const [tabbedNoteIds, setTabbedNoteIds] = useState(() => []);
  const noteLinkReturnStateRef = useRef(null);
  const noteLinkBackStackRef = useRef([]);
  const noteLinkNavIsBackRef = useRef(false);
  const lastHashNoteIdRef = useRef(null);
  const lastLoginRequestForNoteRef = useRef(null);
  const notesRef = useRef([]);
  const dailyQuestTasksRef = useRef([]);
  const calendarDailyQuestSnapshotsRef = useRef([]);
  const activeNoteIdRef = useRef(null);
  const noteDraftCreateInFlightRef = useRef(new Set());
  const lastDailyQuestDateTickRef = useRef(null);

  useEffect(() => {
    notesRef.current = Array.isArray(notes) ? notes : [];
  }, [notes]);

  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
  }, [activeNoteId]);

  useEffect(() => {
    dailyQuestTasksRef.current = Array.isArray(dailyQuestTasks) ? dailyQuestTasks : [];
  }, [dailyQuestTasks]);

  useEffect(() => {
    calendarDailyQuestSnapshotsRef.current = Array.isArray(calendarDailyQuestSnapshots) ? calendarDailyQuestSnapshots : [];
  }, [calendarDailyQuestSnapshots]);

  useEffect(() => {
    quickMemoRef.current = typeof quickMemo === 'string' ? quickMemo : '';
  }, [quickMemo]);

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

  const openScheduleSearch = useCallback(() => {
    setShowScheduleSearch(true);
  }, []);

  const closeScheduleSearch = useCallback(() => {
    setShowScheduleSearch(false);
  }, []);

  const openAiConcierge = useCallback(() => {
    setShowAiConcierge(true);
  }, []);

  const closeAiConcierge = useCallback(() => {
    setShowAiConcierge(false);
  }, []);

  const searchSchedulesForAi = useCallback(async (keyword) => {
    const q = typeof keyword === 'string' ? keyword.trim() : '';
    if (!q) return [];

    if (userId) {
      const items = await searchSchedulesForUser({ userId, keyword: q, limit: 50 });
      return Array.isArray(items) ? items : [];
    }

    const list = Array.isArray(schedulesRef.current) ? schedulesRef.current : [];
    const needle = q.toLowerCase();
    const filtered = list.filter((s) => {
      const name = String(s?.name ?? '').toLowerCase();
      const memo = String(s?.memo ?? '').toLowerCase();
      return name.includes(needle) || memo.includes(needle);
    });
    return filtered.slice(0, 50);
  }, [userId]);

  const runScheduleSearch = useCallback(async (keyword) => {
    const q = typeof keyword === 'string' ? keyword.trim() : '';
    if (!q) {
      setScheduleSearchResults([]);
      return;
    }

    setScheduleSearchLoading(true);
    try {
      if (userId) {
        const items = await searchSchedulesForUser({ userId, keyword: q, limit: 50 });
        setScheduleSearchResults(Array.isArray(items) ? items : []);
      } else {
        const list = Array.isArray(schedulesRef.current) ? schedulesRef.current : [];
        const needle = q.toLowerCase();
        const filtered = list.filter((s) => {
          const name = String(s?.name ?? '').toLowerCase();
          const memo = String(s?.memo ?? '').toLowerCase();
          return name.includes(needle) || memo.includes(needle);
        });
        setScheduleSearchResults(filtered.slice(0, 50));
      }
    } catch (error) {
      console.error('[Search] Failed to search schedules:', error);
      setScheduleSearchResults([]);
    } finally {
      setScheduleSearchLoading(false);
    }
  }, [searchSchedulesForUser, userId]);

  const handleScheduleSearchKeywordChange = useCallback((next) => {
    const value = typeof next === 'string' ? next : '';
    setScheduleSearchKeyword(value);

    if (scheduleSearchTimerRef.current) {
      clearTimeout(scheduleSearchTimerRef.current);
      scheduleSearchTimerRef.current = null;
    }

    scheduleSearchTimerRef.current = setTimeout(() => {
      scheduleSearchTimerRef.current = null;
      runScheduleSearch(value).catch(() => {});
    }, 250);
  }, [runScheduleSearch]);

  const handleSelectScheduleSearchResult = useCallback((item) => {
    const dateStr = typeof item?.date === 'string' ? item.date : '';
    if (!dateStr) return;
    const d = fromDateStrLocal(dateStr);
    if (d) {
      setSelectedDate(d);
    }
    closeScheduleSearch();
  }, [closeScheduleSearch]);

    useEffect(() => {
      // タブ化したノートが削除された等で一覧から消えた場合は、タブも掃除する
      setTabbedNoteIds((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        if (list.length === 0) return list;
        const existingIds = new Set((Array.isArray(notesRef.current) ? notesRef.current : []).map((n) => n?.id ?? null).filter((v) => v != null));
        const next = list.filter((id) => existingIds.has(id));
        return next.length === list.length ? list : next;
      });
    }, [notes]);

    const tabbedNotes = useMemo(() => {
      const ids = Array.isArray(tabbedNoteIds) ? tabbedNoteIds : [];
      if (ids.length === 0) return [];
      const list = Array.isArray(notes) ? notes : [];
      const map = new Map(list.map((n) => [n?.id ?? null, n]));
      return ids.map((id) => map.get(id) || { id, title: 'ノート' }).filter(Boolean);
    }, [notes, tabbedNoteIds]);

    const handleTabNote = useCallback((note) => {
      const noteId = note?.id ?? null;
      if (noteId == null) return;
      setTabbedNoteIds((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        if (list.includes(noteId)) return list;
        return [...list, noteId];
      });
    }, []);

    const handleRestoreTabbedNote = useCallback(
      (noteId) => {
        if (noteId == null) return;
        setTabbedNoteIds((prev) => (Array.isArray(prev) ? prev.filter((id) => id !== noteId) : []));
        openSharedNote(noteId);
      },
      [openSharedNote]
    );

  const calendarDailyQuestCrownsByDate = useMemo(() => {
    const map = {};
    const snapshots = Array.isArray(calendarDailyQuestSnapshots) ? calendarDailyQuestSnapshots : [];
    for (const row of snapshots) {
      const dateStr = String(row?.date_str ?? '').trim();
      if (!dateStr) continue;
      if (!row?.is_cleared) continue;
      const totalCount = Number.isFinite(Number(row?.total_count)) ? Number(row.total_count) : null;
      map[dateStr] = { status: 'confirmed', ...(totalCount != null ? { totalCount } : {}) };
    }

    // 今日だけは「暫定」表示（0時を跨ぐまで確定しない）
    const todayStr = String(dailyQuestDateStr ?? '').trim();
    if (todayStr) {
      const tasks = Array.isArray(dailyQuestTasks) ? dailyQuestTasks : [];
      const hasTasks = tasks.length > 0;
      const allDone = hasTasks && tasks.every((t) => !!t?.completed);
      if (allDone && !map[todayStr]) {
        map[todayStr] = { status: 'provisional' };
      }
    }

    return map;
  }, [calendarDailyQuestSnapshots, dailyQuestDateStr, dailyQuestTasks]);

  // メモ等のリンク（hash）からノートを開いた場合、閉じた時に戻せるよう現在の表示状態を記憶
  useEffect(() => {
    if (sharedNoteId == null) return;
    if (activeNoteId != null) return;
    if (noteLinkReturnStateRef.current) return;

    noteLinkReturnStateRef.current = {
      sharedNoteId,
      timelineActiveTab,
      isTimelineOpen,
    };
  }, [activeNoteId, isTimelineOpen, sharedNoteId, timelineActiveTab]);

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

      // ノートhashが消えたら、リンク戻り履歴もクリア
      if (noteId == null) {
        setSharedNoteId(null);
        lastHashNoteIdRef.current = null;
        noteLinkBackStackRef.current = [];
        noteLinkReturnStateRef.current = null;
      } else {
        const prevHashNoteId = lastHashNoteIdRef.current;
        const isBackNav = !!noteLinkNavIsBackRef.current;

        if (!isBackNav) {
          // ノート内リンクで別ノートへ移動した場合、戻り先として現在のノートを積む
          const currentActive = activeNoteId;
          const currentActiveKey = currentActive == null ? null : String(currentActive);
          const nextKey = String(noteId);
          if (currentActiveKey != null && currentActiveKey !== nextKey) {
            const toPush = prevHashNoteId != null ? prevHashNoteId : currentActive;
            const stack = noteLinkBackStackRef.current;
            const last = stack.length > 0 ? stack[stack.length - 1] : null;
            if (toPush != null && String(last ?? '') !== String(toPush)) {
              stack.push(toPush);
            }
          }
        }

        lastHashNoteIdRef.current = noteId;
        if (isBackNav) {
          noteLinkNavIsBackRef.current = false;
        }

        setSharedNoteId(noteId);
      }

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
  }, [activeNoteId, isMobile]);

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
  const [calendarVisibleRange, setCalendarVisibleRange] = useState(null);
  const [calendarDailyQuestTasksInRange, setCalendarDailyQuestTasksInRange] = useState(() => []);
  const [loopTimelineState, setLoopTimelineState] = useState(null);
  const [loopTimelineMarkers, setLoopTimelineMarkers] = useState([]);
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
  
  // ハンバーガーメニューの開閉状態
  
  // 通知は workers（push）に一本化

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
        const getMonthRange = (baseDate) => {
          const d = baseDate instanceof Date ? baseDate : new Date();
          const start = new Date(d.getFullYear(), d.getMonth(), 1);
          const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
          return { startDate: toDateStrLocal(start), endDate: toDateStrLocal(end) };
        };

        const visibleRange = calendarVisibleRangeRef.current;
        const fallbackRange = getMonthRange(selectedDate);
        const syncRange = (visibleRange?.startDate && visibleRange?.endDate)
          ? { startDate: visibleRange.startDate, endDate: visibleRange.endDate }
          : fallbackRange;
        const hasVisibleRange = !!(syncRange?.startDate && syncRange?.endDate);

        const todayStr = toDateStrLocal(new Date());

        const [remoteSchedulesInRange, remoteActiveTasks, remoteQuickMemo, remoteNotesActive, remoteNotesArchivedPage, remoteCompletedTasksPage, remoteNoteDates, remoteLoopState, remoteLoopMarkers, remoteDailyQuestTasks, remoteDailyQuestSnapshots, remoteDailyQuestTasksInRange] = await Promise.all([
          hasVisibleRange
            ? fetchSchedulesForUserInRange({
                userId,
                startDate: syncRange.startDate,
                endDate: syncRange.endDate,
              }).catch(() => fetchActiveSchedulesForUser(userId).catch(() => fetchSchedulesForUser(userId)))
            : fetchActiveSchedulesForUser(userId).catch(() => fetchSchedulesForUser(userId)),
          fetchActiveTasksForUser(userId).catch(() => []),
          fetchQuickMemoForUser(userId),
          fetchActiveNotesForUser(userId).catch(() => fetchNotesForUser(userId)),
          fetchArchivedNotesPageForUser({ userId, limit: ARCHIVED_NOTE_PAGE_SIZE }).catch(() => ({ items: [], hasMore: false, nextCursor: null })),
          fetchCompletedTasksPageForUser({ userId, limit: COMPLETED_TASK_PAGE_SIZE }).catch(() => ({ items: [], hasMore: false, nextCursor: null })),
          hasVisibleRange
            ? fetchNoteDatesForUserInRange({
                userId,
                startDate: syncRange.startDate,
                endDate: syncRange.endDate,
              })
            : Promise.resolve(null),
          fetchLoopTimelineStateForUser(userId).catch((error) => {
            console.warn('[Supabase] loop_timeline_state fetch skipped:', error);
            return null;
          }),
          fetchLoopTimelineMarkersForUser(userId).catch((error) => {
            console.warn('[Supabase] loop_timeline_markers fetch skipped:', error);
            return [];
          }),
          fetchDailyQuestTasksForUserByDate({ userId, dateStr: todayStr }).catch((error) => {
            console.warn('[Supabase] daily_quest_tasks fetch skipped:', error);
            return [];
          }),
          hasVisibleRange
            ? fetchDailyQuestSnapshotsForUserInRange({
                userId,
                startDate: syncRange.startDate,
                endDate: syncRange.endDate,
              }).catch((error) => {
                console.warn('[Supabase] daily_quest_snapshots fetch skipped:', error);
                return [];
              })
            : Promise.resolve([]),
          hasVisibleRange
            ? fetchDailyQuestTasksForUserInRange({
                userId,
                startDate: syncRange.startDate,
                endDate: syncRange.endDate,
              }).catch((error) => {
                console.warn('[Supabase] daily_quest_tasks range fetch skipped:', error);
                return [];
              })
            : Promise.resolve([]),
        ]);
        if (isCancelledFn()) return;

        const baseSchedules = Array.isArray(remoteSchedulesInRange) ? remoteSchedulesInRange : [];

        replaceAppState(baseSchedules, actionType, {
          mode: actionType === 'supabase_initial_sync' ? 'replace' : 'overwrite',
        });

        // 未完了タスク（タスクタブ用）
        {
          const list = Array.isArray(remoteActiveTasks) ? remoteActiveTasks : [];
          setActiveTasks(list);
        }

        // ローカルに未保存の変更がある場合、再同期で上書きしない。
        // (追加直後のデバウンス保存前に resync が走ると、追加が消えることがある)
        {
          const remoteValue = typeof remoteQuickMemo === 'string' ? remoteQuickMemo : '';
          const localValue = quickMemoRef.current;
          const lastSavedValue = quickMemoLastSavedRef.current;
          const hasLocalDirty = localValue !== lastSavedValue;

          if (!hasLocalDirty || remoteValue === localValue) {
            applyQuickMemoValue(remoteValue);
          } else {
            console.info('[SupabaseSync] skip quickMemo overwrite (local dirty)', JSON.stringify({
              actionType,
              timestamp: new Date().toISOString(),
              localLength: localValue.length,
              remoteLength: remoteValue.length,
            }));
          }
        }

        // 完了済みタスク（ページング）
        {
          const page = remoteCompletedTasksPage && typeof remoteCompletedTasksPage === 'object'
            ? remoteCompletedTasksPage
            : { items: [], hasMore: false, nextCursor: null };
          setCompletedTasks(Array.isArray(page.items) ? page.items : []);
          setCompletedTasksHasMore(!!page.hasMore);
          setCompletedTasksCursor(page.nextCursor || null);
        }

        // ノート同期: pending patch（未送信の編集）と下書きを保持して上書き事故を防ぐ
        {
          const remoteActive = Array.isArray(remoteNotesActive) ? remoteNotesActive : [];
          const remoteArchivedItems = Array.isArray(remoteNotesArchivedPage?.items) ? remoteNotesArchivedPage.items : [];
          setArchivedNotesHasMore(!!remoteNotesArchivedPage?.hasMore);
          setArchivedNotesCursor(remoteNotesArchivedPage?.nextCursor || null);

          const pendingMap = notePendingPatchRef.current;
          const localList = Array.isArray(notesRef.current) ? notesRef.current : [];
          const draftNotes = localList.filter((note) => note?.__isDraft);
          const draftIdSet = new Set(draftNotes.map((note) => note?.id).filter((id) => id != null));

          const mergeWithPending = (note) => {
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
          };

          const mergedActive = remoteActive.map(mergeWithPending);
          const mergedArchived = remoteArchivedItems.map(mergeWithPending);
          const combinedRemote = [...mergedActive, ...mergedArchived];
          const combined = [...draftNotes, ...combinedRemote.filter((note) => !draftIdSet.has(note?.id ?? null))];
          setNotes(applyNoteFlagsToNotes(combined, {
            archiveFlags: noteArchiveFlagsRef.current,
            importantFlags: noteImportantFlagsRef.current,
          }));
        }

        if (Array.isArray(remoteNoteDates)) {
          setCalendarNoteDates(remoteNoteDates);
        }

        setDailyQuestDateStr(todayStr);
        setDailyQuestTasks(Array.isArray(remoteDailyQuestTasks) ? remoteDailyQuestTasks : []);

        if (Array.isArray(remoteDailyQuestSnapshots)) {
          setCalendarDailyQuestSnapshots(remoteDailyQuestSnapshots);
        }

        if (Array.isArray(remoteDailyQuestTasksInRange)) {
          setCalendarDailyQuestTasksInRange(remoteDailyQuestTasksInRange);
        }

        setLoopTimelineState(remoteLoopState);
        setLoopTimelineMarkers(Array.isArray(remoteLoopMarkers) ? remoteLoopMarkers : []);

        // ローカルキャッシュ（オフライン復帰用）
        try {
          const map = loadLocalDailyQuestTasksByDate();
          map[todayStr] = Array.isArray(remoteDailyQuestTasks) ? remoteDailyQuestTasks : [];
          saveLocalDailyQuestTasksByDate(map);
        } catch {
          // ignore
        }

        setSupabaseError(null);
        hasFetchedRemoteRef.current = true;
        console.info('[SupabaseSync] payload', JSON.stringify({
          actionType,
          schedules: baseSchedules.slice(0, 10),
        }));
        console.info('[SupabaseSync] success', JSON.stringify({
          actionType,
          count: baseSchedules.length,
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
    [
      applyQuickMemoValue,
      beginSupabaseJob,
      endSupabaseJob,
      loadLocalDailyQuestTasksByDate,
      replaceAppState,
      saveLocalDailyQuestTasksByDate,
      setActiveTasks,
      userId,
      fetchSchedulesForUser,
      fetchActiveSchedulesForUser,
      fetchSchedulesForUserInRange,
      fetchActiveTasksForUser,
      fetchQuickMemoForUser,
      fetchNotesForUser,
      fetchActiveNotesForUser,
      fetchArchivedNotesPageForUser,
      fetchCompletedTasksPageForUser,
      fetchNoteDatesForUserInRange,
      fetchLoopTimelineStateForUser,
      fetchLoopTimelineMarkersForUser,
      fetchDailyQuestTasksForUserByDate,
      fetchDailyQuestSnapshotsForUserInRange,
      fetchDailyQuestTasksForUserInRange,
      ARCHIVED_NOTE_PAGE_SIZE,
      COMPLETED_TASK_PAGE_SIZE,
      selectedDate,
    ]
  );

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

  const handleLoadMoreCompletedTasks = useCallback(async () => {
    if (!userId) return;
    if (completedTasksLoading) return;
    if (!completedTasksHasMore) return;

    setCompletedTasksLoading(true);
    try {
      const page = await fetchCompletedTasksPageForUser({
        userId,
        limit: COMPLETED_TASK_PAGE_SIZE,
        cursor: completedTasksCursor,
      });
      const items = Array.isArray(page?.items) ? page.items : [];
      setCompletedTasks((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const idSet = new Set(base.map((t) => t?.id ?? null).filter((v) => v != null));
        const appended = items.filter((t) => {
          const id = t?.id ?? null;
          if (id == null) return true;
          if (idSet.has(id)) return false;
          idSet.add(id);
          return true;
        });
        return [...base, ...appended];
      });
      setCompletedTasksHasMore(!!page?.hasMore);
      setCompletedTasksCursor(page?.nextCursor || null);
    } catch (error) {
      console.error('[Supabase] Failed to load more completed tasks:', error);
    } finally {
      setCompletedTasksLoading(false);
    }
  }, [
    userId,
    completedTasksLoading,
    completedTasksHasMore,
    completedTasksCursor,
    fetchCompletedTasksPageForUser,
    COMPLETED_TASK_PAGE_SIZE,
  ]);

  const handleLoadMoreArchivedNotes = useCallback(async () => {
    if (!userId) return;
    if (archivedNotesLoading) return;
    if (!archivedNotesHasMore) return;

    setArchivedNotesLoading(true);
    try {
      const page = await fetchArchivedNotesPageForUser({
        userId,
        limit: ARCHIVED_NOTE_PAGE_SIZE,
        cursor: archivedNotesCursor,
      });
      const items = Array.isArray(page?.items) ? page.items : [];
      setNotes((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const archivedExisting = list.filter((n) => n?.archived);
        const nonArchived = list.filter((n) => !n?.archived);

        const idSet = new Set(archivedExisting.map((n) => n?.id ?? null).filter((v) => v != null));
        const appended = items.filter((n) => {
          const id = n?.id ?? null;
          if (id == null) return true;
          if (idSet.has(id)) return false;
          idSet.add(id);
          return true;
        });

        return [...nonArchived, ...archivedExisting, ...appended];
      });
      setArchivedNotesHasMore(!!page?.hasMore);
      setArchivedNotesCursor(page?.nextCursor || null);
    } catch (error) {
      console.error('[Supabase] Failed to load more archived notes:', error);
    } finally {
      setArchivedNotesLoading(false);
    }
  }, [
    userId,
    archivedNotesLoading,
    archivedNotesHasMore,
    archivedNotesCursor,
    fetchArchivedNotesPageForUser,
    ARCHIVED_NOTE_PAGE_SIZE,
  ]);

  const normalizeQuestTitleForCompare = useCallback((value) => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';
    let normalized = trimmed;
    try {
      normalized = normalized.normalize('NFKC');
    } catch {
      // ignore
    }
    return normalized.toLowerCase();
  }, []);

  const isQuestTitleDuplicateForCurrentDay = useCallback((candidateTitle, { ignoreId } = {}) => {
    const key = normalizeQuestTitleForCompare(candidateTitle);
    if (!key) return false;
    const list = Array.isArray(dailyQuestTasksRef.current) ? dailyQuestTasksRef.current : [];
    return list.some((t) => {
      const id = t?.id ?? null;
      if (ignoreId != null && id === ignoreId) return false;
      return normalizeQuestTitleForCompare(t?.title) === key;
    });
  }, [normalizeQuestTitleForCompare]);

  const handleCreateQuestTask = useCallback(async ({ title }) => {
    const safeTitle = String(title ?? '').trim();
    if (!safeTitle) return;

    if (isQuestTitleDuplicateForCurrentDay(safeTitle)) {
      window.alert('同名のクエストは登録できません。');
      return;
    }

    const dateStr = String(dailyQuestDateStr ?? '').trim() || toDateStrLocal(new Date());
    const nowIso = new Date().toISOString();

    const nextSortOrder = (() => {
      const list = Array.isArray(dailyQuestTasksRef.current) ? dailyQuestTasksRef.current : [];
      const orders = list
        .map((t) => Number(t?.sort_order))
        .filter((v) => Number.isFinite(v));
      if (orders.length === 0) return 0;
      return Math.max(...orders) + 1;
    })();

    if (!userId) {
      const created = {
        id: createTempId(),
        user_id: null,
        date_str: dateStr,
        title: safeTitle,
        completed: false,
        sort_order: nextSortOrder,
        created_at: nowIso,
        updated_at: nowIso,
      };

      setDailyQuestTasks((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = [...list, created].sort((a, b) => {
          const aOrder = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : null;
          const bOrder = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : null;
          if (aOrder != null || bOrder != null) {
            if (aOrder == null) return 1;
            if (bOrder == null) return -1;
            const diffOrder = aOrder - bOrder;
            if (diffOrder !== 0) return diffOrder;
          }
          const diff = String(a?.created_at ?? '').localeCompare(String(b?.created_at ?? ''));
          if (diff !== 0) return diff;
          return Number(a?.id ?? 0) - Number(b?.id ?? 0);
        });

        try {
          const map = loadLocalDailyQuestTasksByDate();
          map[dateStr] = next;
          saveLocalDailyQuestTasksByDate(map);
        } catch {
          // ignore
        }

        return next;
      });
      return;
    }

    const jobMeta = { kind: 'dailyQuestTaskCreate' };
    beginSupabaseJob(jobMeta);
    try {
      const created = await createDailyQuestTaskForUser({ userId, dateStr, title: safeTitle, sortOrder: nextSortOrder });
      markRealtimeSelfWrite('daily_quest_tasks', created?.id ?? null);
      setDailyQuestTasks((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = [...list, created].sort((a, b) => {
          const aOrder = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : null;
          const bOrder = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : null;
          if (aOrder != null || bOrder != null) {
            if (aOrder == null) return 1;
            if (bOrder == null) return -1;
            const diffOrder = aOrder - bOrder;
            if (diffOrder !== 0) return diffOrder;
          }
          const diff = String(a?.created_at ?? '').localeCompare(String(b?.created_at ?? ''));
          if (diff !== 0) return diff;
          return Number(a?.id ?? 0) - Number(b?.id ?? 0);
        });

        try {
          const map = loadLocalDailyQuestTasksByDate();
          map[dateStr] = next;
          saveLocalDailyQuestTasksByDate(map);
        } catch {
          // ignore
        }

        return next;
      });
      setSupabaseError(null);
    } catch (error) {
      console.error('[Supabase] Failed to create daily quest task:', error);
      const code = error?.code ?? null;
      if (code === '23505' || /duplicate key value|unique constraint/i.test(String(error?.message ?? ''))) {
        setSupabaseError('同名のクエストは登録できません。');
      } else {
        setSupabaseError(error.message || 'デイリータスクの作成に失敗しました。');
      }
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, createDailyQuestTaskForUser, dailyQuestDateStr, endSupabaseJob, isQuestTitleDuplicateForCurrentDay, loadLocalDailyQuestTasksByDate, markRealtimeSelfWrite, saveLocalDailyQuestTasksByDate, userId]);

  const handleReorderQuestTasks = useCallback(async (_period, orderedIds) => {
    const dateStr = String(dailyQuestDateStr ?? '').trim() || toDateStrLocal(new Date());
    const ids = Array.isArray(orderedIds) ? orderedIds.map((v) => (v == null ? null : v)).filter((v) => v != null) : [];
    if (ids.length === 0) return;

    const orderMap = new Map(ids.map((id, index) => [id, index]));
    const nowIso = new Date().toISOString();

    setDailyQuestTasks((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const next = list.map((t) => {
        const id = t?.id ?? null;
        if (id == null) return t;
        const nextOrder = orderMap.get(id);
        if (nextOrder == null) return t;
        return {
          ...t,
          sort_order: nextOrder,
          updated_at: nowIso,
        };
      }).sort((a, b) => {
        const aOrder = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : null;
        const bOrder = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : null;
        if (aOrder != null || bOrder != null) {
          if (aOrder == null) return 1;
          if (bOrder == null) return -1;
          const diff = aOrder - bOrder;
          if (diff !== 0) return diff;
        }
        return String(a?.created_at ?? '').localeCompare(String(b?.created_at ?? ''));
      });

      try {
        const map = loadLocalDailyQuestTasksByDate();
        map[dateStr] = next;
        saveLocalDailyQuestTasksByDate(map);
      } catch {
        // ignore
      }

      return next;
    });

    if (!userId) return;

    const jobMeta = { kind: 'dailyQuestTaskReorder' };
    beginSupabaseJob(jobMeta);
    try {
      ids.forEach((id) => markRealtimeSelfWrite('daily_quest_tasks', id));
      await reorderDailyQuestTasks({ dateStr, orderedIds: ids });
      setSupabaseError(null);
      // sort_order を確実に揃える
      requestSupabaseSync('daily_quest_reorder');
    } catch (error) {
      console.error('[Supabase] Failed to reorder daily quest tasks:', error);
      setSupabaseError(error.message || 'デイリータスクの並び替えに失敗しました。');
      requestSupabaseSync('daily_quest_reorder_error');
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, dailyQuestDateStr, endSupabaseJob, loadLocalDailyQuestTasksByDate, markRealtimeSelfWrite, requestSupabaseSync, saveLocalDailyQuestTasksByDate, userId]);

  const handleToggleQuestTask = useCallback(async (task, nextCompleted) => {
    const id = task?.id ?? null;
    if (id == null) return;
    const dateStr = String(dailyQuestDateStr ?? '').trim() || toDateStrLocal(new Date());

    const optimisticPatch = {
      completed: !!nextCompleted,
      updated_at: new Date().toISOString(),
    };

    setDailyQuestTasks((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const next = list.map((t) => ((t?.id ?? null) === id ? { ...t, ...optimisticPatch } : t));
      try {
        const map = loadLocalDailyQuestTasksByDate();
        map[dateStr] = next;
        saveLocalDailyQuestTasksByDate(map);
      } catch {
        // ignore
      }
      return next;
    });

    if (!userId) return;

    const jobMeta = { kind: 'dailyQuestTaskToggle' };
    beginSupabaseJob(jobMeta);
    try {
      markRealtimeSelfWrite('daily_quest_tasks', id);
      const saved = await updateDailyQuestTaskForUser({ userId, id, patch: { completed: !!nextCompleted } });
      setDailyQuestTasks((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = list.map((t) => ((t?.id ?? null) === id ? saved : t));
        try {
          const map = loadLocalDailyQuestTasksByDate();
          map[dateStr] = next;
          saveLocalDailyQuestTasksByDate(map);
        } catch {
          // ignore
        }
        return next;
      });
      setSupabaseError(null);
    } catch (error) {
      console.error('[Supabase] Failed to toggle daily quest task:', error);
      setSupabaseError(error.message || 'デイリータスク状態の更新に失敗しました。');
      requestSupabaseSync('daily_quest_toggle_error');
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, dailyQuestDateStr, endSupabaseJob, loadLocalDailyQuestTasksByDate, markRealtimeSelfWrite, requestSupabaseSync, saveLocalDailyQuestTasksByDate, userId]);

  const handleUpdateQuestTask = useCallback(async (task, nextTitle) => {
    const id = task?.id ?? null;
    if (id == null) return;

    const dateStr = String(dailyQuestDateStr ?? '').trim() || toDateStrLocal(new Date());
    const trimmed = String(nextTitle ?? '').trim();
    if (!trimmed) return;

    if (isQuestTitleDuplicateForCurrentDay(trimmed, { ignoreId: id })) {
      window.alert('同名のクエストは登録できません。');
      return;
    }

    const optimisticPatch = {
      title: trimmed,
      updated_at: new Date().toISOString(),
    };

    setDailyQuestTasks((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const next = list.map((t) => ((t?.id ?? null) === id ? { ...t, ...optimisticPatch } : t));
      try {
        const map = loadLocalDailyQuestTasksByDate();
        map[dateStr] = next;
        saveLocalDailyQuestTasksByDate(map);
      } catch {
        // ignore
      }
      return next;
    });

    if (!userId) return;

    const jobMeta = { kind: 'dailyQuestTaskUpdateTitle' };
    beginSupabaseJob(jobMeta);
    try {
      markRealtimeSelfWrite('daily_quest_tasks', id);
      const saved = await updateDailyQuestTaskForUser({ userId, id, patch: { title: trimmed } });
      setDailyQuestTasks((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = list.map((t) => ((t?.id ?? null) === id ? saved : t));
        try {
          const map = loadLocalDailyQuestTasksByDate();
          map[dateStr] = next;
          saveLocalDailyQuestTasksByDate(map);
        } catch {
          // ignore
        }
        return next;
      });
      setSupabaseError(null);
    } catch (error) {
      console.error('[Supabase] Failed to update daily quest task title:', error);
      const code = error?.code ?? null;
      if (code === '23505' || /duplicate key value|unique constraint/i.test(String(error?.message ?? ''))) {
        setSupabaseError('同名のクエストは登録できません。');
      } else {
        setSupabaseError(error.message || 'デイリータスク名の更新に失敗しました。');
      }
      requestSupabaseSync('daily_quest_update_error');
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, dailyQuestDateStr, endSupabaseJob, isQuestTitleDuplicateForCurrentDay, loadLocalDailyQuestTasksByDate, markRealtimeSelfWrite, requestSupabaseSync, saveLocalDailyQuestTasksByDate, updateDailyQuestTaskForUser, userId]);

  const handleDeleteQuestTask = useCallback(async (task) => {
    const id = task?.id ?? null;
    if (id == null) return;
    const dateStr = String(dailyQuestDateStr ?? '').trim() || toDateStrLocal(new Date());

    setDailyQuestTasks((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const next = list.filter((t) => (t?.id ?? null) !== id);
      try {
        const map = loadLocalDailyQuestTasksByDate();
        map[dateStr] = next;
        saveLocalDailyQuestTasksByDate(map);
      } catch {
        // ignore
      }
      return next;
    });

    if (!userId) return;

    const jobMeta = { kind: 'dailyQuestTaskDelete' };
    beginSupabaseJob(jobMeta);
    try {
      markRealtimeSelfWrite('daily_quest_tasks', id);
      await deleteDailyQuestTaskForUser({ userId, id });
      setSupabaseError(null);
    } catch (error) {
      console.error('[Supabase] Failed to delete daily quest task:', error);
      setSupabaseError(error.message || 'デイリータスクの削除に失敗しました。');
      requestSupabaseSync('daily_quest_delete_error');
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, dailyQuestDateStr, endSupabaseJob, loadLocalDailyQuestTasksByDate, markRealtimeSelfWrite, requestSupabaseSync, saveLocalDailyQuestTasksByDate, userId]);

  const handleLoopTimelineSaveState = useCallback(async (patch) => {
    if (!userId) return;
    const safePatch = patch && typeof patch === 'object' ? patch : {};

    setLoopTimelineState((prev) => ({
      ...(prev || { user_id: userId }),
      ...safePatch,
      updated_at: new Date().toISOString(),
    }));

    const jobMeta = { kind: 'loopTimelineSaveState' };
    beginSupabaseJob(jobMeta);
    try {
      markRealtimeSelfWrite('loop_timeline_state', userId);
      const saved = await saveLoopTimelineStateForUser({ userId, patch: safePatch });
      setLoopTimelineState(saved);
      setSupabaseError(null);
    } catch (error) {
      console.error('[Supabase] Failed to save loop timeline state:', error);
      setSupabaseError(error.message || 'ループタイムラインの保存に失敗しました。');
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, endSupabaseJob, markRealtimeSelfWrite, userId]);

  const handleLoopTimelineAddMarker = useCallback(async ({ text, message, offset_minutes }) => {
    if (!userId) return;
    const jobMeta = { kind: 'loopTimelineAddMarker' };
    beginSupabaseJob(jobMeta);
    try {
      const created = await createLoopTimelineMarkerForUser({
        userId,
        text,
        message,
        offsetMinutes: offset_minutes,
      });
      markRealtimeSelfWrite('loop_timeline_markers', created?.id ?? null);
      setLoopTimelineMarkers((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        return [...list, created].sort((a, b) => {
          const diff = Number(a?.offset_minutes ?? 0) - Number(b?.offset_minutes ?? 0);
          if (diff !== 0) return diff;
          return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
        });
      });
      setSupabaseError(null);
    } catch (error) {
      console.error('[Supabase] Failed to add loop timeline marker:', error);
      setSupabaseError(error.message || '追加項目の作成に失敗しました。');
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, endSupabaseJob, markRealtimeSelfWrite, userId]);

  const handleLoopTimelineDeleteMarker = useCallback(async (markerId) => {
    if (!userId) return;
    const jobMeta = { kind: 'loopTimelineDeleteMarker' };
    beginSupabaseJob(jobMeta);
    try {
      markRealtimeSelfWrite('loop_timeline_markers', markerId);
      await deleteLoopTimelineMarkerForUser({ userId, id: markerId });
      setLoopTimelineMarkers((prev) => (Array.isArray(prev) ? prev.filter((m) => (m?.id ?? null) !== markerId) : []));
      setSupabaseError(null);
    } catch (error) {
      console.error('[Supabase] Failed to delete loop timeline marker:', error);
      setSupabaseError(error.message || '追加項目の削除に失敗しました。');
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, endSupabaseJob, markRealtimeSelfWrite, userId]);

  const handleLoopTimelineUpdateMarker = useCallback(async ({ id, text, message, offset_minutes }) => {
    if (!userId) return;
    if (id == null) return;
    const jobMeta = { kind: 'loopTimelineUpdateMarker' };
    beginSupabaseJob(jobMeta);
    try {
      // optimistic
      setLoopTimelineMarkers((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = list.map((m) => {
          if ((m?.id ?? null) !== id) return m;
          return {
            ...m,
            text: text ?? m?.text ?? '',
            message: message ?? m?.message ?? '',
            offset_minutes: offset_minutes ?? m?.offset_minutes ?? 0,
            updated_at: new Date().toISOString(),
          };
        });
        return next
          .slice()
          .sort((a, b) => {
            const diff = Number(a?.offset_minutes ?? 0) - Number(b?.offset_minutes ?? 0);
            if (diff !== 0) return diff;
            return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
          });
      });

      markRealtimeSelfWrite('loop_timeline_markers', id);
      const saved = await updateLoopTimelineMarkerForUser({
        userId,
        id,
        text,
        message,
        offsetMinutes: offset_minutes,
      });
      setLoopTimelineMarkers((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = list.map((m) => ((m?.id ?? null) === id ? saved : m));
        return next
          .slice()
          .sort((a, b) => {
            const diff = Number(a?.offset_minutes ?? 0) - Number(b?.offset_minutes ?? 0);
            if (diff !== 0) return diff;
            return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
          });
      });
      setSupabaseError(null);
    } catch (error) {
      console.error('[Supabase] Failed to update loop timeline marker:', error);
      setSupabaseError(error.message || '追加項目の更新に失敗しました。');
    } finally {
      endSupabaseJob(jobMeta);
    }
  }, [beginSupabaseJob, endSupabaseJob, markRealtimeSelfWrite, userId]);

  useEffect(() => {
    // ログイン/ログアウトやユーザー切替で確実に解除
    setIsSupabaseSyncing(false);
    setIsSupabaseSyncBlocking(false);
    if (supabaseSyncOverlayTimerRef.current) {
      clearTimeout(supabaseSyncOverlayTimerRef.current);
      supabaseSyncOverlayTimerRef.current = null;
    }
  }, [userId]);

  // Supabase Realtime: 他端末/他ウィンドウのループタイムライン変更を検知して再同期
  useEffect(() => {
    if (!userId) return;

    let isDisposed = false;
    const stateChannel = supabase
      .channel(`loop_timeline_state:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'loop_timeline_state',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (isDisposed) return;
          const rowKey = payload?.new?.user_id ?? payload?.old?.user_id ?? null;
          if (rowKey != null && shouldIgnoreRealtimeEvent('loop_timeline_state', rowKey)) {
            return;
          }
          console.info('[SupabaseRealtime] loop_timeline_state changed', JSON.stringify({
            eventType: payload?.eventType,
            table: payload?.table,
            timestamp: new Date().toISOString(),
          }));
          requestSupabaseSync('realtime:loop_timeline');
        }
      )
      .subscribe((status) => {
        console.info('[SupabaseRealtime] loop_timeline_state subscription', JSON.stringify({ status }));
      });

    const markersChannel = supabase
      .channel(`loop_timeline_markers:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'loop_timeline_markers',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (isDisposed) return;
          const rowId = payload?.new?.id ?? payload?.old?.id ?? null;
          if (rowId != null && shouldIgnoreRealtimeEvent('loop_timeline_markers', rowId)) {
            return;
          }
          console.info('[SupabaseRealtime] loop_timeline_markers changed', JSON.stringify({
            eventType: payload?.eventType,
            table: payload?.table,
            timestamp: new Date().toISOString(),
          }));
          requestSupabaseSync('realtime:loop_timeline');
        }
      )
      .subscribe((status) => {
        console.info('[SupabaseRealtime] loop_timeline_markers subscription', JSON.stringify({ status }));
      });

    return () => {
      isDisposed = true;
      try {
        supabase.removeChannel(stateChannel);
      } catch {
        // ignore
      }
      try {
        supabase.removeChannel(markersChannel);
      } catch {
        // ignore
      }
    };
  }, [requestSupabaseSync, shouldIgnoreRealtimeEvent, userId]);

  useEffect(() => {
    if (auth?.isLoading) return;

    if (!userId) {
      hasFetchedRemoteRef.current = false;
      setSupabaseError(null);
      setIsSupabaseSyncing(false);
      replaceAppState(loadLocalSchedules(), 'local_restore', { mode: 'replace' });
      const localMemo = loadLocalQuickMemo();
      applyQuickMemoValue(localMemo);

      try {
        const todayStr = toDateStrLocal(new Date());
        const map = loadLocalDailyQuestTasksByDate();
        const todayTasks = map?.[todayStr];
        setDailyQuestDateStr(todayStr);
        setDailyQuestTasks(Array.isArray(todayTasks) ? todayTasks : []);
      } catch {
        setDailyQuestDateStr(toDateStrLocal(new Date()));
        setDailyQuestTasks([]);
      }

      try {
        const snapshots = loadLocalDailyQuestSnapshots();
        setCalendarDailyQuestSnapshots(Array.isArray(snapshots) ? snapshots : []);
      } catch {
        setCalendarDailyQuestSnapshots([]);
      }

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
  }, [applyQuickMemoValue, auth?.isLoading, loadLocalDailyQuestSnapshots, loadLocalDailyQuestTasksByDate, loadLocalNotes, loadLocalQuickMemo, loadLocalSchedules, refreshFromSupabase, replaceAppState, userId]);

  // 日次達成（デイリー全クリア）: 0時を跨いだら前日分を確定スナップショットとして保存
  // さらに、前日に「完了」したタスクは翌日に未完了として再作成（不要ならユーザーが削除）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const normalizeTitleKey = (value) => {
      const trimmed = String(value ?? '').trim();
      if (!trimmed) return '';
      let normalized = trimmed;
      try {
        normalized = normalized.normalize('NFKC');
      } catch {
        // ignore
      }
      return normalized.toLowerCase();
    };

    const getMsUntilNextLocalMidnight = () => {
      const now = new Date();
      const next = new Date(now);
      // 0:00:00.050 に寄せて境界のズレを避ける
      next.setHours(24, 0, 0, 50);
      return Math.max(0, next.getTime() - now.getTime());
    };

    const sortDailyQuestTasks = (list) => {
      const tasks = Array.isArray(list) ? list : [];
      return tasks
        .slice()
        .sort((a, b) => {
          const aOrder = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : null;
          const bOrder = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : null;
          if (aOrder != null || bOrder != null) {
            if (aOrder == null) return 1;
            if (bOrder == null) return -1;
            const diffOrder = aOrder - bOrder;
            if (diffOrder !== 0) return diffOrder;
          }
          const diff = String(a?.created_at ?? '').localeCompare(String(b?.created_at ?? ''));
          if (diff !== 0) return diff;
          return Number(a?.id ?? 0) - Number(b?.id ?? 0);
        });
    };

    const buildCarryOverTitles = (tasks) => {
      const list = Array.isArray(tasks) ? tasks : [];
      const map = new Map();
      for (const t of list) {
        const title = String(t?.title ?? '').trim();
        const key = normalizeTitleKey(title);
        if (!key) continue;
        if (!map.has(key)) {
          map.set(key, title);
        }
      }
      return Array.from(map.values());
    };

    const buildTitleKeySet = (tasks) => {
      const set = new Set();
      const list = Array.isArray(tasks) ? tasks : [];
      for (const t of list) {
        const key = normalizeTitleKey(t?.title);
        if (key) set.add(key);
      }
      return set;
    };

    const computeCarryOverInsertTitles = (fromTasks, toTasks) => {
      const sortedFrom = sortDailyQuestTasks(fromTasks);
      const sortedTo = sortDailyQuestTasks(toTasks);
      const fromMap = new Map();
      for (const t of sortedFrom) {
        const title = String(t?.title ?? '').trim();
        const key = normalizeTitleKey(title);
        if (!key) continue;
        if (!fromMap.has(key)) fromMap.set(key, title);
      }
      const toKeys = buildTitleKeySet(sortedTo);
      const insertTitles = [];
      for (const [key, title] of fromMap.entries()) {
        if (toKeys.has(key)) continue;
        insertTitles.push(title);
      }
      return insertTitles;
    };

    const shouldAutoAdvanceSelectedDate = (yesterdayStr) => {
      const currentSelected = String(selectedDateStr ?? '').trim();
      if (!currentSelected) return false;
      return currentSelected === String(yesterdayStr ?? '').trim();
    };

    const tick = async () => {
      const todayStr = toDateStrLocal(new Date());
      const last = lastDailyQuestDateTickRef.current;

      if (last == null) {
        lastDailyQuestDateTickRef.current = todayStr;
        return;
      }

      if (last === todayStr) return;
      const yesterdayStr = last;
      lastDailyQuestDateTickRef.current = todayStr;

      // 0時跨ぎ直後に「昨日の表示」が残らないよう、まずUI上の日付を進める
      setDailyQuestDateStr(todayStr);
      if (shouldAutoAdvanceSelectedDate(yesterdayStr)) {
        setSelectedDate(new Date());
      }

      // carry-over の元になる昨日のタスク（切替直前の状態）
      const yesterdayTasksInMemory = Array.isArray(dailyQuestTasksRef.current) ? dailyQuestTasksRef.current : [];
      const carryOverTitles = buildCarryOverTitles(yesterdayTasksInMemory);

      if (!userId) {
        // ローカル: 前日のスナップショットを作成
        try {
          const map = loadLocalDailyQuestTasksByDate();
          const yesterdayTasks = Array.isArray(map?.[yesterdayStr]) ? map[yesterdayStr] : [];
          const totalCount = yesterdayTasks.length;
          const completedCount = yesterdayTasks.filter((t) => !!t?.completed).length;
          const isCleared = totalCount > 0 && totalCount === completedCount;

          const existing = loadLocalDailyQuestSnapshots();
          const next = [
            ...(Array.isArray(existing) ? existing.filter((row) => String(row?.date_str ?? '') !== yesterdayStr) : []),
            {
              date_str: yesterdayStr,
              total_count: totalCount,
              completed_count: completedCount,
              is_cleared: isCleared,
              created_at: new Date().toISOString(),
            },
          ].sort((a, b) => String(a?.date_str ?? '').localeCompare(String(b?.date_str ?? '')));

          saveLocalDailyQuestSnapshots(next);
          setCalendarDailyQuestSnapshots(next);
        } catch (error) {
          console.warn('[Local] daily quest snapshot skipped:', error);
        }

        try {
          const map = loadLocalDailyQuestTasksByDate();
          const todayTasks = Array.isArray(map?.[todayStr]) ? map[todayStr] : [];
          const existingKeys = buildTitleKeySet(todayTasks);
          const baseSort = Math.max(-1,
            ...todayTasks
              .map((t) => Number(t?.sort_order))
              .filter((v) => Number.isFinite(v))
          );
          let nextOrder = Number.isFinite(baseSort) ? baseSort + 1 : todayTasks.length;
          const nowIso = new Date().toISOString();

          const carryOver = carryOverTitles
            .map((title) => {
              const key = normalizeTitleKey(title);
              if (key && existingKeys.has(key)) {
                return null;
              }
              if (key) existingKeys.add(key);
              const created = {
                id: createTempId(),
                user_id: null,
                date_str: todayStr,
                title,
                completed: false,
                sort_order: nextOrder,
                created_at: nowIso,
                updated_at: nowIso,
              };
              nextOrder += 1;
              return created;
            })
            .filter(Boolean);

          const nextTodayTasks = sortDailyQuestTasks([...todayTasks, ...carryOver]);
          map[todayStr] = nextTodayTasks;
          saveLocalDailyQuestTasksByDate(map);
          setDailyQuestTasks(nextTodayTasks);
        } catch {
          setDailyQuestTasks([]);
        }

        return;
      }

      // Supabase: いったん旧日の表示を消して、今日分へ
      setDailyQuestTasks([]);

      // Supabase: 前日のスナップショットをRPCで記録
      try {
        await recordDailyQuestSnapshot({ targetDateStr: yesterdayStr });
      } catch (error) {
        console.warn('[Supabase] record_daily_quest_snapshot skipped:', error);
      }

      // Supabase: 前日の全タスクを翌日に未完了として再作成
      if (carryOverTitles.length > 0) {
        try {
          const existingToday = await fetchDailyQuestTasksForUserByDate({ userId, dateStr: todayStr }).catch(() => []);
          const existingKeys = buildTitleKeySet(existingToday);
          const baseSort = Math.max(-1,
            ...(Array.isArray(existingToday) ? existingToday : [])
              .map((t) => Number(t?.sort_order))
              .filter((v) => Number.isFinite(v))
          );
          let sortOrder = Number.isFinite(baseSort) ? baseSort + 1 : 0;

          for (const title of carryOverTitles) {
            if (!title) continue;
            const key = normalizeTitleKey(title);
            if (key && existingKeys.has(key)) continue;
            if (key) existingKeys.add(key);

            const created = await createDailyQuestTaskForUser({
              userId,
              dateStr: todayStr,
              title,
              sortOrder,
            });
            sortOrder += 1;
            markRealtimeSelfWrite('daily_quest_tasks', created?.id ?? null);
          }
        } catch (error) {
          console.warn('[Supabase] carry over daily quest tasks skipped:', error);
        }
      }

      requestSupabaseSync('daily_quest_day_change');
    };

    // Debug helpers: 0時を待たずに carry-over を検証できるようにする
    // - 既定: 開発モードのみ
    // - 例外: 明示 opt-in（URLクエリ or localStorage）
    const isDebugCarryOverEnabled = (() => {
      if (typeof window === 'undefined') return false;
      if (import.meta?.env?.DEV) return true;
      try {
        if (String(window.location?.search ?? '').includes('debugDailyQuest=1')) return true;
      } catch {
        // ignore
      }
      try {
        if (window.localStorage?.getItem('debugDailyQuest') === '1') return true;
      } catch {
        // ignore
      }
      return false;
    })();

    if (typeof window !== 'undefined' && isDebugCarryOverEnabled) {
      const ensureDebugRoot = () => {
        if (!window.__theScheduleDebug) window.__theScheduleDebug = {};
        return window.__theScheduleDebug;
      };

      const listDailyQuestTasks = async ({ dateStr } = {}) => {
        const safeDate = String(dateStr ?? '').trim();
        if (!safeDate) throw new Error('listDailyQuestTasks には { dateStr } が必要です');
        if (!userId) {
          const map = loadLocalDailyQuestTasksByDate();
          return Array.isArray(map?.[safeDate]) ? map[safeDate] : [];
        }
        return fetchDailyQuestTasksForUserByDate({ userId, dateStr: safeDate });
      };

      const createDailyQuestTaskOnDate = async ({ dateStr, title } = {}) => {
        const safeDate = String(dateStr ?? '').trim();
        const safeTitle = String(title ?? '').trim();
        if (!safeDate || !safeTitle) {
          throw new Error('createDailyQuestTaskOnDate には { dateStr, title } が必要です');
        }

        if (!userId) {
          const map = loadLocalDailyQuestTasksByDate();
          const prev = Array.isArray(map?.[safeDate]) ? map[safeDate] : [];
          const exists = prev.some((t) => normalizeTitleKey(t?.title) === normalizeTitleKey(safeTitle));
          if (exists) throw new Error('同名のクエストは登録できません。');

          const baseSort = Math.max(-1,
            ...prev
              .map((t) => Number(t?.sort_order))
              .filter((v) => Number.isFinite(v))
          );
          const sortOrder = Number.isFinite(baseSort) ? baseSort + 1 : prev.length;
          const nowIso = new Date().toISOString();
          const created = {
            id: createTempId(),
            user_id: null,
            date_str: safeDate,
            title: safeTitle,
            completed: false,
            sort_order: sortOrder,
            created_at: nowIso,
            updated_at: nowIso,
          };
          const next = sortDailyQuestTasks([...prev, created]);
          map[safeDate] = next;
          saveLocalDailyQuestTasksByDate(map);
          return created;
        }

        const existing = await fetchDailyQuestTasksForUserByDate({ userId, dateStr: safeDate }).catch(() => []);
        const exists = (Array.isArray(existing) ? existing : []).some((t) => normalizeTitleKey(t?.title) === normalizeTitleKey(safeTitle));
        if (exists) throw new Error('同名のクエストは登録できません。');

        const baseSort = Math.max(-1,
          ...(Array.isArray(existing) ? existing : [])
            .map((t) => Number(t?.sort_order))
            .filter((v) => Number.isFinite(v))
        );
        const sortOrder = Number.isFinite(baseSort) ? baseSort + 1 : 0;
        const created = await createDailyQuestTaskForUser({ userId, dateStr: safeDate, title: safeTitle, sortOrder });
        markRealtimeSelfWrite('daily_quest_tasks', created?.id ?? null);
        return created;
      };

      const deleteDailyQuestTaskByTitleOnDate = async ({ dateStr, title } = {}) => {
        const safeDate = String(dateStr ?? '').trim();
        const safeTitle = String(title ?? '').trim();
        if (!safeDate || !safeTitle) {
          throw new Error('deleteDailyQuestTaskByTitleOnDate には { dateStr, title } が必要です');
        }

        if (!userId) {
          const map = loadLocalDailyQuestTasksByDate();
          const prev = Array.isArray(map?.[safeDate]) ? map[safeDate] : [];
          const key = normalizeTitleKey(safeTitle);
          const next = prev.filter((t) => normalizeTitleKey(t?.title) !== key);
          map[safeDate] = next;
          saveLocalDailyQuestTasksByDate(map);
          return { deleted: prev.length - next.length };
        }

        const existing = await fetchDailyQuestTasksForUserByDate({ userId, dateStr: safeDate }).catch(() => []);
        const key = normalizeTitleKey(safeTitle);
        const targets = (Array.isArray(existing) ? existing : []).filter((t) => normalizeTitleKey(t?.title) === key);
        if (targets.length === 0) return { deleted: 0 };
        for (const t of targets) {
          const id = t?.id ?? null;
          if (id == null) continue;
          markRealtimeSelfWrite('daily_quest_tasks', id);
          await deleteDailyQuestTaskForUser({ userId, id });
        }
        return { deleted: targets.length };
      };

      const previewDailyQuestCarryOver = async ({ fromDateStr, toDateStr } = {}) => {
        const safeFrom = String(fromDateStr ?? '').trim();
        const safeTo = String(toDateStr ?? '').trim();
        if (!safeFrom || !safeTo) {
          throw new Error('previewDailyQuestCarryOver には { fromDateStr, toDateStr } が必要です');
        }

        if (!userId) {
          const map = loadLocalDailyQuestTasksByDate();
          const fromTasks = Array.isArray(map?.[safeFrom]) ? map[safeFrom] : [];
          const toTasks = Array.isArray(map?.[safeTo]) ? map[safeTo] : [];
          const insertTitles = computeCarryOverInsertTitles(fromTasks, toTasks);
          return {
            mode: 'local',
            fromDateStr: safeFrom,
            toDateStr: safeTo,
            fromTotal: fromTasks.length,
            toTotal: toTasks.length,
            willInsert: insertTitles.length,
            titles: insertTitles,
          };
        }

        const [fromTasks, toTasks] = await Promise.all([
          fetchDailyQuestTasksForUserByDate({ userId, dateStr: safeFrom }).catch(() => []),
          fetchDailyQuestTasksForUserByDate({ userId, dateStr: safeTo }).catch(() => []),
        ]);
        const insertTitles = computeCarryOverInsertTitles(fromTasks, toTasks);
        return {
          mode: 'supabase',
          fromDateStr: safeFrom,
          toDateStr: safeTo,
          fromTotal: Array.isArray(fromTasks) ? fromTasks.length : 0,
          toTotal: Array.isArray(toTasks) ? toTasks.length : 0,
          willInsert: insertTitles.length,
          titles: insertTitles,
        };
      };

      const runDailyQuestCarryOver = async ({ fromDateStr, toDateStr, confirm } = {}) => {
        if (confirm !== true) {
          throw new Error('runDailyQuestCarryOver を実行するには { confirm: true } が必要です');
        }
        const safeFrom = String(fromDateStr ?? '').trim();
        const safeTo = String(toDateStr ?? '').trim();
        if (!safeFrom || !safeTo) {
          throw new Error('runDailyQuestCarryOver には { fromDateStr, toDateStr } が必要です');
        }

        if (!userId) {
          const map = loadLocalDailyQuestTasksByDate();
          const fromTasks = Array.isArray(map?.[safeFrom]) ? map[safeFrom] : [];
          const toTasks = Array.isArray(map?.[safeTo]) ? map[safeTo] : [];
          const insertTitles = computeCarryOverInsertTitles(fromTasks, toTasks);

          const baseSort = Math.max(-1,
            ...toTasks
              .map((t) => Number(t?.sort_order))
              .filter((v) => Number.isFinite(v))
          );
          let nextOrder = Number.isFinite(baseSort) ? baseSort + 1 : toTasks.length;
          const nowIso = new Date().toISOString();

          const createdTasks = insertTitles.map((title) => {
            const created = {
              id: createTempId(),
              user_id: null,
              date_str: safeTo,
              title,
              completed: false,
              sort_order: nextOrder,
              created_at: nowIso,
              updated_at: nowIso,
            };
            nextOrder += 1;
            return created;
          });

          const nextToTasks = sortDailyQuestTasks([...toTasks, ...createdTasks]);
          map[safeTo] = nextToTasks;
          saveLocalDailyQuestTasksByDate(map);
          if (safeTo === toDateStrLocal(new Date())) {
            setDailyQuestTasks(nextToTasks);
          }
          return { inserted: createdTasks.length };
        }

        const [fromTasks, toTasks] = await Promise.all([
          fetchDailyQuestTasksForUserByDate({ userId, dateStr: safeFrom }).catch(() => []),
          fetchDailyQuestTasksForUserByDate({ userId, dateStr: safeTo }).catch(() => []),
        ]);
        const insertTitles = computeCarryOverInsertTitles(fromTasks, toTasks);
        if (insertTitles.length === 0) return { inserted: 0 };

        const baseSort = Math.max(-1,
          ...(Array.isArray(toTasks) ? toTasks : [])
            .map((t) => Number(t?.sort_order))
            .filter((v) => Number.isFinite(v))
        );
        let sortOrder = Number.isFinite(baseSort) ? baseSort + 1 : 0;
        let inserted = 0;
        for (const title of insertTitles) {
          const created = await createDailyQuestTaskForUser({
            userId,
            dateStr: safeTo,
            title,
            sortOrder,
          });
          sortOrder += 1;
          inserted += 1;
          markRealtimeSelfWrite('daily_quest_tasks', created?.id ?? null);
        }
        requestSupabaseSync('debug:carry_over');
        return { inserted };
      };

      const debugRoot = ensureDebugRoot();
      debugRoot.previewDailyQuestCarryOver = previewDailyQuestCarryOver;
      debugRoot.runDailyQuestCarryOver = runDailyQuestCarryOver;
      debugRoot.forceDailyQuestTick = () => tick();
      debugRoot.listDailyQuestTasks = listDailyQuestTasks;
      debugRoot.createDailyQuestTaskOnDate = createDailyQuestTaskOnDate;
      debugRoot.deleteDailyQuestTaskByTitleOnDate = deleteDailyQuestTaskByTitleOnDate;
    }

    let disposed = false;
    let midnightTimerId = null;

    const scheduleMidnight = () => {
      if (disposed) return;
      const ms = getMsUntilNextLocalMidnight();
      midnightTimerId = window.setTimeout(() => {
        midnightTimerId = null;
        tick().catch(() => {});
        scheduleMidnight();
      }, ms);
    };

    // フォールバック（環境によって setTimeout が遅延する場合の保険）
    const intervalId = window.setInterval(() => {
      tick().catch(() => {});
    }, DAILY_QUEST_TICK_MS);

    // 起動直後にも同期しておく
    tick().catch(() => {});
    scheduleMidnight();

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      if (midnightTimerId != null) {
        window.clearTimeout(midnightTimerId);
      }
    };
  }, [
    createDailyQuestTaskForUser,
    fetchDailyQuestTasksForUserByDate,
    loadLocalDailyQuestSnapshots,
    loadLocalDailyQuestTasksByDate,
    markRealtimeSelfWrite,
    recordDailyQuestSnapshot,
    requestSupabaseSync,
    saveLocalDailyQuestSnapshots,
    saveLocalDailyQuestTasksByDate,
    selectedDateStr,
    setSelectedDate,
    userId,
  ]);

  // Supabase Realtime: daily_quest_tasks 変更を検知して再同期
  useEffect(() => {
    if (!userId) return;

    let isDisposed = false;
    const channel = supabase
      .channel(`daily_quest_tasks:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_quest_tasks',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (isDisposed) return;
          const rowId = payload?.new?.id ?? payload?.old?.id ?? null;
          if (rowId != null && shouldIgnoreRealtimeEvent('daily_quest_tasks', rowId)) {
            return;
          }
          const todayStr = toDateStrLocal(new Date());
          const dateStr = String(payload?.new?.date_str ?? payload?.old?.date_str ?? '');
          if (dateStr && dateStr !== todayStr) {
            // 今回のUIは基本「今日のタスク」だけを見るので、別日の更新はスキップ
            return;
          }
          console.info('[SupabaseRealtime] daily_quest_tasks changed', JSON.stringify({
            eventType: payload?.eventType,
            table: payload?.table,
            timestamp: new Date().toISOString(),
          }));
          requestSupabaseSync('realtime:daily_quest_tasks');
        }
      )
      .subscribe((status) => {
        console.info('[SupabaseRealtime] daily_quest_tasks subscription', JSON.stringify({ status }));
      });

    return () => {
      isDisposed = true;
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, [requestSupabaseSync, shouldIgnoreRealtimeEvent, userId]);

  // Supabase Realtime: daily_quest_snapshots 変更を検知してカレンダー表示を更新
  useEffect(() => {
    if (!userId) return;

    let isDisposed = false;
    const channel = supabase
      .channel(`daily_quest_snapshots:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_quest_snapshots',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (isDisposed) return;
          const rowId = payload?.new?.id ?? payload?.old?.id ?? null;
          if (rowId != null && shouldIgnoreRealtimeEvent('daily_quest_snapshots', rowId)) {
            return;
          }
          console.info('[SupabaseRealtime] daily_quest_snapshots changed', JSON.stringify({
            eventType: payload?.eventType,
            table: payload?.table,
            timestamp: new Date().toISOString(),
          }));
          requestSupabaseSync('realtime:daily_quest_snapshots');
        }
      )
      .subscribe((status) => {
        console.info('[SupabaseRealtime] daily_quest_snapshots subscription', JSON.stringify({ status }));
      });

    return () => {
      isDisposed = true;
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, [requestSupabaseSync, shouldIgnoreRealtimeEvent, userId]);

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
          const rowId = payload?.new?.id ?? payload?.old?.id ?? null;
          if (rowId != null && shouldIgnoreRealtimeEvent('notes', rowId)) {
            return;
          }
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
  }, [requestSupabaseSync, shouldIgnoreRealtimeEvent, userId]);

  // Supabase Realtime: 他端末/他ウィンドウの予定/タスク変更を検知して再同期
  useEffect(() => {
    if (!userId) return;

    let isDisposed = false;
    const channel = supabase
      .channel(`schedules:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'schedules',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (isDisposed) return;
          const rowId = payload?.new?.id ?? payload?.old?.id ?? null;
          if (rowId != null && shouldIgnoreRealtimeEvent('schedules', rowId)) {
            return;
          }
          console.info('[SupabaseRealtime] schedules changed', JSON.stringify({
            eventType: payload?.eventType,
            table: payload?.table,
            timestamp: new Date().toISOString(),
          }));
          requestSupabaseSync('realtime:schedules');
        }
      )
      .subscribe((status) => {
        console.info('[SupabaseRealtime] schedules subscription', JSON.stringify({ status }));
      });

    return () => {
      isDisposed = true;
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, [requestSupabaseSync, shouldIgnoreRealtimeEvent, userId]);

  // Supabase Realtime: 他端末/他ウィンドウのクイックメモ変更を検知して再同期
  useEffect(() => {
    if (!userId) return;

    let isDisposed = false;
    const channel = supabase
      .channel(`quick_memos:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quick_memos',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (isDisposed) return;
          const rowKey = payload?.new?.user_id ?? payload?.old?.user_id ?? null;
          if (rowKey != null && shouldIgnoreRealtimeEvent('quick_memos', rowKey)) {
            return;
          }
          console.info('[SupabaseRealtime] quick_memos changed', JSON.stringify({
            eventType: payload?.eventType,
            table: payload?.table,
            timestamp: new Date().toISOString(),
          }));
          requestSupabaseSync('realtime:quick_memos');
        }
      )
      .subscribe((status) => {
        console.info('[SupabaseRealtime] quick_memos subscription', JSON.stringify({ status }));
      });

    return () => {
      isDisposed = true;
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, [requestSupabaseSync, shouldIgnoreRealtimeEvent, userId]);

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

  const refreshCalendarDailyQuestSnapshots = useCallback(async () => {
    const range = calendarVisibleRangeRef.current;
    if (!range?.startDate || !range?.endDate) return;

    if (!userId) {
      const all = loadLocalDailyQuestSnapshots();
      const list = (Array.isArray(all) ? all : []).filter((row) => {
        const d = String(row?.date_str ?? '');
        if (!d) return false;
        return d >= range.startDate && d <= range.endDate;
      });
      setCalendarDailyQuestSnapshots(list);
      return;
    }

    try {
      const list = await fetchDailyQuestSnapshotsForUserInRange({
        userId,
        startDate: range.startDate,
        endDate: range.endDate,
      });
      setCalendarDailyQuestSnapshots(Array.isArray(list) ? list : []);
    } catch (error) {
      console.warn('[Supabase] daily_quest_snapshots fetch skipped:', error);
      setCalendarDailyQuestSnapshots([]);
    }
  }, [userId]);

  const refreshCalendarDailyQuestTasks = useCallback(async () => {
    const range = calendarVisibleRangeRef.current;
    if (!range?.startDate || !range?.endDate) return;

    if (!userId) {
      const map = loadLocalDailyQuestTasksByDate();
      const list = [];
      const entries = map && typeof map === 'object' ? Object.entries(map) : [];
      for (const [dateStr, tasks] of entries) {
        if (!dateStr) continue;
        if (dateStr < range.startDate || dateStr > range.endDate) continue;
        const rows = Array.isArray(tasks) ? tasks : [];
        rows.forEach((row) => {
          list.push({
            ...row,
            date_str: String(dateStr),
            title: String(row?.title ?? ''),
            completed: !!row?.completed,
          });
        });
      }
      setCalendarDailyQuestTasksInRange(list);
      return;
    }

    try {
      const list = await fetchDailyQuestTasksForUserInRange({
        userId,
        startDate: range.startDate,
        endDate: range.endDate,
      });
      setCalendarDailyQuestTasksInRange(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error('[Supabase] Failed to fetch daily quest tasks in range:', error);
      setCalendarDailyQuestTasksInRange([]);
    }
  }, [loadLocalDailyQuestTasksByDate, userId]);

  const calendarDailyQuestTaskTitlesByDate = useMemo(() => {
    const map = {};
    const list = Array.isArray(calendarDailyQuestTasksInRange) ? calendarDailyQuestTasksInRange : [];
    for (const row of list) {
      const dateStr = String(row?.date_str ?? '').trim();
      if (!dateStr) continue;
      if (!row?.completed) continue;
      const title = String(row?.title ?? '').trim();
      if (!title) continue;
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(title);
    }

    // 今日の表示はローカルstateを優先（range取得が遅延/未反映でも即反映）
    const todayStr = String(dailyQuestDateStr ?? '').trim();
    if (todayStr) {
      const tasks = Array.isArray(dailyQuestTasks) ? dailyQuestTasks : [];
      const titles = tasks
        .filter((t) => !!t?.completed)
        .map((t) => String(t?.title ?? '').trim())
        .filter(Boolean);
      if (titles.length > 0) {
        map[todayStr] = titles;
      }
    }

    Object.keys(map).forEach((key) => {
      map[key] = Array.from(new Set(map[key]));
    });

    return map;
  }, [calendarDailyQuestTasksInRange, dailyQuestDateStr, dailyQuestTasks]);

  const calendarNoteTitlesByDate = useMemo(() => {
    const range = calendarVisibleRange && typeof calendarVisibleRange === 'object' ? calendarVisibleRange : null;
    const startDate = typeof range?.startDate === 'string' ? range.startDate : null;
    const endDate = typeof range?.endDate === 'string' ? range.endDate : null;
    const list = Array.isArray(notes) ? notes : [];
    const map = {};

    for (const note of list) {
      const createdAt = note?.created_at;
      if (!createdAt) continue;
      const dateStr = toDateStrLocal(new Date(createdAt));
      if (!dateStr) continue;
      if (startDate && dateStr < startDate) continue;
      if (endDate && dateStr > endDate) continue;

      const rawTitle = String(note?.title ?? '').trim();
      const title = rawTitle ? rawTitle : '無題のノート';
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(title);
    }

    // 重複を削って安定化
    Object.keys(map).forEach((key) => {
      map[key] = Array.from(new Set(map[key]));
    });

    return map;
  }, [calendarVisibleRange, notes]);

  const handleCalendarVisibleRangeChange = useCallback((range) => {
    if (!range?.startDate || !range?.endDate) return;

    const prev = calendarVisibleRangeRef.current;
    const changed = !prev || prev.startDate !== range.startDate || prev.endDate !== range.endDate;

    calendarVisibleRangeRef.current = { startDate: range.startDate, endDate: range.endDate };
    setCalendarVisibleRange({ startDate: range.startDate, endDate: range.endDate });
    refreshCalendarNoteDates().catch(() => {});
    refreshCalendarDailyQuestSnapshots().catch(() => {});
    refreshCalendarDailyQuestTasks().catch(() => {});
    if (changed) {
      requestSupabaseSync('visible_range_change', { showSpinner: false });
    }
  }, [refreshCalendarDailyQuestSnapshots, refreshCalendarDailyQuestTasks, refreshCalendarNoteDates, requestSupabaseSync]);

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
        markRealtimeSelfWrite('notes', noteId);
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
  }, [beginSupabaseJob, endSupabaseJob, loadLocalNotes, markRealtimeSelfWrite, saveLocalNotes, userId]);

  const handleToggleArchiveNote = useCallback((note, nextArchived) => {
    if (!note) return;
    const noteId = note?.id ?? null;
    if (noteId == null) return;
    if (note?.__isDraft) return;

    const idKey = String(noteId);
    const archived = !!nextArchived;
    const shouldForceImportantOff = archived;

    // ログイン中はDBへ同期
    if (userId) {
      handleUpdateNote(noteId, {
        archived,
        ...(shouldForceImportantOff ? { important: false } : null),
      });
      return;
    }

    if (shouldForceImportantOff) {
      const nextImportantFlags = { ...(noteImportantFlagsRef.current || {}) };
      if (nextImportantFlags[idKey]) {
        delete nextImportantFlags[idKey];
        noteImportantFlagsRef.current = nextImportantFlags;
        saveNoteImportantFlags(noteArchiveUserKey, nextImportantFlags);
      }
    }

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
      return list.map((n) => {
        if ((n?.id ?? null) !== noteId) return n;
        return {
          ...n,
          archived,
          ...(shouldForceImportantOff ? { important: false } : null),
        };
      });
    });

    const allNotes = loadLocalNotes();
    const nextAllNotes = allNotes.map((n) => {
      if ((n?.id ?? null) !== noteId) return n;
      return {
        ...n,
        archived,
        ...(shouldForceImportantOff ? { important: false } : null),
      };
    });
    saveLocalNotes(nextAllNotes);
  }, [handleUpdateNote, loadLocalNotes, noteArchiveUserKey, saveLocalNotes, saveNoteArchiveFlags, saveNoteImportantFlags, userId]);

  const handleToggleImportantNote = useCallback((note, nextImportant) => {
    if (!note) return;
    const noteId = note?.id ?? null;
    if (noteId == null) return;
    if (note?.__isDraft) return;

    const idKey = String(noteId);
    const important = !!nextImportant;
    const shouldForceArchivedOff = important;

    // ログイン中はDBへ同期
    if (userId) {
      handleUpdateNote(noteId, {
        important,
        ...(shouldForceArchivedOff ? { archived: false } : null),
      });
      return;
    }

    if (shouldForceArchivedOff) {
      const nextArchiveFlags = { ...(noteArchiveFlagsRef.current || {}) };
      if (nextArchiveFlags[idKey]) {
        delete nextArchiveFlags[idKey];
        noteArchiveFlagsRef.current = nextArchiveFlags;
        saveNoteArchiveFlags(noteArchiveUserKey, nextArchiveFlags);
      }
    }

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
      return list.map((n) => {
        if ((n?.id ?? null) !== noteId) return n;
        return {
          ...n,
          important,
          ...(shouldForceArchivedOff ? { archived: false } : null),
        };
      });
    });

    const allNotes = loadLocalNotes();
    const nextAllNotes = allNotes.map((n) => {
      if ((n?.id ?? null) !== noteId) return n;
      return {
        ...n,
        important,
        ...(shouldForceArchivedOff ? { archived: false } : null),
      };
    });
    saveLocalNotes(nextAllNotes);
  }, [handleUpdateNote, loadLocalNotes, noteArchiveUserKey, saveLocalNotes, saveNoteArchiveFlags, saveNoteImportantFlags, userId]);

  const handleCommitDraftNote = useCallback((noteId, overrides) => {
    if (noteId == null) return;
    if (!userId) return;

    const currentNote = notesRef.current.find((note) => (note?.id ?? null) === noteId) || null;
    if (!currentNote || !currentNote.__isDraft) return;

    const safeOverrides = overrides && typeof overrides === 'object' ? overrides : {};
    const effectiveTitle = typeof safeOverrides.title === 'string' ? safeOverrides.title : currentNote.title;
    const effectiveContent = typeof safeOverrides.content === 'string' ? safeOverrides.content : currentNote.content;
    const effectiveDate = safeOverrides.date || currentNote.date;

    const titleTrimmed = typeof effectiveTitle === 'string' ? effectiveTitle.trim() : '';
    const contentTrimmed = typeof effectiveContent === 'string' ? effectiveContent.trim() : '';
    const shouldSkipBecauseEmpty = !titleTrimmed && !contentTrimmed;
    if (shouldSkipBecauseEmpty) return;

    const inFlight = noteDraftCreateInFlightRef.current;
    if (inFlight.has(noteId)) return;
    inFlight.add(noteId);

    const jobMeta = { kind: 'noteCreate' };
    beginSupabaseJob(jobMeta);
    createNoteForUser({
      userId,
      date: effectiveDate || selectedDateStr,
      title: effectiveTitle ?? '',
      content: effectiveContent ?? '',
    })
      .then(async (created) => {
        markRealtimeSelfWrite('notes', created?.id ?? null);
        setNotes((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const filtered = list.filter((n) => (n?.id ?? null) !== noteId);
          return [created, ...filtered];
        });
        setSupabaseError(null);
        refreshCalendarNoteDates().catch(() => {});

        // まだ同じ下書きを開いている場合だけ、IDを差し替えて開いたままにする
        if (created?.id != null && activeNoteIdRef.current != null && String(activeNoteIdRef.current) === String(noteId)) {
          setActiveNoteId(created.id);
        }

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
        inFlight.delete(noteId);
        endSupabaseJob(jobMeta);
      });
  }, [beginSupabaseJob, createNoteForUser, endSupabaseJob, fetchNotesForUser, markRealtimeSelfWrite, refreshCalendarNoteDates, selectedDateStr, userId]);

  const handleRequestCloseNote = useCallback((noteId) => {
    const restoreFromLink = () => {
      const snapshot = noteLinkReturnStateRef.current;
      if (!snapshot) return;
      if (noteId == null) return;
      if (snapshot.sharedNoteId == null) return;
      if (String(snapshot.sharedNoteId) !== String(noteId)) return;

      if (typeof snapshot.timelineActiveTab === 'string') {
        setTimelineActiveTab(snapshot.timelineActiveTab);
      }
      setIsTimelineOpen(!!snapshot.isTimelineOpen);
      noteLinkReturnStateRef.current = null;
    };

    // ノート内リンクの履歴があれば、閉じる=1つ戻る（モーダルは維持）
    if (typeof window !== 'undefined') {
      const fromHash = parseNoteIdFromHash(window.location.hash);
      if (fromHash != null && noteId != null && String(fromHash) === String(noteId)) {
        const stack = noteLinkBackStackRef.current;
        if (Array.isArray(stack) && stack.length > 0) {
          const prev = stack.pop();
          if (prev != null) {
            noteLinkNavIsBackRef.current = true;
            setActiveNoteId(prev);
            setNoteHash(prev);
            return;
          }
        }
      }
    }

    // 通常のクローズ
    setActiveNoteId(null);
    activeNoteIdRef.current = null;

    if (typeof window !== 'undefined') {
      const fromHash = parseNoteIdFromHash(window.location.hash);
      if (fromHash != null && noteId != null && String(fromHash) === String(noteId)) {
        restoreFromLink();
        clearNoteHash();
        lastHashNoteIdRef.current = null;
        noteLinkBackStackRef.current = [];
        noteLinkNavIsBackRef.current = false;
        // clearNoteHash() は replaceState を使うので hashchange が発火しない。
        // sharedNoteId を明示的にリセットしないと、同じ共有リンクを再クリックしても
        // state が変わらず「2回目以降に開けない」ことがある。
        setSharedNoteId(null);
      }
    }

    // hashリンク以外（例: ノート一覧から開いた）の場合は復元しない。
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

      handleCommitDraftNote(noteId);
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
      markRealtimeSelfWrite('notes', noteId);
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
    markRealtimeSelfWrite('notes', noteId);
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
    handleCommitDraftNote,
    loadLocalNotes,
    markRealtimeSelfWrite,
    refreshCalendarNoteDates,
    saveLocalNotes,
    userId,
  ]);

  useEffect(() => {
    if (!userId) return;
    if (activeNoteId == null) return;

    const currentNote = notesRef.current.find((note) => (note?.id ?? null) === activeNoteId) || null;
    if (currentNote?.__isDraft) return;

    let cancelled = false;
    fetchNoteForUserById({ userId, id: activeNoteId })
      .then((fresh) => {
        if (cancelled) return;
        setNotes((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const exists = list.some((note) => (note?.id ?? null) === activeNoteId);
          if (!exists) {
            const archived = typeof fresh?.archived === 'boolean' ? fresh.archived : !!noteArchiveFlagsRef.current?.[String(activeNoteId)];
            const important = typeof fresh?.important === 'boolean' ? fresh.important : !!noteImportantFlagsRef.current?.[String(activeNoteId)];
            return [{ ...fresh, archived, important }, ...list];
          }
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
      markRealtimeSelfWrite('notes', noteId);
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
  }, [beginSupabaseJob, endSupabaseJob, loadLocalNotes, markRealtimeSelfWrite, noteArchiveUserKey, refreshCalendarNoteDates, saveLocalNotes, saveNoteImportantFlags, userId]);
  
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

  useEffect(() => {
    if (isMobile) {
      setWideMode('none');
    }
  }, [isMobile]);

  const toggleWideMode = useCallback(
    (target = 'timeline') => {
      if (isMobile) return;
      const nextTarget = target === 'calendar' ? 'calendar' : 'timeline';
      setWideMode((prev) => (prev === nextTarget ? 'none' : nextTarget));
    },
    [isMobile]
  );

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
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('schedules', JSON.stringify(schedules));
      console.log('💾 Schedules saved to localStorage:', {
        count: schedules.length,
        historyIndex: currentIndex,
        historyLength: historyLength,
        lastAction: lastActionType,
      });
    } catch (error) {
      console.warn('⚠️ Failed to persist schedules to localStorage:', error);
    }
  }, [schedules, currentIndex, historyLength, lastActionType]);

  // 起動時に設定からレイアウト読み込み
  useEffect(() => {
    (async () => {
      if (typeof window !== 'undefined') {
        try {
          const savedRatio = window.localStorage.getItem('splitRatio');
          if (savedRatio) {
            const v = parseFloat(savedRatio);
            if (!isNaN(v)) {
              setSplitRatio(v);
              console.log('[layout] splitRatio loaded from localStorage:', v);
            }
          }
        } catch (error) {
          console.warn('⚠️ Failed to load splitRatio from localStorage:', error);
        }
      }
      setLayoutLoaded(true);
    })();
  }, []);

  // 分割比率変更時に保存（ロード完了後）
  useEffect(() => {
    if (!layoutLoaded) return; // 初期ロード完了までは保存しない
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('splitRatio', String(splitRatio));
    } catch (error) {
      console.warn('⚠️ Failed to persist splitRatio to localStorage:', error);
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

  const handleQuickMemoImmediatePersist = useCallback((value) => {
    if (!userId) return;
    persistQuickMemoToSupabase(value).catch(() => {});
  }, [persistQuickMemoToSupabase, userId]);

  // スワイプジェスチャーのハンドラー
  const handleTouchStart = (e) => {
    if (!e?.targetTouches || e.targetTouches.length === 0) return;
    touchEndRef.current = null;
    touchStartRef.current = {
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY,
    };
  };

  const handleTouchMove = (e) => {
    if (!e?.targetTouches || e.targetTouches.length === 0) return;
    touchEndRef.current = {
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY,
    };
  };

  const handleTouchEnd = () => {
    const start = touchStartRef.current;
    const end = touchEndRef.current;
    touchStartRef.current = null;
    touchEndRef.current = null;

    if (!start || !end) return;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // 縦スクロール中の誤判定を避ける: 横移動が十分大きく、かつ縦移動より優勢な場合のみ
    const isMostlyHorizontal = absDx > 70 && absDx > absDy * 1.4;
    const isRightSwipe = dx > 70;

    // 左から右へのスワイプでタイムラインを閉じる
    if (isMostlyHorizontal && isRightSwipe) {
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

    // カレンダー上のタップは、タスクでもタイムラインを開く
    setTimelineActiveTab('timeline');

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
      markRealtimeSelfWrite('schedules', scheduleId);
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
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, markRealtimeSelfWrite, requestSupabaseSync, setSupabaseError, userId]);

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
          markRealtimeSelfWrite('schedules', updated.id);
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
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, markRealtimeSelfWrite, requestSupabaseSync, setSupabaseError, userId]);

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
          markRealtimeSelfWrite('schedules', created?.id ?? null);

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
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, handleScheduleMove, markRealtimeSelfWrite, requestSupabaseSync, setSupabaseError, userId]);

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

    // 新規ID（copy等）を含む場合は、既存にない分を追加
    const existingIdSet = new Set(current.map((item) => item.id));
    const missing = scheduleUpdates.filter((item) => item?.id != null && !existingIdSet.has(item.id));
    if (missing.length > 0) {
      optimistic = [...optimistic, ...missing];
    }

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
          markRealtimeSelfWrite('schedules', scheduleUpdates.map((item) => item?.id ?? null).filter((id) => id != null));
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
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, markRealtimeSelfWrite, requestSupabaseSync, setSupabaseError, userId]);

  // タスクのチェック状態トグル
  const handleToggleTask = useCallback((target, completed) => {
    if (target == null) return;

    const entry =
      typeof target === 'object'
        ? target
        : (schedulesRef.current.find((item) => item.id === target)
          || completedTasksRef.current.find((item) => item?.id === target));

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
    let nextSchedules = currentSchedules;
    // schedules 側は完了/未完了どちらでも保持（カレンダー/タイムラインに出す）
    {
      const exists = currentSchedules.some((item) => item.id === scheduleId);
      if (exists) {
        nextSchedules = currentSchedules.map((item) => (item.id === scheduleId ? updatedSchedule : item));
      } else {
        // 可視範囲外のタスクを schedules に混入させない（可視範囲ロードの前提を守る）
        const range = calendarVisibleRangeRef.current;
        const dateStr = typeof updatedSchedule?.date === 'string' ? updatedSchedule.date : '';
        const inRange = !!(
          range?.startDate
          && range?.endDate
          && dateStr
          && dateStr >= range.startDate
          && dateStr <= range.endDate
        );
        nextSchedules = inRange ? [...currentSchedules, updatedSchedule] : currentSchedules;
      }
    }

    // タスクタブ用の未完了リスト
    if (completed) {
      setActiveTasks((prev) => (Array.isArray(prev) ? prev.filter((t) => (t?.id ?? null) !== scheduleId) : []));
    } else {
      setActiveTasks((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const filtered = base.filter((t) => (t?.id ?? null) !== scheduleId);
        return [updatedSchedule, ...filtered];
      });
    }

    if (completed) {
      // タスクタブの完了リスト（ページング表示用）は先頭に追加
      setCompletedTasks((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const filtered = base.filter((t) => (t?.id ?? null) !== scheduleId);
        return [updatedSchedule, ...filtered];
      });
    } else {
      // 未完了に戻す場合は完了リストから外す
      setCompletedTasks((prev) => (Array.isArray(prev) ? prev.filter((t) => (t?.id ?? null) !== scheduleId) : []));
    }
    commitSchedules(nextSchedules, 'task_toggle');
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
          markRealtimeSelfWrite('schedules', scheduleId);
          const persisted = await updateScheduleForUser(updatedSchedule, userId);
          const normalized = normalizeSchedule({
            ...persisted,
            isTask: persisted?.isTask ?? true,
          });

          {
            const latest = schedulesRef.current;
            const exists = latest.some((item) => item.id === normalized.id);
            const synced = exists
              ? latest.map((item) => (item.id === normalized.id ? normalized : item))
              : [...latest, normalized];
            commitSchedules(synced, 'task_toggle_sync');
          }

          if (normalized.completed) {
            setActiveTasks((prev) => (Array.isArray(prev) ? prev.filter((t) => (t?.id ?? null) !== normalized.id) : []));
            setCompletedTasks((prev) => {
              const base = Array.isArray(prev) ? prev : [];
              const filtered = base.filter((t) => (t?.id ?? null) !== normalized.id);
              return [normalized, ...filtered];
            });
          } else {
            setActiveTasks((prev) => {
              const base = Array.isArray(prev) ? prev : [];
              const filtered = base.filter((t) => (t?.id ?? null) !== normalized.id);
              return [normalized, ...filtered];
            });
            setCompletedTasks((prev) => (Array.isArray(prev) ? prev.filter((t) => (t?.id ?? null) !== normalized.id) : []));
          }
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
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, markRealtimeSelfWrite, requestSupabaseSync, setSupabaseError, updateScheduleForUser, userId]);

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
          markRealtimeSelfWrite('schedules', updated.id);
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
          markRealtimeSelfWrite('schedules', created?.id ?? null);

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
  }, [beginSupabaseJob, commitSchedules, endSupabaseJob, markRealtimeSelfWrite, requestSupabaseSync, setShowForm, setSupabaseError, userId]);

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
                noteTitlesByDate={calendarNoteTitlesByDate}
                dailyQuestCrowns={calendarDailyQuestCrownsByDate}
                dailyQuestTaskTitlesByDate={calendarDailyQuestTaskTitlesByDate}
                onVisibleRangeChange={handleCalendarVisibleRangeChange}
                onSearchClick={openScheduleSearch}
                onAiConciergeClick={openAiConcierge}
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
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <Timeline 
                        schedules={filteredSchedules} 
                        selectedDate={selectedDate} 
                        selectedDateStr={selectedDateStr}
                        onEdit={handleEdit}
                        onAdd={handleAdd}
                        onAddTask={handleAddTask}
                        onAddNote={handleAddNote}
                        quickMemo={quickMemo}
                        onQuickMemoChange={handleQuickMemoChange}
                        onQuickMemoImmediatePersist={handleQuickMemoImmediatePersist}
                        onUpdateNote={handleUpdateNote}
                        onDeleteNote={handleDeleteNote}
                        onToggleArchiveNote={handleToggleArchiveNote}
                        onToggleImportantNote={handleToggleImportantNote}
                        onCommitDraftNote={handleCommitDraftNote}
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
                        onLoadMoreCompletedTasks={handleLoadMoreCompletedTasks}
                        completedTasksHasMore={completedTasksHasMore}
                        completedTasksLoading={completedTasksLoading}
                        onLoadMoreArchivedNotes={handleLoadMoreArchivedNotes}
                        archivedNotesHasMore={archivedNotesHasMore}
                        archivedNotesLoading={archivedNotesLoading}
                        onTabNote={handleTabNote}
                        canShareLoopTimeline={isAuthenticated}
                        loopTimelineState={loopTimelineState}
                        loopTimelineMarkers={loopTimelineMarkers}
                        onLoopTimelineSaveState={handleLoopTimelineSaveState}
                        onLoopTimelineAddMarker={handleLoopTimelineAddMarker}
                        onLoopTimelineUpdateMarker={handleLoopTimelineUpdateMarker}
                        onLoopTimelineDeleteMarker={handleLoopTimelineDeleteMarker}
                        dailyQuestTasks={dailyQuestTasks}
                        onCreateQuestTask={handleCreateQuestTask}
                        onToggleQuestTask={handleToggleQuestTask}
                        onUpdateQuestTask={handleUpdateQuestTask}
                        onDeleteQuestTask={handleDeleteQuestTask}
                        onReorderQuestTasks={handleReorderQuestTasks}
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
            {wideMode !== 'timeline' && (
              <>
                {/* カレンダー部分 */}
                <div 
                  className="flex flex-col h-full overflow-hidden pr-1"
                  style={{ width: wideMode === 'calendar' ? '100%' : `${splitRatio}%` }}
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
                    noteTitlesByDate={calendarNoteTitlesByDate}
                    dailyQuestCrowns={calendarDailyQuestCrownsByDate}
                    dailyQuestTaskTitlesByDate={calendarDailyQuestTaskTitlesByDate}
                    onVisibleRangeChange={handleCalendarVisibleRangeChange}
                    onToggleWideMode={toggleWideMode}
                    onSearchClick={openScheduleSearch}
                    onAiConciergeClick={openAiConcierge}
                  />
                </div>
                
                {/* 分割バー */}
                {wideMode === 'none' && (
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
                )}
              </>
            )}
            
            {/* タイムライン部分 */}
            {wideMode !== 'calendar' && (
              <div 
                className={`flex min-h-0 flex-col gap-1 overflow-hidden ${wideMode === 'timeline' ? '' : 'pl-1'}`}
                style={{ width: wideMode === 'timeline' ? '100%' : `${100 - splitRatio}%` }}
                ref={timelineRef}
              >
                <CurrentDateTimeBar />
                <div className="flex-1 min-h-0 overflow-hidden">
                  <Timeline 
                    schedules={filteredSchedules} 
                    selectedDate={selectedDate} 
                    selectedDateStr={selectedDateStr}
                    onEdit={handleEdit}
                    onAdd={handleAdd}
                    onAddTask={handleAddTask}
                    onAddNote={handleAddNote}
                    quickMemo={quickMemo}
                    onQuickMemoChange={handleQuickMemoChange}
                    onQuickMemoImmediatePersist={handleQuickMemoImmediatePersist}
                    onUpdateNote={handleUpdateNote}
                    onDeleteNote={handleDeleteNote}
                    onToggleArchiveNote={handleToggleArchiveNote}
                    onToggleImportantNote={handleToggleImportantNote}
                    onCommitDraftNote={handleCommitDraftNote}
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
                    onLoadMoreCompletedTasks={handleLoadMoreCompletedTasks}
                    completedTasksHasMore={completedTasksHasMore}
                    completedTasksLoading={completedTasksLoading}
                    onLoadMoreArchivedNotes={handleLoadMoreArchivedNotes}
                    archivedNotesHasMore={archivedNotesHasMore}
                    archivedNotesLoading={archivedNotesLoading}
                    onTabNote={handleTabNote}
                    canShareLoopTimeline={isAuthenticated}
                    loopTimelineState={loopTimelineState}
                    loopTimelineMarkers={loopTimelineMarkers}
                    onLoopTimelineSaveState={handleLoopTimelineSaveState}
                    onLoopTimelineAddMarker={handleLoopTimelineAddMarker}
                    onLoopTimelineUpdateMarker={handleLoopTimelineUpdateMarker}
                    onLoopTimelineDeleteMarker={handleLoopTimelineDeleteMarker}
                    dailyQuestTasks={dailyQuestTasks}
                    onCreateQuestTask={handleCreateQuestTask}
                    onToggleQuestTask={handleToggleQuestTask}
                    onUpdateQuestTask={handleUpdateQuestTask}
                    onDeleteQuestTask={handleDeleteQuestTask}
                    onReorderQuestTasks={handleReorderQuestTasks}
                    onToggleWideMode={() => toggleWideMode('timeline')}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {tabbedNotes.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-[65] flex items-end justify-start gap-px px-3">
          {tabbedNotes.map((note) => {
            const noteId = note?.id ?? null;
            if (noteId == null) return null;
            const rawTitle = typeof note?.title === 'string' ? note.title : '';
            const title = rawTitle.trim() || '無題のノート';
            const tabTitle = title.length > 6 ? `${title.slice(0, 6)}…` : title;
            return (
              <button
                key={String(noteId)}
                type="button"
                onClick={() => handleRestoreTabbedNote(noteId)}
                className="inline-flex max-w-[160px] items-center gap-2 rounded-t-lg rounded-b-none border border-b-0 border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                title={title}
                aria-label={`タブ: ${title}`}
              >
                <span className="truncate">{tabTitle}</span>
              </button>
            );
          })}
        </div>
      )}

      <ScheduleSearchModal
        isOpen={showScheduleSearch}
        keyword={scheduleSearchKeyword}
        onKeywordChange={handleScheduleSearchKeywordChange}
        results={scheduleSearchResults}
        loading={scheduleSearchLoading}
        onClose={closeScheduleSearch}
        onSelect={handleSelectScheduleSearchResult}
      />

      <AiConciergeModal
        isOpen={showAiConcierge}
        onClose={closeAiConcierge}
        selectedDate={selectedDate}
        selectedDateStr={selectedDateStr}
        schedules={schedules}
        onNavigateToDate={setSelectedDate}
        onSearchSchedules={searchSchedulesForAi}
        onSaveSchedule={handleSave}
        onDeleteSchedule={handleScheduleDelete}
      />

      <CornerFloatingMenu
        enabled={isMobile && !showSettings && !showForm}
        items={[
          {
            key: 'undo',
            label: '戻す',
            disabled: !canUndo,
            onClick: () => {
              if (canUndo) undo();
            },
            icon: (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-7 w-7"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 14l-4-4 4-4" />
                <path d="M20 20a8 8 0 0 0-8-8H5" />
              </svg>
            ),
          },
          {
            key: 'redo',
            label: '進む',
            disabled: !canRedo,
            onClick: () => {
              if (canRedo) redo();
            },
            icon: (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-7 w-7"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 14l4-4-4-4" />
                <path d="M4 20a8 8 0 0 1 8-8h7" />
              </svg>
            ),
          },
        ]}
      />
      
      {showForm && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              handleClose();
            }
          }}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[calc(100svh-2rem)] flex flex-col overflow-hidden overflow-x-hidden">
            <ScheduleForm 
              schedule={editingSchedule} 
              onSave={handleSave} 
              onClose={handleClose} 
              onDelete={editingSchedule?.id ? handleDelete : undefined}
              onAfterCopy={isMobile ? closeTimeline : undefined}
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
