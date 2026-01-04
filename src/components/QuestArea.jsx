import React, { useEffect, useMemo, useState, useCallback } from 'react';
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

const QuestArea = ({
  tasks = [],
  onCreateTask,
  onToggleTask,
  addInputRef,
}) => {
  const [period, setPeriod] = useState('daily');
  const [title, setTitle] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 0時跨ぎで cycle が切り替わるように定期更新
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const cycleId = useMemo(() => getCycleId(period, nowMs), [nowMs, period]);

  const safeTasks = useMemo(() => (Array.isArray(tasks) ? tasks : []), [tasks]);

  const periodTasks = useMemo(() => {
    const p = normalizePeriod(period);
    return safeTasks
      .filter((t) => normalizePeriod(t?.period) === p)
      .slice()
      .sort((a, b) => {
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

  const commitCreate = useCallback(() => {
    const trimmed = String(title || '').trim();
    if (!trimmed) return;
    if (typeof onCreateTask === 'function') {
      onCreateTask({ period, title: trimmed });
    }
    setTitle('');
    try {
      addInputRef?.current?.focus?.();
    } catch {
      // ignore
    }
  }, [addInputRef, onCreateTask, period, title]);

  const renderTaskRow = (task) => {
    const isCompleted = String(task?.completed_cycle_id ?? '') === String(cycleId ?? '');
    const key = task?.id != null ? `quest-${task.id}` : `quest-${task?.title ?? 'unknown'}-${task?.created_at ?? ''}`;

    return (
      <div
        key={key}
        className={`border border-gray-200 rounded-lg p-2.5 bg-white shadow-sm transition hover:shadow-md ${isCompleted ? 'opacity-70' : ''}`}
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className={`font-medium truncate ${isCompleted ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
              {String(task?.title ?? '') || '名称未設定'}
            </div>
          </div>
          <button
            type="button"
            className={`inline-flex size-6 flex-shrink-0 items-center justify-center rounded-lg border p-0 text-[11px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
              isCompleted
                ? 'bg-green-500 border-green-600 text-white'
                : 'bg-white border-gray-300 text-transparent hover:border-gray-400'
            }`}
            title={isCompleted ? '完了済み' : '未完了'}
            onClick={() => {
              if (typeof onToggleTask === 'function') {
                onToggleTask(task, !isCompleted, cycleId);
              }
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
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center rounded-full bg-slate-100 p-1">
            {periodTabs.map((tab) => {
              const active = tab.key === period;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setPeriod(tab.key)}
                  className={`inline-flex h-8 items-center justify-center rounded-full border border-transparent px-3 text-xs font-semibold transition-all duration-200 ${
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

        <div className="mt-3 flex items-center gap-2">
          <input
            ref={addInputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitCreate();
              }
            }}
            placeholder="クエストタスクを追加"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400"
            maxLength={80}
          />
          <button
            type="button"
            onClick={commitCreate}
            disabled={!String(title || '').trim()}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-indigo-200 bg-white px-3 text-sm font-semibold text-indigo-600 transition-all duration-200 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="追加"
            title="追加"
          >
            ＋
          </button>
        </div>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto px-4 pb-3 pt-3">
        {periodTasks.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-2 text-gray-400">
            <IconTrophy className="h-12 w-12 text-gray-300" />
            <p className="text-sm">クエストがありません</p>
            <p className="text-xs text-gray-300">上の入力欄から追加できます</p>
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

            {completed.length > 0 && (
              <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                <span className="flex-1 h-px bg-gray-200" />
                <span className="tracking-wide">完了済み</span>
                <span className="flex-1 h-px bg-gray-200" />
              </div>
            )}

            {completed.map((t) => renderTaskRow(t))}
          </div>
        )}
      </div>
    </div>
  );
};

export default QuestArea;
