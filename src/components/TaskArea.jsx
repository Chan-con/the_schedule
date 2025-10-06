import React, { useMemo, useState, useCallback } from 'react';
import MemoWithLinks from './MemoWithLinks';

const formatTaskDate = (task) => {
  if (!task?.date) {
    if (task?.time) {
      return `時間: ${task.time}`;
    }
    return null;
  }

  const parts = (task.date || '').split('-').map(Number);
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

  if (task?.isStandaloneTask) {
    return `納期: ${dateLabel}`;
  }

  if (task.allDay || !task.time) {
    return dateLabel;
  }

  return `${dateLabel} ${task.time}`;
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

const TaskArea = ({ tasks = [], onEdit, onToggleTask, onReorderTasks }) => {
  const taskList = useMemo(() => (Array.isArray(tasks) ? tasks : []), [tasks]);

  const { incompleteTasks, completedTasks } = useMemo(() => {
    const incomplete = [];
    const completed = [];
    taskList.forEach((task) => {
      if (task?.completed) {
        completed.push(task);
      } else {
        incomplete.push(task);
      }
    });
    return { incompleteTasks: incomplete, completedTasks: completed };
  }, [taskList]);

  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const resetDragState = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const finalizeReorder = useCallback((destinationIndex) => {
    if (draggedIndex == null || destinationIndex == null) {
      resetDragState();
      return;
    }

    if (typeof onReorderTasks !== 'function') {
      resetDragState();
      return;
    }

    const sourceIndex = draggedIndex;
    if (destinationIndex === sourceIndex) {
      resetDragState();
      return;
    }

    const reorderedIncomplete = [...incompleteTasks];
    const [movedTask] = reorderedIncomplete.splice(sourceIndex, 1);

    let insertIndex = destinationIndex;
    if (destinationIndex > sourceIndex) {
      insertIndex -= 1;
    }

    insertIndex = Math.max(0, Math.min(insertIndex, reorderedIncomplete.length));
    reorderedIncomplete.splice(insertIndex, 0, movedTask);

    const nextOrder = [...reorderedIncomplete, ...completedTasks];
    const originalOrder = [...incompleteTasks, ...completedTasks];
    const isSameOrder = nextOrder.length === originalOrder.length && nextOrder.every((task, index) => task === originalOrder[index]);

    if (!isSameOrder) {
      onReorderTasks(nextOrder);
    }

    resetDragState();
  }, [completedTasks, draggedIndex, incompleteTasks, onReorderTasks, resetDragState]);

  const handleDragStart = useCallback((event, index) => {
    if (typeof onReorderTasks !== 'function') {
      event.preventDefault();
      return;
    }

    const target = incompleteTasks[index];
    if (!target) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', getTaskKey(target));
    setDraggedIndex(index);
    setDragOverIndex(index);
  }, [incompleteTasks, onReorderTasks]);

  const handleDragOver = useCallback((event, index) => {
    if (draggedIndex == null) return;
    event.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  }, [dragOverIndex, draggedIndex]);

  const handleDrop = useCallback((event, index) => {
    event.preventDefault();
    event.stopPropagation();
    finalizeReorder(index);
  }, [finalizeReorder]);

  const handleDragEnd = useCallback(() => {
    resetDragState();
  }, [resetDragState]);

  if (taskList.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2h-2.5l-.72-1.447A1 1 0 0014.854 3h-5.708a1 1 0 00-.926.553L7.5 5H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <p className="text-sm">登録されたタスクはありません</p>
        <p className="text-xs text-gray-300">右上の「＋」からタスクを追加できます</p>
      </div>
    );
  }

  const renderTaskCard = (task, { index = null, draggable = false } = {}) => {
    const isCompleted = !!task?.completed;
    const isStandaloneTask = !!task?.isStandaloneTask;
    const formattedDate = formatTaskDate(task);
    const key = getTaskKey(task);

    const highlightActive = draggable && draggedIndex === index;
    const highlightDrop = draggable && dragOverIndex === index && draggedIndex !== null;

    return (
      <div
        key={key}
        className={`border border-gray-200 rounded-lg p-2.5 bg-white shadow-sm transition hover:shadow-md cursor-pointer ${
          isCompleted ? 'opacity-70' : ''
        } ${highlightActive ? 'opacity-60' : ''} ${highlightDrop ? 'ring-2 ring-indigo-200' : ''}`}
        draggable={draggable}
        onDragStart={draggable ? (event) => handleDragStart(event, index) : undefined}
        onDragOver={draggable ? (event) => handleDragOver(event, index) : undefined}
        onDrop={draggable ? (event) => handleDrop(event, index) : undefined}
        onDragLeave={draggable ? () => setDragOverIndex(null) : undefined}
        onDragEnd={draggable ? handleDragEnd : undefined}
        onClick={() => {
          if (onEdit) {
            onEdit(task);
          }
        }}
        onDoubleClick={() => {
          if (onEdit) {
            onEdit(task);
          }
        }}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-medium ${isCompleted ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                {task?.emoji ? `${task.emoji} ` : ''}
                {task?.name || '名称未設定のタスク'}
              </span>
              {!isStandaloneTask && task?.allDay && (
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

  const dropEnabled = typeof onReorderTasks === 'function';

  const handleContainerDragOver = useCallback((event) => {
    if (!dropEnabled || draggedIndex == null) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    setDragOverIndex(incompleteTasks.length);
  }, [dropEnabled, draggedIndex, incompleteTasks.length]);

  const handleContainerDrop = useCallback((event) => {
    if (!dropEnabled || draggedIndex == null) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    finalizeReorder(incompleteTasks.length);
  }, [dropEnabled, draggedIndex, finalizeReorder, incompleteTasks.length]);

  return (
    <div className="flex-1 custom-scrollbar overflow-auto pr-2 pt-2 pb-3">
      <div
        className="flex flex-col gap-2"
        onDragOver={handleContainerDragOver}
        onDrop={handleContainerDrop}
      >
        {incompleteTasks.map((task, index) => (
          <React.Fragment key={getTaskKey(task)}>
            {renderTaskCard(task, { index, draggable: dropEnabled })}
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
      </div>
    </div>
  );
};

export default TaskArea;
