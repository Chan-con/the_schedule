import React, { useEffect, useMemo, useRef, useState, useCallback, useImperativeHandle } from 'react';
import { toDateStrLocal } from '../utils/date';

const normalizePeriod = (value) => {
  const v = String(value || '').trim();
  if (v === 'daily' || v === 'weekly' || v === 'monthly') return v;
  return 'daily';
};

const getCycleId = (period, nowMs) => {
  const now = new Date(typeof nowMs === 'number' ? nowMs : Date.now());
  const p = normalizePeriod(period);

  if (p === 'daily') {
    return toDateStrLocal(now);
  }

  if (p === 'weekly') {
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    const day = base.getDay(); // 0:Sun ... 6:Sat
    const daysSinceMonday = (day + 6) % 7; // Mon->0, Tue->1, ... Sun->6
    base.setDate(base.getDate() - daysSinceMonday);
    return toDateStrLocal(base);
  }

  // monthly
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  monthStart.setHours(0, 0, 0, 0);
  return toDateStrLocal(monthStart);
};

const IconTrophy = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M8 21h8" />
    <path d="M12 17v4" />
    <path d="M7 4h10v4a5 5 0 0 1-10 0V4z" />
    <path d="M5 4H3v2a4 4 0 0 0 4 4" />
    <path d="M19 4h2v2a4 4 0 0 1-4 4" />
  </svg>
);

const IconCrown = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M3 7l4 6 5-7 5 7 4-6" />
    <path d="M5 21h14" />
    <path d="M7 14h10l-1 7H8l-1-7z" />
  </svg>
);

