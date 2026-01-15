import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fromDateStrLocal, toDateStrLocal } from "./utils/date";
import { createTempId } from "./utils/id";

import Calendar from "./components/Calendar";
import Timeline from "./components/Timeline";
import ScheduleForm from "./components/ScheduleForm";
import TitleBar from "./components/TitleBar";
import SettingsModal from "./components/SettingsModal";
import ScheduleSearchModal from "./components/ScheduleSearchModal";
import AiConciergeModal from "./components/AiConciergeModal";
import CornerFloatingMenu from "./components/CornerFloatingMenu";

import { useAuth } from "./context/useAuth";
import {
  createScheduleForUser,
  deleteScheduleForUser,
  fetchActiveSchedulesForUser,
  fetchActiveTasksForUser,
  fetchCompletedTasksPageForUser,
  fetchSchedulesForUser,
  fetchSchedulesForUserInRange,
  searchSchedulesForUser,
  updateScheduleForUser,
  upsertSchedulesForUser,
} from "./utils/supabaseSchedules";

const LOCAL_STORAGE_SCHEDULES_KEY = "schedules";
const LAYOUT_SPLIT_RATIO_STORAGE_KEY = "layoutSplitRatioV1";
const COMPLETED_TASK_PAGE_SIZE = 5;

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeSchedule = (schedule) => ({
  ...schedule,
  isTask: schedule?.isTask ?? false,
  completed: schedule?.completed ?? false,
});

const normalizeSchedules = (schedules) => {
  if (!Array.isArray(schedules)) return [];
  return schedules.map(normalizeSchedule);
};

