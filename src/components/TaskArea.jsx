import React, { useMemo, useEffect, useRef } from 'react';
import MemoWithLinks from './MemoWithLinks';

const isTaskOverdue = (task, now = new Date()) => {
  if (!task || task?.completed) return false;
  if (!task?.date) return false;

  const parts = String(task.date || '')
    .split('-')
    .map((value) => Number(value));
  if (parts.length < 3 || Number.isNaN(parts[0])) {
    return false;
  }

  const [year, month, day] = parts;

  const hasTime = !!task?.time && !task?.allDay;
  if (hasTime) {
    const [hhStr, mmStr] = String(task.time).split(':');
    const hour = Number(hhStr);
    const minute = Number(mmStr);
    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      const due = new Date(year, (month || 1) - 1, day || 1, hour, minute, 0, 0);
      if (!Number.isNaN(due.getTime())) {
        return due.getTime() < now.getTime();
      }
    }
  }

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDate = new Date(year, (month || 1) - 1, day || 1);
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }
  return dueDate.getTime() < todayStart.getTime();
};

const formatTaskDate = (task) => {
  if (!task?.date) {
    if (task?.time) {
      return `時間: ${task.time}`;
    }
    return '日付未設定';
  }

  const parts = String(task.date || '')
    .split('-')
    .map((value) => Number(value));
  if (parts.length < 3 || Number.isNaN(parts[0])) {
    return task.date;
  }

  const [year, month, day] = parts;
  const dateObj = new Date(year, (month || 1) - 1, day || 1);
  if (Number.isNaN(dateObj.getTime())) {
    return task.date;
  }

  const options = { month: 'numeric', day: 'numeric', weekday: 'short' };
  const dateLabel = dateObj.toLocaleDateString('ja-JP', options);

  if (task?.allDay || !task?.time) {
    return dateLabel;
  }

  return `${dateLabel} ${task.time}`;
};

const compareTasksByDate = (a, b) => {
  const aDate = a?.date ?? '';
  const bDate = b?.date ?? '';

  if (!aDate && !bDate) {
    const aName = a?.name ?? '';
    const bName = b?.name ?? '';
    return aName.localeCompare(bName, 'ja');
  }
  if (!aDate) return 1;
  if (!bDate) return -1;
  if (aDate !== bDate) {
    return aDate.localeCompare(bDate);
  }

  const aTime = a?.time ?? '';
  const bTime = b?.time ?? '';

  if (!aTime && !bTime) {
    const aName = a?.name ?? '';
    const bName = b?.name ?? '';
    return aName.localeCompare(bName, 'ja');
  }
  if (!aTime) return 1;
  if (!bTime) return -1;
  return aTime.localeCompare(bTime);
};

const getTaskKey = (task) => {
  if (!task) return 'task-unknown';
  if (task.id != null) {
    return `task-${task.id}`;
  }
  if (task._tempId != null) {
    return `temp-${task._tempId}`;
  }
  return `task-${task?.name ?? 'unknown'}-${task?.date ?? 'no-date'}-${task?.time ?? 'no-time'}`;
};