const QuestArea = React.forwardRef(({
  tasks = [],
  onCreateTask,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
  onReorderTasks,
}, ref) => {
  const [period, setPeriod] = useState('daily');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [modalMode, setModalMode] = useState('edit');
  const [editingTask, setEditingTask] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [titleDirty, setTitleDirty] = useState(false);
  const editTitleRef = useRef(null);

  // 0時跨ぎで cycle が切り替わるように定期更新
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const cycleId = useMemo(() => getCycleId(period, nowMs), [nowMs, period]);

  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverTaskId, setDragOverTaskId] = useState(null);

  const safeTasks = useMemo(() => (Array.isArray(tasks) ? tasks : []), [tasks]);

  const periodTasks = useMemo(() => {
    const p = normalizePeriod(period);
    return safeTasks
      .filter((t) => normalizePeriod(t?.period) === p)
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
        const aCreated = String(a?.created_at ?? '');
        const bCreated = String(b?.created_at ?? '');
        const diff = aCreated.localeCompare(bCreated);
        if (diff !== 0) return diff;
        return Number(a?.id ?? 0) - Number(b?.id ?? 0);
      });
  }, [period, safeTasks]);

  const { incomplete, completed } = useMemo(() => {
    const inc = [];
    const comp = [];
    for (const t of periodTasks) {
      const done = String(t?.completed_cycle_id ?? '') === String(cycleId ?? '');
      if (done) comp.push(t);
      else inc.push(t);
    }
    return { incomplete: inc, completed: comp };
  }, [cycleId, periodTasks]);

  const allCleared = periodTasks.length > 0 && incomplete.length === 0;

  const isTaskCompletedInCycle = useCallback((t) => {
    return String(t?.completed_cycle_id ?? '') === String(cycleId ?? '');
  }, [cycleId]);

  const applyReorder = useCallback((dragId, overId, dropToEnd = false) => {
    const dragKey = dragId ?? null;
    if (dragKey == null) return;

    const draggedTask = periodTasks.find((t) => (t?.id ?? null) === dragKey) || null;
    if (!draggedTask) return;

    const draggedCompleted = isTaskCompletedInCycle(draggedTask);
    const sectionList = draggedCompleted ? completed : incomplete;
    const sectionIds = sectionList.map((t) => t?.id).filter((id) => id != null);
    const fromIndex = sectionIds.findIndex((id) => id === dragKey);
    if (fromIndex === -1) return;

    let toIndex = sectionIds.length - 1;
    if (!dropToEnd && overId != null) {
      const overTask = periodTasks.find((t) => (t?.id ?? null) === overId) || null;
      if (overTask && isTaskCompletedInCycle(overTask) === draggedCompleted) {
        const idx = sectionIds.findIndex((id) => id === overId);
        if (idx !== -1) {
          toIndex = idx;
        }
      }
    }

    if (toIndex === fromIndex) return;

    const nextSectionIds = sectionIds.slice();
    nextSectionIds.splice(fromIndex, 1);
    nextSectionIds.splice(Math.min(toIndex, nextSectionIds.length), 0, dragKey);

    const incompleteIds = draggedCompleted ? incomplete.map((t) => t?.id).filter((id) => id != null) : nextSectionIds;
    const completedIds = draggedCompleted ? nextSectionIds : completed.map((t) => t?.id).filter((id) => id != null);

    const nextOrderIds = [...incompleteIds, ...completedIds];
    if (typeof onReorderTasks === 'function') {
      onReorderTasks(period, nextOrderIds);
    }
  }, [completed, incomplete, isTaskCompletedInCycle, onReorderTasks, period, periodTasks]);

  const openCreateModal = useCallback(() => {
    setModalMode('create');
    setEditingTask(null);
    setDraftTitle('');
    setTitleDirty(false);
    setIsEditOpen(true);
  }, []);

  const openEditModal = useCallback((task) => {
    if (!task) return;
    setModalMode('edit');
    setEditingTask(task);
    setDraftTitle(String(task?.title ?? ''));
    setTitleDirty(false);
    setIsEditOpen(true);
  }, []);

  useImperativeHandle(ref, () => ({
    openCreate: openCreateModal,
  }), [openCreateModal]);

  const closeEditModal = useCallback(() => {
    if (titleDirty) {
      const ok = window.confirm('変更は保存されていません。閉じますか？');
      if (!ok) return;
    }
    setIsEditOpen(false);
    setEditingTask(null);
    setDraftTitle('');
    setTitleDirty(false);
  }, [titleDirty]);

  useEffect(() => {
    if (!isEditOpen) return;

    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeEditModal();
      }
    };

    const preventAllScroll = (e) => {
      const isInModal = e.target.closest('.quest-modal-content');
      if (!isInModal) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEsc);
    document.addEventListener('wheel', preventAllScroll, { passive: false, capture: true });
    document.addEventListener('touchmove', preventAllScroll, { passive: false, capture: true });

    setTimeout(() => {
      editTitleRef.current?.focus?.();
      editTitleRef.current?.select?.();
    }, 0);

    return () => {
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEsc);
      document.removeEventListener('wheel', preventAllScroll, { capture: true });
      document.removeEventListener('touchmove', preventAllScroll, { capture: true });
    };
  }, [closeEditModal, isEditOpen]);

  useEffect(() => {
    if (!isEditOpen) return;
    const id = editingTask?.id ?? null;
    if (id == null) return;
    if (modalMode !== 'edit') return;
    if (titleDirty) return;
    const latest = safeTasks.find((t) => (t?.id ?? null) === id);
    if (!latest) return;
    const latestTitle = String(latest?.title ?? '');
    if (latestTitle !== draftTitle) {
      setDraftTitle(latestTitle);
    }
  }, [draftTitle, editingTask?.id, isEditOpen, modalMode, safeTasks, titleDirty]);

  const renderTaskRow = (task) => {
    const isCompleted = isTaskCompletedInCycle(task);
    const key = task?.id != null ? `quest-${task.id}` : `quest-${task?.title ?? 'unknown'}-${task?.created_at ?? ''}`;
    const taskId = task?.id ?? null;
    const isOver = taskId != null && dragOverTaskId === taskId;

    return (
      <div
        key={key}
        className={`border border-gray-200 rounded-lg p-2.5 bg-white shadow-sm transition hover:shadow-md cursor-pointer ${isCompleted ? 'opacity-70' : ''} ${isOver ? 'ring-2 ring-indigo-200' : ''}`}
        onDoubleClick={() => {
          openEditModal(task);
        }}
        draggable={taskId != null}
        onDragStart={(event) => {
          if (taskId == null) {
            event.preventDefault();
            return;
          }
          const card = event.currentTarget;
          if (card) {
            card.style.opacity = '0.5';
          }
          setDraggedTaskId(taskId);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(taskId));
        }}
        onDragEnd={(event) => {
          const card = event.currentTarget;
          if (card) {
            card.style.opacity = '1';
          }
          setDraggedTaskId(null);
          setDragOverTaskId(null);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          if (taskId != null) {
            setDragOverTaskId(taskId);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setDragOverTaskId(null);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOverTaskId(null);
          if (draggedTaskId == null || taskId == null) return;
          applyReorder(draggedTaskId, taskId, false);
          setDraggedTaskId(null);
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className={`font-medium truncate ${isCompleted ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
              {String(task?.title ?? '') || '名称未設定'}
            </div>
          </div>
          <button
            type="button"
            draggable={false}
            className={`inline-flex size-6 flex-shrink-0 items-center justify-center rounded-lg border p-0 text-[11px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
              isCompleted
                ? 'bg-green-500 border-green-600 text-white'
                : 'bg-white border-gray-300 text-transparent hover:border-gray-400'
            }`}
            title={isCompleted ? '完了済み' : '未完了'}
            onClick={(e) => {
              e.stopPropagation();
              if (typeof onToggleTask === 'function') {
                onToggleTask(task, !isCompleted, cycleId);
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
            }}
          >
            ✓
          </button>
        </div>
      </div>
    );
  };

  const periodTabs = [
    { key: 'daily', label: 'デイリー' },
    { key: 'weekly', label: 'ウィークリー' },
    { key: 'monthly', label: 'マンスリー' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex w-full items-center gap-1 rounded-full bg-slate-100 p-1">
            {periodTabs.map((tab) => {
              const active = tab.key === period;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setPeriod(tab.key)}
                  className={`flex h-8 flex-1 items-center justify-center rounded-full border border-transparent px-2 text-xs font-semibold transition-all duration-200 ${
                    active ? 'bg-white text-indigo-600 shadow' : 'bg-transparent text-slate-500 hover:text-indigo-500'
                  }`}
                  aria-pressed={active}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto px-4 pb-3 pt-3">
        {periodTasks.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-2 text-gray-400">
            <IconTrophy className="h-12 w-12 text-gray-300" />
            <p className="text-sm">クエストがありません</p>
			<p className="text-xs text-gray-300">右上の「＋」から追加できます</p>
          </div>
        ) : (
          <div className="card-stack">
            {allCleared && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-700">
                <IconCrown className="h-10 w-10" />
                <div className="text-sm font-semibold">すべて達成！</div>
              </div>
            )}

            {incomplete.map((t) => renderTaskRow(t))}

            {draggedTaskId != null && incomplete.length > 0 && (
              <div
                className="rounded-lg border border-dashed border-slate-200 bg-white/70 p-3 text-center text-xs text-slate-400"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  applyReorder(draggedTaskId, null, true);
                  setDraggedTaskId(null);
                  setDragOverTaskId(null);
                }}
              >
                ここにドロップして末尾へ
              </div>
            )}

            {completed.length > 0 && (
              <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                <span className="flex-1 h-px bg-gray-200" />
                <span className="tracking-wide">完了済み</span>
                <span className="flex-1 h-px bg-gray-200" />
              </div>
            )}

            {completed.map((t) => renderTaskRow(t))}

            {draggedTaskId != null && completed.length > 0 && (
              <div
                className="mt-2 rounded-lg border border-dashed border-slate-200 bg-white/70 p-3 text-center text-xs text-slate-400"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  applyReorder(draggedTaskId, null, true);
                  setDraggedTaskId(null);
                  setDragOverTaskId(null);
                }}
              >
                ここにドロップして末尾へ
              </div>
            )}
          </div>
        )}
      </div>

      {isEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="quest-modal-content w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">{modalMode === 'create' ? 'クエストを追加' : 'クエストを編集'}</div>
            </div>

            <div className="px-4 py-3">
              <label className="block text-xs font-semibold text-slate-500">名前</label>
              <input
                ref={editTitleRef}
                type="text"
                value={draftTitle}
                onChange={(e) => {
                  setDraftTitle(e.target.value);
                  setTitleDirty(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const trimmed = String(draftTitle ?? '').trim();
                    if (!trimmed) return;
                    if (modalMode === 'create') {
                      if (typeof onCreateTask === 'function') {
                        onCreateTask({ period, title: trimmed });
                      }
                    } else if (typeof onUpdateTask === 'function') {
                      onUpdateTask(editingTask, trimmed);
                    }
                    setTitleDirty(false);
                    setIsEditOpen(false);
                    setEditingTask(null);
                  }
                }}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400"
                maxLength={80}
              />
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
              {modalMode === 'edit' ? (
                <button
                  type="button"
                  className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                  onClick={() => {
                    const target = editingTask;
                    if (!target) return;
                    const ok = window.confirm('このクエストを削除しますか？');
                    if (!ok) return;
                    if (typeof onDeleteTask === 'function') {
                      onDeleteTask(target);
                    }
                    setTitleDirty(false);
                    setIsEditOpen(false);
                    setEditingTask(null);
                  }}
                >
                  削除
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  onClick={closeEditModal}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!String(draftTitle || '').trim()}
                  onClick={() => {
                    const trimmed = String(draftTitle ?? '').trim();
                    if (!trimmed) return;
                    if (modalMode === 'create') {
                      if (typeof onCreateTask === 'function') {
                        onCreateTask({ period, title: trimmed });
                      }
                    } else if (typeof onUpdateTask === 'function') {
                      onUpdateTask(editingTask, trimmed);
                    }
                    setTitleDirty(false);
                    setIsEditOpen(false);
                    setEditingTask(null);
                  }}
                >
                  {modalMode === 'create' ? '追加' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default QuestArea;