export default function App() {
  const auth = useAuth();
  const userId = auth?.user?.id || null;

  const titleBarAuth = useMemo(
    () => ({
      user: auth?.user ?? null,
      isLoading: auth?.isLoading ?? false,
      isProcessing: auth?.isProcessing ?? false,
      onLogin: auth?.signInWithGoogle,
      onLogout: auth?.signOut,
    }),
    [auth]
  );

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const selectedDateStr = useMemo(
    () => (selectedDate ? toDateStrLocal(selectedDate) : ""),
    [selectedDate]
  );

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => {
      if (typeof window === "undefined") return;
      setIsMobile(window.innerWidth < 768);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const [wideMode, setWideMode] = useState("none");
  const [timelineActiveTab, setTimelineActiveTab] = useState("timeline");

  const DEFAULT_SPLIT_RATIO = 0.72;
  const [splitRatio, setSplitRatio] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SPLIT_RATIO;
    try {
      const stored = window.localStorage.getItem(LAYOUT_SPLIT_RATIO_STORAGE_KEY);
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        return clampNumber(parsed, 0.25, 0.85);
      }
    } catch {
      // ignore
    }
    return DEFAULT_SPLIT_RATIO;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LAYOUT_SPLIT_RATIO_STORAGE_KEY, String(splitRatio));
    } catch {
      // ignore
    }
  }, [splitRatio]);

  const splitContainerRef = useRef(null);
  const splitDragRef = useRef({
    active: false,
    startX: 0,
    startRatio: DEFAULT_SPLIT_RATIO,
    containerWidth: 0,
  });

  const [calendarVisibleRange, setCalendarVisibleRange] = useState(null);

  const [schedules, setSchedules] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(LOCAL_STORAGE_SCHEDULES_KEY);
      if (!stored) return [];
      return normalizeSchedules(JSON.parse(stored));
    } catch {
      return [];
    }
  });

  const schedulesRef = useRef(schedules);
  useEffect(() => {
    schedulesRef.current = schedules;
  }, [schedules]);

  const [activeTasks, setActiveTasks] = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [completedTasksCursor, setCompletedTasksCursor] = useState(null);
  const [completedTasksHasMore, setCompletedTasksHasMore] = useState(false);
  const [completedTasksLoading, setCompletedTasksLoading] = useState(false);

  const [editingSchedule, setEditingSchedule] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [showScheduleSearch, setShowScheduleSearch] = useState(false);
  const [scheduleSearchKeyword, setScheduleSearchKeyword] = useState("");
  const [scheduleSearchResults, setScheduleSearchResults] = useState([]);
  const [scheduleSearchLoading, setScheduleSearchLoading] = useState(false);
  const scheduleSearchTimerRef = useRef(null);

  const [showAiConcierge, setShowAiConcierge] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (userId) return;
    try {
      window.localStorage.setItem(
        LOCAL_STORAGE_SCHEDULES_KEY,
        JSON.stringify(normalizeSchedules(schedules))
      );
    } catch {
      // ignore
    }
  }, [schedules, userId]);

  const refreshFromSupabase = useCallback(
    async (reason = "manual") => {
      if (!userId) return;

      const startDate = calendarVisibleRange?.startDate;
      const endDate = calendarVisibleRange?.endDate;
      const hasRange = !!(startDate && endDate);

      const [remoteSchedules, remoteActiveTasks, remoteCompletedPage] =
        await Promise.all([
          hasRange
            ? fetchSchedulesForUserInRange({ userId, startDate, endDate }).catch(
                () =>
                  fetchActiveSchedulesForUser(userId).catch(() =>
                    fetchSchedulesForUser(userId)
                  )
              )
            : fetchActiveSchedulesForUser(userId).catch(() =>
                fetchSchedulesForUser(userId)
              ),
          fetchActiveTasksForUser(userId).catch(() => []),
          fetchCompletedTasksPageForUser({
            userId,
            limit: COMPLETED_TASK_PAGE_SIZE,
          }).catch(() => ({ items: [], hasMore: false, nextCursor: null })),
        ]);

      setSchedules(normalizeSchedules(remoteSchedules));
      setActiveTasks(Array.isArray(remoteActiveTasks) ? remoteActiveTasks : []);
      setCompletedTasks(
        Array.isArray(remoteCompletedPage?.items) ? remoteCompletedPage.items : []
      );
      setCompletedTasksHasMore(!!remoteCompletedPage?.hasMore);
      setCompletedTasksCursor(remoteCompletedPage?.nextCursor || null);
      setCompletedTasksLoading(false);

      console.info("[SupabaseSync]", reason);
    },
    [calendarVisibleRange?.endDate, calendarVisibleRange?.startDate, userId]
  );

  useEffect(() => {
    if (!userId) {
      setActiveTasks([]);
      setCompletedTasks([]);
      setCompletedTasksCursor(null);
      setCompletedTasksHasMore(false);
      return;
    }

    if (auth?.isLoading) return;

    refreshFromSupabase("auth_change").catch((error) => {
      console.error("[SupabaseSync] Failed:", error);
    });
  }, [auth?.isLoading, refreshFromSupabase, userId]);

  const daySchedules = useMemo(() => {
    const dateStr = selectedDateStr;
    return (Array.isArray(schedules) ? schedules : []).filter(
      (s) => String(s?.date ?? "") === String(dateStr)
    );
  }, [schedules, selectedDateStr]);

  const taskSchedules = useMemo(() => {
    const active = Array.isArray(activeTasks) ? activeTasks : [];
    const done = Array.isArray(completedTasks) ? completedTasks : [];
    return [...active, ...done];
  }, [activeTasks, completedTasks]);

  const openScheduleForm = useCallback((schedule) => {
    setEditingSchedule(schedule || null);
    setShowForm(true);
  }, []);

  const closeScheduleForm = useCallback(() => {
    setShowForm(false);
    setEditingSchedule(null);
  }, []);

  const handleAdd = useCallback(() => {
    openScheduleForm({
      id: null,
      date: selectedDateStr || toDateStrLocal(new Date()),
      time: "",
      name: "",
      memo: "",
      allDay: true,
      isTask: false,
      completed: false,
    });
  }, [openScheduleForm, selectedDateStr]);

  const handleAddTask = useCallback(() => {
    openScheduleForm({
      id: null,
      date: selectedDateStr || toDateStrLocal(new Date()),
      time: "",
      name: "",
      memo: "",
      allDay: true,
      isTask: true,
      completed: false,
      source: "scheduleTask",
    });
  }, [openScheduleForm, selectedDateStr]);

  const handleEdit = useCallback(
    (schedule) => {
      if (!schedule) return;
      openScheduleForm(schedule);
    },
    [openScheduleForm]
  );

  const mergeScheduleUpdates = useCallback((updates) => {
    const list = Array.isArray(updates) ? updates : [updates];
    const updateMap = new Map(
      list.filter(Boolean).map((s) => [String(s.id), normalizeSchedule(s)])
    );

    setSchedules((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      return base.map((s) => {
        const key = String(s?.id ?? "");
        return updateMap.has(key) ? updateMap.get(key) : s;
      });
    });
  }, []);

  const handleSaveSchedule = useCallback(
    async (schedule) => {
      const payload = normalizeSchedule(schedule);

      if (!userId) {
        const id = payload?.id ?? createTempId();
        const next = { ...payload, id };
        setSchedules((prev) => {
          const base = Array.isArray(prev) ? prev : [];
          const exists = base.some((s) => String(s?.id ?? "") === String(id));
          return exists
            ? base.map((s) => (String(s?.id ?? "") === String(id) ? next : s))
            : [next, ...base];
        });
        closeScheduleForm();
        return;
      }

      const saved = payload?.id
        ? await updateScheduleForUser(payload, userId)
        : await createScheduleForUser(payload, userId);

      setSchedules((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const exists = base.some(
          (s) => String(s?.id ?? "") === String(saved?.id ?? "")
        );
        const normalizedSaved = normalizeSchedule(saved);
        return exists
          ? base.map((s) =>
              String(s?.id ?? "") === String(saved?.id ?? "")
                ? normalizedSaved
                : s
            )
          : [normalizedSaved, ...base];
      });

      closeScheduleForm();
    },
    [closeScheduleForm, userId]
  );

  const handleDeleteSchedule = useCallback(
    async (scheduleId) => {
      if (!scheduleId) return;

      if (!userId) {
        setSchedules((prev) =>
          Array.isArray(prev)
            ? prev.filter((s) => String(s?.id ?? "") !== String(scheduleId))
            : []
        );
        closeScheduleForm();
        return;
      }

      await deleteScheduleForUser(scheduleId, userId);
      setSchedules((prev) =>
        Array.isArray(prev)
          ? prev.filter((s) => String(s?.id ?? "") !== String(scheduleId))
          : []
      );
      closeScheduleForm();
    },
    [closeScheduleForm, userId]
  );

  const handleScheduleUpdate = useCallback(
    async (updated, actionType = "update") => {
      const list = Array.isArray(updated) ? updated : [updated];
      const normalized = normalizeSchedules(list);
      if (normalized.length === 0) return;

      mergeScheduleUpdates(normalized);

      if (!userId) return;

      try {
        await upsertSchedulesForUser(normalized, userId);
      } catch (error) {
        console.error("[Supabase] Failed to upsert schedules:", actionType, error);
        refreshFromSupabase(`upsert_failed:${actionType}`).catch(() => {});
      }
    },
    [mergeScheduleUpdates, refreshFromSupabase, userId]
  );

  const handleToggleTask = useCallback(
    (schedule, nextCompleted) => {
      if (!schedule?.id) return;
      const patched = { ...schedule, completed: !!nextCompleted };
      handleScheduleUpdate(patched, "toggle_task");
    },
    [handleScheduleUpdate]
  );

  const handleScheduleCopy = useCallback(
    (schedule) => {
      if (!schedule) return;
      handleSaveSchedule({ ...schedule, id: null });
    },
    [handleSaveSchedule]
  );

  const handleScheduleMove = useCallback(
    (schedule) => {
      if (!schedule) return;
      handleScheduleUpdate(schedule, "move");
    },
    [handleScheduleUpdate]
  );

  const handleCalendarVisibleRangeChange = useCallback(
    (range) => {
      setCalendarVisibleRange(range);
      if (userId) {
        refreshFromSupabase("visible_range_change").catch(() => {});
      }
    },
    [refreshFromSupabase, userId]
  );

  const openScheduleSearch = useCallback(() => setShowScheduleSearch(true), []);
  const closeScheduleSearch = useCallback(
    () => setShowScheduleSearch(false),
    []
  );

  const openAiConcierge = useCallback(() => setShowAiConcierge(true), []);
  const closeAiConcierge = useCallback(() => setShowAiConcierge(false), []);

  const runScheduleSearch = useCallback(
    async (keyword) => {
      const q = typeof keyword === "string" ? keyword.trim() : "";
      if (!q) {
        setScheduleSearchResults([]);
        return;
      }

      setScheduleSearchLoading(true);
      try {
        if (userId) {
          const items = await searchSchedulesForUser({
            userId,
            keyword: q,
            limit: 50,
          });
          setScheduleSearchResults(Array.isArray(items) ? items : []);
        } else {
          const list = Array.isArray(schedulesRef.current)
            ? schedulesRef.current
            : [];
          const needle = q.toLowerCase();
          const filtered = list.filter((s) => {
            const name = String(s?.name ?? "").toLowerCase();
            const memo = String(s?.memo ?? "").toLowerCase();
            return name.includes(needle) || memo.includes(needle);
          });
          setScheduleSearchResults(filtered.slice(0, 50));
        }
      } catch (error) {
        console.error("[Search] Failed to search schedules:", error);
        setScheduleSearchResults([]);
      } finally {
        setScheduleSearchLoading(false);
      }
    },
    [userId]
  );

  const handleScheduleSearchKeywordChange = useCallback(
    (next) => {
      const value = typeof next === "string" ? next : "";
      setScheduleSearchKeyword(value);

      if (scheduleSearchTimerRef.current) {
        clearTimeout(scheduleSearchTimerRef.current);
        scheduleSearchTimerRef.current = null;
      }

      scheduleSearchTimerRef.current = setTimeout(() => {
        scheduleSearchTimerRef.current = null;
        runScheduleSearch(value).catch(() => {});
      }, 250);
    },
    [runScheduleSearch]
  );

  const handleSelectScheduleSearchResult = useCallback(
    (item) => {
      const dateStr = typeof item?.date === "string" ? item.date : "";
      if (!dateStr) return;
      const d = fromDateStrLocal(dateStr);
      if (d) {
        setSelectedDate(d);
      }
      closeScheduleSearch();
    },
    [closeScheduleSearch]
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
        const existing = new Set(base.map((t) => String(t?.id ?? "")));
        const appended = items.filter((t) => {
          const id = String(t?.id ?? "");
          if (!id) return true;
          if (existing.has(id)) return false;
          existing.add(id);
          return true;
        });
        return [...base, ...appended];
      });
      setCompletedTasksHasMore(!!page?.hasMore);
      setCompletedTasksCursor(page?.nextCursor || null);
    } catch (error) {
      console.error("[Supabase] Failed to load completed tasks:", error);
    } finally {
      setCompletedTasksLoading(false);
    }
  }, [
    completedTasksCursor,
    completedTasksHasMore,
    completedTasksLoading,
    userId,
  ]);

  const handleToggleWideMode = useCallback((nextMode) => {
    const value = typeof nextMode === "string" ? nextMode : "none";
    setWideMode(value);
  }, []);

  const showCalendar = wideMode !== "timeline";
  const showTimeline = wideMode !== "calendar";

  const showSplitHandle = !isMobile && showCalendar && showTimeline;
  const splitGridStyle = showSplitHandle
    ? {
        gridTemplateColumns: `${splitRatio}fr auto ${(1 - splitRatio)}fr`,
      }
    : undefined;

  const startSplitDrag = useCallback(
    (event) => {
      if (!splitContainerRef.current) return;
      // Mouse: left button only
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const container = splitContainerRef.current;
      const rect = container.getBoundingClientRect();
      if (!rect?.width) return;

      event.preventDefault();

      const startX = event.clientX;

      const containerStyle = window.getComputedStyle(container);
      const gapRaw = containerStyle.columnGap || containerStyle.gap || "0";
      const gapPx = Number.parseFloat(gapRaw) || 0;
      const handleWidth = event.currentTarget?.getBoundingClientRect?.().width || 0;
      const reservedWidth = showSplitHandle ? handleWidth + gapPx * 2 : 0;
      const availableWidth = rect.width - reservedWidth;

      splitDragRef.current = {
        active: true,
        startX,
        startRatio: splitRatio,
        containerWidth: availableWidth > 0 ? availableWidth : rect.width,
      };

      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent) => {
        if (!splitDragRef.current.active) return;
        const dx = moveEvent.clientX - splitDragRef.current.startX;
        const width = splitDragRef.current.containerWidth;
        if (!width) return;
        const next = splitDragRef.current.startRatio + dx / width;
        setSplitRatio(clampNumber(next, 0.25, 0.85));
      };

      const onUp = () => {
        splitDragRef.current.active = false;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [splitRatio, showSplitHandle]
  );

  const cornerMenuItems = useMemo(
    () => [
      {
        key: "add",
        label: "追加",
        disabled: false,
        icon: <span className="text-lg font-semibold">＋</span>,
        onClick: handleAdd,
      },
      {
        key: "search",
        label: "検索",
        disabled: false,
        icon: <span className="text-sm font-semibold">🔎</span>,
        onClick: openScheduleSearch,
      },
    ],
    [handleAdd, openScheduleSearch]
  );

  return (
    <div className="h-dvh w-full bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <TitleBar
        onSettingsClick={() => setShowSettings(true)}
        auth={titleBarAuth}
      />

      <div className="mx-auto flex h-[calc(100dvh-2rem)] max-w-[1400px] flex-col gap-2 p-2">
        <div
          ref={splitContainerRef}
          className={`flex min-h-0 flex-1 flex-col gap-2 ${
            showSplitHandle ? "md:grid md:items-stretch" : "md:flex-row"
          }`}
          style={splitGridStyle}
        >
          {showCalendar && (
            <div
              className={`min-h-0 rounded-xl border border-indigo-100 bg-white/70 shadow-sm backdrop-blur ${
                showSplitHandle ? "" : "flex-1"
              }`}
            >
              <Calendar
                schedules={schedules}
                selectedDate={selectedDate}
                isMobile={isMobile}
                onDateClick={(date) => setSelectedDate(date)}
                onScheduleClick={(schedule) => handleEdit(schedule)}
                onScheduleCopy={handleScheduleCopy}
                onScheduleMove={handleScheduleMove}
                onScheduleDelete={(scheduleId) => handleDeleteSchedule(scheduleId)}
                onAdd={handleAdd}
                onEdit={handleEdit}
                onToggleTask={handleToggleTask}
                onScheduleUpdate={handleScheduleUpdate}
                onVisibleRangeChange={handleCalendarVisibleRangeChange}
                onToggleWideMode={handleToggleWideMode}
                onSearchClick={openScheduleSearch}
                onAiConciergeClick={openAiConcierge}
              />
            </div>
          )}

          {showSplitHandle && (
            <div
              className="hidden md:flex w-4 flex-none items-stretch justify-center cursor-col-resize select-none outline-none"
              role="separator"
              aria-orientation="vertical"
              aria-label="表示比率を調整"
              tabIndex={0}
              onPointerDown={startSplitDrag}
              onDoubleClick={() => setSplitRatio(DEFAULT_SPLIT_RATIO)}
              onKeyDown={(keyEvent) => {
                const step = keyEvent.shiftKey ? 0.05 : 0.02;
                if (keyEvent.key === "ArrowLeft") {
                  keyEvent.preventDefault();
                  setSplitRatio((value) => clampNumber(value - step, 0.25, 0.85));
                }
                if (keyEvent.key === "ArrowRight") {
                  keyEvent.preventDefault();
                  setSplitRatio((value) => clampNumber(value + step, 0.25, 0.85));
                }
                if (keyEvent.key === "Home") {
                  keyEvent.preventDefault();
                  setSplitRatio(0.25);
                }
                if (keyEvent.key === "End") {
                  keyEvent.preventDefault();
                  setSplitRatio(0.85);
                }
              }}
            >
              <div
                className="my-3 flex w-3 flex-col items-center justify-center gap-1 rounded-full bg-indigo-100/80 ring-1 ring-indigo-200 transition-colors hover:bg-indigo-100"
                aria-hidden="true"
              >
                <div className="h-1 w-1 rounded-full bg-indigo-400" />
                <div className="h-1 w-1 rounded-full bg-indigo-400" />
                <div className="h-1 w-1 rounded-full bg-indigo-400" />
              </div>
            </div>
          )}

          {showTimeline && (
            <div
              className={`min-h-0 w-full ${
                showSplitHandle ? "" : showCalendar ? "md:w-[420px]" : "flex-1"
              }`}
            >
              <Timeline
                schedules={daySchedules}
                selectedDate={selectedDate}
                onAdd={handleAdd}
                onAddTask={handleAddTask}
                onEdit={handleEdit}
                onClosePanel={() => {}}
                onScheduleUpdate={handleScheduleUpdate}
                onToggleTask={handleToggleTask}
                activeTab={timelineActiveTab}
                onTabChange={setTimelineActiveTab}
                tasks={taskSchedules}
                onLoadMoreCompletedTasks={handleLoadMoreCompletedTasks}
                completedTasksHasMore={completedTasksHasMore}
                completedTasksLoading={completedTasksLoading}
                onToggleWideMode={handleToggleWideMode}
              />
            </div>
          )}
        </div>
      </div>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

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
        taskSchedules={taskSchedules}
        onNavigateToDate={(dateStr) => {
          const d = fromDateStrLocal(dateStr);
          if (d) setSelectedDate(d);
        }}
        onSearchSchedules={async (keyword) => {
          const q = typeof keyword === "string" ? keyword.trim() : "";
          if (!q) return [];

          if (userId) {
            const items = await searchSchedulesForUser({
              userId,
              keyword: q,
              limit: 50,
            });
            return Array.isArray(items) ? items : [];
          }

          const list = Array.isArray(schedulesRef.current)
            ? schedulesRef.current
            : [];
          const needle = q.toLowerCase();
          return list
            .filter((s) => {
              const name = String(s?.name ?? "").toLowerCase();
              const memo = String(s?.memo ?? "").toLowerCase();
              return name.includes(needle) || memo.includes(needle);
            })
            .slice(0, 50);
        }}
        onSaveSchedule={handleSaveSchedule}
        onDeleteSchedule={handleDeleteSchedule}
        onScheduleUpdate={handleScheduleUpdate}
      />

      {showForm && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeScheduleForm();
            }
          }}
        >
          <div className="max-h-[calc(100svh-2rem)] w-full max-w-md overflow-hidden overflow-x-hidden rounded-lg bg-white shadow-xl">
            <ScheduleForm
              schedule={editingSchedule}
              onSave={handleSaveSchedule}
              onClose={closeScheduleForm}
              onDelete={editingSchedule?.id ? handleDeleteSchedule : undefined}
            />
          </div>
        </div>
      )}

      <CornerFloatingMenu enabled={true} items={cornerMenuItems} />
    </div>
  );
}