const TaskArea = ({
  tasks = [],
  onEdit,
  onToggleTask,
  onLoadMoreCompleted,
  completedHasMore = false,
  completedLoading = false,
}) => {
  const taskList = useMemo(() => (Array.isArray(tasks) ? tasks : []), [tasks]);
  const scrollContainerRef = useRef(null);
  const completedSentinelRef = useRef(null);

  const { overdueTasks, incompleteTasks, completedTasks } = useMemo(() => {
    const overdue = [];
    const incomplete = [];
    const completed = [];

    taskList.forEach((task) => {
      if (task?.completed) {
        completed.push(task);
        return;
      }

      if (isTaskOverdue(task)) {
        overdue.push(task);
      } else {
        incomplete.push(task);
      }
    });

    overdue.sort(compareTasksByDate);
    incomplete.sort(compareTasksByDate);

    return { overdueTasks: overdue, incompleteTasks: incomplete, completedTasks: completed };
  }, [taskList]);

  useEffect(() => {
    if (!completedHasMore) return;
    if (completedLoading) return;
    const root = scrollContainerRef.current;
    const target = completedSentinelRef.current;
    if (!root || !target) return;
    if (typeof IntersectionObserver === 'undefined') return;

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (typeof onLoadMoreCompleted === 'function') {
          onLoadMoreCompleted();
        }
      },
      {
        root,
        threshold: 1,
      }
    );

    observer.observe(target);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [completedHasMore, completedLoading, onLoadMoreCompleted]);

  const renderTaskCard = (task) => {
    const isCompleted = !!task?.completed;
    const formattedDate = formatTaskDate(task);
    const key = getTaskKey(task);

    return (
      <div
        key={key}
        className={`border border-gray-200 rounded-lg p-2.5 bg-white shadow-sm transition hover:shadow-md cursor-pointer ${
          isCompleted ? 'opacity-70' : ''
        }`}
        onDoubleClick={() => {
          if (onEdit) {
            onEdit(task);
          }
        }}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`font-medium ${
                  isCompleted
                    ? 'text-gray-500 line-through'
                    : 'text-gray-900'
                }`}
                title={task?.name ? String(task.name) : '名称未設定のタスク'}
              >
                {task?.name || '名称未設定のタスク'}
              </span>
              {task?.allDay && task?.date && (
                <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                  終日
                </span>
              )}
            </div>

            {formattedDate && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2h-2.5l-.72-1.447A1 1 0 0014.854 3h-5.708a1 1 0 00-.926.553L7.5 5H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span>{formattedDate}</span>
              </div>
            )}

            {task?.memo && (
              <MemoWithLinks
                memo={task.memo}
                className="text-gray-500 text-sm pl-2 border-l-2 border-gray-200"
              />
            )}
          </div>

          <button
            type="button"
            className={`inline-flex size-6 flex-shrink-0 items-center justify-center rounded-lg border p-0 text-[11px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
              isCompleted
                ? 'bg-green-500 border-green-600 text-white'
                : 'bg-white border-gray-300 text-transparent hover:border-gray-400'
            }`}
            title={isCompleted ? '完了済み' : '未完了'}
            onClick={(event) => {
              event.stopPropagation();
              if (onToggleTask && task?.id) {
                onToggleTask(task, !isCompleted);
              }
            }}
          >
            ✓
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div ref={scrollContainerRef} className="custom-scrollbar flex-1 overflow-y-auto pl-2 pr-2 pt-2 pb-3">
        {taskList.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-2 text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2h-2.5l-.72-1.447A1 1 0 0014.854 3h-5.708a1 1 0 00-.926.553L7.5 5H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">登録されたタスクはありません</p>
            <p className="text-xs text-gray-300">右上の「＋」からタスクを追加できます</p>
          </div>
        ) : (
          <div className="card-stack">
            {overdueTasks.map((task) => (
              <React.Fragment key={getTaskKey(task)}>
                {renderTaskCard(task)}
              </React.Fragment>
            ))}

            {overdueTasks.length > 0 && incompleteTasks.length > 0 && (
              <div className="mt-1 flex items-center gap-2 text-xs text-red-600">
                <span className="flex-1 h-px bg-red-200" />
                <span className="tracking-wide font-semibold">期日超過</span>
                <span className="flex-1 h-px bg-red-200" />
              </div>
            )}

            {incompleteTasks.map((task) => (
              <React.Fragment key={getTaskKey(task)}>
                {renderTaskCard(task)}
              </React.Fragment>
            ))}

            {completedTasks.length > 0 && (
              <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                <span className="flex-1 h-px bg-gray-200" />
                <span className="tracking-wide">完了済み</span>
                <span className="flex-1 h-px bg-gray-200" />
              </div>
            )}

            {completedTasks.map((task) => renderTaskCard(task))}

            {completedHasMore && <div ref={completedSentinelRef} className="h-6" />}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskArea;
