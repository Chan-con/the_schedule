import React, { useEffect, useMemo, useRef, useState, useCallback, useImperativeHandle } from 'react';

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
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [modalMode, setModalMode] = useState('edit');
  const [editingTask, setEditingTask] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [titleDirty, setTitleDirty] = useState(false);
  const editTitleRef = useRef(null);

  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverTaskId, setDragOverTaskId] = useState(null);

  const safeTasks = useMemo(() => (Array.isArray(tasks) ? tasks : []), [tasks]);

  const normalizeTitleKey = useCallback((value) => {
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

  const isDuplicateTitle = useCallback((candidate, { ignoreId } = {}) => {
    const key = normalizeTitleKey(candidate);
    if (!key) return false;
    return safeTasks.some((t) => {
      const id = t?.id ?? null;
      if (ignoreId != null && id === ignoreId) return false;
      return normalizeTitleKey(t?.title) === key;
    });
  }, [normalizeTitleKey, safeTasks]);

  const orderedTasks = useMemo(() => {
    return safeTasks
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
  }, [safeTasks]);

  const allCleared = useMemo(() => {
    return orderedTasks.length > 0 && orderedTasks.every((t) => !!t?.completed);
  }, [orderedTasks]);

  const applyReorder = useCallback((dragId, overId, dropToEnd = false) => {
    const dragKey = dragId ?? null;
    if (dragKey == null) return;

    const ids = orderedTasks.map((t) => t?.id).filter((id) => id != null);
    const fromIndex = ids.findIndex((id) => id === dragKey);
    if (fromIndex === -1) return;

    let toIndex = ids.length - 1;
    if (!dropToEnd && overId != null) {
      const idx = ids.findIndex((id) => id === overId);
      if (idx !== -1) {
        toIndex = idx;
      }
    }

    if (toIndex === fromIndex) return;

    const nextIds = ids.slice();
    nextIds.splice(fromIndex, 1);
    nextIds.splice(Math.min(toIndex, nextIds.length), 0, dragKey);

    if (typeof onReorderTasks === 'function') {
      onReorderTasks('daily', nextIds);
    }
  }, [onReorderTasks, orderedTasks]);

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
    const isCompleted = !!task?.completed;
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
                onToggleTask(task, !isCompleted);
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="custom-scrollbar flex-1 overflow-y-auto px-4 pb-3 pt-3">
        {orderedTasks.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-2 text-gray-400">
            <IconTrophy className="h-12 w-12 text-gray-300" />
            <p className="text-sm">クエストがありません</p>
			<p className="text-xs text-gray-300">右上の「＋」から追加できます</p>
          </div>
        ) : (
          <div className="card-stack">
            {allCleared && (
              <div className="mb-2 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-700">
                <IconCrown className="h-5 w-5 flex-shrink-0 text-amber-500" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">All quests cleared!</div>
                  <div className="text-xs text-amber-600">Great job — keep it up.</div>
                </div>
              </div>
            )}

            {orderedTasks.map((t) => renderTaskRow(t))}

            {draggedTaskId != null && orderedTasks.length > 0 && (
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
                      if (isDuplicateTitle(trimmed)) {
                        window.alert('同名のクエストは登録できません。');
                        return;
                      }
                    } else {
                      const ignoreId = editingTask?.id ?? null;
                      if (isDuplicateTitle(trimmed, { ignoreId })) {
                        window.alert('同名のクエストは登録できません。');
                        return;
                      }
                    }
                    if (modalMode === 'create') {
                      if (typeof onCreateTask === 'function') {
                        onCreateTask({ title: trimmed });
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
                      if (isDuplicateTitle(trimmed)) {
                        window.alert('同名のクエストは登録できません。');
                        return;
                      }
                    } else {
                      const ignoreId = editingTask?.id ?? null;
                      if (isDuplicateTitle(trimmed, { ignoreId })) {
                        window.alert('同名のクエストは登録できません。');
                        return;
                      }
                    }
                    if (modalMode === 'create') {
                      if (typeof onCreateTask === 'function') {
                        onCreateTask({ title: trimmed });
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
